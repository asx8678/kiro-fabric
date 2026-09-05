import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
import {createKiroRuntime,DEFAULT_FABRIC_CONFIG} from './dist/index.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'audit-runtime-')); const config=structuredClone(DEFAULT_FABRIC_CONFIG); config.mcp.enabled=false;
const options={cwd:root,configFile:path.join(root,'unused'),mcpConfigPath:path.join(root,'unused-mcp'),artifactsRoot:path.join(root,'artifacts'),stateRoot:path.join(root,'state'),memoryRoot:path.join(root,'memory'),memoryNamespace:'audit:synthetic',config};
let runtime=createKiroRuntime(options); const approvals=[]; const approver={async approve(action,args){approvals.push({ref:action.ref,args});}};
try{
 const first=await runtime.service.execute({code:'await state.set({key:"audit",value:7}); await memory.set({key:"audit",value:"hello"}); return {state:await state.get({key:"audit"}),memory:await memory.get({key:"audit"})};',approver});
 assert.equal(first.success,true,first.error); assert.equal(first.value.state.value,7); assert.equal(first.value.memory.value,'hello'); assert.equal(first.audits.length,4); assert.equal(approvals.length,4);
 const invalid=await runtime.service.execute({code:'const value: number = "wrong"; return value;',approver}); assert.equal(invalid.success,false); assert.ok(invalid.typeErrors.length>0); assert.equal(approvals.length,4);
 await runtime.close(); runtime=createKiroRuntime(options);
 const restarted=await runtime.service.execute({code:'return {state:await state.get({key:"audit"}),memory:await memory.get({key:"audit"})};',approver}); assert.equal(restarted.success,true,restarted.error); assert.equal(restarted.value.state.value,7); assert.equal(restarted.value.memory.value,'hello');
 console.log(JSON.stringify({builtLibrary:true,checkedQuickJsRoundTrip:true,exactApprovalCallbacks:4,typeErrorPreventedDispatch:true,closeReopenPersistence:true,networkRequests:0,scope:'same OS process; fresh runtime, not real Kiro or MCP transport'}));
 const original=fs.fsyncSync; fs.fsyncSync=()=>{throw new Error('synthetic artifact fsync EIO');};
 let artifactRejected=false; try{runtime.artifacts.write('synthetic artifact');}catch{artifactRejected=true;}finally{fs.fsyncSync=original;}
 await runtime.close(); const remaining=fs.readdirSync(path.join(root,'artifacts')).length;
 console.log(JSON.stringify({artifactWriteRejected:artifactRejected,artifactFilesAfterClose:remaining,expectedArtifactFilesAfterClose:0,defectObserved:remaining>0}));
}finally{await runtime.close();fs.rmSync(root,{recursive:true,force:true});}
