import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';

const BASE=2_000_000_000_000;
const bundle=await readFile(new URL('../dist/worker.js',import.meta.url),'utf8');
// Test-only clock and alarm driver, absent from the deployment bundle. Alarms
// are scheduled in the future so tests can exercise minutes without sleeping.
const script=bundle+`\nlet grokTestClock=${BASE}; Date.now=()=>grokTestClock;
export class GrokTestMailbox extends Mailbox {
  async tick(ms=0){grokTestClock+=ms;await this.alarm();return grokTestClock;}
  setClock(ms){grokTestClock=ms;}
}`;
const message=(from='openai',ttl=300)=>({protocol_version:'1.0',message_id:randomUUID(),correlation_id:randomUUID(),from,to:from==='openai'?'robut':'openai',type:'MSG',seq:1,timestamp:new Date().toISOString(),ttl,payload:{content_type:'text/plain',body:'private synthetic nonce '+randomUUID(),issue_id:'HUB-300'}});
async function fixture(t,overrides={}) {
  const dir=await mkdtemp(join(tmpdir(),'commlink-grok-'));
  const calls=[];let status=200,retryAfter,block;
  const bindings={CHANNEL_ID:'grok-test',ACCESS_ISSUER:'https://access.example',ACCESS_AUD:'test',IDENTITIES_JSON:JSON.stringify({'sub:openai':'openai','sub:robut':'robut'}),CALLBACK_ORIGINS_JSON:'[]',GROK_ENABLED:'true',GROK_WEBHOOK_URL:'https://routine.example/wake?key=synthetic-url-secret',GROK_SENDER_KEY:'synthetic-key',GROK_WEBHOOK_ORIGIN:'https://routine.example',GROK_AUTH_HEADER:'Authorization',GROK_AUTH_SCHEME:'Bearer',GROK_CONFIG_REVISION:'1',...overrides};
  const options={modules:true,script,compatibilityDate:'2026-07-30',log:new Log(LogLevel.WARN),durableObjects:{MAILBOX:{className:'GrokTestMailbox',useSQLite:true}},durableObjectsPersist:dir,bindings,
    outboundService:async request=>{
      assert.equal(request.url,bindings.GROK_WEBHOOK_URL);assert.equal(request.method,'POST');
      assert.equal(request.headers.get('Authorization'),'Bearer synthetic-key');
      assert.equal(request.headers.get('Content-Type'),'application/json');
      const body=await request.json();assert.deepEqual(Object.keys(body).sort(),['correlation_id','event','event_id','recipient']);
      assert.equal(body.event,'commlink.message.created');assert.equal(body.recipient,'robut');
      calls.push(body);if(block)await block;
      return new Response(null,{status,headers:{...(retryAfter?{'Retry-After':retryAfter}:{}),...(status===302?{Location:'https://unapproved.example'}:{})}});
    }};
  let mf=new Miniflare(options),stub;
  async function ready(){await mf.ready;const ns=await mf.getDurableObjectNamespace('MAILBOX');stub=ns.get(ns.idFromName(bindings.CHANNEL_ID));}
  await ready();t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});
  const tool=async(role,name,args={})=>{
    const r=await stub.rpc({peer:role,key:'sub:'+role},'tools/call',{name,arguments:args});
    assert.ok(!r.error&&!r.result?.isError,JSON.stringify(r));return r.result.structuredContent;
  };
  return {calls,tool,send:e=>tool(e.from,'send',{to:e.to,msg:e}),tick:ms=>stub.tick(ms),
    status:()=>tool('openai','link_status'),setStatus:n=>{status=n;},setRetryAfter:n=>{retryAfter=n;},setBlock:p=>{block=p;},
    restart:async(time=BASE,patch={})=>{await mf.dispose();Object.assign(bindings,patch);mf=new Miniflare(options);await ready();await stub.setClock(time);},
  };
}

test('Grok wake coalesces burst, accepts only transport delivery, and ack/reply do not wake Robut',async t=>{
  const f=await fixture(t);const batch=Array.from({length:3},()=>message());
  for(const e of batch)assert.equal((await f.send(e)).doorbell,'queued');
  assert.equal((await f.send(batch[0])).status,'duplicate');
  await f.tick(0);assert.equal(f.calls.length,1);
  assert.equal((await f.tool('robut','poll',{since:0})).messages.length,3,'HTTP 200 does not ack');
  assert.equal((await f.status()).grok_routine.active.status,'reconcile');
  for(const e of batch)await f.tool('robut','ack',{id:e.message_id});
  await f.send(message('robut'));await f.tick(60000);assert.equal(f.calls.length,1);
  assert.equal((await f.status()).grok_routine.active.status,'drained');
});

