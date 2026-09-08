import https from 'node:https';
import { LIMITS, TARGETS, isStable, sha256 } from './bundle-contract.mjs';
import { PRODUCTION_TRUST_ROOT, verifyRelease } from './release-trust.mjs';

export const RELEASE_API = 'https://api.github.com/repos/asx8678/kiro-fabric/releases';
const HOSTS = new Set(['github.com','api.github.com','release-assets.githubusercontent.com']);
const REDIRECTS = new Set([301,302,303,307,308]);
/** @typedef {{maxBytes:number, expectedSize?:number, connectionTimeoutMs?:number, overallTimeoutMs?:number}} DownloadOptions */
/** @typedef {(url:URL, options:import('node:https').RequestOptions, callback:(response:import('node:http').IncomingMessage)=>void)=>import('node:http').ClientRequest} Request */
/** @typedef {(url:string, options:DownloadOptions)=>Promise<Buffer>} Download */
/** @typedef {{target:string,version?:string}} DiscoveryOptions */
/** Machine-readable failure; transport never silently invokes a source fallback. */
export class ReleaseDownloadError extends Error {
 /** @param {string} code @param {string} [detail] */
 constructor(code,detail){super(detail?code+': '+detail:code);this.name='ReleaseDownloadError';this.code=code;}
}
/** @param {string | URL} value */
function approvedURL(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||!HOSTS.has(url.hostname)||url.username||url.password||url.port||url.hash)throw new ReleaseDownloadError('invalid-release','unapproved HTTPS URL');
 return url;
}
/** One bounded capture, with a deadline spanning all redirects. No proxy/env hooks.
 * Injected request is fixture-only, never exposed by discovery CLI or environment.
 * @param {string} url @param {DownloadOptions} options @param {Request} request
 * @returns {Promise<Buffer>} */
export async function downloadHttpsForTest(url,options,request){
 const {maxBytes,expectedSize,connectionTimeoutMs=10000,overallTimeoutMs=120000}=options;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>LIMITS.archive||expectedSize!==undefined&&(!Number.isSafeInteger(expectedSize)||expectedSize<1||expectedSize>maxBytes)||!Number.isSafeInteger(connectionTimeoutMs)||connectionTimeoutMs<1||!Number.isSafeInteger(overallTimeoutMs)||overallTimeoutMs<1)throw new ReleaseDownloadError('invalid-release','download limits');
 const deadline=Date.now()+overallTimeoutMs;let current=approvedURL(url);
 for(let hop=0;hop<=4;hop++){
  const remaining=deadline-Date.now();if(remaining<=0)throw new ReleaseDownloadError('offline','overall timeout');
  /** @type {{bytes?:Buffer, location?:string}} */
  const result=await new Promise((resolve,reject)=>{
   let done=false;
   /** @type {import('node:http').ClientRequest | undefined} */
   let req;
   /** @type {ReturnType<typeof setTimeout> | undefined} */let connectTimer;
   /** @param {Error} error */
   const fail=error=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(connectTimer);req?.destroy();reject(error);};
   const timer=setTimeout(()=>fail(new ReleaseDownloadError('offline','overall timeout')),remaining);
   try{
    req=request(current,{method:'GET',headers:{'User-Agent':'kiro-fabric-release','Accept':'application/vnd.github+json','Accept-Encoding':'identity'}},res=>{
     clearTimeout(connectTimer);
     const status=res.statusCode||0;
     if(status===403||status===429){fail(new ReleaseDownloadError('rate-limited'));res.destroy();return;}
     if(status===404){fail(new ReleaseDownloadError('no-release'));res.destroy();return;}
     if(REDIRECTS.has(status)){
      if(hop===4||!res.headers.location){fail(new ReleaseDownloadError('invalid-release','redirect limit/location'));res.destroy();return;}
      done=true;clearTimeout(timer);res.destroy();resolve({location:res.headers.location});return;
     }
     if(status!==200){fail(new ReleaseDownloadError('offline','HTTP '+status));res.destroy();return;}
     const length=res.headers['content-length'];
     if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'||length!==undefined&&(!/^(0|[1-9]\d*)$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>maxBytes||expectedSize!==undefined&&Number(length)!==expectedSize)){
      fail(new ReleaseDownloadError('invalid-release','content length/encoding'));res.destroy();return;
     }
     /** @type {Buffer[]} */const chunks=[];let bytes=0;
     res.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>maxBytes||expectedSize!==undefined&&bytes>expectedSize){fail(new ReleaseDownloadError('invalid-release','oversized'));res.destroy();return;}chunks.push(Buffer.from(chunk));});
     res.on('aborted',()=>fail(new ReleaseDownloadError('invalid-release','truncated')));
     res.on('error',()=>fail(new ReleaseDownloadError('offline','response error')));
     res.on('end',()=>{
      if(done)return;
      if(!res.complete||length!==undefined&&bytes!==Number(length)||expectedSize!==undefined&&bytes!==expectedSize){fail(new ReleaseDownloadError('invalid-release','truncated'));return;}
      done=true;clearTimeout(timer);resolve({bytes:Buffer.concat(chunks,bytes)});
     });
    });
    connectTimer=setTimeout(()=>fail(new ReleaseDownloadError('offline','connection timeout')),Math.min(connectionTimeoutMs,remaining));
    req.on('socket',socket=>{if(!socket.connecting)clearTimeout(connectTimer);else socket.once('secureConnect',()=>clearTimeout(connectTimer));});
    req.on('error',()=>fail(new ReleaseDownloadError('offline','connection failed')));
    req.end();
   }catch{fail(new ReleaseDownloadError('offline','request failed'));}
  });
  if(result.bytes)return result.bytes;
  current=approvedURL(new URL(/** @type {string} */(result.location),current));
 }
 throw new ReleaseDownloadError('invalid-release','redirect limit');
}
/** Builtin Node HTTPS only; captures bytes before the caller verifies or extracts.
 * @param {string} url @param {DownloadOptions} options */
