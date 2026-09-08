import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const checkout=process.cwd();
if(!checkout.startsWith('/tmp/kiro-fabric-audit-'))throw Error('Disposable checkout required');
const require=createRequire(path.join(checkout,'package.json'));
const {build}=require('esbuild');
const output=path.join(checkout,'.tmp','audit-mcp-close.mjs');
await build({entryPoints:[path.join(checkout,'src/kiro/mcp-provider.ts')],bundle:true,packages:'external',platform:'node',format:'esm',outfile:output,logLevel:'silent'});
const {KiroMcpProvider}=await import(pathToFileURL(output).href);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'audit-mcp-close-'));
fs.chmodSync(temp,0o700);
const config=path.join(temp,'mcporter.json');
fs.writeFileSync(config,JSON.stringify({imports:[],mcpServers:{}}),{mode:0o600});
const provider=new KiroMcpProvider(temp,{enabled:true,configPath:config,disableOAuth:true,callTimeoutMs:1000});
const open=fs.openSync,close=fs.closeSync;
let target,attempts=0,faulted=false,error;
fs.openSync=function(file,...args){const fd=open.call(fs,file,...args);if(String(file).includes('.kiro-fabric-mcp-snapshot-'))target=fd;return fd;};
fs.closeSync=function(fd){if(fd===target){attempts++;if(!faulted){faulted=true;close.call(fs,fd);throw Object.assign(Error('synthetic close completed then EIO'),{code:'EIO'});}}return close.call(fs,fd);};
try{await provider.invoke('$servers',{}, {cwd:temp});}catch(e){error={name:e.name,code:e.code,message:e.message};}
finally{fs.openSync=open;fs.closeSync=close;await provider.close();}
console.log(JSON.stringify({method:'Unchanged source with synthetic empty MCP configuration; no server connection or credentials. Simulated completed-close EIO.',closeAttempts:attempts,error,stagingFilesRemaining:fs.readdirSync(temp).filter(n=>n.startsWith('.kiro-fabric-mcp-snapshot-')).length},null,2));
