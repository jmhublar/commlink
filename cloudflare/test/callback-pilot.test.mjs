import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

const built=await build({stdin:{contents:`export {callbackPilotConfiguration as config} from './callback-pilot';
  export {SessionControl} from './session-control';export {JobReports} from './job-reports';`,resolveDir:new URL('../src/',import.meta.url).pathname},
  bundle:true,platform:'node',format:'esm',write:false});
const {config,SessionControl,JobReports}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('approved callback-only snapshot cannot admit or coordinate work; its exact principal and expiry fence the hint',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const sql={exec(q,...p){let rows=[];if(!p.length&&q.includes(';'))db.exec(q);else rows=db.prepare(q).all(...p);return {toArray:()=>rows};}};
  const tx=f=>{db.exec('BEGIN IMMEDIATE');try{const r=f();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  const [job]=config.callback_jobs;let now=job.expires_at-1;
  const sessions=new SessionControl(sql,tx,()=>config,'pilot-test',()=>now);
  const hints=new JobReports(sql,tx,key=>sessions.callbackJob(key),()=>now);
  const owner={peer:'openai',key:job.owner_key},report={job_id:job.job_id,status:'finished'};
  const caps=await sessions.capabilities({});
  assert.equal(caps.active_policy.state,'inactive');assert.equal(caps.active_policy.paused,true);
  assert.equal(caps.active_policy.owner_approval_verified,false);assert.equal(caps.coordinator_configured,false);
  assert.deepEqual(caps.environments,[]);
  assert.throws(()=>sessions.completionRecovery(owner,{}),e=>e.code===-32003);
  assert.equal(sessions.callbackOwner(owner,{owner_thread_id:job.owner_thread_id}),job.owner_thread_id);
  assert.throws(()=>sessions.callbackOwner(owner,{owner_thread_id:'worker-thread'}),e=>e.code===-32003);
  assert.throws(()=>hints.report({peer:'openai',key:'common_name:machine.access'},report),e=>e.code===-32003);
  assert.throws(()=>hints.report({peer:'robut',key:job.reporter_key},report),e=>e.code===-32003);
  assert.equal(hints.report(owner,report).provider_verified,false);
  now=job.expires_at;
  assert.throws(()=>hints.report(owner,report),e=>e.code===-32003);
  assert.throws(()=>sessions.callbackOwner(owner,{owner_thread_id:job.owner_thread_id}),e=>e.code===-32003);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_jobs').get().n,0);
});
