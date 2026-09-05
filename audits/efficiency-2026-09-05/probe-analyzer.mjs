import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const dir='audits/efficiency-2026-09-05';
const source=fs.readFileSync('scripts/analyze-trace.mjs','utf8');
const old='  const selfTimeUs = (span) =>\n    (span.durUs ?? 0) - (childrenOf.get(span.spanId) ?? []).reduce((sum, child) => sum + (child.durUs ?? 0), 0);';
assert(source.includes(old));
const replacement=`  const selfTimeUs = (span) => {
    const start = span.monoUs, end = start + (span.durUs ?? 0);
    const ranges = (childrenOf.get(span.spanId) ?? []).map(child =>
      [Math.max(start, child.monoUs), Math.min(end, child.monoUs + (child.durUs ?? 0))]
    ).filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a,b) => a[0]-b[0]);
    let covered = 0, cursor = start;
    for (const [a,b] of ranges) { covered += Math.max(0, b - Math.max(a,cursor)); cursor = Math.max(cursor,b); }
    return (span.durUs ?? 0) - covered;
  };`;
// Disposable equivalent isolated copy: runtime source never changed.
fs.writeFileSync(`${dir}/analyze-trace-candidate.mjs`,source.replace(old,replacement).replace('args=${row.argsChars}B result=${row.resultChars}B','args=${row.argsChars}chars result=${row.resultChars}chars'));
const results=[];
for(const [name,children,expected] of [['overlap',[[10,80],[20,60]],20],['serial',[[10,20],[40,30]],50],['outside-parent',[[90,30]],90]]){
 const base={v:1,ts:'2026-09-05T00:00:00.000Z',execId:name};
 const events=[{...base,seq:1,monoUs:0,cat:'eval',ev:'execute',spanId:'p',durUs:100},...children.map(([start,dur],i)=>({...base,seq:i+2,monoUs:start,cat:'bridge',ev:'probe',spanId:`c${i}`,parentId:'p',durUs:dur,data:{argsChars:JSON.stringify('😀').length,resultChars:1}})),{...base,seq:children.length+2,monoUs:100,cat:'eval',ev:'exec.end',data:{status:'succeeded',elapsedMs:0.1}}];
 const fixture=`${dir}/trace-${name}.jsonl`;fs.writeFileSync(fixture,events.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const run=(file)=>{const text=execFileSync(process.execPath,[file,fixture,'--json'],{encoding:'utf8'});return JSON.parse(text);};
 const baseline=run('scripts/analyze-trace.mjs'),candidate=run(`${dir}/analyze-trace-candidate.mjs`);
 fs.writeFileSync(`${dir}/analyzer-${name}-baseline.json`,JSON.stringify(baseline,null,2));fs.writeFileSync(`${dir}/analyzer-${name}-candidate.json`,JSON.stringify(candidate,null,2));
 const value=r=>r.executions[0].spans.find(x=>x.ev==='execute').selfUs;
 assert.equal(value(candidate),expected);if(name==='serial')assert.equal(value(baseline),expected);
 results.push({name,expectedSelfUs:expected,baselineSelfUs:value(baseline),candidateSelfUs:value(candidate),sampleCount:1,synthetic:true});
}
const fixture=`${dir}/trace-overlap.jsonl`;
const text=execFileSync(process.execPath,['scripts/analyze-trace.mjs',fixture],{encoding:'utf8'});
const candidateText=execFileSync(process.execPath,[`${dir}/analyze-trace-candidate.mjs`,fixture],{encoding:'utf8'});
assert(text.includes('args=8B'));assert(candidateText.includes('args=8chars'));
const unicode={jsonString:'😀',utf16Chars:JSON.stringify('😀').length,utf8Bytes:Buffer.byteLength(JSON.stringify('😀'))};
fs.writeFileSync(`${dir}/analyzer-probe-results.json`,JSON.stringify({assertionsPassed:true,results,unicode,latencyBenchmark:false,billingEvidence:false},null,2));
console.log(JSON.stringify({results,unicode,assertionsPassed:true}));
