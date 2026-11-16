import { EVENT } from './protocol';

export interface GrokEnv {
  IDENTITIES_JSON: string;
  GROK_ENABLED?: string;
  GROK_WEBHOOK_URL?: string;
  GROK_SENDER_KEY?: string;
  GROK_WEBHOOK_ORIGIN?: string;
  GROK_AUTH_HEADER?: string;
  GROK_AUTH_SCHEME?: string;
  GROK_CONFIG_REVISION?: string;
}
type Row = Record<string, SqlStorageValue>;
const MIN_INTERVAL = 20_000, RECONCILE = 60_000, MAX_GROUPS = 3, MAX_ATTEMPTS = 6;

function configuration(env:GrokEnv) {
  if(env.GROK_ENABLED!=='true')return {state:'disabled'} as const;
  try {
    if(!env.GROK_WEBHOOK_URL || !env.GROK_SENDER_KEY || !env.GROK_WEBHOOK_ORIGIN || !env.GROK_CONFIG_REVISION ||
      env.GROK_AUTH_HEADER!=='Authorization' || env.GROK_AUTH_SCHEME!=='Bearer' ||
      !/^[\x21-\x7e]+$/.test(env.GROK_SENDER_KEY))throw new Error();
    const url=new URL(env.GROK_WEBHOOK_URL),origin=new URL(env.GROK_WEBHOOK_ORIGIN);
    if(url.protocol!=='https:' || url.origin!==origin.href.replace(/\/$/,'') ||
      origin.origin!==env.GROK_WEBHOOK_ORIGIN || url.username || url.password || url.hash || url.port ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') || !url.hostname.includes('.') ||
      /\.(localhost|local|internal)$/.test(url.hostname) || /[\s\\]/.test(env.GROK_WEBHOOK_URL))throw new Error();
    if(!Object.values(JSON.parse(env.IDENTITIES_JSON)).includes('robut'))return {state:'recipient_revoked'} as const;
    return {state:'ready',url:url.href,key:env.GROK_SENDER_KEY,revision:env.GROK_CONFIG_REVISION} as const;
  } catch {return {state:'invalid_configuration'} as const;}
}

