#!/usr/bin/env python3
"""Mutation-test local benchmark verifiers without running an agent or model."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
MAX_LOG_CHARS = 4_000


class MutationSuiteError(ValueError):
    """A mutation suite or attestation is malformed."""


def _load_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise MutationSuiteError(f"cannot read JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise MutationSuiteError(f"expected a JSON object in {path}")
    return value


def _safe_relative(value: object, label: str) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise MutationSuiteError(f"{label} must be a non-empty portable relative path")
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise MutationSuiteError(f"{label} escapes the task directory: {value}")
    return path


def task_fingerprint(task_dir: Path) -> str:
    """Hash every verifier-suite input so stale reports cannot attest changed code."""
    digest = hashlib.sha256()
    files = sorted(path for path in task_dir.rglob("*") if path.is_file() or path.is_symlink())
    if not files:
        raise MutationSuiteError(f"task has no files: {task_dir}")
    for path in files:
        if path.is_symlink():
            raise MutationSuiteError(f"task suites may not contain symlinks: {path}")
        relative = path.relative_to(task_dir).as_posix().encode()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        data = path.read_bytes()
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)
    return f"sha256:{digest.hexdigest()}"


def _suite(task_dir: Path) -> tuple[dict[str, Any], Path, list[dict[str, Any]]]:
    manifest_path = task_dir / "mutants.json"
    manifest = _load_object(manifest_path)
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise MutationSuiteError(f"unsupported mutation schema in {manifest_path}")
    fixture = task_dir / _safe_relative(manifest.get("fixture"), "fixture")
    if not fixture.is_dir() or fixture.is_symlink():
        raise MutationSuiteError(f"mutation fixture is not a real directory: {fixture}")
    mutants = manifest.get("mutants")
    if not isinstance(mutants, list) or not mutants:
        raise MutationSuiteError(f"mutation suite has no mutants: {manifest_path}")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for mutant in mutants:
        if not isinstance(mutant, dict):
            raise MutationSuiteError(f"mutant entries must be objects: {manifest_path}")
        mutant_id = mutant.get("id")
        if not isinstance(mutant_id, str) or not mutant_id or not all(
            character.isalnum() or character in "._-" for character in mutant_id
        ):
            raise MutationSuiteError(f"invalid mutant id: {mutant_id!r}")
        if mutant_id in seen:
            raise MutationSuiteError(f"duplicate mutant id: {mutant_id}")
        seen.add(mutant_id)
        description = mutant.get("description")
        expected = mutant.get("expected_failed_checks")
        edits = mutant.get("edits")
        if not isinstance(description, str) or not description.strip():
            raise MutationSuiteError(f"mutant {mutant_id} has no description")
        if not isinstance(expected, list) or not expected or not all(
            isinstance(name, str) and name for name in expected
        ):
            raise MutationSuiteError(f"mutant {mutant_id} needs expected_failed_checks")
        if len(set(expected)) != len(expected):
            raise MutationSuiteError(f"mutant {mutant_id} repeats an expected check")
        if not isinstance(edits, list) or not edits:
            raise MutationSuiteError(f"mutant {mutant_id} has no deterministic edits")
        normalized.append(mutant)
    return manifest, fixture, normalized


def _apply_mutant(workdir: Path, mutant: dict[str, Any]) -> None:
    for index, edit in enumerate(mutant["edits"]):
        if not isinstance(edit, dict):
            raise MutationSuiteError(f"mutant {mutant['id']} edit {index} is not an object")
        relative = _safe_relative(edit.get("path"), f"mutant {mutant['id']} edit path")
        old, new = edit.get("old"), edit.get("new")
        if not isinstance(old, str) or not old or not isinstance(new, str):
            raise MutationSuiteError(f"mutant {mutant['id']} edit {index} needs string old/new")
        path = workdir / relative
        if not path.is_file() or path.is_symlink():
            raise MutationSuiteError(f"mutant {mutant['id']} edit target is not a real file: {relative}")
        contents = path.read_text()
        if contents.count(old) != 1:
            raise MutationSuiteError(
                f"mutant {mutant['id']} edit must match exactly once in {relative}"
            )
        path.write_text(contents.replace(old, new))


def _binary(value: object) -> bool:
    return type(value) in (int, float) and value in (0, 1)


def _clip(value: str) -> str:
    return value if len(value) <= MAX_LOG_CHARS else value[-MAX_LOG_CHARS:]


def _run_mutant(task_dir: Path, fixture: Path, mutant: dict[str, Any], timeout: int) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": mutant["id"],
        "description": mutant["description"],
        "expected_failed_checks": mutant["expected_failed_checks"],
        "status": "invalid",
    }
    try:
        with tempfile.TemporaryDirectory(prefix=f"bench-mutant-{mutant['id']}-") as directory:
            root = Path(directory)
            workdir = root / "workdir"
            shutil.copytree(fixture, workdir)
            _apply_mutant(workdir, mutant)
            result_path = root / "result.json"
            result_path.write_text("{}\n")
            completed = subprocess.run(
                ["bash", str(task_dir / "verify.sh"), str(workdir), str(result_path)],
                cwd=workdir,
                text=True,
                capture_output=True,
                timeout=timeout,
                check=False,
            )
            record["verifier_exit_code"] = completed.returncode
            record["verifier_stdout"] = _clip(completed.stdout)
            record["verifier_stderr"] = _clip(completed.stderr)
            if completed.returncode != 0:
                record["reason"] = "verifier exited nonzero"
                return record
            result = _load_object(result_path)
            reward = result.get("reward_binary")
            checks = result.get("checks")
            record["reward_binary"] = reward
            record["checks"] = checks
            if not _binary(reward) or not isinstance(checks, dict) or not checks or not all(
                isinstance(name, str) and name and _binary(value) for name, value in checks.items()
            ):
                record["reason"] = "verifier result has an invalid reward/check shape"
                return record
            if reward == 1:
                record["status"] = "accepted"
                record["reason"] = "verifier accepted an acceptance-violating mutant"
                return record
            expected = set(mutant["expected_failed_checks"])
            missing = sorted(expected - checks.keys())
            wrong_expected = sorted(name for name in expected if checks.get(name) != 0)
            collateral = sorted(name for name, value in checks.items() if name not in expected and value != 1)
            if missing or wrong_expected or collateral:
                record["reason"] = "mutant was not rejected by only its targeted checks"
                record["missing_expected_checks"] = missing
                record["passing_expected_checks"] = wrong_expected
                record["collateral_failed_checks"] = collateral
                return record
            record["status"] = "rejected"
            return record
    except (MutationSuiteError, OSError, subprocess.TimeoutExpired) as error:
        record["reason"] = f"{type(error).__name__}: {error}"
        return record


def run_mutation_suite(bench_root: Path, task_slugs: list[str]) -> dict[str, Any]:
    task_reports: list[dict[str, Any]] = []
    for slug in task_slugs:
        task_dir = bench_root / "tasks" / slug
        task_report: dict[str, Any] = {"slug": slug, "trusted": False, "mutants": []}
        try:
            if not task_dir.is_dir() or task_dir.is_symlink():
                raise MutationSuiteError(f"unknown benchmark task: {slug}")
            verify = task_dir / "verify.sh"
            if not verify.is_file() or verify.is_symlink():
                raise MutationSuiteError(f"task verifier is missing: {verify}")
            task_config = _load_object(task_dir / "task.json")
            timeout = task_config.get("verify_timeout_s", 300)
            if type(timeout) is not int or timeout <= 0:
                raise MutationSuiteError(f"invalid verify_timeout_s for {slug}")
            _, fixture, mutants = _suite(task_dir)
            task_report["fingerprint"] = task_fingerprint(task_dir)
            task_report["mutants"] = [
                _run_mutant(task_dir, fixture, mutant, timeout) for mutant in mutants
            ]
            task_report["trusted"] = all(
                mutant["status"] == "rejected" for mutant in task_report["mutants"]
            )
        except MutationSuiteError as error:
            task_report["error"] = str(error)
        task_reports.append(task_report)
    total = sum(len(task["mutants"]) for task in task_reports)
    rejected = sum(
        mutant["status"] == "rejected" for task in task_reports for mutant in task["mutants"]
    )
    accepted = sum(
        mutant["status"] == "accepted" for task in task_reports for mutant in task["mutants"]
    )
    invalid = total - rejected - accepted
    trusted = bool(task_reports) and all(task["trusted"] for task in task_reports)
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "benchmark-verifier-mutation-report",
        "trusted": trusted,
        "summary": {"tasks": len(task_reports), "mutants": total, "rejected": rejected, "accepted": accepted, "invalid": invalid},
        "tasks": task_reports,
    }


def validate_report(report_path: Path, bench_root: Path, task_slugs: list[str]) -> None:
    report = _load_object(report_path)
    if (
        report.get("schema_version") != SCHEMA_VERSION
        or report.get("kind") != "benchmark-verifier-mutation-report"
        or report.get("trusted") is not True
    ):
        raise MutationSuiteError(f"untrusted verifier mutation report: {report_path}")
    reports = report.get("tasks")
    if not isinstance(reports, list):
        raise MutationSuiteError(f"invalid task list in verifier mutation report: {report_path}")
    by_slug = {
        task.get("slug"): task
        for task in reports
        if isinstance(task, dict) and isinstance(task.get("slug"), str)
    }
    for slug in task_slugs:
        task = by_slug.get(slug)
        if not isinstance(task, dict) or task.get("trusted") is not True:
            raise MutationSuiteError(f"report does not trust verifier for task: {slug}")
        mutants = task.get("mutants")
        if not isinstance(mutants, list) or not mutants or any(
            not isinstance(mutant, dict)
            or mutant.get("status") != "rejected"
            or mutant.get("reward_binary") != 0
            for mutant in mutants
        ):
            raise MutationSuiteError(f"report has untrusted mutant records for task: {slug}")
        current = task_fingerprint(bench_root / "tasks" / slug)
        if task.get("fingerprint") != current:
            raise MutationSuiteError(f"stale verifier mutation report for task: {slug}")


def _task_slugs(bench_root: Path, value: str | None) -> list[str]:
    if value is None:
        return sorted(path.name for path in (bench_root / "tasks").iterdir() if path.is_dir())
    slugs = value.split(",")
    if not slugs or any(not slug for slug in slugs) or len(set(slugs)) != len(slugs):
        raise MutationSuiteError("--tasks must be a non-empty, duplicate-free comma list")
    if any(not all(character.isalnum() or character in "._-" for character in slug) for slug in slugs):
        raise MutationSuiteError("--tasks contains an invalid task name")
    return slugs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bench-root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--tasks", help="comma-separated task slugs (default: every local task)")
    parser.add_argument("--report", type=Path, help="write the JSON attestation here")
    parser.add_argument("--check-report", type=Path, help="validate an existing report and current fingerprints")
    args = parser.parse_args(argv)
    try:
        bench_root = args.bench_root.resolve()
        slugs = _task_slugs(bench_root, args.tasks)
        if args.check_report:
            validate_report(args.check_report, bench_root, slugs)
            print(f"verifier mutation report trusted for {len(slugs)} task(s)")
            return 0
        report = run_mutation_suite(bench_root, slugs)
        encoded = json.dumps(report, indent=2) + "\n"
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(encoded)
        summary = report["summary"]
        print(
            "verifier mutation gate: "
            f"rejected={summary['rejected']} accepted={summary['accepted']} invalid={summary['invalid']}"
        )
        if not report["trusted"]:
            for task in report["tasks"]:
                for mutant in task["mutants"]:
                    if mutant["status"] != "rejected":
                        print(
                            f"FAIL {task['slug']}/{mutant['id']}: {mutant.get('reason', mutant['status'])}",
                            file=sys.stderr,
                        )
                if task.get("error"):
                    print(f"FAIL {task['slug']}: {task['error']}", file=sys.stderr)
            return 1
        return 0
    except MutationSuiteError as error:
        print(f"mutation_verifiers.py: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
