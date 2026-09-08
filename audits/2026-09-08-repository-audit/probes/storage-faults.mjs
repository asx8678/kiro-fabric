import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const checkout=process.cwd();
if (!checkout.startsWith("/tmp/kiro-fabric-audit-")) throw new Error("Disposable checkout required");
const require=createRequire(path.join(checkout,"package.json"));
const {build}=require("esbuild");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"audit-storage-"));
const compiled=path.join(temp,"storage.mjs");
await build({stdin:{contents:'export {openKiroMemory} from "./src/kiro/memory.ts"; export {createKiroArtifactStore} from "./src/kiro/artifacts.ts";',resolveDir:checkout,sourcefile:"audit-storage-entry.ts"},bundle:true,platform:"node",format:"esm",outfile:compiled,logLevel:"silent"});
const {openKiroMemory,createKiroArtifactStore}=await import(pathToFileURL(compiled).href);
const report={method:"Synthetic storage fault injection; existing source bundled unchanged; no live paths"};
const memory=openKiroMemory("audit",path.join(temp,"memory"));
await memory.set("sample","before");
const originalOpen=fs.openSync,originalClose=fs.closeSync;
let target,closeAttempts=0,closeFault=false;
fs.openSync=function(file,...args){const fd=originalOpen.call(fs,file,...args);if(String(file).includes(".sample.json.")&&String(file).endsWith(".tmp"))target=fd;return fd;};
fs.closeSync=function(fd){if(fd===target){closeAttempts++;if(!closeFault){closeFault=true;originalClose.call(fs,fd);throw Object.assign(new Error("synthetic close completed then EIO"),{code:"EIO"});}}return originalClose.call(fs,fd);};
let memoryError;
try {await memory.set("sample","after");}catch(error){memoryError={name:error.name,code:error.code,message:error.message};}
finally {fs.openSync=originalOpen;fs.closeSync=originalClose;}
const walk=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
report.memory={closeAttempts,error:memoryError,retainedValue:(await memory.get("sample")).value,temporaryFiles:walk(path.join(temp,"memory")).filter(f=>f.endsWith(".tmp")).length};
const artifactRoot=path.join(temp,"artifacts"),store=createKiroArtifactStore({root:artifactRoot,maxArtifacts:2,maxTotalChars:100});
const id=store.write("synthetic-result");
const originalRemove=fs.rmSync;
fs.rmSync=function(file,...args){if(String(file)===path.join(artifactRoot,id))throw Object.assign(new Error("synthetic temporary artifact removal EIO"),{code:"EIO"});return originalRemove.call(fs,file,...args);};
let sweepError;
try{store.sweep(0,0);}catch(error){sweepError=error.message;}finally{fs.rmSync=originalRemove;}
store.close();
report.artifacts={sweepError,successfulClose:true,remainingFiles:fs.readdirSync(artifactRoot).length};
console.log(JSON.stringify(report,null,2));
// Synthetic fixture intentionally preserved under disposable TMPDIR for reproduction.
