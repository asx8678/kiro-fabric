import fs from 'node:fs';
import { opendir } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {{label?:string,platform?:string,uid?:number,allowMacAliases?:boolean}} AncestryOptions */
/** The narrowly scoped administrator-controlled macOS exception, not descendants.
 * @param {string} directory @param {import('node:fs').Stats} stat @param {string} [platform] */
export function trustedMacApplications(directory,stat,platform=process.platform){
 return platform==='darwin'&&directory==='/Applications'&&stat.uid===0&&stat.gid===80&&(stat.mode&0o7777)===0o775;
}
/** @param {string} directory @param {import('node:fs').Stats} stat @param {AncestryOptions} [options] */
export function trustedDirectoryStat(directory,stat,{platform=process.platform,uid=process.getuid?.()}={}){
 const sticky=stat.uid===0&&(stat.mode&0o1000)!==0;
 return stat.isDirectory()&&!stat.isSymbolicLink()&&(uid===undefined||stat.uid===uid||stat.uid===0)&&
  (platform==='win32'||(stat.mode&0o022)===0||sticky||trustedMacApplications(directory,stat,platform));
}
/** Snapshot only directory identities/permissions, not mutable directory timestamps.
 * Call check() immediately before effects and after asynchronous work. This is not
 * openat: writers must ALSO anchor effects to a captured directory descriptor.
 * Resolve once so symlink/.. lexical aliases cannot select a different return root.
 * @param {string} target @param {AncestryOptions} [options] */
export function captureDirectoryAncestry(target,options={}){
 const {label='Unsafe directory ancestry',platform=process.platform,allowMacAliases=false}=options;
 const absolute=path.resolve(target);
 /** @param {string} root @param {boolean} aliases */
 const snapshot=(root,aliases)=>{
  let current=path.parse(root).root;
  const paths=[current];for(const part of root.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);paths.push(current);}
  return paths.map(directory=>{
   let stat=fs.lstatSync(directory);
   if(aliases&&platform==='darwin'&&['/etc','/tmp','/var'].includes(directory)&&stat.isSymbolicLink()&&stat.uid===0&&fs.realpathSync(directory)==='/private'+directory)stat=fs.statSync(directory);
   if(!trustedDirectoryStat(directory,stat,options))throw Error(label+': '+JSON.stringify(directory));
   return {directory,stat};
  });
 };
 snapshot(absolute,allowMacAliases);
 const root=fs.realpathSync(absolute),entries=snapshot(root,false);
 const check=()=>{
  for(const {directory,stat} of entries){
   const now=fs.lstatSync(directory);
   if(!trustedDirectoryStat(directory,now,options)||now.dev!==stat.dev||now.ino!==stat.ino||now.mode!==stat.mode||now.uid!==stat.uid||now.gid!==stat.gid)throw Error(label+' changed: '+JSON.stringify(directory));
  }
  if(fs.realpathSync(root)!==root)throw Error(label+' changed canonical root');
 };
 check();return {root,check};
}
/** Bound allocations before sorting; at most limit+1 entries are observed.
 * @param {string} directory @param {number} limit */
export async function readDirectoryBounded(directory,limit){
 if(!Number.isSafeInteger(limit)||limit<0)throw Error('Directory entry bound');
 const handle=await opendir(directory,{bufferSize:32}),names=[];
 try{for(;;){const entry=await handle.read();if(!entry)break;if(names.length>=limit)throw Error('Directory entry bound');names.push(entry.name);}}finally{await handle.close();}
 return names;
}
/** @param {string} directory @param {number} limit */
export function readDirectoryBoundedSync(directory,limit){
 if(!Number.isSafeInteger(limit)||limit<0)throw Error('Directory entry bound');
 const handle=fs.opendirSync(directory,{bufferSize:32}),names=[];
 try{for(;;){const entry=handle.readSync();if(!entry)break;if(names.length>=limit)throw Error('Directory entry bound');names.push(entry.name);}}finally{handle.closeSync();}
 return names;
}
/** Do not enumerate/allocate an unbounded directory merely to test emptiness.
 * @param {string} directory */
export function directoryIsEmpty(directory){
 const handle=fs.opendirSync(directory,{bufferSize:1});try{return handle.readSync()===null;}finally{handle.closeSync();}
}
