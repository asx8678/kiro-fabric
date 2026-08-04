import path from "node:path";
import { lstat, realpath, readFile, writeFile } from "node:fs/promises";
import fg from "fast-glob";
import { spawn } from "node:child_process";
import type { FabricConfig } from "./config.js";
import type { AiRunner, NormalizedAiRequest } from "./runners/types.js";
import { FabricError } from "./errors.js";
import { parseFramed } from "./runners/parser.js";
import { RequestRedactor } from "./redaction.js";
import { loadPrompt } from "./prompts.js";
import {
  PermissionGate,
  commitRequest,
  headlessPrompter,
  shellRequest,
  networkRequest,
  type ApprovalPrompter,
} from "./permissions.js";

const denied =
  /(^|\/)(\.env(?:\..*)?|\.git|node_modules|dist|build|coverage|secrets?|\.fabric-lite)(\/|$)/i;
const deniedGlobs = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.env*",
  "**/secret/**",
  "**/secrets/**",
  "**/.fabric-lite/**",
];

function relativeSafe(root: string, candidate: string): string {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    denied.test(relative.replaceAll(path.sep, "/"))
  ) {
    throw new FabricError("POLICY_DENIED", `Path is denied: ${candidate}`);
  }
  return absolute;
}

async function safePath(root: string, candidate: string, existing = true): Promise<string> {
  const absolute = relativeSafe(root, candidate);
  try {
    const [actualRoot, actual] = await Promise.all([
      realpath(root),
      realpath(existing ? absolute : path.dirname(absolute)),
    ]);
    const relative = path.relative(actualRoot, actual);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new FabricError("POLICY_DENIED", `Symlink escapes project root: ${candidate}`);
    }
  } catch (error) {
    if (existing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  return text.length <= max
    ? { text, truncated: false }
    : { text: text.slice(0, max), truncated: true };
}

function textContent(buffer: Buffer, label: string): string {
  if (buffer.includes(0)) {
    throw new FabricError("POLICY_DENIED", `Binary file denied: ${label}`);
  }
  return buffer.toString("utf8");
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

async function command(
  argv: string[],
  cwd: string,
  timeoutMs = 30000,
  env?: NodeJS.ProcessEnv,
  maxChars = 100_000,
  stdin?: string | Buffer,
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const add = (which: "stdout" | "stderr", chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      const current = which === "stdout" ? stdout : stderr;
      const left = Math.max(0, maxChars - current.length);
      if (which === "stdout") {
        stdout += text.slice(0, left);
        stdoutTruncated ||= text.length > left;
      } else {
        stderr += text.slice(0, left);
        stderrTruncated ||= text.length > left;
      }
    };
    if (stdin !== undefined) child.stdin!.end(stdin);
    child.stdout!.on("data", (chunk: Buffer) => add("stdout", chunk));
    child.stderr!.on("data", (chunk: Buffer) => add("stderr", chunk));
    const kill = (): void => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The process may already have exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, stdoutTruncated, stderrTruncated });
    });
  });
}

export interface Metrics {
  aiCalls: number;
  workerCalls: number;
  retries: number;
  inputChars: number;
  outputChars: number;
}

export interface AiResult<T = unknown> {
  value: T | undefined;
  role: string;
  /** @deprecated requested/legacy model */
  model?: string;
  requestedModel?: string;
  resolvedModel?: string;
  resolutionSource: "kiro-metadata" | "runner" | "unknown";
  inputChars: number;
  outputChars: number;
  repaired: boolean;
  error?: { code: string; message: string };
}

class BudgetState {
  readonly metrics: Metrics = {
    aiCalls: 0,
    workerCalls: 0,
    retries: 0,
    inputChars: 0,
    outputChars: 0,
  };
  private roles = { planner: 0, worker: 0, verifier: 0, general: 0 };

  constructor(private readonly config: FabricConfig) {}

