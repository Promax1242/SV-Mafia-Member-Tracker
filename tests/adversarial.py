import json,urllib.request,urllib.error,os
from pathlib import Path
f=json.loads(Path(os.environ['SV_TEST_FIXTURES']).read_text());URL='https://ygjcobdkxzroohccifvz.supabase.co';KEY='sb_publishable_ICBXi9LWNVBsZYz39G_mCw_-7qxIeHX'
def raw(path,body,token=None):
 req=urllib.request.Request(URL+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','apikey':KEY,**({'Authorization':'Bearer '+token}if token else {})})
 try:
  with urllib.request.urlopen(req,timeout=60) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def api(action,b={},t=None,ok=True):
 status,d=raw('/functions/v1/portal',{'action':action,**b},t)
 if ok:assert status==200,(action,d)
 else:assert status>=400,(action,'Unexpected success')
 return d
def change(t,k,id,b,v,ok=True):return api('mutate',{'changes':[{'kind':k,'id':id,'before':b,'value':v}]},t,ok)
def state(t):return api('load',t=t)
def test(n,fn):fn();print('PASS '+n,flush=True)
def expect(v):assert v
D,S,M=[x['token']for x in f]
test('Direct service RPC denied to anonymous clients',lambda:expect(raw('/rest/v1/rpc/portal_backend',{'op':'load'})[0]>=400))
test('Direct service RPC denied to authenticated member',lambda:expect(raw('/rest/v1/rpc/portal_backend',{'op':'load','actor':'00000000-0000-0000-0000-000000000000'},M)[0]>=400))
test('Direct Auth signup cannot squat an approved Discord ID',lambda:expect(raw('/auth/v1/signup',{'email':'888888888888888881@members.sv-mafia.invalid','password':'DirectSignupRejected999!'})[0]>=400))
test('Leadership cannot reset Developer',lambda:api('issue',{'id':f[0]['id']},S,False))
test('Leadership cannot reset Leadership',lambda:api('issue',{'id':f[1]['id']},S,False))
test('Member cannot issue activation codes',lambda:api('issue',{'id':f[1]['id']},M,False))
l={'id':'test-loa','memberId':f[2]['id'],'start':'2026-10-17','end':'2026-10-20','reason':'Test leave','recordedBy':'spoofed','cancelled':False}
test('Leadership can create LOA',lambda:change(S,'loas',l['id'],None,l))
test('Member sees own LOA with verified staff actor',lambda:expect(state(M)['data']['loas'][0]['recordedBy']==f[1]['id']))
w={'id':'own-warning','memberId':f[2]['id'],'date':'2026-10-18','reason':'Own test warning','issuedBy':'spoofed','status':'Active'}
test('Leadership can create own-member warning',lambda:change(S,'warnings',w['id'],None,w))
test('Member sees own warning',lambda:expect(len(state(M)['data']['warnings'])==1))
b={'caseId':'test-blacklist','displayName':'Test','username':'Test','discordId':f[2]['id'],'reason':'Test ban','issuedBy':'staff','approvedBy':'developer'}
test('Leadership can blacklist member',lambda:change(S,'blacklist',b['caseId'],None,b))
test('Blacklist immediately blocks existing member session',lambda:api('load',t=M,ok=False))
test('Leadership can revoke blacklist',lambda:change(S,'blacklist',b['caseId'],b,None))
test('Member cannot see private blacklist records',lambda:expect(state(M)['data']['blacklist']==[]))
m=next(x for x in state(S)['data']['members']if x['id']==f[2]['id'])
test('Leadership can suspend member',lambda:change(S,'members',m['id'],m,{**m,'status':'Suspended'}))
test('Suspension immediately blocks existing session',lambda:api('load',t=M,ok=False))
test('Leadership can reactivate member',lambda:change(S,'members',m['id'],{**m,'status':'Suspended'},m))
# PIR request/approval atomicity, including removal of the pending request.
rid='999999999999999993'
test('Public PIR request',lambda:api('request',{'id':rid,'name':'Integration Request'}))
r=next(x for x in state(S)['data']['requests']if x['id']==rid)
new={'id':rid,'name':r['name'],'role':['Mafia'],'status':'Active','joined':'2026-10-18'}
test('Atomic PIR approval',lambda:api('mutate',{'changes':[{'kind':'members','id':rid,'before':None,'value':new},{'kind':'requests','id':rid,'before':r,'value':None}]},S))
code=api('issue',{'id':rid},S)['code']
test('Code issuance remains server only',lambda:expect('hash' not in json.dumps(state(S)['codes'])))
print('20 additional integration checks passed',flush=True)
