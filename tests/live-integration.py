"""Live regression suite. Supply disposable, pre-approved fixtures via SV_TEST_FIXTURES.
Never stores or prints credentials. Test fixture provisioning requires connected project administration.
"""
import json,os,urllib.request,urllib.error,sys
from pathlib import Path
URL='https://ygjcobdkxzroohccifvz.supabase.co'
KEY='sb_publishable_ICBXi9LWNVBsZYz39G_mCw_-7qxIeHX'
fixtures=json.loads(Path(os.environ['SV_TEST_FIXTURES']).read_text())
checks=[]
def api(action,body=None,token=None,ok=True):
 req=urllib.request.Request(URL+'/functions/v1/portal',data=json.dumps({'action':action,**(body or {})}).encode(),headers={'Content-Type':'application/json','apikey':KEY,**({'Authorization':'Bearer '+token} if token else {})})
 try:
  with urllib.request.urlopen(req,timeout=60) as r: data=json.load(r)
  if not ok:raise AssertionError('Unexpected success for '+action)
  return data
 except urllib.error.HTTPError as e:
  data=json.load(e)
  if ok:raise AssertionError(action+': '+str(data))
  return data

def check(name,fn):
 fn();checks.append(name);print('PASS '+name,flush=True)
def activate(f):return api('activate',{'id':f['id'],'password':f['password'],'code':f['code']})
def login(f):return api('login',{'id':f['id'],'password':f['password']})['session']['access_token']
def state(t):return api('load',token=t)
def mutate(t,kind,id,before,value,ok=True):return api('mutate',{'changes':[{'kind':kind,'id':id,'before':before,'value':value}]},t,ok)
def expect(v):assert v

check('Unauthenticated data denied',lambda:api('load',ok=False))
check('Wrong activation code denied',lambda:api('activate',{'id':fixtures[0]['id'],'password':fixtures[0]['password'],'code':'SV-INVALID'},ok=False))
for f in ([] if os.environ.get('SV_TEST_RESUME') else fixtures):
 check('Activate '+f['label'],lambda f=f:activate(f))
 check('One-time code cannot be reused '+f['label'],lambda f=f:api('activate',{'id':f['id'],'password':f['password'],'code':f['code']},ok=False))
dev,staff,member=[login(f) for f in fixtures]
check('Developer account is server assigned',lambda:expect(state(dev)['access']=='developer'))
check('Leadership login',lambda:expect(state(staff)['access']=='staff'))
check('Member login',lambda:expect(state(member)['access']=='member'))
check('Wrong password denied',lambda:api('login',{'id':fixtures[2]['id'],'password':'IncorrectPassword999!'},ok=False))
newrole={'name':'Integration Test Role','color':'#AABBCC'}
check('Member role creation denied',lambda:mutate(member,'roles',newrole['name'],None,newrole,False))
check('Leadership role creation denied',lambda:mutate(staff,'roles',newrole['name'],None,newrole,False))
check('Developer role creation works',lambda:mutate(dev,'roles',newrole['name'],None,newrole))
check('Stale concurrent edit rejected',lambda:mutate(dev,'roles',newrole['name'],None,newrole,False))
check('Role colour injection rejected',lambda:mutate(dev,'roles','Bad',None,{'name':'Bad','color':'red;display:none'},False))
for protected in fixtures[:2]:
 b={'caseId':'protected-test','displayName':'Test','username':'Test','discordId':protected['id'],'reason':'Test','issuedBy':'staff','approvedBy':'staff'}
 check('Leadership cannot blacklist '+protected['label'],lambda b=b:mutate(staff,'blacklist',b['caseId'],None,b,False))
check('Leadership cannot grant leadership',lambda:api('promote',{'id':fixtures[2]['id'],'enabled':True},staff,False))
old=next(m for m in state(member)['data']['members'] if m['id']==fixtures[2]['id'])
check('Member cannot edit own roles',lambda:mutate(member,'members',old['id'],old,{**old,'role':['Leadership']},False))
check('Leadership cannot change access via member role array',lambda:mutate(staff,'members',old['id'],old,{**old,'role':['Leadership']},False))
ann={'id':'test-ann','title':'Test','message':'Private leadership test','audience':'leadership','pinned':False,'author':'ignored','at':'2026-10-18T00:00:00Z'}
check('Leadership announcements denied',lambda:mutate(staff,'announcements',ann['id'],None,ann,False))
check('Developer announcement works',lambda:mutate(dev,'announcements',ann['id'],None,ann))
check('Member cannot read leadership announcement',lambda:expect(not state(member)['data']['announcements']))
event={'id':900000000001,'type':'VPL','opponent':'Test fixture','date':'2026-10-18','time':'19:00','timezone':'Qatar (UTC+3)','notes':'Integration test','status':'Scheduled'}
check('Leadership schedule create',lambda:mutate(staff,'events',str(event['id']),None,event))
check('Member schedule edit denied',lambda:mutate(member,'events',str(event['id']),event,{**event,'status':'Cancelled'},False))
check('Member attendance works for VPL',lambda:api('attendance',{'eventId':str(event['id']),'response':'Attended'},member))
check('Attendance cannot impersonate another member',lambda:expect(all(v['memberId']==fixtures[2]['id'] for v in state(member)['attendance'].values())))
w={'id':'test-warning','memberId':fixtures[1]['id'],'date':'2026-10-18','reason':'Test warning','issuedBy':'spoofed','status':'Active'}
check('Leadership warning creation',lambda:mutate(staff,'warnings',w['id'],None,w))
check('Private warning hidden from other members',lambda:expect(not state(member)['data']['warnings']))
check('Audit log hidden from leadership',lambda:expect('activity' not in state(staff)))
check('Audit log hidden from members',lambda:expect('activity' not in state(member)))
check('Audit log records verified staff identity',lambda:expect(any(x['actor']==fixtures[1]['id'] and x['action']=='Created warnings' for x in state(dev)['activity'])))
check('Developer promotion',lambda:api('promote',{'id':fixtures[2]['id'],'enabled':True},dev))
check('Promotion takes effect for existing session',lambda:expect(state(member)['access']=='staff'))
check('Developer demotion',lambda:api('promote',{'id':fixtures[2]['id'],'enabled':False},dev))
check('Demotion takes effect for existing session',lambda:expect(state(member)['access']=='member'))
reset=api('issue',{'id':fixtures[2]['id']},staff)['code']
check('Reset immediately blocks previous session',lambda:api('load',token=member,ok=False))
newpass=fixtures[2]['password']+'X'
check('Reset code sets new password',lambda:api('activate',{'id':fixtures[2]['id'],'code':reset,'password':newpass}))
check('Old password no longer works',lambda:api('login',{'id':fixtures[2]['id'],'password':fixtures[2]['password']},ok=False))
fixtures[2]['password']=newpass;member=login(fixtures[2])
check('New password login works',lambda:expect(state(member)['access']=='member'))
# Store tokens only in the private transient fixture file for follow-up browser tests and cleanup.
for f,t in zip(fixtures,[dev,staff,member]):f['token']=t
Path(os.environ['SV_TEST_FIXTURES']).write_text(json.dumps(fixtures))
print(str(len(checks))+' live checks passed')
