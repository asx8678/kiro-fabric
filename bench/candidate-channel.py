#!/usr/bin/env python3
"""Relay a one-shot treatment and write-only telemetry over a socketpair."""
import socket
import subprocess
import sys


def main():
    if len(sys.argv) < 4:
        raise SystemExit("usage: candidate-channel.py TELEMETRY TREATMENT COMMAND...")
    telemetry, treatment, *command = sys.argv[1:]
    controller, candidate = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        process = subprocess.Popen(command, stdin=candidate)
    finally:
        candidate.close()
    try:
        controller.sendall(treatment.encode("utf-8"))
        controller.shutdown(socket.SHUT_WR)
        with open(telemetry, "ab", buffering=0) as output:
            while True:
                chunk = controller.recv(64 * 1024)
                if not chunk:
                    break
                output.write(chunk)
    finally:
        controller.close()
    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
