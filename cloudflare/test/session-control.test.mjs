import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Miniflare,Log,LogLevel} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';

const code=await build({entryPoints:['src/session-control.ts','src/session-policy.ts','src/job-reports.ts'],bundle:true,platform:'node',format:'esm',outdir:'dist/session-unit',write:false});
const modules=await Promise.all(code.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));
const {SessionControl}=modules.find(m=>m.SessionControl);
const {JobReports}=modules.find(m=>m.JobReports);
const {menu,sessionDigest,sessionCanonical,controlDigest,parseSessionRequest,strictSessionJson,inactiveSessionConfiguration}=modules.find(m=>m.menu);
const dot={peer:'openai',key:'sub:dot'},other={peer:'openai',key:'sub:other'},robut={peer:'robut',key:'sub:robut'};
const BASE=2_000_000_000_000;
const ajv=new Ajv2020({strict:true,allErrors:true});
const schemas={};
for(const name of ['request','policy','status','capabilities'])schemas[name]=ajv.compile(JSON.parse(await readFile(new URL('../../session-control/schemas/'+name+'.v1.schema.json',import.meta.url),'utf8')));
function approvedFixture(){
  return {policy:{schema_version:1,policy_id:'synthetic-only',version:1,state:'active',subject:'robut',
    rules:Object.entries(menu.roles).map(([role,r])=>({id:role,roles:[role],tiers:Object.keys(menu.tiers),issues:['HUB-300'],environments:['test'],repositories:[],allow_repo_free:true,max_minutes:30,allow_soft:true,operation_profile:r.operation})),
    limits:{concurrent_sessions:1,launches_per_rolling_hour:2},on_unknown:'hold',confirmation_required:[...inactiveSessionConfiguration.policy.confirmation_required]},
    activation:null,paused:false,coordinator_keys:[dot.key],completion_owner_thread_id:'synthetic-owning-root',profiles:{test:{environment_config_id:'synthetic-environment',runnable:true,permissions_verified:true,completion_wake_verified:true,hard_timeout_verified:false,
      model_efforts:Object.values(menu.roles).flatMap(r=>Object.values(menu.tiers).map(e=>r.model+':'+e)),repository_revisions:[],allow_repo_free:true,operation_profiles:Object.values(menu.roles).map(r=>r.operation),artifact_prefixes:['https://github.com/example/approved/']}}};
}
const completionPlan=(now=BASE)=>({owner_thread_id:'synthetic-owning-root',explicit_callback:{mode:'thread_message',tool_name:'send_message_to_thread'},platform_push:'declared',
  recovery:{automation_id:'synthetic-root-schedule',owner_thread_id:'synthetic-owning-root',kind:'one_shot',due_at:now+60000,expires_at:now+300000,max_checks:1,cadence_seconds:null}});
async function fixture(t,{config=approvedFixture(),database,autoCompletion=true}={}){
  if(!database){const dir=await mkdtemp(join(tmpdir(),'commlink-session-unit-'));database=join(dir,'state.sqlite');t.after(()=>rm(dir,{recursive:true,force:true}));}
  let now=BASE;const messages=new Map();let db,control,reports;
  const start=()=>{db=new DatabaseSync(database);const sql={exec(q,...params){let rows=[];if(!params.length&&q.includes(';'))db.exec(q);else rows=db.prepare(q).all(...params);return {toArray:()=>rows};}};
    const transaction=f=>{db.exec('BEGIN IMMEDIATE');try{const x=f();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}};
    control=new SessionControl(sql,transaction,()=>config,'synthetic-channel',()=>now);
    reports=new JobReports(sql,transaction,key=>control.callbackJob(key),()=>now);};
  const approve=async()=>{config.activation={policy_sha256:await sessionDigest('commlink.policy.v1',config.policy),control_sha256:await controlDigest(config),owner_receipt_verified:true,receipt_id:'synthetic-owner-receipt',epoch:1,expires_at:BASE+86400000};};
  if(config.policy.state==='active')await approve();start();t.after(()=>db.close());
  const req=async(patch={})=>{const caps=await control.capabilities({});return {kind:'session_request',schema_version:1,menu_version:caps.menu_version,menu_sha256:caps.menu_sha256,expected_policy_sha256:caps.active_policy.sha256,
    role:'architect',tier:'extra',job:'Synthetic approved design only',linear_issue:'HUB-300',environment:'test',workdir:null,speed:'default',time_budget:{minutes:15,mode:'soft'},context_refs:[],...patch};};
  const put=async(patch={},options={})=>{const request=await req(patch);const e={protocol_version:'1.0',message_id:randomUUID(),correlation_id:randomUUID(),from:'robut',to:'openai',type:'MSG',seq:1,timestamp:new Date(now).toISOString(),ttl:300,
    payload:{content_type:'application/json',issue_id:'HUB-300',body:JSON.stringify(request)},...options};messages.set(e.message_id,{envelope:e,expires:now+300000});return e;};
  const receive=async e=>{const s=await control.receive(dot,{request_message_id:e.message_id},id=>messages.get(id)??null);
    if(autoCompletion&&s.state==='accepted')control.completionRegister(dot,{request_message_id:e.message_id,plan:completionPlan(now)});return s;};
  const prepare=s=>control.prepare(dot,{request_message_id:s.request_message_id,expected_version:s.status_seq});
  const transition=(s,fence,event,extra={})=>{if(['running','finished','failed'].includes(event)&&extra.executor_id)extra={...extra,evidence:{turn_id:'synthetic-turn',...extra.evidence}};
    const next=control.transition(dot,{request_message_id:s.request_message_id,expected_version:s.status_seq,fence,event,...extra});
    if(event==='submitted')control.completionBind(dot,{request_message_id:s.request_message_id,executor_id:extra.executor_id,turn_id:'synthetic-turn'});return next;};
  return {get control(){return control;},get reports(){return reports;},config,approve,req,put,receive,prepare,transition,messages,advance:ms=>{now+=ms;},
    seedJobWatch:()=>db.prepare('INSERT INTO job_subscriptions(id,owner,peer,owner_thread_id,url,secret,expires,verified) VALUES(?,?,?,?,?,?,?,?)').run('synthetic-job-watch',dot.key,'openai','synthetic-owning-root','https://callback.example/root','synthetic',BASE+3600000,BASE),
    restart:()=>{db.close();start();},get rows(){return db.prepare('SELECT * FROM session_jobs').all();}};
}
const result={summary:'Synthetic design completed',checks:['Compared boundaries'],limitations:[],artifacts:[]};
const signalFor=(e,executor,source='explicit_child')=>({event_id:randomUUID(),source,owner_thread_id:'synthetic-owning-root',executor_id:executor,correlation_id:e.correlation_id,
  sender_thread_id:source==='explicit_child'?executor:null,automation_id:source==='scheduled_recovery'?'synthetic-root-schedule':null});
