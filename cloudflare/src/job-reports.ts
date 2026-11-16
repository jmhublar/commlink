import {RpcError,exact,string,uuid,canonical,type Identity} from './protocol';

export type JobBinding={job_id:string;owner_key:string;reporter_key:string;owner_thread_id:string;correlation_id:string;
  request_message_id:string|null;executor_id:string|null;turn_id:string|null;expires_at:number;approval_ref:string;reconciled:boolean};
type Row=Record<string,SqlStorageValue>;
const denied=():never=>{throw new RpcError(-32003,'Job report is not authorized');};
const bindingText=(b:JobBinding)=>canonical({job_id:b.job_id,owner_key:b.owner_key,reporter_key:b.reporter_key,owner_thread_id:b.owner_thread_id,
  correlation_id:b.correlation_id,request_message_id:b.request_message_id,expires_at:b.expires_at,approval_ref:b.approval_ref});

/** Hints only. The lookup supplies trusted pre-recorded bindings; no caller
 * can register jobs, choose a destination or supply provider evidence here. */
export class JobReports {
  constructor(private sql:SqlStorage,private transaction:<T>(f:()=>T)=>T,private lookup:(id:string)=>JobBinding|null,private now=()=>Date.now()){
    sql.exec(`CREATE TABLE IF NOT EXISTS job_subscriptions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,peer TEXT NOT NULL,owner_thread_id TEXT NOT NULL,
      url TEXT NOT NULL,secret TEXT NOT NULL,previous_secret TEXT,rotation_until INTEGER,expires INTEGER NOT NULL,verified INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS job_hints(job_id TEXT PRIMARY KEY,binding_json TEXT NOT NULL,owner_key TEXT NOT NULL,owner_thread_id TEXT NOT NULL,
      request_message_id TEXT,executor_id TEXT,turn_id TEXT,claimed_status TEXT NOT NULL,event_id TEXT UNIQUE NOT NULL,body TEXT,
      created INTEGER NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL,next_check INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS job_hint_outbox(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,sub_id TEXT NOT NULL,body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL,last_http INTEGER,last_error TEXT,
      UNIQUE(job_id,sub_id));`);
  }
  private row(q:string,...p:SqlStorageValue[]){return this.sql.exec(q,...p).toArray()[0] as Row|undefined;}
  private rows(q:string,...p:SqlStorageValue[]){return this.sql.exec(q,...p).toArray() as Row[];}
  private binding(key:string){
    const b=this.lookup(key);
    if(!b||b.job_id!==key||typeof b.correlation_id!=='string'||!uuid.test(b.job_id)||!uuid.test(b.correlation_id)||!b.owner_key||!b.reporter_key||!b.owner_thread_id||!b.approval_ref||
      !Number.isSafeInteger(b.expires_at)||b.expires_at<=this.now()||typeof b.reconciled!=='boolean')return null;
    for(const value of [b.owner_key,b.reporter_key,b.owner_thread_id,b.approval_ref,b.executor_id,b.turn_id])if(value!==null&&(typeof value!=='string'||!value.length||value.length>200))return null;
    if(b.request_message_id!==null&&(typeof b.request_message_id!=='string'||!uuid.test(b.request_message_id)))return null;
    return b;
  }
  report(id:Identity,a:Record<string,unknown>){
    exact(a,['job_id','status']);const key=string(a.job_id,36);
    if(!uuid.test(key)||key!==key.toLowerCase()||(a.status!=='finished'&&a.status!=='failed'))throw new RpcError(-32602,'Invalid job status hint');
    return this.transaction(()=>{
      const b=this.binding(key);if(id.peer!=='openai'||!b||id.key!==b.reporter_key)return denied();
      const old=this.row('SELECT * FROM job_hints WHERE job_id=?',key);
      if(old){
        if(old.binding_json!==bindingText(b)||old.claimed_status!==a.status||(old.executor_id!==null&&old.executor_id!==b.executor_id)||
          (old.turn_id!==null&&old.turn_id!==b.turn_id))throw new RpcError(-32602,'Job status hint conflict');
        return {status:'duplicate',job_id:key,event_id:old.event_id,delivery:'unchanged',provider_verified:false};
      }
      if(Number(this.row('SELECT COUNT(*) AS n FROM job_hints')?.n)>=10000)throw new RpcError(-32000,'Job hint capacity reached');
      const event='evt_job_'+crypto.randomUUID();
      this.sql.exec('INSERT INTO job_hints(job_id,binding_json,owner_key,owner_thread_id,request_message_id,executor_id,turn_id,claimed_status,event_id,created,expires,state,next_check) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        key,bindingText(b),b.owner_key,b.owner_thread_id,b.request_message_id,b.executor_id,b.turn_id,a.status,event,this.now(),b.expires_at,b.reconciled?'reconciled':'waiting',this.now());
      if(b.reconciled)return {status:'already_reconciled',job_id:key,event_id:null,delivery:'not_queued',provider_verified:false};
      this.flushOne(key);
      const queued=this.row('SELECT COUNT(*) AS n FROM job_hint_outbox WHERE job_id=?',key);
      return {status:'recorded',job_id:key,event_id:event,delivery:Number(queued?.n)>0?'queued':'pending_binding_or_subscription',provider_verified:false};
    });
  }
  private flushOne(key:string){
    const h=this.row('SELECT * FROM job_hints WHERE job_id=?',key);if(!h||h.state!=='waiting')return;
    const b=this.binding(key);
    if(!b||h.binding_json!==bindingText(b)||b.reconciled||(h.executor_id!==null&&h.executor_id!==b.executor_id)||(h.turn_id!==null&&h.turn_id!==b.turn_id)){
      this.sql.exec("UPDATE job_hints SET state='cancelled' WHERE job_id=?",key);return;}
    if(!b.executor_id||!b.turn_id){this.sql.exec('UPDATE job_hints SET next_check=? WHERE job_id=?',this.now()+60000,key);return;}
    const subs=this.rows('SELECT * FROM job_subscriptions WHERE owner=? AND owner_thread_id=? AND expires>?',b.owner_key,b.owner_thread_id,this.now());
    if(!subs.length){this.sql.exec('UPDATE job_hints SET next_check=? WHERE job_id=?',this.now()+60000,key);return;}
    const body=JSON.stringify({eventId:h.event_id,name:'commlink.job.status_reported',timestamp:new Date(Number(h.created)).toISOString(),
      data:{job_id:key,request_message_id:b.request_message_id,correlation_id:b.correlation_id,executor_id:b.executor_id,turn_id:b.turn_id,owner_thread_id:b.owner_thread_id,claimed_status:h.claimed_status},cursor:null});
    this.sql.exec('UPDATE job_hints SET executor_id=?,turn_id=?,body=?,state=\'queued\' WHERE job_id=?',b.executor_id,b.turn_id,body,key);
    for(const sub of subs)this.sql.exec('INSERT INTO job_hint_outbox(id,job_id,sub_id,body,due) VALUES(?,?,?,?,?)',
      String(h.event_id)+':'+String(sub.id),key,sub.id,body,this.now());
  }
  refreshRequest(key:string){this.transaction(()=>{for(const h of this.rows("SELECT job_id FROM job_hints WHERE request_message_id=? AND state='waiting'",key))this.flushOne(String(h.job_id));});}
  async run(deliver:(sub:Row,eventId:string,body:string)=>Promise<Response>,authorized:(sub:Row)=>boolean){
    this.transaction(()=>{for(const h of this.rows("SELECT job_id FROM job_hints WHERE state='waiting' AND next_check<=? ORDER BY next_check LIMIT 20",this.now()))this.flushOne(String(h.job_id));});
    for(const o of this.rows("SELECT * FROM job_hint_outbox WHERE status='pending' AND due<=? ORDER BY due LIMIT 10",this.now())){
      const h=this.row('SELECT * FROM job_hints WHERE job_id=?',o.job_id),b=this.binding(String(o.job_id)),sub=this.row('SELECT * FROM job_subscriptions WHERE id=?',o.sub_id);
      if(!h||!b||b.reconciled||h.binding_json!==bindingText(b)||h.executor_id!==b.executor_id||h.turn_id!==b.turn_id||!sub||
        sub.owner!==b.owner_key||sub.owner_thread_id!==b.owner_thread_id||Number(sub.expires)<=this.now()||!authorized(sub)){
        this.sql.exec("UPDATE job_hint_outbox SET status='cancelled',last_error='inactive' WHERE id=? AND status='pending'",o.id);continue;
      }
      let status=0,error:string|null=null;
      try{const response=await deliver(sub,String(h.event_id),String(o.body));status=response.status;await response.body?.cancel();}catch{error='network_or_callback_policy';}
      const attempts=Number(o.attempts)+1,accepted=status>=200&&status<300,transient=status===0||status===408||status===425||status===429||status>=500;
      this.sql.exec("UPDATE job_hint_outbox SET status=?,attempts=?,due=?,last_http=?,last_error=? WHERE id=? AND status='pending'",
        accepted?'accepted':transient&&attempts<6?'pending':'failed',attempts,this.now()+Math.min(300000,2000*2**(attempts-1)),status||null,error||(!accepted?'http_error':null),o.id);
    }
    this.sql.exec("UPDATE job_hint_outbox SET status='cancelled',last_error='subscription_expired' WHERE status='pending' AND sub_id IN (SELECT id FROM job_subscriptions WHERE expires<=?)",this.now());
    this.sql.exec('DELETE FROM job_subscriptions WHERE expires<=?',this.now());
    this.sql.exec('UPDATE job_subscriptions SET previous_secret=NULL,rotation_until=NULL WHERE rotation_until<=?',this.now());
  }
  status(id:Identity){return {job_subscriptions:this.rows('SELECT id,owner_thread_id,expires FROM job_subscriptions WHERE owner=?',id.key),
    job_deliveries:this.rows('SELECT o.id,o.job_id,o.status,o.attempts,o.last_http,o.last_error FROM job_hint_outbox o JOIN job_subscriptions s ON s.id=o.sub_id WHERE s.owner=? ORDER BY o.due DESC LIMIT 30',id.key)};}
  nextDue(){const r=this.row("SELECT MIN(t) AS due FROM (SELECT due AS t FROM job_hint_outbox WHERE status='pending' UNION ALL SELECT next_check AS t FROM job_hints WHERE state='waiting' UNION ALL SELECT expires AS t FROM job_subscriptions)");return r?.due==null?null:Number(r.due);}
}
