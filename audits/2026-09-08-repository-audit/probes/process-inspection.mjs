import fs from "node:fs";
const base="/tmp/kiro-fabric-audit-a9qfi1km/";
const found=[];
for (const name of fs.readdirSync("/proc")) {
 if(!/^\d+$/.test(name))continue;
 try {const cwd=fs.readlinkSync("/proc/"+name+"/cwd");const argv=fs.readFileSync("/proc/"+name+"/cmdline").toString().split("\0").filter(Boolean);
 if(!cwd.startsWith(base)&&!(argv.includes("C-025")&&argv.some(x=>x.endsWith("audit.py"))))continue;
 found.push({pid:Number(name),cwd,argv:argv.slice(0,7)});
 }catch{}
}
console.log(JSON.stringify(found,null,2));