async function finish(f,s){const p=await f.prepare(s);assert.ok(p.launch);const executor='synthetic-thread-'+s.request_message_id;let next=f.transition(p.status,p.fence,'submitted',{executor_id:executor,evidence:{source:'create_thread',state:'created'}});
  next=f.transition(next,p.fence,'running',{executor_id:executor,evidence:{source:'read_thread',state:'running'}});
  return f.transition(next,p.fence,'finished',{executor_id:executor,evidence:{source:'wait_threads',state:'finished'},result});}

test('roles/tiers and domain-separated canonical digests have stable mappings',async()=>{
  assert.equal(menu.roles.architect.model,'gpt-6-astra');assert.equal(menu.roles.coder.model,'gpt-6.1-sol');assert.equal(menu.tiers.extra,'xhigh');
  assert.equal(sessionCanonical({b:1,a:'é'}),'{"a":"é","b":1}');
  assert.equal(await sessionDigest('domain',{b:1,a:2}),createHash('sha256').update('domain\n{"a":2,"b":1}').digest('hex'));
  assert.notEqual(await sessionDigest('a',{}),await sessionDigest('b',{}));
  assert.throws(()=>sessionCanonical('\ud800'));assert.throws(()=>sessionCanonical(1.1));
});
test('independent JSON Schema contracts cover requests, shipped policy, capability and lifecycle receipts',async t=>{
  const f=await fixture(t);const req=await f.req();
  assert.ok(schemas.request(req),JSON.stringify(schemas.request.errors));
  assert.ok(schemas.policy(inactiveSessionConfiguration.policy),JSON.stringify(schemas.policy.errors));
  assert.ok(schemas.policy(f.config.policy),JSON.stringify(schemas.policy.errors));
  assert.ok(schemas.capabilities(await f.control.capabilities({})),JSON.stringify(schemas.capabilities.errors));
  let s=await f.receive(await f.put());assert.ok(schemas.status(s),JSON.stringify(schemas.status.errors));
  s=await finish(f,s);assert.ok(schemas.status(s),JSON.stringify(schemas.status.errors));
  for(const patch of [{role:'admin'},{tier:'ultra'},{speed:'fast'},{workdir:'/private'},{schema_version:2},{time_budget:{minutes:0,mode:'soft'}},{activation:true}])assert.equal(schemas.request({...req,...patch}),false);
  assert.equal(schemas.status({...s,state:'started',executor:null}),false);
  const golden=JSON.parse(await readFile(new URL('../../session-control/fixtures/request.v1.json',import.meta.url),'utf8'));
  assert.ok(schemas.request(golden));assert.equal(golden.menu_sha256,await sessionDigest('commlink.menu.v1',menu));
  assert.equal(golden.expected_policy_sha256,await sessionDigest('commlink.policy.v1',inactiveSessionConfiguration.policy));
});
test('strict parsing rejects duplicates, alias keys, depth, Unicode and unsupported controls without echo',async t=>{
  const f=await fixture(t);const r=await f.req();
  for(const input of ['{"job":"one","j\\u006fb":"two"}',JSON.stringify({nested:{x:1}}).replace('"x":1','"x":1,"x":2'),'['.repeat(17)+'0'+']'.repeat(17)])assert.throws(()=>strictSessionJson(input));
  assert.deepEqual(strictSessionJson('{"x":[{"a":1},{"a":2}]}'),{x:[{a:1},{a:2}]});
  for(const patch of [{speed:'fast'},{workdir:'/tmp'},{tier:'ultra'},{role:'admin'},{schema_version:2},{job:'\ud800'},{job:'x'.repeat(4097)},{activation:{approved:true}},{time_budget:{minutes:1.2,mode:'soft'}},{time_budget:{minutes:5,mode:['hard']}},{time_budget:{minutes:5,mode:['soft']}},{context_refs:['https://secret.invalid/?token=synthetic']}]){
    const v=await f.control.validate({request:{...r,...patch}});assert.equal(v.eligible,false);assert.ok(!JSON.stringify(v.decision).includes('synthetic'));
  }
  const {tier,...withoutTier}=r;assert.equal(parseSessionRequest(withoutTier).tier,'deep');
  assert.throws(()=>parseSessionRequest({...r,repository:{name:'example/approved',revision:'main'}}));
});
test('shipped source is inactive, paused, has no coordinator or executor and no activation route',async t=>{
  const f=await fixture(t,{config:structuredClone(inactiveSessionConfiguration)});const caps=await f.control.capabilities({});
  assert.equal(caps.active_policy.state,'inactive');assert.equal(caps.active_policy.owner_approval_verified,false);assert.equal(caps.coordinator_configured,false);assert.deepEqual(caps.environments,[]);
  const v=await f.control.validate({request:await f.req()});assert.equal(v.decision.code,'POLICY_NOT_ACTIVE');
  await assert.rejects(f.receive(await f.put()),/Forbidden/);assert.equal(f.rows.length,0);
});
test('admission checks source policy, owner proof, scope, model/effort and enforceable profiles',async t=>{
  for(const [name,mutate,expected] of [
    ['no owner proof',c=>c.activation.owner_receipt_verified=false,'POLICY_NOT_ACTIVE'],
    ['expired approval',c=>c.activation.expires_at=BASE,'POLICY_NOT_ACTIVE'],
    ['fake hash',c=>c.activation.policy_sha256='0'.repeat(64),'POLICY_NOT_ACTIVE'],
    ['pause',c=>c.paused=true,'ADMISSIONS_PAUSED'],
    ['scope',c=>c.policy.rules=[],'POLICY_NOT_ACTIVE'],
    ['profile',c=>c.profiles.test.permissions_verified=false,'EXECUTOR_UNVERIFIED'],
    ['completion',c=>c.profiles.test.completion_wake_verified=false,'EXECUTOR_UNVERIFIED'],
    ['models',c=>c.profiles.test.model_efforts=[],'EXECUTOR_UNVERIFIED']
  ])await t.test(name,async t=>{const f=await fixture(t);mutate(f.config);if(['profile','completion','models'].includes(name))await f.approve();assert.equal((await f.control.validate({request:await f.req()})).decision.code,expected);});
  const f=await fixture(t);
  assert.equal((await f.control.validate({request:await f.req({time_budget:{minutes:5,mode:'hard'}})})).decision.code,'UNSUPPORTED_CONTROL');
  assert.equal((await f.control.validate({request:await f.req({context_refs:['linear:HUB-301']})})).decision.code,'OUT_OF_SCOPE');
  for(const role of Object.keys(menu.roles))for(const tier of Object.keys(menu.tiers))assert.equal((await f.control.validate({request:await f.req({role,tier})})).eligible,true);
});
test('actual-message admission dedupes across restart; no fake sender, stale menu or changed body',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'commlink-session-'));t.after(()=>rm(dir,{recursive:true,force:true}));const f=await fixture(t,{database:join(dir,'state.sqlite')});
  const e=await f.put();const first=await f.receive(e);assert.equal(first.state,'accepted');f.restart();assert.deepEqual(await f.receive(e),first);assert.equal(f.rows.length,1);
  f.messages.get(e.message_id).envelope.payload.body=JSON.stringify(await f.req({job:'changed'}));await assert.rejects(f.receive(e),e=>e.data.reason==='IDEMPOTENCY_CONFLICT');
  await assert.rejects(f.control.receive(robut,{request_message_id:e.message_id},()=>f.messages.get(e.message_id)),/Forbidden/);
  await assert.rejects(f.control.receive(other,{request_message_id:e.message_id},()=>f.messages.get(e.message_id)),/Forbidden/);
  const wrong=await f.put({}, {from:'openai'});await assert.rejects(f.receive(wrong),/Forbidden/);
  const stale=await f.put({menu_sha256:'0'.repeat(64)});assert.equal((await f.receive(stale)).decision.code,'STALE_CAPABILITIES');
  const mismatch=await f.put();mismatch.payload.issue_id='HUB-301';assert.equal((await f.receive(mismatch)).state,'rejected');
});
test('mailbox-valid fractional metadata is fingerprinted without losing durable admission',async t=>{
  const f=await fixture(t);const e=await f.put();e.payload.progress=0.5;e.payload.metadata={fraction:1.25,other:null};
  const s=await f.receive(e);assert.equal(s.state,'accepted');f.restart();assert.deepEqual(await f.receive(e),s);
  const invalid=await f.put({tier:'unknown'});invalid.payload.progress=0.5;
  assert.equal((await f.receive(invalid)).state,'rejected');assert.equal(f.control.outbox(dot,{}).messages.length,2);
});
test('one slot wins a race; intent is one-shot and uncertain launch retains slot forever',async t=>{
  const f=await fixture(t);const es=await Promise.all(Array.from({length:6},()=>f.put()));const states=await Promise.all(es.map(f.receive));
  assert.equal(states.filter(x=>x.state==='accepted').length,1);assert.equal(states.filter(x=>x.decision.code==='BUSY').length,5);
  const s=states.find(x=>x.state==='accepted');const p=await f.prepare(s);assert.ok(p.launch);assert.equal(p.launch.model,'gpt-6-astra');assert.equal(p.launch.thinking,'xhigh');assert.ok(!('speed' in p.launch));
  await assert.rejects(f.prepare(s),e=>e.data.reason==='STATE_CONFLICT');
  f.restart();const recovered=f.control.recovery(dot,{}).jobs[0];assert.equal(recovered.fence,p.fence);assert.equal(recovered.phase,'launch_pending');assert.ok(!('launch' in recovered));
  const uncertain=f.transition(p.status,p.fence,'uncertain');assert.equal(uncertain.state,'held');assert.equal(uncertain.decision.code,'LAUNCH_UNCERTAIN');
  f.restart();f.advance(86400001);await f.approve();f.config.activation.expires_at=BASE+172800000;
  assert.equal((await f.receive(await f.put())).decision.code,'BUSY');
});
test('definitive creation failure releases the slot, but a timeout can only be uncertain',async t=>{
  const f=await fixture(t);const p=await f.prepare(await f.receive(await f.put()));
  assert.throws(()=>f.transition(p.status,p.fence,'failed',{evidence:{source:'create_thread',state:'timeout'},result}));
  const end=f.transition(p.status,p.fence,'failed',{evidence:{source:'create_thread',state:'not_created'},result});assert.equal(end.state,'failed');
  assert.equal((await f.receive(await f.put())).state,'accepted');
});
test('policy revocation, mutation and request expiry between admission and launch issue no permit',async t=>{
  for(const mode of ['revoke','change','expire'])await t.test(mode,async t=>{
    const f=await fixture(t);const s=await f.receive(await f.put());
    if(mode==='revoke')f.config.activation=null;
    if(mode==='change'){f.config.policy.version++;await f.approve();}
    if(mode==='expire')f.advance(300001);
    const p=await f.prepare(s);assert.equal(p.launch,null);assert.equal(p.status.state,'held');
  });
});
test('same policy under a new activation epoch or retargeted profile cannot reuse admission',async t=>{
  for(const mode of ['epoch','receipt','profile'])await t.test(mode,async t=>{
    const f=await fixture(t);const s=await f.receive(await f.put());const original=s.policy;
    if(mode==='epoch')f.config.activation.epoch++;
    if(mode==='receipt')f.config.activation.receipt_id='synthetic-reapproval';
    if(mode==='profile'){f.config.profiles.test.environment_config_id='different-synthetic-target';await f.approve();}
    const p=await f.prepare(s);assert.equal(p.launch,null);assert.equal(p.status.decision.code,'POLICY_CHANGED');
    assert.equal(p.status.policy.epoch,original.epoch);assert.equal(p.status.policy.control_sha256,original.control_sha256);
  });
  const f=await fixture(t);f.config.profiles.test.environment_config_id='unapproved-target';
  assert.equal((await f.control.validate({request:await f.req()})).decision.code,'POLICY_NOT_ACTIVE');
  assert.equal((await f.control.capabilities({})).active_policy.owner_approval_verified,false);
});
test('rolling-hour launch budget survives restart; terminal jobs release the active slot',async t=>{
  const f=await fixture(t);for(let n=0;n<2;n++){assert.equal((await finish(f,await f.receive(await f.put()))).state,'finished');}
  f.restart();assert.equal((await f.receive(await f.put())).decision.code,'RATE_LIMITED');
  f.advance(3600001);assert.equal((await f.receive(await f.put())).state,'accepted');
});
test('provider observations, IDs, fence/version and result allowlists cannot be skipped',async t=>{
  const f=await fixture(t);const p=await f.prepare(await f.receive(await f.put()));
  assert.throws(()=>f.transition(p.status,p.fence,'finished',{result}),e=>e.data?.reason==='STATE_CONFLICT'||e.code===-32602);
  assert.throws(()=>f.transition(p.status,randomUUID(),'submitted',{executor_id:'x',evidence:{source:'create_thread',state:'created'}}),e=>e.data.reason==='STATE_CONFLICT');
  let s=f.transition(p.status,p.fence,'submitted',{executor_id:'thread-1',evidence:{source:'create_thread',state:'created'}});assert.equal(s.state,'accepted');
  assert.throws(()=>f.transition(s,p.fence,'running',{executor_id:'thread-1',evidence:{source:['read_thread'],state:'running'}}));
  const done=r=>f.transition(s,p.fence,'finished',{executor_id:'thread-1',evidence:{source:'read_thread',state:'finished'},result:r});
  for(const url of ['https://evil.invalid/x','https://github.com/example/approved-evil/x','https://github.com/example/approved/%2e%2e/private/x','https://github.com/example/approved/x?token=synthetic'])assert.throws(()=>done({...result,artifacts:[{kind:'report',url,sha256:null}]}));
  assert.throws(()=>done({...result,summary:'Bearer SYNTHETIC_SECRET'}));
  assert.throws(()=>done({...result,summary:'\ud800'}));
  assert.throws(()=>done({...result,checks:Array(20).fill('x'.repeat(500)),limitations:Array(20).fill('x'.repeat(500))}),/Public result too large/);
  s=done({...result,artifacts:[{kind:'report',url:'https://github.com/example/approved/pull/1',sha256:null}]});assert.equal(s.state,'finished');
  assert.throws(()=>f.transition(s,p.fence,'running',{executor_id:'thread-1',evidence:{source:'read_thread',state:'running'}}));
});
test('status and durable outbox are principal-scoped; marking sent requires exact mailbox acceptance',async t=>{
  const f=await fixture(t);const s=await f.receive(await f.put());
  assert.equal(f.control.status(robut,{request_message_id:s.request_message_id}).job_id,s.job_id);
  assert.throws(()=>f.control.status(other,{request_message_id:s.request_message_id}),/Forbidden/);
  assert.throws(()=>f.control.outbox(robut,{}),/Forbidden/);
  const envelopes=f.control.outbox(dot,{}).messages;assert.equal(envelopes.length,1);const e=envelopes[0];
  assert.equal(e.correlation_id,f.messages.get(s.request_message_id).envelope.correlation_id);
  assert.throws(()=>f.control.markSent(dot,{message_id:e.message_id},()=>null));
  assert.throws(()=>f.control.markSent(dot,{message_id:e.message_id},()=>({...e,seq:99})));
  f.restart();assert.deepEqual(f.control.outbox(dot,{}).messages,envelopes);
  assert.equal(f.control.markSent(dot,{message_id:e.message_id},()=>e).status,'recorded');assert.equal(f.control.outbox(dot,{}).messages.length,0);
});
test('expired lifecycle envelopes are reported but never offered for new delivery or marked sent',async t=>{
  const f=await fixture(t);await f.receive(await f.put());const e=f.control.outbox(dot,{}).messages[0];f.advance(86400000);
  const out=f.control.outbox(dot,{});assert.equal(out.messages.length,0);assert.equal(out.expired_total,1);assert.equal(out.expired[0].id,e.message_id);
  assert.throws(()=>f.control.markSent(dot,{message_id:e.message_id},()=>e),e=>e.data.reason==='STATUS_EXPIRED');
});
test('real deployed Worker surface stays default-deny and cannot accept an activation injection',async t=>{
  const mf=new Miniflare({modules:true,scriptPath:'dist/worker.js',compatibilityDate:'2026-07-30',log:new Log(LogLevel.WARN),
    durableObjects:{MAILBOX:{className:'Mailbox',useSQLite:true}},bindings:{CHANNEL_ID:'session-default',IDENTITIES_JSON:JSON.stringify({'sub:dot':'openai','sub:robut':'robut'})},outboundService:()=>{assert.fail('no external request allowed');}});
  t.after(()=>mf.dispose());await mf.ready;const ns=await mf.getDurableObjectNamespace('MAILBOX'),stub=ns.get(ns.idFromName('session-default'));
  const call=async(id,name,args={})=>(await stub.rpc(id,'tools/call',{name,arguments:args})).result;
  const caps=(await call(robut,'session_capabilities')).structuredContent;assert.equal(caps.active_policy.state,'inactive');
  assert.equal((await call(dot,'session_receive',{request_message_id:randomUUID()})).isError,true);
  assert.equal((await call(dot,'session_capabilities',{activation:{approved:true}})).isError,true);
  for(const name of ['session_completion_register','session_completion_bind','session_completion_signal','session_completion_observe','session_completion_recovery'])assert.equal((await call(dot,name,{})).isError,true);
  const tools=(await stub.rpc(dot,'tools/list',{})).result.tools;assert.ok(tools.some(x=>x.name==='session_validate'));assert.ok(!tools.some(x=>/activate|revoke|cancel/.test(x.name)));
});

