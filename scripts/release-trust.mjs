import { verify, createPublicKey } from 'node:crypto';
import { canonical, sha256, TARGETS, LIMITS, PRODUCT, readRegular, checkCompatibility, exactFields } from './bundle-contract.mjs';
export const PRODUCTION_TRUST_ROOT = '';
const RELEASE_DOMAIN = 'kiro-fabric.release.v1\0';
// Exact official sidecar name; promotion must publish this beside the archive.
export const RELEASE_SBOM_SUFFIX = '.spdx.json';
/** @param {any} v */
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
/** @param {any} v */
const stable=v=>typeof v==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)&&v.split('.').every(n=>Number.isSafeInteger(Number(n)));
/** @param {any} metadata */
export function releaseSigningBytes(metadata){return Buffer.from(RELEASE_DOMAIN+canonical(metadata));}
/** @param {any} m @returns {any} */
export function validateReleaseMetadata(m){
 if(!m||canonical(Object.keys(m).sort())!==canonical(['archive','bundleDigest','compatibility','product','sbom','schema','sourceCommit','target','version']))throw Error('Release fields');
 if(m.schema!==1||m.product!==PRODUCT||!stable(m.version)||!TARGETS.includes(m.target)||!hash(m.bundleDigest)||typeof m.sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(m.sourceCommit)||!m.compatibility||typeof m.compatibility!=='object')throw Error('Release identity');
 if(!m.archive||canonical(Object.keys(m.archive).sort())!==canonical(['sha256','size','url'])||!hash(m.archive.sha256)||!Number.isSafeInteger(m.archive.size)||m.archive.size<1||m.archive.size>LIMITS.archive)throw Error('Archive identity');
 checkCompatibility(m.compatibility,m.target);
 const u=new URL(m.archive.url);if(typeof m.archive.url!=='string'||u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password||u.hash||u.search||u.href!==m.archive.url||u.pathname!=='/asx8678/kiro-fabric/releases/download/v'+m.version+'/kiro-fabric-'+m.version+'-'+m.target+'.tar.gz')throw Error('Official archive HTTPS required');
 if(!m.sbom||canonical(Object.keys(m.sbom).sort())!==canonical(['sha256','size'])||!hash(m.sbom.sha256)||!Number.isSafeInteger(m.sbom.size)||m.sbom.size<1||m.sbom.size>16*1024*1024)throw Error('SBOM identity');
 canonical(m);return m;
}
/** @param {Buffer} metadataBytes @param {Buffer} signatureBytes @param {string | Buffer} key @param {any} [expected] */
function verifyWithKey(metadataBytes,signatureBytes,key,expected={}){
 if(!key)throw Error('Production release trust root unavailable: distribution blocked');
 if(!Buffer.isBuffer(metadataBytes)||!Buffer.isBuffer(signatureBytes)||metadataBytes.length>65536||signatureBytes.length!==89)throw Error('Release sidecar bound/encoding');
 const m=JSON.parse(metadataBytes.toString('utf8'));validateReleaseMetadata(m);
 if(!metadataBytes.equals(Buffer.from(canonical(m)+'\n')))throw Error('Noncanonical release metadata');
 const s=signatureBytes.toString('ascii');if(!signatureBytes.equals(Buffer.from(s,'ascii'))||!/^[A-Za-z0-9+/]{86}==\n$/.test(s))throw Error('Signature encoding');
 const signature=Buffer.from(s.trim(),'base64');if(signature.length!==64||signature.toString('base64')+'\n'!==s)throw Error('Signature encoding');
 const publicKey=createPublicKey(key);if(publicKey.asymmetricKeyType!=='ed25519'||!verify(null,releaseSigningBytes(m),publicKey,signature))throw Error('Release signature mismatch');
 for(const k of ['product','target','version','bundleDigest'])if(expected[k]!==undefined&&expected[k]!==m[k])throw Error('Release '+k+' mismatch');
 if(expected.archiveBytes!==undefined&&(!Buffer.isBuffer(expected.archiveBytes)||expected.archiveBytes.length!==m.archive.size||sha256(expected.archiveBytes)!==m.archive.sha256))throw Error('Release archive mismatch');
 if(expected.sbomBytes!==undefined)checkReleaseSbom(m,expected.sbomBytes);
 return m;
}
/** @param {Buffer} metadataBytes @param {Buffer} signatureBytes @param {any} [expected] */
export function verifyRelease(metadataBytes,signatureBytes,expected={}){return verifyWithKey(metadataBytes,signatureBytes,PRODUCTION_TRUST_ROOT,expected);}
// Internal fixture API only: never selected through environment, CLI, or metadata.
/** @param {Buffer} metadataBytes @param {Buffer} signatureBytes @param {string | Buffer} publicKey @param {any} [expected] */
export function verifyReleaseForTest(metadataBytes,signatureBytes,publicKey,expected={}){return verifyWithKey(metadataBytes,signatureBytes,publicKey,expected);}/** Byte identity only, not an authentication bypass or native SPDX qualification.
 * The caller must first authenticate metadata using its existing trust policy.
 * @param {any} metadata @param {Buffer} bytes */
