import { createClient } from 'npm:@supabase/supabase-js@2.95.3';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origin='https://botond735.github.io';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
const email=(id:string)=>id+'@members.sv-mafia.invalid';
const idOK=(id:unknown)=>typeof id==='string'&&/^\d{15,22}$/.test(id);
function fail(message:string):never{throw new Error(message)}
async function rpc(op:string,body:unknown={},actor:string|null=null,session:string|null=null){const {data,error}=await admin.rpc('portal_backend',{op,body,actor,session});if(error)fail(error.message);return data;}
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function password(p:unknown){if(typeof p!=='string'||p.length<12||p.length>128)fail('Use a password between 12 and 128 characters.');return p as string;}
function text(v:unknown,max=3000){return typeof v==='string'&&v.length>0&&v.length<=max;}
function date(v:unknown){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v+'T00:00:00Z'));}
// Validate every user-controlled value, including identifiers used by the legacy inline handlers.
export function validateChanges(changes:any){
 if(!Array.isArray(changes)||!changes.length||changes.length>150)fail('Invalid changes');
 for(const c of changes){
  if(!text(c.id,100)||/[\x00-\x1f<>"'`\\]/.test(c.id))fail('Invalid record ID');
  const v=c.value;if(v===null)continue;
  if(!v||typeof v!=='object'||Array.isArray(v)||JSON.stringify(v).length>16000)fail('Invalid record');
  let valid=false;
  switch(c.kind){
   case 'members': valid=idOK(c.id)&&v.id===c.id&&text(v.name,100)&&Array.isArray(v.role)&&v.role.length<=80&&v.role.every((r:any)=>text(r,80))&&['Active','Suspended','Removed'].includes(v.status)&&date(v.joined);break;
   case 'roles': valid=v.name===c.id&&text(v.name,80)&&/^#[0-9a-fA-F]{6}$/.test(v.color);break;
   case 'events': valid=String(v.id)===c.id&&/^\d{1,16}$/.test(c.id)&&['Scrim','VPL'].includes(v.type)&&text(v.opponent,100)&&date(v.date)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)&&text(v.timezone,80)&&typeof v.notes==='string'&&v.notes.length<=3000&&['Scheduled','Postponed','Cancelled','Completed'].includes(v.status);break;
   case 'warnings': valid=v.id===c.id&&idOK(v.memberId)&&date(v.date)&&text(v.reason)&&text(v.issuedBy,100)&&['Active','Resolved'].includes(v.status);break;
   case 'loas': valid=v.id===c.id&&idOK(v.memberId)&&date(v.start)&&date(v.end)&&v.end>=v.start&&typeof v.reason==='string'&&v.reason.length<=3000&&text(v.recordedBy,100)&&typeof v.cancelled==='boolean';break;
   case 'blacklist': valid=v.caseId===c.id&&idOK(v.discordId)&&['displayName','username','reason','issuedBy','approvedBy'].every(x=>text(v[x]));break;
   case 'announcements':valid=v.id===c.id&&text(v.title,120)&&text(v.message)&&['all','leadership','vpl','mafia'].includes(v.audience)&&typeof v.pinned==='boolean';break;
   case 'requests':valid=false;break;
  }
  if(!valid)fail('Invalid '+c.kind+' record');
 }
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return reply({error:'Origin denied'},403);
 try{
  const raw=await req.text();if(raw.length>200000)fail('Request too large');const b=JSON.parse(raw);const action=b.action;
  const publicActions=['login','activate','request'];
  let actor:string|null=null,session:string|null=null;
  if(publicActions.includes(action)){
   const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
   const key=await hash(action+':'+ip);if(!await rpc('limit',{key,max:action==='request'?5:30}))return reply({error:'Too many attempts. Try again in 10 minutes.'},429);
   if(!idOK(b.id))fail('Enter a valid Discord ID');
  }else{
   const token=req.headers.get('authorization')?.replace(/^Bearer /i,'');if(!token)return reply({error:'Sign in required'},401);
   const {data,error}=await admin.auth.getUser(token);if(error||!data.user)return reply({error:'Session expired. Sign in again.'},401);
   actor=data.user.id;
   // Payload is parsed only after Auth has cryptographically validated the token.
   const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));session=claims.session_id;
   if(!session)return reply({error:'Session required'},401);
  }
  if(action==='request'){
   if(!text(b.name,100))fail('Enter your display name');await rpc('request',{id:b.id,name:b.name,at:new Date().toISOString()});return reply({ok:true});
  }
  if(action==='login'){
   if(typeof b.password!=='string'||b.password.length>128)fail('Invalid credentials');
   const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data,error}=await client.auth.signInWithPassword({email:email(b.id),password:b.password});if(error||!data.session)return reply({error:'Invalid Discord ID or password'},401);
   try{const claims=JSON.parse(atob(data.session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));await rpc('load',{},data.user.id,claims.session_id);}catch{await client.auth.signOut();return reply({error:'Account unavailable. Contact Leadership for approval or a reset code.'},403);}
   return reply({session:data.session});
  }
  if(action==='activate'){
   password(b.password);if(typeof b.code!=='string'||b.code.length>100)fail('Invalid activation code');
   const claim=await rpc('claim',{id:b.id,hash:await hash(b.code.trim().toUpperCase())});let created:string|null=null;
   try{
    let uid=claim.userId;
    if(uid){const {error}=await admin.auth.admin.updateUserById(uid,{password:b.password});if(error)throw error;}
    else{const {data,error}=await admin.auth.admin.createUser({id:claim.provisionId,email:email(b.id),password:b.password,email_confirm:true,app_metadata:{sv_provisioned:true,discord_id:b.id}});if(error)throw error;uid=data.user.id;created=uid;}
    await rpc('finish',{id:b.id,claim:claim.claim,userId:uid});return reply({ok:true});
   }catch(error){if(created)await admin.auth.admin.deleteUser(created);await rpc('release',{id:b.id,claim:claim.claim});throw error;}
  }
  if(action==='load')return reply(await rpc('load',{},actor,session));
  if(action==='mutate'){
   validateChanges(b.changes);
   // Staff names and announcement timestamps come from the verified session, not the form.
   const state=await rpc('load',{},actor,session);
   for(const c of b.changes){if(c.value&&c.kind==='announcements'){c.value.author=state.me;c.value.at=c.before?.at||new Date().toISOString();}if(c.value&&c.kind==='warnings')c.value.issuedBy=state.me;if(c.value&&c.kind==='loas')c.value.recordedBy=state.me;}
   await rpc('mutate',{changes:b.changes},actor,session);return reply(await rpc('load',{},actor,session));
  }
  if(action==='issue'){
   if(!idOK(b.id))fail('Invalid Discord ID');const code='SV-'+Array.from(crypto.getRandomValues(new Uint8Array(20))).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
   await rpc('issue',{id:b.id,hash:await hash(code)},actor,session);return reply({code});
  }
  if(action==='revoke'||action==='promote'){
   if(!idOK(b.id)||action==='promote'&&typeof b.enabled!=='boolean')fail('Invalid member');await rpc(action,{id:b.id,enabled:b.enabled},actor,session);return reply({ok:true});
  }
  if(action==='attendance'){await rpc('attendance',{eventId:String(b.eventId),response:b.response},actor,session);return reply({ok:true});}
  return reply({error:'Unknown action'},400);
 }catch(error){const message=error instanceof Error?error.message:'Request failed';return reply({error:message},400);}
});
