import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { LocalPaths } from "../src/providers/local-path.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { normalizeFabricConfig } from "../src/config.js";
import type { LocalFindResult, LocalGrepResult } from "../src/providers/local-contract.js";

function fixture(budget=20000) {
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"query-pages-"))), root=path.join(base,"workspace"); fs.mkdirSync(root);
  const registry=new ActionRegistry(); registry.register(new LocalCodingProvider({root,lockRoot:path.join(base,"locks"),maxResultChars:budget}));
  const put=(file:string,text:string|Buffer)=>fs.writeFileSync(path.join(root,file),text);
  put("a.ts","hit a\n");put("b.ts","hit b\n");
  const call=(name:string,args:Record<string,unknown>)=>registry.invoke(`local.${name}`,args,{cwd:root,audits:[],maxResultChars:budget,approve:async()=>{}});
  return {root,registry,put,call,find:(args:Record<string,unknown>)=>call("find",args) as Promise<LocalFindResult>,grep:(args:Record<string,unknown>)=>call("grep",args) as Promise<LocalGrepResult>,
    async close(){vi.restoreAllMocks();await registry.close();removeFixtureSync(base,{recursive:true,force:true});}};
}
const query={pattern:"*.ts",paginate:true,snapshotScope:"query-v1",limit:1};

