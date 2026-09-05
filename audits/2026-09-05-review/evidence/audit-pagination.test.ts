import {it,expect} from 'vitest';
import type {Runtime,ServerDefinition} from 'mcporter';
import {ActionRegistry} from '../src/core/action-registry.js';
import {KiroMcpProvider} from '../src/kiro/mcp-provider.js';
it('audit: a configured paginated server exposes and invokes a second-page tool',async()=>{
 const server:ServerDefinition={name:'synthetic',command:{kind:'http',url:new URL('https://example.test/mcp')}};
 const tool=(name:string)=>({name,inputSchema:{type:'object',properties:{}}});
 const cursors:Array<string|null>=[]; let calls=0;
 const runtime={listServers:()=>['synthetic'],getDefinition:()=>server,async close(){},async connect(){return {client:{async listTools(params?:{cursor?:string}){cursors.push(params?.cursor??null);return params?.cursor==='page2'?{tools:[tool('second')]}:{tools:[tool('first')],nextCursor:'page2'};}}};},async callTool(){calls++;return {content:[{type:'text',text:'synthetic success'}]};}} as unknown as Runtime;
 const registry=new ActionRegistry(); registry.register(new KiroMcpProvider(process.cwd(),{enabled:true,disableOAuth:true,callTimeoutMs:1000},async()=>runtime));
 const context=()=>({cwd:process.cwd(),audits:[],maxResultChars:100000,async approve(){}});
 try{
  const discovered=await registry.invoke('mcp.$tools',{server:'synthetic'},context()) as Array<{name:string}>;
  let failure:string|undefined;
  try{await registry.invoke('mcp.$call',{server:'synthetic',tool:'second',args:{}},context());}catch(e){failure=(e as Error).message;}
  console.log(JSON.stringify({mockOnly:true,networkRequests:0,discovered:discovered.map(t=>t.name),cursors,downstreamCalls:calls,callFailure:failure}));
  expect(discovered.map(t=>t.name)).toEqual(['first','second']);
  expect(failure).toBeUndefined(); expect(calls).toBe(1);
 }finally{await registry.close();}
});
