// Same audit-only guard, with public npm registry metadata explicitly allowed.
// This is for the reviewed --offline/--ignore-scripts package fixture, whose
// pnpm policy check still requests public package metadata. Not an OS sandbox.
const net = require('node:net');
const allowed = new Set(['localhost','127.0.0.1','::1','[::1]','registry.npmjs.org']);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const arg=args[0];
  const host=arg && typeof arg==='object'?arg.host:(typeof args[1]==='string'?args[1]:'localhost');
  const socketPath=arg && typeof arg==='object'?arg.path:(typeof arg==='string'&&!/^\d+$/.test(arg)?arg:undefined);
  if(socketPath&&!socketPath.startsWith('/tmp/'))throw Error('AUDIT_NETWORK_GUARD: socket blocked');
  if(!socketPath&&host&&!allowed.has(host))throw Error('AUDIT_NETWORK_GUARD: host blocked');
  return originalConnect.apply(this,args);
};
const originalFetch=globalThis.fetch;
if(originalFetch)globalThis.fetch=(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(!allowed.has(url.hostname))throw Error('AUDIT_NETWORK_GUARD: fetch blocked');
  return originalFetch(input,init);
};
