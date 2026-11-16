import menu from '../../session-control/roles-tiers.v1.json';
import inactivePolicy from '../../session-control/policies/standing.v1.json';
import type {JobBinding} from './job-reports';

export {menu};
export type Repository = {name:string;revision:string}|null;
export type SessionRequest = {
  kind:'session_request';schema_version:1;menu_version:string;menu_sha256:string;
  expected_policy_sha256:string;role:string;tier:string;job:string;linear_issue:string;
  environment:string;workdir:null;speed:'default';time_budget:{minutes:number;mode:'soft'|'hard'};
  context_refs:string[];repository:Repository;
};
export type PolicyRule = {id:string;roles:string[];tiers:string[];issues:string[];environments:string[];
  repositories:string[];allow_repo_free:boolean;max_minutes:number;allow_soft:boolean;operation_profile:string};
export type StandingPolicy = {schema_version:number;policy_id:string;version:number;state:string;subject:string;
  rules:PolicyRule[];limits:{concurrent_sessions:number;launches_per_rolling_hour:number};on_unknown:string;confirmation_required:string[]};
export type ExecutorProfile = {environment_config_id:string;runnable:boolean;permissions_verified:boolean;
  completion_wake_verified:boolean;hard_timeout_verified:boolean;model_efforts:string[];
  repository_revisions:string[];allow_repo_free:boolean;operation_profiles:string[];artifact_prefixes:string[]};
// Only a trusted operator configuration supplies this. There is intentionally
// no request, MCP tool, environment-variable switch or database activation API.
export type SessionConfiguration = {policy:StandingPolicy;activation:null|{policy_sha256:string;
  control_sha256:string;owner_receipt_verified:boolean;receipt_id:string;epoch:number;expires_at:number};
  paused:boolean;coordinator_keys:string[];profiles:Record<string,ExecutorProfile>;completion_owner_thread_id?:string|null;callback_jobs?:JobBinding[]};
export const inactiveSessionConfiguration:SessionConfiguration = {
  policy:inactivePolicy as StandingPolicy,activation:null,paused:true,coordinator_keys:[],profiles:{}
};
export const safetyFloor = ['credentials_or_access_changes','deploy','merge','purchase',
  'network_or_security_changes','policy_or_control_changes'] as const;
function wellFormed(s:string){return !Array.from(s).some(c=>{const n=c.codePointAt(0)!;return n>=0xd800&&n<=0xdfff;});}

// RFC8785 serialization for the bounded JSON domain used here. String keys use
// UTF-16 sorting, not the mailbox's historical localeCompare ordering. Reject
// invalid Unicode, non-JSON values and unsafe/nonintegral numbers before hash.
export function sessionCanonical(value:unknown):string {
  if(value===null)return 'null';
  if(typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value))throw Error('Invalid canonical value');
    return JSON.stringify(value);
  }
  if(typeof value==='string'){
    if(!wellFormed(value))throw Error('Invalid canonical value');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return '['+value.map(sessionCanonical).join(',')+']';
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
    return '{'+Object.keys(value).sort().map(k=>sessionCanonical(k)+':'+sessionCanonical((value as Record<string,unknown>)[k])).join(',')+'}';
  }
  throw Error('Invalid canonical value');
}
export async function sessionDigest(domain:string,value:unknown):Promise<string>{
  const bytes=new TextEncoder().encode(domain+'\n'+sessionCanonical(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function controlDigest(c:SessionConfiguration){return sessionDigest('commlink.control.v1',{menu,coordinator_keys:c.coordinator_keys,profiles:c.profiles,completion_owner_thread_id:c.completion_owner_thread_id??null,callback_jobs:c.callback_jobs??[]});}
export function activationValid(c:SessionConfiguration,policyHash:string,controlHash:string,now:number){const a=c.activation;
  return !!a&&a.owner_receipt_verified===true&&a.policy_sha256===policyHash&&a.control_sha256===controlHash&&
    typeof a.receipt_id==='string'&&!!a.receipt_id&&Number.isSafeInteger(a.epoch)&&a.epoch>=1&&a.expires_at>now;}
export type Decision={code:string;retryable:boolean;retry_after_seconds:number|null;fields:string[]};
export const decision=(code:string,fields:string[]=[],retryable=false,retryAfter:number|null=null):Decision=>
  ({code,retryable,retry_after_seconds:retryAfter,fields});
export class RequestError extends Error {constructor(public code:string,public fields:string[]=[]){super('Invalid session request');}}
const fail=(code='INVALID_REQUEST',fields:string[]=[]):never=>{throw new RequestError(code,fields);};
const record=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return fail();return v as Record<string,unknown>;
};
function keys(v:Record<string,unknown>,allowed:string[],required=allowed){
  if(Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!(k in v)))fail();
}
function text(v:unknown,max:number){if(typeof v!=='string'||!v.length||Array.from(v).length>max||!wellFormed(v)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))return fail();return v;}
export function strictSessionJson(raw:string):unknown{
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>8192||!wellFormed(raw))return fail();
  let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return fail();}
  const stack:{object:boolean;key:boolean;seen:Set<string>}[]=[];
  for(let i=0;i<raw.length;i++){
    const c=raw[i];
    if(c==='"'){
      const start=i;for(i++;i<raw.length;i++){if(raw[i]==='\\'){i++;continue;}if(raw[i]==='"')break;}
      const top=stack.at(-1);if(top?.object&&top.key){const key=JSON.parse(raw.slice(start,i+1));if(top.seen.has(key))fail();top.seen.add(key);top.key=false;}
    }else if(c==='{'||c==='['){stack.push({object:c==='{',key:c==='{',seen:new Set()});if(stack.length>16)fail();}
    else if(c==='}'||c===']')stack.pop();else if(c===','&&stack.at(-1)?.object)stack.at(-1)!.key=true;
  }
  return parsed;
}
export function parseSessionRequest(value:unknown):SessionRequest{
  const p=record(value);keys(p,['kind','schema_version','menu_version','menu_sha256','expected_policy_sha256','role','tier','job','linear_issue','environment','workdir','speed','time_budget','context_refs','repository'],
    ['kind','schema_version','menu_version','menu_sha256','expected_policy_sha256','role','job','linear_issue','environment','workdir','speed','time_budget','context_refs']);
  if(p.kind!=='session_request')fail();if(p.schema_version!==1)fail('UNSUPPORTED_VERSION');
  text(p.menu_version,80);
  for(const k of ['menu_sha256','expected_policy_sha256'])if(typeof p[k]!=='string'||!/^[a-f0-9]{64}$/.test(p[k] as string))fail();
  const role=text(p.role,32);if(!Object.hasOwn(menu.roles,role))fail('UNKNOWN_ROLE',['role']);
  const entry=menu.roles[role as keyof typeof menu.roles];const tier=p.tier===undefined?entry.default_tier:text(p.tier,32);
  if(!Object.hasOwn(menu.tiers,tier))fail('UNKNOWN_TIER',['tier']);
  if(p.speed!=='default')fail('UNSUPPORTED_CONTROL',['speed']);if(p.workdir!==null)fail('UNSUPPORTED_CONTROL',['workdir']);
  text(p.job,4096);const issue=text(p.linear_issue,32);if(!/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(issue))fail();
  const environment=text(p.environment,64);if(!/^[a-z][a-z0-9_-]*$/.test(environment))fail();
  const budget=record(p.time_budget);keys(budget,['minutes','mode']);
  if(!Number.isSafeInteger(budget.minutes)||Number(budget.minutes)<1||Number(budget.minutes)>30||(budget.mode!=='soft'&&budget.mode!=='hard'))fail();
  if(!Array.isArray(p.context_refs)||p.context_refs.length>16)fail();
  for(const ref of p.context_refs as unknown[]){if(!/^(linear:[A-Z][A-Z0-9]*-[1-9][0-9]*|github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40})$/.test(text(ref,180)))fail();}
  let repository:Repository=null;
  if(p.repository!==undefined&&p.repository!==null){const r=record(p.repository);keys(r,['name','revision']);
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text(r.name,160))||!/^[a-f0-9]{40}$/.test(text(r.revision,40)))fail();
    repository={name:r.name as string,revision:r.revision as string};}
  const result={...p,tier,repository} as SessionRequest;
  // Normalization adds only the documented role default and nullable repo.
  if(new TextEncoder().encode(sessionCanonical(result)).length>8192)fail();return result;
}
export function selection(r:SessionRequest){const role=menu.roles[r.role as keyof typeof menu.roles];return {role:r.role,tier:r.tier,model:role.model,
  effort:menu.tiers[r.tier as keyof typeof menu.tiers],speed:'default',effective_model:null,effective_effort:null,effective_speed:null};}
