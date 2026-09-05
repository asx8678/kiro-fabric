import os, pathlib, json, subprocess, sys, time
out=pathlib.Path(__file__).resolve().parent
s=json.loads((out/'sandbox.json').read_text()); base=pathlib.Path(s['sandbox']); repo=s['repo']
id,seconds,*cmd=sys.argv[1:]; env={'PATH':os.environ['PATH'],'HOME':str(base/'home'),'KIRO_HOME':str(base/'kiro-home'),'TMPDIR':str(base/'tmp'),'LANG':'C.UTF-8','CI':'true','NO_COLOR':'1'}
start=time.monotonic(); status='not run'; code=None
try:
 r=subprocess.run(cmd,cwd=repo,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=int(seconds)); output=r.stdout; code=r.returncode; status='passed' if code==0 else 'failed'
except subprocess.TimeoutExpired as e:
 output=e.stdout or ''; output=output.decode(errors='replace') if isinstance(output,bytes) else output; status='timed out'
except Exception as e: output=str(e); status='failed'
record={'id':id,'command':cmd,'cwd':repo,'environment':env,'deadlineSeconds':int(seconds),'elapsedSeconds':round(time.monotonic()-start,3),'status':status,'exitCode':code,'output':output}
(out/(id+'.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({k:v for k,v in record.items() if k not in ['environment','output']},indent=2)); print(output[-6500:]); sys.exit(0 if status=='passed' else 1)