test('launch requires a verified owner and a future bounded root schedule; registration cannot renew it',async t=>{
  const f=await fixture(t,{autoCompletion:false});const e=await f.put(),s=await f.receive(e),args={request_message_id:e.message_id,plan:completionPlan()};
  await assert.rejects(f.prepare(s),x=>x.data.reason==='COMPLETION_CONTRACT_REQUIRED');
  assert.throws(()=>f.control.completionRegister(other,args),/Forbidden/);assert.throws(()=>f.control.completionRegister(robut,args),/Forbidden/);
  for(const plan of [{...completionPlan(),owner_thread_id:'worker-thread'}, {...completionPlan(),recovery:{...completionPlan().recovery,owner_thread_id:'worker-thread'}},
    {...completionPlan(),recovery:{...completionPlan().recovery,max_checks:2}}, {...completionPlan(),recovery:{...completionPlan().recovery,kind:'recurring',cadence_seconds:60}}])assert.throws(()=>f.control.completionRegister(dot,{...args,plan}));
  const saved=f.control.completionRegister(dot,args);f.restart();assert.deepEqual(f.control.completionRegister(dot,{...args,plan:{...args.plan,recovery:{...args.plan.recovery}}}),saved);
  assert.throws(()=>f.control.completionRegister(dot,{...args,plan:{...args.plan,platform_push:'unavailable'}}),x=>x.data.reason==='COMPLETION_CONFLICT');
  f.advance(60000);assert.equal(f.control.completionRegister(dot,args).recovery.next_due,BASE+60000);
  await assert.rejects(f.prepare(s),x=>x.data.reason==='RECOVERY_NOT_READY');
  f.control.completionSignal(dot,{request_message_id:e.message_id,signal:signalFor(e,null,'scheduled_recovery')});
  await assert.rejects(f.prepare(s),x=>x.data.reason==='RECOVERY_NOT_READY','a one-shot consumed before launch is no longer recovery coverage');
  assert.equal(f.control.recovery(dot,{}).jobs[0].phase,'accepted');
});