export function policyDecision(c:SessionConfiguration,policyHash:string,r:SessionRequest,now:number,controlHash:string):{decision:Decision;rule:PolicyRule|null}{
  const deny=(code:string,fields:string[]=[])=>({decision:decision(code,fields),rule:null});const p=c.policy;
  if(p.state!=='active'||!activationValid(c,policyHash,controlHash,now))return deny('POLICY_NOT_ACTIVE');
  if(c.paused)return deny('ADMISSIONS_PAUSED');
  if(r.expected_policy_sha256!==policyHash)return deny('POLICY_CHANGED');
  if(p.schema_version!==1||p.subject!=='robut'||p.on_unknown!=='hold'||p.limits.concurrent_sessions!==1||!Number.isSafeInteger(p.limits.launches_per_rolling_hour)||p.limits.launches_per_rolling_hour<1||p.limits.launches_per_rolling_hour>10||safetyFloor.some(k=>!p.confirmation_required.includes(k)))return deny('POLICY_INVALID');
  const rule=p.rules.find(x=>x.roles.includes(r.role)&&x.tiers.includes(r.tier)&&x.issues.includes(r.linear_issue)&&x.environments.includes(r.environment)&&
    (r.repository?x.repositories.includes(r.repository.name):x.allow_repo_free)&&r.time_budget.minutes<=x.max_minutes&&(r.time_budget.mode==='hard'||x.allow_soft));
  if(!rule)return deny('OUT_OF_SCOPE');
  if(rule.operation_profile!==menu.roles[r.role as keyof typeof menu.roles].operation||r.context_refs.some(ref=>
    ref.startsWith('linear:')?ref!=='linear:'+r.linear_issue:!r.repository||ref!=='github:'+r.repository.name+'@'+r.repository.revision))return deny('OUT_OF_SCOPE');
  const profile=c.profiles[r.environment];if(!profile?.runnable)return deny('ENVIRONMENT_UNAVAILABLE');
  const s=selection(r);
  if(!profile.permissions_verified||!profile.completion_wake_verified||!profile.operation_profiles.includes(rule.operation_profile)||
    !profile.model_efforts.includes(s.model+':'+s.effort)||!profile.environment_config_id||
    (r.repository?!profile.repository_revisions.includes(r.repository.name+'@'+r.repository.revision):!profile.allow_repo_free))return deny('EXECUTOR_UNVERIFIED');
  if(r.time_budget.mode==='hard'&&!profile.hard_timeout_verified)return deny('UNSUPPORTED_CONTROL',['time_budget.mode']);
  return {decision:decision('ELIGIBLE'),rule};
}
