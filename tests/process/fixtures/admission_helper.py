#!/usr/bin/env python3
"""Finite PROC-0 admission helper.

Three modes:

  pass            -> exits 0
  specified-fail  -> exits 1 and prints the named expected failure assertion
  barrier         -> bounded owned-file barrier for a later L3 ticket

The helper is tool self evidence, not a product stand-in.  It never forks, it
never opens a socket, it never imports product code, it never touches a model,
a Host or a browser, and it writes nothing outside the root it was bound to.

The barrier mode is written for the later L3 ticket only.  It is never executed
during the L1 bootstrap; the direct tests only inspect its pure validation
helper.  The barrier never turns the passage of time into a resource fact: it
either observes the release file or it exits with its own bounded failure.

Run with:
    python3.12 -I -S -B tests/process/fixtures/admission_helper.py pass
    python3.12 -I -S -B tests/process/fixtures/admission_helper.py specified-fail
    python3.12 -I -S -B tests/process/fixtures/admission_helper.py barrier <root> <name> <seconds>
"""

import sys
import time
from pathlib import Path

EXPECTED_FAILURE_ASSERTION = "TOOL_HELPER_EXPECTED_FAILURE"
PASS_ASSERTION = "ADMISSION_HELPER_PASS"
INVALID_MODE = "INVALID_HELPER_MODE"
BARRIER_ROOT_MARKER = "/var/"
BARRIER_EXIT_RELEASED = 0
BARRIER_EXIT_TIMEOUT = 3

MODES = ("pass", "specified-fail", "barrier")


def resolve_barrier_root(root):
    """Validate a bounded barrier root.  Pure: it creates and reads nothing."""
    if not isinstance(root, str) or not root:
        raise ValueError("INVALID_BARRIER_ROOT")
    candidate = Path(root)
    if not candidate.is_absolute():
        raise ValueError("BARRIER_ROOT_NOT_ABSOLUTE")
    if BARRIER_ROOT_MARKER not in str(candidate) + "/":
        raise ValueError("BARRIER_ROOT_OUTSIDE_VAR")
    return str(candidate)


def run_barrier(argv):
    """Bounded owned-file barrier.  L3 only: never executed during L1.

    The helper owns <root>/<name>.held and waits for <root>/<name>.release.
    It exits 0 only after it observed the release file, and it exits 3 with its
    own bounded failure when the hold window elapsed.  A timeout is the
    helper's own failure, never proof that another process disappeared.
    """
    if len(argv) < 4:
        sys.stderr.write(INVALID_MODE + "\n")
        return 2
    try:
        root = resolve_barrier_root(argv[2])
    except ValueError as error:
        sys.stderr.write(str(error) + "\n")
        return 2
    name = argv[3]
    if not name or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
                        for ch in name):
        sys.stderr.write("INVALID_BARRIER_NAME\n")
        return 2
    try:
        hold = float(argv[4]) if len(argv) > 4 else 5.0
    except ValueError:
        sys.stderr.write("INVALID_BARRIER_HOLD\n")
        return 2
    base = Path(root)
    held = base / (name + ".held")
    release = base / (name + ".release")
    try:
        base.mkdir(parents=True, exist_ok=True)
        held.write_text("held\n", encoding="utf-8")
    except OSError as error:
        sys.stderr.write("BARRIER_ROOT_NOT_WRITABLE:%s\n" % type(error).__name__)
        return 2
    deadline = time.monotonic() + hold
    observed = False
    while time.monotonic() < deadline:
        if release.exists():
            observed = True
            break
        time.sleep(0.05)
    try:
        held.unlink()
    except OSError:
        pass
    if not observed:
        sys.stdout.write("BARRIER_HOLD_EXPIRED\n")
        return BARRIER_EXIT_TIMEOUT
    sys.stdout.write("BARRIER_RELEASED\n")
    return BARRIER_EXIT_RELEASED


def main(argv):
    if len(argv) < 2:
        sys.stderr.write(INVALID_MODE + "\n")
        return 2
    mode = argv[1]
    if mode == "pass":
        sys.stdout.write(PASS_ASSERTION + "\n")
        return 0
    if mode == "specified-fail":
        sys.stdout.write(EXPECTED_FAILURE_ASSERTION + "\n")
        sys.stderr.write(EXPECTED_FAILURE_ASSERTION + "\n")
        return 1
    if mode == "barrier":
        return run_barrier(argv)
    sys.stderr.write(INVALID_MODE + "\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
