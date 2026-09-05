import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createKiroRuntime, DEFAULT_FABRIC_CONFIG} from './dist/index.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'state-io-probe-'));
const config=structuredClone(DEFAULT_FABRIC_CONFIG); config.mcp.enabled=false;
const runtime=createKiroRuntime({cwd:root, configFile:path.join(root,'unused.json'),mcpConfigPath:path.join(root,'unused-mcp.json'),artifactsRoot:path.join(root,'artifacts'),stateRoot:path.join(root,'state'),config});
const call=(value)=>runtime.registry.invoke('state.set',{key:'synthetic',value},{cwd:root,audits:[],maxResultChars:10000,async approve(){}});
const original=fs.fsyncSync;
try {
 await call('committed');
 let syncs=0;
 fs.fsyncSync=function(fd){if(++syncs===2) throw Object.assign(new Error('synthetic document fsync failure'),{code:'EIO'}); return original.call(fs,fd);};
 let rejected=false;
 try{await call('uncommitted');}catch(e){rejected=e.message==='synthetic document fsync failure';}
 fs.fsyncSync=original;
 assert.equal(rejected,true);
 const files=fs.readdirSync(path.join(root,'state'));
 const residue=files.filter(f=>f.startsWith('.state-')&&f.endsWith('.tmp'));
 const current=await runtime.registry.invoke('state.get',{key:'synthetic'},{cwd:root,audits:[],maxResultChars:10000,async approve(){}});
 assert.equal(current.value,'committed');
 assert.equal(files.includes('.state-mutation.lock'),false);
 console.log(JSON.stringify({scenario:'document fsync EIO after an existing commit',operationRejected:rejected,previousValuePreserved:true,lockReleased:true,temporaryFilesRemaining:residue.length,expectedTemporaryFilesRemaining:0,defectObserved:residue.length>0}));
} finally {fs.fsyncSync=original;await runtime.close();fs.rmSync(root,{recursive:true,force:true});}