  reserve(role: keyof BudgetState["roles"], input: number, retry = false): void {
    const budgets = this.config.budgets;
    if (this.metrics.aiCalls + 1 > budgets.maxAiCalls) {
      throw new FabricError("BUDGET_EXCEEDED", `AI call limit ${budgets.maxAiCalls} exceeded`);
    }
    if (
      input > budgets.maxPromptCharsPerCall ||
      input > budgets.maxContextCharsPerCall + 6000 ||
      this.metrics.inputChars + input > budgets.maxTotalAiInputChars
    ) {
      throw new FabricError(
        "BUDGET_EXCEEDED",
        `AI input character budget exceeded by ${input}`,
      );
    }
    const limits = {
      planner: budgets.maxPlannerCalls,
      worker: budgets.maxWorkerCalls,
      verifier: budgets.maxVerifierCalls,
      general: budgets.maxWorkerCalls,
    };
    if (!retry && this.roles[role] + 1 > limits[role]) {
      throw new FabricError("BUDGET_EXCEEDED", `${role} call limit ${limits[role]} exceeded`);
    }
    this.metrics.aiCalls++;
    this.metrics.inputChars += input;
    if (!retry) {
      this.roles[role]++;
      if (role === "worker" || role === "general") this.metrics.workerCalls++;
    } else {
      this.metrics.retries++;
    }
  }

  output(chars: number): void {
    if (this.metrics.outputChars + chars > this.config.budgets.maxTotalAiOutputChars) {
      throw new FabricError("BUDGET_EXCEEDED", "Total AI output character budget exceeded");
    }
    this.metrics.outputChars += chars;
  }
}

