import { test, expect } from 'vitest';
import http from 'node:http';
import { once } from 'node:events';
import { discoverRelease, discoverReleaseForTest, downloadHttpsForTest, RELEASE_API, ReleaseDownloadError } from '../scripts/release-download.mjs';
import { signedRelease } from './release-fixture.js';

async function transport(handler:http.RequestListener,run:(request:typeof http.request)=>Promise<void>){
 const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as import('node:net').AddressInfo;
 // Only fixture request adapter rewrites transport to loopback. Production URL
 // validation still sees the original HTTPS URL on every redirect.
 const request=((url:URL,options:http.RequestOptions,callback:(r:http.IncomingMessage)=>void)=>http.request({host:'127.0.0.1',port:address.port,path:url.pathname,...options},callback)) as typeof http.request;
 try{await run(request);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
test('public discovery is blocked before network or option processing',async()=>{
 await expect(discoverRelease({target:'linux-x64'})).rejects.toMatchObject({code:'trust-root blocked'});
 await expect(discoverRelease({target:'unsupported',version:'bad'})).rejects.toMatchObject({code:'trust-root blocked'});
});
test('HTTPS bounded capture follows exactly four approved redirects',async()=>{
 await transport((req,res)=>{const n=Number(req.url!.slice(1));if(n<4){res.writeHead(302,{Location:'https://release-assets.githubusercontent.com/'+(n+1)});res.end();}else res.end('abc');},async request=>{
  expect((await downloadHttpsForTest('https://github.com/0',{maxBytes:3,expectedSize:3},request)).toString()).toBe('abc');
 });
});
test.each([403,429,404,500])('status %i has an explicit failure',async status=>{
 await transport((_req,res)=>{res.writeHead(status);res.end();},async request=>{
  await expect(downloadHttpsForTest('https://github.com/a',{maxBytes:3},request)).rejects.toMatchObject({code:status===404?'no-release':status===500?'offline':'rate-limited'});
 });
});
test('rejects unknown host, downgrade, port, credentials, redirect loops and host escape',async()=>{
 let called=false;const request=(()=>{called=true;throw Error('must not call');}) as typeof http.request;
 for(const url of ['http://github.com/a','https://evil.test/a','https://github.com:444/a','https://u@github.com/a'])await expect(downloadHttpsForTest(url,{maxBytes:3},request)).rejects.toThrow(/unapproved/);
 expect(called).toBe(false);
 for(const location of ['https://github.com/a','https://evil.test/a','http://github.com/a'])await transport((_req,res)=>{res.writeHead(302,{Location:location});res.end();},async r=>{
  await expect(downloadHttpsForTest('https://github.com/a',{maxBytes:3},r)).rejects.toMatchObject({code:'invalid-release'});
 });
});
test('rejects oversized declared/chunked bytes, truncation, encoding and deadlines',async()=>{
 const handlers:http.RequestListener[]=[
  (_req,res)=>{res.writeHead(200,{'Content-Length':'5'});res.end('12345');},
  (_req,res)=>{res.write('123');res.end('4');},
  (_req,res)=>{res.writeHead(200,{'Content-Length':'3'});res.flushHeaders();res.write('1');setImmediate(()=>res.destroy());},
  (_req,res)=>{res.writeHead(200,{'Content-Encoding':'gzip'});res.end('abc');},
 ];
 for(const handler of handlers)await transport(handler,async r=>{await expect(downloadHttpsForTest('https://github.com/a',{maxBytes:3},r)).rejects.toBeInstanceOf(ReleaseDownloadError);});
 await transport(()=>{},async r=>{await expect(downloadHttpsForTest('https://github.com/a',{maxBytes:3,connectionTimeoutMs:20,overallTimeoutMs:40},r)).rejects.toMatchObject({code:'offline'});});
 await transport((_req,res)=>{res.write('a');},async r=>{await expect(downloadHttpsForTest('https://github.com/a',{maxBytes:3,connectionTimeoutMs:100,overallTimeoutMs:30},r)).rejects.toThrow(/overall timeout/);});
});
function discoveryFixture(){
 const f=signedRelease();const url=f.metadata.archive.url;
 const release={tag_name:'v1.0.0',draft:false,prerelease:false,assets:['','.release.json','.release.sig'].map(s=>({name:url.split('/').at(-1)+s,browser_download_url:url+s}))};
 const calls:string[]=[];
 const responses=new Map([[RELEASE_API+'/latest',Buffer.from(JSON.stringify(release))],[RELEASE_API+'/tags/v1.0.0',Buffer.from(JSON.stringify(release))],[url,f.archiveBytes],[url+'.release.json',f.metadataBytes],[url+'.release.sig',f.signatureBytes]]);
 const download=async (u:string)=>{calls.push(u);const b=responses.get(u);if(!b)throw new ReleaseDownloadError('offline');return b;};
 return {...f,release,responses,calls,download};
}
test('discovery authenticates stable official hints then returns the verified capture',async()=>{
 const f=discoveryFixture();const result=await discoverReleaseForTest({target:'linux-x64'},{download:f.download,verify:f.verify});
 expect(result.metadata).toEqual(f.metadata);expect(result.archiveBytes).toEqual(f.archiveBytes);expect(f.calls.at(-1)).toBe(f.metadata.archive.url);
 expect((await discoverReleaseForTest({target:'linux-x64',version:'1.0.0'},{download:f.download,verify:f.verify})).metadata.version).toBe('1.0.0');
});
test('signature failure never fetches archive, tampered capture fails, no source fallback',async()=>{
 const f=discoveryFixture();f.responses.set(f.metadata.archive.url+'.release.sig',Buffer.alloc(89));
 await expect(discoverReleaseForTest({target:'linux-x64'},{download:f.download,verify:f.verify})).rejects.toThrow();expect(f.calls).not.toContain(f.metadata.archive.url);
 const g=discoveryFixture();g.responses.set(g.metadata.archive.url,Buffer.from('tamper!'));
 await expect(discoverReleaseForTest({target:'linux-x64'},{download:g.download,verify:g.verify})).rejects.toThrow(/digest/);
});
test.each(['draft','prerelease','missing','wrong-location','unstable','duplicate'])('untrusted API %s fails closed',async kind=>{
 const f=discoveryFixture();if(kind==='draft')f.release.draft=true;if(kind==='prerelease')f.release.prerelease=true;if(kind==='missing')f.release.assets.pop();if(kind==='duplicate')f.release.assets.push(f.release.assets[0]!);if(kind==='wrong-location')f.release.assets[0]!.browser_download_url='https://evil.test/a';if(kind==='unstable')f.release.tag_name='v1.0.0-rc.1';
 f.responses.set(RELEASE_API+'/latest',Buffer.from(JSON.stringify(f.release)));
 await expect(discoverReleaseForTest({target:'linux-x64'},{download:f.download,verify:f.verify})).rejects.toMatchObject({code:'no-release'});expect(f.calls).not.toContain(f.metadata.archive.url);
});
