import { generateKeyPairSync, sign } from 'node:crypto';
import { canonical, compatibilityFor, sha256 } from '../scripts/bundle-contract.mjs';
import { releaseSigningBytes, verifyReleaseForTest } from '../scripts/release-trust.mjs';
export function signedRelease(archiveBytes=Buffer.from('archive'),overrides:Record<string,unknown>={}){
 const metadata={schema:1,product:'kiro-fabric',version:'1.0.0',sourceCommit:'a'.repeat(40),target:'linux-x64',compatibility:compatibilityFor('linux-x64'),archive:{url:'https://github.com/asx8678/kiro-fabric/releases/download/v1.0.0/kiro-fabric-1.0.0-linux-x64.tar.gz',size:archiveBytes.length,sha256:sha256(archiveBytes)},bundleDigest:'b'.repeat(64),sbom:{size:1,sha256:sha256('sbom')},...overrides};
 const keys=generateKeyPairSync('ed25519');const publicKey=keys.publicKey.export({type:'spki',format:'pem'});
 const metadataBytes=Buffer.from(canonical(metadata)+'\n'),signatureBytes=Buffer.from(sign(null,releaseSigningBytes(metadata),keys.privateKey).toString('base64')+'\n');
 return {metadata,archiveBytes,metadataBytes,signatureBytes,verify:(m:Buffer,s:Buffer,expected:Record<string,unknown>={})=>verifyReleaseForTest(m,s,publicKey,expected)};
}