test('Grok transient retries preserve event ID across restart and honor Retry-After',async t=>{
  const f=await fixture(t);f.setStatus(429);f.setRetryAfter('90');await f.send(message());await f.tick(0);
  const id=f.calls[0].event_id;await f.restart(BASE+80000);await f.tick(0);assert.equal(f.calls.length,1);
  f.setStatus(200);await f.tick(10000);assert.equal(f.calls.length,2);assert.equal(f.calls[1].event_id,id);
  assert.equal((await f.status()).grok_routine.active.attempts,2);
});

test('Grok accepted-but-unprocessed mail gets new reconciliation IDs and stops at its budget',async t=>{
  const f=await fixture(t);await f.send(message());await f.tick(0);await f.tick(60000);await f.tick(60000);await f.tick(60000);
  assert.equal(f.calls.length,3);assert.equal(new Set(f.calls.map(x=>x.event_id)).size,3);
  assert.equal((await f.status()).grok_routine.active.status,'exhausted');
  await f.tick(60000);assert.equal(f.calls.length,3);
  await f.restart(BASE+240000,{GROK_CONFIG_REVISION:'2'});await f.tick(0);assert.equal(f.calls.length,4,'operator revision can resume exhausted mail');
});

test('Grok permanent errors and redirects block new wakes until an operator revision',async t=>{
  for(const code of [201,302,401])await t.test(String(code),async t=>{
    const f=await fixture(t);f.setStatus(code);await f.send(message());await f.tick(0);await f.send(message());await f.tick(60000);
    assert.equal(f.calls.length,1);assert.equal((await f.status()).grok_routine.blocked,true);
    f.setStatus(200);await f.restart(BASE+60000,{GROK_CONFIG_REVISION:'2'});await f.tick(0);assert.equal(f.calls.length,2);
  });
});

test('Grok arrival during delivery survives ack and an older completion',async t=>{
  const f=await fixture(t);let release;const wait=new Promise(r=>{release=r;});f.setBlock(wait);
  const first=message();await f.send(first);const running=f.tick(0);
  while(!f.calls.length)await new Promise(r=>setTimeout(r,10));
  await f.tool('robut','ack',{id:first.message_id});const second=message();await f.send(second);
  release();await running;f.setBlock(undefined);await f.tick(20000);
  assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].event_id,f.calls[1].event_id);
  assert.equal(f.calls[1].correlation_id,second.correlation_id);
  assert.equal((await f.status()).grok_routine.active.last_http,200);
});

test('Grok permanent failure blocks a replacement event created during the request',async t=>{
  const f=await fixture(t);f.setStatus(401);let release;f.setBlock(new Promise(r=>{release=r;}));
  const first=message();await f.send(first);const running=f.tick(0);
  while(!f.calls.length)await new Promise(r=>setTimeout(r,10));
  await f.tool('robut','ack',{id:first.message_id});await f.send(message());release();await running;
  f.setBlock(undefined);await f.tick(60000);
  assert.equal(f.calls.length,1);assert.equal((await f.status()).grok_routine.blocked,true);
});

test('Grok default deny, recipient revocation and expiry prevent egress and preserve recoverable mail',async t=>{
  for(const patch of [{GROK_ENABLED:'false'},{GROK_WEBHOOK_ORIGIN:'https://other.example'},{GROK_AUTH_SCHEME:'raw'},{IDENTITIES_JSON:JSON.stringify({'sub:openai':'openai'})}])await t.test(JSON.stringify(Object.keys(patch)),async t=>{
    const f=await fixture(t,patch);assert.equal((await f.send(message())).doorbell,'not_configured');await f.tick(0);assert.equal(f.calls.length,0);
    if(patch.IDENTITIES_JSON){
      await assert.rejects(f.tool('robut','poll',{since:0}),/Forbidden/);
      await f.restart(BASE,{IDENTITIES_JSON:JSON.stringify({'sub:openai':'openai','sub:robut':'robut'})});
    }
    assert.equal((await f.tool('robut','poll',{since:0})).messages.length,1);
  });
  await t.test('expired',async t=>{const f=await fixture(t);await f.send(message('openai',30));await f.tick(31000);assert.equal(f.calls.length,0);});
});

test('Grok outage has six attempts per event and three bounded event groups',async t=>{
  const f=await fixture(t);f.setStatus(503);await f.send(message('openai',86400));let clock=BASE;
  for(let i=0;i<30;i++){
    const s=(await f.status()).grok_routine;
    assert.ok(!JSON.stringify(s).includes('synthetic-key'));
    assert.ok(!JSON.stringify(s).includes('synthetic-url-secret'));
    if(s.active.status==='exhausted')break;
    const next=Math.max(clock,Number(s.active.due));clock=await f.tick(next-clock);
  }
  assert.equal(f.calls.length,18);
  const counts=new Map();for(const c of f.calls)counts.set(c.event_id,(counts.get(c.event_id)||0)+1);
  assert.deepEqual([...counts.values()],[6,6,6]);
  assert.equal((await f.status()).grok_routine.active.status,'exhausted');
});