export function checkReleaseSbom(metadata,bytes){
 validateReleaseMetadata(metadata);
 if(!Buffer.isBuffer(bytes)||bytes.length!==metadata.sbom.size||sha256(bytes)!==metadata.sbom.sha256)throw Error('Release SBOM digest/size mismatch');
}
/** @internal Capture/verify seam. Production verifyReleaseSidecarsCaptured at :64 binds
 * the production trust root, which is intentionally empty and fails closed, so offline
 * fixture-key sidecar capture cannot run through the public API. The injected verifier is
 * fixture-only and never selected by CLI/environment/metadata. Not a root/package export.
 * @param {string} archive @param {(m:Buffer,s:Buffer,e:any)=>any} verifyMetadata @param {any} expected */
export async function captureSidecars(archive,verifyMetadata,expected){
 // Authenticate before touching either large artifact, then capture exactly the
 // signed lengths. A failure cannot fall through to source installation.
 const [metadataBytes,signatureBytes]=await Promise.all([readRegular(archive+'.release.json',65536),readRegular(archive+'.release.sig',89)]);
 const metadata=verifyMetadata(metadataBytes,signatureBytes,expected);
 const sbomBytes=await readRegular(archive+RELEASE_SBOM_SUFFIX,metadata.sbom.size);checkReleaseSbom(metadata,sbomBytes);
 const archiveBytes=await readRegular(archive,metadata.archive.size);
 verifyMetadata(metadataBytes,signatureBytes,{...expected,archiveBytes,sbomBytes});
 return {metadata,archiveBytes,sbomBytes,metadataBytes,signatureBytes};
}
/** Capture and verify once; extract archiveBytes, not the original path.
 * @param {string} archive @param {any} [expected] */
export async function verifyReleaseSidecarsCaptured(archive,expected={}){
 if(!PRODUCTION_TRUST_ROOT)throw Error('Production release trust root unavailable: distribution blocked');
 return captureSidecars(archive,verifyRelease,expected);
}
/** @param {any} candidate
 * @param {{schema:number,product:string,highestVersion:string,highestDigest:string,accepted:{version:string,digest:string}[]} | null} [state]
 */
export function checkReleaseAdmission(candidate,state=null){
 validateReleaseMetadata(candidate);if(state===null||state===undefined)return {outcome:'admit'};
 exactFields(state,['schema','product','highestVersion','highestDigest','accepted']);
 if(state.schema!==1||state.product!==PRODUCT||!stable(state.highestVersion)||!hash(state.highestDigest)||!Array.isArray(state.accepted)||state.accepted.length>256)throw Error('Invalid release state');
 const seen=new Set();for(const e of state.accepted){exactFields(e,['version','digest']);if(!stable(e.version)||!hash(e.digest)||seen.has(e.version))throw Error('Invalid accepted identity');seen.add(e.version);}
 if(!state.accepted.some(e=>e.version===state.highestVersion&&e.digest===state.highestDigest))throw Error('Release state highest mismatch');
 const known=state.accepted.find(e=>e.version===candidate.version);if(known&&known.digest!==candidate.bundleDigest)throw Error('Same-version digest conflict');
 const a=candidate.version.split('.').map(Number),b=state.highestVersion.split('.').map(Number);let cmp=0;for(let i=0;i<3;i++){if(a[i]!==b[i]){cmp=a[i]>b[i]?1:-1;break;}}
 if(cmp<0)throw Error('Automatic downgrade refused');if(cmp===0){if(candidate.bundleDigest!==state.highestDigest)throw Error('Same-version digest conflict');return {outcome:'noop'};}
 if(state.accepted.length>=256)throw Error('Release history capacity');return {outcome:'admit'};
}
