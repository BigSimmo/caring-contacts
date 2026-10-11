"""Local, opt-in sanitised metadata export. No network or transcript capture."""
import argparse, datetime, hashlib, json, pathlib, re, subprocess
PROJECT = 'Caring Contacts'
REPOSITORY = 'BigSimmo/caring-contacts'
FIELDS = {'task_id','title','status','lifecycle','blocker','next_action','evidence','last_verified','source_reference','source_revision','dependencies','sanitised'}
STATUSES = {'In progress','Blocked','Needs you','Paused','Completed','Cancelled'}
def export(data, root, output):
    if set(data)-FIELDS or data.get('sanitised') is not True: raise ValueError('Only explicitly sanitised allowlisted metadata is accepted')
    if data.get('status') not in STATUSES or data.get('lifecycle') not in {'start','checkpoint','blocked','complete'}: raise ValueError('Invalid lifecycle/status')
    task=data.get('task_id','')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,119}',task): raise ValueError('Invalid stable task ID')
    for key in ['title','source_reference']:
        if not isinstance(data.get(key),str) or not data[key].strip(): raise ValueError('Required metadata missing')
    for key in ['title','source_reference','blocker','next_action','source_revision']:
        if key in data and (not isinstance(data[key],str) or len(data[key])>1000): raise ValueError('Invalid metadata text')
    if not isinstance(data.get('evidence',[]),list) or not all(isinstance(x,str) and len(x)<=1000 for x in data.get('evidence',[])): raise ValueError('Evidence must contain locations only')
    for dep in data.get('dependencies',[]):
        if set(dep)!={'project','task_id'} or dep['project'] not in {'Ward Flow','PsychSift','Caring Contacts','Communication'} or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,119}',dep['task_id']): raise ValueError('Invalid dependency link')
    last=data.get('last_verified')
    if last is not None:
        stamp=datetime.datetime.fromisoformat(last.replace('Z','+00:00'))
        if stamp.tzinfo is None or stamp>datetime.datetime.now(datetime.timezone.utc): raise ValueError('Verification time must be a past timezone-aware timestamp')
    if data['status']=='Completed' and (data['lifecycle']!='complete' or not data.get('evidence') or not last): raise ValueError('Completion requires verified evidence')
    if data['lifecycle']=='complete' and data['status']!='Completed': raise ValueError('Completion lifecycle/status mismatch')
    if data['lifecycle']=='blocked' and (data['status'] not in {'Blocked','Needs you'} or not data.get('blocker')): raise ValueError('Blocked receipt requires blocker')
    def git(*args):
        r=subprocess.run(['git','-C',str(root),*args],capture_output=True,text=True,check=True);return r.stdout.strip()
    def identity(url): return url.lower().removesuffix('.git').rstrip('/').replace('git@github.com:','https://github.com/')
    if identity(git('remote','get-url','origin')) != identity('https://github.com/'+REPOSITORY): raise ValueError('Wrong owning repository')
    head=git('rev-parse','HEAD')
    stale=not data.get('source_revision') or data['source_revision']!=head
    key=hashlib.sha256((REPOSITORY+'\n'+task).encode()).hexdigest()
    destination=pathlib.Path(output)/PROJECT.lower().replace(' ','-')/(key+'.json')
    record={'schema_version':1,'project':PROJECT,'repository':REPOSITORY,'source_identity':REPOSITORY+':'+task,'task':data,'observed_head':head,'stale_source':stale,'reconciliation':'pending; local export is not Notion delivery'}
    if destination.exists():
        previous=json.loads(destination.read_text(encoding='utf-8'))
        prior=previous['task'].get('last_verified')
        if prior and last and datetime.datetime.fromisoformat(last.replace('Z','+00:00'))<datetime.datetime.fromisoformat(prior.replace('Z','+00:00')): raise ValueError('Verification time cannot regress')
        if prior!=last and previous['task'].get('evidence')==data.get('evidence') and previous['task'].get('source_revision')==data.get('source_revision'): raise ValueError('Unchanged evidence cannot refresh Last verified')
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(record,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    return destination
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output-directory',required=True);p.add_argument('--repo',default=str(pathlib.Path(__file__).resolve().parent.parent));a=p.parse_args()
    try:
        source=pathlib.Path(a.input)
        if source.name.startswith('.env') or source.stat().st_size>32768: raise ValueError('Input is not a bounded metadata receipt')
        result=export(json.loads(source.read_text(encoding='utf-8')),pathlib.Path(a.repo),a.output_directory)
        print('Local sanitised receipt exported; Notion reconciliation remains pending.')
    except (ValueError,KeyError,TypeError,OSError,subprocess.SubprocessError):
        raise SystemExit('Receipt rejected; check metadata, repository identity and evidence. No input contents printed.')