// One active event per recipient. Mailbox rows remain the source of truth;
// retries reuse an immutable event and reconciliation creates a fresh event.
export class GrokWake {
  private sql:SqlStorage;
  constructor(private ctx:DurableObjectState,private env:GrokEnv) {
    this.sql=ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS grok_control(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,active_event TEXT,blocked INTEGER NOT NULL DEFAULT 0,not_before INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS grok_events(id TEXT PRIMARY KEY,message_id TEXT NOT NULL,correlation_id TEXT NOT NULL,watermark INTEGER NOT NULL,revision TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL,created INTEGER NOT NULL,last_http INTEGER,last_error TEXT);
      CREATE INDEX IF NOT EXISTS grok_message ON grok_events(message_id);
    `);
  }
  private row(query:string,...params:SqlStorageValue[]):Row|undefined{return this.sql.exec(query,...params).toArray()[0];}
  private first(){return this.row("SELECT * FROM messages WHERE recipient='robut' AND acked IS NULL AND expires>? ORDER BY seq LIMIT 1",Date.now());}
  private active(){return this.row('SELECT e.* FROM grok_events e JOIN grok_control c ON c.active_event=e.id WHERE c.id=1');}
  private update(id:SqlStorageValue,status:string,error:string|null=null){this.sql.exec('UPDATE grok_events SET status=?,last_error=? WHERE id=?',status,error,id);}
  private create() {
    const first=this.first();if(!first)return false;
    const previous=this.active();
    const now=Date.now(),control=this.row('SELECT * FROM grok_control WHERE id=1')!;
    const groups=Number(this.row('SELECT COUNT(*) AS n FROM grok_events WHERE message_id=? AND revision=?',first.id,control.revision)!.n);
    if(groups>=MAX_GROUPS){if(previous)this.update(previous.id,'exhausted','reconciliation_limit');return false;}
    const watermark=Number(this.row("SELECT MAX(seq) AS n FROM messages WHERE recipient='robut' AND acked IS NULL AND expires>?",now)!.n);
    const id='grok_'+crypto.randomUUID(),correlation=JSON.parse(String(first.envelope)).correlation_id;
    if(previous&&['pending','reconcile'].includes(String(previous.status)))this.update(previous.id,'superseded');
    this.sql.exec("INSERT INTO grok_events(id,message_id,correlation_id,watermark,revision,status,due,created) VALUES(?,?,?,?,?,'pending',?,?)",id,first.id,correlation,watermark,control.revision,Math.max(now,Number(control.not_before)),now);
    this.sql.exec('UPDATE grok_control SET active_event=? WHERE id=1',id);return true;
  }
  // Called inside the message transaction, after the durable alarm is installed.
  enqueue():boolean {
    const config=configuration(this.env);if(config.state!=='ready')return false;
    let control=this.row('SELECT * FROM grok_control WHERE id=1');
    if(!control){this.sql.exec('INSERT INTO grok_control(id,revision) VALUES(1,?)',config.revision);control=this.row('SELECT * FROM grok_control WHERE id=1')!;}
    if(control.revision!==config.revision){
      const old=this.active();if(old)this.update(old.id,'superseded','configuration_changed');
      // A deliberate revision bump resumes blocked/exhausted mail, including its
      // per-message budget. Event IDs are still new, and history is retained.
      this.sql.exec('UPDATE grok_control SET revision=?,active_event=NULL,blocked=0 WHERE id=1',config.revision);
      control=this.row('SELECT * FROM grok_control WHERE id=1')!;
    }
    if(control.blocked)return false;
    const current=this.active();
    if(current&&['pending','reconcile'].includes(String(current.status)))return true;
    return this.create();
  }
  acknowledge() {
    // Receipt can cancel a wake; it cannot enqueue one.
    if(!this.first()){const current=this.active();if(current&&['pending','reconcile'].includes(String(current.status)))this.update(current.id,'drained');}
  }
  nextDue():number|null {
    if(configuration(this.env).state!=='ready'||this.row('SELECT blocked FROM grok_control WHERE id=1')?.blocked)return null;
    const current=this.active();
    return current&&['pending','reconcile'].includes(String(current.status))?Number(current.due):null;
  }
  status() {
    return {configuration:configuration(this.env).state,blocked:!!this.row('SELECT blocked FROM grok_control WHERE id=1')?.blocked,
      active:this.active()??null,
      recent:this.sql.exec('SELECT id,message_id,status,attempts,last_http,last_error FROM grok_events ORDER BY created DESC LIMIT 10').toArray()};
  }
  async run() {
    const config=configuration(this.env);
    if(config.state!=='ready')return;
    this.ctx.storage.transactionSync(()=>this.enqueue());
    let job=this.active();if(!job||!['pending','reconcile'].includes(String(job.status))||Number(job.due)>Date.now())return;
    const first=this.first();
    if(!first){this.update(job.id,'drained');return;}
    if(job.status==='reconcile'||first.id!==job.message_id){
      const created=this.ctx.storage.transactionSync(()=>this.create());if(!created)return;
      job=this.active()!;if(Number(job.due)>Date.now())return;
    }
    const control=this.row('SELECT * FROM grok_control WHERE id=1')!;
    if(control.blocked)return;
    if(Number(control.not_before)>Date.now()){
      this.sql.exec('UPDATE grok_events SET due=? WHERE id=?',control.not_before,job.id);return;
    }
    const attempts=Number(job.attempts)+1,now=Date.now();
    if(attempts>MAX_ATTEMPTS){this.sql.exec("UPDATE grok_events SET status='reconcile',due=? WHERE id=?",now+RECONCILE,job.id);return;}
    // Persist before I/O. A crash can duplicate this attempt, never lose the job.
    this.ctx.storage.transactionSync(()=>{
      this.sql.exec('UPDATE grok_events SET attempts=?,due=? WHERE id=?',attempts,now+RECONCILE,job.id);
      this.sql.exec('UPDATE grok_control SET not_before=? WHERE id=1',now+MIN_INTERVAL);
    });
    let http=0,retryAfter=0;
    try {
      const response=await fetch(config.url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{
        'Authorization':'Bearer '+config.key,'Content-Type':'application/json'
      },body:JSON.stringify({event:EVENT,recipient:'robut',event_id:job.id,correlation_id:job.correlation_id})});
      http=response.status;
      const header=response.headers.get('retry-after');
      if(header){const delay=/^\d+$/.test(header)?Number(header)*1000:Date.parse(header)-Date.now();if(Number.isFinite(delay))retryAfter=Math.max(0,Math.min(300000,delay));}
      await response.body?.cancel();
    } catch {/* Never log response bodies, exception text, endpoint or credentials. */}
    this.sql.exec('UPDATE grok_events SET last_http=?,last_error=? WHERE id=?',http||null,http===200?null:http===0?'network_error':'http_error',job.id);
    // Cooldown belongs to the recipient, including a replacement event created
    // while this request was in flight. Persist it before the stale-event guard.
    if(retryAfter>0)this.sql.exec('UPDATE grok_control SET not_before=MAX(not_before,?) WHERE id=1',Date.now()+retryAfter);
    const transient=http===0||http===408||http===425||http===429||http>=500;
    // A permanent failure applies to this credential revision even when receipt
    // and a new message replaced the active event during the request.
    if(http!==200&&!transient&&this.row('SELECT revision FROM grok_control WHERE id=1')?.revision===config.revision){
      this.sql.exec('UPDATE grok_control SET blocked=1 WHERE id=1');
      const active=this.active();if(active&&['pending','reconcile'].includes(String(active.status)))this.update(active.id,'blocked','http_error');
    }
    // ack/new send can interleave with fetch; do not overwrite a newer event.
    const current=this.active();if(current?.id!==job.id||current.status!=='pending')return;
    const state=!this.first()?'drained':http===200?'reconcile':transient?(attempts<MAX_ATTEMPTS?'pending':'reconcile'):'blocked';
    const backoff=Math.min(300000,2000*2**(attempts-1))*(1+Math.random()/4);
    const due=Date.now()+Math.ceil(Math.max(MIN_INTERVAL,retryAfter,state==='reconcile'?RECONCILE:backoff));
    this.ctx.storage.transactionSync(()=>{
      this.sql.exec('UPDATE grok_events SET status=?,due=?,last_http=?,last_error=? WHERE id=?',state,due,http||null,http===200?null:http===0?'network_error':'http_error',job.id);
      if(state==='blocked')this.sql.exec('UPDATE grok_control SET blocked=1 WHERE id=1');
    });
    console.log(JSON.stringify({event:'grok_delivery',event_id:job.id,status:state,http_status:http||null,attempts}));
  }
  cleanup() {
    this.sql.exec('DELETE FROM grok_events WHERE created<? AND id NOT IN (SELECT active_event FROM grok_control WHERE active_event IS NOT NULL)',Date.now()-7*86400000);
  }
}
