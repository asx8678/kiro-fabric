#!/usr/bin/env python3
import json
import unittest

from blinded_protocol import (
    FORBIDDEN_TERMS,
    build_schedule,
    opaque_arm_ids,
    paired_order,
    public_manifest,
    scan_forbidden,
)


class BlindedProtocolTest(unittest.TestCase):
    def setUp(self):
        self.configs = ["baseline", "fabric-local"]
        self.seed = "v4-probe"

    def test_opaque_arm_ids_are_neutral_and_deterministic(self):
        a = opaque_arm_ids(self.configs, self.seed)
        b = opaque_arm_ids(self.configs, self.seed)
        self.assertEqual(a, b)
        for arm in a.values():
            self.assertIn(arm, ["cedar", "harbor", "juniper", "kestrel", "marlin", "oakley", "pimento", "racoon", "sedge", "wren"])
        # raw config names must not leak as arm ids
        forbidden = False
        for cfg in self.configs:
            if cfg in a.values():
                forbidden = True
        self.assertFalse(forbidden)

    def test_pairing_is_reproducible_and_balanced_over_reps(self):
        orders = [paired_order(self.configs, self.seed, "task", r) for r in range(8)]
        # reproducible
        again = [paired_order(self.configs, self.seed, "task", r) for r in range(8)]
        self.assertEqual(orders, again)
        # both arms about equally likely first across reps (4/4 here is plausible)
        firsts = [o[0] for o in orders]
        self.assertEqual(set(firsts), set(self.configs))
        # each rep is a valid permutation
        for o in orders:
            self.assertEqual(sorted(o), sorted(self.configs))

    def test_schedule_orders_by_rep_and_uses_opaque_arms(self):
        sched = build_schedule(["t1", "t2"], self.configs, 2, self.seed)
        self.assertEqual(len(sched), 4)
        self.assertEqual(sched[0]["pair_id"], "t1:rep0")
        for row in sched:
            self.assertEqual(len(row["order"]), 2)
            self.assertEqual(set(row["order"]), set(self.configs))

    def test_public_manifest_has_no_config_mapping(self):
        sched = build_schedule(["t1"], self.configs, 1, self.seed)
        pub = public_manifest(sched, self.seed, "run-1")
        blob = json.dumps(pub)
        self.assertNotIn("fabric-local", blob)
        self.assertNotIn('"baseline"', blob)

    def test_scan_forbidden_detects_unblinding_terms(self):
        findings = scan_forbidden([("runner", "results/run-1/baseline/t1/rep0")])
        self.assertTrue(any(f["term"] == "baseline" for f in findings))
        self.assertEqual(scan_forbidden("run results/run-1/cedar"), [])

    def test_build_schedule_rejects_duplicate_configs(self):
        with self.assertRaises(ValueError):
            build_schedule(["t1"], ["baseline", "baseline"], 1, self.seed)

    def test_build_schedule_materializes_tasks_and_rejects_duplicates(self):
        tasks = (task for task in ["t1", "t2"])
        schedule = build_schedule(tasks, self.configs, 1, self.seed)
        self.assertEqual([row["task"] for row in schedule], ["t1", "t2"])
        with self.assertRaisesRegex(ValueError, "duplicate tasks"):
            build_schedule(["t1", "t1"], self.configs, 1, self.seed)

    def test_build_schedule_rejects_excess_configs(self):
        # 11 configs exceed the 10 available neutral arm labels.
        too_many = [f"c{i}" for i in range(11)]
        with self.assertRaises(ValueError):
            build_schedule(["t1"], too_many, 1, self.seed)

    def test_build_schedule_rejects_bad_reps_and_empty_inputs(self):
        with self.assertRaises(ValueError):
            build_schedule([], self.configs, 1, self.seed)
        with self.assertRaises(ValueError):
            build_schedule(["t1"], [], 1, self.seed)
        with self.assertRaises(ValueError):
            build_schedule(["t1"], self.configs, 0, self.seed)
        with self.assertRaises(ValueError):
            build_schedule(["t1"], ["baseline", ""], 1, self.seed)
        with self.assertRaises(ValueError):
            build_schedule(["t1"], self.configs, True, self.seed)

    def test_build_schedule_rejects_names_that_break_paths_or_protocol(self):
        invalid_names = [
            "",
            ".",
            "..",
            "../t1",
            "nested/t1",
            "t1:rep0",
            "two words",
            "t1\nnext",
        ]
        for name in invalid_names:
            with self.subTest(task=name), self.assertRaises(ValueError):
                build_schedule([name], self.configs, 1, self.seed)
            with self.subTest(config=name), self.assertRaises(ValueError):
                build_schedule(["t1"], [name], 1, self.seed)

    def test_build_schedule_rejects_invalid_collection_types_and_seed(self):
        with self.assertRaises(ValueError):
            build_schedule("t1", self.configs, 1, self.seed)
        with self.assertRaises(ValueError):
            build_schedule(["t1"], "baseline", 1, self.seed)
        with self.assertRaises(ValueError):
            build_schedule(["t1", 2], self.configs, 1, self.seed)
        with self.assertRaises(ValueError):
            build_schedule(["t1"], ["baseline", None], 1, self.seed)
        with self.assertRaises(ValueError):
            build_schedule(["t1"], self.configs, 1, "")
        with self.assertRaises(ValueError):
            build_schedule(["t1"], self.configs, 1, "seed\nnext")

if __name__ == "__main__":
    unittest.main()
