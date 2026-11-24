"""Run against fresh local wrangler dev state; creates only local test records."""
import json, urllib.request, urllib.error, secrets, pathlib, os
from urllib.parse import urlparse
BASE=os.environ.get('TEST_BASE_URL','http://localhost:8787/api')
assert urlparse(BASE).hostname in ('localhost','127.0.0.1'), 'Integration tests must run locally'
secret=pathlib.Path(os.environ.get('TEST_SECRET_PATH','.dev.vars')).read_text().strip().split('=',1)[1]
password=secrets.token_urlsafe(20)
email='admin-'+secrets.token_hex(4)+'@example.test'
def request(path, method='GET', body=None, token=None, cookie=None, raw=None, content_type=None):
    headers={}
    if token: headers['Authorization']='Bearer '+token
    if cookie: headers['Cookie']=cookie
    if body is not None: headers['Content-Type']='application/json'
    if content_type: headers['Content-Type']=content_type
    req=urllib.request.Request(BASE+path,data=raw if raw is not None else json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
    try: r=urllib.request.urlopen(req)
    except urllib.error.HTTPError as e: r=e
    content=r.read()
    try: data=json.loads(content)
    except ValueError: data=content
    return r.status,data,r.headers
s,_,_=request('/setup','POST',{'email':email,'name':'Local admin','password':password},token=secret)
assert s==201, 'Use a fresh local DB for this integration test'
s,_,h=request('/auth/login','POST',{'email':email,'password':password});assert s==200
admin=h['Set-Cookie'].split(';')[0]
assert 'HttpOnly' in h['Set-Cookie'] and 'SameSite=Strict' in h['Set-Cookie']
_,a,_=request('/installations','POST');_,b,_=request('/installations','POST')
s,t,_=request('/tickets','POST',{'title':'iOS sync issue','body':'Logs attached','device':'iOS test'},token=a['token']);assert s==201
path='/tickets/'+t['id']
assert request(path,token=b['token'])[0]==404
assert request(path)[0]==401
assert request('/tickets',token=b['token'])[1]['total']==0
boundary='testboundary'
raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="diagnostic.log"\r\nContent-Type: text/plain\r\n\r\nsafe-test-log\r\n--{boundary}--\r\n').encode()
s,attachment,_=request(path+'/messages/'+t['messageId']+'/attachments','POST',token=a['token'],raw=raw,content_type='multipart/form-data; boundary='+boundary);assert s==201
assert request('/attachments/'+attachment['id'],token=b['token'])[0]==404
assert request('/attachments/'+attachment['id'],token=a['token'])[1]==b'safe-test-log'
s,agent,_=request('/staff/accounts','POST',{'email':'agent-'+email,'name':'Local agent','password':password},cookie=admin);assert s==201
_,_,h=request('/auth/login','POST',{'email':'agent-'+email,'password':password});agent_cookie=h['Set-Cookie'].split(';')[0]
assert request('/staff/accounts',cookie=agent_cookie)[0]==403
assert request(path+'/messages','POST',{'body':'Please try again'},cookie=agent_cookie)[0]==201
assert request(path,token=a['token'])[1]['status']=='waiting_user'
assert request(path,'PATCH',{'status':'closed'},token=a['token'])[0]==200
assert request(path+'/messages','POST',{'body':'Closed reply'},token=a['token'])[0]==409
assert request(path,'PATCH',{'status':'waiting_staff'},token=a['token'])[0]==200
# Assignment is staff-only, validates active employees, and supports list filters.
assert request(path,'PATCH',{'assigned_to':agent['id']},token=a['token'])[0]==403
assert request(path,'PATCH',{'assigned_to':'missing'},cookie=admin)[0]==400
assert request(path,'PATCH',{'assigned_to':agent['id']},cookie=admin)[0]==200
assert request('/tickets?assignee='+agent['id'],cookie=admin)[1]['total']==1
assert request('/tickets?assignee=unassigned',cookie=admin)[1]['total']==0
assert request('/overview',cookie=admin)[1]['waiting_staff']==1
for endpoint in ['/overview','/team','/staff/audit']:
    assert request(endpoint,token=a['token'])[0]==403
assert request('/staff/audit',cookie=agent_cookie)[0]==403
# Staff cannot reset another account; administrators cannot reset other admins here.
assert request('/staff/accounts/'+agent['id']+'/password','POST',{'password':password},cookie=agent_cookie)[0]==403
assert request('/staff/accounts/'+agent['id']+'/password','POST',{'password':'short'},cookie=admin)[0]==400
admin_id=request('/me',cookie=admin)[1]['id']
assert request('/staff/accounts/'+admin_id+'/password','POST',{'password':password},cookie=admin)[0]==403
reset_password=secrets.token_urlsafe(20)
assert request('/staff/accounts/'+agent['id']+'/password','POST',{'password':reset_password},cookie=admin)[0]==200
assert request('/me',cookie=agent_cookie)[0]==401
assert request('/auth/login','POST',{'email':'agent-'+email,'password':password})[0]==401
_,_,h=request('/auth/login','POST',{'email':'agent-'+email,'password':reset_password});agent_cookie=h['Set-Cookie'].split(';')[0]
# Password change checks the old password, revokes all sessions and leaves no secrets in audit.
assert request('/auth/password','POST',{'currentPassword':'wrong','password':password},cookie=agent_cookie)[0]==400
assert request('/auth/password','POST',{'currentPassword':reset_password,'password':'short'},cookie=agent_cookie)[0]==400
assert request('/auth/password','POST',{'currentPassword':reset_password,'password':password},cookie=agent_cookie)[0]==200
assert request('/me',cookie=agent_cookie)[0]==401
_,_,h=request('/auth/login','POST',{'email':'agent-'+email,'password':password});agent_cookie=h['Set-Cookie'].split(';')[0]
assert request('/staff/accounts/'+agent['id'],'PATCH',{'active':False},cookie=admin)[0]==200
assert request('/me',cookie=agent_cookie)[0]==401
assert request(path,'PATCH',{'assigned_to':agent['id']},cookie=admin)[0]==400
assert request(path,'PATCH',{'assigned_to':None},cookie=admin)[0]==200
assert request('/tickets?assignee=unassigned',cookie=admin)[1]['total']==1
logs=request('/staff/audit',cookie=admin)[1]
assert {'staff_created','password_reset','password_changed','staff_disabled','ticket_updated'} <= {x['action'] for x in logs['items']}
assert password not in json.dumps(logs) and reset_password not in json.dumps(logs)
print('PASS: assignment, password changes/reset, audit access,  anonymous isolation, private R2 upload/download, staff RBAC, reply lifecycle, cookie flags, session revocation')
