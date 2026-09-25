// Built public API + real compiler/QuickJS/provider bridge. Only SDK transport and
// native analysis boundaries are intercepted. All isolated fixture files remain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export function createArtifactBuiltCases() {
  return [{ id:'LC24', title:'built MCP retains owner artifacts through real execution and workspace replacement',
    effects:'owned compiler/QuickJS workers; inert SDK transport/native analysis; retained private fixture files; no network', deadlineMs:120000,
    run: async context => {
      const api = await import(pathToFileURL(path.join(context.root,'dist/index.js')).href);
      const {Server} = await import('@modelcontextprotocol/sdk/server/index.js');
      const {CallToolRequestSchema} = await import('@modelcontextprotocol/sdk/types.js');
      const sdk = /** @type {any} */ (Server.prototype), analysis = /** @type {any} */ (api.FoveaHost.prototype);
      const saved = {set:sdk.setRequestHandler,connect:sdk.connect,close:sdk.close,bind:analysis.bind,retire:analysis.retireConversation,stop:analysis.close};
      const handlers = new Map();
      const root = fs.mkdtempSync(path.join(context.fixturesRoot,'built-artifacts-'));
      const dirs = Object.fromEntries(['runtime','data','workspace'].map(n=>{const p=path.join(root,n);fs.mkdirSync(p,{mode:0o700});return [n,p];}));
      let snapshot = {status:'verified',roots:[{uri:pathToFileURL(dirs.workspace).href}]};
      const workspaceContext = {current:async()=>snapshot,invalidate(){}};
      let executions=0, factories=0, sequence=0, server;
      const config = {schemaVersion:1,approvals:{read:'allow',write:'allow'},executor:{maxOutputChars:2000},mcp:{enabled:false}};
      fs.mkdirSync(path.join(dirs.data,'fabric','config'),{recursive:true,mode:0o700});
      fs.writeFileSync(path.join(dirs.data,'fabric','config','config.json'),JSON.stringify(config),{mode:0o600,flag:'wx'});
      const call = (name,args) => handlers.get(CallToolRequestSchema)({method:'tools/call',params:{name,arguments:args}}, {requestId:++sequence,signal:new AbortController().signal});
      const execute = code => call('fabric_exec',{code,resultFormat:'json'});
      const page = async id => {
        const response = await execute(`return await artifacts.read({id:${JSON.stringify(id)},limit:128});`);
        assert.notEqual(response.isError,true,'same-owner handle must remain readable: '+response.content[0].text);
        return JSON.parse(response.content[0].text);
      };
      sdk.setRequestHandler = function(schema,handler) {handlers.set(schema,handler);};
      sdk.connect = async function() {};
      sdk.close = async function() {};
      analysis.bind = function() {return {rootId:'fixture',observer:{},invoke(){throw new Error('analysis forbidden in artifact test');},async close(){}};};
      analysis.retireConversation = async function() {};
      analysis.close = async function() {};
      try {
        server = await api.createKiroMcpServer({runtimeRoot:dirs.runtime,dataRoot:dirs.data,version:'0.0.0-w3',workspaceContext,
          prepareRuntime:options=>{factories++;const runtime=api.createKiroRuntime(options);const real=runtime.service.execute.bind(runtime.service);
            runtime.service.execute = args=>{executions++;return real(args);};return runtime;}});
        const overflow = await execute('await fabric.workspace({action:"detach"}); return "W3-built:" + "x".repeat(8000);');
        assert.notEqual(overflow.isError,true,overflow.content[0].text);
        assert.equal(overflow.structuredContent.deliveryStatus,'artifact');
        const id=overflow.structuredContent.artifactId;assert.match(id,/^ka_[a-f0-9]{48}$/);
        assert.equal(executions,1,'no program replay during transition');
        assert.ok((await page(id)).text.includes('W3-built:'),'retained original result');
        assert.equal(factories,2,'read executes in a replacement runtime');
        assert.equal(overflow.structuredContent.workspaceTransition.committed,true);
        const checkpoint = await execute('return await artifacts.checkpoint({value:{marker:"W3-checkpoint"}});');
        assert.notEqual(checkpoint.isError,true,checkpoint.content[0].text);
        const checkpointId = checkpoint.content[0].text.match(/ka_[a-f0-9]{48}/)?.[0];assert.ok(checkpointId);
        const listed = await call('fabric_workspace',{action:'list'});
        const rootId = JSON.parse(listed.content[0].text).roots[0].rootId;
        assert.notEqual((await call('fabric_workspace',{action:'select',rootId})).isError,true);
        assert.ok((await page(checkpointId)).text.includes('W3-checkpoint'));
        const failed = await execute('await artifacts.checkpoint({value:"audit evidence"}); throw new Error("expected recovery fixture");');
        assert.equal(failed.isError,true);const receiptId=failed.structuredContent.receiptId;assert.match(receiptId,/^ka_[a-f0-9]{48}$/);
        assert.notEqual((await call('fabric_workspace',{action:'detach'})).isError,true);
        assert.ok((await page(receiptId)).text.includes('"schemaVersion":1'));
        snapshot={status:'temporarily-unavailable',roots:[]};
        assert.ok((await page(id)).text.includes('W3-built:'));
        const denied = await execute('return await local.read({path:"should-never-be-opened"});');
        assert.equal(denied.isError,true,'artifact recovery must not grant workspace access');
        assert.match(denied.content[0].text,/workspace|unavailable/i);
        const declarations=fs.readFileSync(path.join(context.root,'dist/index.d.ts'),'utf8');
        assert.match(declarations,/FabricArtifactAccess/);
        const manifest=JSON.parse(fs.readFileSync(path.join(context.root,'dist/kiro-agent-closure/closure-manifest.json'),'utf8'));
        const sources=['src/kiro/artifact-owner.ts','src/kiro/artifacts.ts','src/kiro/power/artifacts-provider.ts','src/kiro/mcp-server.ts',"src/kiro/mcp-session.ts", "src/kiro/mcp-session-lifecycle.ts", "src/kiro/mcp-execution.ts", "src/kiro/mcp-workspace.ts", "src/kiro/mcp-response.ts",'src/kiro/projection.ts','src/protocol.ts','src/execution-service.ts'];
        for(const file of sources) assert.equal(manifest.buildInputs.files.find(x=>x.path===file)?.sha256,createHash('sha256').update(fs.readFileSync(path.join(context.root,file))).digest('hex'),'stale artifact build: '+file);
        await server.close();
        assert.equal(fs.readdirSync(path.join(dirs.data,'fabric','artifacts')).length,0,'owner retirement disposes owned response files');
        return {executions,factories,realExecutor:true,realProviderBridge:true,overflowSurvived:true,checkpointSurvived:true,receiptSurvived:true,unavailableWorkspaceRead:true,workspaceAuthorityNotRestored:true,verifiedSourceInputs:sources,fixture:root,qualification:false};
      } finally {
        try {if(server)await server.close();}
        finally {sdk.setRequestHandler=saved.set;sdk.connect=saved.connect;sdk.close=saved.close;analysis.bind=saved.bind;analysis.retireConversation=saved.retire;analysis.close=saved.stop;}
      }
    }}];
}
