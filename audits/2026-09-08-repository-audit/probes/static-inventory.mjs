import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=process.cwd();
if(!root.startsWith('/tmp/kiro-fabric-audit-'))throw Error('Disposable checkout required');
const require=createRequire(path.join(root,'package.json'));
const ts=require('typescript');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
const files=walk('src').filter(f=>/\.(ts|mjs)$/.test(f));
const edges=[],external=new Map(),env=new Map();
for(const file of files){
 const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 function visit(n){
  let spec,typeOnly=false,kind;
  if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier)){
   spec=n.moduleSpecifier.text;typeOnly=!!(n.isTypeOnly||n.importClause?.isTypeOnly);kind='static';
  }else if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments.length===1&&ts.isStringLiteral(n.arguments[0])){spec=n.arguments[0].text;kind='dynamic-literal';}
  if(spec){
   const line=ast.getLineAndCharacterOfPosition(n.getStart()).line+1;
   if(spec.startsWith('.')){
    const target=path.normalize(path.join(path.dirname(file),spec));
    const match=[target,target.replace(/\.js$/,'.ts'),path.join(target,'index.ts')].find(p=>files.includes(p));
    if(match)edges.push({from:file,to:match,typeOnly,kind,line});
   }else{const pkg=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.startsWith('node:')?spec:spec.split('/')[0];const uses=external.get(pkg)||[];uses.push({file,line,typeOnly,kind});external.set(pkg,uses);}
  }
  ts.forEachChild(n,visit);
 }
 visit(ast);
 for(const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)){const locations=env.get(m[1])||[];locations.push({file,line:text.slice(0,m.index).split('\n').length});env.set(m[1],locations);}
}
const runtimeEdges=edges.filter(e=>!e.typeOnly);
// Tarjan SCC over relative runtime-capable imports; type-only edges reported separately.
const index=new Map(),low=new Map(),stack=[],active=new Set(),scc=[];let ordinal=0;
function strong(v){index.set(v,ordinal);low.set(v,ordinal++);stack.push(v);active.add(v);for(const e of runtimeEdges.filter(e=>e.from===v)){const w=e.to;if(!index.has(w)){strong(w);low.set(v,Math.min(low.get(v),low.get(w)));}else if(active.has(w))low.set(v,Math.min(low.get(v),index.get(w)));}if(low.get(v)===index.get(v)){const group=[];let w;do{w=stack.pop();active.delete(w);group.push(w);}while(w!==v);if(group.length>1)scc.push(group);}}
files.forEach(f=>{if(!index.has(f))strong(f);});
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const dependencies=Object.entries({...pkg.dependencies,...pkg.devDependencies}).map(([name,declared])=>{
 const local=JSON.parse(fs.readFileSync(path.join('node_modules',name,'package.json'),'utf8'));
 return {name,declared,resolved:local.version,developmentOnly:!Object.hasOwn(pkg.dependencies,name),localLicense:local.license??null,uses:external.get(name)||[]};
});
const tests=walk('tests').filter(f=>f.endsWith('.test.ts'));const markers=[];
for(const file of tests){const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(/\b(?:it|test|describe)\.(skip|todo|only|skipIf|runIf)\b/g))markers.push({file,line:text.slice(0,m.index).split('\n').length,kind:m[1]});}
console.log(JSON.stringify({method:'TypeScript AST literal imports/exports/dynamic imports in all src .ts/.mjs files. Type-only clauses excluded from runtime graph; conditional runtime imports remain edges. External dependency usage and environment names are static inventory, not reachability proof. Test markers are regex leads, not skipped-test counts.',sourceFiles:files.length,relativeEdges:edges.length,runtimeEdges:runtimeEdges.length,runtimeCycles:scc,edges,dependencies,externalModuleNames:[...external.keys()].sort(),environmentNames:[...env.entries()].map(([name,locations])=>({name,locations})),testFiles:tests.length,testMarkers:markers,coverageProviderInstalled:fs.existsSync('node_modules/@vitest/coverage-v8')},null,2));
