#!/usr/bin/env python3
import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from mutation_verifiers import MutationSuiteError, run_mutation_suite, validate_report


BENCH = Path(__file__).resolve().parent
ROOT = BENCH.parent
RUNNER = BENCH / "mutation_verifiers.py"
TASKS = "scc-bounded-memory-spilling,superjson-error-stack-serialization"


class MutationVerifierTest(unittest.TestCase):
    def test_existing_task_mutants_are_rejected_and_report_is_current(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.json"
            completed = subprocess.run(
                ["python3", str(RUNNER), "--tasks", TASKS, "--report", str(report)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                timeout=180,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            payload = json.loads(report.read_text())
            self.assertTrue(payload["trusted"])
            self.assertEqual(payload["summary"], {
                "tasks": 2,
                "mutants": 9,
                "rejected": 9,
                "accepted": 0,
                "invalid": 0,
            })
            validate_report(report, BENCH, TASKS.split(","))

    def test_accepted_mutant_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            bench = Path(directory)
            task = bench / "tasks" / "weak"
            fixture = task / "mutants" / "fixture"
            fixture.mkdir(parents=True)
            (fixture / "candidate.txt").write_text("reject = false\n")
            (task / "task.json").write_text(json.dumps({"verify_timeout_s": 10}))
            (task / "prompt.txt").write_text("The candidate must reject invalid input.\n")
            (task / "mutants.json").write_text(json.dumps({
                "schema_version": 1,
                "fixture": "mutants/fixture",
                "expected_checks": ["invalid_input"],
                "mutants": [{
                    "id": "accept-invalid",
                    "description": "Accepts invalid input.",
                    "expected_failed_checks": ["invalid_input"],
                    "edits": [{
                        "path": "candidate.txt",
                        "old": "reject = false",
                        "new": "reject = true",
                    }],
                }],
            }))
            (task / "verify.sh").write_text("""#!/usr/bin/env bash
cat >"$2" <<'JSON'
{"reward_binary":1,"checks":{"invalid_input":1}}
JSON
""")
            report = bench / "report.json"
            completed = subprocess.run(
                ["python3", str(RUNNER), "--bench-root", str(bench), "--tasks", "weak", "--report", str(report)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                timeout=20,
                check=False,
            )
            self.assertEqual(completed.returncode, 1)
            payload = json.loads(report.read_text())
            self.assertFalse(payload["trusted"])
            self.assertEqual(payload["summary"]["accepted"], 1)
            self.assertEqual(payload["tasks"][0]["mutants"][0]["status"], "accepted")
            with self.assertRaisesRegex(MutationSuiteError, "untrusted"):
                validate_report(report, bench, ["weak"])

    def test_report_validation_requires_exact_unique_sets_and_summary(self):
        slug = "scc-bounded-memory-spilling"
        payload = run_mutation_suite(BENCH, [slug])
        self.assertTrue(payload["trusted"])
        mutations = {
            "task slug": lambda value: value["tasks"].append(copy.deepcopy(value["tasks"][0])),
            "mutant set": lambda value: value["tasks"][0]["mutants"].pop(),
            "check set": lambda value: value["tasks"][0]["mutants"][0]["checks"].pop("build"),
            "expected check set": lambda value: value["tasks"][0]["mutants"][0]["expected_failed_checks"].append("build"),
            "summary totals": lambda value: value["summary"].update({"mutants": 999}),
        }
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.json"
            report.write_text(json.dumps(payload))
            validate_report(report, BENCH, [slug])
            for expected, mutate in mutations.items():
                with self.subTest(expected=expected):
                    tampered = copy.deepcopy(payload)
                    mutate(tampered)
                    report.write_text(json.dumps(tampered))
                    with self.assertRaisesRegex(MutationSuiteError, expected):
                        validate_report(report, BENCH, [slug])

    def test_changed_suite_invalidates_a_previously_trusted_report(self):
        slug = "scc-bounded-memory-spilling"
        payload = run_mutation_suite(BENCH, [slug])
        self.assertTrue(payload["trusted"])
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.json"
            report.write_text(json.dumps(payload))
            validate_report(report, BENCH, [slug])
            payload["tasks"][0]["fingerprint"] = "sha256:" + "0" * 64
            report.write_text(json.dumps(payload))
            with self.assertRaisesRegex(MutationSuiteError, "stale"):
                validate_report(report, BENCH, [slug])


if __name__ == "__main__":
    unittest.main()