test('explicit and platform hints dedupe across restart and never constitute terminal evidence',async t=>{
  const f=await fixture(t);const e=await f.put(),p=await f.prepare(await f.receive(e));
  assert.equal(p.launch.completion.owner_thread_id,'synthetic-owning-root');assert.equal(p.launch.completion.hint.correlation_id,e.correlation_id);
  const early=signalFor(e,'child-one');assert.throws(()=>f.control.completionSignal(dot,{request_message_id:e.message_id,signal:early}),x=>x.data.reason==='SIGNAL_BINDING_MISMATCH');
  let s=f.transition(p.status,p.fence,'submitted',{executor_id:'child-one',evidence:{source:'create_thread',state:'created'}});
  const count=f.control.outbox(dot,{}).messages.length;
  for(const patch of [{owner_thread_id:'other-root'},{correlation_id:randomUUID()},{sender_thread_id:'other-child'},{executor_id:'other-child'}])assert.throws(()=>f.control.completionSignal(dot,{request_message_id:e.message_id,signal:{...early,...patch}}));
  assert.equal(f.control.completionSignal(dot,{request_message_id:e.message_id,signal:early}).duplicate,false);
  f.restart();assert.equal(f.control.completionSignal(dot,{request_message_id:e.message_id,signal:early}).duplicate,true);
  assert.equal(f.control.completionRecovery(dot,{}).contracts[0].action,'reconcile_provider');
  assert.equal(f.control.status(robut,{request_message_id:e.message_id}).state,'accepted');assert.equal(f.control.outbox(dot,{}).messages.length,count);
  const platform=signalFor(e,'child-one','platform_push');f.control.completionSignal(dot,{request_message_id:e.message_id,signal:platform});
  assert.throws(()=>f.control.completionSignal(dot,{request_message_id:e.message_id,signal:{...platform,event_id:early.event_id}}),x=>x.data.reason==='SIGNAL_CONFLICT');
  assert.throws(()=>f.transition(s,p.fence,'finished',{executor_id:'child-one',evidence:{source:'explicit_child',state:'finished'},result}),x=>x.data.reason==='EVIDENCE_REQUIRED');
  assert.throws(()=>f.transition(s,p.fence,'finished',{executor_id:'child-one',evidence:{source:'read_thread',state:'finished',turn_id:'wrong-turn'},result}),x=>x.data.reason==='TERMINAL_BINDING_MISMATCH');
  s=f.transition(s,p.fence,'finished',{executor_id:'child-one',evidence:{source:'read_thread',state:'finished'},result});
  const terminal=f.control.outbox(dot,{}).messages.filter(m=>JSON.parse(m.payload.body).state==='finished');assert.equal(terminal.length,1);
  f.control.completionSignal(dot,{request_message_id:e.message_id,signal:signalFor(e,'child-one','platform_push')});f.restart();
  const recovered=f.control.completionRecovery(dot,{}).contracts[0];assert.equal(recovered.action,'none');assert.equal(recovered.executor_id,'child-one');assert.equal(recovered.turn_id,'synthetic-turn');
  assert.equal(recovered.terminal.source,'read_thread');assert.deepEqual(f.control.outbox(dot,{}).messages.filter(m=>JSON.parse(m.payload.body).state==='finished'),terminal);
});

