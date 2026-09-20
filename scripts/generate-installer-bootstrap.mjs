import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, sha256 } from './bundle-contract.mjs';
import { parseBundleArchive } from './bundle-archive.mjs';
import { PRODUCTION_TRUST_ROOT, validateReleaseMetadata, checkReleaseSbom, RELEASE_SBOM_SUFFIX } from './release-trust.mjs';

/** @typedef {{metadata:any,archiveBytes:Buffer,sbomBytes:Buffer}} VerifiedCapture */
/** Quote only validated data, never interpret metadata as shell source. @param {string} value */
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
/** Internal release-pipeline function: callers MUST supply already signature-verified
 * captures. No test-key, environment or end-user trust override is accepted here.
 * Production CLI remains blocked until native exact-artifact qualification exists.
 * @param {VerifiedCapture[]} captures @returns {string} */
export function generateInstallerBootstrap(captures){
 if(!Array.isArray(captures)||captures.length<1||captures.length>4)throw Error('Bootstrap target count');
 const seen=new Set();let version='';const cases=[];
 for(const capture of [...captures].sort((a,b)=>a.metadata.target.localeCompare(b.metadata.target,'en'))){
  const m=validateReleaseMetadata(capture.metadata);
  if(seen.has(m.target)||version&&version!==m.version)throw Error('Bootstrap target/version mismatch');seen.add(m.target);version=m.version;
  if(!Buffer.isBuffer(capture.archiveBytes)||capture.archiveBytes.length!==m.archive.size||sha256(capture.archiveBytes)!==m.archive.sha256)throw Error('Bootstrap archive mismatch');
  checkReleaseSbom(m,capture.sbomBytes);
  const parsed=parseBundleArchive(capture.archiveBytes);
  if(parsed.manifest.digest!==m.bundleDigest||parsed.manifest.version!==m.version||parsed.manifest.target!==m.target||canonical(parsed.manifest.compatibility)!==canonical(m.compatibility)||parsed.manifest.provenance.kind!=='release'||parsed.manifest.provenance.sourceCommit!==m.sourceCommit)throw Error('Bootstrap manifest/release mismatch');
  const node=parsed.manifest.inventory.find((/** @type {any} */ e)=>e.path==='tools/node');const manager=parsed.manifest.inventory.find((/** @type {any} */ e)=>e.path==='manager/install-manager.mjs');
  // Current declared layout has no executable ancillaries; native qualification is pending. Any future ancillary
  // role/layout requires manifest support, fixed pins here, and native evidence.
  cases.push(`  ${m.target}) archive_url=${quote(m.archive.url)}; archive_size=${m.archive.size}; archive_hash=${quote(m.archive.sha256)}; sbom_size=${m.sbom.size}; sbom_hash=${quote(m.sbom.sha256)}; node_size=${node.size}; node_hash=${quote(node.sha256)}; manager_size=${manager.size}; manager_hash=${quote(manager.sha256)}; glibc_min=${quote(m.compatibility.minGlibc ?? '')} ;;`);
 }
 return `#!/bin/bash
# Generated pinned RELEASE bootstrap. Save, inspect, then run; never curl | bash.
# Native/executable closure qualification is a separate release promotion gate.
set -euo pipefail
umask 077
unset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_V8_COVERAGE NODE_COMPILE_CACHE NODE_REPL_HISTORY NODE_EXTRA_CA_CERTS OPENSSL_CONF OPENSSL_MODULES TAR_OPTIONS GZIP BASH_ENV ENV LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_DEBUG LD_DEBUG_OUTPUT LD_PROFILE LD_ORIGIN_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_FALLBACK_FRAMEWORK_PATH DYLD_PRINT_TO_FILE
fail() { printf '%s\\n' "kiro-fabric: $*" >&2; exit 1; }
pinned_version=${quote(version)}
from_archive=''
kiro_home=''
forward=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || fail 'missing --version value'
      [ "$2" = "$pinned_version" ] || fail 'unsupported version: this bootstrap is pinned'
      shift 2 ;;
    --from-archive)
      [ "$#" -ge 2 ] || fail 'missing --from-archive value'
      [ -z "$from_archive" ] || fail 'duplicate --from-archive'
      from_archive=$2
      case "$from_archive" in /*) ;; *) fail '--from-archive requires absolute path' ;; esac
      shift 2 ;;
    --kiro-home)
      [ "$#" -ge 2 ] || fail 'missing --kiro-home value'
      [ -z "$kiro_home" ] || fail 'duplicate --kiro-home'
      kiro_home=$2
      case "$kiro_home" in /|/home|/Users|/tmp|/var|/usr|/etc|/bin|/sbin|/opt|/root|/usr/*|/etc/*|/bin/*|/sbin/*|/root/*|*/|*/../*|*/..|*/./*|*/.|*//*|*$'\\n'*|*$'\\r'*) fail 'unsafe --kiro-home' ;; /*) ;; *) fail '--kiro-home requires absolute path' ;; esac
      forward+=(--kiro-home "$kiro_home")
      shift 2 ;;
    --yes|--non-interactive) forward+=("$1"); shift ;;
    --help) printf '%s\\n' 'Pinned release: --version VERSION --from-archive ABS --kiro-home ABS --yes --non-interactive'; exit 0 ;;
    *) fail "unsupported argument: $1" ;;
  esac
done
[ "$EUID" -ne 0 ] || fail 'do not run as root or with sudo'
for prerequisite in uname tar gzip mktemp wc chmod rm cat; do
  command -v "$prerequisite" >/dev/null 2>&1 || fail "missing prerequisite: $prerequisite"
done
if command -v sha256sum >/dev/null 2>&1; then hash_kind=sha256sum
elif command -v shasum >/dev/null 2>&1; then hash_kind=shasum
else fail 'missing prerequisite: sha256sum or shasum'; fi
if [ -z "$from_archive" ]; then command -v curl >/dev/null 2>&1 || fail 'missing prerequisite: curl'; fi
os=$(uname -s); arch=$(uname -m)
# A translated Bash reports x86_64 on Apple Silicon. Match the source installer's
# native target selection before choosing the pinned archive/private Node.
if [ "$os/$arch" = Darwin/x86_64 ]; then
  command -v sysctl >/dev/null 2>&1 || fail 'missing prerequisite: sysctl'
  translated=$(sysctl -in sysctl.proc_translated 2>/dev/null || true)
  case "$translated" in 1) arch=arm64 ;; ''|0) ;; *) fail 'unsupported Rosetta observation' ;; esac
fi
case "$os/$arch" in
  Darwin/arm64|Darwin/aarch64) target=darwin-arm64 ;;
  Darwin/x86_64) target=darwin-x64 ;;
  Linux/aarch64|Linux/arm64) target=linux-arm64 ;;
  Linux/x86_64) target=linux-x64 ;;
  *) fail 'unsupported platform' ;;
esac
case "$target" in
${cases.join('\n')}
  *) fail 'unsupported target for this pinned bootstrap' ;;
esac
# Check recorded upstream floors without executing the bundled Node as a probe.
version_floor() {
  local value=$1 minimum_major=$2 minimum_minor=$3 major minor rest
  major=\${value%%.*}; rest=\${value#*.}; minor=\${rest%%.*}
  case "$major:$minor" in *[!0-9:]*|:*) return 1 ;; esac
  [ -n "$minor" ] || return 1
  # Avoid octal interpretation of leading zeroes in shell arithmetic.
  major=$((10#$major)); minor=$((10#$minor))
  [ "$major" -gt "$minimum_major" ] || { [ "$major" -eq "$minimum_major" ] && [ "$minor" -ge "$minimum_minor" ]; }
}
if [ "$os" = Linux ]; then
  command -v getconf >/dev/null 2>&1 || fail 'missing prerequisite: getconf (glibc)'
  libc=$(getconf GNU_LIBC_VERSION 2>/dev/null) || fail "unsupported libc: glibc >=$glibc_min required"
  case "$libc" in 'glibc '*) libc=\${libc#glibc } ;; *) fail 'unsupported libc: glibc required' ;; esac
  version_floor "$libc" "\${glibc_min%%.*}" "\${glibc_min#*.}" || fail "unsupported glibc: >=$glibc_min required"
  kernel=$(uname -r)
  # Match installer-platform.mjs: numeric components plus Linux LOCALVERSION,
  # including +rpt suffixes and WSL fourth components, not arbitrary garbage.
  [[ "$kernel" =~ ^[0-9]+\\.[0-9]+(\\.[0-9]+)*([-+][A-Za-z0-9._+-]*)?$ ]] || fail 'unsupported kernel version'
  kernel=\${kernel%%[-+]*}
  version_floor "$kernel" 4 18 || fail 'unsupported kernel: >=4.18 required'
else
  command -v sw_vers >/dev/null 2>&1 || fail 'missing prerequisite: sw_vers'
  macos=$(sw_vers -productVersion) || fail 'cannot determine macOS version'
  version_floor "$macos" 13 5 || fail 'unsupported macOS: >=13.5 required'
fi
# Fixed /tmp template: no caller-controlled TMPDIR, no state/home changes yet.
tmp=$(mktemp -d /tmp/kiro-fabric-bootstrap.XXXXXXXX) || fail 'private temporary directory unavailable'
[ -d "$tmp" ] && [ ! -L "$tmp" ] || fail 'unsafe temporary directory'
trap 'rm -rf -- "$tmp"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
chmod 700 "$tmp"
size_of() { local n; n=$(wc -c < "$1") || fail 'cannot measure file'; n=\${n//[[:space:]]/}; case "$n" in ''|*[!0-9]*) fail 'invalid size' ;; esac; printf '%s' "$n"; }
check_file() {
  local file=$1 size=$2 expected=$3 actual
  [ "$(size_of "$file")" = "$size" ] || fail 'size mismatch'
  if [ "$hash_kind" = sha256sum ]; then actual=$(sha256sum "$file") || fail 'hash failed'
  else actual=$(shasum -a 256 "$file") || fail 'hash failed'; fi
  actual=\${actual%% *}
  [ "$actual" = "$expected" ] || fail 'sha256 mismatch'
}
# ulimit bounds actual writes even for old curl with chunked responses; wc enforces
# the exact byte ceiling. Use 512-byte units conservatively across Bash platforms.
bounded_copy() {
  local source=$1 destination=$2 max=$3
  [ -f "$source" ] && [ ! -L "$source" ] || fail 'unsafe local archive/sidecar'
  ( ulimit -f "$(( (max + 511) / 512 ))"; cat -- "$source" > "$destination" ) || fail 'local capture failed'
  [ "$(size_of "$destination")" -le "$max" ] || fail 'oversized local capture'
}
download() {
  local url=$1 destination=$2 max=$3 hops=0 status line location
  local LC_ALL=C
  while :; do
    case "$url" in *$'\\r'*|*$'\\n'*|*'#'*) fail 'unsafe redirect URL' ;; esac
    case "$url" in https://github.com/*|https://api.github.com/*|https://release-assets.githubusercontent.com/*) ;; *) fail 'unapproved HTTPS redirect' ;; esac
    status=$( ( ulimit -f "$(( ((max > 65536 ? max : 65536) + 511) / 512 ))"; curl -q --globoff --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 120 --max-filesize "$max" --dump-header "$tmp/headers" --output "$destination" --write-out '%{http_code}' -- "$url" ) ) || fail 'download failed: offline or oversized'
    [ "$(size_of "$destination")" -le "$max" ] || fail 'oversized download'
    [ "$(size_of "$tmp/headers")" -le 65536 ] || fail 'oversized headers'
    case "$status" in
      200) return ;;
      403|429) fail 'rate-limited' ;;
      301|302|303|307|308)
        [ "$hops" -lt 4 ] || fail 'redirect limit'
        location=''
        while IFS= read -r line; do
          line=\${line%$'\\r'}
          case "$line" in [Ll][Oo][Cc][Aa][Tt][Ii][Oo][Nn]:*)
            [ -z "$location" ] || fail 'duplicate redirect location'
            location=\${line#*:}; location=\${location# }; location=\${location#$'\\t'} ;;
          esac
        done < "$tmp/headers"
        [ -n "$location" ] || fail 'missing redirect location'
        url=$location; hops=$((hops + 1)) ;;
      404) fail 'no-release' ;;
      *) fail "download status: $status" ;;
    esac
  done
}
archive="$tmp/bundle.tar.gz"
if [ -n "$from_archive" ]; then
  bounded_copy "$from_archive" "$archive" "$archive_size"
else
  download "$archive_url" "$archive" "$archive_size"
fi
# No tar extraction, chmod of executable, or execution before whole-archive pin.
check_file "$archive" "$archive_size" "$archive_hash"
if [ -n "$from_archive" ]; then
  bounded_copy "$from_archive.release.json" "$archive.release.json" 65536
  bounded_copy "$from_archive.release.sig" "$archive.release.sig" 89
  bounded_copy "$from_archive${RELEASE_SBOM_SUFFIX}" "$archive${RELEASE_SBOM_SUFFIX}" "$sbom_size"
else
  download "$archive_url.release.json" "$archive.release.json" 65536
  download "$archive_url.release.sig" "$archive.release.sig" 89
  download "$archive_url${RELEASE_SBOM_SUFFIX}" "$archive${RELEASE_SBOM_SUFFIX}" "$sbom_size"
fi
[ "$(size_of "$archive.release.sig")" = 89 ] || fail 'signature size mismatch'
check_file "$archive${RELEASE_SBOM_SUFFIX}" "$sbom_size" "$sbom_hash"
# Fixed named-member extraction to controlled files; never unpack untrusted paths.
( ulimit -f "$(( (node_size + 511) / 512 ))"; tar -xOzf "$archive" -- tools/node > "$tmp/node" ) || fail 'node extraction failed'
check_file "$tmp/node" "$node_size" "$node_hash"
( ulimit -f "$(( (manager_size + 511) / 512 ))"; tar -xOzf "$archive" -- manager/install-manager.mjs > "$tmp/manager.mjs" ) || fail 'manager extraction failed'
check_file "$tmp/manager.mjs" "$manager_size" "$manager_hash"
chmod 700 "$tmp/node"
# Signed sidecars stay next to the captured archive; manager MUST verify them
# before activation. Local --from-archive gets no unsigned exemption.
"$tmp/node" "$tmp/manager.mjs" install --from-archive "$archive" \${forward[@]+"\${forward[@]}"}
`;
}

/** Production generation intentionally needs both real signing custody and native
 * exact-artifact qualification. Neither is supplied by a fixture or test key. */
export function assertProductionBootstrapReady(){
 if(!PRODUCTION_TRUST_ROOT)throw Error('Production release trust root unavailable: distribution BLOCKED');
 throw Error('Native exact-artifact release qualification unavailable: distribution BLOCKED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))assertProductionBootstrapReady();
