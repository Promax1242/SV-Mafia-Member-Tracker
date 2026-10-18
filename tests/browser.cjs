const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const fs=require('fs');
(async()=>{
 const fixtures=JSON.parse(fs.readFileSync(process.env.SV_TEST_FIXTURES));
 const browser=await chromium.launch({headless:true});let count=0;
 for(const f of fixtures){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];const dialogs=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.accept()});
  await page.route('https://botond735.github.io/SV-Mafia-Member-Tracker/**',route=>{const file=route.request().url().endsWith('portal.js')?'portal.js':'index.html';return route.fulfill({path:require('path').join(__dirname,'..',file),contentType:file.endsWith('.js')?'text/javascript':'text/html'})});
  await page.goto('https://botond735.github.io/SV-Mafia-Member-Tracker/');
  await page.fill('#authId',f.id);await page.fill('#authPassword',f.password);await page.click('#authLogin > button');
  await page.waitForSelector('#app:not(.hidden)',{timeout:60000});
  for(const p of ['dashboard','profile','timetable','attendance','roster','announcements',...(f.label==='Member'?[]:['activations-admin','members-admin','timetable-admin','warnings-admin','loa-admin','blacklist']),...(f.label==='Developer'?['roles','leadership-admin','weekly-reports','activity']:[])]){
   await page.locator('.nav[data-page="'+p+'"]').click();if(!await page.locator('#content').innerText())throw Error('Empty '+p);count++;
  }
  if(f.label==='Developer'){
   await page.locator('.nav[data-page="weekly-reports"]').click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export Weekly CSV'}).click();const path=await(await download).path();const csv=fs.readFileSync(path,'utf8');if(!csv.includes('Attendance')||!csv.includes('Staff Activity'))throw Error('CSV missing shared records');
   await page.locator('.nav[data-page="dashboard"]').click();await page.screenshot({path:'/tmp/sv-dashboard.png',fullPage:true});
  }
  if(f.label==='Member'){
   if(await page.locator('.developerOnly:visible,.staffOnly:visible').count())throw Error('Privileged navigation visible to member');
   await page.locator('.nav[data-page="attendance"]').click();const load=page.waitForResponse(r=>r.url().includes('/portal')&&r.request().postData()?.includes('"action":"load"'));await page.getByRole('button',{name:'Unsure',exact:true}).first().click();await load;
   await page.reload();await page.waitForSelector('#app:not(.hidden)');await page.locator('.nav[data-page="attendance"]').click();if(!await page.getByRole('button',{name:'Unsure',exact:true}).first().evaluate(e=>!e.classList.contains('secondary')))throw Error('Attendance did not persist');
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/sv-mobile.png',fullPage:true});
  }
  if(errors.length||dialogs.length)throw Error(JSON.stringify({label:f.label,errors,dialogs}));
  console.log('PASS '+f.label+' browser pages, login and visibility');await context.close();
 }
 await browser.close();console.log(count+' page views passed');
})().catch(e=>{console.error(e);process.exit(1)});
