// Exercise the unchanged legacy renderers plus the live adapter without browser dependencies.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),nodes=new Map(),storage=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,readOnly:false,classList:{add(){},remove(){},toggle(){} ,contains(){return false}},insertAdjacentHTML(){},addEventListener(){},appendChild(){},click(){},remove(){}});return nodes.get(id)}
const ctx=vm.createContext({console,structuredClone,Map,Set,Date,JSON,Array,String,Number,Math,RegExp,Promise,Uint8Array,NodeFilter:{SHOW_TEXT:4},Blob,URL,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,alert:m=>{throw Error(m)},confirm:()=>true,
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},navigator:{clipboard:{writeText:async()=>{}}},
 document:{getElementById:node,querySelectorAll:()=>[],createTreeWalker:()=>({nextNode:()=>null}),createElement:()=>node('element'),body:node('body'),addEventListener(){}},fetch:()=>{throw Error('Unexpected network request')}});ctx.window=ctx;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const [,script]of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(script,ctx);
vm.runInContext(fs.readFileSync(path.join(root,'portal.js'),'utf8'),ctx);
const snapshot={me:'772822130236719136',access:'developer',data:{members:[{id:'772822130236719136',name:'Developer',role:['Owner','Developer'],status:'Active',joined:'2026-10-18'},{id:'999999999999999992',name:'Member',role:['Mafia'],status:'Active',joined:'2026-10-18'}],roles:[{name:'Developer',color:'#006E67'},{name:'Leadership',color:'#99AEB8'},{name:'Mafia',color:'#38E63D'}],events:[{id:900000000001,type:'VPL',opponent:'Test',date:'2026-10-18',time:'19:00',timezone:'UTC',notes:'',status:'Scheduled'}],warnings:[],loas:[],blacklist:[],requests:[],announcements:[]},attendance:{},accounts:{},codes:{},activity:[]};
ctx.snapshot=snapshot;vm.runInContext('svApply(snapshot)',ctx);
const pages=['dashboard','profile','timetable','attendance','roster','announcements','roles','leadership-admin','weekly-reports','activity','activations-admin','members-admin','timetable-admin','warnings-admin','loa-admin','blacklist'];
let count=0;
for(const p of pages){vm.runInContext(`go(${JSON.stringify(p)})`,ctx);assert.ok(node('content').innerHTML.length>20,'Empty '+p);count++}
// Every generated inline handler must compile as JavaScript after HTML attribute entity decoding.
for(const p of pages){vm.runInContext(`go(${JSON.stringify(p)})`,ctx);for(const m of node('content').innerHTML.matchAll(/on(?:click|change|input)="([^"]*)"/g)){const code=m[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');new vm.Script('(function(event){'+code+'})')}}
ctx.snapshot={...snapshot,me:'999999999999999992',access:'member'};vm.runInContext('svApply(snapshot);go("profile")',ctx);assert.ok(node('content').innerHTML.includes('999999999999999992'));assert.ok(!node('content').innerHTML.includes('Discord ID: 772822130236719136'));
vm.runInContext('page="roles";render()',ctx);assert.ok(node('content').innerHTML.includes('Team Dashboard')||node('content').innerHTML.includes('Active members'));
console.log('PASS '+count+' page renderers, generated handlers, correct member identity and guarded navigation');
ctx.snapshot=snapshot;vm.runInContext('svApply(snapshot)',ctx);
for(const call of ['eventForm()','memberForm()','warningForm()','loaForm()','roleForm()','blacklistForm()','announcementForm()']){
 vm.runInContext(call,ctx);assert.ok(node('modalContent').innerHTML.length>20,'Empty form '+call);
 for(const m of node('modalContent').innerHTML.matchAll(/on(?:click|change|input)="([^"]*)"/g))new vm.Script('(function(event){'+m[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')+'})');
}
console.log('PASS 7 modal forms and their generated handlers');
let submitted;
ctx.fetch=async(url,req)=>{submitted=JSON.parse(req.body);return {ok:true,status:200,json:async()=>snapshot}};
node('annTitle').value='Shared announcement';node('annMessage').value='Stored on the server';node('annAudience').value='all';node('annPinned').checked=false;
(async()=>{await vm.runInContext('saveAnnouncement("");svQueue',ctx);assert.equal(submitted.action,'mutate');assert.equal(submitted.changes[0].kind,'announcements');assert.equal(submitted.changes[0].value.title,'Shared announcement');console.log('PASS announcement form submits to shared backend');
 let csvBlob;ctx.URL={createObjectURL:b=>{csvBlob=b;return 'blob:test'},revokeObjectURL(){}};
 snapshot.activity=[{id:'1',at:'2026-10-18T09:00:00Z',actor:snapshot.me,action:'Updated event',target:'Test'}];
 snapshot.attendance={'900000000001:999999999999999992':{eventId:'900000000001',memberId:'999999999999999992',response:'Attended'}};
 snapshot.data.members[1].name='=DANGEROUS_FORMULA';node('reportWeek').value='2026-10-18';
 await vm.runInContext('svApply(snapshot);svDownloadReport()',ctx);const csv=await csvBlob.text();assert.ok(csv.includes('Attendance'));assert.ok(csv.includes('Staff Activity'));assert.ok(csv.includes("'=DANGEROUS_FORMULA"));assert.ok(csv.includes('VPL vs Test'));assert.ok(csv.includes('2026-10-12 to 2026-10-18'));
 console.log('PASS weekly CSV contains shared attendance/activity, neutralizes formulas, and uses timezone-safe dates');
 ctx.document.querySelectorAll=selector=>selector==='.roleCheck:checked'?[{value:'2'}]:[];
 vm.runInContext('svApply(snapshot);memberForm(0)',ctx);assert.equal(node('mId').readOnly,true);assert.equal(node('mStatus').disabled,true);
 node('mName').value='Promax';node('mJoined').value='2026-10-18';node('mId').value='999999999999999991';node('mStatus').value='Suspended';
 await vm.runInContext('saveMember(0);svQueue',ctx);const memberChange=submitted.changes.find(c=>c.kind==='members');assert.equal(memberChange.value.name,'Promax');assert.equal(memberChange.value.id,'772822130236719136');assert.equal(memberChange.value.status,'Active');assert.ok(memberChange.value.role.includes('Developer'));assert.ok(memberChange.value.role.includes('Mafia'));
 ctx.snapshot={...snapshot,access:'member',me:'999999999999999992'};vm.runInContext('svApply(snapshot)',ctx);assert.throws(()=>vm.runInContext('saveMember(0)',ctx),/Only the Developer/);
 console.log('PASS Developer profile editing preserves Discord ID, active status and Developer access; member edits denied')})().catch(e=>{console.error(e);process.exitCode=1});
