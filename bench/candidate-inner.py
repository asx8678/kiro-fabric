#!/usr/bin/env python3
"""Duplicate the bootstrap socket inside the sandbox, then exec Pi."""
import os
import sys

if len(sys.argv) < 2:
    raise SystemExit("candidate-inner.py: missing command")
os.dup2(0, 3, inheritable=True)
os.execvp(sys.argv[1], sys.argv[1:])
