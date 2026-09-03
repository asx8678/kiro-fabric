#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generateAgentProfile } from "./agent-profile.mjs";
import { validateAgentPackage } from "./validate-agent-package.mjs";

if(!["linux","darwin"].includes(process.platform)) throw new Error(`Agent staging requires Linux or macOS (received ${process.platform})`);
const parent=fs.realpathSync(path.resolve(".tmp")); fs.chmodSync(parent,0o700);
const stable=path.join(parent,"kiro-fabric-agent"), dataRoot=path.join(parent,"kiro-fabric-agent-data");
fs.mkdirSync(dataRoot,{recursive:true,mode:0o700}); fs.chmodSync(dataRoot,0o700);
const building=path.join(parent,`.kiro-fabric-agent-building-${process.pid}-${randomBytes(8).toString("hex")}`);
const copy=(source,target)=>{const s=fs.lstatSync(source);if(s.isSymbolicLink()||(!s.isDirectory()&&(!s.isFile()||s.nlink!==1)))throw new Error(`unsafe source: ${source}`);if(s.isDirectory()){fs.mkdirSync(target,{mode:0o700});for(const e of fs.readdirSync(source).sort())copy(path.join(source,e),path.join(target,e));}else{fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);fs.chmodSync(target,0o600)}};
try{
 fs.mkdirSync(building,{mode:0o700}); copy("dist/kiro-agent-closure",path.join(building,"runtime")); copy("skills",path.join(building,"skills")); copy("agent-product.json",path.join(building,"agent-product.json"));
 const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); fs.writeFileSync(path.join(building,"package.json"),JSON.stringify({name:pkg.name,version:pkg.version,type:"module",private:true},null,2)+"\n",{mode:0o600});
 const profile=generateAgentProfile({nodePath:process.execPath,runtimeRoot:path.join(stable,"runtime"),dataRoot,skillPath:path.join(stable,"skills/fabric-exec/SKILL.md")}); fs.writeFileSync(path.join(building,"agent.json"),JSON.stringify(profile,null,2)+"\n",{mode:0o600});
 const provisional=validateAgentPackage(building); const generation=path.join(parent,`.kiro-fabric-agent-generation-${provisional.digest}`);
 if(fs.existsSync(generation))fs.rmSync(building,{recursive:true});else fs.renameSync(building,generation);
 const link=`${stable}.next-${process.pid}`;try{fs.symlinkSync(path.basename(generation),link,"dir");fs.renameSync(link,stable)}catch(e){try{fs.unlinkSync(link)}catch{};throw e}
 const result=validateAgentPackage(stable); process.stdout.write(`${JSON.stringify({...result,generation})}\n${stable}\n`);
}catch(e){fs.rmSync(building,{recursive:true,force:true});throw e}