export function createApi(
  config: FabricConfig,
  runner: AiRunner,
  gateOptions?: { prompter?: ApprovalPrompter },
): { fabric: any; metrics: Metrics } {
 const root=path.resolve(config.projectRoot); const budgets=new BudgetState(config);
 const gate=new PermissionGate({
   policy:config.permissions,
   prompter:gateOptions?.prompter ?? headlessPrompter,
   allowedCommands:config.shell.allowedCommands,
   projectRoot: root,
 });
 const fsApi={
  async read(input:{path:string;maxChars?:number;startLine?:number;endLine?:number}) { const p=await safePath(root,input.path); const raw=textContent(await readFile(p),input.path); const lines=raw.split("\n"), start=Math.max(1,input.startLine??1), end=Math.min(lines.length,input.endLine??lines.length); const selected=lines.slice(start-1,end).join("\n"), t=truncate(selected,Math.min(input.maxChars??config.filesystem.maxCharsPerFile,config.filesystem.maxCharsPerFile)); return {path:path.relative(root,p),content:t.text,chars:t.text.length,truncated:t.truncated,startLine:start,endLine:start+t.text.split("\n").length-1}; },
  async readMany(input:{paths:string[];maxFiles?:number;maxCharsPerFile?:number;maxTotalChars?:number}) { const maxFiles=Math.min(input.maxFiles??config.filesystem.maxFilesPerReadMany,config.filesystem.maxFilesPerReadMany); if(input.paths.length>maxFiles) throw new FabricError("BUDGET_EXCEEDED",`readMany file limit ${maxFiles} exceeded`); const out=[]; let total=0,maxTotal=Math.min(input.maxTotalChars??config.filesystem.maxTotalReadChars,config.filesystem.maxTotalReadChars); for(const p of input.paths){const r=await fsApi.read({path:p,maxChars:input.maxCharsPerFile??config.filesystem.maxCharsPerFile});if(total+r.chars>maxTotal){const left=Math.max(0,maxTotal-total);out.push({...r,content:r.content.slice(0,left),chars:left,truncated:true});break;}out.push(r);total+=r.chars;} return out; },
  async glob(input:{pattern:string;cwd?:string;maxResults?:number;ignore?:string[]}) { const cwd=await safePath(root,input.cwd??"."); const max=Math.min(input.maxResults??1000,5000); const values=await fg(input.pattern,{cwd,onlyFiles:true,dot:false,followSymbolicLinks:false,ignore:[...deniedGlobs,...(input.ignore??[])]}); return values.sort().slice(0,max).map(x=>path.relative(root,path.resolve(cwd,x)).replaceAll(path.sep,"/")); },
  async grep(input:{query:string;paths?:string[];glob?:string;maxMatches?:number;contextLines?:number}) { let regex:RegExp;try{regex=new RegExp(input.query,"i");}catch{throw new FabricError("POLICY_DENIED","Invalid grep regular expression");} const files=input.paths??await fsApi.glob({pattern:input.glob??"**/*",maxResults:2000}),max=input.maxMatches??200,ctx=Math.min(input.contextLines??0,10),matches:any[]=[]; for(const file of files){let r;try{r=await fsApi.read({path:file,maxChars:config.filesystem.maxCharsPerFile});}catch{continue;}const lines=r.content.split("\n");for(let i=0;i<lines.length;i++)if(regex.test(lines[i]!)){matches.push({path:file,line:i+1,text:lines[i],before:lines.slice(Math.max(0,i-ctx),i),after:lines.slice(i+1,i+1+ctx)});if(matches.length>=max)return{matches,files:[...new Set(matches.map(x=>x.path))],truncated:true};}}return{matches,files:[...new Set(matches.map(x=>x.path))],truncated:false}; },
  async stat(input:{path:string}) {const p=await safePath(root,input.path),s=await lstat(p);return{path:path.relative(root,p),type:s.isDirectory()?"directory":"file",size:s.size,modifiedMs:s.mtimeMs};},
  async write(input:{path:string;content:string}) { if(!config.filesystem.allowWrite.some(pattern=>input.path===pattern||(pattern.endsWith("/**")&&input.path.startsWith(pattern.slice(0,-3)+"/")))) throw new FabricError("POLICY_DENIED","Filesystem writes are disabled or path is not allowlisted");const p=await safePath(root,input.path,false);await writeFile(p,input.content,"utf8");return{path:path.relative(root,p),bytesWritten:Buffer.byteLength(input.content)};},
  async patch(input:{path:string;patch:string}) { const read=await fsApi.read({path:input.path,maxChars:config.filesystem.maxCharsPerFile});if(read.truncated)throw new FabricError("BUDGET_EXCEEDED","Refusing to patch a truncated file");const current=read.content; let spec:{old:string;new:string};try{spec=JSON.parse(input.patch) as {old:string;new:string};}catch{throw new FabricError("POLICY_DENIED",'patch must be JSON: {"old":"exact text","new":"replacement"}');}if(typeof spec.old!=="string"||typeof spec.new!=="string"||!current.includes(spec.old))throw new FabricError("POLICY_DENIED","Patch old text not found");await fsApi.write({path:input.path,content:current.replace(spec.old,spec.new)});return{path:input.path,applied:true};}
 };
 const git={
  async status(){const r=await command(["git","status","--porcelain=v1","--branch"],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const lines=r.stdout.trimEnd().split("\n"),head=lines.shift()??"";return{branch:head.match(/^## ([^. ]+)/)?.[1]??null,clean:lines.length===0,entries:lines};},
  async changedFiles(input:{base?:string;includeUntracked?:boolean}={}){const base=input.base??"HEAD";if(base.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(base))throw new FabricError("POLICY_DENIED","Invalid Git base");const args=["git","diff","--name-only",base,"--"];const r=await command(args,root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const files=r.stdout.trim().split("\n").filter(Boolean);if(input.includeUntracked){const u=await command(["git","ls-files","--others","--exclude-standard"],root);files.push(...u.stdout.trim().split("\n").filter(Boolean));}return[...new Set(files)].filter(x=>!denied.test(x));},
  async diff(input:{base?:string;paths?:string[];maxChars?:number}={}){for(const p of input.paths??[])relativeSafe(root,p);const base=input.base??"HEAD";if(base.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(base))throw new FabricError("POLICY_DENIED","Invalid Git base");const r=await command(["git","diff",base,"--",...(input.paths??[])],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const t=truncate(r.stdout,input.maxChars??30000);return{diff:t.text,truncated:t.truncated};},
  async log(input:{maxCount?:number;ref?:string}={}){const max=Math.min(Math.max(input.maxCount??20,1),100);const ref=input.ref??"HEAD";if(ref.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(ref))throw new FabricError("POLICY_DENIED","Invalid Git ref");const r=await command(["git","--no-pager","log",`--max-count=${max}`,"--date=iso-strict","--format=%H%x09%ad%x09%an%x09%s",ref],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());return truncate(r.stdout,30000);},
  async show(input:{ref?:string;path?:string;maxChars?:number}={}){const ref=input.ref??"HEAD";if(ref.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(ref))throw new FabricError("POLICY_DENIED","Invalid Git ref");let spec=ref;if(input.path){const absolute=relativeSafe(root,input.path);const relative=path.relative(root,absolute).replaceAll(path.sep,"/");if(!relative)throw new FabricError("POLICY_DENIED","Invalid Git path");spec=`${ref}:${relative}`;}const r=await command(["git","--no-pager","show","--no-ext-diff","--no-textconv",spec],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());return truncate(r.stdout,Math.min(input.maxChars??30000,30000));},
  async branches(){const r=await command(["git","for-each-ref","--format=%(refname:short)%09%(objectname)%09%(upstream:short)","refs/heads","refs/remotes"],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());return r.stdout.trim().split("\n").filter(Boolean);},
  async remotes(){const r=await command(["git","remote","-v"],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());return r.stdout.trim().split("\n").filter(Boolean);},
  async commit(input:{message:string;paths:string[]}){
   if(!config.git.allowCommit)throw new FabricError("POLICY_DENIED","Local Git commits are disabled by project policy");
   if(typeof input?.message!=="string"||input.message.trim()!==input.message||input.message.length<1||input.message.length>200||/[\u0000-\u001f\u007f]/.test(input.message))throw new FabricError("POLICY_DENIED","Commit message must be one trimmed line of 1-200 safe characters");
   if(!Array.isArray(input.paths)||input.paths.length===0||input.paths.some(candidate=>typeof candidate!=="string"||candidate.length===0))throw new FabricError("POLICY_DENIED","Commit requires non-empty explicit paths");
   const repo=await command(["git","rev-parse","--show-toplevel"],root);if(repo.code!==0)throw new FabricError("RUNTIME_FAILED",repo.stderr.trim()||"Not a Git repository");
   if(await realpath(repo.stdout.trim())!==await realpath(root))throw new FabricError("POLICY_DENIED","Git repository root must equal the Fabric project root");
   const repository=await realpath(root);
   const stagedBefore=await command(["git","diff","--cached","--name-only"],root);if(stagedBefore.code!==0)throw new FabricError("RUNTIME_FAILED",stagedBefore.stderr.trim());if(stagedBefore.stdout.trim())throw new FabricError("POLICY_DENIED","Refusing to commit with pre-existing staged changes");
   const paths:string[]=[];const entries:Array<{relative:string;absolute:string;mode:string}|{relative:string;deleted:true}>=[];
   for(const candidate of input.paths){
    const absolute=relativeSafe(root,candidate);const relative=path.relative(root,absolute).replaceAll(path.sep,"/");if(!relative||relative===".")throw new FabricError("POLICY_DENIED",`Path is denied: ${candidate}`);
    try{const info=await lstat(absolute);if(!info.isFile())throw new FabricError("POLICY_DENIED",`Commit paths must name regular files: ${candidate}`);const checked=await safePath(root,candidate);const canonical=await realpath(checked);const canonicalRelative=path.relative(repository,canonical).replaceAll(path.sep,"/");entries.push({relative:canonicalRelative,absolute:canonical,mode:(info.mode&0o111)!==0?"100755":"100644"});}catch(error){if(error instanceof FabricError)throw error;if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;const tracked=await command(["git","ls-files","--error-unmatch","--",relative],root);if(tracked.code!==0)throw new FabricError("POLICY_DENIED",`Commit path does not exist and is not a tracked deletion: ${candidate}`);entries.push({relative,deleted:true});}
    paths.push(relative);
   }
   const canonicalPaths=[...new Set(entries.map((entry)=>"absolute" in entry?entry.absolute:path.join(repository,entry.relative)))];
   if(!(await gate.authorize(commitRequest(input.message,repository,canonicalPaths))))throw new FabricError("POLICY_DENIED","Local Git commit was not approved");
   const unique=[...new Set(paths)];
   for(const entry of entries.filter((value,index)=>paths.indexOf(value.relative)===index)){
    if("deleted" in entry){const removed=await command(["git","-c","core.fsmonitor=false","update-index","--force-remove","--",entry.relative],root);if(removed.code!==0)throw new FabricError("RUNTIME_FAILED",removed.stderr.trim()||"Git index deletion failed");continue;}
    const content=await readFile(entry.absolute);if(content.length>config.filesystem.maxCharsPerFile)throw new FabricError("BUDGET_EXCEEDED",`Commit file exceeds ${config.filesystem.maxCharsPerFile} bytes: ${entry.relative}`);const hashed=await command(["git","hash-object","-w","--stdin"],root,30000,undefined,100000,content);if(hashed.code!==0||!/^[0-9a-f]{40}$/.test(hashed.stdout.trim()))throw new FabricError("RUNTIME_FAILED",hashed.stderr.trim()||"Git object hashing failed");
    const stagedEntry=await command(["git","-c","core.fsmonitor=false","update-index","--add","--cacheinfo",`${entry.mode},${hashed.stdout.trim()},${entry.relative}`],root);if(stagedEntry.code!==0)throw new FabricError("RUNTIME_FAILED",stagedEntry.stderr.trim()||"Git index update failed");
   }
   const staged=await command(["git","diff","--cached","--name-only"],root);if(staged.code!==0)throw new FabricError("RUNTIME_FAILED",staged.stderr.trim());const committedPaths=staged.stdout.trim().split("\n").filter(Boolean);if(committedPaths.length===0)throw new FabricError("RUNTIME_FAILED","Explicit paths contain no changes to commit");if(committedPaths.some(file=>!unique.includes(file)))throw new FabricError("POLICY_DENIED","Git staged a path outside the explicit commit set");
   const [oldHead,branch,tree]=await Promise.all([command(["git","rev-parse","HEAD"],root),command(["git","symbolic-ref","--quiet","--short","HEAD"],root),command(["git","-c","core.fsmonitor=false","write-tree"],root)]);if(oldHead.code!==0||tree.code!==0)throw new FabricError("RUNTIME_FAILED",oldHead.stderr.trim()||tree.stderr.trim());if(branch.code!==0||!branch.stdout.trim())throw new FabricError("POLICY_DENIED","Local commits require an attached branch");
   const created=await command(["git","-c","commit.gpgSign=false","commit-tree",tree.stdout.trim(),"-p",oldHead.stdout.trim()],root,30000,undefined,100000,`${input.message}\n`);if(created.code!==0||!/^[0-9a-f]{40}$/.test(created.stdout.trim()))throw new FabricError("RUNTIME_FAILED",created.stderr.trim()||"Git commit object creation failed");
   const ref=`refs/heads/${branch.stdout.trim()}`;const updated=await command(["git","update-ref",ref,created.stdout.trim(),oldHead.stdout.trim()],root);if(updated.code!==0)throw new FabricError("RUNTIME_FAILED",updated.stderr.trim()||"Git branch update failed");
   return{hash:created.stdout.trim(),branch:branch.stdout.trim(),message:input.message,paths:committedPaths};
  }
 };
const inspectionResult=(tool:string,operation:string,result:CommandResult)=>{if(result.code!==0)throw new FabricError("RUNTIME_FAILED",result.stderr.trim()||`${tool} ${operation} failed`);return{tool,operation,stdout:result.stdout,stderr:result.stderr,exitCode:result.code,truncated:result.stdoutTruncated||result.stderrTruncated};};
 const safeToken=(value:string|undefined,label:string,pattern=/^[A-Za-z0-9._\/:@-]+$/):string|undefined=>{if(value===undefined)return undefined;if(value.startsWith("-")||!pattern.test(value))throw new FabricError("POLICY_DENIED",`Invalid ${label}`);return value;};
 const readQuery=(query:string,dialect:"postgres"|"sqlite"):string=>{if(typeof query!=="string"||query.length>12000)throw new FabricError("POLICY_DENIED",`${dialect} query exceeds bounds`);const text=query.trim().replace(/;$/,"").trim();if(!text||text.includes(";")||text.includes("\\")||/--|\/\*/.test(text))throw new FabricError("POLICY_DENIED",`${dialect} inspection requires one comment-free statement`);if(!/^(select|with|table|values|show|explain(?:\s+query\s+plan)?)(\s|$)/i.test(text))throw new FabricError("POLICY_DENIED",`${dialect} inspection permits SELECT and read-only inspection statements only`);if(/\b(insert|update|delete|merge|copy|call|do|create|alter|drop|truncate|grant|revoke|vacuum|analyze|reindex|cluster|refresh|lock|listen|notify|set|reset|attach|detach|replace|upsert)\b/i.test(text)||/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(text)||/\bselect\s+.*\binto\b/is.test(text)||/\b(pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_log_backend_memory_contexts|pg_advisory|dblink|lo_import|lo_export|pg_read_file|pg_write_file|pg_ls_dir|pg_stat_file|pg_notify)\s*\(/i.test(text)||/^explain\s+(analyze|.*\banalyze\b)/i.test(text))throw new FabricError("POLICY_DENIED",`${dialect} statement may have side effects`);return text;};
 const inspect={
  async postgres(input:{query:string;host?:string;port?:number;user?:string;database?:string}){const query=readQuery(input.query,"postgres");const args=["psql","-X","--no-psqlrc","--set","ON_ERROR_STOP=1","--tuples-only","--no-align"];for(const [flag,value,label] of [["--host",input.host,"PostgreSQL host"],["--username",input.user,"PostgreSQL user"],["--dbname",input.database,"PostgreSQL database"]] as const){const safe=safeToken(value,label);if(safe)args.push(flag,safe);}if(input.port!==undefined){if(!Number.isInteger(input.port)||input.port<1||input.port>65535)throw new FabricError("POLICY_DENIED","Invalid PostgreSQL port");args.push("--port",String(input.port));}args.push("--command",`BEGIN READ ONLY; SET LOCAL statement_timeout = '30s'; ${query}; ROLLBACK;`);if(!(await gate.authorize(networkRequest("postgres","query",args))))throw new FabricError("POLICY_DENIED","PostgreSQL inspection was not approved");return inspectionResult("postgres","query",await command(args,root,30000,undefined,config.shell.maxOutputChars));},
  async redis(input:{command:string;args?:string[];host?:string;port?:number;database?:number}){if(typeof input?.command!=="string")throw new FabricError("POLICY_DENIED","Redis command must be a string");if(input.args!==undefined&&!Array.isArray(input.args))throw new FabricError("POLICY_DENIED","Redis arguments must be an array");const operation=input.command.toUpperCase();const allowed=new Set(["PING","INFO","DBSIZE","TYPE","EXISTS","TTL","PTTL","GET","MGET","STRLEN","HGET","HGETALL","HKEYS","HLEN","LRANGE","LLEN","SMEMBERS","SCARD","ZRANGE","ZCARD","ZSCORE","SCAN","SSCAN","HSCAN","ZSCAN","MEMORY"]);if(!allowed.has(operation))throw new FabricError("POLICY_DENIED",`Redis command is not read-only allowlisted: ${operation}`);const values=input.args??[];if(values.length>20||values.some(value=>typeof value!=="string"||value.length>1024))throw new FabricError("POLICY_DENIED","Redis inspection arguments exceed bounds");if(operation==="MEMORY"&&values[0]?.toUpperCase()!=="USAGE")throw new FabricError("POLICY_DENIED","Only Redis MEMORY USAGE is allowed");const args=["redis-cli","--raw"];const host=safeToken(input.host,"Redis host");if(host)args.push("-h",host);if(input.port!==undefined){if(!Number.isInteger(input.port)||input.port<1||input.port>65535)throw new FabricError("POLICY_DENIED","Invalid Redis port");args.push("-p",String(input.port));}if(input.database!==undefined){if(!Number.isInteger(input.database)||input.database<0||input.database>255)throw new FabricError("POLICY_DENIED","Invalid Redis database");args.push("-n",String(input.database));}args.push(operation,...values);if(!(await gate.authorize(networkRequest("redis",operation,args))))throw new FabricError("POLICY_DENIED","Redis inspection was not approved");return inspectionResult("redis",operation,await command(args,root,30000,undefined,config.shell.maxOutputChars));},
  async sqlite(input:{path:string;query:string}){const database=await safePath(root,input.path);const query=readQuery(input.query,"sqlite");const args=["sqlite3","-readonly","-safe","-batch","-noheader",database,query];return inspectionResult("sqlite","query",await command(args,root,30000,undefined,config.shell.maxOutputChars));},
  async kubernetes(input:{operation:string;resource?:string;name?:string;namespace?:string;context?:string;container?:string;tail?:number}){const operation=input.operation;const allowed=new Set(["get","describe","logs","explain","api-resources","api-versions"]);if(!allowed.has(operation))throw new FabricError("POLICY_DENIED",`Kubernetes operation is not read-only allowlisted: ${operation}`);const resource=safeToken(input.resource,"Kubernetes resource",/^[A-Za-z0-9._\/-]+$/);if(resource&&/(^|\/)(secrets?|tokenreviews?|subjectaccessreviews?)(\.|\/|$)/i.test(resource))throw new FabricError("POLICY_DENIED","Sensitive Kubernetes resources are denied");const args=["kubectl"];const context=safeToken(input.context,"Kubernetes context");const namespace=safeToken(input.namespace,"Kubernetes namespace");if(context)args.push("--context",context);if(namespace)args.push("--namespace",namespace);args.push(operation);if(["get","describe","explain"].includes(operation)){if(!resource)throw new FabricError("POLICY_DENIED",`${operation} requires a resource`);args.push(resource);const name=safeToken(input.name,"Kubernetes name");if(name)args.push(name);if(operation==="get")args.push("-o","yaml");}else if(operation==="logs"){const name=safeToken(input.name,"pod name");if(!name)throw new FabricError("POLICY_DENIED","logs requires a pod name");args.push(name,"--tail",String(Math.min(Math.max(input.tail??200,1),1000)));const container=safeToken(input.container,"container");if(container)args.push("--container",container);}if(!(await gate.authorize(networkRequest("kubernetes",operation,args))))throw new FabricError("POLICY_DENIED","Kubernetes inspection was not approved");return inspectionResult("kubernetes",operation,await command(args,root,30000,undefined,config.shell.maxOutputChars));},
  async terraform(input:{operation:string;cwd?:string;path?:string}){const operation=input.operation;const directory=await safePath(root,input.cwd??".");const args=["terraform","-chdir="+directory];if(operation==="validate")args.push("validate","-json");else if(operation==="show"){args.push("show","-json");if(input.path)args.push(await safePath(root,input.path));}else if(operation==="state-list")args.push("state","list");else if(operation==="providers-schema")args.push("providers","schema","-json");else throw new FabricError("POLICY_DENIED",`Terraform operation is not read-only allowlisted: ${operation}`);return inspectionResult("terraform",operation,await command(args,root,30000,undefined,config.shell.maxOutputChars));}
 }; const shell={async run(input:{command:string;timeoutMs?:number;maxOutputChars?:number;cwd?:string}){if(!config.shell.enabled)throw new FabricError("POLICY_DENIED","Shell is disabled by project policy");if(typeof input?.command!=="string"||input.command.length===0)throw new FabricError("POLICY_DENIED","Shell command must be a non-empty string");const requestedCwd=await safePath(root,input.cwd??".");const canonicalCwd=await realpath(requestedCwd);const cwdInfo=await lstat(canonicalCwd);if(!cwdInfo.isDirectory())throw new FabricError("POLICY_DENIED","Shell cwd must be a directory");const cwd=canonicalCwd;const request=shellRequest(input.command,cwd);if(!(await gate.authorize(request)))throw new FabricError("POLICY_DENIED",request.category==="destructive"?"Destructive commands are denied by policy":"Shell command was not approved");const max=Math.min(input.maxOutputChars??config.shell.maxOutputChars,config.shell.maxOutputChars);const r=await command([process.env.SHELL??"/bin/sh","-c",input.command],cwd,Math.min(input.timeoutMs??config.shell.timeoutMs,config.shell.timeoutMs),{PATH:process.env.PATH,HOME:process.env.HOME,NO_COLOR:"1"},max);return{command:input.command,exitCode:r.code,stdout:r.stdout,stderr:r.stderr,truncated:r.stdoutTruncated||r.stderrTruncated,timedOut:r.timedOut};}};
 async function aiRun<T=unknown>(input:any,signal?:AbortSignal):Promise<AiResult<T>>{
  const redactor=new RequestRedactor(),role=input.role??"worker",context=redactor.redact(typeof input.context==="string"?input.context:JSON.stringify(input.context??null)),instruction=redactor.redact(String(input.instruction)),schema=input.outputSchema?redactor.value(input.outputSchema as Record<string,unknown>):undefined;
  const contextCap=Math.min(input.maxInputChars??config.budgets.maxContextCharsPerCall,config.budgets.maxContextCharsPerCall);
  if(context.length>contextCap)throw new FabricError("BUDGET_EXCEEDED",`AI context character budget exceeded (${context.length} > ${contextCap})`);
  const schemaText=JSON.stringify(schema??{}),inputChars=instruction.length+context.length+schemaText.length;
  const normalized:NormalizedAiRequest={instruction,context,role,maxOutputChars:Math.min(input.maxOutputChars??(role==="verifier"?config.budgets.maxOutputCharsVerifier:config.budgets.maxOutputCharsPerWorker),role==="verifier"?config.budgets.maxOutputCharsVerifier:config.budgets.maxOutputCharsPerWorker),timeoutMs:Math.min(input.timeoutMs??config.budgets.aiCallTimeoutMs,config.budgets.aiCallTimeoutMs),...(input.model?{model:input.model}:{}),...(schema?{schema}:{})};
  budgets.reserve(role,inputChars);let raw:Awaited<ReturnType<AiRunner["run"]>>|undefined;
  try{raw=await runner.run(normalized,signal);const safeStdout=redactor.redact(raw.stdout);budgets.output(safeStdout.length);const value=redactor.value(parseFramed(safeStdout,normalized.schema,normalized.maxOutputChars) as T);return{value,role,...(raw.model?{model:raw.model}:{}),...(raw.requestedModel?{requestedModel:raw.requestedModel}:{}),...(raw.resolvedModel?{resolvedModel:raw.resolvedModel}:{}),resolutionSource:raw.resolutionSource??"unknown",inputChars,outputChars:safeStdout.length,repaired:false};}
  catch(e){
   if(!(e instanceof FabricError)||e.code!=="INVALID_AI_OUTPUT"||input.retryInvalidJson===false||config.budgets.maxRetriesPerCall<1)throw e;
   const bad=redactor.redact(raw?.stdout?.slice(-normalized.maxOutputChars)??"(unparseable output)"),details=redactor.redact(JSON.stringify(e.details??[{message:e.message}]));
   const repairInstruction=`${loadPrompt("repair-json").trimEnd()}\n\nINVALID:\n${bad}\nSCHEMA_ERRORS:\n${details}\nSCHEMA:\n${schemaText}`;
   const repair={...normalized,instruction:repairInstruction,context:"",repair:true},repairChars=repairInstruction.length+schemaText.length;
   budgets.reserve(role,repairChars,true);const fixed=await runner.run(repair,signal),safeFixed=redactor.redact(fixed.stdout);budgets.output(safeFixed.length);const value=redactor.value(parseFramed(safeFixed,normalized.schema,normalized.maxOutputChars) as T);
   return{value,role,...(fixed.model?{model:fixed.model}:{}),...(fixed.requestedModel?{requestedModel:fixed.requestedModel}:{}),...(fixed.resolvedModel?{resolvedModel:fixed.resolvedModel}:{}),resolutionSource:fixed.resolutionSource??"unknown",inputChars:inputChars+repairChars,outputChars:(raw?.stdout.length??0)+safeFixed.length,repaired:true};
  }
 }
 async function parallel(input:any):Promise<AiResult[]>{const tasks=input.tasks as any[],concurrency=Math.min(input.concurrency??config.budgets.maxConcurrency,config.budgets.maxConcurrency);if(concurrency<1)throw new FabricError("BUDGET_EXCEEDED","Concurrency must be at least one");const results=new Array(tasks.length),controller=new AbortController();let next=0,failed:unknown;async function worker(){while(true){if(failed&&input.failFast)return;const i=next++;if(i>=tasks.length)return;try{results[i]=await aiRun(tasks[i],controller.signal);}catch(e){if(input.failFast){if(failed===undefined){failed=e;controller.abort();}return;}results[i]={value:undefined,role:tasks[i].role??"worker",resolutionSource:"unknown",inputChars:0,outputChars:0,repaired:false,error:{code:e instanceof FabricError?e.code:"RUNTIME_FAILED",message:new RequestRedactor().redact(e instanceof Error?e.message:String(e))}};}}}await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},worker));if(failed)throw failed;return results;}
 const ai={run:aiRun,parallel,async map(input:any){const items=input.items.slice(0,input.maxItems??input.items.length);return parallel({tasks:items.map(input.createTask),concurrency:input.concurrency});}};
 return {fabric:{fs:fsApi,git,inspect,shell,ai,util:{chunk<T>(items:T[],size:number){if(!Number.isInteger(size)||size<1)throw new Error("chunk size must be positive");return Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));},unique<T>(items:T[]){return[...new Set(items)];},sortBy<T>(items:T[],selector:(x:T)=>string|number){return[...items].sort((a,b)=>{const x=selector(a),y=selector(b);return x<y?-1:x>y?1:0;});},truncate(text:string,max:number){return text.length<=max?text:text.slice(0,Math.max(0,max-1))+"…";},compactJson(value:unknown,max:number){const s=JSON.stringify(value);return s.length<=max?s:s.slice(0,Math.max(0,max-1))+"…";}}},metrics:budgets.metrics};
}