import {RpcError,exact,object,string,integer,uuid,canonical as mailboxCanonical,sha,type Identity,type Envelope} from './protocol';
import {menu,sessionCanonical,sessionDigest,strictSessionJson,parseSessionRequest,selection,policyDecision,decision,RequestError,
  controlDigest,activationValid,type SessionConfiguration,type SessionRequest,type Decision} from './session-policy';
import {CompletionRecovery} from './completion';
import type {JobBinding} from './job-reports';

type Row=Record<string,SqlStorageValue>;
type Snapshot={config:SessionConfiguration;canonical:string;policyHash:string;menuHash:string;controlHash:string};
type Result={summary:string;checks:string[];limitations:string[];artifacts:{kind:string;url:string;sha256:string|null}[]};
const TERMINAL=['rejected','finished','failed'];
const ACTIVE=['accepted','launch_pending','submitted','started','launch_uncertain'];
const idValue=(v:unknown)=>{const id=string(v,36);if(!uuid.test(id))throw new RpcError(-32602,'Invalid identifier');return id;};
const publicText=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.length||Array.from(v).length>max||Array.from(v).some(c=>{const n=c.codePointAt(0)!;return n>=0xd800&&n<=0xdfff;})||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|whsec_|Bearer\s|CF-Access-Client-Secret|-----BEGIN.*PRIVATE KEY/i.test(v))throw new RpcError(-32602,'Invalid public result');return v;};
const toolError=(code:string)=>new RpcError(-32010,'Session control refused',{reason:code});

/** Durable control plane only. This class has no fetch, cloud launch, policy
 * activation, credential handling or automatic re-launch capability. */
