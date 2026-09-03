#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_TOOLS, FABRIC_TOOLS } from "./agent-profile.mjs";

const fail = (message) => { throw new Error(`invalid Kiro Agent package: ${message}`); };
const normalized = (value) => value.replaceAll("\\", "/");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedRootEntries = new Set(["agent.json", "agent-product.json", "package.json", "runtime", "skills", ".kiro-fabric-agent-owner.json"]);
const packageRoot = (input) => {
  const lexical = path.resolve(input); const stats = fs.lstatSync(lexical);
  if (!stats.isSymbolicLink()) return lexical;
  const target = fs.readlinkSync(lexical);
  if (path.isAbsolute(target) || target.includes(path.sep) || !/^\.kiro-fabric-agent-generation-[a-f0-9]{64}$/u.test(target)) fail("unapproved staging pointer");
  const resolved = fs.realpathSync(lexical);
  if (path.dirname(resolved) !== fs.realpathSync(path.dirname(lexical))) fail("staging pointer escapes parent");
  return resolved;
};
export const walkPackage = (input) => { const root=packageRoot(input), files=[]; const visit=(dir)=>{ for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){ const target=path.join(dir,entry.name), stats=fs.lstatSync(target); if(stats.isSymbolicLink()) fail(`symlink: ${path.relative(root,target)}`); if(entry.isDirectory()) visit(target); else if(entry.isFile()&&stats.nlink===1) files.push(target); else fail(`unsupported entry: ${path.relative(root,target)}`); }}; visit(root); return files; };
export const digestAgentPackage = (input, options={}) => { const root=packageRoot(input), digest=createHash("sha256"); const files=walkPackage(root).filter(f=>!(options.excludeOwner&&path.basename(f)===".kiro-fabric-agent-owner.json")); for(const file of files){ const content=fs.readFileSync(file); digest.update(normalized(path.relative(root,file))).update("\0").update(String(fs.statSync(file).mode&0o777)).update("\0").update(content); } return {digest:digest.digest("hex"),files:files.length,bytes:files.reduce((n,f)=>n+fs.statSync(f).size,0)}; };
export const validateAgentPackage = (input) => {
 const rootPath=packageRoot(input), rootStats=fs.lstatSync(rootPath); if(!rootStats.isDirectory()||rootStats.isSymbolicLink()) fail("root is not a directory");
 if(process.platform!=="win32"&&((rootStats.mode&0o077)!==0||(typeof process.getuid==="function"&&rootStats.uid!==process.getuid()))) fail("root is not private/current-user owned");
 const root=fs.realpathSync(rootPath); const files=walkPackage(root); if(files.length>500||files.reduce((n,f)=>n+fs.statSync(f).size,0)>64*1024*1024) fail("package bounds exceeded");
 for(const entry of fs.readdirSync(root)) if(!allowedRootEntries.has(entry)) fail(`unexpected root entry: ${entry}`);
 for(const required of ["agent.json","agent-product.json","package.json","runtime","skills"]) if(!fs.existsSync(path.join(root,required))) fail(`${required} absent`);
 const json=(name)=>JSON.parse(fs.readFileSync(path.join(root,name),"utf8")); const profile=json("agent.json"), product=json("agent-product.json"), pkg=json("package.json");
 if(pkg.name!=="kiro-fabric"||pkg.private!==true||pkg.type!=="module") fail("package identity drifted");
 if(profile.name!=="kiro-fabric"||profile.includePowers!==false||profile.includeMcpJson!==false||JSON.stringify(profile.tools)!==JSON.stringify(AGENT_TOOLS)) fail("agent profile drifted");
 if(Object.keys(profile.mcpServers??{}).join()!=="fabric"||profile.model!==undefined) fail("agent MCP/model drifted");
 if(product.product!=="kiro-fabric-agent"||JSON.stringify(product.tools)!==JSON.stringify(FABRIC_TOOLS)) fail("agent product contract drifted");
 const authority=JSON.parse(fs.readFileSync(path.join(repositoryRoot,"agent-product.json"),"utf8")); if(JSON.stringify(product)!==JSON.stringify(authority)) fail("agent product differs from authority");
 const closure=json("runtime/closure-manifest.json"); if(closure.product!=="kiro-fabric-agent"||closure.executor!=="quickjs") fail("closure identity drifted");
 const expected=new Set(closure.files.map(e=>e.path)); const actual=walkPackage(path.join(root,"runtime")).map(f=>normalized(path.relative(path.join(root,"runtime"),f))).filter(f=>f!=="closure-manifest.json"); if(JSON.stringify([...expected].sort())!==JSON.stringify(actual.sort())) fail("closure inventory drifted");
 for(const e of closure.files){ const bytes=fs.readFileSync(path.join(root,"runtime",e.path)); if(bytes.length!==e.bytes||createHash("sha256").update(bytes).digest("hex")!==e.sha256) fail(`closure digest: ${e.path}`); }
 const skillFiles=walkPackage(path.join(root,"skills","fabric-exec")).map(f=>normalized(path.relative(path.join(root,"skills","fabric-exec"),f))).sort(); if(JSON.stringify(skillFiles)!==JSON.stringify(["SKILL.md","references/api.md"])) fail("skill set drifted");
 return {ok:true,root,version:pkg.version,...digestAgentPackage(root,{excludeOwner:true})};
};
if(process.argv[1]===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(validateAgentPackage(process.argv[2]??process.cwd())))}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1}}