test('missing callback uses root-bound bounded recovery; exhausted or failed lookups never relaunch',async t=>{
  const f=await fixture(t,{autoCompletion:false}),e=await f.put(),s=await f.receive(e);const plan=completionPlan();plan.explicit_callback={mode:'unavailable',tool_name:null};
  f.control.completionRegister(dot,{request_message_id:e.message_id,plan});const p=await f.prepare(s);
  const next=f.transition(p.status,p.fence,'submitted',{executor_id:'quiet-child',evidence:{source:'create_thread',state:'created'}});
  assert.throws(()=>f.control.completionSignal(dot,{request_message_id:e.message_id,signal:signalFor(e,'quiet-child')}));
  const sig=signalFor(e,'quiet-child','scheduled_recovery');
  assert.throws(()=>f.control.completionSignal(dot,{request_message_id:e.message_id,signal:sig}),x=>x.data.reason==='RECOVERY_NOT_DUE');
  f.advance(60000);assert.throws(()=>f.control.completionSignal(dot,{request_message_id:e.message_id,signal:{...sig,automation_id:'worker-schedule'}}));
  assert.equal(f.control.completionSignal(dot,{request_message_id:e.message_id,signal:sig}).completion.action,'reconcile_provider');
  f.restart();assert.equal(f.control.completionSignal(dot,{request_message_id:e.message_id,signal:sig}).duplicate,true);
  assert.throws(()=>f.control.completionSignal(dot,{request_message_id:e.message_id,signal:{...sig,event_id:randomUUID()}}),x=>x.data.reason==='RECOVERY_EXHAUSTED');
  for(const patch of [{source:['read_thread']},{state:['unknown']}])assert.throws(()=>f.control.completionObserve(dot,{request_message_id:e.message_id,observation:{executor_id:'quiet-child',turn_id:'synthetic-turn',source:'read_thread',state:'unknown',...patch}}),x=>x.code===-32602);
  const observed=f.control.completionObserve(dot,{request_message_id:e.message_id,observation:{executor_id:'quiet-child',turn_id:'synthetic-turn',source:'read_thread',state:'unknown'}});
  assert.equal(observed.action,'attention');assert.equal(observed.recovery.checks_used,1);
  assert.equal(f.control.recovery(dot,{}).jobs[0].phase,'submitted');await assert.rejects(f.prepare(next),x=>x.data.reason==='STATE_CONFLICT');
  f.advance(86400001);f.restart();assert.equal(f.control.completionRecovery(dot,{}).contracts[0].action,'attention');
});

