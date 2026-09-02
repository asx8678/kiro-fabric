import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NATIVE_KIRO_FIXTURE_TESTS = [
  "tests/kiro-installer.test.ts",
  "tests/kiro-claims-certification.test.ts",
] as const;

export const assertNativeKiroFixtureToolchain = (): string => {
  const executable = process.env.KIRO_FABRIC_GO_BINARY?.trim() || "go";
  try {
    const version = execFileSync(executable, ["version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
    if (!/^go version go1\.(?:2[2-9]|[3-9]\d)(?:\.\d+)?\b/u.test(version)) {
      throw new Error(`unsupported version output: ${version || "(empty)"}`);
    }
    return executable;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Go 1.22 or newer is required only for the native, non-billable Kiro test fixture " +
      `used by ${NATIVE_KIRO_FIXTURE_TESTS.join(" and ")}; install Go or set ` +
      `KIRO_FABRIC_GO_BINARY to an absolute Go executable (${detail})`,
    );
  }
};

/** Build a static, non-billable native Kiro fixture for fresh production processes. */
export const buildNativeKiroFixture = (directory: string): string => {
  const go = assertNativeKiroFixtureToolchain();
  const source = join(directory, "native-kiro-fixture.go");
  const binary = join(directory, process.platform === "win32" ? "native-kiro-fixture.exe" : "native-kiro-fixture");
  writeFileSync(source, `package main
import("bufio";"encoding/json";"fmt";"os";"strings")
func send(id any,result any){json.NewEncoder(os.Stdout).Encode(map[string]any{"jsonrpc":"2.0","id":id,"result":result})}
func main(){
 a:=os.Args[1:]
 if len(a)>0&&a[0]=="--version"{fmt.Println("kiro-cli 2.20.1");return}
 if len(a)>1&&a[0]=="acp"&&a[1]=="--help"{fmt.Println("--agent-engine v3 --auth-method cli");return}
 if len(a)>1&&a[0]=="agent"&&a[1]=="validate"{p:="";for i,v:=range a{if v=="--path"&&i+1<len(a){p=a[i+1]}};b,e:=os.ReadFile(p);if e!=nil||!strings.Contains(string(b),"\\\"name\\\""){fmt.Fprintln(os.Stderr,"error: agent config missing required field: name");return};fmt.Println("agent config is valid");return}
 if len(a)==0||a[0]!="acp"{if p:=os.Getenv("KIRO_SETUP_LAUNCH_LOG");p!=""{f,_:=os.OpenFile(p,os.O_CREATE|os.O_APPEND|os.O_WRONLY,0600);fmt.Fprintln(f,strings.Join(a," "));f.Close()};return}
 s:=bufio.NewScanner(os.Stdin);for s.Scan(){var m map[string]any;if json.Unmarshal(s.Bytes(),&m)!=nil{continue};id,ok:=m["id"];if !ok{continue};method,_:=m["method"].(string);switch method{case "initialize":send(id,map[string]any{"protocolVersion":1,"agentCapabilities":map[string]any{"loadSession":true}});case "session/new","session/load":send(id,map[string]any{"sessionId":"fixture-session","modes":map[string]any{"currentModeId":"vibe","availableModes":[]any{map[string]any{"id":"vibe"},map[string]any{"id":"kiro-fabric"}}}});default:send(id,map[string]any{})}}
}
`);
  execFileSync(go, ["build", "-trimpath", "-ldflags=-s -w", "-o", binary, source], {
    cwd: directory,
    env: { ...process.env, CGO_ENABLED: "0" },
    stdio: "pipe",
    timeout: 60_000,
  });
  if (process.platform !== "win32") chmodSync(binary, 0o755);
  return binary;
};
