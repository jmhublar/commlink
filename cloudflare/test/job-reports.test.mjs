import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const built=await build({entryPoints:['src/job-reports.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {JobReports}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const BASE=2_000_000_000_000,openai={peer:'openai',key:'sub:owner'},other={peer:'openai',key:'sub:other'},robut={peer:'robut',key:'sub:robut'};
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'job-hints-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.sqlite');
  let now=BASE,db,reports;const bindings=new Map();
  const start=()=>{db=new DatabaseSync(path);const sql={exec(q,...p){let out=[];if(!p.length&&q.includes(';'))db.exec(q);else out=db.prepare(q).all(...p);return {toArray:()=>out};}};
    const tx=f=>{db.exec('BEGIN IMMEDIATE');try{const r=f();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
    reports=new JobReports(sql,tx,key=>bindings.get(key)??null,()=>now);};start();t.after(()=>db.close());
  const binding=(patch={})=>{const b={job_id:randomUUID(),owner_key:openai.key,reporter_key:openai.key,owner_thread_id:'owning-root',request_message_id:null,
    correlation_id:randomUUID(),executor_id:'cloud-task',turn_id:'task-turn',expires_at:BASE+3600000,approval_ref:'synthetic-owner-record',reconciled:false,...patch};bindings.set(b.job_id,b);return b;};
  const subscribe=(id='root-sub',patch={})=>db.prepare('INSERT INTO job_subscriptions(id,owner,peer,owner_thread_id,url,secret,expires,verified) VALUES(?,?,?,?,?,?,?,?)').run(id,
    patch.owner??openai.key,'openai',patch.owner_thread_id??'owning-root','https://callback.example/root','synthetic-not-used',patch.expires??BASE+3600000,BASE);
  return {get reports(){return reports;},binding,bindings,subscribe,advance:ms=>now+=ms,restart:()=>{db.close();start();},
    rows:table=>db.prepare('SELECT * FROM '+table).all()};
}
const report=(f,b,status='finished',identity=openai)=>f.reports.report(identity,{job_id:b.job_id,status});

test('job hint requires a registered job and exact existing OpenAI principal; caller cannot select a destination or result',async t=>{
  const f=await fixture(t),b=f.binding();
  for(const who of [other,robut])assert.throws(()=>report(f,b,'finished',who),e=>e.code===-32003);
  assert.throws(()=>f.reports.report(openai,{job_id:randomUUID(),status:'finished'}),e=>e.code===-32003);
  for(const patch of [{status:['finished']},{status:'running'},{to:'robut'},{owner_thread_id:'another-root'},{result:'private data'},{job_id:'bad'},{job_id:'ABCDEFAB-1234-4234-8234-ABCDEFABCDEF'}])assert.throws(()=>f.reports.report(openai,{job_id:b.job_id,status:'finished',...patch}),e=>e.code===-32602);
  const response=report(f,b);assert.equal(response.provider_verified,false);assert.equal(response.delivery,'pending_binding_or_subscription');
  assert.equal(f.rows('job_hints').length,1);assert.equal(f.rows('job_hint_outbox').length,0);
});

test('hint and stable event dedupe across restart; status conflict cannot replace or add a wake',async t=>{
  const f=await fixture(t),b=f.binding();f.subscribe();const first=report(f,b);assert.equal(first.delivery,'queued');f.restart();
  assert.equal(report(f,b).status,'duplicate');assert.equal(report(f,b).event_id,first.event_id);
  assert.throws(()=>report(f,b,'failed'),e=>e.code===-32602);assert.equal(f.rows('job_hint_outbox').length,1);
  const body=JSON.parse(f.rows('job_hint_outbox')[0].body);assert.equal(body.name,'commlink.job.status_reported');assert.equal(body.data.executor_id,b.executor_id);
  assert.equal(body.data.turn_id,b.turn_id);assert.equal(body.data.correlation_id,b.correlation_id);assert.equal(body.data.claimed_status,'finished');
  assert.ok(!JSON.stringify(body).includes('approval_ref'));assert.ok(!JSON.stringify(body).includes('sub:owner'));
});

test('early hint waits for actual task/turn binding and a matching root watch',async t=>{
  const f=await fixture(t),b=f.binding({executor_id:null,turn_id:null,request_message_id:randomUUID()});
  report(f,b);f.subscribe('wrong',{owner_thread_id:'worker'});f.reports.refreshRequest(b.request_message_id);assert.equal(f.rows('job_hint_outbox').length,0);
  b.executor_id='actual-cloud-task';b.turn_id='actual-turn';f.reports.refreshRequest(b.request_message_id);assert.equal(f.rows('job_hint_outbox').length,0);
  f.subscribe();f.reports.refreshRequest(b.request_message_id);assert.equal(f.rows('job_hint_outbox').length,1);
  const payload=JSON.parse(f.rows('job_hint_outbox')[0].body).data;assert.equal(payload.executor_id,'actual-cloud-task');assert.equal(payload.owner_thread_id,'owning-root');
});

test('known provider IDs cannot be retargeted while waiting or queued; binding revocation cancels delivery',async t=>{
  const f=await fixture(t),b=f.binding();report(f,b);b.turn_id='other-turn';f.subscribe();
  f.advance(60000);
  await f.reports.run(()=>assert.fail('retargeted hint cannot be delivered'),()=>true);assert.equal(f.rows('job_hints')[0].state,'cancelled');
  assert.throws(()=>report(f,b),e=>e.code===-32602);
  const second=f.binding({executor_id:'second-task'});report(f,second);f.bindings.delete(second.job_id);
  await f.reports.run(()=>assert.fail('revoked hint cannot be delivered'),()=>true);assert.equal(f.rows('job_hint_outbox')[0].status,'cancelled');
});

test('provider reconciliation suppresses wake; terminal tombstone and expired grants never replay',async t=>{
  const f=await fixture(t),b=f.binding({reconciled:true});f.subscribe();assert.equal(report(f,b).status,'already_reconciled');
  b.reconciled=false;f.restart();assert.equal(report(f,b).status,'duplicate');assert.equal(f.rows('job_hint_outbox').length,0);
  const pending=f.binding({executor_id:'second-task'});report(f,pending);pending.reconciled=true;
  await f.reports.run(()=>assert.fail('provider-reconciled hint cannot be delivered'),()=>true);assert.equal(f.rows('job_hint_outbox')[0].status,'cancelled');
  f.advance(3600000);assert.throws(()=>report(f,b),e=>e.code===-32003);
});

test('delivery uses bounded retry with stable event ID, stops on permanent errors, and never verifies a provider',async t=>{
  const f=await fixture(t),b=f.binding();f.subscribe();const first=report(f,b);const calls=[];
  const deliver=async(sub,id,body)=>{calls.push({id,body});return new Response(null,{status:calls.length===1?429:200});};
  await f.reports.run(deliver,()=>true);assert.equal(f.rows('job_hint_outbox')[0].status,'pending');f.advance(2000);f.restart();await f.reports.run(deliver,()=>true);
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].id,first.event_id);assert.equal(f.rows('job_hint_outbox')[0].status,'accepted');
  await f.reports.run(()=>assert.fail('accepted delivery cannot repeat'),()=>true);
  for(const status of [410,413]){const next=f.binding({executor_id:'task-'+status});report(f,next);await f.reports.run(async()=>new Response(null,{status}),()=>true);f.advance(5000);
    await f.reports.run(()=>assert.fail('permanent failure cannot retry'),()=>true);assert.equal(f.rows('job_hint_outbox').find(r=>r.job_id===next.job_id).status,'failed');}
});

test('six transient attempts, revoked subscription and authorization loss stop delivery',async t=>{
  const f=await fixture(t),b=f.binding();f.subscribe();report(f,b);let n=0;
  for(let i=0;i<6;i++){await f.reports.run(async()=>{n++;throw Error('synthetic transport failure');},()=>true);f.advance(300000);}
  assert.equal(n,6);assert.equal(f.rows('job_hint_outbox')[0].status,'failed');await f.reports.run(()=>assert.fail('retry budget exhausted'),()=>true);
  const second=f.binding({executor_id:'second-task'});report(f,second);await f.reports.run(()=>assert.fail('authorization revoked'),()=>false);
  assert.equal(f.rows('job_hint_outbox').find(r=>r.job_id===second.job_id).status,'cancelled');
});

test('expired subscriptions and job grants cancel pending delivery without a mailbox or replacement event',async t=>{
  const f=await fixture(t),b=f.binding();f.subscribe('short',{expires:BASE+1000});report(f,b);f.advance(1000);
  await f.reports.run(()=>assert.fail('expired watch cannot deliver'),()=>true);assert.equal(f.rows('job_subscriptions').length,0);
  assert.equal(f.rows('job_hint_outbox')[0].status,'cancelled');f.subscribe('replacement');assert.equal(report(f,b).status,'duplicate');
  await f.reports.run(()=>assert.fail('a duplicate report must not replay to a replacement watch'),()=>true);assert.equal(f.rows('job_hint_outbox').length,1);
  const short=f.binding({executor_id:'short-task',expires_at:BASE+2000});report(f,short);f.advance(1000);
  await f.reports.run(()=>assert.fail('expired job cannot deliver'),()=>true);assert.equal(f.rows('job_hint_outbox').find(r=>r.job_id===short.job_id).status,'cancelled');
  assert.throws(()=>report(f,short),e=>e.code===-32003);
});
