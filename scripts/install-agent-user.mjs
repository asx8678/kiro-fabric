#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAgentProfile } from "./agent-profile.mjs";
import { validateAgentPackage } from "./validate-agent-package.mjs";

const OWNER="kiro-fabric-agent-user-install", MANIFEST="install-owner.json";
const lstat=(p)=>{try{return fs.lstatSync(p)}catch(e){if(e?.code==="ENOENT")return undefined;throw e}};
const sha=(b)=>createHash("sha256").update(b).digest("hex");
const assertOwnedDir=(p,priv=false)=>{const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||(typeof process.getuid==="function"&&s.uid!==process.getuid())||(process.platform!=="win32"&&(s.mode&(priv?0o077:0o022))!==0))throw new Error(`unsafe directory: ${p}`);return fs.realpathSync(p)};
const ensure=(p)=>{if(!lstat(p))fs.mkdirSync(p,{recursive:true,mode:0o700});if(process.platform!=="win32")fs.chmodSync(p,0o700);return assertOwnedDir(p,true)};
const safeFile=(p)=>{const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(typeof process.getuid==="function"&&s.uid!==process.getuid())||(process.platform!=="win32"&&(s.mode&0o022)!==0))throw new Error(`unsafe control file: ${p}`);return s};
const copy=(src,dst)=>{const s=fs.lstatSync(src);if(s.isSymbolicLink())throw new Error(`symlink source: ${src}`);if(s.isDirectory()){fs.mkdirSync(dst,{mode:0o700});for(const e of fs.readdirSync(src).sort())copy(path.join(src,e),path.join(dst,e));}else{if(!s.isFile()||s.nlink!==1)throw new Error(`unsupported source: ${src}`);fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);fs.chmodSync(dst,0o600)}};
const atomic=(target,bytes)=>{const parent=ensure(path.dirname(target)), tmp=path.join(parent,`.${path.basename(target)}.${process.pid}.${randomBytes(8).toString("hex")}`);fs.writeFileSync(tmp,bytes,{mode:0o600,flag:"wx"});const fd=fs.openSync(tmp,"r");fs.fsyncSync(fd);fs.closeSync(fd);fs.renameSync(tmp,target);const d=fs.openSync(parent,"r");fs.fsyncSync(d);fs.closeSync(d)};
export const resolveKiroHome=(env=process.env,home=homedir())=>path.resolve((env.KIRO_HOME??"").trim()||path.join(home,".kiro"));
const paths=(home)=>({base:path.join(home,"kiro-fabric"),profile:path.join(home,"agents","kiro-fabric.json"),manifest:path.join(home,"kiro-fabric",MANIFEST),data:path.join(home,"kiro-fabric","data"),skills:path.join(home,"kiro-fabric","skills")});
const readManifest=(p)=>{if(!lstat(p))return;safeFile(p);const v=JSON.parse(fs.readFileSync(p,"utf8"));if(v.owner!==OWNER||v.schemaVersion!==1)throw new Error("unowned Kiro Fabric installation");return v};
const assertUnmodified=(target,digest,label)=>{if(!lstat(target)||sha(fs.readFileSync(target))!==digest)throw new Error(`refusing to replace modified or missing owned ${label}: ${target}`)};
export const installUserAgent=(stagingRoot=".tmp/kiro-fabric-agent",env=process.env,home=homedir(),options={})=>{
 if(!["linux","darwin"].includes(process.platform))throw new Error("Agent installation requires Linux or macOS");
 if(!/^v?(?:2[4-9]|[3-9]\d|\d{3,})\./u.test(process.version))throw new Error("Node.js >=24 is required");
 const staged=validateAgentPackage(stagingRoot), kiroHome=resolveKiroHome(env,home);ensure(kiroHome);const p=paths(kiroHome);ensure(p.base);ensure(path.join(p.base,"runtime"));ensure(p.data);ensure(path.join(p.data,"fabric"));ensure(p.skills);ensure(path.dirname(p.profile));
 const lock=path.join(p.base,".install.lock");try{fs.mkdirSync(lock,{mode:0o700})}catch(e){if(e?.code==="EEXIST")throw new Error("another Kiro Fabric install is in progress");throw e}
 try{const previous=readManifest(p.manifest);if(previous){assertUnmodified(p.profile,previous.profileSha256,"profile");assertUnmodified(path.join(p.skills,"fabric-exec","SKILL.md"),previous.skillSha256,"skill")}
  const generation=path.join(p.base,"runtime",staged.digest);if(!lstat(generation)){const tmp=`${generation}.installing-${process.pid}`;copy(path.join(staged.root,"runtime"),tmp);fs.renameSync(tmp,generation)}else assertOwnedDir(generation,true);
  const skillTarget=path.join(p.skills,"fabric-exec");if(lstat(skillTarget)){if(!previous)throw new Error(`refusing to overwrite unowned skill: ${skillTarget}`);fs.rmSync(skillTarget,{recursive:true})}copy(path.join(staged.root,"skills","fabric-exec"),skillTarget);
  if(options.migratePowerData){const legacy=path.resolve(options.migratePowerData), legacyFabric=path.basename(legacy)==="fabric"?legacy:path.join(legacy,"fabric");assertOwnedDir(legacyFabric,true);if(fs.readdirSync(path.join(p.data,"fabric")).length)throw new Error("agent data is not empty; migration refused");for(const name of ["config","projects"]){const src=path.join(legacyFabric,name);if(lstat(src))copy(src,path.join(p.data,"fabric",name))}}
  const profile=generateAgentProfile({nodePath:fs.realpathSync(process.execPath),runtimeRoot:generation,dataRoot:p.data,skillPath:path.join(skillTarget,"SKILL.md")});const profileBytes=JSON.stringify(profile,null,2)+"\n";if(lstat(p.profile)&&!previous)throw new Error(`refusing to overwrite unowned profile: ${p.profile}`);atomic(p.profile,profileBytes);
  const manifest={schemaVersion:1,owner:OWNER,packageDigest:staged.digest,profileSha256:sha(profileBytes),skillSha256:sha(fs.readFileSync(path.join(skillTarget,"SKILL.md"))),runtime:generation};atomic(p.manifest,JSON.stringify(manifest,null,2)+"\n");
  return {root:p.base,profile:p.profile,runtime:generation,data:p.data,packageDigest:staged.digest};
 }finally{fs.rmSync(lock,{recursive:true,force:true})}
};
export const uninstallUserAgent=(env=process.env,home=homedir(),options={})=>{const p=paths(resolveKiroHome(env,home)),m=readManifest(p.manifest);if(!m)throw new Error("Kiro Fabric Agent is not installed");assertUnmodified(p.profile,m.profileSha256,"profile");assertUnmodified(path.join(p.skills,"fabric-exec","SKILL.md"),m.skillSha256,"skill");fs.rmSync(p.profile);fs.rmSync(p.skills,{recursive:true});fs.rmSync(path.join(p.base,"runtime"),{recursive:true});fs.rmSync(p.manifest);if(options.purgeData)fs.rmSync(p.data,{recursive:true});return {profile:p.profile,dataPreserved:!options.purgeData,data:p.data}};
if(process.argv[1]===fileURLToPath(import.meta.url)){try{const uninstall=process.argv.includes("--uninstall"),purgeData=process.argv.includes("--purge-data"),mi=process.argv.indexOf("--migrate-power-data"),migratePowerData=mi>=0?process.argv[mi+1]:undefined;const result=uninstall?uninstallUserAgent(process.env,homedir(),{purgeData}):installUserAgent(process.argv.find((v,i)=>i>1&&!v.startsWith("--"))??undefined,process.env,homedir(),{migratePowerData});console.log(JSON.stringify(result));if(!uninstall)console.log(`Validate: kiro-cli agent validate --path ${result.profile}\nLaunch: kiro-cli chat --agent kiro-fabric\nDefault (optional): kiro-cli agent set-default kiro-fabric`)}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1}}
