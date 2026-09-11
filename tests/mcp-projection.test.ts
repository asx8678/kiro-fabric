import type { Runtime, ServerDefinition } from "mcporter";
import { describe, expect, it, vi } from "vitest";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { normalizeFabricConfig } from "../src/config.js";

function fixture(reply: unknown) {
  let creations=0;
  const server:ServerDefinition={name:"configured",command:{kind:"http",url:new URL("https://example.test/mcp")}};
  const tools=[{name:"echo",inputSchema:{type:"object",properties:{value:{type:"string"}},required:["value"],additionalProperties:false}}];
  const callTool=vi.fn<Runtime["callTool"]>(async()=>reply);
  const runtime:Runtime={listServers:()=>[server.name],getDefinitions:()=>[server],getDefinition:()=>server,registerDefinition(){},
    async listTools(){return tools;},callTool,async listResources(){return [];},async readResource(){return null;},
    async connect(){return {client:{async listTools(){return {tools};}},transport:{async close(){}},definition:server} as unknown as Awaited<ReturnType<Runtime["connect"]>>;},async close(){}};
  const provider=new KiroMcpProvider("/workspace",{enabled:true,disableOAuth:true,callTimeoutMs:1000},async()=>{creations++;return runtime;});
  const registry=new ActionRegistry();registry.register(provider);
  const approvals:Array<Record<string,unknown>>=[];
  const approve=async(_action:unknown,args:Record<string,unknown>)=>{approvals.push(args);};
  const call=(projection?:unknown)=>registry.invoke("mcp.$call",{server:"configured",tool:"echo",args:{value:"input"},...(projection===undefined?{}:{projection})},{cwd:"/workspace",audits:[],maxResultChars:2000000,approve});
  return {provider,registry,callTool,approvals,approve,call,creations:()=>creations};
}

describe("MCP host-side result projection",()=>{
  it("preserves omitted/full results and binds lean views through approval without changing remote arguments",async()=>{
    const reply={content:[{type:"text",text:"first"},{type:"image",data:"abc",mimeType:"image/png"},{type:"text",text:"second"}],structuredContent:{count:2}},f=fixture(reply);
    try{
      const full={text:"first\nsecond",content:reply.content,structuredContent:reply.structuredContent};
      expect(await f.call()).toEqual(full);expect(await f.call("full")).toEqual(full);
      expect(await f.call("text")).toBe("first\nsecond");expect(await f.call("structured")).toEqual({count:2});
      expect(f.approvals.map(a=>a.projection)).toEqual([undefined,"full","text","structured"]);
      expect(f.approvals.every(a=>a.transportSnapshot!==undefined)).toBe(true);
      for(const call of f.callTool.mock.calls){expect(call.slice(0,2)).toEqual(["configured","echo"]);expect(call[2]).toMatchObject({args:{value:"input"},disableOAuth:true});expect(call[2]).not.toHaveProperty("projection");}
      const schema=(await f.provider.describe("$call"))!.inputSchema as {properties:Record<string,unknown>};
      expect(schema.properties.projection).toEqual({enum:["full","text","structured"]});
    }finally{await f.registry.close();}
  });

  it.each(["invalid",null,1,{}])("rejects unsupported projection %j before runtime creation/contact",async projection=>{
    const f=fixture(null);try{
      await expect(f.call(projection)).rejects.toThrow("projection");
      await expect(f.provider.invoke("$call",{server:"configured",tool:"echo",args:{value:"input"},projection},{cwd:"/workspace"})).rejects.toThrow("projection");
      expect(f.creations()).toBe(0);expect(f.callTool).not.toHaveBeenCalled();expect(f.approvals).toHaveLength(0);
    }finally{await f.registry.close();}
  });

  it.each(["full","text","structured"])("never hides remote errors or skips raw validation in %s mode",async projection=>{
    const failed=fixture({content:[{type:"text",text:"remote failure"}],isError:true});
    try{await expect(failed.call(projection)).rejects.toThrow("remote failure");expect(failed.callTool).toHaveBeenCalledTimes(1);}finally{await failed.registry.close();}
    const invalid=fixture({content:[{type:"text",text:"x".repeat(2000001)}],structuredContent:{small:true}});
    try{await expect(invalid.call(projection)).rejects.toThrow("bounded JSON");expect(invalid.callTool).toHaveBeenCalledTimes(1);}finally{await invalid.registry.close();}
  });

  it.each([0,false,""])("retains nontruthy structured value %j",async value=>{
    const f=fixture({content:[],structuredContent:value});try{expect(await f.call("structured")).toBe(value);}finally{await f.registry.close();}
  });

  it("does not parse text as structured data or invent missing representations",async()=>{
    for(const [reply,text,structured] of [
      [{content:[{type:"text",text:'{"n":1}'}]},'{"n":1}',null],
      [{content:[{type:"image",data:"abc",mimeType:"image/png"}]},"",null],
      ["legacy raw","legacy raw",null],
      [{legacy:"raw"},"",null],
      [{structuredContent:{n:1}},"",{n:1}],
    ] as const){const f=fixture(reply);try{expect(await f.call("text")).toEqual(text);expect(await f.call("structured")).toEqual(structured);}finally{await f.registry.close();}}
  });

  it("checks remote input schemas and descriptor pins in every view",async()=>{
    const f=fixture({content:[]});try{
      for(const projection of ["full","text","structured"]){
        await expect(f.registry.invoke("mcp.$call",{server:"configured",tool:"echo",args:{value:123},projection},{cwd:"/workspace",audits:[],maxResultChars:2000,approve:f.approve})).rejects.toThrow();
        await expect(f.registry.invoke("mcp.$call",{server:"configured",tool:"echo",args:{value:"ok"},projection,expectedDescriptorDigest:"0".repeat(64)},{cwd:"/workspace",audits:[],maxResultChars:2000,approve:f.approve})).rejects.toThrow("descriptor changed");
      }
      expect(f.callTool).not.toHaveBeenCalled();
    }finally{await f.registry.close();}
  });

  it("projects before the checked guest bridge, avoiding duplicate-text truncation",async()=>{
    const text="x".repeat(700),f=fixture({content:[{type:"text",text}],structuredContent:{ok:true}});
    const service=new FabricExecutionService(f.registry,normalizeFabricConfig({executor:{maxNestedResultChars:1000}}),"/workspace");
    try{
      for(const projection of ["full","text","structured"]){
        const result=await service.execute({code:`return await mcp.call({server:"configured",tool:"echo",args:{value:"input"},projection:"${projection}"});`,approver:{approve:f.approve}});
        expect(result.success,result.error).toBe(true);
        if(projection==="full")expect(result.value).toMatchObject({fabricTruncated:true});
        if(projection==="text")expect(result.value).toBe(text);
        if(projection==="structured")expect(result.value).toEqual({ok:true});
      }
      const invalid=await service.execute({code:'return await mcp.call({server:"configured",tool:"echo",projection:"invalid"});',approver:{approve:f.approve}});
      expect(invalid.typeErrors?.length).toBeGreaterThan(0);expect(invalid.audits).toHaveLength(0);
      expect(f.callTool).toHaveBeenCalledTimes(3);
    }finally{await service.close();}
  });
});
