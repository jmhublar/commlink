import {RpcError,exact,object,string,integer,canonical} from './protocol';

type Row=Record<string,SqlStorageValue>;
type Job={request_message_id:string;correlation_id:string};
const refused=(reason:string):never=>{throw new RpcError(-32010,'Completion contract refused',{reason});};
const token=(value:unknown)=>{const s=string(value,160);if(!/^[A-Za-z0-9_.:-]+$/.test(s))throw new RpcError(-32602,'Invalid completion identifier');return s;};
export type CompletionPlan={owner_thread_id:string;explicit_callback:{mode:'thread_message'|'unavailable';tool_name:string|null};
  platform_push:'declared'|'unavailable';recovery:{automation_id:string;owner_thread_id:string;kind:'one_shot'|'recurring';due_at:number;expires_at:number;max_checks:number;cadence_seconds:number|null}};

/** Coordinator attestations of observed host metadata, not a scheduler, callback
 * receiver, authorization receipt or independent provider verification. */
export class CompletionRecovery {
  constructor(private sql:SqlStorage,private now=()=>Date.now()){
    sql.exec(`CREATE TABLE IF NOT EXISTS session_completion(
      request_message_id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL,owner_thread_id TEXT NOT NULL,plan_json TEXT NOT NULL,
      executor_id TEXT UNIQUE,turn_id TEXT,checks_used INTEGER NOT NULL DEFAULT 0,next_due INTEGER NOT NULL,
      terminal_state TEXT,terminal_source TEXT,resolved INTEGER,observed_signal_count INTEGER NOT NULL DEFAULT 0,last_observed INTEGER,observed_state TEXT);
      CREATE TABLE IF NOT EXISTS session_completion_signals(
      event_id TEXT PRIMARY KEY,request_message_id TEXT NOT NULL,source TEXT NOT NULL,event_json TEXT NOT NULL,received INTEGER NOT NULL);`);
  }
  private row(q:string,...args:SqlStorageValue[]){return this.sql.exec(q,...args).toArray()[0] as Row|undefined;}
  private rowFor(key:string){const row=this.row('SELECT * FROM session_completion WHERE request_message_id=?',key);if(!row)return refused('COMPLETION_CONTRACT_REQUIRED');return row;}
  private plan(row:Row){return JSON.parse(String(row.plan_json)) as CompletionPlan;}
  private parse(value:unknown,expectedOwner:string|null|undefined):CompletionPlan{
    const p=object(value);exact(p,['owner_thread_id','explicit_callback','platform_push','recovery']);
    if(!expectedOwner||token(p.owner_thread_id)!==expectedOwner)return refused('OWNER_NOT_VERIFIED');
    const e=object(p.explicit_callback);exact(e,['mode','tool_name']);
    if(e.mode!=='thread_message'&&e.mode!=='unavailable')throw new RpcError(-32602,'Invalid callback mode');
    if(e.mode==='thread_message')token(e.tool_name);else if(e.tool_name!==null)throw new RpcError(-32602,'Unexpected callback tool');
    if(p.platform_push!=='declared'&&p.platform_push!=='unavailable')throw new RpcError(-32602,'Invalid platform notification mode');
    const r=object(p.recovery);exact(r,['automation_id','owner_thread_id','kind','due_at','expires_at','max_checks','cadence_seconds']);
    token(r.automation_id);if(token(r.owner_thread_id)!==expectedOwner)return refused('RECOVERY_WRONG_OWNER');
    const now=this.now(),due=integer(r.due_at,now+1,now+86400000),expires=integer(r.expires_at,due,now+86400000);
    const checks=integer(r.max_checks,1,24);
    if(r.kind==='one_shot'){if(checks!==1||r.cadence_seconds!==null)throw new RpcError(-32602,'Invalid one-shot recovery');}
    else if(r.kind==='recurring'){
      const cadence=integer(r.cadence_seconds,3600,86400);
      if(due+(checks-1)*cadence*1000>expires)throw new RpcError(-32602,'Recovery checks exceed expiry');
    }else throw new RpcError(-32602,'Invalid recovery kind');
    return {owner_thread_id:expectedOwner,explicit_callback:{mode:e.mode,tool_name:e.tool_name as string|null},platform_push:p.platform_push,
      recovery:{automation_id:r.automation_id as string,owner_thread_id:expectedOwner,kind:r.kind,due_at:due,expires_at:expires,max_checks:checks,cadence_seconds:r.cadence_seconds as number|null}};
  }
  register(job:Job,value:unknown,expectedOwner:string|null|undefined){
    // Parse structure and owner first. An identical stored registration remains
    // idempotent even after the original due time; it never renews the plan.
    const old=this.row('SELECT * FROM session_completion WHERE request_message_id=?',job.request_message_id);
    if(old){if(old.owner_thread_id!==expectedOwner||canonical(this.plan(old))!==canonical(value))return refused('COMPLETION_CONFLICT');return this.describe(old);}
    const plan=this.parse(value,expectedOwner);
    this.sql.exec('INSERT INTO session_completion(request_message_id,correlation_id,owner_thread_id,plan_json,next_due) VALUES(?,?,?,?,?)',
      job.request_message_id,job.correlation_id,plan.owner_thread_id,JSON.stringify(plan),plan.recovery.due_at);
    return this.describe(this.rowFor(job.request_message_id));
  }
  ready(key:string,expectedOwner:string|null|undefined){
    const row=this.rowFor(key),plan=this.plan(row);
    if(!expectedOwner||row.owner_thread_id!==expectedOwner)return refused('OWNER_NOT_VERIFIED');
    // The saved schedule must still be in the future when the launch intent is
    // consumed. A stale one-shot is not continuing recovery coverage.
    if(row.resolved!==null||row.executor_id!==null||Number(row.checks_used)>=plan.recovery.max_checks||Number(row.next_due)>plan.recovery.expires_at||
      Number(row.next_due)<=this.now()||plan.recovery.expires_at<=this.now())return refused('RECOVERY_NOT_READY');
    return {request_message_id:key,correlation_id:row.correlation_id,owner_thread_id:row.owner_thread_id,
      explicit_callback:plan.explicit_callback,platform_push:plan.platform_push,recovery:plan.recovery,
      hint:{kind:'commlink_completion_hint',schema_version:1,request_message_id:key,correlation_id:row.correlation_id,owner_thread_id:row.owner_thread_id}};
  }
  bindTask(key:string,executor:string){
    token(executor);const r=this.rowFor(key);
    if(r.executor_id!==null&&r.executor_id!==executor)return refused('EXECUTOR_CONFLICT');
    const other=this.row('SELECT request_message_id FROM session_completion WHERE executor_id=?',executor);
    if(other&&other.request_message_id!==key)return refused('EXECUTOR_CONFLICT');
    this.sql.exec('UPDATE session_completion SET executor_id=? WHERE request_message_id=?',executor,key);
  }
  bindTurn(key:string,executor:unknown,turn:unknown){
    const r=this.rowFor(key);if(r.executor_id!==token(executor)||r.resolved!==null)return refused('EXECUTOR_CONFLICT');
    const id=token(turn);if(r.turn_id!==null&&r.turn_id!==id)return refused('TURN_CONFLICT');
    this.sql.exec('UPDATE session_completion SET turn_id=? WHERE request_message_id=?',id,key);return this.describe(this.rowFor(key));
  }
  signal(key:string,value:unknown){
    const r=this.rowFor(key),p=object(value);exact(p,['event_id','source','owner_thread_id','executor_id','correlation_id','sender_thread_id','automation_id']);
    token(p.event_id);
    if(p.owner_thread_id!==r.owner_thread_id||p.correlation_id!==r.correlation_id||p.executor_id!==r.executor_id)return refused('SIGNAL_BINDING_MISMATCH');
    const plan=this.plan(r);
    if(p.source==='explicit_child'){
      if(!r.executor_id||plan.explicit_callback.mode!=='thread_message'||p.sender_thread_id!==r.executor_id||p.automation_id!==null)return refused('SIGNAL_BINDING_MISMATCH');
    }else if(p.source==='platform_push'){
      if(!r.executor_id||plan.platform_push!=='declared'||p.sender_thread_id!==null||p.automation_id!==null)return refused('SIGNAL_BINDING_MISMATCH');
    }else if(p.source==='scheduled_recovery'){
      if(p.automation_id!==plan.recovery.automation_id||p.sender_thread_id!==null)return refused('SIGNAL_BINDING_MISMATCH');
    }else throw new RpcError(-32602,'Invalid completion signal source');
    const serialized=JSON.stringify({event_id:p.event_id,source:p.source,owner_thread_id:p.owner_thread_id,executor_id:p.executor_id,
      correlation_id:p.correlation_id,sender_thread_id:p.sender_thread_id,automation_id:p.automation_id});
    const old=this.row('SELECT * FROM session_completion_signals WHERE event_id=?',p.event_id as string);
    if(old){if(old.request_message_id!==key||old.event_json!==serialized)return refused('SIGNAL_CONFLICT');return {duplicate:true,completion:this.describe(r)};}
    if(Number(this.row('SELECT COUNT(*) AS n FROM session_completion_signals WHERE request_message_id=?',key)?.n)>=64)return refused('SIGNAL_LIMIT');
    if(p.source==='scheduled_recovery'&&r.resolved===null){
      if(this.now()>plan.recovery.expires_at||Number(r.checks_used)>=plan.recovery.max_checks)return refused('RECOVERY_EXHAUSTED');
      if(this.now()<Number(r.next_due))return refused('RECOVERY_NOT_DUE');
      const next=plan.recovery.cadence_seconds===null?plan.recovery.expires_at+1:Number(r.next_due)+plan.recovery.cadence_seconds*1000;
      this.sql.exec('UPDATE session_completion SET checks_used=checks_used+1,next_due=? WHERE request_message_id=?',next,key);
    }
    this.sql.exec('INSERT INTO session_completion_signals(event_id,request_message_id,source,event_json,received) VALUES(?,?,?,?,?)',p.event_id as string,key,p.source as string,serialized,this.now());
    return {duplicate:false,completion:this.describe(this.rowFor(key))};
  }
  assertTerminal(key:string,executor:unknown,turn:unknown){const r=this.rowFor(key);
    if(!r.executor_id||r.executor_id!==executor||!r.turn_id||r.turn_id!==turn)return refused('TERMINAL_BINDING_MISMATCH');}
  observe(key:string,value:unknown){
    const p=object(value);exact(p,['executor_id','turn_id','source','state']);this.assertTerminal(key,p.executor_id,p.turn_id);
    if(typeof p.source!=='string'||!['read_thread','wait_threads'].includes(p.source)||typeof p.state!=='string'||!['running','attention','unknown'].includes(p.state))throw new RpcError(-32602,'Invalid provider observation');
    const r=this.rowFor(key);if(r.resolved!==null)return this.describe(r);
    const n=Number(this.row('SELECT COUNT(*) AS n FROM session_completion_signals WHERE request_message_id=?',key)?.n??0);
    this.sql.exec('UPDATE session_completion SET observed_signal_count=?,last_observed=?,observed_state=? WHERE request_message_id=?',n,this.now(),p.state as string,key);
    return this.describe(this.rowFor(key));
  }
  resolve(key:string,state:string,source:string){this.rowFor(key);this.sql.exec('UPDATE session_completion SET terminal_state=?,terminal_source=?,resolved=? WHERE request_message_id=?',state,source,this.now(),key);}
  private describe(r:Row){
    const plan=this.plan(r),signals=this.sql.exec('SELECT event_id,source,received FROM session_completion_signals WHERE request_message_id=? ORDER BY rowid',String(r.request_message_id)).toArray();
    const exhausted=this.now()>plan.recovery.expires_at||Number(r.checks_used)>=plan.recovery.max_checks;
    return {request_message_id:r.request_message_id,correlation_id:r.correlation_id,owner_thread_id:r.owner_thread_id,executor_id:r.executor_id,turn_id:r.turn_id,
      plan,recovery:{checks_used:r.checks_used,next_due:r.next_due,exhausted},signals,
      last_observation:r.last_observed===null?null:{state:r.observed_state,observed_at:r.last_observed},
      terminal:r.resolved===null?null:{state:r.terminal_state,source:r.terminal_source,observed_at:r.resolved},
      action:r.resolved!==null?'none':signals.length>Number(r.observed_signal_count)?r.executor_id===null?'reconcile_launch':'reconcile_provider':
        exhausted||r.observed_state==='attention'||r.observed_state==='unknown'?'attention':this.now()>=Number(r.next_due)?'await_scheduled_recovery':'await_signal'};
  }
  recovery(owner:string|null|undefined,limit=20){if(!owner)return refused('OWNER_NOT_VERIFIED');return {contracts:this.sql.exec('SELECT * FROM session_completion WHERE owner_thread_id=? ORDER BY rowid DESC LIMIT ?',owner,limit).toArray().map(r=>this.describe(r as Row))};}
}
