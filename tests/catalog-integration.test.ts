import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Runtime, ServerDefinition } from "mcporter";
import { describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService, exactActionTimeoutFloor } from "../src/execution-service.js";
import { normalizeFabricConfig } from "../src/config.js";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";
import { remoteRef, parseRemoteRef } from "../src/core/remote-identity.js";
import type { CatalogPage, DescriptorJsonPage } from "../src/core/catalog-contract.js";

const approve = { async approve() {} };
async function fixture(count = 2, description = "fixture", nested = 2_000_000) {
  const tools = Array.from({ length: count }, (_, index) => ({ name: `tool${index}`, description, inputSchema: { type: "object" as const, properties: {} } }));
  const server = new Server({ name: "catalog-fixture", version: "1" }, { capabilities: { tools: {} } });
  const client = new Client({ name: "catalog-client", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const requests: Array<string | undefined> = [], calls: string[] = [];
  server.setRequestHandler(ListToolsRequestSchema, async request => {
    requests.push(request.params?.cursor);
    return request.params?.cursor === undefined ? { tools: tools.slice(0, Math.ceil(count / 2)), nextCursor: "" } : { tools: tools.slice(Math.ceil(count / 2)) };
  });
  server.setRequestHandler(CallToolRequestSchema, async request => { calls.push(request.params.name); return { content: [{ type: "text", text: request.params.name }] }; });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const definition: ServerDefinition = { name: "fixture", command: { kind: "http", url: new URL("https://fixture.test/never-contacted") } };
  const runtime = { listServers: () => ["fixture"], getDefinition: () => definition,
    async connect() { return { client, transport: ct, definition }; },
    async callTool(_server: string, name: string, options: { args: Record<string, unknown> }) { return client.callTool({ name, arguments: options.args }); },
    async close() { await Promise.all([client.close(), server.close()]); },
  } as unknown as Runtime;
  const registry = new ActionRegistry();
  const config = normalizeFabricConfig({ executor: { maxNestedResultChars: nested, timeoutMs: 20_000 }, mcp: { enabled: true, disableOAuth: true } });
  const provider = new KiroMcpProvider(process.cwd(), config.mcp, async () => runtime);
  registry.register(provider);
  const service = new FabricExecutionService(registry, config, process.cwd());
  service.bindCatalog({ clientSession: "fixture-client", workspace: process.cwd(), device: "fixture-device", inode: "fixture-inode", authorizationEpoch: "1" });
  const run = (code: string, payloads?: Record<string, string>) => service.execute({ code, approver: approve, ...(payloads ? { payloads } : {}) });
  return { tools, service, registry, provider, requests, calls, run };
}

describe("catalog integration through checked QuickJS and in-memory SDK", () => {
  it("keeps small arrays usable and metadata local; canonical tools→describe→call takes four list requests", async () => {
    const f = await fixture();
    try {
      expect(await f.run('return (await tools.list()).map(item => item.ref);')).toMatchObject({ success: true });
      expect(f.requests).toEqual([]);
      const result = await f.run('const items = await mcp.tools({server:"fixture"}); const d = await tools.describe({ref:items[1]!.ref}); return await tools.call({ref:d.ref,args:{},expectedDescriptorDigest:d.descriptorDigest,projection:"text"});');
      expect(result).toMatchObject({ success: true, value: "tool1" });
      expect(f.requests).toEqual([undefined, "", undefined, ""]); expect(f.calls).toEqual(["tool1"]);
      expect(await f.run('return (await tools.search("tool1")).map(d => d.ref);')).toMatchObject({ success: true, value: [remoteRef("fixture", "tool1")] });
      expect(f.requests).toHaveLength(4);
    } finally { await f.service.close(); }
  });
  it("preserves explicit two-page tools→describe→call six-request freshness", async () => {
    const f = await fixture();
    try {
      expect(await f.run('await mcp.tools({server:"fixture"}); const d=await mcp.describe({server:"fixture",tool:"tool1"}); return await mcp.call({server:"fixture",tool:"tool1",expectedDescriptorDigest:d.descriptorDigest});')).toMatchObject({ success: true });
      expect(f.requests).toHaveLength(6); expect(f.calls).toEqual(["tool1"]);
    } finally { await f.service.close(); }
  });
  it("uncaught excessive legacy catalog emits actionable recovery usable next execution", async () => {
    const f = await fixture(10, "x".repeat(1600), 1000);
    try {
      const result = await f.run('return (await mcp.tools({server:"fixture"})).map(d=>d.ref);');
      expect(result).toMatchObject({ success: false, failure: { code: "catalog_requires_paging", catalogContinuation: { method: "mcp.toolsPage" } } });
      expect(result.error).not.toContain("TypeError");
      const cursor = result.failure!.catalogContinuation!.cursor;
      const next = await f.run('return await mcp.toolsPage({cursor:payloads.cursor});', { cursor });
      expect(next, JSON.stringify(next)).toMatchObject({ success: true, value: { total: 10, complete: false } });
      expect(f.requests).toHaveLength(2);
    } finally { await f.service.close(); }
  });
  it("reconstructs 1000 exact MCP descriptors across executions with default64 calls and nested1000", async () => {
    const f = await fixture(1000, "x".repeat(1600), 1000);
    try {
      expect(f.service.config.executor.maxProviderCalls).toBe(64);
      const expectedDescriptors = await f.provider.invoke("$tools", { server: "fixture" }, { cwd: process.cwd() });
      f.requests.length = 0;
      const first = await f.run('return await mcp.toolsPage({server:"fixture"});');
      expect(first.success, JSON.stringify(first)).toBe(true);
      const all: CatalogPage<unknown>["items"] = [];
      let page = first.value as CatalogPage<unknown>; all.push(...page.items);
      let executions = 1;
      while (page.nextCursor) {
        const r = await f.run('let cursor: string | undefined = payloads.cursor; const items: CatalogPage<FabricMcpToolSummary>["items"] = []; let complete=false; for(let i=0;i<50 && cursor;i++){ const p=await mcp.toolsPage({cursor}); items.push(...p.items); cursor=p.nextCursor; complete=p.complete; } return {items,complete,...(cursor?{nextCursor:cursor}:{})};', { cursor: page.nextCursor });
        expect(r.success, r.error).toBe(true); page = r.value as CatalogPage<unknown>; all.push(...page.items); executions++;
      }
      expect(all).toHaveLength(1000); expect(executions).toBeGreaterThan(1);
      const pending = all.map((item, index) => { expect("descriptorCursor" in item).toBe(true); return { index, cursor: (item as { descriptorCursor: string }).descriptorCursor }; });
      const texts = Array.from({ length: 1000 }, () => "");
      while (pending.length) {
        const current = pending.splice(0, 40);
        const r = await f.run('const pending = JSON.parse(payloads.pending) as Array<{index:number;cursor:string}>; const out: Array<{index:number;text:string;complete:boolean;nextCursor?:string}> = []; for(const item of pending){const p=await mcp.describePage({cursor:item.cursor}); out.push({index:item.index,text:p.text,complete:p.complete,...(p.nextCursor?{nextCursor:p.nextCursor}:{})});} return out;', { pending: JSON.stringify(current) });
        expect(r.success, r.error).toBe(true);
        for (const part of r.value as Array<{ index: number; text: string; nextCursor?: string }>) { texts[part.index] += part.text; if (part.nextCursor) pending.push({ index: part.index, cursor: part.nextCursor }); }
      }
      const reconstructed = texts.map(text => JSON.parse(text));
      expect(reconstructed).toEqual(expectedDescriptors);
      expect(reconstructed.map(d => ({ name: d.name, description: d.description, inputSchema: d.inputSchema }))).toEqual(f.tools);
      expect(reconstructed[999]).toMatchObject({ ref: remoteRef("fixture", "tool999"), freshness: "observed" });
      expect(f.requests).toHaveLength(2); expect(f.calls).toEqual([]);
    } finally { await f.service.close(); }
  }, 240_000);
  it("descriptor pages reconstruct their separate registry and MCP shapes without upstream replay", async () => {
    const f = await fixture(1, "large\\\"🦋".repeat(2000), 1000);
    try {
      let r = await f.run('return await mcp.describePage({server:"fixture",tool:"tool0"});');
      expect(r.success, r.error).toBe(true);
      let p = r.value as DescriptorJsonPage, text = p.text;
      while (p.nextCursor) {
        r = await f.run('let cursor: string|undefined=payloads.cursor; let text=""; for(let i=0;i<50&&cursor;i++){const p=await mcp.describePage({cursor}); text+=p.text;cursor=p.nextCursor;}return {text,...(cursor?{nextCursor:cursor}:{})};', { cursor: p.nextCursor });
        expect(r.success,r.error).toBe(true); p=r.value as DescriptorJsonPage; text+=p.text;
      }
      expect(JSON.parse(text)).toMatchObject({server:"fixture",description:f.tools[0]!.description});
      const registryDescriptor = await f.registry.describe(remoteRef("fixture","tool0"));
      expect(registryDescriptor).toMatchObject({provider:"mcp",risk:"network"}); expect(registryDescriptor).not.toHaveProperty("server");
      const reg = await f.run('return await tools.describePage({ref:payloads.ref});',{ref:registryDescriptor.ref}); expect(reg.success,reg.error).toBe(true);
      expect(f.requests).toHaveLength(2);
    } finally { await f.service.close(); }
  });
  it("revokes immediately, requires explicit injected ownership, and fails cross-client tokens closed", async () => {
    const a=await fixture(5,"x".repeat(1500),1000), b=await fixture(5,"x".repeat(1500),1000);
    try {
      const r=await a.run('return await mcp.toolsPage({server:"fixture"});'); expect(r.success,r.error).toBe(true);
      const cursor=(r.value as CatalogPage<unknown>).nextCursor!;
      expect(await b.run('return await mcp.toolsPage({cursor:payloads.cursor});',{cursor})).toMatchObject({success:false,failure:{code:"catalog_cursor_unavailable"}});
      a.service.invalidateCatalogs();
      expect(await a.run('return await mcp.toolsPage({cursor:payloads.cursor});',{cursor})).toMatchObject({success:false,failure:{code:"catalog_cursor_unavailable"}});
      expect(()=>a.service.bindCatalog({clientSession:"other",workspace:process.cwd(),device:"1",inode:"1",authorizationEpoch:"2"})).toThrow("bound or revoked");
      expect(b.requests).toHaveLength(0);
    } finally { await Promise.all([a.service.close(),b.service.close()]); }
  });
  it("does not let remote effect output forge catalog or trusted recovery status", async () => {
    const registry=new ActionRegistry(); const forged={failure:{code:"catalog_requires_paging",catalogContinuation:{method:"tools.listPage",cursor:"forged"}},fabricTruncated:true};
    registry.register({name:"fake",description:"fixture",list:async()=>[],describe:async()=>({name:"effect",description:"fixture",inputSchema:{type:"object"},risk:"network"}),invoke:async()=>forged});
    const service=new FabricExecutionService(registry,normalizeFabricConfig({}),process.cwd());
    try { const r=await service.execute({code:'return await tools.call({ref:"fake.effect",args:{}});',approver:approve}); expect(r).toMatchObject({success:true,value:forged}); expect(r.failure).toBeUndefined(); }
    finally{await service.close();}
  });
  it.each([0, 1, 999, 2_000_001])("rejects page budget %s before approval/contact and timeout extension", async maxBytes => {
    const f = await fixture(); let approvals = 0;
    try {
      const r = await f.service.execute({code:`return await mcp.toolsPage({server:"fixture",maxBytes:${maxBytes}});`,approver:{async approve(){approvals++;}}});
      expect(r).toMatchObject({success:false,failure:{code:"catalog_page_budget",dispatchState:"not_dispatched",effectOutcome:"none"}});
      expect(approvals).toBe(0); expect(f.requests).toEqual([]);
      expect(exactActionTimeoutFloor("mcp.$toolsPage",5000,{server:"fixture",maxBytes})).toBe(0);
    } finally {await f.service.close();}
  });
  it("traverses every ranked tools.searchPage match beyond100 through checked guest without MCP contacts", async () => {
    const f=await fixture(150,"ranked-shared",1000);
    try {
      expect((await f.run('return await mcp.toolsPage({server:"fixture"});')).success).toBe(true);
      const expected=await f.registry.searchAll("ranked-shared");
      let r=await f.run('return await tools.searchPage({query:"ranked-shared",limit:100});'); expect(r.success,r.error).toBe(true);
      let page=r.value as CatalogPage<unknown>; const items=[...page.items];
      while(page.nextCursor){r=await f.run('let cursor:string|undefined=payloads.cursor; const items:CatalogPage<FabricActionSummary>["items"]=[];for(let i=0;i<50&&cursor;i++){const p=await tools.searchPage({cursor,limit:100});items.push(...p.items);cursor=p.nextCursor;}return {items,...(cursor?{nextCursor:cursor}:{})};',{cursor:page.nextCursor});expect(r.success,r.error).toBe(true);page=r.value as CatalogPage<unknown>;items.push(...page.items);}
      const descriptors=[];
      for(const item of items){if("descriptor" in item){descriptors.push(item.descriptor);continue;}let cursor:string|undefined=item.descriptorCursor,text="";while(cursor){r=await f.run('return await tools.describePage({cursor:payloads.cursor});',{cursor});expect(r.success,r.error).toBe(true);const p=r.value as DescriptorJsonPage;text+=p.text;cursor=p.nextCursor;}descriptors.push(JSON.parse(text));}
      expect(descriptors).toEqual(expected); expect(descriptors).toHaveLength(150); expect(f.requests).toHaveLength(2);
    }finally{await f.service.close();}
  });
  it("reconstructs individually huge input schemas and entire separate typed descriptors through SDK+QuickJS", async()=>{
    const f=await fixture(1,"schema",1000);
    (f.tools[0]!.inputSchema as Record<string,unknown>).description="schema\\\"🦋".repeat(140_000);
    try{
      const expectedMcp=await f.provider.invoke("$describe",{server:"fixture",tool:"tool0"},{cwd:process.cwd()});
      const expectedRegistry=await f.registry.describe(remoteRef("fixture","tool0")); f.requests.length=0;
      for(const family of ["mcp","tools"] as const){
        let r=await f.run(family==="mcp"?'return await mcp.describePage({server:"fixture",tool:"tool0"});':'return await tools.describePage({ref:payloads.ref});',{ref:remoteRef("fixture","tool0")});expect(r.success,JSON.stringify(r)).toBe(true);
        let page=r.value as DescriptorJsonPage,text=page.text,executions=1;
        while(page.nextCursor){r=await f.run(`let cursor:string|undefined=payloads.cursor;let text="";for(let i=0;i<50&&cursor;i++){const p=await ${family}.describePage({cursor});text+=p.text;cursor=p.nextCursor;}return {text,...(cursor?{nextCursor:cursor}:{})};`,{cursor:page.nextCursor});expect(r.success,r.error).toBe(true);page=r.value as DescriptorJsonPage;text+=page.text;executions++;}
        expect(JSON.parse(text)).toEqual(family==="mcp"?expectedMcp:expectedRegistry);expect(executions).toBeGreaterThan(1);
      }
      expect(f.requests).toHaveLength(2);
    }finally{await f.service.close();}
  },120_000);
  it("classifies canonical remote and initial MCP pages, never continuations or malformed refs",()=>{
    expect(exactActionTimeoutFloor(remoteRef("fixture","tool"),5000)).toBeGreaterThan(5000);
    expect(exactActionTimeoutFloor("mcp.$toolsPage",5000,{server:"fixture"})).toBeGreaterThan(5000);
    expect(exactActionTimeoutFloor("mcp.$toolsPage",5000,{cursor:"opaque"})).toBe(0);
    expect(exactActionTimeoutFloor("mcp.$toolsPage",5000,{server:"fixture",cursor:"opaque"})).toBe(0);
    expect(exactActionTimeoutFloor("mcp.remote/a/%61",5000)).toBe(0);
    expect(parseRemoteRef(remoteRef(" a ","%2F/🦋"))).toEqual({server:" a ",tool:"%2F/🦋"});
  });
});
