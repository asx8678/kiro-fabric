import fs from 'node:fs';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const started=Date.now();const logfile='audits/efficiency-2026-09-05/final-build.log';const fd=fs.openSync(logfile,'w',0o600);const run=spawnSync('pnpm',['run','build'],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
const metricsPath='kiro-fabric-efficiency-metrics.json';const metrics=JSON.parse(fs.readFileSync(metricsPath,'utf8'));metrics.finalBuild={command:'pnpm run build',startedAt:started,finishedAt:Date.now(),exitCode:run.status,passed:run.status===0,log:logfile};fs.writeFileSync(metricsPath,JSON.stringify(metrics,null,2)+'\n');
assert.equal(run.status,0);assert.equal(metrics.auditOverhead.totals.normalizationMismatchCount,0);assert.equal(metrics.auditOverhead.runs.length,7);
for(const name of ['kiro-fabric-efficiency-audit.md',metricsPath,'kiro-fabric-efficiency-plan.md']){assert(fs.statSync(name).size>0);console.log(name+': present');}
console.log(JSON.stringify({buildPassed:metrics.finalBuild.passed,terminalAuditResponses:metrics.auditOverhead.totals.terminalAssistantResponses,accountingAssertionsPassed:true}));
