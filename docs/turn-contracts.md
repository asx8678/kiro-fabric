# Steering and explicit turn contracts

Steering improves model behavior; it cannot guarantee that every stochastic run obeys every instruction. This is especially important for a no-tools request and a JSON-only final answer. Passing tests on changed files is not enough if the response violates those contracts.

## What this implementation does

- Put tool bans and requested output formats ahead of general workflow advice.
- Apply batching/data pipelines only when tools are permitted and needed; writes still need authorization.
- Keep permitted verification and blockers inside the requested JSON schema, without adding unsupported fields or a prose test summary.
- Suppress visible assistant commentary before/between tool calls for JSON-only requests, then recheck the original requested format without invoking a tool.
- Make detailed Kiro-native skills/recipes/workflows reachable through immutable `fabric.help`, rather than assuming activation or importing Pi-only globals.
- Test and report task correctness, scope, output format, requested execution and no-tool behavior separately, with all required checks contributing to overall success.

These are not new enforcement claims. The benchmark rejects a noncompliant result rather than counting only the successful edit.

## Where hard enforcement belongs

A caller that needs a hard delivered-output contract should accept an **explicit operator-supplied** tool policy and output schema, not infer permissions by regex over natural-language prompts, quoted source or tool results.

1. Before inference, remove all model tools for a no-tools turn. In a Kiro integration, use a supported empty tool-selection policy/explicit no-tools agent configuration and verify the effective inventory. An empty trust list is not the same as an empty tool list.
2. Gate tool execution as a backstop. Permission checks prevent effects, but a rejection after selection cannot undo the already-issued model tool call or its inference cost.
3. Buffer the final answer instead of delivering unvalidated streamed prose. Parse the entire answer as raw JSON, validate the operator's schema and required semantic checks, and preserve complete requested data. Do not strip fences or silently coerce values in the acceptance path.
4. On mismatch, either return an explicit contract failure or make one separately budgeted, tools-disabled **format-only** repair using verified evidence already collected. Never rerun source edits, commands, commits or network mutations to repair presentation. Record the first failure and both costs.
5. Revalidate repaired output; fail closed if it still violates the contract. Schema validity is not proof of factual/task correctness. A hard guarantee means compliant delivered output or an explicit failure, not guaranteed successful completion.

This caller-side integration is a design boundary, **not a new fabric_exec input field or shipped hard-contract runner**.

## Why common shortcuts are insufficient

- `fabric_exec.resultFormat` formats the guest result. Kiro can still produce a separate prose final answer.
- MCP `outputSchema` describes a tool result, not the final assistant answer.
- Kiro `--output-format stream-json` frames transport events as JSON Lines; it does not constrain assistant text to JSON. In the observed 2.21.1 client, `runFinished.finalText` concatenates visible `agent_message_chunk` text across tool calls. An earlier progress sentence therefore invalidates raw JSON even if the last message is an exact JSON value. Validate the whole delivered text, not a suffix.
- A PreToolUse hook can deny effects only after the tool was selected. It does not establish zero tool attempts.
- In the inspected KAS 2.21.1 implementation, Stop hooks can request continuation, but their input contains session/cwd/event and optional user decision, not the final answer or transcript. Blindly attaching a JSON validator would not validate the intended text. Continuation also does not itself remove tools or bound retries.
- Model-selected schemas, model-written validation helpers and guessed `toolChoice`/`responseFormat` profile fields are not host guarantees.
- Pi's speculative execution and catalog repairs operate at different boundaries; copying them does not solve either problem.

A future implementation must bind contracts to session/turn identity, test actual client capabilities, account for all attempts, bound repairs and avoid replaying effects. Do not patch installed Kiro binaries or widen Fabric filesystem/network authority to imitate client support.
