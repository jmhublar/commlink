import { readBody, object, exact, integer } from './protocol';

export interface CallbackEnv {
  CALLBACK_TRANSPORT_MODE?: string;
  CALLBACK_GATEWAY?: { fetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response> };
  CALLBACK_TRANSPORT_URL?: string;
  CALLBACK_ACCESS_CLIENT_ID?: string;
  CALLBACK_ACCESS_CLIENT_SECRET?: string;
}

// Data-free operational check through the exact delivery binding. No callback
// URL, credentials or mailbox payload is sent; errors stay categorized.
export async function callbackHealth(env:CallbackEnv) {
  const mode=env.CALLBACK_TRANSPORT_MODE??'access';
  if(mode!=='vpc')return {mode,reachable:null};
  if(!env.CALLBACK_GATEWAY||env.CALLBACK_TRANSPORT_URL||env.CALLBACK_ACCESS_CLIENT_ID||env.CALLBACK_ACCESS_CLIENT_SECRET)
    return {mode,reachable:false};
  try {
    const r=await env.CALLBACK_GATEWAY.fetch('http://commlink-callback.commlink.svc.cluster.local:8080/healthz',{
      redirect:'manual',signal:AbortSignal.timeout(2000)});
    if(r.status!==200){await r.body?.cancel();return {mode,reachable:false};}
    const value=object(JSON.parse(await readBody(r,1024)));exact(value,['ok']);
    return {mode,reachable:value.ok===true};
  } catch {return {mode,reachable:false};}
}

// The operator configures one owned gateway; a callback cannot choose this URL.
// Both verification and events must use it. There is no direct-fetch fallback.
export async function callbackPost(env:CallbackEnv,url:string,headers:Record<string,string>,body:string):Promise<Response> {
  const mode=env.CALLBACK_TRANSPORT_MODE??'access';
  let response:Response;
  const requestBody=JSON.stringify({url,headers,body});
  if(mode==='vpc') {
    // Authorization is the deployment's fixed VPC Service binding + private
    // network policy, not request headers. Never use a VPC Network binding here.
    if(!env.CALLBACK_GATEWAY||env.CALLBACK_TRANSPORT_URL||env.CALLBACK_ACCESS_CLIENT_ID||env.CALLBACK_ACCESS_CLIENT_SECRET)
      throw new Error('Invalid VPC callback transport configuration');
    response=await env.CALLBACK_GATEWAY.fetch('http://commlink-callback.commlink.svc.cluster.local:8080/v1/deliver',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json'},body:requestBody});
  } else if(mode==='access') {
    if(env.CALLBACK_GATEWAY||!env.CALLBACK_TRANSPORT_URL||!env.CALLBACK_ACCESS_CLIENT_ID||!env.CALLBACK_ACCESS_CLIENT_SECRET)
      throw new Error('Callback transport not configured');
    const target=new URL(env.CALLBACK_TRANSPORT_URL);
    if(target.protocol!=='https:'||target.username||target.password||target.port||target.search||target.hash||
      target.pathname!=='/v1/deliver'||/^[\d.]+$/.test(target.hostname)||target.hostname.includes(':'))
      throw new Error('Invalid callback transport configuration');
    response=await fetch(target.href,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{
      'content-type':'application/json','CF-Access-Client-Id':env.CALLBACK_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret':env.CALLBACK_ACCESS_CLIENT_SECRET,
    },body:requestBody});
  } else throw new Error('Invalid callback transport mode');
  if(response.status!==200){await response.body?.cancel();throw new Error('Callback transport failed');}
  const result=object(JSON.parse(await readBody(response,32768)));
  exact(result,['status','body']);
  const status=integer(result.status,200,599),text=typeof result.body==='string'?result.body:'';
  if(typeof result.body!=='string'||new TextEncoder().encode(text).length>4096||status>=300&&status<400)
    throw new Error('Invalid callback transport response');
  return new Response([204,205,304].includes(status)?null:text,{status});
}
