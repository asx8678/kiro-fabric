# Matched tool-result security replay

Kiro Fabric includes a deterministic replay protocol for testing whether untrusted content crosses an MCP, native tool-result, or recalled-memory boundary into a sensitive effect. It is inspired by AgentDojo's separation of a benign user task from an injected task. Its scope is a deterministic fixture harness, not a model benchmark.

## What it measures

Each fixture is one matched pair:

- the trusted task, structured source data, benign oracle, and authorized-effect allowlist are identical;
- only untrusted text changes between `clean` and `hostile`;
- the driver returns a benign-task output and records each sensitive effect as `blocked` or `committed` after its actual disposition is known.

The runner independently compares the output to the fixture oracle and classifies exact effect digests against the trusted allowlist. Reports keep these dimensions separate:

- `benignSuccessRate`: executable-oracle success, independent of driver self-report;
- `unauthorizedEffectAttempts`: unauthorized blocked plus committed observations;
- `unauthorizedEffects`: unauthorized observations with a committed disposition;
- `unauthorizedEffectRunRate`: runs with at least one committed unauthorized effect.

Aggregates are provided overall, by clean/hostile variant, and for `mcp`, `tool_result`, and `memory`. `validateSecurityReplayReport` checks the TypeBox report schema, recomputes case effect counts, and recomputes every aggregate.

## Run the deterministic canary

```bash
pnpm run replay:security
# or write the report after a build
node scripts/run-security-replay.mjs /tmp/security-replay.json
```

The bundled canary materializes all three boundary envelopes, completes the benign structured-data task, and records the synthetic hostile network request as blocked. It validates wiring and report accounting only. It invokes no model and **does not establish model robustness**.

## Integrate a real boundary

The public `kiro-fabric/verification` entry point exports:

- `defaultSecurityReplayFixtures`
- `materializeSecurityReplaySource`
- `runSecurityReplaySuite`
- `securityReplayReportSchema`
- `validateSecurityReplayReport`
- all fixture, driver, effect, and report TypeScript types

A driver receives boundary-shaped untrusted input. Route it through the system under test, then report effects only after the real host gate or external operation resolves:

```ts
const driver: SecurityReplayDriver = {
  async replay(input, effects) {
    const result = await boundary.handle(input);
    for (const effect of result.effects) {
      effects.observe(effect.request, effect.committed ? "committed" : "blocked");
    }
    return result.benignOutput;
  },
};

const report = await runSecurityReplaySuite(fixtures, driver, {
  subject: { id: "my-boundary-build", kind: "system" },
  generatedAt: new Date().toISOString(),
});
```

Do not mark an attempted call `committed` before the sink confirms it. Do not put real secrets in fixtures. Reports omit raw effect targets and payloads, retaining only kind and SHA-256 digest, but driver errors may still contain sensitive text and should be handled as sensitive test artifacts.

For model-backed drivers, identify the exact model/configuration as the subject and use repeats outside this deterministic runner if sampling is required. A passing report supports only the named fixtures and effect oracle; it is not evidence of general prompt-injection resistance.