test('root recovery covers an ambiguous creation without inventing a task ID or releasing the slot',async t=>{
  const f=await fixture(t),e=await f.put(),p=await f.prepare(await f.receive(e));f.transition(p.status,p.fence,'uncertain');
  f.advance(60000);const got=f.control.completionSignal(dot,{request_message_id:e.message_id,signal:signalFor(e,null,'scheduled_recovery')});
  assert.equal(got.completion.action,'reconcile_launch');assert.equal(got.completion.executor_id,null);f.restart();
  assert.equal(f.control.recovery(dot,{}).jobs[0].phase,'launch_uncertain');assert.equal((await f.receive(await f.put())).decision.code,'BUSY');
});

test('recurring recovery consumes finite hourly checks and provider failure produces only one terminal report',async t=>{
  const f=await fixture(t,{autoCompletion:false}),e=await f.put(),s=await f.receive(e),plan=completionPlan();
  plan.recovery={...plan.recovery,kind:'recurring',cadence_seconds:3600,max_checks:2,expires_at:BASE+7200000};
  f.control.completionRegister(dot,{request_message_id:e.message_id,plan});const p=await f.prepare(s);
  let next=f.transition(p.status,p.fence,'submitted',{executor_id:'failing-child',evidence:{source:'create_thread',state:'created'}});
  assert.throws(()=>f.control.completionBind(dot,{request_message_id:e.message_id,executor_id:'failing-child',turn_id:'different-turn'}),x=>x.data.reason==='TURN_CONFLICT');
  f.advance(90000);const first=f.control.completionSignal(dot,{request_message_id:e.message_id,signal:signalFor(e,'failing-child','scheduled_recovery')});
  assert.equal(first.completion.recovery.next_due,BASE+3660000,'late processing must not shift the next saved occurrence');
  const observation={executor_id:'failing-child',turn_id:'synthetic-turn',source:'wait_threads',state:'running'};
  assert.equal(f.control.completionObserve(dot,{request_message_id:e.message_id,observation:{...observation,state:'unknown'}}).action,'attention');
  f.restart();assert.equal(f.control.completionRecovery(dot,{}).contracts[0].action,'attention');
  assert.equal(f.control.completionObserve(dot,{request_message_id:e.message_id,observation}).action,'await_signal');
  f.advance(3570000);const sig=signalFor(e,'failing-child','scheduled_recovery');f.control.completionSignal(dot,{request_message_id:e.message_id,signal:sig});
  next=f.transition(next,p.fence,'failed',{executor_id:'failing-child',evidence:{source:'wait_threads',state:'failed'},result:{...result,summary:'Synthetic provider failure'}});
  assert.equal(next.state,'failed');f.restart();assert.equal(f.control.completionRecovery(dot,{}).contracts[0].terminal.state,'failed');
  assert.equal(f.control.completionSignal(dot,{request_message_id:e.message_id,signal:sig}).duplicate,true);
  assert.equal(f.control.outbox(dot,{}).messages.filter(m=>JSON.parse(m.payload.body).state==='failed').length,1);assert.equal(f.control.recovery(dot,{}).jobs.length,0);
});

