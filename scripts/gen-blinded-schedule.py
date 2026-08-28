#!/usr/bin/env python3
"""Generate the blinded-eval manifests for a run (V4).

Writes:
  <results>/controller/arm-map.json  (0600, private {config -> arm})
  <results>/manifest.json            (candidate-safe, no config mapping)
and prints "config:arm" lines to stdout for the shell orchestration loop.
"""
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bench"))
from blinded_protocol import build_schedule, private_manifest, public_manifest


def write_manifests(results, manifest, rows, seed):
    """Publish both manifests together; never expose a half-written run."""
    results = os.path.abspath(results)
    manifest = os.path.abspath(manifest)
    expected_manifest = os.path.join(results, "manifest.json")
    if manifest != expected_manifest:
        raise ValueError("manifest path must be <results>/manifest.json")
    if os.path.lexists(results):
        raise ValueError(f"results directory already exists: {results}")

    parent = os.path.dirname(results)
    os.makedirs(parent, exist_ok=True)
    staging = tempfile.mkdtemp(prefix=f".{os.path.basename(results)}.", dir=parent)
    try:
        controller = os.path.join(staging, "controller")
        os.mkdir(controller, 0o700)
        arm_map = os.path.join(controller, "arm-map.json")
        with open(arm_map, "w", encoding="utf-8") as file:
            json.dump(private_manifest(rows, seed, os.path.basename(results)), file, indent=2)
            file.write("\n")
        os.chmod(arm_map, 0o600)
        with open(os.path.join(staging, "manifest.json"), "w", encoding="utf-8") as file:
            json.dump(public_manifest(rows, seed, os.path.basename(results)), file, indent=2)
            file.write("\n")
        os.rename(staging, results)
        staging = None
    finally:
        if staging is not None:
            shutil.rmtree(staging)


def main(argv=None):
    argv = sys.argv if argv is None else argv
    if len(argv) != 7:
        print(
            "usage: gen-blinded-schedule.py RESULTS MANIFEST TASKS CONFIGS REPS SEED",
            file=sys.stderr,
        )
        return 2

    (_prog, results, manifest, tasks, configs, reps_value, seed) = argv
    try:
        reps = int(reps_value)
    except ValueError:
        print("gen-blinded-schedule.py: reps must be a positive integer", file=sys.stderr)
        return 2

    try:
        rows = build_schedule(tasks.split(","), configs.split(","), reps, seed)
        write_manifests(results, manifest, rows, seed)
    except (OSError, ValueError) as error:
        print(f"gen-blinded-schedule.py: {error}", file=sys.stderr)
        return 2

    seen = set()
    for row in rows:
        for cfg, arm in row["arms"].items():
            key = f"{cfg}:{arm}"
            if key not in seen:
                seen.add(key)
                print(key)
    # Emit the seeded execution order so the shell harness runs cells in the
    # schedule's `order`, not in CLI config-array order. Format:
    #   ROW:<task>:<rep>:<arm>
    for row in rows:
        for cfg in row["order"]:
            arm = row["arms"][cfg]
            print(f"ROW:{row['task']}:{row['rep']}:{arm}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
