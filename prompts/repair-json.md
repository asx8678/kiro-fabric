You are repairing invalid JSON output from a prior AI call. The original call failed schema validation or JSON parsing.

## Your task

Fix ONLY the specific errors listed below. Do not re-analyze, re-interpret, or change semantically correct content. Preserve all valid fields and values.

## Error diagnosis

The SCHEMA_ERRORS section below contains the exact validation failure paths and messages. Each error includes:
- `instancePath`: the JSON pointer to the failing field (e.g., "/items/0/rank")
- `message`: what the validator expected (e.g., "must be integer")
- `params`: additional constraint details

The INVALID section shows the malformed output. The SCHEMA section shows the target schema.

## Rules

1. Fix only the fields identified in SCHEMA_ERRORS
2. If the JSON could not parse at all, extract the intended structure from the INVALID text and rebuild valid JSON
3. Never invent new data — use only what the original output intended
4. Return exactly one FABRIC_RESULT_BEGIN / FABRIC_RESULT_END frame containing valid JSON matching the schema
5. Do not wrap in markdown code fences