test('CommLink callback contract requires its root watch and binds early hints to the actual task/turn without completing the job',async t=>{
  const f=await fixture(t,{autoCompletion:false}),e=await f.put(),s=await f.receive(e),plan=completionPlan();
  plan.explicit_callback={mode:'commlink_tool',tool_name:'job_report_status'};
  f.control.completionRegister(dot,{request_message_id:e.message_id,plan});
  await assert.rejects(f.prepare(s),x=>x.data.reason==='COMMLINK_WATCH_NOT_READY');
  f.seedJobWatch();const p=await f.prepare(s);assert.equal(p.launch.completion.job_id,s.job_id);
  assert.equal(f.control.callbackJob(s.job_id).executor_id,null);
  const receipt=f.reports.report(dot,{job_id:s.job_id,status:'finished'});assert.equal(receipt.delivery,'pending_binding_or_subscription');
  const next=f.transition(p.status,p.fence,'submitted',{executor_id:'callback-task',evidence:{source:'create_thread',state:'created'}});
  f.reports.refreshRequest(e.message_id);let delivered;
  await f.reports.run(async(sub,event,body)=>{delivered=JSON.parse(body);return new Response(null,{status:200});},()=>true);
  assert.equal(delivered.data.executor_id,'callback-task');assert.equal(delivered.data.turn_id,'synthetic-turn');
  const sig={...signalFor(e,'callback-task'),source:'commlink_hint',sender_thread_id:null,event_id:receipt.event_id};
  assert.throws(()=>f.control.completionSignal(dot,{request_message_id:e.message_id,signal:{...sig,event_id:'invented-hint'}}),x=>x.data.reason==='SIGNAL_BINDING_MISMATCH');
  assert.equal(f.control.completionSignal(dot,{request_message_id:e.message_id,signal:sig}).completion.action,'reconcile_provider');
  assert.equal(f.control.status(robut,{request_message_id:e.message_id}).state,'accepted');
  const terminal=f.transition(next,p.fence,'finished',{executor_id:'callback-task',evidence:{source:'read_thread',state:'finished'},result});
  assert.equal(terminal.state,'finished');f.restart();assert.equal(f.reports.report(dot,{job_id:s.job_id,status:'finished'}).status,'duplicate');
  assert.equal(f.control.completionRecovery(dot,{}).contracts[0].action,'none');
  assert.equal(f.control.outbox(dot,{}).messages.filter(m=>JSON.parse(m.payload.body).state==='finished').length,1);
});

