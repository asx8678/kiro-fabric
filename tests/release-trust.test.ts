import { test, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonical, sha256, compatibilityFor } from '../scripts/bundle-contract.mjs';
import { verifyRelease, verifyReleaseForTest, releaseSigningBytes, checkReleaseAdmission, verifyReleaseSidecars, verifyReleaseSidecarsCaptured, validateReleaseMetadata } from '../scripts/release-trust.mjs';
const m={schema:1,product:'kiro-fabric',version:'1.0.0',sourceCommit:'a'.repeat(40),target:'linux-x64',compatibility:compatibilityFor('linux-x64'),archive:{url:'https://github.com/asx8678/kiro-fabric/releases/download/v1.0.0/kiro-fabric-1.0.0-linux-x64.tar.gz',size:1,sha256:sha256('a')},bundleDigest:'b'.repeat(64),sbom:{size:1,sha256:'c'.repeat(64)}};
test('canonical Ed25519 fixture and production block',()=>{const key=generateKeyPairSync('ed25519');const publicKey=key.publicKey.export({type:'spki',format:'pem'});const bytes=Buffer.from(canonical(m)+'\n'),signature=Buffer.from(sign(null,releaseSigningBytes(m),key.privateKey).toString('base64')+'\n');expect(verifyReleaseForTest(bytes,signature,publicKey,{archiveBytes:Buffer.from('a')})).toEqual(m);expect(()=>verifyRelease(bytes,signature)).toThrow(/blocked/);const high=Buffer.from(signature);high[0]=high[0]!|128;expect(()=>verifyReleaseForTest(bytes,high,publicKey)).toThrow(/encoding/);expect(()=>verifyReleaseForTest(bytes,signature,publicKey,{target:'darwin-x64'})).toThrow();expect(()=>verifyReleaseForTest(Buffer.from(JSON.stringify(m)),signature,publicKey)).toThrow();const wrong=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});expect(()=>verifyReleaseForTest(bytes,signature,wrong)).toThrow();});
test('same-version conflicts and downgrade',()=>{const state={schema:1,product:'kiro-fabric',highestVersion:'1.0.0',highestDigest:m.bundleDigest,accepted:[{version:'1.0.0',digest:m.bundleDigest}]};expect(checkReleaseAdmission(m,state).outcome).toBe('noop');expect(()=>checkReleaseAdmission({...m,bundleDigest:'d'.repeat(64)},state)).toThrow();expect(()=>checkReleaseAdmission({...m,version:'0.9.0'},state)).toThrow();});

test('offline public APIs fail before touching an unavailable archive when root is absent',async()=>{
 await expect(verifyReleaseSidecars('/not-read')).rejects.toThrow(/trust root.*blocked/);
 await expect(verifyReleaseSidecarsCaptured('/not-read')).rejects.toThrow(/trust root.*blocked/);
});
test('release identity requires exact stable compatibility, source commit and official target location',()=>{
 for(const bad of [
  {...m,sourceCommit:'a'.repeat(64)}, {...m,compatibility:{node:24}}, {...m,compatibility:{...m.compatibility,minNode:'25.0.0'}},
  {...m,compatibility:{...m.compatibility,extra:true}}, {...m,extra:true},
  ...['https://evil.test/a','http://github.com/a',m.archive.url.replace('linux-x64','darwin-x64'),m.archive.url+'?download=1',m.archive.url.replace('asx8678','other')].map(url=>({...m,archive:{...m.archive,url}})),
 ])expect(()=>validateReleaseMetadata(bad)).toThrow();
});
