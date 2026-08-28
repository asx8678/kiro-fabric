#!/usr/bin/env python3
"""Blinded agent-eval protocol (V4).

Deterministic, standard-library-only machinery for running a paired agent
evaluation so candidate arms never see treatment labels in their working
directory, prompt, or result hierarchy.

Rules:
  - Candidate-visible paths use opaque, neutral arm ids; the config mapping
    lives only in the private manifest (0600) visible to the controller.
  - Ordering per (task, rep) is randomized from a seed via SHA-256 over
    ("seed"\\0task\\0rep), reproducible across hosts/Python versions.
  - A judge sees both arms' anonymized bundles in one pass and may break only
    oracle-equivalent ties; it can never override a failed deterministic
    oracle. This module only *produces* the authoring surface.
"""

import hashlib
import re

FORMAT_VERSION = 4

# neutral, project-shaped labels (never "baseline" / "fabric-local" / versions)
NEUTRAL_ARMS = [
    "cedar", "harbor", "juniper", "kestrel", "marlin", "oakley", "pimento",
    "racoon", "sedge", "wren",
]

FORBIDDEN_TERMS = [
    "baseline", "fabric-local", "fabric_v", "candidate", "judge", "eval",
    "arena", "rubric", "score", "compare", "ablation", "treatment", "variant",
]

# Task and config names are embedded in the controller's line protocol; task
# names also become path components. Keep the accepted alphabet deliberately
# small so a valid schedule cannot contain delimiters, whitespace, or traversal
# syntax. Existing task/config names all fit this portable form.
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


def _sha(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest(), byteorder="big")


def opaque_arm_ids(configs, seed):
    """Deterministic { config -> opaque neutral arm id }.

    Configs are sorted by sha256(seed\\0config) and assigned neutral labels in
    the same hashed order so the mapping is stable for a given seed.
    """
    ordered = sorted(configs, key=lambda c: _sha(f"{seed}\u0000config\u0000{c}"))
    return {cfg: NEUTRAL_ARMS[i % len(NEUTRAL_ARMS)] for i, cfg in enumerate(ordered)}


def paired_order(configs, seed, task, rep):
    """Deterministic per-(task, rep) ordering of configs.

    Two arms: whatever sha256(seed\\0task\\0rep) has low bit drives which runs
    first. More arms: ranked by sha256(seed\\0task\\0rep\\0config).
    """
    configs = list(configs)
    if len(configs) == 2:
        bit = _sha(f"{seed}\u0000{task}\u0000{rep}") % 2
        return configs if bit == 0 else [configs[1], configs[0]]
    return sorted(configs, key=lambda c: _sha(f"{seed}\u0000{task}\u0000{rep}\u0000{c}"))


def _validated_names(values, label):
    """Materialize and validate identifiers used by a schedule."""
    if isinstance(values, (str, bytes)):
        raise ValueError(f"build_schedule: {label} must be an iterable of names")
    try:
        names = list(values)
    except TypeError as error:
        raise ValueError(f"build_schedule: {label} must be an iterable of names") from error
    if not names:
        raise ValueError(f"build_schedule: at least one {label[:-1]} is required")
    if any(not isinstance(name, str) or not SAFE_NAME.fullmatch(name) for name in names):
        raise ValueError(
            f"build_schedule: {label} must be 1-128 character portable names "
            "using only letters, digits, '.', '_' and '-'"
        )
    if len(set(names)) != len(names):
        raise ValueError(f"build_schedule: duplicate {label} are not allowed")
    return names


def build_schedule(tasks, configs, reps, seed):
    """Produce rows of {'pair_id', 'task', 'rep', 'order', 'arms'}.

    Fail closed on malformed inputs. A schedule must never silently collide,
    reuse an arm identity, or emit a delimiter/path fragment as an identifier.
    """
    tasks = _validated_names(tasks, "tasks")
    configs = _validated_names(configs, "configs")
    if len(configs) > len(NEUTRAL_ARMS):
        raise ValueError(
            f"build_schedule: {len(configs)} configs exceed the {len(NEUTRAL_ARMS)} neutral arm labels; "
            "arm identity would collide"
        )
    if isinstance(reps, bool) or not isinstance(reps, int) or reps < 1:
        raise ValueError("build_schedule: reps must be a positive integer")
    if not isinstance(seed, str) or not seed or any(ord(char) < 32 for char in seed):
        raise ValueError("build_schedule: seed must be a non-empty string without control characters")
    arms = opaque_arm_ids(configs, seed)
    rows = []
    for task in tasks:
        for rep in range(reps):
            rows.append(
                {
                    "pair_id": f"{task}:rep{rep}",
                    "task": task,
                    "rep": rep,
                    "order": paired_order(configs, seed, task, rep),
                    "arms": arms,
                }
            )
    return rows


def scan_forbidden(pieces):
    """Return [{'term', 'location'}] when a forbidden (unblinding) term appears
    in any candidate-facing text or path. Empty list = clean."""
    if isinstance(pieces, str):
        pieces = [(None, pieces)]
    findings = []
    for location, text in pieces:
        low = text.lower()
        for term in FORBIDDEN_TERMS:
            if term in low:
                findings.append({"term": term, "location": location})
    return findings


def private_manifest(rows, seed, run_id):
    """Serialize schedule + private config mapping for the controller only."""
    return {
        "format_version": FORMAT_VERSION,
        "run_id": run_id,
        "seed": seed,
        "pairs": rows,
    }


def public_manifest(rows, seed, run_id):
    """A candidate-safe manifest WITHOUT any {config -> arm} mapping."""
    public_rows = [
        {
            "pair_id": r["pair_id"],
            "task": r["task"],
            "rep": r["rep"],
            "order_arms": [r["arms"].get(c, "") for c in r["order"]],
        }
        for r in rows
    ]
    return {
        "format_version": FORMAT_VERSION,
        "run_id": run_id,
        "seed": seed,
        "pairs": public_rows,
    }
