import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,message,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await f())return;await pause(50);}assert.fail(message);}

test('real Worker: authenticated mailbox and durable signed event delivery', {timeout:60000}, async t=>{
  const dir=await mkdtemp(join(tmpdir(),'commlink-runtime-'));
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const jwk={...await exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  const keys=new Map(); const deliveries=[]; const verifications=[]; let callbackStatus=200,badChallenge=false,redirectChallenge=false;
  let verificationBarrier;
  const tokens={};
  for(const role of ['openai','openai-other','robut','stranger'])tokens[role]=await new SignJWT({email:`${role}@example.test`}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://access.example').setAudience('test-audience').setSubject(role).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const options={modules:true,scriptPath:'dist/worker.js',compatibilityDate:'2026-07-30',
    log:new Log(LogLevel.WARN),durableObjects:{MAILBOX:{className:'Mailbox',useSQLite:true}},durableObjectsPersist:dir,
    bindings:{CHANNEL_ID:'test-channel',ACCESS_ISSUER:'https://access.example',ACCESS_AUD:'test-audience',IDENTITIES_JSON:JSON.stringify({'sub:openai':'openai','sub:openai-other':'openai','sub:robut':'robut'}),CALLBACK_ORIGINS_JSON:JSON.stringify(['https://callback.example'])},
    outboundService:async request=>{
      const url=new URL(request.url);
      if(url.href==='https://access.example/cdn-cgi/access/certs')return Response.json({keys:[jwk]});
      assert.equal(url.origin,'https://callback.example','unexpected external destination');
      assert.equal(request.method,'POST');
      const body=await request.text(),data=JSON.parse(body),headers=request.headers;
      const secret=keys.get(url.pathname);assert.ok(secret,'known callback secret');
      const expected='v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${headers.get('webhook-id')}.${headers.get('webhook-timestamp')}.${body}`).digest('base64');
      assert.ok(headers.get('webhook-signature').split(' ').includes(expected),'valid Standard Webhooks signature');
      assert.ok(headers.get('x-mcp-subscription-id').startsWith('sub_'));
      if(data.type==='verification'){verifications.push({data,headers});if(verificationBarrier)await verificationBarrier;if(redirectChallenge)return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});return Response.json({challenge:badChallenge?'wrong':data.challenge});}
      assert.equal(headers.get('webhook-id'),data.eventId);
      deliveries.push({data,headers,body});return new Response(null,{status:callbackStatus});
    }};
  let mf=new Miniflare(options);t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});
  await mf.ready;
  const request=async(role,method,params={})=>{
    let timer;
    try{return await Promise.race([
      mf.dispatchFetch('https://relay.example/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(role?{'Cf-Access-Jwt-Assertion':tokens[role]??role}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Request timed out: ${method} as ${role&&tokens[role]?'known principal':role?'invalid token':'anonymous'}`)),10000);})
    ]);}finally{clearTimeout(timer);}
  };
  const rpc=async(role,method,params={})=>{const response=await request(role,method,params);assert.equal(response.status,200);return response.json();};
  const tool=async(role,name,args={})=>{const response=await rpc(role,'tools/call',{name,arguments:args});assert.ok(!response.error,JSON.stringify(response));return response.result;};
  const value=r=>r.structuredContent;
  const msg=(from='robut',type='MSG',payload={content_type:'text/plain',body:'synthetic nonce '+randomUUID(),issue_id:'HUB-300'})=>({protocol_version:'1.0',message_id:randomUUID(),correlation_id:randomUUID(),from,to:from==='robut'?'openai':'robut',type,seq:1,timestamp:new Date().toISOString(),ttl:300,payload});
  const subscription=(path='/events',recipient='openai',secret=keys.get(path))=>({name:'commlink.message.created',arguments:{recipient},delivery:{mode:'webhook',url:'https://callback.example'+path,secret},cursor:null,_meta:{'openai/locale':'en-US'}});
  keys.set('/events','whsec_'+randomBytes(32).toString('base64'));

  await t.test('rejects missing, forged, wrong-audience and unmapped identities',async()=>{
    for(const token of [null,'forged','stranger'])assert.equal((await request(token,'initialize')).status,401);
    const wrong=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://access.example').setAudience('other-app').setSubject('openai').setIssuedAt().setExpirationTime('1h').sign(privateKey);
    assert.equal((await request(wrong,'initialize')).status,401);
    const expired=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://access.example').setAudience('test-audience').setSubject('openai').setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)-60).sign(privateKey);
    assert.equal((await request(expired,'initialize')).status,401);
    assert.equal((await mf.dispatchFetch('https://relay.example/mcp',{method:'POST',headers:{Origin:'https://attacker.example'}})).status,403);
    assert.deepEqual((await rpc('openai','initialize',{protocolVersion:'2025-06-18'})).result.capabilities,{tools:{},events:{}});
  });
  let subId;
  await t.test('accepts MCP request metadata without treating it as tool arguments or identity',async()=>{
    for(const args of [{arguments:{}},{}]){
      const result=await rpc('openai','tools/call',{name:'link_status',...args,_meta:{progressToken:'status-check','openai/locale':'en-US',peer:'robut'}});
      assert.equal(result.result?.structuredContent?.self,'openai',JSON.stringify(result));
    }
    const bad=await rpc('openai','tools/call',{name:'link_status',arguments:{unexpected:true},_meta:{}});
    assert.equal(bad.result?.isError,true,'metadata must not relax tool argument validation');
    assert.equal((await rpc('openai','tools/call',{name:'link_status',_meta:'invalid'})).error?.code,-32602);
    assert.equal((await rpc('openai','tools/call',{name:'link_status',extra:true,_meta:{}})).error?.code,-32602);
  });
  await t.test('verifies callbacks and rejects wrong-recipient and unapproved destinations',async()=>{
    const diagnostic=subscription();diagnostic.delivery.url='https://unapproved.example/private-capability?token=never-echo';
    const blocked=await rpc('openai','events/subscribe',diagnostic);
    assert.deepEqual(blocked.error?.data,{reason:'callback_origin_not_approved',callback_origin:'https://unapproved.example'});
    assert.ok(!JSON.stringify(blocked).includes('never-echo')&&!JSON.stringify(blocked).includes('private-capability'));
    assert.equal(verifications.length,0,'unapproved origin causes no outbound request');
    const attempt=value(await tool('openai','link_status')).last_subscription_attempt;
    assert.equal(attempt.outcome,'rejected');assert.equal(attempt.code,-32602);
    assert.equal(attempt.reason,'callback_origin_not_approved');assert.equal(attempt.callback_origin,'https://unapproved.example');
    assert.deepEqual(Object.keys(attempt).sort(),['attempted','callback_origin','code','outcome','reason']);
    assert.equal(value(await tool('openai-other','link_status')).last_subscription_attempt,null,'same peer, different principal cannot read diagnostic');
    assert.equal(value(await tool('robut','link_status')).last_subscription_attempt,null,'other peer cannot read diagnostic');
    await mf.dispose();mf=new Miniflare(options);await mf.ready;
    assert.deepEqual(value(await tool('openai','link_status')).last_subscription_attempt,attempt,'diagnostic survives runtime restart');
    const malformed=subscription();malformed.delivery.url='not a URL';
    assert.equal((await rpc('openai','events/subscribe',malformed)).error?.code,-32602);
    const replaced=value(await tool('openai','link_status')).last_subscription_attempt;
    assert.equal(replaced.reason,'invalid_params');assert.equal(replaced.callback_origin,null,'last attempt replaces old origin');
    assert.equal((await rpc('robut','events/subscribe',subscription())).error.code,-32003);
    const invalid=subscription();invalid.delivery.url='http://127.0.0.1/private';
    assert.equal((await rpc('openai','events/subscribe',invalid)).error.code,-32602);
    const bad=subscription();bad.delivery.secret='whsec_YWJj';
    assert.equal((await rpc('openai','events/subscribe',bad)).error.code,-32602);
    badChallenge=true;assert.equal((await rpc('openai','events/subscribe',subscription())).error.code,-32015);badChallenge=false;
    redirectChallenge=true;assert.equal((await rpc('openai','events/subscribe',subscription())).error.code,-32015);redirectChallenge=false;
    const result=await rpc('openai','events/subscribe',subscription());assert.ok(result.result?.id,JSON.stringify(result));subId=result.result.id;
    const count=verifications.length;
    assert.equal((await rpc('openai','events/subscribe',subscription())).result.id,subId);
    assert.equal(verifications.length,count,'idempotent refresh reuses recent verification');
  });
  await t.test('commits once, keeps transport acceptance separate, and ack never wakes',async()=>{
    const e=msg();
    assert.equal((await tool('openai','send',{to:e.to,msg:e})).isError,true);
    const first=value(await tool('robut','send',{to:e.to,msg:e}));assert.equal(first.status,'accepted');
    assert.equal(value(await tool('robut','send',{to:e.to,msg:e})).status,'duplicate');
    assert.equal((await tool('robut','send',{to:e.to,msg:{...e,payload:{...e.payload,body:'conflict'}}})).isError,true);
    await until(()=>deliveries.some(x=>x.data.data.message_id===e.message_id),'event delivered');
    assert.equal(deliveries.filter(x=>x.data.data.message_id===e.message_id).length,1);
    assert.equal(value(await tool('robut','poll',{since:0})).messages.length,0);
    assert.equal(value(await tool('openai','poll',{since:0})).messages[0].envelope.message_id,e.message_id,'HTTP acceptance did not ack');
    assert.equal(value(await tool('robut','ack',{id:e.message_id})).status,'unknown');
    const count=deliveries.length;
    assert.equal(value(await tool('openai','ack',{id:e.message_id})).status,'acked');
    assert.equal(value(await tool('openai','ack',{id:e.message_id})).status,'already_acked');
    await pause(250);assert.equal(deliveries.length,count,'ack emitted no event');
  });
  await t.test('retains protocol WAKE ACK ACK2 envelopes',async()=>{
    const wake=msg('robut','WAKE',{intent:'isolated handshake'});
    const ack=msg('openai','ACK',{ack_of:wake.message_id});ack.correlation_id=wake.correlation_id;
    const ack2=msg('robut','ACK2',{ack_of:ack.message_id});ack2.correlation_id=wake.correlation_id;
    for(const e of [wake,ack,ack2]){assert.equal(value(await tool(e.from,'send',{to:e.to,msg:e})).status,'accepted');const inbox=value(await tool(e.to,'poll',{since:0}));assert.ok(inbox.messages.some(m=>m.envelope.message_id===e.message_id));assert.equal(value(await tool(e.to,'ack',{id:e.message_id})).status,'acked');}
  });
  await t.test('concurrent duplicate sends commit one mailbox row and event',async()=>{
    const e=msg();const results=await Promise.all(Array.from({length:5},()=>tool('robut','send',{to:e.to,msg:e})));
    assert.equal(results.filter(r=>value(r).status==='accepted').length,1);
    assert.equal(results.filter(r=>value(r).status==='duplicate').length,4);
    await until(()=>deliveries.some(x=>x.data.data.message_id===e.message_id),'concurrent send delivered');
    assert.equal(deliveries.filter(x=>x.data.data.message_id===e.message_id).length,1);
    assert.equal(value(await tool('openai','poll',{since:0})).messages.filter(x=>x.envelope.message_id===e.message_id).length,1);
    await tool('openai','ack',{id:e.message_id});
  });
  await t.test('retries the same event after an actual runtime restart',async()=>{
    callbackStatus=503;const e=msg();await tool('robut','send',{to:e.to,msg:e});
    await until(()=>deliveries.some(x=>x.data.data.message_id===e.message_id),'first failed attempt');
    await until(async()=>value(await tool('openai','link_status')).deliveries.some(x=>x.message_id===e.message_id&&x.attempts===1),'failure persisted');
    const eventId=deliveries.find(x=>x.data.data.message_id===e.message_id).data.eventId;
    await mf.dispose();callbackStatus=200;mf=new Miniflare(options);await mf.ready;
    await until(()=>deliveries.filter(x=>x.data.eventId===eventId).length>=2,'retry after restart');
    assert.equal(value(await tool('openai','poll',{since:0})).messages[0].envelope.message_id,e.message_id);
    await until(async()=>value(await tool('openai','link_status')).deliveries.some(x=>x.id===eventId&&x.status==='accepted'),'accepted persisted');
    await tool('openai','ack',{id:e.message_id});
  });
  await t.test('permanent failure, secret rotation and unsubscribe',async()=>{
    keys.set('/events','whsec_'+randomBytes(32).toString('base64'));
    assert.equal((await rpc('openai','events/subscribe',subscription())).result.id,subId);
    callbackStatus=410;const e=msg();await tool('robut','send',{to:e.to,msg:e});
    await until(async()=>value(await tool('openai','link_status')).deliveries.some(x=>x.message_id===e.message_id&&x.status==='failed'),'410 terminal');
    const delivered=deliveries.find(x=>x.data.data.message_id===e.message_id);assert.equal(delivered.headers.get('webhook-signature').split(' ').length,2,'rotation dual-signs');
    const stop=subscription();delete stop.delivery.secret;delete stop.cursor;
    assert.deepEqual((await rpc('openai','events/unsubscribe',stop)).result,{});
    assert.deepEqual((await rpc('openai','events/unsubscribe',stop)).result,{});
    const before=deliveries.length;callbackStatus=200;const later=msg();await tool('robut','send',{to:later.to,msg:later});await pause(250);assert.equal(deliveries.length,before);
    assert.ok(value(await tool('openai','poll',{since:0})).messages.some(x=>x.envelope.message_id===later.message_id),'poll recovers without subscription');
  });
  await t.test('expired subscriptions cannot wake and messages remain recoverable',async()=>{
    keys.set('/short','whsec_'+randomBytes(32).toString('base64'));
    const short={...subscription('/short'),ttlMs:50};assert.ok((await rpc('openai','events/subscribe',short)).result.id);
    await until(async()=>value(await tool('openai','link_status')).subscriptions.length===0,'subscription expired');
    const count=deliveries.length,e=msg();await tool('robut','send',{to:e.to,msg:e});await pause(250);
    assert.equal(deliveries.length,count);
    assert.ok(value(await tool('openai','poll',{since:0})).messages.some(x=>x.envelope.message_id===e.message_id));
  });
  await t.test('concurrent callback verification cannot exceed the subscription cap',async()=>{
    await mf.setOptions({...options,bindings:{...options.bindings,CHANNEL_ID:'subscription-cap'}});
    let release;verificationBarrier=new Promise(resolve=>{release=resolve;});
    const before=verifications.length;
    const subscriptions=Array.from({length:6},(_,i)=>{
      const path=`/cap/${i}`;keys.set(path,'whsec_'+randomBytes(32).toString('base64'));
      return subscription(path);
    });
    const pending=Promise.all(subscriptions.map(s=>rpc('openai','events/subscribe',s)));
    try{await until(()=>verifications.length===before+6,'all six callbacks must overlap');}
    finally{release();verificationBarrier=undefined;}
    const results=await pending;
    assert.equal(results.filter(r=>r.result?.id).length,5,'exactly five subscriptions commit');
    assert.equal(results.filter(r=>r.error?.code===-32000).length,1,'sixth is rejected at commit');
    assert.equal(value(await tool('openai','link_status')).subscriptions.length,5);
    const refresh=subscriptions[results.findIndex(r=>r.result?.id)];
    assert.ok((await rpc('openai','events/subscribe',refresh)).result?.id,'refresh at capacity is allowed');
  });
  await t.test('mailbox tools have independent rate limits during recovery',async()=>{
    await mf.setOptions({...options,bindings:{...options.bindings,CHANNEL_ID:'rate-isolation'}});
    for(let i=0;i<60;i++){
      const e=msg();assert.equal(value(await tool('robut','send',{to:e.to,msg:e})).status,'accepted');
    }
    let since=0;
    for(let page=0;page<3;page++){
      const inbox=value(await tool('openai','poll',{since,limit:20}));assert.equal(inbox.messages.length,20);
      for(const item of inbox.messages)assert.equal(value(await tool('openai','ack',{id:item.envelope.message_id})).status,'acked');
      since=inbox.next_since;
    }
    assert.equal(value(await tool('openai','link_status')).pending,0,'status retains its own budget');
    const extra=msg('openai');assert.equal(value(await tool('openai','send',{to:extra.to,msg:extra})).status,'accepted','send retains its own budget');
    const limited=await rpc('openai','tools/call',{name:'ack',arguments:{id:randomUUID()}});
    assert.equal(limited.error?.code,-32029,'ack itself remains capped at 60');
  });
  await t.test('refreshes cannot extend cached callback verification indefinitely',async()=>{
    // Clock control exists only in this test subclass, never in the deployed
    // Worker. Exercise the real RPC and storage paths without a five-minute wait.
    const script=await readFile('dist/worker.js','utf8');
    await mf.setOptions({...options,scriptPath:undefined,script:script+'\nconst realClock=Date.now; export class ClockMailbox extends Mailbox { advanceClock(ms) { Date.now=()=>realClock()+ms; } }',durableObjects:{MAILBOX:{className:'ClockMailbox',useSQLite:true}},bindings:{...options.bindings,CHANNEL_ID:'verification-cache'}});
    const namespace=await mf.getDurableObjectNamespace('MAILBOX');
    const clock=namespace.get(namespace.idFromName('verification-cache'));
    keys.set('/cached','whsec_'+randomBytes(32).toString('base64'));
    const before=verifications.length;
    assert.ok((await rpc('openai','events/subscribe',subscription('/cached'))).result?.id);
    assert.equal(verifications.length,before+1);
    await clock.advanceClock(240000);
    assert.ok((await rpc('openai','events/subscribe',subscription('/cached'))).result?.id);
    assert.equal(verifications.length,before+1,'refresh within five minutes uses cached proof');
    await clock.advanceClock(360000);
    assert.ok((await rpc('openai','events/subscribe',subscription('/cached'))).result?.id);
    assert.equal(verifications.length,before+2,'six-minute-old proof must be reverified despite refresh');
  });
});