export class SessionControl {
  private completions:CompletionRecovery;
  constructor(private sql:SqlStorage,private transaction:<T>(f:()=>T)=>T,private configuration:()=>SessionConfiguration,
    private channel:string,private now=()=>Date.now()){
    sql.exec(`CREATE TABLE IF NOT EXISTS session_jobs(
      id TEXT PRIMARY KEY,request_message_id TEXT UNIQUE NOT NULL,sender TEXT NOT NULL,correlation_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,request_json TEXT,state TEXT NOT NULL,version INTEGER NOT NULL,
      created INTEGER NOT NULL,updated INTEGER NOT NULL,expires INTEGER NOT NULL,decision_json TEXT NOT NULL,
      policy_hash TEXT,menu_hash TEXT,control_hash TEXT,activation_epoch INTEGER,approval_receipt TEXT,rule_id TEXT,fence TEXT,executor_id TEXT,result_json TEXT);
      CREATE TABLE IF NOT EXISTS session_slot(id INTEGER PRIMARY KEY CHECK(id=1),job_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_launches(job_id TEXT PRIMARY KEY,attempted INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS session_status_outbox(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,version INTEGER NOT NULL,
        envelope TEXT NOT NULL,created INTEGER NOT NULL,sent INTEGER,UNIQUE(job_id,version));`);
    this.completions=new CompletionRecovery(sql,now);
  }
  private row(q:string,...p:SqlStorageValue[]){return this.sql.exec(q,...p).toArray()[0] as Row|undefined;}
  private rows(q:string,...p:SqlStorageValue[]){return this.sql.exec(q,...p).toArray() as Row[];}
  private coordinator(id:Identity){if(id.peer!=='openai'||!this.configuration().coordinator_keys.includes(id.key))throw new RpcError(-32003,'Forbidden');}
  private current(s:Snapshot){if(sessionCanonical(this.configuration())!==s.canonical)throw toolError('POLICY_CHANGED');}
  private async snapshot():Promise<Snapshot>{
    const canonical=sessionCanonical(this.configuration());const config=JSON.parse(canonical) as SessionConfiguration;
    return {config,canonical,policyHash:await sessionDigest('commlink.policy.v1',config.policy),menuHash:await sessionDigest('commlink.menu.v1',menu),controlHash:await controlDigest(config)};
  }
  async capabilities(a:Record<string,unknown>){
    exact(a,[]);const s=await this.snapshot();
    return {schema_version:1,menu_version:menu.menu_version,menu_sha256:s.menuHash,roles:menu.roles,tiers:menu.tiers,
      controls:{model:'schema-supported',reasoning:'schema-supported',speed:['default'],workdir:null,hard_timeout:'unverified'},
      evidence:menu.evidence,active_policy:{policy_id:s.config.policy.policy_id,version:s.config.policy.version,
        sha256:s.policyHash,control_sha256:s.controlHash,state:s.config.policy.state,owner_approval_verified:activationValid(s.config,s.policyHash,s.controlHash,this.now()),
        epoch:s.config.activation?.epoch??null,paused:s.config.paused},coordinator_configured:s.config.coordinator_keys.length>0,
      environments:Object.entries(s.config.profiles).map(([alias,p])=>({alias,runnable:p.runnable,permissions_verified:p.permissions_verified,
        completion_wake_verified:p.completion_wake_verified,hard_timeout_verified:p.hard_timeout_verified,model_efforts:p.model_efforts}))};
  }
  private evaluate(raw:unknown,s:Snapshot){
    let request:SessionRequest;
    try{request=parseSessionRequest(typeof raw==='string'?strictSessionJson(raw):raw);}
    catch(e){if(e instanceof RequestError)return {request:null,decision:decision(e.code,e.fields),rule:null};throw e;}
    if(request.menu_version!==menu.menu_version||request.menu_sha256!==s.menuHash)return {request,decision:decision('STALE_CAPABILITIES'),rule:null};
    return {request,...policyDecision(s.config,s.policyHash,request,this.now(),s.controlHash)};
  }
  async validate(a:Record<string,unknown>){exact(a,['request']);const s=await this.snapshot();const e=this.evaluate(a.request,s);
    return {schema_version:1,eligible:e.decision.code==='ELIGIBLE',decision:e.decision,
      selection:e.request?selection(e.request):null,menu_sha256:s.menuHash,policy_sha256:s.policyHash};}
  status(id:Identity,a:Record<string,unknown>){
    exact(a,['request_message_id']);const key=idValue(a.request_message_id);
    const r=this.row('SELECT * FROM session_jobs WHERE request_message_id=?',key);
    if(!r||(id.peer==='robut'?r.sender!=='robut':!this.configuration().coordinator_keys.includes(id.key)))throw new RpcError(-32003,'Forbidden');
    return this.publicStatus(r);
  }
  private publicStatus(r:Row){
    const req=r.request_json?JSON.parse(String(r.request_json)) as SessionRequest:null;
    // A launch intent or uncertainty is explicitly not a claim of running work.
    const state=['launch_pending','submitted'].includes(String(r.state))?'accepted':r.state==='launch_uncertain'?'held':r.state;
    return {kind:'session_status',schema_version:1,request_message_id:r.request_message_id,job_id:r.id,status_seq:r.version,state,
      decision:JSON.parse(String(r.decision_json)),selection:req?selection(req):null,
      policy:{sha256:r.policy_hash,control_sha256:r.control_hash,epoch:r.activation_epoch,approval_receipt:r.approval_receipt,rule_id:r.rule_id},executor:r.executor_id?{kind:'codex_cloud',id:r.executor_id}:null,
      result:r.result_json?JSON.parse(String(r.result_json)):null,timestamp:new Date(Number(r.updated)).toISOString()};
  }
  private queue(r:Row){
    const status=this.publicStatus(r);const envelope:Envelope={protocol_version:'1.0',message_id:crypto.randomUUID(),
      correlation_id:String(r.correlation_id),from:'openai',to:'robut',type:'MSG',seq:Number(r.version),timestamp:new Date(this.now()).toISOString(),
      ttl:86400,payload:{content_type:'application/json',issue_id:r.request_json?JSON.parse(String(r.request_json)).linear_issue:null,body:JSON.stringify(status)}};
    this.sql.exec('INSERT INTO session_status_outbox(id,job_id,version,envelope,created) VALUES(?,?,?,?,?)',envelope.message_id,r.id,r.version,JSON.stringify(envelope),this.now());
  }
  private update(r:Row,state:string,d:Decision,patch:{fence?:string;executor_id?:string;result_json?:string}={}){
    this.sql.exec('UPDATE session_jobs SET state=?,version=version+1,updated=?,decision_json=?,fence=COALESCE(?,fence),executor_id=COALESCE(?,executor_id),result_json=COALESCE(?,result_json) WHERE id=?',
      state,this.now(),JSON.stringify(d),patch.fence??null,patch.executor_id??null,patch.result_json??null,r.id);
    if(TERMINAL.includes(state)||state==='held')this.sql.exec('DELETE FROM session_slot WHERE job_id=?',r.id);
    const next=this.row('SELECT * FROM session_jobs WHERE id=?',r.id)!;this.queue(next);return next;
  }
  async receive(id:Identity,a:Record<string,unknown>,lookup:(id:string)=>{envelope:Envelope;expires:number}|null){
    this.coordinator(id);exact(a,['request_message_id']);const key=idValue(a.request_message_id),m=lookup(key);
    if(!m||m.envelope.from!=='robut'||m.envelope.to!=='openai'||m.envelope.type!=='MSG')throw new RpcError(-32003,'Forbidden');
    const e=m.envelope;const s=await this.snapshot();
    // The mailbox accepts JSON metadata beyond the bounded request/JCS domain
    // (including fractional numbers). Hash its existing canonical envelope so
    // such metadata cannot prevent a durable validation/rejection decision.
    const fingerprint=await sha('commlink.session.envelope.v1\n'+mailboxCanonical(e));
    const evaluated=e.payload.content_type==='application/json'&&typeof e.payload.body==='string'?this.evaluate(e.payload.body,s):{request:null,decision:decision('INVALID_REQUEST'),rule:null};
    let d=evaluated.decision;const req=evaluated.request;
    if(m.expires<=this.now())d=decision('REQUEST_EXPIRED');
    else if(req&&e.payload.issue_id!==req.linear_issue)d=decision('INVALID_REQUEST',['linear_issue']);
    return this.transaction(()=>{
      this.current(s);this.coordinator(id);
      const old=this.row('SELECT * FROM session_jobs WHERE request_message_id=?',key);
      if(old){if(old.request_hash!==fingerprint)throw toolError('IDEMPOTENCY_CONFLICT');return this.publicStatus(old);}
      if(Number(this.row('SELECT COUNT(*) AS n FROM session_jobs')?.n)>=10000||
        Number(this.row('SELECT COUNT(*) AS n FROM session_jobs WHERE state NOT IN (\'rejected\',\'finished\',\'failed\')')?.n)>=1000||
        Number(this.row('SELECT COUNT(*) AS n FROM session_status_outbox WHERE sent IS NULL')?.n)>=1000)throw toolError('BACKLOG_LIMIT');
      let state='held';
      if(['INVALID_REQUEST','UNSUPPORTED_VERSION','UNKNOWN_ROLE','UNKNOWN_TIER'].includes(d.code))state='rejected';
      if(d.code==='ELIGIBLE'){
        if(this.row('SELECT job_id FROM session_slot WHERE id=1'))d=decision('BUSY',[],true,60);
        else if(this.rateExceeded(s))d=decision('RATE_LIMITED',[],true,3600);
        else {state='accepted';d=decision('ACCEPTED');}
      }
      const job=crypto.randomUUID();
      this.sql.exec('INSERT INTO session_jobs(id,request_message_id,sender,correlation_id,request_hash,request_json,state,version,created,updated,expires,decision_json,policy_hash,menu_hash,control_hash,activation_epoch,approval_receipt,rule_id) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)',
        job,key,'robut',e.correlation_id,fingerprint,req?JSON.stringify(req):null,state,this.now(),this.now(),m.expires,JSON.stringify(d),s.policyHash,s.menuHash,s.controlHash,s.config.activation?.epoch??null,s.config.activation?.receipt_id??null,evaluated.rule?.id??null);
      if(state==='accepted')this.sql.exec('INSERT INTO session_slot VALUES(1,?)',job);
      const row=this.row('SELECT * FROM session_jobs WHERE id=?',job)!;this.queue(row);return this.publicStatus(row);
    });
  }
  private rateExceeded(s:Snapshot){return Number(this.row('SELECT COUNT(*) AS n FROM session_launches WHERE attempted>?',this.now()-3600000)?.n)>=s.config.policy.limits.launches_per_rolling_hour;}
  async prepare(id:Identity,a:Record<string,unknown>){
    this.coordinator(id);exact(a,['request_message_id','expected_version']);const key=idValue(a.request_message_id),version=integer(a.expected_version,1,Number.MAX_SAFE_INTEGER);const s=await this.snapshot();
    return this.transaction(()=>{
      this.current(s);this.coordinator(id);const r=this.row('SELECT * FROM session_jobs WHERE request_message_id=?',key);
      if(!r||r.version!==version||r.state!=='accepted')throw toolError('STATE_CONFLICT');
      const req=JSON.parse(String(r.request_json)) as SessionRequest;
      const check=policyDecision(s.config,s.policyHash,req,this.now(),s.controlHash);
      let d=check.decision;
      if(Number(r.expires)<=this.now())d=decision('REQUEST_EXPIRED');
      else if(r.policy_hash!==s.policyHash||r.menu_hash!==s.menuHash||r.control_hash!==s.controlHash||
        (s.config.activation&&(r.activation_epoch!==s.config.activation.epoch||r.approval_receipt!==s.config.activation.receipt_id)))d=decision('POLICY_CHANGED');
      else if(this.rateExceeded(s))d=decision('RATE_LIMITED',[],true,3600);
      if(d.code!=='ELIGIBLE')return {status:this.publicStatus(this.update(r,'held',d)),launch:null};
      if(this.row('SELECT job_id FROM session_slot WHERE id=1')?.job_id!==r.id)throw toolError('STATE_CONFLICT');
      const completion=this.completions.ready(key,s.config.completion_owner_thread_id);
      const fence=crypto.randomUUID();this.sql.exec('INSERT INTO session_launches VALUES(?,?)',r.id,this.now());
      const next=this.update(r,'launch_pending',decision('LAUNCH_PENDING'),{fence});
      // This fenced intent is returned once only. A lost response must never be
      // retried into a second create_thread call, including after lease expiry.
      return {status:this.publicStatus(next),fence,launch:{target:{type:'codexCloud',environmentConfigId:s.config.profiles[req.environment].environment_config_id},
        model:selection(req).model,thinking:selection(req).effort,job:req.job,request_message_id:key,
        policy_sha256:s.policyHash,control_sha256:s.controlHash,policy_epoch:s.config.activation!.epoch,approval_receipt:s.config.activation!.receipt_id,menu_sha256:s.menuHash,time_budget:req.time_budget,completion:{...completion,job_id:r.id}}};
    });
  }
  transition(id:Identity,a:Record<string,unknown>){
    this.coordinator(id);exact(a,['request_message_id','expected_version','fence','event','executor_id','result','evidence'],['request_message_id','expected_version','fence','event']);
    const key=idValue(a.request_message_id),version=integer(a.expected_version,1,Number.MAX_SAFE_INTEGER),fence=idValue(a.fence),event=string(a.event,32);
    return this.transaction(()=>{
      this.coordinator(id);const r=this.row('SELECT * FROM session_jobs WHERE request_message_id=?',key);
      if(!r||r.version!==version||r.fence!==fence||!ACTIVE.includes(String(r.state)))throw toolError('STATE_CONFLICT');
      if(event==='uncertain'){
        if(r.state!=='launch_pending'||a.executor_id!==undefined||a.result!==undefined||a.evidence!==undefined)throw toolError('STATE_CONFLICT');
        return this.publicStatus(this.update(r,'launch_uncertain',decision('LAUNCH_UNCERTAIN')));
      }
      const evidence=object(a.evidence);exact(evidence,['source','state','turn_id'],['source','state']);
      if(typeof evidence.source!=='string'||!['create_thread','read_thread','wait_threads'].includes(evidence.source))throw toolError('EVIDENCE_REQUIRED');
      if(event==='failed'&&r.state==='launch_pending'&&evidence.source==='create_thread'&&evidence.state==='not_created'&&a.executor_id===undefined){
        const result=this.result(a.result,JSON.parse(String(r.request_json)) as SessionRequest);
        this.completions.resolve(key,'not_created','create_thread');
        return this.publicStatus(this.update(r,'failed',decision('EXECUTOR_FAILED'),{result_json:JSON.stringify(result)}));
      }
      if(event==='submitted'){
        if(r.state!=='launch_pending'||evidence.source!=='create_thread'||evidence.state!=='created'||a.result!==undefined)throw toolError('STATE_CONFLICT');
        const executor=string(a.executor_id,160);if(!/^[a-zA-Z0-9_-]+$/.test(executor))throw new RpcError(-32602,'Invalid executor identifier');
        this.completions.bindTask(key,executor);
        return this.publicStatus(this.update(r,'submitted',decision('SUBMITTED'),{executor_id:executor}));
      }
      if(a.executor_id!==r.executor_id||!r.executor_id||evidence.source==='create_thread')throw toolError('EVIDENCE_REQUIRED');
      if(event==='running'){
        if(r.state!=='submitted'||evidence.state!=='running'||a.result!==undefined)throw toolError('STATE_CONFLICT');
        this.completions.observe(key,{executor_id:a.executor_id,turn_id:evidence.turn_id,source:evidence.source,state:'running'});
        return this.publicStatus(this.update(r,'started',decision('STARTED')));
      }
      if(event==='finished'||event==='failed'){
        if(!['submitted','started'].includes(String(r.state))||evidence.state!==event)throw toolError('STATE_CONFLICT');
        const result=this.result(a.result,JSON.parse(String(r.request_json)) as SessionRequest);
        this.completions.assertTerminal(key,a.executor_id,evidence.turn_id);
        this.completions.resolve(key,event,evidence.source as string);
        return this.publicStatus(this.update(r,event,decision(event==='finished'?'FINISHED':'EXECUTOR_FAILED'),{result_json:JSON.stringify(result)}));
      }
      throw new RpcError(-32602,'Invalid session transition');
    });
  }
  completionRegister(id:Identity,a:Record<string,unknown>){
    this.coordinator(id);exact(a,['request_message_id','plan']);const key=idValue(a.request_message_id);
    return this.transaction(()=>{const r=this.row('SELECT * FROM session_jobs WHERE request_message_id=?',key);
      if(!r||r.state!=='accepted')throw toolError('STATE_CONFLICT');
      return this.completions.register({request_message_id:key,correlation_id:String(r.correlation_id),owner_key:id.key},a.plan,this.configuration().completion_owner_thread_id);});
  }
  completionBind(id:Identity,a:Record<string,unknown>){
    this.coordinator(id);exact(a,['request_message_id','executor_id','turn_id']);const key=idValue(a.request_message_id);
    return this.transaction(()=>this.completions.bindTurn(key,a.executor_id,a.turn_id));
  }
  completionSignal(id:Identity,a:Record<string,unknown>){
    this.coordinator(id);exact(a,['request_message_id','signal']);const key=idValue(a.request_message_id);
    return this.transaction(()=>this.completions.signal(key,a.signal));
  }
  completionRecovery(id:Identity,a:Record<string,unknown>){
    this.coordinator(id);exact(a,['limit'],[]);return this.completions.recovery(this.configuration().completion_owner_thread_id,integer(a.limit??20,1,50));
  }
  completionObserve(id:Identity,a:Record<string,unknown>){
    this.coordinator(id);exact(a,['request_message_id','observation']);const key=idValue(a.request_message_id);
    return this.transaction(()=>this.completions.observe(key,a.observation));
  }
  callbackOwner(id:Identity,a:Record<string,unknown>){
    exact(a,['owner_thread_id']);const c=this.configuration(),owner=c.completion_owner_thread_id;
    if(id.peer!=='openai'||!owner||a.owner_thread_id!==owner||(!c.coordinator_keys.includes(id.key)&&
      !(c.callback_jobs??[]).some(b=>b.owner_key===id.key&&b.owner_thread_id===owner&&b.expires_at>this.now())))throw new RpcError(-32003,'Forbidden');
    return owner;
  }
  callbackJob(key:string):JobBinding|null{
    const c=this.configuration(),fixed=(c.callback_jobs??[]).filter(b=>b.job_id===key);
    if(fixed.length>1)return null;
    if(fixed.length)return fixed[0].owner_thread_id===c.completion_owner_thread_id&&!this.row('SELECT id FROM session_jobs WHERE id=?',key)?fixed[0]:null;
    const r=this.row('SELECT j.*,s.owner_key AS callback_owner,s.owner_thread_id,s.plan_json,s.turn_id,s.resolved FROM session_jobs j JOIN session_completion s ON s.request_message_id=j.request_message_id WHERE j.id=?',key);
    if(!r||!['launch_pending','submitted','started','finished','failed'].includes(String(r.state))||r.owner_thread_id!==c.completion_owner_thread_id||!c.coordinator_keys.includes(String(r.callback_owner)))return null;
    const plan=JSON.parse(String(r.plan_json));if(plan.explicit_callback.mode!=='commlink_tool')return null;
    return {job_id:key,owner_key:String(r.callback_owner),reporter_key:String(r.callback_owner),owner_thread_id:String(r.owner_thread_id),correlation_id:String(r.correlation_id),
      request_message_id:String(r.request_message_id),executor_id:r.executor_id===null?null:String(r.executor_id),turn_id:r.turn_id===null?null:String(r.turn_id),
      expires_at:plan.recovery.expires_at,approval_ref:String(r.approval_receipt),reconciled:r.resolved!==null};
  }
  private result(value:unknown,req:SessionRequest):Result{
    const p=object(value);exact(p,['summary','checks','limitations','artifacts']);
    const list=(v:unknown)=>{if(!Array.isArray(v)||v.length>20)throw new RpcError(-32602,'Invalid public result');return v.map(x=>publicText(x,500));};
    if(!Array.isArray(p.artifacts)||p.artifacts.length>10)throw new RpcError(-32602,'Invalid public result');
    const prefixes=this.configuration().profiles[req.environment]?.artifact_prefixes??[];
    const artifacts=p.artifacts.map(v=>{const a=object(v);exact(a,['kind','url','sha256']);const url=string(a.url,1500);let u:URL;
      try{u=new URL(url);}catch{throw new RpcError(-32602,'Invalid artifact URL');}
      if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||url!==u.href||!prefixes.some(prefix=>prefix.endsWith('/')&&u.href.startsWith(prefix))||
        (a.sha256!==null&&(typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))))throw new RpcError(-32602,'Invalid artifact URL');
      return {kind:publicText(a.kind,40),url:u.href,sha256:a.sha256 as string|null};});
    const result={summary:publicText(p.summary,2000),checks:list(p.checks),limitations:list(p.limitations),artifacts};
    if(new TextEncoder().encode(JSON.stringify(result)).length>16384)throw new RpcError(-32602,'Public result too large');
    return result;
  }
  outbox(id:Identity,a:Record<string,unknown>){this.coordinator(id);exact(a,['limit'],[]);const limit=integer(a.limit??20,1,50);
    const cutoff=this.now()-86400000;
    return {messages:this.rows('SELECT envelope FROM session_status_outbox WHERE sent IS NULL AND created>? ORDER BY rowid LIMIT ?',cutoff,limit).map(r=>JSON.parse(String(r.envelope))),
      expired:this.rows('SELECT id,job_id,version FROM session_status_outbox WHERE sent IS NULL AND created<=? ORDER BY rowid LIMIT ?',cutoff,limit),
      expired_total:Number(this.row('SELECT COUNT(*) AS n FROM session_status_outbox WHERE sent IS NULL AND created<=?',cutoff)?.n??0)};}
  recovery(id:Identity,a:Record<string,unknown>){
    this.coordinator(id);exact(a,[]);
    // A restart may recover a fence/known ID, never another launch permit. Only
    // active reservations are returned; one slot bounds this list to one row.
    return {jobs:this.rows("SELECT * FROM session_jobs WHERE state IN ('accepted','launch_pending','submitted','started','launch_uncertain') ORDER BY created LIMIT 2").map(r=>({
      status:this.publicStatus(r),phase:r.state,fence:r.fence,policy_sha256:r.policy_hash,menu_sha256:r.menu_hash}))};
  }
  markSent(id:Identity,a:Record<string,unknown>,lookup:(id:string)=>Envelope|null){
    this.coordinator(id);exact(a,['message_id']);const mid=idValue(a.message_id);
    return this.transaction(()=>{const r=this.row('SELECT * FROM session_status_outbox WHERE id=?',mid);const stored=lookup(mid);
      if(!r||Number(r.created)+86400000<=this.now())throw toolError('STATUS_EXPIRED');
      if(!stored||mailboxCanonical(stored)!==mailboxCanonical(JSON.parse(String(r.envelope))))throw toolError('DELIVERY_NOT_RECORDED');
      this.sql.exec('UPDATE session_status_outbox SET sent=COALESCE(sent,?) WHERE id=?',this.now(),mid);return {status:'recorded'};});
  }
}
