import path from "node:path";
import { lstat, realpath, readFile, writeFile, stat as fsStat } from "node:fs/promises";
import fg from "fast-glob";
import { spawn } from "node:child_process";
import type { FabricConfig } from "./config.js";
import type { AiRunner, NormalizedAiRequest } from "./runners/types.js";
import { FabricError } from "./errors.js";
import { parseFramed } from "./runners/parser.js";
import { RequestRedactor } from "./redaction.js";
import { loadPrompt } from "./prompts.js";

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
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
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
    child.stdout.on("data", (chunk: Buffer) => add("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => add("stderr", chunk));
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

export function createApi(config: FabricConfig, runner: AiRunner): { fabric: any; metrics: Metrics } {
 const root=path.resolve(config.projectRoot); const budgets=new BudgetState(config);
 const fsApi={
  async read(input:{path:string;maxChars?:number;startLine?:number;endLine?:number}) { const p=await safePath(root,input.path); const raw=textContent(await readFile(p),input.path); const lines=raw.split("\n"), start=Math.max(1,input.startLine??1), end=Math.min(lines.length,input.endLine??lines.length); const selected=lines.slice(start-1,end).join("\n"), t=truncate(selected,Math.min(input.maxChars??config.filesystem.maxCharsPerFile,config.filesystem.maxCharsPerFile)); return {path:path.relative(root,p),content:t.text,chars:t.text.length,truncated:t.truncated,startLine:start,endLine:start+t.text.split("\n").length-1}; },
  async readMany(input:{paths:string[];maxFiles?:number;maxCharsPerFile?:number;maxTotalChars?:number}) { const maxFiles=Math.min(input.maxFiles??config.filesystem.maxFilesPerReadMany,config.filesystem.maxFilesPerReadMany); if(input.paths.length>maxFiles) throw new FabricError("BUDGET_EXCEEDED",`readMany file limit ${maxFiles} exceeded`); const out=[]; let total=0,maxTotal=Math.min(input.maxTotalChars??config.filesystem.maxTotalReadChars,config.filesystem.maxTotalReadChars); for(const p of input.paths){const r=await fsApi.read({path:p,maxChars:input.maxCharsPerFile??config.filesystem.maxCharsPerFile});if(total+r.chars>maxTotal){const left=Math.max(0,maxTotal-total);out.push({...r,content:r.content.slice(0,left),chars:left,truncated:true});break;}out.push(r);total+=r.chars;} return out; },
  async glob(input:{pattern:string;cwd?:string;maxResults?:number;ignore?:string[]}) { const cwd=await safePath(root,input.cwd??"."); const max=Math.min(input.maxResults??1000,5000); const values=await fg(input.pattern,{cwd,onlyFiles:true,dot:false,followSymbolicLinks:false,ignore:[...deniedGlobs,...(input.ignore??[])]}); return values.sort().slice(0,max).map(x=>path.relative(root,path.resolve(cwd,x)).replaceAll(path.sep,"/")); },
  async grep(input:{query:string;paths?:string[];glob?:string;maxMatches?:number;contextLines?:number}) { let regex:RegExp;try{regex=new RegExp(input.query,"i");}catch{throw new FabricError("POLICY_DENIED","Invalid grep regular expression");} const files=input.paths??await fsApi.glob({pattern:input.glob??"**/*",maxResults:2000}),max=input.maxMatches??200,ctx=Math.min(input.contextLines??0,10),matches:any[]=[]; for(const file of files){let r;try{r=await fsApi.read({path:file,maxChars:config.filesystem.maxCharsPerFile});}catch{continue;}const lines=r.content.split("\n");for(let i=0;i<lines.length;i++)if(regex.test(lines[i]!)){matches.push({path:file,line:i+1,text:lines[i],before:lines.slice(Math.max(0,i-ctx),i),after:lines.slice(i+1,i+1+ctx)});if(matches.length>=max)return{matches,files:[...new Set(matches.map(x=>x.path))],truncated:true};}}return{matches,files:[...new Set(matches.map(x=>x.path))],truncated:false}; },
  async stat(input:{path:string}) {const p=await safePath(root,input.path),s=await lstat(p);return{path:path.relative(root,p),type:s.isDirectory()?"directory":"file",size:s.size,modifiedMs:s.mtimeMs};},
  async write(input:{path:string;content:string}) { if(!config.filesystem.allowWrite.some(pattern=>input.path===pattern||(pattern.endsWith("/**")&&input.path.startsWith(pattern.slice(0,-3)+"/")))) throw new FabricError("POLICY_DENIED","Filesystem writes are disabled or path is not allowlisted");const p=await safePath(root,input.path,false);await writeFile(p,input.content,"utf8");return{path:path.relative(root,p),bytesWritten:Buffer.byteLength(input.content)};},
  async patch(input:{path:string;patch:string}) { const read=await fsApi.read({path:input.path,maxChars:config.filesystem.maxCharsPerFile});if(read.truncated)throw new FabricError("BUDGET_EXCEEDED","Refusing to patch a truncated file");const current=read.content; let spec:{old:string;new:string};try{spec=JSON.parse(input.patch) as {old:string;new:string};}catch{throw new FabricError("POLICY_DENIED",'patch must be JSON: {"old":"exact text","new":"replacement"}');}if(typeof spec.old!=="string"||typeof spec.new!=="string"||!current.includes(spec.old))throw new FabricError("POLICY_DENIED","Patch old text not found");await fsApi.write({path:input.path,content:current.replace(spec.old,spec.new)});return{path:input.path,applied:true};}
 };
 const git={ async status(){const r=await command(["git","status","--porcelain=v1","--branch"],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const lines=r.stdout.trimEnd().split("\n"),head=lines.shift()??"";return{branch:head.match(/^## ([^. ]+)/)?.[1]??null,clean:lines.length===0,entries:lines};}, async changedFiles(input:{base?:string;includeUntracked?:boolean}={}){const base=input.base??"HEAD";if(base.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(base))throw new FabricError("POLICY_DENIED","Invalid Git base");const args=["git","diff","--name-only",base,"--"];const r=await command(args,root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const files=r.stdout.trim().split("\n").filter(Boolean);if(input.includeUntracked){const u=await command(["git","ls-files","--others","--exclude-standard"],root);files.push(...u.stdout.trim().split("\n").filter(Boolean));}return[...new Set(files)].filter(x=>!denied.test(x));}, async diff(input:{base?:string;paths?:string[];maxChars?:number}={}){for(const p of input.paths??[])relativeSafe(root,p);const base=input.base??"HEAD";if(base.startsWith("-")||!/^[A-Za-z0-9._\/~^{}-]+$/.test(base))throw new FabricError("POLICY_DENIED","Invalid Git base");const r=await command(["git","diff",base,"--",...(input.paths??[])],root);if(r.code!==0)throw new FabricError("RUNTIME_FAILED",r.stderr.trim());const t=truncate(r.stdout,input.maxChars??30000);return{diff:t.text,truncated:t.truncated};} };
 const shell={async run(input:{command:string;timeoutMs?:number;maxOutputChars?:number;cwd?:string}){if(!config.shell.enabled||!config.shell.allowedCommands.includes(input.command))throw new FabricError("POLICY_DENIED","Shell command is disabled or not allowlisted");const cwd=await safePath(root,input.cwd??".");const max=Math.min(input.maxOutputChars??config.shell.maxOutputChars,config.shell.maxOutputChars);const r=await command([process.env.SHELL??"/bin/sh","-c",input.command],cwd,Math.min(input.timeoutMs??config.shell.timeoutMs,config.shell.timeoutMs),{PATH:process.env.PATH,HOME:process.env.HOME,NO_COLOR:"1"},max);return{command:input.command,exitCode:r.code,stdout:r.stdout,stderr:r.stderr,truncated:r.stdoutTruncated||r.stderrTruncated,timedOut:r.timedOut};}};
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
 return {fabric:{fs:fsApi,git,shell,ai,util:{chunk<T>(items:T[],size:number){if(!Number.isInteger(size)||size<1)throw new Error("chunk size must be positive");return Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));},unique<T>(items:T[]){return[...new Set(items)];},sortBy<T>(items:T[],selector:(x:T)=>string|number){return[...items].sort((a,b)=>{const x=selector(a),y=selector(b);return x<y?-1:x>y?1:0;});},truncate(text:string,max:number){return text.length<=max?text:text.slice(0,Math.max(0,max-1))+"…";},compactJson(value:unknown,max:number){const s=JSON.stringify(value);return s.length<=max?s:s.slice(0,Math.max(0,max-1))+"…";}}},metrics:budgets.metrics};
}