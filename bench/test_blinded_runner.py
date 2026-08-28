#!/usr/bin/env python3
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid


BENCH = Path(__file__).resolve().parent
ROOT = BENCH.parent
RUNNER = BENCH / "run-matrix-blinded.sh"
TASK = "scc-bounded-memory-spilling"


class BlindedRunnerTest(unittest.TestCase):
    def run_runner(self, *args, temp_root):
        env = os.environ.copy()
        env["TMPDIR"] = str(temp_root)
        return subprocess.run(
            ["bash", str(RUNNER), *args],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )

    def test_dry_run_is_useful_and_leaves_no_files(self):
        run_id = f"dry-test-{uuid.uuid4().hex}"
        result_path = BENCH / "results" / run_id
        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            completed = self.run_runner(
                "--dry-run",
                "--run-id",
                run_id,
                "--tasks",
                TASK,
                "--seed",
                "test-seed",
                temp_root=temp_root,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("seeded execution order", completed.stdout)
            self.assertIn(TASK, completed.stdout)
            self.assertIn("schedule validated (not persisted)", completed.stdout)
            self.assertNotIn("report", completed.stdout.lower())
            self.assertEqual(list(temp_root.iterdir()), [])
        self.assertFalse(result_path.exists())

    def test_path_traversal_run_id_is_rejected_without_writes(self):
        escaped_name = f"blinded-escape-{uuid.uuid4().hex}"
        escaped_path = ROOT / escaped_name
        with tempfile.TemporaryDirectory() as directory:
            completed = self.run_runner(
                "--dry-run",
                "--run-id",
                f"../../{escaped_name}",
                "--tasks",
                TASK,
                "--seed",
                "test-seed",
                temp_root=Path(directory),
            )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("invalid --run-id", completed.stderr)
        self.assertFalse(escaped_path.exists())

    def test_malformed_inputs_fail_before_result_creation(self):
        cases = [
            ("--tasks", f"{TASK},{TASK}", "duplicate tasks"),
            ("--tasks", f"{TASK},", "portable names"),
            ("--tasks", "../tasks", "invalid task name"),
            ("--tasks", "missing-task", "unknown task"),
            ("--configs", "baseline,baseline", "duplicate configs"),
            ("--configs", "baseline:other", "invalid config name"),
            ("--reps", "zero", "reps must be a positive integer"),
            ("--reps", "0", "reps must be a positive integer"),
        ]
        for option, value, expected in cases:
            with self.subTest(option=option, value=value):
                run_id = f"invalid-test-{uuid.uuid4().hex}"
                result_path = BENCH / "results" / run_id
                with tempfile.TemporaryDirectory() as directory:
                    completed = self.run_runner(
                        "--run-id",
                        run_id,
                        "--tasks",
                        TASK,
                        option,
                        value,
                        "--seed",
                        "test-seed",
                        temp_root=Path(directory),
                    )
                self.assertEqual(completed.returncode, 2)
                self.assertIn(expected, completed.stderr)
                self.assertFalse(result_path.exists())

    def test_missing_option_value_fails_cleanly(self):
        for args in [("--seed",), ("--seed", "--dry-run")]:
            with self.subTest(args=args), tempfile.TemporaryDirectory() as directory:
                completed = self.run_runner(*args, temp_root=Path(directory))
            self.assertEqual(completed.returncode, 2)
            self.assertIn("--seed requires a value", completed.stderr)
            self.assertNotIn("unbound variable", completed.stderr)

    def test_real_run_refuses_an_existing_results_directory(self):
        results_root = BENCH / "results"
        with tempfile.TemporaryDirectory(prefix="existing-test-", dir=results_root) as directory:
            result_path = Path(directory)
            completed = self.run_runner(
                "--run-id",
                result_path.name,
                "--tasks",
                TASK,
                "--seed",
                "test-seed",
                temp_root=result_path,
            )
            self.assertEqual(completed.returncode, 2)
            self.assertIn("results directory already exists", completed.stderr)
            self.assertEqual(list(result_path.iterdir()), [])

    def test_mktemp_failure_stops_without_creating_results(self):
        run_id = f"mktemp-test-{uuid.uuid4().hex}"
        result_path = BENCH / "results" / run_id
        with tempfile.TemporaryDirectory() as directory:
            invalid_temp_root = Path(directory) / "not-a-directory"
            invalid_temp_root.touch()
            completed = self.run_runner(
                "--dry-run",
                "--run-id",
                run_id,
                "--tasks",
                TASK,
                "--seed",
                "test-seed",
                temp_root=invalid_temp_root,
            )
        self.assertNotEqual(completed.returncode, 0)
        self.assertFalse(result_path.exists())


if __name__ == "__main__":
    unittest.main()
