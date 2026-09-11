import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { LocalLineIndex } from "../src/providers/local-line-index.js";
import { LocalPaths } from "../src/providers/local-path.js";
import type { LocalReadManyResult, LocalReadResult } from "../src/providers/local-contract.js";

function fixture(text: string, budget = 40000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "line-index-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root); const file = path.join(root,"source"); fs.writeFileSync(file,text);
  const registry = new ActionRegistry(); registry.register(new LocalCodingProvider({root,lockRoot:path.join(base,"locks"),maxResultChars:budget}));
  return { file, registry, call: (name:string,args:Record<string,unknown>)=>registry.invoke(`local.${name}`,args,{cwd:root,audits:[],maxResultChars:budget,approve:async()=>{}}),
    async close(){vi.restoreAllMocks();await registry.close();fs.rmSync(base,{recursive:true,force:true});} };
}

describe("snapshot-local source line indices", () => {
  it.each(["", "\n", "\n\n", "last", "first\nlast", "first\nlast\n", "\ufefffirst\r\n\r\nlast\r", "🐈\n𐀀\n", "a\rb\nc"])('preserves all complete-line ranges: %j', text => {
    const expected = text === "" ? [] : text.split("\n"); if(text.endsWith("\n"))expected.pop();
    const index = new LocalLineIndex(text); expect(index.totalLines).toBe(expected.length);
    for(let start=0;start<expected.length;start++)for(let end=start+1;end<=expected.length;end++){
      const lines = expected.slice(start,end).join("\n") + (end<expected.length||text.endsWith("\n")?"\n":"");
      expect(index.slice(start,end)).toBe(lines);
    }
  });

  it("uses one line index and two physical reads for 32 windows, without full-file splitting", async () => {
    const text = "x\n".repeat(524288), f = fixture(text);
    try {
      const split = vi.spyOn(String.prototype,"split"), slice = vi.spyOn(LocalLineIndex.prototype,"slice"), read = vi.spyOn(LocalPaths.prototype,"read");
      const windows = Array.from({length:32},(_,i)=>({path:"source",offset:1+i*10000,limit:2}));
      const result = await f.call("readMany",{windows}) as LocalReadManyResult;
      expect(result.complete).toBe(true); expect(result.files).toHaveLength(32);
      expect(result.files.every(file=>file.totalLines===524288)).toBe(true);
      expect(split.mock.contexts.filter(value=>typeof value==="string"&&value.length===text.length)).toHaveLength(0);
      expect(new Set(slice.mock.contexts).size).toBe(1); expect(read).toHaveBeenCalledTimes(2);
      slice.mockRestore(); read.mockRestore(); split.mockRestore();
      fs.writeFileSync(f.file,"new\n");
      const next = await f.call("readMany",{windows:[{path:"source"}]}) as LocalReadManyResult;
      expect(next.files[0]).toMatchObject({totalLines:1,source:"1: new"});
      expect(next.files[0]!.sha256).not.toBe(result.files[0]!.sha256);
    } finally { await f.close(); }
  });

  it("retains final snapshot drift detection", async () => {
    const f = fixture("before\n"); let reads=0; const original=LocalPaths.prototype.read;
    try {
      vi.spyOn(LocalPaths.prototype,"read").mockImplementation(function(this:LocalPaths,file:string){
        if(++reads===2)fs.writeFileSync(f.file,"after!\n"); return original.call(this,file);
      });
      await expect(f.call("readMany",{windows:[{path:"source"}]})).rejects.toThrow("conflict");
    } finally { await f.close(); }
  });

  it("fits actual escaped whole-line envelopes and preserves EOF/offset behavior", async () => {
    const text=Array.from({length:100},(_,i)=>`line ${i} "quoted" \\ 🐈\r\n`).join(""), f=fixture(text,700);
    try {
      let offset=1, recovered="";
      while(offset<=100){
        const page=await f.call("read",{path:"source",offset,limit:100}) as LocalReadResult;
        expect(JSON.stringify(page).length).toBeLessThanOrEqual(700); expect(page.text).not.toBe("");
        recovered+=page.text; if(!page.truncated)break; expect(page.nextOffset).toBeGreaterThan(offset); offset=page.nextOffset!;
      }
      expect(recovered).toBe(text);
      expect(await f.call("read",{path:"source",offset:101})).toMatchObject({text:"",totalLines:100,truncated:false});
      fs.writeFileSync(f.file,'"'.repeat(1000));
      await expect(f.call("read",{path:"source"})).rejects.toThrow("single line");
    } finally { await f.close(); }
  });
});
