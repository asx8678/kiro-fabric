#!/usr/bin/env python3
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from mutation_verifiers import MutationSuiteError, task_fingerprint, validate_report


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

    def test_changed_suite_invalidates_a_previously_trusted_report(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.json"
            task = BENCH / "tasks" / "scc-bounded-memory-spilling"
            payload = {
                "schema_version": 1,
                "kind": "benchmark-verifier-mutation-report",
                "trusted": True,
                "tasks": [{
                    "slug": task.name,
                    "trusted": True,
                    "fingerprint": task_fingerprint(task),
                    "mutants": [{"id": "tested", "status": "rejected", "reward_binary": 0}],
                }],
            }
            report.write_text(json.dumps(payload))
            validate_report(report, BENCH, [task.name])
            payload["tasks"][0]["fingerprint"] = "sha256:" + "0" * 64
            report.write_text(json.dumps(payload))
            with self.assertRaisesRegex(MutationSuiteError, "stale"):
                validate_report(report, BENCH, [task.name])


if __name__ == "__main__":
    unittest.main()
