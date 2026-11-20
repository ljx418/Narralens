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
during the L1 bootstrap; the direct tests only inspect its pure validators.  The
barrier never turns the passage of time into a resource fact: it either
observes the release marker or it exits with its own bounded failure.

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
BARRIER_MARKER = "/var/process-admission/selftest/"
BARRIER_EXIT_RELEASED = 0
BARRIER_EXIT_TIMEOUT = 3

MODES = ("pass", "specified-fail", "barrier")


def resolve_barrier_root(root):
    """Validate a bounded barrier root.  Pure: it creates and reads nothing.

    The root must be an absolute path inside the current project's own
    var/process-admission/selftest area.  Anything outside it, or a link that
    escapes it, is refused.
    """
    if not isinstance(root, str) or not root:
        raise ValueError("INVALID_BARRIER_ROOT")
    candidate = Path(root)
    if not candidate.is_absolute():
        raise ValueError("BARRIER_ROOT_NOT_ABSOLUTE")
    text = str(candidate)
    if BARRIER_MARKER not in text + "/":
        raise ValueError("BARRIER_ROOT_OUTSIDE_SELFTEST")
    if candidate.is_symlink():
        raise ValueError("BARRIER_ROOT_IS_A_LINK")
    return str(candidate)


def validate_barrier_markers(root, name):
    """The markers of this barrier name must be free before the run starts.

    An existing held or release marker means another run already owns this
    name, so the barrier must not reuse it.
    """
    if not isinstance(name, str) or not name:
        raise ValueError("INVALID_BARRIER_NAME")
    if not all(ch.isalnum() or ch in "-_" for ch in name):
        raise ValueError("INVALID_BARRIER_NAME")
    held = Path(root) / (name + ".held")
    release = Path(root) / (name + ".release")
    if held.exists():
        raise ValueError("BARRIER_HELD_MARKER_EXISTS")
    if release.exists():
        raise ValueError("BARRIER_RELEASE_MARKER_EXISTS")
    return held, release


def validate_barrier_hold(seconds):
    """A finite, strictly positive hold window."""
    try:
        value = float(seconds)
    except (TypeError, ValueError):
        raise ValueError("BARRIER_HOLD_NOT_A_NUMBER")
    if value != value or value in (float("inf"), float("-inf")):
        raise ValueError("BARRIER_HOLD_NOT_FINITE")
    if value <= 0:
        raise ValueError("BARRIER_HOLD_NOT_POSITIVE")
    return value


def run_barrier(argv):
    """Bounded owned-file barrier.  L3 only: never executed during L1.

    The helper owns <root>/<name>.held and waits for <root>/<name>.release.
    It exits 0 only after it observed the release file, and it exits 3 with
    its own bounded failure when the hold window elapsed.
    """
    if len(argv) < 4:
        sys.stderr.write(INVALID_MODE + "\n")
        return 2
    try:
        root = resolve_barrier_root(argv[2])
        held, release = validate_barrier_markers(root, argv[3])
        hold = validate_barrier_hold(argv[4] if len(argv) > 4 else 5.0)
    except ValueError as error:
        sys.stderr.write(str(error) + "\n")
        return 2
    try:
        held.parent.mkdir(parents=True, exist_ok=True)
        with held.open("x") as handle:
            handle.write("held\n")
    except OSError as error:
        sys.stderr.write("BARRIER_MARKER_NOT_EXCLUSIVE:%s\n" % type(error).__name__)
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
    except OSError as error:
        sys.stderr.write("BARRIER_CLEANUP_FAILED:%s\n" % type(error).__name__)
        return 2
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
