import { readBody, object, exact, integer } from './protocol';

export interface CallbackEnv {
  CALLBACK_TRANSPORT_URL?: string;
  CALLBACK_ACCESS_CLIENT_ID?: string;
  CALLBACK_ACCESS_CLIENT_SECRET?: string;
}

// The operator configures one owned gateway; a callback cannot choose this URL.
// Both verification and events must use it. There is no direct-fetch fallback.
export async function callbackPost(env:CallbackEnv,url:string,headers:Record<string,string>,body:string):Promise<Response> {
  if(!env.CALLBACK_TRANSPORT_URL||!env.CALLBACK_ACCESS_CLIENT_ID||!env.CALLBACK_ACCESS_CLIENT_SECRET)
    throw new Error('Callback transport not configured');
  const target=new URL(env.CALLBACK_TRANSPORT_URL);
  if(target.protocol!=='https:'||target.username||target.password||target.port||target.search||target.hash||
    target.pathname!=='/v1/deliver'||/^[\d.]+$/.test(target.hostname)||target.hostname.includes(':'))
    throw new Error('Invalid callback transport configuration');
  const response=await fetch(target.href,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{
    'content-type':'application/json','CF-Access-Client-Id':env.CALLBACK_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret':env.CALLBACK_ACCESS_CLIENT_SECRET,
  },body:JSON.stringify({url,headers,body})});
  if(response.status!==200){await response.body?.cancel();throw new Error('Callback transport failed');}
  const result=object(JSON.parse(await readBody(response,32768)));
  exact(result,['status','body']);
  const status=integer(result.status,200,599),text=typeof result.body==='string'?result.body:'';
  if(typeof result.body!=='string'||new TextEncoder().encode(text).length>4096||status>=300&&status<400)
    throw new Error('Invalid callback transport response');
  return new Response([204,205,304].includes(status)?null:text,{status});
}
