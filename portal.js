/* Live backend adapter for the existing SV | Mafia portal. No administrative secrets. */
const SV_URL='https://ygjcobdkxzroohccifvz.supabase.co';
const SV_KEY='sb_publishable_ICBXi9LWNVBsZYz39G_mCw_-7qxIeHX';
let svSession=null,svState=null,svBaseline=null,svQueue=Promise.resolve(),svBusy=false,svSaving=false;
for(const k of ['svmafia_demo','sv_mafia_demo_accounts','svmafia_pir_codes_v1','svmafia_activity_v1','svmafia_notices_v1','svmafia_announcements_v1','svmafia_attendance_v1'])localStorage.removeItem(k);
try{svSession=JSON.parse(sessionStorage.getItem('sv_session')||'null')}catch{}
const svSessionSave=s=>{svSession=s;if(s)sessionStorage.setItem('sv_session',JSON.stringify(s));else sessionStorage.removeItem('sv_session')};
async function svRefresh(){
 if(!svSession?.refresh_token)throw Error('Please sign in.');
 const r=await fetch(SV_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:SV_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:svSession.refresh_token})});
 const s=await r.json();if(!r.ok){svSessionSave(null);throw Error('Session expired. Sign in again.')}svSessionSave(s);
}
async function svApi(action,body={},retry=true){
 if(!['login','activate','request'].includes(action)&&svSession&&svSession.expires_at*1000<Date.now()+30000)await svRefresh();
 const r=await fetch(SV_URL+'/functions/v1/portal',{method:'POST',headers:{apikey:SV_KEY,'Content-Type':'application/json',...(svSession?{Authorization:'Bearer '+svSession.access_token}:{})},body:JSON.stringify({action,...body})});
 const result=await r.json();if(r.status===401&&retry&&svSession&&!['login','activate','request'].includes(action)){await svRefresh();return svApi(action,body,false)}if(!r.ok)throw Error(result.error||'Request failed');return result;
}
function svApply(s){
 svState=s;data=s.data;svBaseline=structuredClone(data);access=s.access;window.__svMemberId=s.me;window.demoCurrentMember=s.me;
 document.querySelectorAll('.developerOnly').forEach(x=>x.classList.toggle('hidden',access!=='developer'));
 document.querySelectorAll('.staffOnly').forEach(x=>x.classList.toggle('hidden',access==='member'));
 $('who').textContent=(currentMember()?.name||s.me)+' • '+(access==='staff'?'Leadership':access==='developer'?'Developer':'Member');
}
async function svLoad(){svApply(await svApi('load'));}
function svShowApp(){ $('login').classList.add('hidden');$('app').classList.remove('hidden');go('dashboard'); }
async function svAuthTask(task){if(svBusy)return;svBusy=true;document.querySelectorAll('#login button').forEach(b=>b.disabled=true);try{await task()}catch(e){alert(e.message)}finally{svBusy=false;document.querySelectorAll('#login button').forEach(b=>b.disabled=false)}}
memberLogin=()=>svAuthTask(async()=>{const r=await svApi('login',{id:val('authId'),password:$('authPassword').value});svSessionSave(r.session);$('authPassword').value='';await svLoad();svShowApp()});
memberSignup=()=>svAuthTask(async()=>{
 if($('signupPassword').value!==$('signupConfirm').value)throw Error('Passwords do not match.');
 await svApi('activate',{id:val('signupId'),code:val('signupCode'),password:$('signupPassword').value});
 $('authId').value=val('signupId');for(const id of ['signupPassword','signupConfirm','signupCode'])$(id).value='';authView('login');alert('Account ready. Sign in with your Discord ID and your new password.');
});
logout=async()=>{const token=svSession?.access_token;svSessionSave(null);svState=null;svBaseline=null;data={members:[],roles:[],events:[],warnings:[],loas:[],blacklist:[],announcements:[],requests:[]};access='member';$('app').classList.add('hidden');$('login').classList.remove('hidden');$('content').innerHTML='';closeModal();if(token)await fetch(SV_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:SV_KEY,Authorization:'Bearer '+token}}).catch(()=>{})};
currentMember=()=>data.members.find(m=>m.id===svState?.me);
svCurrentMember=currentMember;
currentIdentity=()=>svState?.me||'';
activityEntries=()=>svState?.activity||[];
announcements=()=>data.announcements||[];
announcementAudienceOK=()=>true; // The API only returns announcements this session may read.
notices=()=>[];
recordActivity=()=>{}; // Audit events are written by the database transaction, never by the browser.
demoAccounts=()=>svState?.accounts||{};
activationCodes=()=>svState?.codes||{};
saveActivationCodes=()=>{};
storeDemoAccounts=()=>{};
// Existing form handlers update local arrays; submit only their changed records, atomically.
persist=function(){
 const next=structuredClone(data),before=structuredClone(svBaseline),changes=[];
 const identity=(k,x)=>String(k==='roles'?x.name:k==='blacklist'?x.caseId:x.id);
 for(const kind of ['members','roles','events','warnings','loas','blacklist','announcements','requests']){
  const old=new Map((before?.[kind]||[]).map(x=>[identity(kind,x),x])),now=new Map((next[kind]||[]).map(x=>[identity(kind,x),x]));
  for(const id of new Set([...old.keys(),...now.keys()]))if(JSON.stringify(old.get(id))!==JSON.stringify(now.get(id)))changes.push({kind,id,before:old.get(id)||null,value:now.get(id)||null});
 }
 if(!changes.length)return svQueue;
 // Lock editing until the authoritative transaction completes, avoiding optimistic follow-up races.
 svSaving=true;document.querySelectorAll('#content button').forEach(b=>b.disabled=true);
 svQueue=svQueue.then(async()=>{try{const owner=svState?.me;const saved=await svApi('mutate',{changes});if(svState?.me===owner&&svSession)svApply(saved);}catch(e){alert('Changes were not saved: '+e.message);try{await svLoad()}catch{await logout()}}finally{svSaving=false;render()}});return svQueue;
};
const svLiveRender=render;
render=function(){
 const dev=['roles','leadership-admin','activity','weekly-reports'];const staff=['members-admin','timetable-admin','warnings-admin','loa-admin','blacklist','activations-admin','management'];
 if(!svState)return;
 if(dev.includes(page)&&access!=='developer'||staff.includes(page)&&access==='member'){page='dashboard'}
 svLiveRender();if(svSaving)document.querySelectorAll('#content button').forEach(b=>b.disabled=true);
 // Update operational descriptions while keeping the original components and CSS.
 const replacements=[
  ['The preview does not create real logins.','Accounts use approved PIR activation codes.'],
  ["Changes take effect in this local preview's member records.",'Changes are enforced by the server immediately.'],
  ['This report reflects only data stored in this browser preview.','This report uses shared server data.'],
  ['Developer preview displays extended audit details. Production requires server-side immutable audit logs.','Audit entries are generated by the server and cannot be edited through the portal.']
 ];
 const walker=document.createTreeWalker($('content'),NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){for(const [from,to]of replacements)node.textContent=node.textContent.replace(from,to)}
};
function svCodeModal(id,code){modal('One-time Activation / Reset Code',`<p>Send this privately through the verified PIR ticket for Discord ID ${safe(id)}. It expires after 24 hours and is shown only now.</p><div class="notice" style="overflow-wrap:anywhere;font-size:18px">${safe(code)}</div><p>Use Set Up Account with this code to choose a password. Reset codes invalidate previous sessions immediately.</p><button class="btn" id="copyLiveCode">Copy Code</button>`);$('copyLiveCode').onclick=()=>navigator.clipboard.writeText(code).catch(()=>alert('Select the code above to copy it.'))}
generatePirCode=async id=>{try{const r=await svApi('issue',{id});await svLoad();render();svCodeModal(id,r.code)}catch(e){alert(e.message)}};
showPirCode=()=>alert('Codes are shown once when issued. Generate a replacement if needed.');
revokePirCode=async id=>{if(!confirm('Revoke this code?'))return;try{await svApi('revoke',{id});await svLoad();render()}catch(e){alert(e.message)}};
resetDemoPassword=async i=>{const m=data.members[i];if(!m||!confirm('Issue a password reset code for '+m.name+'? Their existing sessions will be revoked.'))return;await generatePirCode(m.id)};
grantLeadership=async()=>{const id=val('leadershipCandidate');if(!confirm('Grant Leadership access?'))return;try{await svApi('promote',{id,enabled:true});await svLoad();render()}catch(e){alert(e.message)}};
revokeLeadership=async id=>{if(!confirm('Remove Leadership access?'))return;try{await svApi('promote',{id,enabled:false});await svLoad();render()}catch(e){alert(e.message)}};
activationPage=function(){
 const codes=activationCodes(),accounts=demoAccounts();return `<div class="card"><h2>PIR Requests</h2><p>Verify the applicant through their Discord PIR ticket before approving. Send activation codes privately.</p>${(data.requests||[]).map(r=>`<div class="event"><div><strong>${safe(r.name)}</strong><span>${safe(r.id)}</span></div><div class="actions"><button class="btn small" onclick="svApprove('${safe(r.id)}')">Approve</button><button class="btn danger small" onclick="svReject('${safe(r.id)}')">Reject</button></div></div>`).join('')||'<p>No pending requests.</p>'}</div><div class="section card"><h2>PIR Activation Codes</h2><p>Codes expire in 24 hours, work once, and are shown only on issue. Password resets use the same Set Up Account screen.</p><div class="tablewrap"><table><thead><tr><th>Member</th><th>Discord ID</th><th>Account</th><th>Code status</th><th>Expires</th><th>Actions</th></tr></thead><tbody>${data.members.map(m=>`<tr><td>${safe(m.name)}</td><td>${safe(m.id)}</td><td>${accounts[m.id]?'Registered':'Not registered'}</td><td>${activationStatus(codes[m.id])}</td><td>${codes[m.id]?new Date(codes[m.id].expires).toLocaleString():'—'}</td><td>${!m.role.includes('Developer')&&m.status==='Active'?(m.role.includes('Leadership')&&access!=='developer'?'Developer managed':`<button class="btn small" onclick="generatePirCode('${m.id}')">${accounts[m.id]?'Reset password':'Issue code'}</button> <button class="btn secondary small" onclick="revokePirCode('${m.id}')">Revoke code</button>`):'—'}</td></tr>`).join('')}</tbody></table></div></div>`;
};
window.svApprove=async id=>{const r=data.requests.find(x=>x.id===id);if(!r)return;try{data.members.push({id,name:r.name,role:['Mafia','Verified Member'],status:'Active',joined:todayLocal()});data.requests=data.requests.filter(x=>x.id!==id);await persist();render()}catch(e){alert(e.message)}};
window.svReject=async id=>{data.requests=data.requests.filter(x=>x.id!==id);await persist();render()};
svRead=key=>key===svAttendanceKey?svAttendanceRead():{};
window.svAttendanceRead=()=>{const a={};for(const x of Object.values(svState?.attendance||{})){a[x.eventId]||={};a[x.eventId][x.memberId]=x.response}return a};
svReact=async(id,response)=>{try{await svApi('attendance',{eventId:String(id),response});await svLoad();render()}catch(e){alert(e.message)}};
// Correct the original attendance button quoting and include both Scrim and VPL events.
svAttendancePage=function(){const a=svAttendanceRead(),me=currentMember();return `<div class="card"><h2>Match Attendance</h2><p>Record your attendance for Scrims and VPL. Leadership can review all responses.</p>${[...data.events].sort((x,y)=>y.date.localeCompare(x.date)).map(e=>{const record=a[e.id]||{},value=record[me?.id]||'';return `<div class="event" style="display:block"><span class="tag">${safe(e.type)}</span><strong>SV | Mafia vs ${safe(e.opponent)}</strong><div class="muted">${safe(e.date)} • ${safe(e.time)} • ${safe(e.status)}</div><div class="actions" style="margin-top:13px">${['Attended','Missed','Unsure'].map(r=>`<button class="btn small ${value===r?'':'secondary'}" onclick="svReact('${e.id}','${r}')">${r}</button>`).join('')}</div>${access!=='member'?`<details style="margin-top:12px"><summary>Player responses</summary><table><tbody>${data.members.filter(m=>m.status==='Active').map(m=>`<tr><td>${safe(m.name)}</td><td>${safe(record[m.id]||'No response')}</td></tr>`).join('')}</tbody></table></details>`:''}</div>`}).join('')||'<div class="empty">No matches scheduled.</div>'}</div>`};
const oldDownload=svDownloadReport;
svDownloadReport=async()=>{try{await svLoad();oldDownload()}catch(e){alert(e.message)}};
// Extend the existing auth card using its existing field/button styles.
$('authLogin').insertAdjacentHTML('beforeend','<p><button class="btn secondary small" onclick="svRequestForm()">Request PIR approval</button> <button class="btn secondary small" onclick="authView(\'signup\')">Use a reset code</button></p>');
window.svRequestForm=()=>modal('Request PIR Approval','<p>Leadership will verify you through your Discord PIR ticket.</p><div class="field"><label>Discord ID</label><input id="pirId" inputmode="numeric"></div><div class="field"><label>Display name</label><input id="pirName" maxlength="100"></div><button class="btn" onclick="svRequest()">Submit Request</button>');
window.svRequest=async()=>{try{await svApi('request',{id:val('pirId'),name:val('pirName')});closeModal();alert('Request submitted. Contact Leadership through your Discord PIR ticket.')}catch(e){alert(e.message)}};
$('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter')memberLogin()});
// Refresh on return without interrupting an open form. Every write rechecks permissions.
document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&svSession&&!$('modalbg').classList.contains('show')){try{await svLoad();render()}catch{await logout()}}});
(async()=>{if(svSession){try{await svLoad();svShowApp()}catch{await logout()}}})();
const svWarningForm=warningForm;warningForm=function(...args){svWarningForm(...args);if($('wStaff')){$('wStaff').value=currentIdentity();$('wStaff').readOnly=true}};
const svLoaForm=loaForm;loaForm=function(...args){svLoaForm(...args);if($('loaStaff')){$('loaStaff').value=currentIdentity();$('loaStaff').readOnly=true}};
saveAnnouncement=function(id){
 if(access!=='developer')return;
 const title=val('annTitle'),message=val('annMessage'),audience=val('annAudience'),pinned=$('annPinned').checked;
 if(!title||!message)return alert('Enter a title and message.');
 const old=data.announcements.find(x=>x.id===id),entry={id:old?.id||crypto.randomUUID(),title,message,audience,pinned,author:currentIdentity(),at:old?.at||new Date().toISOString()};
 if(old)data.announcements[data.announcements.indexOf(old)]=entry;else data.announcements.unshift(entry);
 persist();closeModal();render();
};
deleteAnnouncement=function(id){if(access!=='developer'||!confirm('Delete this announcement?'))return;data.announcements=data.announcements.filter(x=>x.id!==id);persist();render()};
svWeekDates=function(){const end=$('reportWeek')?.value||todayLocal(),start=new Date(end+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-6);return {start:start.toISOString().slice(0,10),end}};
// Allow the verified Developer to edit their profile without changing protected access.
const svMemberForm=memberForm;
memberForm=function(i){
 svMemberForm(i);
 const m=i===undefined?null:data.members[i];
 if(m?.role.includes('Developer')){
  $('mId').readOnly=true;$('mStatus').disabled=true;
  document.querySelectorAll('#modalContent button').forEach(b=>{if(/^(resetDemoPassword|removeMember)\(/.test(b.getAttribute('onclick')||''))b.classList.add('hidden')});
 }
};
const svSaveMember=saveMember;
saveMember=function(i){
 const old=i===null?null:data.members[i];
 if(!old?.role.includes('Developer'))return svSaveMember(i);
 if(access!=='developer'||old.id!==svState?.me)return alert('Only the Developer can edit this profile.');
 const name=val('mName'),joined=val('mJoined');
 if(!name||name.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(joined))return alert('Enter a display name and valid join date.');
 const selected=[...document.querySelectorAll('.roleCheck:checked')].map(x=>data.roles[Number(x.value)]?.name).filter(r=>r&&!['Developer','Leadership'].includes(r));
 const protectedRoles=old.role.filter(r=>['Developer','Leadership'].includes(r));
 data.members[i]={...old,name,joined,role:[...new Set([...selected,...protectedRoles])]};
 persist();closeModal();render();
};
