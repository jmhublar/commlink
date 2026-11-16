import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';

test('real authenticated Worker: job hints deliver a separate signed native event and preserve mailbox semantics', {timeout:60000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'job-event-runtime-')),BASE=Date.now();
  const {publicKey,privateKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'job-test-key',alg:'RS256',use:'sig'};
  const job={job_id:randomUUID(),owner_key:'sub:owner',reporter_key:'sub:owner',owner_thread_id:'existing-owning-dot',correlation_id:randomUUID(),request_message_id:null,
    executor_id:'recorded-cloud-task',turn_id:'recorded-turn',expires_at:BASE+3600000,approval_ref:'synthetic-callback-only-approval',reconciled:false};
  const policy=JSON.parse(await readFile(new URL('../../session-control/policies/standing.v1.json',import.meta.url),'utf8'));
  const config={policy,activation:null,paused:true,coordinator_keys:[],profiles:{},completion_owner_thread_id:'existing-owning-dot',callback_jobs:[job]};
  const bundle=await readFile(new URL('../dist/worker.js',import.meta.url),'utf8');
  // Synthetic operator snapshot and clock exist only in this test script, not
  // in dist/worker.js. No production setting can choose this subclass.
  const script=bundle+`\nlet jobTestNow=${BASE};Date.now=()=>jobTestNow;const jobTestConfig=${JSON.stringify(config)};
    export class JobTestMailbox extends Mailbox {sessionConfiguration(){return jobTestConfig;}advanceTestTime(ms){jobTestNow+=ms;}revokeTestJobs(){jobTestConfig.callback_jobs=[];}runTestAlarm(){return this.alarm();}}`;
  const tokens={};for(const who of ['owner','other','robut'])tokens[who]=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject(who)
    .setIssuer('https://job-access.example').setAudience('job-audience').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const keys=new Map(['/job','/inbox','/another','/inbox2','/inbox3','/inbox4','/overflow'].map(path=>[path,'whsec_'+randomBytes(32).toString('base64')])),deliveries=[];let status=200;
  const options={modules:true,script,compatibilityDate:'2026-07-30',log:new Log(LogLevel.WARN),durableObjects:{MAILBOX:{className:'JobTestMailbox',useSQLite:true}},durableObjectsPersist:dir,
    bindings:{CHANNEL_ID:'job-events',ACCESS_ISSUER:'https://job-access.example',ACCESS_AUD:'job-audience',IDENTITIES_JSON:JSON.stringify({'sub:owner':'openai','sub:other':'openai','sub:robut':'robut'}),CALLBACK_ORIGINS_JSON:'["https://job-callback.example"]',
      CALLBACK_TRANSPORT_URL:'https://job-gateway.example/v1/deliver',CALLBACK_ACCESS_CLIENT_ID:'synthetic-client',CALLBACK_ACCESS_CLIENT_SECRET:'synthetic-secret'},
    outboundService:async req=>{
      if(req.url==='https://job-access.example/cdn-cgi/access/certs')return Response.json({keys:[jwk]});
      assert.equal(req.url,'https://job-gateway.example/v1/deliver','only the fixed gateway is reachable');
      const forward=await req.json(),url=new URL(forward.url),data=JSON.parse(forward.body);
      assert.equal(url.origin,'https://job-callback.example');const secret=keys.get(url.pathname);assert.ok(secret);
      const h=forward.headers,expected='v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${h['webhook-id']}.${h['webhook-timestamp']}.${forward.body}`).digest('base64');
      assert.ok(h['webhook-signature'].split(' ').includes(expected));assert.ok(!forward.body.includes('whsec_'));
      if(data.type==='verification')return Response.json({status:200,body:JSON.stringify({challenge:data.challenge})});
      assert.equal(h['webhook-id'],data.eventId);deliveries.push({path:url.pathname,data,body:forward.body});return Response.json({status,body:''});
    }};
  let mf,stub;const start=async()=>{mf=new Miniflare(options);await mf.ready;const ns=await mf.getDurableObjectNamespace('MAILBOX');stub=ns.get(ns.idFromName('job-events'));};await start();
  t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});
  const rpc=async(who,method,params={})=>{const response=await mf.dispatchFetch('https://job-relay.example/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(who?{'Cf-Access-Jwt-Assertion':tokens[who]??'forged'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {http:response.status,...await response.json()};};
  const raw=async(who,name,args={})=>(await rpc(who,'tools/call',{name,arguments:args})).result;
  const tool=async(who,name,args={})=>{const r=await raw(who,name,args);assert.ok(!r?.isError,JSON.stringify(r));return r.structuredContent;};
  const sub=(path='/job',root='existing-owning-dot',event='commlink.job.status_reported')=>({name:event,arguments:event==='commlink.job.status_reported'?{owner_thread_id:root}:{recipient:'openai'},delivery:{mode:'webhook',url:'https://job-callback.example'+path,secret:keys.get(path)}});
  const report={job_id:job.job_id,status:'finished'};
  const count=path=>new Set(deliveries.filter(d=>!path||d.path===path).map(d=>d.data.eventId)).size;

  assert.equal((await rpc(null,'tools/call',{name:'job_report_status',arguments:report})).http,401);
  assert.equal((await raw('other','job_report_status',report)).isError,true);assert.equal((await raw('robut','job_report_status',report)).isError,true);
  assert.equal((await raw('owner','job_report_status',{...report,to:'robut'})).isError,true);
  assert.equal((await raw('owner','job_report_status',{job_id:randomUUID(),status:'finished'})).isError,true);
  assert.ok((await rpc('owner','events/list')).result.events.some(e=>e.name==='commlink.job.status_reported'));
  assert.equal((await rpc('robut','events/list')).result.events.some(e=>e.name==='commlink.job.status_reported'),false);
  assert.equal((await rpc('other','events/subscribe',sub())).error.code,-32003);
  assert.equal((await rpc('owner','events/subscribe',sub('/job','worker-thread'))).error.code,-32003);
  const first=(await rpc('owner','events/subscribe',sub())).result;assert.ok(first.id);
  assert.equal((await rpc('owner','events/subscribe',sub())).result.id,first.id);
  assert.equal((await rpc('owner','events/subscribe',sub('/another'))).error.code,-32003,'one root completion watch cannot silently fan out to another callback');
  await rpc('owner','events/subscribe',sub('/inbox',null,'commlink.message.created'));
  for(const path of ['/inbox2','/inbox3','/inbox4'])assert.ok((await rpc('owner','events/subscribe',sub(path,null,'commlink.message.created'))).result?.id);
  assert.equal((await rpc('owner','events/subscribe',sub('/overflow',null,'commlink.message.created'))).error.code,-32000,'mailbox and job watches share the existing cap');
  for(const path of ['/inbox2','/inbox3','/inbox4']){const stop=sub(path,null,'commlink.message.created');delete stop.delivery.secret;await rpc('owner','events/unsubscribe',stop);}
  const registered=await tool('owner','job_report_status',report);assert.equal(registered.delivery,'queued');assert.equal(registered.provider_verified,false);
  assert.equal((await tool('owner','poll',{since:0})).messages.length,0,'job hint must not create a forged/self mailbox message');
  assert.equal((await tool('owner','session_capabilities')).active_policy.state,'inactive');
  const self={protocol_version:'1.0',message_id:randomUUID(),correlation_id:randomUUID(),from:'openai',to:'openai',type:'MSG',seq:1,timestamp:new Date(BASE).toISOString(),ttl:300,payload:{content_type:'text/plain',body:'self send must remain invalid'}};
  assert.equal((await raw('owner','send',{to:'openai',msg:self})).isError,true);
  await mf.dispose();await start();assert.equal((await tool('owner','job_report_status',report)).status,'duplicate');
  await stub.runTestAlarm();assert.equal(count('/job'),1);assert.equal(count('/inbox'),0);
  const event=deliveries[0].data;assert.equal(event.eventId,registered.event_id);assert.equal(event.data.claimed_status,'finished');assert.equal(event.data.executor_id,job.executor_id);
  assert.equal(event.data.turn_id,job.turn_id);assert.equal(event.data.owner_thread_id,'existing-owning-dot');assert.equal(event.data.correlation_id,job.correlation_id);
  assert.equal((await raw('owner','job_report_status',{...report,status:'failed'})).isError,true);await stub.runTestAlarm();assert.equal(count(),1);
  const s=await tool('owner','link_status');assert.equal(s.subscriptions.length,1);assert.equal(s.job_subscriptions.length,1);assert.equal(s.job_deliveries[0].status,'accepted');
  assert.equal((await tool('other','link_status')).job_subscriptions.length,0);assert.equal((await tool('other','link_status')).job_deliveries.length,0);
  const message={...self,from:'robut',message_id:randomUUID(),payload:{content_type:'text/plain',body:'ordinary mailbox work'}};
  await tool('robut','send',{to:'openai',msg:message});await stub.runTestAlarm();assert.equal(count('/inbox'),1);assert.equal(count('/job'),1);
  await tool('owner','ack',{id:message.message_id});await stub.runTestAlarm();assert.equal(count(),2,'ack must not create any event');
  assert.equal(new Set(deliveries.filter(d=>d.path==='/job').map(d=>d.body)).size,1,'at-least-once transport preserves the same logical event/body');
  await stub.revokeTestJobs();assert.equal((await rpc('owner','events/subscribe',sub())).error.code,-32003);
  const stop=sub();delete stop.delivery.secret;await rpc('owner','events/unsubscribe',stop);assert.equal((await tool('owner','link_status')).job_subscriptions.length,0);
  assert.equal((await tool('owner','link_status')).subscriptions.length,1,'stopping completion watch preserves inbox watch');
});