describe("explicit query-v1 pagination",()=>{
  it("reads only glob-selected files for query-v1 snapshots, unlike default-scope pagination",async()=>{
    const f=fixture();try{
      for(let i=0;i<22;i++)f.put(`${i}.md`,"unrelated\n");
      const read=vi.spyOn(LocalPaths.prototype,"read");
      const readFiles=()=>new Set(read.mock.calls.map(([file])=>path.basename(String(file))));
      const legacy=await f.find({pattern:"*.ts",paginate:true,limit:1});expect(readFiles().has("0.md")).toBe(true);
      read.mockClear();const first=await f.find(query);expect([...readFiles()].sort()).toEqual(["a.ts","b.ts"]);expect(first.scope.snapshotScope).toBe("query-v1");
      read.mockClear();const second=await f.find({...query,cursor:first.nextCursor});expect([...readFiles()].sort()).toEqual(["a.ts","b.ts"]);
      expect(legacy.paths).toEqual(["a.ts"]);
      expect([...first.paths,...second.paths]).toEqual(["a.ts","b.ts"]);expect(second.truncated).toBe(false);
    }finally{await f.close();}
  });

  it("ignores unrelated content/binaries/oversized files but rejects selected nontext",async()=>{
    const f=fixture();try{
      f.put("image.bin",Buffer.from([0,1]));f.put("large.bin",Buffer.alloc(2*1024*1024+1));
      const first=await f.find(query);f.put("unrelated.md","new outside selection");
      expect((await f.find({...query,cursor:first.nextCursor})).paths).toEqual(["b.ts"]);
      await expect(f.find({pattern:"*.ts",paginate:true,limit:1})).rejects.toThrow();
      f.put("bad.ts",Buffer.from([0,1]));await expect(f.find(query)).rejects.toThrow("binary");
    }finally{await f.close();}
  });

  it.each(["add","delete","content","rename","ignore"])("rejects selected %s drift",async mode=>{
    const f=fixture();try{
      const first=await f.find(query);
      if(mode==="add")f.put("c.ts","new");
      if(mode==="delete")fs.unlinkSync(path.join(f.root,"b.ts"));
      if(mode==="content")f.put("b.ts","changed");
      if(mode==="rename")fs.renameSync(path.join(f.root,"b.ts"),path.join(f.root,"c.ts"));
      if(mode==="ignore")f.put(".ignore","b.ts\n");
      await expect(f.find({...query,cursor:first.nextCursor})).rejects.toThrow(/drift|conflict/);
    }finally{await f.close();}
  });

  it("hashes nonmatching grep candidates too",async()=>{
    const f=fixture();try{
      f.put("c.ts","not a match\n");const args={...query,pattern:"hit",glob:"*.ts"};const first=await f.grep(args);
      f.put("c.ts","new hit\n");await expect(f.grep({...args,cursor:first.nextCursor})).rejects.toThrow("drift");
    }finally{await f.close();}
  });

  it.each(["content","add"])("rejects %s changes during resumed capture",async mode=>{
    const f=fixture();try{
      const first=await f.find(query), original=LocalPaths.prototype.read;
      vi.spyOn(LocalPaths.prototype,"read").mockImplementation(function(this:LocalPaths,file:string){const result=original.call(this,file);if(path.basename(file)==="b.ts")f.put(mode==="add"?"c.ts":"a.ts","drift");return result;});
      await expect(f.find({...query,cursor:first.nextCursor})).rejects.toThrow(/drift|conflict/);
    }finally{await f.close();}
  });

  it("preserves hidden/ignore/VCS/no-follow rules and rejects selected hardlinks",async()=>{
    const f=fixture();try{
      f.put(".hidden.ts","hit");f.put("ignored.ts","hit");f.put(".ignore","ignored.ts\n");fs.mkdirSync(path.join(f.root,".git"));f.put(".git/internal.ts","hit");
      fs.symlinkSync("a.ts",path.join(f.root,"alias.ts"));
      const result=await f.find({...query,hidden:true,limit:100});expect(result.paths).toEqual([".hidden.ts","a.ts","b.ts"]);
      fs.linkSync(path.join(f.root,"a.ts"),path.join(f.root,"hard.ts"));await expect(f.find(query)).rejects.toThrow("hardlink");
    }finally{await f.close();}
  });

  it("binds query mode and rejects unknown, foreign, consumed, expired and over-capacity cursors",async()=>{
    const f=fixture(), other=fixture();try{
      await expect(f.find({...query,paginate:false})).rejects.toThrow("paginate");
      await expect(f.find({...query,snapshotScope:"query-v2"})).rejects.toThrow();
      const first=await f.find(query);
      await expect(f.find({pattern:"*.ts",paginate:true,limit:1,cursor:first.nextCursor})).rejects.toThrow("mismatch");
      await expect(other.find({...query,cursor:first.nextCursor})).rejects.toThrow("cursor");
      await f.find({...query,cursor:first.nextCursor});await expect(f.find({...query,cursor:first.nextCursor})).rejects.toThrow("cursor");
      const expiring=await f.find(query);const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+60001);
      await expect(f.find({...query,cursor:expiring.nextCursor})).rejects.toThrow("expired");clock.mockRestore();
      for(let i=0;i<8;i++)await f.find(query);await expect(f.find(query)).rejects.toThrow("cache limit");
    }finally{await f.close();await other.close();}
  });

  it("rejects a fresh request on a full cache before fingerprinting the workspace",async()=>{
    const f=fixture();try{
      for(let i=0;i<8;i++)await f.find(query);
      const read=vi.spyOn(LocalPaths.prototype,"read");read.mockClear();
      await expect(f.find(query)).rejects.toThrow("cache limit");
      // Capacity is decided before the snapshot fingerprint read the workspace.
      expect(read).not.toHaveBeenCalled();
    }finally{await f.close();}
  });

  it("returns independent bounded pages and preserves match-text omissions",async()=>{
    const f=fixture(1200);try{
      f.put("a.ts","hit "+"x".repeat(550)+"\n");f.put("b.ts","hit "+"y".repeat(550)+"\n");
      const args={...query,pattern:"hit",glob:"*.ts"};const first=await f.grep(args);
      first.scope.path="tampered";first.matches[0]!.text="tampered";first.truncationReasons!.push("oversized-files");
      const next=await f.grep({...args,cursor:first.nextCursor});expect(next.scope.path).toBe(".");expect(next.matches[0]!.text).toContain("hit y");
      expect(next.nextCursor).toBeUndefined();expect(next.truncated).toBe(true);expect(next.truncationReasons).toEqual(["match-text"]);
      expect(JSON.stringify(next).length).toBeLessThanOrEqual(1200);
    }finally{await f.close();}
  });

  it("registers the option in checked guest execution and rejects invalid guest modes before calls",async()=>{
    const f=fixture(),service=new FabricExecutionService(f.registry,normalizeFabricConfig({}),f.root);
    try{
      const result=await service.execute({code:'return await local.find({pattern:"*.ts",paginate:true,snapshotScope:"query-v1",limit:1});',approver:{async approve(){}}});
      expect(result.success,result.error).toBe(true);expect(result.value).toMatchObject({scope:{snapshotScope:"query-v1"},paths:["a.ts"]});
      const invalid=await service.execute({code:'return await local.find({pattern:"*.ts",paginate:true,snapshotScope:"query-v2"});',approver:{async approve(){}}});
      expect(invalid.typeErrors?.length).toBeGreaterThan(0);expect(invalid.audits).toHaveLength(0);
    }finally{await service.close();await f.close();}
  });
});
