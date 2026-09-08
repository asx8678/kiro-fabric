#!/usr/bin/env python3
"""Audit-only bounded logger and disposable snapshot utility. No live source writes."""
import os, sys, json, time, subprocess, pathlib, hashlib, shutil, tempfile, re, signal
ROOT = pathlib.Path("/home/adam/projects/kiro-fabric")
OUT = ROOT / "audits/2026-09-08-repository-audit"
EVIDENCE = OUT / "evidence"
def write(name, data):
    (EVIDENCE/name).write_text(json.dumps(data, indent=2)+"\n")
def git(*args):
    return subprocess.check_output(["git",*args],cwd=ROOT,timeout=30).decode()
def manifest():
    names=sorted(set(git("ls-files","--cached","--others","--exclude-standard","-z").split("\0"))-{""})
    records=[]
    for name in names:
        if name.startswith("audits/2026-09-08-repository-audit/"): continue
        f=ROOT/name
        if not f.exists() and not f.is_symlink():
            records.append({"path":name,"kind":"absent"}); continue
        if f.is_symlink():
            records.append({"path":name,"kind":"symlink","target":os.readlink(f)}); continue
        if not f.is_file(): continue
        b=f.read_bytes()
        records.append({"path":name,"kind":"file","bytes":len(b),"sha256":hashlib.sha256(b).hexdigest(),"lines":len(b.splitlines()),"mode":oct(f.stat().st_mode & 0o777)})
    return records
def log(cid, command, cwd, status, code, output, elapsed=0, extra=None):
    # This logger is for reviewed commands and synthetic outputs, never credential enumeration.
    entry={"id":cid,"command":command,"cwd":str(cwd),"status":status,"exit":code,"elapsed_seconds":round(elapsed,3),"output":output}
    if extra: entry.update(extra)
    target=EVIDENCE/(cid+".json")
    if target.exists(): raise RuntimeError("Command ID already recorded: "+cid)
    write(cid+".json",entry)
    print(output)
    print(json.dumps({k:entry[k] for k in ["id","status","exit","elapsed_seconds"]}))