export function downloadHttps(url,options){return downloadHttpsForTest(url,options,https.request);}
/** Internal pure fixture seam; production always binds verifyRelease, never a test key.
 * API hints are untrusted until the signature and exact candidate identity agree.
 * @param {DiscoveryOptions} options
 * @param {{download:Download,verify:(metadata:Buffer,signature:Buffer,expected:any)=>any}} dependencies */
export async function discoverReleaseForTest({target,version},{download,verify}){
 if(!TARGETS.includes(target)||version!==undefined&&!isStable(version))throw new ReleaseDownloadError('no-release','unsupported target/version');
 const api=RELEASE_API+(version?'/tags/v'+version:'/latest');
 /** @type {any} */ let release;try{release=JSON.parse((await download(api,{maxBytes:1024*1024})).toString('utf8'));}catch(e){if(e instanceof ReleaseDownloadError)throw e;throw new ReleaseDownloadError('invalid-release','API JSON');}
 if(!release||release.draft!==false||release.prerelease!==false||typeof release.tag_name!=='string'||!release.tag_name.startsWith('v')||!isStable(release.tag_name.slice(1))||!Array.isArray(release.assets)||release.assets.length>128)throw new ReleaseDownloadError('no-release');
 const hint=release.tag_name.slice(1);if(version&&hint!==version)throw new ReleaseDownloadError('no-release','version mismatch');
 const name='kiro-fabric-'+hint+'-'+target+'.tar.gz';
 const archiveURL='https://github.com/asx8678/kiro-fabric/releases/download/v'+hint+'/'+name;
 /** @param {string} suffix */
 function sidecar(suffix){const matches=release.assets.filter((/** @type {any} */ a)=>a&&a.name===name+suffix);if(matches.length!==1||matches[0].browser_download_url!==archiveURL+suffix)throw new ReleaseDownloadError('no-release','missing/ambiguous official asset');return archiveURL+suffix;}
 sidecar('');
 const metadataBytes=await download(sidecar('.release.json'),{maxBytes:65536});
 const signatureBytes=await download(sidecar('.release.sig'),{maxBytes:89,expectedSize:89});
 const metadata=verify(metadataBytes,signatureBytes,{target,version:hint,product:'kiro-fabric'});
 if(metadata.archive.url!==archiveURL)throw new ReleaseDownloadError('invalid-release','signed location mismatch');
 const archiveBytes=await download(metadata.archive.url,{maxBytes:metadata.archive.size,expectedSize:metadata.archive.size});
 if(archiveBytes.length!==metadata.archive.size||sha256(archiveBytes)!==metadata.archive.sha256)throw new ReleaseDownloadError('invalid-release','archive digest/size mismatch');
 // Return precisely the verified capture, not a pathname that may change.
 return {metadata,archiveBytes,metadataBytes,signatureBytes};
}
/** Public stable discovery. Missing production root fails BEFORE any network access.
 * @param {DiscoveryOptions} options */
export async function discoverRelease(options){
 if(!PRODUCTION_TRUST_ROOT)throw new ReleaseDownloadError('trust-root blocked','production release trust root unavailable');
 return discoverReleaseForTest(options,{download:downloadHttps,verify:verifyRelease});
}
