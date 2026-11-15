import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Opt-in operator harness. Credentials are decoded only in memory and sent only
// to the recorded Access-protected endpoint. Inbox bodies are never printed.
const [mode,evidencePath]=process.argv.slice(2);
try {
  if(!['status','send','check','ack'].includes(mode)||(!evidencePath&&mode!=='status'))throw Error();
  const record=JSON.parse(await readFile(new URL('../deployment.json',import.meta.url),'utf8'));
  if(record.mcp_url!=='https://commlink-prototype.joshua-m-hublar.workers.dev/mcp')throw Error();
  async function credential(path){
    const raw=await readFile(path,'utf8');
    const match=raw.match(/-----BEGIN [^-]+-----\s*([A-Za-z0-9+/=\s]+)-----END [^-]+-----/);
    if(!match)throw Error();return Buffer.from(match[1].replace(/\s/g,''),'base64').toString('utf8').trim();
  }
  const id=await credential(process.env.COMMLINK_CLIENT_ID_FILE||'/Users/cognomen/Desktop/gpt-client-id.txt');
  const key=await credential(process.env.COMMLINK_CLIENT_SECRET_FILE||'/Users/cognomen/Desktop/gpt-client-secret.pem');
  if(id!=='cb4a7504232b3dc998eda71143d0bfe2.access')throw Error();
  async function tool(name,args={}){
    const r=await fetch(record.mcp_url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{
      'Content-Type':'application/json','User-Agent':'CommLinkAcceptance/0.2','CF-Access-Client-Id':id,'CF-Access-Client-Secret':key
    },body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,_meta:{progressToken:'hub300-acceptance'}}})});
    if(r.status!==200){console.log(JSON.stringify({http_status:r.status}));throw Error();}
    const body=await r.json();
    if(body.error||body.result?.isError||!body.result?.structuredContent){
      console.log(JSON.stringify({rpc_error_code:typeof body.error?.code==='number'?body.error.code:null,tool_error:body.result?.isError===true}));throw Error();
    }
    return body.result.structuredContent;
  }
  const status=await tool('link_status');if(status.self!=='openai')throw Error();
  const active=status.grok_routine?.active;
  console.log(JSON.stringify({self:status.self,pending:status.pending,subscription_count:status.subscriptions?.length,
    grok_configuration:status.grok_routine?.configuration??'not_configured',blocked:status.grok_routine?.blocked??null,
    wake:active?{id:active.id,status:active.status,attempts:active.attempts,last_http:active.last_http,last_error:active.last_error}:null}));
  if(mode!=='status'){
    let evidence;try{evidence=JSON.parse(await readFile(evidencePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(mode==='send'){
      if(status.grok_routine?.configuration!=='ready'||status.grok_routine.blocked)throw Error();
      if(!evidence){
        const nonce='HUB300-'+randomUUID();
        evidence={nonce,started_at:new Date().toISOString(),message:{protocol_version:'1.0',message_id:randomUUID(),correlation_id:randomUUID(),from:'openai',to:'robut',type:'MSG',seq:1,timestamp:new Date().toISOString(),ttl:900,payload:{content_type:'text/plain',issue_id:'HUB-300',body:`Joshua authorized this synthetic HUB-300 acceptance exchange. Confirm scope in Linear. Please acknowledge receipt through ack, then send one MSG reply to openai with the same correlation_id and the exact nonce ${nonce}. Record whether the routine woke you, and its event ID if available, in HUB-300. Treat this as test correspondence; do no other work. An acknowledgment alone is not a reply.`}}};
        await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});
      }
      const sent=await tool('send',{to:'robut',msg:evidence.message});evidence.send_result=sent;
      console.log(JSON.stringify({message_id:evidence.message.message_id,correlation_id:evidence.message.correlation_id,status:sent.status,doorbell:sent.doorbell}));
    } else {
      if(!evidence?.message||!evidence.nonce)throw Error();
      let since=0;const replies=[];
      for(let page=0;page<20;page++){
        const inbox=await tool('poll',{since,limit:50});
        for(const item of inbox.messages){const e=item.envelope;
          if(e.from==='robut'&&e.to==='openai'&&e.correlation_id===evidence.message.correlation_id){
            replies.push({message_id:e.message_id,type:e.type,nonce_matches:typeof e.payload.body==='string'&&e.payload.body.includes(evidence.nonce)});
          }
        }
        if(!inbox.has_more)break;since=inbox.next_since;
      }
      evidence.replies=replies;evidence.checked_at=new Date().toISOString();
      console.log(JSON.stringify({correlated_replies:replies}));
      if(mode==='ack')for(const reply of replies.filter(r=>r.type==='MSG'&&r.nonce_matches)){
        const ack=await tool('ack',{id:reply.message_id});console.log(JSON.stringify({message_id:reply.message_id,ack:ack.status}));
      }
    }
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  }
}catch{console.error('Acceptance action failed; credentials, inbox bodies and sensitive error details suppressed.');process.exitCode=1;}