def state(): return json.loads((EVIDENCE/"snapshot.json").read_text())
def main():
    cid, mode, *args=sys.argv[1:]
    start=time.monotonic()
    if mode=="init":
        records=manifest(); write("baseline-manifest.json",records)
        status=git("status","--porcelain=v1","--untracked-files=all")
        status="\n".join(x for x in status.splitlines() if "audits/2026-09-08-repository-audit/" not in x)+"\n"
        write("baseline.json",{"root":str(ROOT),"head":git("rev-parse","HEAD").strip(),"branch":git("branch","--show-current").strip(),"shallow":git("rev-parse","--is-shallow-repository").strip(),"status":status,"captured_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())})
        temp=pathlib.Path(tempfile.mkdtemp(prefix="kiro-fabric-audit-",dir="/tmp"))
        checkout=temp/"repo";checkout.mkdir(mode=0o700)
        copied=[]
        for r in records:
            n=r["path"]
            if n.startswith(("audits/","tobechecked/")) or r["kind"]=="absent":continue
            a=ROOT/n;b=checkout/n;b.parent.mkdir(parents=True,exist_ok=True)
            if a.is_symlink(): b.symlink_to(os.readlink(a))
            else: shutil.copy2(a,b)
            copied.append(n)
        shutil.copytree(ROOT/".git",checkout/".git",ignore=shutil.ignore_patterns("config","hooks","logs"))
        (checkout/".git"/"config").write_text("[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfilemode = true\n")
        shutil.copytree(ROOT/"node_modules",checkout/"node_modules",symlinks=True)
        (checkout/".tmp").mkdir(mode=0o700,exist_ok=True)
        caches=[]
        for a in (ROOT/".tmp").glob("private-tools-*"):
            if a.is_dir() and not a.is_symlink():
                shutil.copytree(a,checkout/".tmp"/a.name,symlinks=True);caches.append(a.name)
        for n in ["synthetic-home","synthetic-kiro","tmp","cache"]: (temp/n).mkdir(mode=0o700)
        write("snapshot.json",{"container":str(temp),"checkout":str(checkout),"copied_files":copied,"copied_tool_caches":caches,"excluded":["audits/","tobechecked/","ignored files except installed dependencies and private-tools cache"],"git_config":"local-only; hooks/config/logs excluded; no remote configured"})
        log(cid,sys.argv,str(ROOT),"passed",0,json.dumps({"snapshot":str(checkout),"files":len(copied),"private_tool_caches":caches}),time.monotonic()-start)
    elif mode=="restore-dependencies":
        checkout=pathlib.Path(state()["checkout"])
        target=checkout/"node_modules"
        backup=checkout/".tmp"/("dependencies-before-restore-"+cid)
        if target.exists(): target.rename(backup)
        shutil.copytree(ROOT/"node_modules",target,symlinks=True)
        log(cid,sys.argv,checkout,"passed",0,json.dumps({"action":"Restore independent copy of existing dependencies; preserve interrupted setup in .tmp", "automatic_dependency_setup":"disabled in subsequent run commands via pnpm_config_verify_deps_before_run=false"}),time.monotonic()-start)
    elif mode=="read":
        checkout=pathlib.Path(state()["checkout"]); parts=[]
        for spec in args:
            bits=spec.rsplit(":",2)
            if len(bits)==3 and bits[1].isdigit() and bits[2].isdigit():name,a,b=bits[0],int(bits[1]),int(bits[2])
            else:name,a,b=spec,1,100000
            lines=(checkout/name).read_text().splitlines()
            parts.append("\n".join(f"{name}:{i+1}:{line}" for i,line in enumerate(lines) if a<=i+1<=b))
        log(cid,sys.argv,checkout,"passed",0,"\n".join(parts),time.monotonic()-start)
    elif mode=="run":
        checkout=pathlib.Path(state()["checkout"]); temp=checkout.parent
        timeout=int(args.pop(0))
        # Only this disposable child sees synthetic HOME; no shell/user HOME is changed.
        env={"PATH":os.environ["PATH"],"HOME":str(temp/"synthetic-home"),"KIRO_HOME":str(temp/"synthetic-kiro"),"TMPDIR":str(temp/"tmp"),"XDG_CACHE_HOME":str(temp/"cache"),"LANG":"C.UTF-8","CI":"true","NO_COLOR":"1","GIT_CONFIG_NOSYSTEM":"1","GIT_CONFIG_GLOBAL":"/dev/null"}
        env["pnpm_config_verify_deps_before_run"]="false"
        if "--network-guard" in args:
            args.remove("--network-guard");env["NODE_OPTIONS"]="--require="+str(OUT/"network-guard.cjs")
        if "--package-registry-guard" in args:
            args.remove("--package-registry-guard");env["NODE_OPTIONS"]="--require="+str(OUT/"package-registry-guard.cjs")
        p=subprocess.Popen(args,cwd=checkout,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
        status="passed"
        try: raw=p.communicate(timeout=timeout)[0]
        except subprocess.TimeoutExpired:
            status="timed out";os.killpg(p.pid,signal.SIGTERM)
            try:raw=p.communicate(timeout=5)[0]
            except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);raw=p.communicate()[0]
        code=p.returncode
        if status!="timed out" and code:status="failed"
        output=raw.decode(errors="replace")
        log(cid,args,checkout,status,code,output,time.monotonic()-start,{"environment":env,"timeout_seconds":timeout})
    elif mode=="metrics":
        records=json.loads((EVIDENCE/"baseline-manifest.json").read_text())
        categories={}
        for prefix,suffix in [("src/",(".ts",".mjs")),("scripts/",(".mjs",)),("tests/",(".ts",)),("docs/",(".md",)),(".github/workflows/",(".yml",))]:
            selected=[r for r in records if r["kind"]=="file" and r["path"].startswith(prefix) and r["path"].endswith(suffix)]
            categories[prefix]={"files":len(selected),"physical_lines":sum(r["lines"] for r in selected),"bytes":sum(r["bytes"] for r in selected)}
        history=git("log","--all","--format=%H%x09%aI%x09%aN","--numstat")
        changes={}; authors={}; commits=[]; current=None
        for l in history.splitlines():
            parts=l.split("\t")
            if len(parts)==3 and re.fullmatch("[a-f0-9]{40}",parts[0]):
                current=parts[0];commits.append({"sha":current,"date":parts[1]});authors[parts[2]]=authors.get(parts[2],0)+1
            elif len(parts)==3 and (parts[0].isdigit() or parts[0]=="-"):
                n=parts[2]
                if n.startswith(("src/","scripts/","tests/")):changes[n]=changes.get(n,0)+1
        # Do not publish author names/emails; alias/bot identity remains unknown.
        data={"method":"Physical splitlines including blanks/comments; tracked plus untracked baseline files; non-shallow all-ref Git commit/path touch count, not line churn or ownership.","counts":categories,"largest_authored":[{k:r[k] for k in ["path","lines","bytes"]} for r in sorted([r for r in records if r["kind"]=="file" and r["path"].startswith(("src/","scripts/","tests/"))],key=lambda x:x["lines"],reverse=True)[:15]],"large_baseline_files":[{"path":r["path"],"bytes":r["bytes"]} for r in records if r["kind"]=="file" and r["bytes"]>1000000 and not r["path"].startswith(("audits/","tobechecked/"))],"git":{"commits":len(commits),"earliest":min(c["date"] for c in commits),"latest":max(c["date"] for c in commits),"author_labels":len(authors),"author_commit_counts":sorted(authors.values(),reverse=True),"path_touches":sorted(changes.items(),key=lambda x:x[1],reverse=True)[:20]}}
        write("metrics.json",data);log(cid,sys.argv,ROOT,"passed",0,json.dumps(data,indent=2),time.monotonic()-start)
    elif mode=="verify":
        before={r["path"]:r for r in json.loads((EVIDENCE/"baseline-manifest.json").read_text())}
        after={r["path"]:r for r in manifest()}
        changed=[n for n in sorted(set(before)|set(after)) if before.get(n)!=after.get(n)]
        log(cid,sys.argv,ROOT,"passed" if not changed else "failed",0 if not changed else 1,json.dumps({"non_audit_changes":changed}),time.monotonic()-start)
    else:raise RuntimeError("Unknown mode")
main()
