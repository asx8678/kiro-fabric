import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {parseConfig} from '../scripts/steering-benchmark/plan.mjs';
import {attemptBudget} from '../scripts/steering-benchmark/runner.mjs';
import {solvedTrial} from '../scripts/steering-benchmark/selftest.mjs';
import {validate} from '../scripts/steering-benchmark/oracles.mjs';
import {KiroPowerApprover,kiroElicitationFailureReason} from '../src/kiro/power/approver.js';
describe('readiness remediation',()=>{
  it('rejects explicitly unknown budget values but preserves omitted defaults and zero',()=>{
    const base={cli:process.execPath,python:process.execPath,arms:{},runtimePaths:[process.execPath],cliConfigPaths:[process.execPath]};
    expect(parseConfig(base,process.cwd()).priorCredits).toBe(0);
    expect(parseConfig({...base,priorCredits:0},process.cwd()).priorCredits).toBe(0);
    for(const key of ['priorCredits','plannedCredits','creditCeiling','reserveCredits','singleRunCreditLimit']) expect(()=>parseConfig({...base,[key]:null},process.cwd())).toThrow('numeric bounds');
  });
  it('keeps missing usage unknown, including the eighth attempt',()=>{
    const rows=Array.from({length:7},()=>({credits:0.1 as number|null}));rows.push({credits:null});
    expect(attemptBudget(rows,102)).toMatchObject({spent:null,projected:null});
    expect(attemptBudget(rows,102).knownSpentLowerBound).toBeCloseTo(0.7);
    expect(attemptBudget(Array.from({length:8},()=>({credits:0})),102)).toEqual({spent:0,projected:0,knownSpentLowerBound:0});
  });
  it('classifies only the specific missing handler without leaking secrets',async()=>{
    const exact=new Error('secret token: No handler registered for method: _kiro/mcp/elicitation');
    expect(kiroElicitationFailureReason(exact)).toBe('missing_handler');
    expect(kiroElicitationFailureReason(new Error('secret token transport failed'))).toBe('request_failed');
    expect(kiroElicitationFailureReason(new Error('No handler registered for method: other'))).toBe('request_failed');
    const bridge=new KiroPowerApprover({supported:()=>true,request:async()=>{throw exact;}});
    expect(await bridge.approveOnceResult({risk:'write',provider:'local',action:'edit',summary:'fixture'})).toEqual({approved:false,reason:'missing_handler'});
  });
  it.each(['decline','cancel','accept'] as const)('does not authorize %s without explicit true',async action=>{
    const bridge=new KiroPowerApprover({supported:()=>true,request:async()=>({action})});
    expect((await bridge.approveOnceResult({risk:'write',provider:'local',action:'edit',summary:'fixture'})).approved).toBe(false);
  });
  it('rejects missing, malformed, reversed and stale TinyShop audit independently of repair correctness',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'tinyshop-audit-'));
    try{
      const trial=await solvedTrial(root,'bug-money',process.execPath);
      expect((await validate(trial)).ok).toBe(true);
      const file=path.join(trial.workspace,'execution-audit.jsonl');
      const original=fs.readFileSync(file,'utf8');const rows=original.trimEnd().split('\n');
      const stale=JSON.parse(rows[1]!);stale.pre={};
      for(const text of ['', 'not-json\n', rows.reverse().join('\n')+'\n', original.split('\n')[0]+'\n'+JSON.stringify(stale)+'\n']){
        fs.writeFileSync(file,text);
        const result=await validate(trial);
        expect(result.probe).toMatchObject({ok:true});
        expect(result.failures.some(f=>f.check==='execution-audit')).toBe(true);
        expect(fs.readFileSync(file,'utf8')).toBe(text); // Controller probes cannot supply agent records.
      }
    }finally{removeFixtureSync(root,{recursive:true,force:true});}
  });
});