test('upgrades completion databases without assigning authority to legacy contracts',async t=>{
  for(const legacy of [false,true])await t.test(legacy?'existing contract retained without owner grant':'empty legacy table accepts fresh bound contracts',async t=>{
    const dir=await mkdtemp(join(tmpdir(),'completion-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));const database=join(dir,'state.sqlite');
    const db=new DatabaseSync(database),key=randomUUID(),plan=completionPlan();
    // Schema shipped by the previous source commit, before owner_key existed.
    db.exec(`CREATE TABLE session_completion(request_message_id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL,owner_thread_id TEXT NOT NULL,plan_json TEXT NOT NULL,
      executor_id TEXT UNIQUE,turn_id TEXT,checks_used INTEGER NOT NULL DEFAULT 0,next_due INTEGER NOT NULL,terminal_state TEXT,terminal_source TEXT,resolved INTEGER,
      observed_signal_count INTEGER NOT NULL DEFAULT 0,last_observed INTEGER,observed_state TEXT);`);
    if(legacy)db.prepare('INSERT INTO session_completion(request_message_id,correlation_id,owner_thread_id,plan_json,next_due) VALUES(?,?,?,?,?)').run(key,randomUUID(),'synthetic-owning-root',JSON.stringify(plan),BASE+60000);
    db.close();const f=await fixture(t,{database,autoCompletion:false});
    const e=await f.put({},legacy?{message_id:key}:{}),s=await f.receive(e);
    if(legacy){
      assert.equal(f.control.completionRecovery(dot,{}).contracts.length,1);
      assert.throws(()=>f.control.completionRegister(dot,{request_message_id:e.message_id,plan}),x=>x.data.reason==='COMPLETION_OWNER_MIGRATION_REQUIRED');
      await assert.rejects(f.prepare(s),x=>x.data.reason==='COMPLETION_OWNER_MIGRATION_REQUIRED');
      assert.equal(f.control.callbackJob(s.job_id),null,'unbound legacy owner cannot use the new callback API');
    }else{
      f.control.completionRegister(dot,{request_message_id:e.message_id,plan});assert.ok((await f.prepare(s)).launch);
    }
    f.restart();assert.equal(f.control.completionRecovery(dot,{}).contracts.length,1,'migration remains idempotent after restart');
  });
});
test('isolated workerd coordinator persists launch/status/outbox across an actual runtime restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'commlink-session-runtime-'));const config=approvedFixture();
  config.activation={policy_sha256:await sessionDigest('commlink.policy.v1',config.policy),control_sha256:await controlDigest(config),owner_receipt_verified:true,receipt_id:'synthetic-test-only',epoch:1,expires_at:BASE+86400000};
  const bundle=await readFile(new URL('../dist/worker.js',import.meta.url),'utf8');
  // Fixture appended only to the isolated test script. No test selector,
  // activation override or alternate configuration is in dist/worker.js.
  const script=bundle+`\nDate.now=()=>${BASE};const sessionTestConfig=${JSON.stringify(config)};export class SessionTestMailbox extends Mailbox {sessionConfiguration(){return sessionTestConfig;}}`;
  const options={modules:true,script,compatibilityDate:'2026-07-30',log:new Log(LogLevel.WARN),durableObjects:{MAILBOX:{className:'SessionTestMailbox',useSQLite:true}},durableObjectsPersist:dir,
    bindings:{CHANNEL_ID:'session-isolated',IDENTITIES_JSON:JSON.stringify({'sub:dot':'openai','sub:other':'openai','sub:robut':'robut'}),CALLBACK_ORIGINS_JSON:'[]'},
    outboundService:()=>{assert.fail('session fixture must not make an external request');}};
  let mf,stub;const start=async()=>{mf=new Miniflare(options);await mf.ready;const ns=await mf.getDurableObjectNamespace('MAILBOX');stub=ns.get(ns.idFromName('session-isolated'));};
  await start();t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});
  const raw=async(id,name,args={})=>(await stub.rpc(id,'tools/call',{name,arguments:args})).result;
  const tool=async(id,name,args={})=>{const r=await raw(id,name,args);assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
  const caps=await tool(robut,'session_capabilities');const e={protocol_version:'1.0',message_id:randomUUID(),correlation_id:randomUUID(),from:'robut',to:'openai',type:'MSG',seq:1,timestamp:new Date(BASE).toISOString(),ttl:300,
    payload:{content_type:'application/json',issue_id:'HUB-300',body:JSON.stringify({kind:'session_request',schema_version:1,menu_version:caps.menu_version,menu_sha256:caps.menu_sha256,expected_policy_sha256:caps.active_policy.sha256,role:'coder',job:'Synthetic patch/test job; no actual execution',linear_issue:'HUB-300',environment:'test',workdir:null,speed:'default',time_budget:{minutes:10,mode:'soft'},context_refs:[]})}};
  await tool(robut,'send',{to:'openai',msg:e});let s=await tool(dot,'session_receive',{request_message_id:e.message_id});assert.equal(s.state,'accepted');assert.equal(s.selection.tier,'standard');
  assert.equal((await raw(other,'session_receive',{request_message_id:e.message_id})).isError,true);
  await tool(dot,'session_completion_register',{request_message_id:e.message_id,plan:completionPlan()});
  const p=await tool(dot,'session_prepare_launch',{request_message_id:e.message_id,expected_version:s.status_seq});assert.ok(p.launch);assert.equal(p.launch.thinking,'medium');
  s=await tool(dot,'session_transition',{request_message_id:e.message_id,expected_version:p.status.status_seq,fence:p.fence,event:'submitted',executor_id:'synthetic-cloud-thread',evidence:{source:'create_thread',state:'created'}});
  await tool(dot,'session_completion_bind',{request_message_id:e.message_id,executor_id:'synthetic-cloud-thread',turn_id:'synthetic-turn'});
  s=await tool(dot,'session_transition',{request_message_id:e.message_id,expected_version:s.status_seq,fence:p.fence,event:'running',executor_id:'synthetic-cloud-thread',evidence:{source:'read_thread',state:'running',turn_id:'synthetic-turn'}});
  const childHint=signalFor(e,'synthetic-cloud-thread');
  await tool(dot,'session_completion_signal',{request_message_id:e.message_id,signal:childHint});
  const pending=await tool(dot,'session_outbox');for(const msg of pending.messages){await tool(dot,'send',{to:'robut',msg});await tool(dot,'session_outbox_mark_sent',{message_id:msg.message_id});}
  assert.equal((await tool(dot,'session_outbox')).messages.length,0);
  await mf.dispose();await start();const recovered=(await tool(dot,'session_recovery')).jobs[0];assert.equal(recovered.phase,'started');assert.equal(recovered.status.executor.id,'synthetic-cloud-thread');assert.equal(recovered.fence,p.fence);
  const completion=(await tool(dot,'session_completion_recovery')).contracts[0];assert.equal(completion.owner_thread_id,'synthetic-owning-root');assert.equal(completion.turn_id,'synthetic-turn');assert.equal(completion.action,'reconcile_provider');
  assert.equal((await tool(dot,'session_completion_signal',{request_message_id:e.message_id,signal:childHint})).duplicate,true);
  await tool(dot,'session_completion_observe',{request_message_id:e.message_id,observation:{executor_id:'synthetic-cloud-thread',turn_id:'synthetic-turn',source:'read_thread',state:'running'}});
  assert.equal((await tool(robut,'session_status',{request_message_id:e.message_id})).state,'started');
  s=await tool(dot,'session_transition',{request_message_id:e.message_id,expected_version:s.status_seq,fence:p.fence,event:'finished',executor_id:'synthetic-cloud-thread',evidence:{source:'wait_threads',state:'finished',turn_id:'synthetic-turn'},result});
  assert.equal(s.state,'finished');assert.equal((await tool(dot,'session_recovery')).jobs.length,0);assert.equal((await tool(dot,'session_outbox')).messages.length,1);
  assert.equal((await tool(robut,'poll',{since:0})).messages.length,pending.messages.length,'outbox acceptance did not manufacture recipient acknowledgment');
  // Simulate the owning dot returning after terminal state was committed but
  // before its report was sent. No active slot does not mean no pending report.
  const terminal=(await tool(dot,'session_outbox')).messages[0];
  assert.equal(terminal.to,'robut');assert.equal(terminal.correlation_id,e.correlation_id);
  const body=JSON.parse(terminal.payload.body);assert.equal(body.request_message_id,e.message_id);assert.equal(body.state,'finished');
  await mf.dispose();await start();assert.equal((await tool(dot,'session_recovery')).jobs.length,0);
  assert.deepEqual((await tool(dot,'session_outbox')).messages,[terminal]);
  assert.equal((await tool(dot,'send',{to:'robut',msg:terminal})).status,'accepted');
  // A crash after mailbox storage but before the outbox mark retries the same
  // envelope. There must be exactly one terminal receipt in Robut's mailbox.
  await mf.dispose();await start();assert.deepEqual((await tool(dot,'session_outbox')).messages,[terminal]);
  assert.equal((await tool(dot,'send',{to:'robut',msg:terminal})).status,'duplicate');
  await tool(dot,'session_outbox_mark_sent',{message_id:terminal.message_id});
  let inbox=await tool(robut,'poll',{since:0});assert.equal(inbox.messages.filter(m=>m.envelope.message_id===terminal.message_id).length,1);
  assert.equal((await tool(dot,'session_outbox')).messages.length,0);
  assert.equal((await tool(robut,'ack',{id:terminal.message_id})).status,'acked');
  assert.equal((await tool(robut,'ack',{id:terminal.message_id})).status,'already_acked');
  inbox=await tool(robut,'poll',{since:0});assert.equal(inbox.messages.some(m=>m.envelope.message_id===terminal.message_id),false);
  assert.equal((await tool(dot,'session_outbox')).messages.length,0,'recipient acknowledgment cannot create a completion echo');
  assert.deepEqual((await tool(dot,'poll',{since:0})).messages.map(m=>m.envelope.message_id),[e.message_id]);
});
