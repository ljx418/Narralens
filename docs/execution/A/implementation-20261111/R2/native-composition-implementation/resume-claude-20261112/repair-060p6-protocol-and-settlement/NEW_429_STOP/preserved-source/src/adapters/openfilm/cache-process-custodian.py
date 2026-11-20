#!/usr/bin/env python3.12
# -*- coding: utf-8 -*-
"""The custodian of ONE native cache draw.

It is a process of its own, OUTSIDE the process group of the draw it watches, and
it is the ONLY wait owner of that draw's process tree.

The topology it exists for:

    Host  ->  C (this custodian; own SID/PGID)  ->  N (the Node worker; own
    SID/PGID)  ->  Chrome and everything under it (they inherit N)

The pinned upstream draws a page's picture in a headless browser, and nothing about
the upstream's API says whether the work behind a picture really ended. A resolved
promise is not a proof. The Host therefore asks a process it can watch to ask the
browser's own process group to stop - and that process has to survive the stop to
be able to REAP what the stop leaves behind.

A subreaper inside the worker cannot do this: a worker that is SIGKILLed cannot
reap anything afterwards, and the browser it started outlives it as an orphan. So
the reaper lives OUTSIDE the group it reaps, exactly like the custodian does.

What this program guarantees, and what it does not:

  - The Host starts this program DETACHED: it is the leader of its own session and
    its own group before its first instruction runs. This program VERIFIES that
    (its own pid is its own pgid and its own sid) and refuses to run otherwise.
    It never calls setsid() on itself: it is already a session leader, and a
    second setsid() would fail with EPERM.
  - It sets PR_SET_CHILD_SUBREAPER before it forks anything, and it verifies the
    setting with PR_GET_CHILD_SUBREAPER. If the kernel does not have it, it says
    so and does not fork.
  - It is the ONLY process that waits for the worker and for the descendants the
    worker orphaned. It never uses waitpid(-1) while the worker's own anchor is
    held, because that would reap the anchor and lose the number.
  - It keeps the worker's exit visible WITHOUT reaping it (waitid with WNOWAIT)
    until every group signal that is still needed has been sent, and it reaps the
    worker LAST.
  - It never trusts a number it did not read from the kernel. A process it cannot
    read is UNKNOWN, and UNKNOWN is never "gone".
  - It is not a sandbox against malicious native code, and it is not a promise for
    platforms other than Linux.

The host never puts a ticket in this program's arguments, in its environment or in
its output. The ticket of a draw travels over the private socket this program
inherits as its file descriptor 4.

This module may be IMPORTED without any side effect: nothing is forked, no signal
is installed and no prctl is called at import time. Every one of those happens
inside `Custodian.run()`.
"""

from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
import select
import selectors
import signal
import struct
import sys
import time

# ---------------------------------------------------------------------------
# The fixed facts of this program. They are constants, not options: nothing that
# arrives over a socket may change them.
# ---------------------------------------------------------------------------

PROTOCOL = "narralens.openfilm-cache-process@3"

#: The draw socket: the Host writes to it, the worker reads from it.
DRAW_FD = 3
#: The control socket: this program and the Host speak on it.
CONTROL_FD = 4

#: The frame header is a four byte length, and the length is checked BEFORE the
#: payload is read. A frame that claims more than the limit is refused.
FRAME_HEADER = 4
MAX_CONTROL_FRAME = 64 * 1024
#: The unconsumed bytes of the control channel never exceed this.
MAX_CONTROL_BUFFER = MAX_CONTROL_FRAME + FRAME_HEADER

#: The environment the worker is given. It is an ALLOWLIST and not the
#: environment of this program: a variable that could change how the worker's own
#: code runs - NODE_OPTIONS above all - is never passed on. The HOME and the XDG
#: names in it are the PRIVATE ones of this draw: the Host has already pointed
#: them at a run directory that belongs to this draw alone.
WORKER_ENV_NAMES = (
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    "PLAYWRIGHT_BROWSERS_PATH",
    "SYSTEMROOT",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
)

#: How long the group may take to answer the polite signal, and how long the hard
#: signal may take to be confirmed. These are ACTION deadlines: they never mean
#: "settled".
TERM_GRACE_SECONDS = 3.0
KILL_CONFIRM_SECONDS = 15.0
#: How long the whole two level startup chain may take: the custodian AND the
#: worker. It is ONE budget from ONE starting point, never one per step.
READY_SECONDS = 30.0
#: How long the loop waits for something to happen before it looks at its
#: deadlines again.
POLL_SECONDS = 0.02
#: The bounded facts of the signals that were dispatched or refused. The
#: retained history NEVER grows without a bound: the first facts and the most
#: recent ones are kept, and the rest is COUNTED.
MAX_RETAINED_SIGNAL_FACTS = 32
#: How much of a stream is read in ONE round of the loop. A stream that floods
#: must never starve the selector, the timers or the waiting.
STREAM_ROUND_BYTES = 64 * 1024

#: The prctl numbers. They are the Linux ones; the headers were checked
#: statically. Whether the running kernel honours them is proven at runtime, by
#: this program, before anything is forked.
PR_SET_CHILD_SUBREAPER = 36
PR_GET_CHILD_SUBREAPER = 37

#: The identities this program records. More than this many is a failure, not a
#: reason to keep growing.
MAX_IDENTITY_RECORDS = 512

#: How much of a diagnostic is kept.
DIAGNOSTIC_TAIL_BYTES = 8 * 1024
#: How much a stream may write in total.
MAX_STREAM_BYTES = 64 * 1024

#: The control queue: bounded frames, bounded bytes, and a reserve of its own for
#: the final receipt, which may not be lost to a full queue.
CONTROL_QUEUE_FRAMES = 16
CONTROL_QUEUE_BYTES = 256 * 1024
CONTROL_RESERVE_FRAMES = 1
CONTROL_RESERVE_BYTES = 16 * 1024

#: How many events the receipt carries. A draw that needed more says so, and the
#: receipt of such a draw may not be used as a proof.
MAX_EVENT_RECORDS = 256

#: The version of the private receipt of this protocol.
#:
#: Every RECEIPT_SEGMENT and every DOMAIN_REAPED carries it, and the Host
#: refuses a receipt that does not: there is NO fallback to an older one, and
#: the two ends are released together.
RECEIPT_VERSION = 2

#: The two kinds of proof that a receipt may carry.
#:
#: ``complete-v2``        the complete bounded facts of a draw that really
#:                        ended. It may carry a creative result.
#: ``failed-terminal-v1`` the bounded certificate that the resources of a
#:                        FAILED draw really ended. It NEVER carries an image,
#:                        and the Host may not deliver one because of it.
PROOF_COMPLETE = "complete-v2"
PROOF_FAILED_TERMINAL = "failed-terminal-v1"

#: The startup kinds of a draw, as the ACTUAL facts of this program are.
#:
#: ``custodian-unauthed``      the Host never authorised a fork: this program
#:                              knows no draw and no ticket.
#: ``authorized-fork-failed``   the binding was sealed and the fork really
#:                              failed: there is no child.
#: ``forked-setup-failed``      the fork really returned a child and its setup
#:                              really failed.
#: ``forked-exec-succeeded``    the fork really returned a child and its exec
#:                              really worked.
STARTUP_UNAUTHED = "custodian-unauthed"
STARTUP_FORK_FAILED = "authorized-fork-failed"
STARTUP_SETUP_FAILED = "forked-setup-failed"
STARTUP_EXEC_SUCCEEDED = "forked-exec-succeeded"

#: The stages of the setup of the child, as the child itself reports them.
#:
#: The stage matters: a setsid that failed and an exec that failed may carry
#: the SAME errno, and they are two different facts.
SETUP_STAGE_SETSID = "setsid"
SETUP_STAGE_STDIO = "stdio"
SETUP_STAGE_EXEC = "exec"

#: The bound of the structured setup records of the exec pipe: at most two
#: records, and at most this many bytes in total.
MAX_SETUP_RECORDS = 2
MAX_SETUP_BYTES = 512

#: The dispositions of a stream of the worker.
#:
#: ``not-opened``                  the descriptor was never obtained: there is
#:                                 nothing to read and nothing to close.
#: ``never-inherited-and-closed``  the descriptor was obtained before the fork
#:                                 and it was really closed once; it was never
#:                                 inherited by a child.
#: ``eof``                         the end of the file was really read.
#: ``read-failed-and-reader-closed``  the read failed and the reader was
#:                                 really closed once, with no live writer.
STREAM_NOT_OPENED = "not-opened"
STREAM_NEVER_INHERITED = "never-inherited-and-closed"
STREAM_EOF = "eof"
STREAM_READ_FAILED = "read-failed-and-reader-closed"

#: The states of this program, in the order they are entered.
#:
#: ``RUNNING``       the draw is going on and the control channel is read.
#: ``SETTLING``      the domain is being stopped and reaped.
#: ``RECOVERY_HELD`` the domain could not be proven gone: this program KEEPS the
#:                   anchor of the worker, the fork facts and the control
#:                   channel, and it waits - bounded - for a recheck.
#: ``RECEIPT_FLUSH`` the domain is really gone and the receipt is being written.
#: ``EXIT``          this program is leaving.
STATE_RUNNING = "running"
STATE_SETTLING = "settling"
STATE_RECOVERY_HELD = "recovery_held"
STATE_RECEIPT_FLUSH = "receipt_flush"
STATE_EXIT = "exit"

#: How long the recovery waits between its own rechecks. It is a poll and not a
#: busy loop.
#:
#: There is NO expiry of the RESPONSIBILITY. The actions of the settlement are
#: bounded and this poll is bounded, but while the domain may still be there,
#: this program keeps the anchor of the worker, the fork facts and the original
#: failure - and it does not leave. A finite budget of the RESPONSIBILITY would
#: be a way of dropping a wait owner while its group may still be alive.
RECOVERY_POLL_SECONDS = 0.5

#: How long the receipt may take to be written. It is a real deadline and not a
#: number of tries: a socket that stays full must not hold this program for
#: ever.
RECEIPT_FLUSH_SECONDS = 15.0
#: How many bytes of items one receipt segment carries. The frame of the segment
#: stays far below the 16KiB that a segment may never reach.
RECEIPT_SEGMENT_ITEMS_BYTES = 8 * 1024
#: The hard limit of one receipt segment. A segment that reaches it is refused.
RECEIPT_SEGMENT_MAX_BYTES = 16 * 1024


class CustodianFailure(Exception):
    """A failure of this program itself. It is reported and it ends the draw."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# The kernel, as this program asks it questions. Every answer is one of three
# things, and the difference matters everywhere below.
# ---------------------------------------------------------------------------


def parse_proc_stat(text: str) -> dict | None:
    """Parse one /proc/<pid>/stat text.

    The layout is ``pid (comm) state ppid pgrp session ...``. The command name may
    hold spaces AND parentheses, so the fields after it are read from the LAST
    closing parenthesis - and the PID is the number BEFORE the FIRST opening one.
    The field right after the closing parenthesis is the STATE (S, R, Z, ...); it
    is a state and never a number.
    """
    head = text.find("(")
    cut = text.rfind(")")
    if head < 0 or cut < 0 or cut < head:
        return None
    try:
        pid = int(text[:head].strip())
    except ValueError:
        return None
    fields = text[cut + 1 :].split()
    if len(fields) < 20:
        return None
    state = fields[0]
    try:
        ppid = int(fields[1])
        pgid = int(fields[2])
        sid = int(fields[3])
        start_ticks = int(fields[19])
    except ValueError:
        return None
    return {
        "pid": pid,
        "ppid": ppid,
        "pgid": pgid,
        "sid": sid,
        "start_ticks": start_ticks,
        "state": state,
    }


def read_process_identity(pid: int) -> tuple[dict | None, str]:
    """Read one process identity.

    The state is one of:

      - ``gone``    the kernel says the process does not exist (ENOENT),
      - ``known``   the kernel says exactly what it is,
      - ``unknown`` the kernel could not be asked, or answered something this
                    program could not read. UNKNOWN is never "gone".
    """
    if pid <= 0:
        return None, "gone"
    try:
        with open("/proc/%d/stat" % pid, "rb") as handle:
            text = handle.read().decode("utf-8", "replace")
    except FileNotFoundError:
        return None, "gone"
    except OSError as error:
        if error.errno == errno.ESRCH:
            return None, "gone"
        return None, "unknown"
    identity = parse_proc_stat(text)
    if identity is None:
        return None, "unknown"
    return identity, "known"


def direct_children() -> list[int] | None:
    """The direct children of this process, as the kernel lists them.

    None means the kernel could not be asked: an empty list would be a claim that
    there are none, and that claim is not made when the question was not answered.
    """
    try:
        with open("/proc/self/task/%d/children" % os.getpid(), "rb") as handle:
            text = handle.read().decode("ascii", "replace")
    except OSError:
        return None
    children: list[int] = []
    for piece in text.split():
        try:
            children.append(int(piece))
        except ValueError:
            continue
    return children


def group_members(pgid: int) -> list[dict] | None:
    """The members of a process group, as the kernel lists them.

    None means the group could not be enumerated: the process list could not be
    read, or the state of one of the processes could not be read. A process that
    could not be read MAY be a member of this group, and an unknown group is
    never an empty one.
    """
    try:
        names = os.listdir("/proc")
    except OSError:
        return None
    members: list[dict] = []
    for name in names:
        if not name.isdigit():
            continue
        identity, state = read_process_identity(int(name))
        if state == "unknown":
            return None
        if state != "known" or identity is None:
            continue
        if int(identity["pgid"]) == int(pgid):
            members.append(identity)
    return members


def group_state(pgid: int) -> str:
    """Whether a process group still exists: ``present``, ``gone`` or ``unknown``.

    A group that does not exist is ``gone`` - that is the ONLY answer that means
    gone. Every other error is ``unknown``: it is not a proof of anything.
    """
    if pgid <= 1:
        return "unknown"
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return "gone"
    except PermissionError:
        return "present"
    except OSError:
        return "unknown"
    return "present"


def signal_group(pgid: int, number: int) -> str:
    """Signal a whole process group. The group is the unit, never a bare pid.

    The answer is one of ``sent``, ``gone`` and ``failed``: a signal that could
    not be delivered is never reported as a delivery.
    """
    if pgid <= 1:
        return "failed"
    try:
        os.killpg(pgid, number)
    except ProcessLookupError:
        return "gone"
    except PermissionError:
        return "failed"
    except OSError:
        return "failed"
    return "sent"


def signal_pid(pid: int, number: int) -> str:
    """Signal ONE process. It is used when a group may not be aimed at."""
    if pid <= 1:
        return "failed"
    try:
        os.kill(pid, number)
    except ProcessLookupError:
        return "gone"
    except PermissionError:
        return "failed"
    except OSError:
        return "failed"
    return "sent"


def custodian_is_isolated(identity: dict | None) -> bool:
    """Whether this program is the leader of its own session and its own group.

    The Host starts it DETACHED, so this is true before the first instruction
    runs. A custodian that shares the group of the Host is INSIDE the group it
    has to reap, and it refuses to run.
    """
    if not isinstance(identity, dict):
        return False
    try:
        return int(identity["pgid"]) == int(identity["pid"]) and int(identity["sid"]) == int(identity["pid"])
    except (KeyError, TypeError, ValueError):
        return False


def status_of(status: int) -> dict:
    """One wait status, as a bounded record."""
    if os.WIFEXITED(status):
        return {"kind": "exited", "code": os.WEXITSTATUS(status)}
    if os.WIFSIGNALED(status):
        return {"kind": "signaled", "signal": os.WTERMSIG(status)}
    return {"kind": "unknown"}


# ---------------------------------------------------------------------------
# The prctl call. The GET of PR_GET_CHILD_SUBREAPER takes a POINTER to an int,
# and the value it writes is an int - not a long, and not an integer passed by
# value. The two forms are separated here so that the conversion can be checked
# without the kernel.
# ---------------------------------------------------------------------------


def prctl_bind(libc):
    """Bind ``prctl`` with the conversion it really needs.

    ``prctl`` is variadic in the C library. Its second argument is an
    ``unsigned long`` for the SET and a POINTER TO AN INT for the GET, and the
    value the GET writes is an ``int``. The default conversion of ctypes passes
    a Python integer as a C int and a ctypes pointer as a pointer, which is
    exactly the shape the two calls want - so no conversion is declared here,
    and the shape of every argument is checked where it is used.
    """
    prctl = libc.prctl
    prctl.argtypes = None
    prctl.restype = ctypes.c_int
    return prctl


def prctl_get_arg2(value: ctypes.c_int) -> ctypes.POINTER(ctypes.c_int):
    """The second argument of PR_GET_CHILD_SUBREAPER: a pointer to a c_int."""
    return ctypes.pointer(value)


def prctl_set_child_subreaper(prctl) -> int:
    """Ask the kernel to make this process the reaper of its own orphans.

    The second argument is the plain integer one: the SET wants the VALUE.
    """
    return prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)


def prctl_get_child_subreaper(prctl) -> tuple[bool, int]:
    """Read PR_GET_CHILD_SUBREAPER back, through the pointer it really takes.

    The callable is a parameter so that the CONVERSION can be checked without the
    kernel: the callable receives the pointer and writes through it.
    """
    value = ctypes.c_int(0)
    if prctl(PR_GET_CHILD_SUBREAPER, prctl_get_arg2(value), 0, 0, 0) != 0:
        return False, ctypes.get_errno()
    return value.value == 1, 0


# ---------------------------------------------------------------------------
# The frames of the control channel.
# ---------------------------------------------------------------------------


def encode_frame(payload: dict) -> bytes:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_CONTROL_FRAME:
        raise CustodianFailure("FRAME_TOO_LARGE", "a control frame is too large")
    return struct.pack(">I", len(body)) + body


def encode_setup_record(stage: str, ok: bool, code: int | None, session: bool) -> bytes:
    """One structured setup record, as the child writes it into the pipe.

    The STAGE is part of the record: a setsid that failed and an exec that
    failed may carry the same errno, and they are two different facts.
    """
    record = {
        "stage": stage,
        "ok": bool(ok),
        "errno": None if code is None else int(code),
        "session_established": bool(session),
    }
    return (json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def decode_setup_records(data: bytes) -> tuple[list[dict], bool]:
    """The structured setup records of the pipe, and whether they were legal.

    A record that cannot be parsed, a pipe that is too long and a record that
    is too many are a setup that is UNKNOWN: they are never read as a success.
    """
    records: list[dict] = []
    total = 0
    for line in data.split(b"\n"):
        text = line.strip()
        if not text:
            continue
        total += len(text) + 1
        if total > MAX_SETUP_BYTES or len(records) >= MAX_SETUP_RECORDS:
            return records, False
        try:
            record = json.loads(text.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return records, False
        if not isinstance(record, dict):
            return records, False
        records.append(record)
    return records, True


def classify_setup(records: list[dict], legal: bool) -> dict:
    """What the setup of the child REALLY was.

    The EOF of the pipe is the proof that the exec worked, and only together
    with the marker that says that the session was really established: an
    isolated EOF, a broken record and a bare errno are all UNKNOWN.
    """
    failure: dict | None = None
    session = False
    for record in records:
        stage = record.get("stage")
        ok = record.get("ok") is True
        if record.get("session_established") is True:
            session = True
        if not ok and failure is None and stage in (SETUP_STAGE_SETSID, SETUP_STAGE_STDIO, SETUP_STAGE_EXEC):
            code = record.get("errno")
            failure = {
                "ok": False,
                "stage": stage,
                "errno": int(code) if isinstance(code, int) else errno.EIO,
                "session_established": bool(record.get("session_established") is True),
            }
    if failure is not None:
        return failure
    if not legal:
        return {"ok": False, "stage": None, "errno": errno.EIO, "session_established": session}
    if not session:
        # The exec closed the pipe, but the session was never established: the
        # setup is UNKNOWN, and it is not a success.
        return {"ok": False, "stage": None, "errno": errno.EIO, "session_established": False}
    return {"ok": True, "stage": SETUP_STAGE_EXEC, "errno": None, "session_established": True}


class FrameDecoder:
    """An incremental, BOUNDED decoder.

    The header is checked as soon as it arrives - before the payload is read -
    and the unconsumed bytes never exceed the limit of the channel. A frame that
    claims more than the limit is refused; it is never truncated and accepted.
    """

    def __init__(self, max_frame: int, max_buffer: int) -> None:
        self._buffer = bytearray()
        self._max_frame = max_frame
        self._max_buffer = max_buffer

    @property
    def pending(self) -> int:
        """How many bytes are waiting to be consumed."""
        return len(self._buffer)

    def feed(self, data: bytes) -> list[dict]:
        """Take these bytes and give back the frames that are complete."""
        self._buffer.extend(data)
        if len(self._buffer) > self._max_buffer:
            raise CustodianFailure("BUFFER_OVERFLOW", "the unconsumed bytes of the channel exceed the limit")
        frames: list[dict] = []
        while True:
            if len(self._buffer) < FRAME_HEADER:
                break
            length = struct.unpack(">I", bytes(self._buffer[:FRAME_HEADER]))[0]
            if length > self._max_frame:
                raise CustodianFailure("FRAME_TOO_LARGE", "a frame of the channel is too large")
            if len(self._buffer) < FRAME_HEADER + length:
                break
            body = bytes(self._buffer[FRAME_HEADER : FRAME_HEADER + length])
            del self._buffer[: FRAME_HEADER + length]
            try:
                message = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise CustodianFailure("FRAME_MALFORMED", "a frame of the channel is not JSON")
            if not isinstance(message, dict):
                raise CustodianFailure("FRAME_MALFORMED", "a frame of the channel is not an object")
            frames.append(message)
        return frames


class ControlWriter:
    """The bounded, NON BLOCKING writer of the control channel.

    Three things matter here and each of them was a bug once:

      - a SHORT write keeps the tail. The frame is NOT removed until all of it
        was written, and the offset of the frame is where the next attempt starts.
      - the REMAINING bytes are what is counted. A frame that was half written
        occupies half of the budget, not all of it.
      - the FINAL receipt has a reserve of its own: a frame slot and a byte
        reserve that the ordinary frames may never use.
    """

    def __init__(
        self,
        fd: int,
        max_frames: int = CONTROL_QUEUE_FRAMES,
        max_bytes: int = CONTROL_QUEUE_BYTES,
        reserve_frames: int = CONTROL_RESERVE_FRAMES,
        reserve_bytes: int = CONTROL_RESERVE_BYTES,
        write=None,
    ) -> None:
        self._fd = fd
        self._frames: list[list] = []
        self._remaining = 0
        self._max_frames = max_frames
        self._max_bytes = max_bytes
        self._reserve_frames = reserve_frames
        self._reserve_bytes = reserve_bytes
        self._write = write
        #: A frame was refused: the queue was full. A refused receipt may not be
        #: reported as a success.
        self.lost = False
        #: The channel is gone: nothing more will ever be written.
        self.broken = False

    @property
    def pending(self) -> bool:
        """Whether something is waiting to be written."""
        return bool(self._frames)

    @property
    def fd(self) -> int:
        """The descriptor this writer REALLY writes to.

        It is the ONE descriptor of the control channel: the wait for a
        writable socket watches exactly this one, and not another fd that
        happens to exist.
        """
        return self._fd

    @property
    def remaining(self) -> int:
        """How many bytes are still unwritten."""
        return self._remaining

    def queue(self, body: bytes, reserved: bool = False) -> bool:
        """Put one frame on the channel. It never blocks and it never grows."""
        if reserved:
            if len(body) > self._reserve_bytes:
                self.lost = True
                return False
            frame_limit = self._max_frames
            byte_limit = self._max_bytes
        else:
            frame_limit = self._max_frames - self._reserve_frames
            byte_limit = self._max_bytes - self._reserve_bytes
        if len(self._frames) >= frame_limit or self._remaining + len(body) > byte_limit:
            self.lost = True
            return False
        self._frames.append([body, 0])
        self._remaining += len(body)
        return True

    def flush(self) -> None:
        """Write what is queued, as far as the socket lets us."""
        while self._frames:
            frame = self._frames[0]
            body = frame[0]
            offset = frame[1]
            try:
                if self._write is None:
                    sent = os.write(self._fd, body[offset:])
                else:
                    sent = self._write(body[offset:])
            except BlockingIOError:
                return
            except OSError:
                self._frames.clear()
                self._remaining = 0
                self.broken = True
                return
            if sent <= 0:
                return
            offset += sent
            self._remaining -= sent
            if offset >= len(body):
                self._frames.pop(0)
            else:
                frame[1] = offset


# ---------------------------------------------------------------------------
# The settlement of one target domain. The operations it needs are INJECTED, so
# that the ORDER of the waits may be checked without a kernel and without a
# process.
# ---------------------------------------------------------------------------


class TerminationActions:
    """The state of the termination of a domain, and it is NEVER reset.

    The polite signal and the hard signal are ONCE each in the lifetime of a
    draw. A recovery that asks the census again does not send a second polite
    signal - and it does NOT assume that the hard signal was sent either: the
    hard signal that is still OWED is sent, in the same lifetime and with the
    same authority.

    The deadline of an action is the deadline of that ACTION. It is NEVER an
    expiry of the RESPONSIBILITY: a domain that outlives every deadline is
    UNKNOWN, and the anchor of the worker is kept until the domain is really
    gone.
    """

    def __init__(self) -> None:
        #: The polite signal was sent.
        self.term_sent = False
        #: The hard signal was sent.
        self.kill_sent = False
        #: The monotonic deadline of the action that is running.
        self.deadline: float | None = None
        #: The authority to signal the original worker was LOST for ever.
        #:
        #: It is IRREVERSIBLE: a number that was reaped, or a number that
        #: belongs to another process now, may never be aimed at again. The
        #: action that is still OWED stays owed - it is never dropped, and it
        #: is never spent on a substitute.
        self.authority_lost = False


class TargetCensus:
    """What the kernel could say about the targets of the draw, right now.

    It is NOT a list, and that is the whole point of it:

      - ``live``    the targets that are alive and are not yet reapable;
      - ``pending`` the targets that are ZOMBIES: they are not alive any more,
                    but they are resources that still have to be reaped;
      - ``unknown`` whether the kernel could NOT be asked at all.

    An unknown census is NEVER an empty census. It means that the targets MAY
    still be there, and the anchor of the worker may not be released because of
    it: the group signal is aimed at that anchor.
    """

    def __init__(
        self,
        live: list[dict] | None = None,
        pending: list[dict] | None = None,
        unknown: bool = False,
        reasons: list[str] | None = None,
    ) -> None:
        self.live = list(live or [])
        self.pending = list(pending or [])
        self.unknown = bool(unknown)
        self.reasons = list(reasons or [])

    @property
    def settled(self) -> bool:
        """Whether the domain is provably free of LIVE targets.

        A pending zombie does not hold the anchor: it is reaped by its own
        number, and it is not a signal target any more.
        """
        return not self.unknown and not self.live


class SettlementOperations:
    """What the settlement needs from the kernel. The real one is below."""

    def signal_group(self, pgid: int, number: int) -> str:
        raise NotImplementedError

    def signal_pid(self, pid: int, number: int) -> str:
        raise NotImplementedError

    def target_census(self) -> TargetCensus:
        """What the kernel can say about the targets RIGHT NOW."""
        raise NotImplementedError

    def worker_group_id(self) -> int:
        """The group of the worker, when it is really the worker's OWN group.

        It is ZERO when the group may not be aimed at: the identity of the
        worker was not read, or the worker does not lead its own session and
        its own group. A group that is not verified is never signalled.
        """
        return 0

    def reap_adopted(self) -> tuple[list[dict], bool]:
        """Reap whatever of the adopted descendants is reapable.

        The second value says whether the enumeration or the wait was UNKNOWN:
        a list of waits that could not be completed is NOT "there was nothing
        to reap".
        """
        raise NotImplementedError

    def reap_worker(self) -> tuple[dict | None, bool]:
        """Reap the worker ITSELF. It happens LAST, and only once."""
        raise NotImplementedError

    def echild(self) -> bool:
        """Whether this process has no children left at all."""
        raise NotImplementedError

    def group_state(self, pgid: int) -> str:
        raise NotImplementedError

    def anchor_state(self) -> str:
        """The state of the ANCHOR of the worker.

        It is one of ``running``, ``held``, ``reaped`` and ``none``. It is the
        REAL state of the anchor, and it is never a constant: a worker that was
        really reaped is NOT an anchor that is still held.
        """
        return "held"

    def monotonic(self) -> float:
        raise NotImplementedError

    def sleep(self, seconds: float) -> None:
        raise NotImplementedError


class TargetSettlement:
    """The settlement of one target domain: the worker and its descendants.

    The order is fixed and it is not reversed:

      1. the polite signal goes to the GROUP of the worker - and to nothing else,
         and only when that group is really the worker's own and the anchor of
         the worker is really held;
      2. the escalation is decided by ALL of the targets that are alive, not by
         the exit of the worker alone: a grandchild that ignores SIGTERM while the
         worker is already gone still gets the hard signal;
      3. every adopted descendant is reaped BEFORE the worker, and the worker is
         reaped LAST, so that its anchor is held while the signals are still
         needed;
      4. the proof is ECHILD and the group gone and every recorded identity gone.

    The worker is reaped LAST **only when the domain is provably free of live
    targets**. An unknown census, or a target that is still alive, keeps the
    anchor: a worker that is reaped while its group may still be there takes
    the last signal away, and the orphans it leaves are nobody's.
    """

    def __init__(
        self,
        operations: SettlementOperations,
        worker_pid: int,
        group_established: bool,
        group_id: int,
        term_grace: float = TERM_GRACE_SECONDS,
        kill_confirm: float = KILL_CONFIRM_SECONDS,
        poll: float = POLL_SECONDS,
        actions: TerminationActions | None = None,
    ) -> None:
        self._ops = operations
        self._worker_pid = worker_pid
        self._group_established = group_established
        self._group_id = group_id
        self._term_grace = term_grace
        self._kill_confirm = kill_confirm
        self._poll = poll
        #: The state of the termination. It is the SAME object for every pass
        #: of the same lifetime, so a recovery never repeats a signal and never
        #: assumes that a signal was sent.
        self._actions = actions if actions is not None else TerminationActions()
        #: Every signal that was sent, and what the kernel said about it.
        self.signals: list[dict] = []
        #: Every wait that really happened.
        self.waits: list[dict] = []
        #: The order of the operations, so that a test may look at it.
        self.order: list[str] = []
        #: The enumeration or the wait was UNKNOWN at least once.
        self.unknown = False
        #: Why the domain could not be proven gone.
        self.reasons: list[str] = []

    def _signal(self, number: int, label: str) -> str:
        # The authority of the GROUP is ASKED again at every signal: a group
        # that became verifiable in the meantime may be aimed at, and a group
        # that is not verifiable RIGHT NOW is NEVER aimed at. The group that
        # this settlement was constructed with is NOT a fallback: a number
        # that was verified once may not be aimed at because of that, and the
        # exact child is handled instead.
        group_id = self._ops.worker_group_id()
        if isinstance(group_id, int) and group_id > 0:
            self.order.append("signal-group")
            answer = self._ops.signal_group(group_id, number)
        else:
            self.order.append("signal-pid")
            answer = self._ops.signal_pid(self._worker_pid, number)
        self.signals.append({"signal": label, "answer": answer})
        return answer

    def _held(self, reason: str, census: TargetCensus, escalated: bool) -> dict:
        """The result of a settlement that could not be proven.

        The anchor of the worker is HELD: it was not reaped, and it is not
        reaped by anybody else, because this program is the only wait owner of
        the draw. The state of the anchor is the REAL one: a worker that was
        really reaped is not an anchor that is still held.
        """
        self.reasons.append(reason)
        self.reasons.extend(census.reasons)
        anchor = self._ops.anchor_state()
        return {
            "ok": False,
            "reason": reason,
            "unknown": True,
            "anchor_held": anchor != "reaped",
            "anchor_state": anchor,
            "echild": False,
            "group_esrch": False,
            "group_state": "unknown",
            "escalated": escalated,
            "waits": list(self.waits),
            "signals": list(self.signals),
            "reasons": list(self.reasons),
        }

    def run(self) -> dict:
        """Settle the domain and prove it.

        It may be RESUMED, and the actions are the state of ONE lifetime:

          - the polite signal is sent ONCE, and a second TERM would be a signal
            to a group that may not even exist any more;
          - the hard signal is sent ONCE, and it is sent when it is OWED: a
            recovery that finds the domain still alive escalates, because "the
            census was asked again" is NOT "the hard signal was already sent";
          - the deadline of an action is the deadline of that action, and it is
            NEVER an expiry of the responsibility.
        """
        actions = self._actions
        if not actions.term_sent and not actions.authority_lost:
            answer = self._signal(signal.SIGTERM, "SIGTERM")
            if answer == "sent":
                # ONLY a signal that really went out consumes the debt.
                actions.term_sent = True
                actions.deadline = self._ops.monotonic() + self._term_grace
            elif answer.startswith("refused-forbidden:"):
                actions.authority_lost = True
            elif answer == "gone":
                # The target is gone: the polite signal was not needed, and it
                # is not a delivery. The census decides the rest, and the debt
                # is NOT consumed.
                actions.deadline = self._ops.monotonic() + self._term_grace
            else:
                # The polite signal was NOT delivered: the debt is NOT
                # consumed, the deadline is NOT reset, and the domain is HELD.
                # The next pass asks again, with FRESH authority.
                self.reasons.append("the polite signal was not delivered: %s" % answer)
                return self._held("the polite signal was not delivered", TargetCensus(), False)
        escalated = actions.kill_sent
        census = TargetCensus()
        while True:
            census = self._ops.target_census()
            if census.settled:
                break
            self.order.append("reap-adopted")
            waits, unknown = self._ops.reap_adopted()
            self.waits.extend(waits)
            if unknown:
                self.unknown = True
            # The wait is bounded and it is NOT a busy loop: every pass gives
            # the domain its poll, even when the deadline of the action is
            # already spent.
            self._ops.sleep(self._poll)
            if actions.deadline is None or self._ops.monotonic() >= actions.deadline:
                if escalated:
                    # The hard signal did not end it either: this is not a
                    # settlement, and the caller has to keep the responsibility.
                    break
                if actions.authority_lost:
                    # The hard signal is OWED and it may never be sent: the
                    # authority to signal was lost with the anchor. The
                    # EVIDENCE collection is NOT revoked with it: the census
                    # was asked above, and the next pass asks it again. The
                    # RESPONSIBILITY stays here, and the owed action stays owed.
                    self.reasons.append(
                        "the hard signal is owed and the authority to send it was lost for ever")
                    break
                answer = self._signal(signal.SIGKILL, "SIGKILL")
                if answer != "sent":
                    # The hard signal is OWED and it was NOT delivered: the debt
                    # is not consumed, and the deadline is not reset.
                    if answer.startswith("refused-forbidden:"):
                        actions.authority_lost = True
                    else:
                        self.reasons.append("the hard signal was not delivered: %s" % answer)
                        return self._held("the hard signal was not delivered", census, True)
                    escalated = True
                    break
                escalated = True
                actions.kill_sent = True
                actions.deadline = self._ops.monotonic() + self._kill_confirm
        # The domain has to be PROVABLY free: an unknown census, or a target
        # that is still alive, keeps the anchor of the worker.
        if not census.settled:
            reason = "the targets could not be enumerated" if census.unknown else "a target is still alive"
            return self._held(reason, census, escalated)
        # Every adopted descendant is reaped BEFORE the worker.
        while True:
            self.order.append("reap-adopted")
            waits, unknown = self._ops.reap_adopted()
            self.waits.extend(waits)
            if unknown:
                return self._held("the adopted descendants could not be enumerated", census, escalated)
            if not waits:
                break
        # The worker is reaped LAST: its anchor was held while the signals were
        # still needed.
        self.order.append("reap-worker")
        worker_wait, unknown = self._ops.reap_worker()
        if unknown:
            return self._held("the worker could not be reaped", census, escalated)
        if worker_wait is not None:
            self.waits.append(worker_wait)
        echild = self._ops.echild()
        group = self._ops.group_state(self._group_id) if self._group_established else "gone"
        group_gone = group == "gone"
        if not echild:
            self.reasons.append("this process still has children")
        if not group_gone:
            self.reasons.append("the group of the worker is %s" % group)
        return {
            "ok": bool(echild and group_gone),
            "unknown": False,
            "anchor_held": False,
            "echild": bool(echild),
            "group_esrch": bool(group_gone),
            "group_state": group,
            "escalated": escalated,
            "waits": list(self.waits),
            "signals": list(self.signals),
            "reasons": list(self.reasons),
        }


class KernelSettlementOperations(SettlementOperations):
    """The real operations: this process, this machine, these children.

    It is the ONLY place where the kernel is asked, and it is the place where
    an UNKNOWN is carried into the state machine instead of being turned into
    an empty list.

    IT IS ALSO THE ONLY PLACE WHERE A SIGNAL IS DISPATCHED. Every signal is
    checked against the authority of the ORIGINAL fork BEFORE the raw
    ``os.kill`` or ``os.killpg`` is reached: the authority is bound once, it
    is never refreshed by a later observation, and it is revoked for ever when
    the anchor was reaped or when the number belongs to another process now.
    A refused signal never reaches the kernel, and the refusal is a bounded
    fact - never a delivery and never a success.
    """

    def __init__(self, custodian: "Custodian") -> None:
        self._custodian = custodian

    def signal_group(self, pgid: int, number: int) -> str:
        decision = self._custodian._authorise_signal("group", int(pgid))
        if not decision["allowed"]:
            return self._custodian._refusal(decision)
        return signal_group(pgid, number)

    def signal_pid(self, pid: int, number: int) -> str:
        decision = self._custodian._authorise_signal("pid", int(pid))
        if not decision["allowed"]:
            return self._custodian._refusal(decision)
        return signal_pid(pid, number)

    def target_census(self) -> TargetCensus:
        return self._custodian._target_census()

    def worker_group_id(self) -> int:
        """The group of the worker, when it may be aimed at RIGHT NOW."""
        return self._custodian._signal_group_id()

    def reap_adopted(self) -> tuple[list[dict], bool]:
        return self._custodian._reap_adopted()

    def reap_worker(self) -> tuple[dict | None, bool]:
        return self._custodian._reap_worker()

    def echild(self) -> bool:
        return self._custodian._echild()

    def group_state(self, pgid: int) -> str:
        return group_state(pgid)

    def anchor_state(self) -> str:
        """The REAL state of the anchor of the worker."""
        return self._custodian.anchor_state()

    def monotonic(self) -> float:
        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        # The settlement serves the SAME ledger as the running draw: the
        # streams are drained, and the poll is fair - it never starves the
        # control channel, the reaping or the timers.
        self._custodian._service_streams(seconds)


# ---------------------------------------------------------------------------
# The bytes of this program.
# ---------------------------------------------------------------------------


def _open_descriptors() -> list[int]:
    """The descriptors this process has open, as the kernel lists them."""
    try:
        names = os.listdir("/proc/self/fd")
    except OSError:
        return []
    descriptors: list[int] = []
    for name in names:
        try:
            descriptors.append(int(name))
        except ValueError:
            continue
    return descriptors


def _digest_of(path: str) -> str | None:
    """The digest of the bytes of a file, or None when it could not be read."""
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


def _exec_fail(fd: int, stage: str, code: int, session: bool) -> None:
    """Report the failure of the setup to the parent, and only to it."""
    try:
        os.write(fd, encode_setup_record(stage, False, int(code), session))
    except OSError:
        pass


def _exec_note(fd: int, stage: str, ok: bool, code: int | None, session: bool) -> None:
    """Report the progress of the setup to the parent, and only to it."""
    try:
        os.write(fd, encode_setup_record(stage, ok, code, session))
    except OSError:
        pass


def _worker_environment() -> dict:
    """The environment the worker is given: an allowlist of this program's own."""
    environment: dict[str, str] = {}
    for name in WORKER_ENV_NAMES:
        value = os.environ.get(name)
        if isinstance(value, str):
            environment[name] = value
    environment["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] = "1"
    return environment


def descriptors_to_close(open_descriptors: list[int], keep: int) -> list[int]:
    """The descriptors the child closes before its exec.

    Everything above the draw socket is closed - the control channel of the Host
    included - EXCEPT the exec status pipe, which has to stay open until the
    exec itself closes it. A child that closed it would report a successful exec
    that never happened.
    """
    return [fd for fd in open_descriptors if fd > 3 and fd != keep]


def parent_close_set(stdin_read: int, stdout_write: int, stderr_write: int, exec_write: int) -> tuple[int, ...]:
    """The descriptors the parent closes at once, after the fork.

    The exec pipe is one of them: from now on the EOF of that pipe can only come
    from the exec of the child. The draw socket is one of them too: the EOF the
    Host observes has to be the worker's, and not this program's.
    """
    return (stdin_read, stdout_write, stderr_write, exec_write, DRAW_FD)


# ---------------------------------------------------------------------------
# The custodian.
# ---------------------------------------------------------------------------


class OwnedStreamLedger:
    """The facts of ONE stream of the worker, for the WHOLE lifetime.

    Every read, every EOF and every unregistration of this program goes
    through this ledger, and the receipt carries its facts: the number of
    bytes that were REALLY read, the bounded tail, whether the end of the
    file was really seen, the error that stopped the reading, and what
    happened to the descriptor itself.

    The disposition is a FACT and never a default: a stream that was never
    opened is not a stream that reached its end.
    """

    def __init__(self, name: str) -> None:
        self.name = name
        #: ``not-opened`` or ``acquired``: whether this program ever held the
        #: descriptor of this stream.
        self.ownership = "not-opened"
        self.bytes = 0
        self.tail = bytearray()
        self.eof = False
        self.read_error: dict | None = None
        self.disposition = STREAM_NOT_OPENED
        self.closed = False

    def acquired(self) -> None:
        """The descriptor of this stream is really held by this program."""
        self.ownership = "acquired"
        if self.disposition == STREAM_NOT_OPENED:
            self.disposition = "acquired"

    def read(self, data: bytes) -> None:
        """The bytes that were really read."""
        self.bytes += len(data)
        self.tail.extend(data)
        if len(self.tail) > DIAGNOSTIC_TAIL_BYTES:
            del self.tail[: len(self.tail) - DIAGNOSTIC_TAIL_BYTES]

    def mark_eof(self) -> None:
        """The end of the file was really read: it is registered ONCE."""
        if self.eof:
            return
        self.eof = True
        self.disposition = STREAM_EOF

    def mark_read_error(self, error: OSError) -> None:
        """The read failed: it is NOT an end of file, and it is kept."""
        self.read_error = {
            "errno": int(error.errno or errno.EIO),
            "message": str(error)[:256],
        }
        self.disposition = STREAM_READ_FAILED

    def mark_closed_without_inheritance(self) -> None:
        """The descriptor was closed for once, and no child ever inherited it."""
        self.disposition = STREAM_NEVER_INHERITED
        self.eof = False
        self.closed = True

    def mark_closed(self) -> None:
        """The descriptor was really closed once."""
        self.closed = True

    def facts(self) -> dict:
        """The facts of this stream, as the receipt carries them."""
        return {
            "ownership": self.ownership,
            "bytes": self.bytes,
            "tail_bytes": len(self.tail),
            "eof": self.eof,
            "read_error": self.read_error,
            "disposition": self.disposition,
        }


class Custodian:
    """The reaper of one draw."""

    def __init__(self) -> None:
        self.draw_id = ""
        self.ticket_digest = ""
        self.worker_pid = 0
        self.worker_identity: dict | None = None
        #: The ORIGINAL epoch of the worker: the identity of the fork, bound
        #: ONCE. It is never replaced by a later observation, and it is the
        #: ONLY thing that may be aimed at.
        self.original_worker_epoch: dict | None = None
        #: The LAST observation of the worker. It is a SNAPSHOT of what the
        #: kernel says right now, and it never changes what the fork was.
        self.current_worker_observation: dict | None = None
        #: The authority to signal the original worker: ``unbound``, ``bound``
        #: or ``revoked``. The revocation is IRREVERSIBLE.
        self.signal_authority = "unbound"
        self.signal_authority_reason: str | None = None
        self.anchor_held = False
        self.anchor_reaped = False
        #: The identities of the TARGETS: the worker and its descendants. The
        #: identity of THIS program is NOT one of them: a custodian that is alive
        #: while it proves that the domain is gone can never be part of it.
        self.identities: dict[int, dict] = {}
        #: How every RETAINED epoch ENDED, by its number.
        #:
        #: ``waited-by-custodian``       this program really waited for it.
        #: ``parent-reaped-observed-gone`` the ORIGINAL parent reaped it, and
        #:                                the epoch was really observed gone.
        #: ``unknown``                    nothing proved how it ended.
        self._completions: dict[int, str] = {}
        self.custodian_identity: dict | None = None
        #: The FIRST bounded facts of the signals that were dispatched or
        #: refused.
        self.signals: list[str] = []
        #: The MOST RECENT bounded facts of the signals.
        self._recent_signals: list[str] = []
        #: How many signal facts were REALLY produced, including the ones that
        #: did not fit: the saturation is COUNTED and never hidden.
        self.signal_facts_total = 0
        #: The retained history did not fit: the receipt says so, and it may
        #: not be used as a complete proof.
        self.signal_facts_saturated = False
        self.waits: list[dict] = []
        self.stdout_bytes = 0
        self.stderr_bytes = 0
        self.stdout_tail = bytearray()
        self.stderr_tail = bytearray()
        self.diagnostics_lost = False
        self._events: list[str] = []
        self._event_digest = hashlib.sha256()
        self._event_count = 0
        self._events_truncated = False
        #: The ONE descriptor of the control channel. It is the source of
        #: truth: the writer holds it, the read side watches it and the wait
        #: for a writable socket watches the very same one.
        #: The state of the termination of the domain. It is NEVER reset: the
        #: polite signal and the hard signal are once each in this lifetime.
        self._actions = TerminationActions()
        self._control_fd = CONTROL_FD
        self._control = ControlWriter(self._control_fd)
        self._selector = selectors.DefaultSelector()
        self._wakeup_read = -1
        self._wakeup_write = -1
        self._control_read = self._control_fd
        self._worker_stdout_read = -1
        self._worker_stderr_read = -1
        self._decoder = FrameDecoder(MAX_CONTROL_FRAME, MAX_CONTROL_BUFFER)
        self._node_path = ""
        self._worker_path = ""
        self._terminated = False
        self._authorized = False
        #: Too many identities were recorded: the draw may not be proven gone.
        self._identity_overflow = False
        #: Where this program is. It is the state machine of the whole life.
        self._state = STATE_RUNNING
        #: The FIRST failure of this program. It is kept even when the domain is
        #: really gone: the resources ending and the creation failing are two
        #: separate facts, and a receipt that proves the first may not sign the
        #: second.
        self._failure: CustodianFailure | None = None
        #: The Host is not there any more. The endpoints of the Host are
        #: unregistered and the LOCAL recovery continues: the wait ownership is
        #: never dropped because the proof cannot be delivered.
        self._host_is_gone = False
        #: The sequence number of the last control message. It starts at zero and
        #: it is incremented by EVERY message, so that a gap is a gap.
        self.sequence = 0
        #: The exec of the worker is pending: the pipe is in the selector.
        self._exec_pending = False
        self._exec_read = -1
        self._exec_bytes = b""
        self._exec_status: dict | None = None
        #: Whether the session of the worker was really established: it is
        #: the marker's own fact, and it is never assumed.
        self._session_established = False
        #: The IRREVERSIBLE state of the authorisation of this draw:
        #: ``unbound``, ``sealed`` or ``terminated``.
        #:
        #: The binding is sealed by the FIRST legal authorisation, and it is
        #: never changed. A repeated authorisation, or one that arrives after
        #: the termination, is a protocol failure: it does not change the
        #: binding, it does not allocate a descriptor and it does not fork.
        self.authorization_state = "unbound"
        #: The ONE fork attempt of this draw. It is consumed by the first legal
        #: authorisation, and a failure never gives it back.
        self.fork_attempt_consumed = False
        #: ``none``, ``failed-no-child`` or ``born``.
        self.fork_attempt_state = "none"
        #: The REAL errno of a fork that really failed.
        self.fork_errno: int | None = None
        #: The startup kind of this draw, as the ACTUAL facts are.
        self.startup_kind = STARTUP_UNAUTHED
        #: The streams of the worker, for the WHOLE lifetime.
        self.stdout_ledger = OwnedStreamLedger("stdout")
        self.stderr_ledger = OwnedStreamLedger("stderr")
        #: The ORDINALS of the waits of this program: every wait it really did
        #: has one, they only grow, and they are the order of the waits.
        self._wait_ordinal = 0
        #: The terminal wait of the worker itself, and the waits that came
        #: AFTER it.
        self._worker_wait: dict | None = None
        self._post_worker_waits = 0
        #: The ordinal of the last wait when the ECHILD was really seen. Any
        #: later wait invalidates it, and the next pass measures it again.
        self._echild_after_wait_ordinal: int | None = None
        #: Whether this program really was the subreaper BEFORE the fork.
        self._subreaper_before_fork = False
        #: Whether the anchor of the worker was still held when the worker was
        #: really waited for.
        self._anchor_preserved_until_worker_wait = True

    # -- the events ---------------------------------------------------------------

    def anchor_state(self) -> str:
        """The REAL state of the anchor of the worker.

        It is ``none`` when there is no worker, ``reaped`` when the anchor was
        really consumed, ``held`` when the worker exited and its anchor is
        still held by this program, and ``running`` while the worker is still
        alive.
        """
        if self.worker_pid <= 0:
            return "none"
        if self.anchor_reaped:
            return "reaped"
        if self.anchor_held:
            return "held"
        return "running"

    def _record_signal(self, text: str) -> None:
        """Keep ONE bounded fact about a signal that was dispatched or refused.

        The retained history NEVER grows without a bound: the first facts and
        the most recent ones are kept, and the facts that did not fit are
        COUNTED. A refusal is a fact and never a delivery, and the original
        first error of this program is never replaced by one.
        """
        self.signal_facts_total += 1
        if len(self.signals) < MAX_RETAINED_SIGNAL_FACTS:
            self.signals.append(text)
            return
        self._recent_signals.append(text)
        if len(self._recent_signals) > MAX_RETAINED_SIGNAL_FACTS:
            self._recent_signals.pop(0)
            self.signal_facts_saturated = True
            # The diagnostics of this draw did not fit: the draw may not be
            # signed off as a success, and the cleanup goes on.
            if self._failure is None:
                self._failure = CustodianFailure(
                    "SIGNAL_FACTS_SATURATED",
                    "the retained signal facts of this draw did not fit: the receipt is not a complete proof",
                )

    def _record_event(self, line: str) -> None:
        """Add one event to the chain, and to its digest."""
        self._event_count += 1
        self._event_digest.update((line + "\n").encode("utf-8"))
        if len(self._events) < MAX_EVENT_RECORDS:
            self._events.append(line)
        else:
            self._events_truncated = True

    def event_digest(self) -> str:
        """The digest of the WHOLE event chain."""
        return self._event_digest.hexdigest()

    # -- the bytes of this program -------------------------------------------------

    def verify_own_integrity(self) -> None:
        """Check the bytes of this program and of its interpreter.

        The custodian is a part of the settlement: it is the only process that may
        reap the draw. Its own bytes, and the bytes of the interpreter it runs
        under, are therefore part of the record - and a change of either is
        refused here, before anything is forked, and not discovered afterwards.
        """
        script = os.path.abspath(__file__)
        manifest_path = os.path.join(os.path.dirname(script), "cache-worker-integrity.json")
        try:
            with open(manifest_path, "rb") as handle:
                manifest = json.loads(handle.read().decode("utf-8"))
        except (OSError, ValueError) as error:
            raise CustodianFailure(
                "INTEGRITY_MANIFEST_UNREADABLE",
                "the cache worker integrity manifest could not be read: %s" % error,
            )
        runtime = manifest.get("fixed_runtime")
        if not isinstance(runtime, dict):
            raise CustodianFailure("INTEGRITY_MANIFEST_INVALID", "the manifest names no fixed runtime")
        python = runtime.get("python")
        if not isinstance(python, dict):
            raise CustodianFailure("INTEGRITY_MANIFEST_INVALID", "the manifest names no interpreter")
        expected = python.get("sha256")
        if not isinstance(expected, str):
            raise CustodianFailure("INTEGRITY_MANIFEST_INVALID", "the manifest names no digest of the interpreter")
        actual = _digest_of(sys.executable)
        if actual is None:
            raise CustodianFailure("INTEGRITY_INTERPRETER_MISSING", "the interpreter could not be read")
        if actual != expected:
            raise CustodianFailure("INTEGRITY_INTERPRETER_MISMATCH", "the interpreter is not the reviewed one")
        modules = manifest.get("host_modules")
        if not isinstance(modules, dict):
            raise CustodianFailure("INTEGRITY_MANIFEST_INVALID", "the manifest names no host module")
        own = "src/adapters/openfilm/cache-process-custodian.py"
        recorded = modules.get(own)
        if not isinstance(recorded, str):
            raise CustodianFailure("INTEGRITY_MANIFEST_INVALID", "the manifest does not cover the custodian")
        if _digest_of(script) != recorded:
            raise CustodianFailure("INTEGRITY_CUSTODIAN_MISMATCH", "the custodian is not the reviewed one")

    # -- the kernel prerequisites -------------------------------------------------

    def enable_subreaper(self) -> bool:
        """Make this process the reaper of the orphans of its own children.

        It is done BEFORE anything is forked, and it is verified by reading the
        setting back. If the kernel does not have it, nothing is forked at all:
        a custodian that cannot reap is not a custodian.
        """
        try:
            libc = ctypes.CDLL(None, use_errno=True)
        except OSError as error:
            raise CustodianFailure("CTYPES_UNAVAILABLE", "ctypes is not available: %s" % error)
        prctl = prctl_bind(libc)
        if prctl_set_child_subreaper(prctl) != 0:
            code = ctypes.get_errno()
            raise CustodianFailure(
                "PRCTL_UNAVAILABLE",
                "the kernel refused PR_SET_CHILD_SUBREAPER (errno %d)" % code,
            )
        confirmed, code = prctl_get_child_subreaper(prctl)
        if not confirmed:
            raise CustodianFailure(
                "PRCTL_UNAVAILABLE",
                "the kernel refused PR_GET_CHILD_SUBREAPER (errno %d)" % code,
            )
        # The subreaper is really THIS program, and it was so BEFORE the
        # fork: the certificate of a failed draw says so, and it is a fact
        # of this program and not a flag that somebody else may set.
        self._subreaper_before_fork = True
        return True

    # -- the control channel ------------------------------------------------------

    def _send(self, payload: dict, reserved: bool = False) -> None:
        """Put ONE message on the control channel, with its sequence number."""
        self.sequence += 1
        message = dict(payload)
        message["seq"] = self.sequence
        try:
            body = encode_frame(message)
        except CustodianFailure:
            self.diagnostics_lost = True
            self._record_event("frame-too-large")
            return
        if not self._control.queue(body, reserved=reserved):
            self.diagnostics_lost = True
            self._record_event("control-queue-full")
            return
        self._flush_control()

    def _flush_control(self) -> None:
        """Write what is queued, as far as the socket lets us."""
        self._control.flush()
        self._sync_control_interest()

    def _sync_control_interest(self) -> None:
        """Watch for writability exactly when there is something to write."""
        want_write = self._control.pending
        try:
            key = self._selector.get_key(self._control_read)
        except KeyError:
            return
        mask = selectors.EVENT_READ | (selectors.EVENT_WRITE if want_write else 0)
        if key.events != mask:
            try:
                self._selector.modify(self._control_read, mask, "control")
            except (KeyError, ValueError, OSError):
                pass

    # -- the loop ------------------------------------------------------------------

    def _setup(self) -> None:
        """Prepare the selector, the wakeup pipe and the signal handlers."""
        os.set_blocking(self._control_read, False)
        self._wakeup_read, self._wakeup_write = os.pipe()
        os.set_blocking(self._wakeup_read, False)
        os.set_blocking(self._wakeup_write, False)
        # SIGCHLD only WAKES the loop. It never reaps anything: a handler that
        # reaps would take the worker's anchor away from the code that owns it.
        signal.set_wakeup_fd(self._wakeup_write)
        signal.signal(signal.SIGCHLD, lambda *_args: None)
        # A signal that reaches this program does not kill it: the program enters
        # its own cleanup, which is the only way the group can really be stopped.
        signal.signal(signal.SIGTERM, self._on_terminate)
        signal.signal(signal.SIGINT, self._on_terminate)
        self._selector.register(self._wakeup_read, selectors.EVENT_READ, "wakeup")
        self._selector.register(self._control_read, selectors.EVENT_READ, "control")

    def _on_terminate(self, *_args) -> None:
        self._terminated = True

    def _drain_wakeup(self) -> None:
        try:
            os.read(self._wakeup_read, 4096)
        except OSError:
            pass

    def _read_control(self) -> list[dict]:
        """Read what the Host said, if anything."""
        room = MAX_CONTROL_BUFFER - self._decoder.pending
        if room <= 0:
            raise CustodianFailure("BUFFER_OVERFLOW", "the unconsumed bytes of the channel exceed the limit")
        try:
            data = os.read(self._control_read, min(65536, room))
        except BlockingIOError:
            return []
        except OSError:
            raise CustodianFailure("CONTROL_CLOSED", "the control channel could not be read")
        if not data:
            raise CustodianFailure("CONTROL_CLOSED", "the Host closed the control channel")
        return self._decoder.feed(data)

    def _service_streams(self, seconds: float) -> None:
        """Serve the streams of the worker FAIRLY, and then wait.

        Every phase of this program - the running draw, the settlement, the
        recovery, the wait for the worker and the final drain - serves the
        same ledger, and none of them may starve the control channel or the
        reaping.
        """
        self._drain_worker_streams()
        if seconds > 0:
            time.sleep(seconds)

    def _close_stream_reader(self, fd: int, name: str) -> None:
        """The reader of a stream is really closed, ONCE.

        The end of the file is the normal way to close it. A reader whose
        read failed is closed only after the raw tree proof established that
        no live writer is left: closing a reader is not a proof, and it may
        not be used as one.
        """
        if fd < 0:
            return
        try:
            self._selector.unregister(fd)
        except (KeyError, ValueError, OSError):
            pass
        try:
            os.close(fd)
        except OSError:
            pass
        ledger = self.stdout_ledger if name == "stdout" else self.stderr_ledger
        ledger.mark_closed()
        if name == "stdout":
            self._worker_stdout_read = -1
        else:
            self._worker_stderr_read = -1

    def _final_stream_drain(self) -> None:
        """The LAST service of the streams of the worker.

        It happens AFTER the raw tree proof (§4A): a stream that really ended
        is drained to its end of file, and a stream whose read failed is closed
        for the LAST time - and only when the proof established that no live
        writer is left.
        """
        self._drain_worker_streams()
        for fd, name in (
            (self._worker_stdout_read, "stdout"),
            (self._worker_stderr_read, "stderr"),
        ):
            if fd < 0:
                continue
            ledger = self.stdout_ledger if name == "stdout" else self.stderr_ledger
            if ledger.disposition == STREAM_EOF:
                self._close_stream_reader(fd, name)
                continue
            if ledger.read_error is not None:
                # The read failed: the reader is closed once, and the facts
                # say that the stream did not end at its end of file.
                self._close_stream_reader(fd, name)

    def _drain_worker_streams(self) -> None:
        """Read what the worker wrote, within the budget, and BOUNDED.

        One round reads at most STREAM_ROUND_BYTES per stream: a stream that
        floods must never starve the selector, the timers or the waiting.
        """
        for fd, name in (
            (self._worker_stdout_read, "stdout"),
            (self._worker_stderr_read, "stderr"),
        ):
            if fd < 0:
                continue
            ledger = self.stdout_ledger if name == "stdout" else self.stderr_ledger
            room = STREAM_ROUND_BYTES
            while room > 0:
                try:
                    data = os.read(fd, min(65536, room))
                except BlockingIOError:
                    # EAGAIN: this round is not readable YET. It is not an
                    # end of file, and it is not an error.
                    break
                except OSError as error:
                    # A read that failed is NOT an end of file: the error is
                    # kept, and the diagnostics are lost - but the original
                    # failure is not replaced by it. The reader is NOT closed
                    # here: a live writer may still be there, and closing the
                    # reader would not be a proof of anything.
                    ledger.mark_read_error(error)
                    self.diagnostics_lost = True
                    break
                if not data:
                    # A read of ZERO bytes IS the end of the file, and it is
                    # registered once. The reader is closed ONCE here, and it
                    # is closed because the writer really ended - not because
                    # closing it would be a proof.
                    ledger.mark_eof()
                    self._close_stream_reader(fd, name)
                    break
                room -= len(data)
                ledger.read(data)
                self.stdout_bytes = self.stdout_ledger.bytes
                self.stderr_bytes = self.stderr_ledger.bytes
                self.stdout_tail = self.stdout_ledger.tail
                self.stderr_tail = self.stderr_ledger.tail
                if self.stdout_bytes > MAX_STREAM_BYTES or self.stderr_bytes > MAX_STREAM_BYTES:
                    self.diagnostics_lost = True
                    self.signals.append("DIAGNOSTIC_BUDGET:group")
                    self._record_event("diagnostic-budget")
                    # The flood LATCHES the failure and starts the cleanup at
                    # once: it is not noticed once, later, after a candidate.
                    # The failure is kept EVEN when the domain is really reaped:
                    # the resources ending and the creation failing are two
                    # separate facts, and a receipt that proves the first may
                    # not sign the second.
                    if self._failure is None:
                        self._failure = CustodianFailure(
                            "DIAGNOSTIC_BUDGET",
                            "the worker wrote %d bytes on its standard output and %d on its standard error"
                            % (self.stdout_bytes, self.stderr_bytes),
                        )
                    self._terminated = True
                    return

    # -- the worker ----------------------------------------------------------------

    def _record_target(self, identity: dict) -> None:
        """Record the identity of a TARGET of the draw.

        Too many identities is not a reason to keep growing: it is a failure of
        the draw, and it is remembered as one. The proof of the settlement then
        fails, because a domain that was not fully recorded may not be claimed
        to be gone.
        """
        pid = int(identity["pid"])
        if pid in self.identities:
            return
        if len(self.identities) >= MAX_IDENTITY_RECORDS:
            self._identity_overflow = True
            self._record_event("identity-overflow")
            return
        self.identities[pid] = identity
        self._record_event("target:%d:%s" % (pid, identity.get("start_ticks")))

    def _spawn_worker(self, node_path: str, worker_path: str, environment: dict) -> dict:
        """Fork the worker, give it its own session, and hand it the draw socket.

        The child does four things before it execs: it makes a session of its own
        (so the whole browser tree below it is one group), it moves the draw
        socket onto file descriptor 3, it moves the standard streams onto 0, 1 and
        2, and it closes every other descriptor it inherited - except the exec
        status pipe, which it keeps until the exec itself closes it. Only then
        does it exec.
        """
        stdin_read, stdin_write = os.pipe()
        stdout_read, stdout_write = os.pipe()
        stderr_read, stderr_write = os.pipe()
        exec_read, exec_write = os.pipe()
        # The exec status pipe must not survive the exec: its end is closed by the
        # kernel when the image is replaced, and that close is the proof that the
        # exec worked. The child keeps it until then; the PARENT closes its own
        # copy at once, so that the EOF really is the exec and nothing else.
        os.set_inheritable(exec_write, False)
        os.set_inheritable(stdin_read, True)
        os.set_inheritable(stdout_write, True)
        os.set_inheritable(stderr_write, True)

        try:
            pid = os.fork()
        except OSError:
            # The fork really failed and there is NO child: every parent side
            # that was allocated is closed ONCE, and it was never inherited.
            for fd in (
                stdin_read, stdin_write, stdout_read, stdout_write,
                stderr_read, stderr_write, exec_read, exec_write,
            ):
                try:
                    os.close(fd)
                except OSError:
                    pass
            self.stdout_ledger.acquired()
            self.stderr_ledger.acquired()
            self.stdout_ledger.mark_closed_without_inheritance()
            self.stderr_ledger.mark_closed_without_inheritance()
            raise
        if pid == 0:
            # The child. Anything that goes wrong here is reported through the
            # exec status pipe and never through the protocol.
            try:
                os.setsid()
            except OSError as error:
                _exec_fail(exec_write, SETUP_STAGE_SETSID, error.errno or errno.EPERM, False)
                os._exit(127)
            # The session really exists now. The marker says so, and the parent
            # does not read an isolated EOF as a success.
            _exec_note(exec_write, SETUP_STAGE_SETSID, True, None, True)
            try:
                os.dup2(stdin_read, 0)
                os.dup2(stdout_write, 1)
                os.dup2(stderr_write, 2)
                if DRAW_FD != 3:
                    os.dup2(DRAW_FD, 3)
                # Every descriptor above 3 is closed - the control channel of the
                # Host included - EXCEPT the exec status pipe, which has to stay
                # open until the exec closes it.
                for fd in descriptors_to_close(_open_descriptors(), exec_write):
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                os.set_inheritable(0, True)
                os.set_inheritable(1, True)
                os.set_inheritable(2, True)
                os.set_inheritable(3, True)
            except OSError as error:
                _exec_fail(exec_write, SETUP_STAGE_STDIO, error.errno or errno.EIO, True)
                os._exit(127)
            try:
                os.execve(node_path, [node_path, worker_path], environment)
            except OSError as error:
                _exec_fail(exec_write, SETUP_STAGE_EXEC, error.errno or errno.ENOENT, True)
                os._exit(127)
            os._exit(127)

        # The parent. The copies of the child's ends are closed here: a pipe that
        # is still open in the parent would keep the EOF away. The exec pipe is
        # closed here TOO: from now on the EOF of that pipe can only come from
        # the exec of the child.
        for fd in parent_close_set(stdin_read, stdout_write, stderr_write, exec_write):
            try:
                os.close(fd)
            except OSError:
                pass
        try:
            os.close(stdin_write)
        except OSError:
            pass
        return {
            "pid": pid,
            "stdout_read": stdout_read,
            "stderr_read": stderr_read,
            "exec_read": exec_read,
        }

    def _authorize_fork(self, message: dict) -> None:
        """Fork the worker, and report what really happened.

        The FORKED message is sent when the exec of the worker is KNOWN - not
        when it was started: the exec status is read in the same selector as
        everything else, so that a child that stalls before its exec does not
        block the loop and the deadlines with it.

        The authorisation is MONOTONE: the binding is sealed and the ONE
        attempt is consumed BEFORE any descriptor is allocated and before the
        fork, and neither is ever given back.
        """
        if self.authorization_state != "unbound":
            # A SECOND authorisation, or one after the termination: the
            # binding is not changed, no descriptor is allocated and no fork
            # happens. The attempt that was consumed stays consumed.
            self._record_event("authorize-refused:%s" % self.authorization_state)
            raise CustodianFailure(
                "AUTHORIZE_REFUSED",
                "the draw was already authorised: the attempt is not given back")
        self.draw_id = str(message.get("draw_id", ""))
        self.ticket_digest = str(message.get("ticket_digest", ""))
        self._node_path = str(message.get("node_path", ""))
        self._worker_path = str(message.get("worker_path", ""))
        if not self._node_path or not self._worker_path:
            raise CustodianFailure("AUTHORIZE_INCOMPLETE", "the authorisation named no worker")
        # The binding is SEALED here, and the attempt is CONSUMED here: the
        # fork that follows may fail, and a failure never frees the attempt.
        self.authorization_state = "sealed"
        self.fork_attempt_consumed = True
        environment = _worker_environment()
        try:
            worker = self._spawn_worker(self._node_path, self._worker_path, environment)
        except OSError as error:
            # The fork really failed and there is NO child.
            self.fork_attempt_state = "failed-no-child"
            self.fork_errno = int(error.errno or errno.EIO)
            self.startup_kind = STARTUP_FORK_FAILED
            raise CustodianFailure(
                "FORK_FAILED",
                "the worker could not be forked: errno %d" % self.fork_errno)
        self.fork_attempt_state = "born"
        # The responsibility of the child is recorded IMMEDIATELY: a failure
        # between the fork and the registration of the descriptors may not
        # lose it, and the anchor of the worker is kept from here on.
        self.worker_pid = worker["pid"]
        self._record_event("forked:%d" % self.worker_pid)
        self._worker_stdout_read = worker["stdout_read"]
        self._worker_stderr_read = worker["stderr_read"]
        self.stdout_ledger.acquired()
        self.stderr_ledger.acquired()
        os.set_blocking(self._worker_stdout_read, False)
        os.set_blocking(self._worker_stderr_read, False)
        self._selector.register(self._worker_stdout_read, selectors.EVENT_READ, "worker-stdout")
        self._selector.register(self._worker_stderr_read, selectors.EVENT_READ, "worker-stderr")
        # The exec status is read in the LOOP: it is a non blocking pipe, and a
        # child that never execs must not freeze this program.
        self._exec_read = worker["exec_read"]
        os.set_blocking(self._exec_read, False)
        self._selector.register(self._exec_read, selectors.EVENT_READ, "exec-status")
        self._exec_pending = True

    def _read_exec_status(self) -> None:
        """Read what the setup of the worker did, without ever blocking.

        The pipe carries the STRUCTURED records of the child: the stage that
        really failed and its real errno. A bare errno and an isolated EOF
        are never read as a success.
        """
        try:
            data = os.read(self._exec_read, 64)
        except BlockingIOError:
            return
        except OSError:
            self._finish_exec({
                "ok": False, "stage": None, "errno": errno.EIO,
                "session_established": self._session_established,
            })
            return
        if not data:
            # EOF: the exec closed the write end. That is the proof that the
            # exec worked - and only together with the marker that says that
            # the session was really established.
            records, legal = decode_setup_records(self._exec_bytes)
            self._finish_exec(classify_setup(records, legal))
            return
        self._exec_bytes += data
        if len(self._exec_bytes) > MAX_SETUP_BYTES:
            # The pipe carries more than it may: the setup is UNKNOWN, and the
            # excess is not read as a success.
            self._finish_exec({
                "ok": False, "stage": None, "errno": errno.EIO,
                "session_established": self._session_established,
            })

    def _finish_exec(self, status: dict) -> None:
        """The exec of the worker is known: the FORKED message goes out."""
        self._exec_pending = False
        self._exec_status = status
        # The session of the worker is a FACT of the setup, and it is never
        # assumed: a setsid that failed and an exec that failed may carry the
        # same errno, and they are two different facts.
        self._session_established = status.get("session_established") is True
        if status.get("ok") is True:
            self.startup_kind = STARTUP_EXEC_SUCCEEDED
        else:
            self.startup_kind = STARTUP_SETUP_FAILED
        try:
            self._selector.unregister(self._exec_read)
        except (KeyError, ValueError, OSError):
            pass
        try:
            os.close(self._exec_read)
        except OSError:
            pass
        self._exec_read = -1
        identity, state = read_process_identity(self.worker_pid)
        if identity is not None and state == "known":
            if self._bind_original_epoch(identity):
                # The epoch of the fork is bound HERE, once: it is the
                # authority of every later signal, and it is never replaced.
                self._record_target(identity)
            elif self.original_worker_epoch is not None:
                original = self.original_worker_epoch
                if str(identity.get("start_ticks")) == str(original.get("start_ticks")):
                    self.current_worker_observation = identity
                    self._record_target(identity)
                else:
                    # A DIFFERENT process at the same number: it is not a
                    # target of this draw, and the authority is lost.
                    self._revoke_signal_authority(
                        "the number of the worker belongs to another process now")
                    self.current_worker_observation = identity
        self._record_event("exec:%s" % json.dumps(status, separators=(",", ":")))
        self._send(
            {
                "kind": "FORKED",
                "protocol": PROTOCOL,
                "draw_id": self.draw_id,
                "ticket_digest": self.ticket_digest,
                "pid": self.worker_pid,
                "exec": status,
                "worker_ppid": identity["ppid"] if identity else None,
                "worker_pgid": identity["pgid"] if identity else None,
                "worker_sid": identity["sid"] if identity else None,
                "worker_start_ticks": str(identity["start_ticks"]) if identity else None,
            }
        )

    # -- the settlement ------------------------------------------------------------

    def _observe_worker_anchor(self) -> bool:
        """Observe the exit of the worker WITHOUT reaping it.

        waitid with WNOWAIT observes the exit and leaves the zombie in place: the
        worker's number stays unusable for anybody else, so the group signals that
        are still needed can still be aimed at it. The anchor is what keeps the
        group signal possible after the worker itself is gone.
        """
        return self._wait_authority() == "exited"

    def _wait_authority(self) -> str:
        """The state of the WAIT AUTHORITY of this program over the worker.

        It is one of:

          - ``running``  the worker is still the direct child of this program
                         and it has not exited;
          - ``exited``   the worker exited and was NOT reaped: the anchor is
                         held, and the number may not be given to anybody else;
          - ``unknown``  the kernel could not be asked: the authority is NOT
                         known, and it is never guessed;
          - ``reaped``   the worker is gone: the authority was LOST for ever,
                         and no number of it may be aimed at again.
        """
        if self.worker_pid <= 0:
            return "none"
        if self.anchor_reaped:
            return "reaped"
        try:
            info = os.waitid(os.P_PID, self.worker_pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        except ChildProcessError:
            # ECHILD: this program has no such child any more. The anchor is
            # gone, and the authority over that number is gone with it.
            self.anchor_reaped = True
            self._revoke_signal_authority("the worker was reaped")
            return "reaped"
        except OSError:
            return "unknown"
        if info is not None:
            if not self.anchor_held:
                self.anchor_held = True
                self._record_event("anchor:%d" % self.worker_pid)
            return "exited"
        return "running"

    def _bind_original_epoch(self, identity: dict) -> bool:
        """Bind the ORIGINAL epoch of the worker, ONCE and for ever.

        The epoch of the fork is the authority of every later signal. It is
        bound the first time the identity of the worker is really known, and it
        is NEVER replaced: a later observation of the same number is a
        SNAPSHOT, and it may not change what the fork was.
        """
        if self.original_worker_epoch is not None:
            return False
        if self.anchor_reaped or self.signal_authority == "revoked":
            return False
        self.original_worker_epoch = dict(identity)
        self.worker_identity = dict(identity)
        self.signal_authority = "bound"
        self._record_event("epoch:%d:%s" % (int(identity["pid"]), identity.get("start_ticks")))
        return True

    def _revoke_signal_authority(self, reason: str) -> None:
        """Lose the authority to signal the worker, FOR EVER.

        It is IRREVERSIBLE: a number that was reaped, or a number that
        belongs to another process now, may never be aimed at again - not in a
        recovery, not in a later census and not for the action that is still
        owed.
        """
        if self.signal_authority == "revoked":
            return
        self.signal_authority = "revoked"
        self.signal_authority_reason = reason
        self._record_event("authority-revoked:%s" % reason)

    def _refusal(self, decision: dict) -> str:
        """The bounded answer of a signal that was NOT dispatched.

        It is never a delivery: the raw kernel call was never reached.
        """
        reason = str(decision.get("reason", "no-authority"))
        self._record_event("signal-refused:%s" % reason)
        if decision.get("permanent") is True:
            return "refused-forbidden:%s" % reason
        return "refused:%s" % reason

    def _authorise_signal(self, kind: str, target: int) -> dict:
        """Whether a signal may be dispatched RIGHT NOW.

        The answer is asked FRESH every time, and it is never a number that was
        verified earlier: the original epoch is bound once, and it is the only
        thing that may be aimed at.

          - the wait authority of this program over the worker must still be
            held: an anchor that was reaped, or a waitid that answered ECHILD,
            revokes the authority for ever;
          - when the epoch is bound, the FRESH observation must be the very
            same process: an unknown observation is not a guess, and an
            observation of another process revokes the authority;
          - the group must be the ORIGINAL group of the worker - its own
            session and its own group - and the fresh group must hold the very
            same epoch, and it must not be the group of this program;
          - when the epoch was not bound at all, ONLY the exact number of a
            direct child that was not reaped may be aimed at, and never a group.
        """
        if self.worker_pid <= 0:
            return {"allowed": False, "reason": "no-worker", "permanent": False}
        if self.signal_authority == "revoked":
            return {
                "allowed": False,
                "reason": self.signal_authority_reason or "authority-lost",
                "permanent": True,
            }
        authority = self._wait_authority()
        if authority == "reaped":
            self._revoke_signal_authority("the worker was reaped")
            return {"allowed": False, "reason": "anchor-reaped", "permanent": True}
        if authority == "unknown":
            # The wait authority is not known: it is HELD, and it is never
            # replaced by a bare number.
            return {"allowed": False, "reason": "wait-authority-unknown", "permanent": False}
        original = self.original_worker_epoch
        if original is None:
            # The BOOTSTRAP: the exact number of a direct child that is not
            # reaped yet. The group of the worker was never verified, and it is
            # never aimed at.
            if kind != "pid":
                return {"allowed": False, "reason": "group-not-verified", "permanent": False}
            if int(target) != int(self.worker_pid):
                return {"allowed": False, "reason": "not-the-worker", "permanent": False}
            identity, state = read_process_identity(int(self.worker_pid))
            if state == "known" and identity is not None:
                self._bind_original_epoch(identity)
            return {"allowed": True, "reason": "bootstrap-pid", "permanent": False}
        # The epoch is BOUND: the FRESH observation must be the same process.
        identity, state = read_process_identity(int(original["pid"]))
        if state == "unknown":
            return {"allowed": False, "reason": "identity-unknown", "permanent": False}
        if identity is None or state == "gone":
            self._revoke_signal_authority("the worker is gone")
            return {"allowed": False, "reason": "worker-gone", "permanent": True}
        if str(identity.get("start_ticks")) != str(original.get("start_ticks")):
            self._revoke_signal_authority("the number of the worker belongs to another process now")
            return {"allowed": False, "reason": "epoch-changed", "permanent": True}
        self.current_worker_observation = identity
        if kind == "pid":
            if int(target) != int(original["pid"]):
                return {"allowed": False, "reason": "not-the-worker", "permanent": False}
            return {"allowed": True, "reason": "original-pid", "permanent": False}
        # The GROUP: it must be the ORIGINAL group of the worker, and the fresh
        # group must hold the very same epoch.
        try:
            group_id = int(original["pgid"])
            own_pid = int(original["pid"])
            own_sid = int(original["sid"])
        except (KeyError, TypeError, ValueError):
            return {"allowed": False, "reason": "group-not-verified", "permanent": False}
        if int(target) != group_id:
            return {"allowed": False, "reason": "not-the-worker-group", "permanent": False}
        if group_id != own_pid or own_sid != own_pid:
            return {"allowed": False, "reason": "group-not-verified", "permanent": False}
        if self.custodian_identity is not None:
            if group_id == int(self.custodian_identity["pgid"]) or group_id == int(self.custodian_identity["sid"]):
                return {"allowed": False, "reason": "group-is-the-custodian", "permanent": False}
        members = group_members(group_id)
        if members is None:
            return {"allowed": False, "reason": "group-unknown", "permanent": False}
        leader = None
        for member in members:
            if int(member["pid"]) == own_pid:
                leader = member
                break
        if leader is None:
            return {"allowed": False, "reason": "group-changed", "permanent": False}
        if str(leader.get("start_ticks")) != str(original.get("start_ticks")):
            self._revoke_signal_authority("the group of the worker belongs to another process now")
            return {"allowed": False, "reason": "epoch-changed", "permanent": True}
        return {"allowed": True, "reason": "original-group", "permanent": False}

    def _signal_group_id(self) -> int:
        """The group of the ORIGINAL worker, when it may be aimed at RIGHT NOW.

        It is ZERO when the group may not be aimed at: the epoch was never
        bound, the authority was lost, the number belongs to another process
        now, or the group could not be enumerated. The caller must NOT fall
        back to a group that was verified earlier.
        """
        original = self.original_worker_epoch
        if original is None:
            return 0
        try:
            group_id = int(original["pgid"])
        except (KeyError, TypeError, ValueError):
            return 0
        decision = self._authorise_signal("group", group_id)
        if not decision["allowed"]:
            return 0
        return group_id

    def _target_census(self) -> TargetCensus:
        """What the kernel can say about the targets RIGHT NOW.

        The identity of a target is read while it is still running: a record
        that was made after the reap would be a record of nothing. The anchor of
        the worker is observed here too, so that the receipt may say whether the
        anchor was really held while the signals were sent.

        An enumeration that could not be made is UNKNOWN, and it is carried into
        the state machine. It is NEVER turned into an empty list: a target that
        could not be asked about may still be there, and the anchor of the worker
        may not be released because of it.
        """
        live: list[dict] = []
        pending: list[dict] = []
        unknown = False
        reasons: list[str] = []
        # The WORKER is a target from the moment it was forked: its existence is
        # a FACT of the fork, and not a fact of a readable identity. An
        # identity that cannot be read is UNKNOWN - it is never "there is no
        # target", and a target that cannot be asked about keeps the anchor.
        if self.worker_pid > 0:
            identity, state = read_process_identity(self.worker_pid)
            original = self.original_worker_epoch
            if state == "unknown":
                unknown = True
                reasons.append("the identity of the worker could not be read")
            elif identity is not None and state == "known":
                if original is None:
                    # The epoch was never bound: ONLY a worker that is still
                    # the direct child of this program may be bound now. A
                    # number that may have been given to somebody else is never
                    # bound, and it is never a target of this draw.
                    if self._wait_authority() in ("running", "exited"):
                        self._bind_original_epoch(identity)
                    else:
                        unknown = True
                        reasons.append("the identity of the worker could not be bound to the original fork")
                        identity = None
                elif str(identity.get("start_ticks")) != str(original.get("start_ticks")):
                    # A DIFFERENT process at the same number: it is NOT a
                    # target of this draw, and the authority is lost for ever.
                    self._revoke_signal_authority("the number of the worker belongs to another process now")
                    self.current_worker_observation = identity
                    unknown = True
                    reasons.append("the number of the worker belongs to another process now")
                    identity = None
                else:
                    # The very same process: it is a SNAPSHOT, and it never
                    # changes what the original fork was.
                    self.current_worker_observation = identity
            if identity is not None:
                self._record_target(identity)
                if str(identity["state"]) == "Z":
                    # A zombie is not alive any more, but it is a resource that
                    # still has to be reaped.
                    pending.append(identity)
                else:
                    live.append(identity)
        self._observe_worker_anchor()
        pgid = self._target_group()
        if pgid > 0:
            members = group_members(pgid)
            if members is None:
                unknown = True
                reasons.append("the group of the worker could not be enumerated")
            else:
                original = self.original_worker_epoch
                leader = None
                for member in members:
                    if original is not None and int(member["pid"]) == int(original["pid"]):
                        leader = member
                        break
                if not members:
                    # The group is empty: it is gone, and there is nothing to
                    # prove about a group that does not exist.
                    pass
                elif leader is None:
                    # The group does not hold the ORIGINAL worker: it is not the
                    # group of this draw any more, and its members are not
                    # targets of this draw.
                    unknown = True
                    reasons.append("the group of the worker does not hold the original worker")
                elif str(leader.get("start_ticks")) != str(original.get("start_ticks")):
                    unknown = True
                    reasons.append("the group of the worker belongs to another process now")
                else:
                    for member in members:
                        self._record_target(member)
                        if int(member["pid"]) == int(self.worker_pid):
                            continue
                        if str(member["state"]) == "Z":
                            pending.append(member)
                        else:
                            live.append(member)
        children = direct_children()
        if children is None:
            unknown = True
            reasons.append("the children of this process could not be enumerated")
        else:
            for pid in children:
                if pid == self.worker_pid:
                    continue
                identity, state = read_process_identity(pid)
                if state == "unknown":
                    unknown = True
                    reasons.append("the identity of a child could not be read")
                    continue
                if identity is None or state != "known":
                    continue
                self._record_target(identity)
                if str(identity["state"]) == "Z":
                    pending.append(identity)
                else:
                    live.append(identity)
        return TargetCensus(live, pending, unknown, reasons)

    def _target_group(self) -> int:
        """The group of the ORIGINAL worker, when it is really its own group.

        It is ZERO when the group may not be aimed at and may not be
        enumerated as the group of this draw: the original epoch was never
        bound, or the worker does not lead its own session and its own group.

        It is a fact about the ORIGINAL fork, and it is NEVER refreshed by a
        later observation: a number that was given to somebody else is not the
        group of this draw.
        """
        original = self.original_worker_epoch
        if original is None:
            return 0
        try:
            if int(original["pgid"]) != int(original["pid"]):
                return 0
            if int(original["sid"]) != int(original["pid"]):
                return 0
        except (KeyError, TypeError, ValueError):
            return 0
        return int(original["pgid"])

    def _reap_adopted(self) -> tuple[list[dict], bool]:
        """Reap every child of this process EXCEPT the worker.

        The enumeration is the kernel's own list of direct children, and each one
        is waited for BY ITS NUMBER. waitpid(-1) is never used here: it would
        reap the worker's anchor and the number with it.

        The second value says whether the enumeration or the wait was UNKNOWN. A
        list of waits that could not be completed is NOT "there was nothing to
        reap", and it may not be treated as one.
        """
        reaped: list[dict] = []
        children = direct_children()
        if children is None:
            return reaped, True
        for pid in children:
            if pid == self.worker_pid:
                continue
            try:
                reaped_pid, status = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                continue
            except OSError:
                # The wait could not be made: the child may still be there.
                return reaped, True
            if reaped_pid == 0:
                continue
            self._record_event("reaped:%d" % reaped_pid)
            self._wait_ordinal += 1
            # Any wait invalidates an ECHILD that was seen before it.
            self._echild_after_wait_ordinal = None
            if self._worker_wait is not None:
                self._post_worker_waits += 1
            self._completions[reaped_pid] = "waited-by-custodian"
            reaped.append({
                "pid": reaped_pid,
                "status": status_of(status),
                "order": self._wait_ordinal,
                "category": "worker" if reaped_pid == self.worker_pid else "adopted",
                "epoch": self._epoch_of(reaped_pid),
            })
        return reaped, False

    def _reap_worker(self) -> tuple[dict | None, bool]:
        """Reap the worker ITSELF. It happens LAST, and only once.

        The second value says whether the wait was UNKNOWN. A worker that could
        not be reaped keeps its anchor: it is the number that the group signal
        is aimed at.
        """
        deadline = time.monotonic() + KILL_CONFIRM_SECONDS
        while True:
            try:
                reaped, status = os.waitpid(self.worker_pid, os.WNOHANG)
            except ChildProcessError:
                self.anchor_reaped = True
                return None, False
            except OSError:
                return None, True
            if reaped != 0:
                self.anchor_reaped = True
                self._record_event("reaped:%d" % reaped)
                self._wait_ordinal += 1
                self._echild_after_wait_ordinal = None
                self._completions[reaped] = "waited-by-custodian"
                self._worker_wait = {
                    "pid": reaped,
                    "status": status_of(status),
                    "order": self._wait_ordinal,
                    "category": "worker",
                    "epoch": self._epoch_of(reaped),
                }
                return dict(self._worker_wait), False
            if time.monotonic() >= deadline:
                return None, True
            time.sleep(POLL_SECONDS)

    def _echild(self) -> bool:
        """Whether this process has no children left at all."""
        for _ in range(64):
            try:
                reaped, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                # The ECHILD was really seen AFTER the last wait that really
                # happened, and it is bound to that wait.
                self._echild_after_wait_ordinal = self._wait_ordinal
                return True
            except OSError:
                return False
            if reaped == 0:
                return False
            # A child of its own that nobody expected. It is still recorded, and it
            # is still reaped - the receipt may not claim ECHILD while it is false.
            self._record_event("reaped:%d" % reaped)
            self._wait_ordinal += 1
            # The anchor of the worker was released by a wait that was NOT the
            # wait of the worker: the certificate says so, and the complete
            # success is refused.
            self._anchor_preserved_until_worker_wait = False
            if self._worker_wait is not None:
                self._post_worker_waits += 1
            self._echild_after_wait_ordinal = None
            self.waits.append({"pid": reaped, "status": status_of(status)})
        return False

    def _epoch_of(self, pid: int) -> dict | None:
        """The FULL epoch of a target, as it was recorded.

        It is the epoch of the FORK, never a later observation of the same
        number: the identity of a process is its number AND its ticks.
        """
        identity = self.identities.get(pid)
        if identity is None:
            return None
        return {
            "pid": int(identity.get("pid", pid)),
            "ppid": int(identity.get("ppid", 0)),
            "pgid": int(identity.get("pgid", 0)),
            "sid": int(identity.get("sid", 0)),
            "start_ticks": str(identity.get("start_ticks", "")),
        }

    def _known_targets_gone(self) -> bool:
        """Whether every TARGET this program recorded is really gone.

        The identity of THIS program is not one of the targets: a custodian that
        is alive while it proves the domain gone could never be part of the proof.
        A draw whose identities did not fit is not proven either.
        """
        # The overflow of the identity budget does NOT change this fact: it
        # changes the completeness of the TRANSCRIPT, and the transcript is
        # what a RESULT needs. The epochs that were RETAINED are asked about,
        # and the answer is the answer.
        for pid, identity in list(self.identities.items()):
            current, state = read_process_identity(pid)
            if state == "gone":
                # The epoch is really gone, and this program did NOT wait for
                # it: the ORIGINAL parent reaped it, and the epoch was really
                # observed gone. That is a fact about the epoch, and it is not
                # a wait of this program.
                if pid not in self._completions:
                    self._completions[pid] = "parent-reaped-observed-gone"
                continue
            if state == "unknown":
                return False
            if str(current["start_ticks"]) == str(identity["start_ticks"]):
                # The very same epoch is still there: it is not gone.
                return False
            # The number carries ANOTHER epoch: the original one is gone, and
            # the number was given to somebody else.
            if pid not in self._completions:
                self._completions[pid] = "parent-reaped-observed-gone"
        return True

    def _settle_domain(self) -> dict:
        """Stop the group of the worker and prove that it is really gone.

        The group is only aimed at when it is really the worker's own group AND
        this program's own group is a different one: a custodian that signalled
        its own group would take itself down with it. Before that - when the
        worker never got its own session - ONLY the exact unreaped child is
        handled, and never a group it inherited from the Host.

        The ACTIONS are the state of this lifetime: the polite signal is sent
        once, the hard signal is sent once, and a pass that finds the domain
        still there escalates instead of assuming that the hard signal was
        already sent.
        """
        if self.worker_pid <= 0:
            # There was no worker: there is nothing to settle, and the proof of
            # that is that this process has no children left at all.
            echild = self._echild()
            known_gone = self._known_targets_gone()
            if not (echild and known_gone):
                return {
                    "ok": False,
                    "reason": "there is no worker, and something is still there",
                    "echild": bool(echild),
                    "group_esrch": False,
                    "known_ids_gone": bool(known_gone),
                }
            return {"ok": True, "echild": True, "group_esrch": True, "known_ids_gone": True}
        group_established = False
        group_id = 0
        # The ORIGINAL epoch of the worker decides the group. A later
        # observation of the same number is a SNAPSHOT: it never replaces the
        # epoch of the fork, and it never decides the group.
        identity, state = read_process_identity(self.worker_pid)
        if identity is not None and state == "known":
            original = self.original_worker_epoch
            if original is None:
                if self._wait_authority() in ("running", "exited"):
                    self._bind_original_epoch(identity)
                else:
                    self._revoke_signal_authority("the worker could not be bound to the original fork")
            elif str(identity.get("start_ticks")) != str(original.get("start_ticks")):
                self._revoke_signal_authority("the number of the worker belongs to another process now")
            else:
                self.current_worker_observation = identity
        original = self.original_worker_epoch
        if original is not None:
            # The ORIGINAL group is an EVIDENCE obligation, and it is
            # INDEPENDENT of the destructive signal authority.
            #
            # The authority to signal may be revoked for ever - and the
            # obligation to PROVE that the ORIGINAL group is really gone may
            # NOT disappear with it. The proof of the domain needs a FRESH raw
            # probe of the ORIGINAL group, and only that probe may settle it:
            # an empty census, an ECHILD and the disappearance of an old epoch
            # are three OTHER facts, and none of them is that probe.
            #
            # The probe is READ-ONLY: it asks the ORIGINAL group, never a
            # replacement, and it never restores the destructive authority.
            # A group that is not proved gone stays UNKNOWN, and the SAME
            # responsibility stays here until a raw ESRCH answers it.
            self._record_target(original)
            if int(original["pgid"]) == int(original["pid"]) and int(original["sid"]) == int(original["pid"]):
                group_established = True
                group_id = int(original["pgid"])
        if group_established and self.custodian_identity is not None:
            if group_id == int(self.custodian_identity["pgid"]) or group_id == int(self.custodian_identity["sid"]):
                return {"ok": False, "reason": "the group of the worker is the group of the custodian"}
        settlement = TargetSettlement(
            KernelSettlementOperations(self),
            self.worker_pid,
            group_established,
            group_id,
            actions=self._actions,
        )
        result = settlement.run()
        for entry in result["signals"]:
            self._record_signal("%s:%s" % (entry["signal"], entry["answer"]))
        self.waits.extend(result["waits"])
        if not result.get("ok"):
            # The domain could not be proven gone. The anchor of the worker was
            # NOT released, and this program keeps the responsibility: it is the
            # only wait owner of the draw.
            return {
                "ok": False,
                "reason": str(result.get("reason", "the domain is not provably gone")),
                "unknown": bool(result.get("unknown", False)),
                "anchor_held": bool(result.get("anchor_held", True)),
                "reasons": list(result.get("reasons", [])),
                "echild": bool(result.get("echild", False)),
                "group_esrch": bool(result.get("group_esrch", False)),
                "known_ids_gone": False,
            }
        known_gone = self._known_targets_gone()
        ok = bool(result["ok"] and known_gone)
        if not ok:
            return {
                "ok": False,
                "reason": "the domain is not provably gone",
                "unknown": False,
                "anchor_held": False,
                "echild": bool(result["echild"]),
                "group_esrch": bool(result["group_esrch"]),
                "known_ids_gone": bool(known_gone),
            }
        return {
            "ok": True,
            "unknown": False,
            "anchor_held": False,
            "echild": bool(result["echild"]),
            "group_esrch": bool(result["group_esrch"]),
            "known_ids_gone": bool(known_gone),
        }

    # -- the run -------------------------------------------------------------------

    def run(self) -> int:
        """The whole life of this custodian.

        The states are fixed and they are not skipped:

            RUNNING -> SETTLING -> (RECOVERY_HELD -> SETTLING) -> RECEIPT_FLUSH -> EXIT

        A domain that could not be proven gone does NOT end the draw: it enters
        the RECOVERY_HELD state, where this program keeps the anchor of the
        worker, the fork facts, the control channel and the original failure.
        The actions are bounded; the RESPONSIBILITY is not.
        """
        self._setup()
        self.verify_own_integrity()
        identity, state = read_process_identity(os.getpid())
        if identity is None or state != "known":
            raise CustodianFailure("IDENTITY_UNREADABLE", "the custodian could not read its own identity")
        # The Host starts this program DETACHED: it must already be the leader of
        # its own session and its own group. It never calls setsid() on itself.
        if not custodian_is_isolated(identity):
            raise CustodianFailure(
                "CUSTODIAN_NOT_ISOLATED",
                "the custodian is not the leader of its own session and its own group",
            )
        self.custodian_identity = identity
        if not self.enable_subreaper():
            raise CustodianFailure("PRCTL_UNAVAILABLE", "the kernel did not confirm PR_SET_CHILD_SUBREAPER")
        self._send(
            {
                "kind": "C_HELLO",
                "protocol": PROTOCOL,
                "pid": identity["pid"],
                "ppid": identity["ppid"],
                "pgid": identity["pgid"],
                "sid": identity["sid"],
                "start_ticks": str(identity["start_ticks"]),
                "state": identity["state"],
                "subreaper": True,
            }
        )
        ready_deadline = time.monotonic() + READY_SECONDS
        try:
            self._run_loop(ready_deadline)
        except CustodianFailure as error:
            self._failure = error
        except Exception as error:
            # EVERY failure after the fork keeps the owner: the group has to be
            # stopped and reaped by THIS program, and a failure that escaped to
            # the outside would leave the domain behind.
            self._failure = CustodianFailure("UNEXPECTED", "%s: %s" % (type(error).__name__, error))
        if self._failure is not None:
            self._send({"kind": "CUSTODIAN_FAILED", "code": self._failure.code, "message": str(self._failure)})
        elif not self._authorized:
            self._failure = CustodianFailure("NO_WORKER", "no worker was authorised")
            self._send({"kind": "CUSTODIAN_FAILED", "code": "NO_WORKER", "message": "no worker was authorised"})
        # The domain is settled on EVERY path: a custodian that leaves without
        # settling leaves orphans behind, and the Host has no way to prove that it
        # did not.
        self._state = STATE_SETTLING
        settlement = self._settle_domain()
        while not settlement.get("ok"):
            # The recovery returns ONLY a settlement that is really proven. An
            # unknown domain never reaches the receipt and never reaches the
            # exit: this program keeps the responsibility and the anchor.
            settlement = self._recover(settlement)
        # The FINAL drain of the streams happens AFTER the raw tree proof
        # (§4A): the resources are really gone, and only then the readers are
        # closed for the last time. The receipt comes AFTER it, so that the
        # facts of the streams are the facts of the end of the life.
        self._final_stream_drain()
        # The receipt is written in SEGMENTS, and the writing is a real bounded
        # wait: a socket that is full is resumed, and a socket that stays full
        # ends this program with a NON-SUCCESS exit.
        self._state = STATE_RECEIPT_FLUSH
        self._send_receipt(identity, settlement)
        flushed = self._flush_receipt()
        self._state = STATE_EXIT
        if not flushed:
            # The Host is not there to receive the receipt. The domain is really
            # gone - the settlement proved it - and the exit is a NON-SUCCESS
            # one: the proof could not be delivered. The original failure is
            # kept where it can still be read.
            self._report_failure_to_stderr()
            return 4
        if self._failure is not None:
            # The resources really ended, and the creation failed: the two are
            # separate facts, and the exit says so.
            return 4
        return 0

    def _report_failure_to_stderr(self) -> None:
        """Keep the original failure where it can still be read.

        The control channel is gone: the receipt cannot be delivered. The failure
        is still the outcome of the draw, and the standard error of this program
        is the one channel that is still open.
        """
        record = {
            "kind": "CUSTODIAN_FAILED",
            "code": self._failure.code if self._failure is not None else "RECEIPT_NOT_DELIVERED",
            "message": str(self._failure) if self._failure is not None
            else "the receipt of the draw could not be delivered",
        }
        try:
            sys.stderr.write(json.dumps(record) + "\n")
        except Exception:  # pragma: no cover - defensive
            pass

    def _run_loop(self, ready_deadline: float) -> None:
        """The ordinary life: the control channel, the exec status and the streams."""
        while True:
            if self._terminated:
                return
            if self._exec_pending and time.monotonic() >= ready_deadline:
                raise CustodianFailure(
                    "EXEC_STATUS_TIMEOUT",
                    "the worker did not finish its exec inside the startup budget",
                )
            for key, _mask in self._selector.select(POLL_SECONDS):
                name = key.data
                if name == "wakeup":
                    self._drain_wakeup()
                elif name == "control":
                    for message in self._read_control():
                        kind = message.get("kind")
                        if kind == "AUTHORIZE_FORK":
                            if self.authorization_state != "unbound":
                                # The state is checked for EVERY message of the
                                # batch, and not only in the outer loop: an
                                # authorisation that arrives after the
                                # termination, or twice in the same batch, is a
                                # protocol failure and it changes nothing.
                                self._record_event(
                                    "authorize-refused:%s" % self.authorization_state)
                                if self._failure is None:
                                    self._failure = CustodianFailure(
                                        "AUTHORIZE_REFUSED",
                                        "the draw was already authorised")
                                self._terminated = True
                                continue
                            self._authorize_fork(message)
                            self._authorized = True
                        elif kind in ("FINALIZE", "CANCEL"):
                            self.authorization_state = "terminated"
                            self._terminated = True
                elif name == "exec-status":
                    self._read_exec_status()
                else:
                    self._drain_worker_streams()
            self._drain_worker_streams()
            self._flush_control()

    def _recover(self, settlement: dict) -> dict:
        """Keep the responsibility while the domain may still be there.

        The domain could not be proven gone. This program does NOT leave: it
        keeps the anchor of the worker, it keeps the fork facts, it keeps the
        control channel and it keeps the original failure, and it waits - with a
        BOUNDED poll and without a busy loop - for the census to become certain
        again. The Host may ask for a recheck at any moment.

        There is NO expiry of the RESPONSIBILITY. The actions are bounded and
        the poll is bounded, but a finite budget of the responsibility would be
        a way of dropping the only wait owner of a draw whose group may still be
        alive.

        A transport that broke - the Host is gone, the control channel ended,
        the selector failed - is NOT a proof that the domain ended, and it is
        NOT authority to leave. The dead endpoints are unregistered and the LOCAL
        recovery continues: the wait ownership is never dropped because the
        proof cannot be delivered.

        It returns ONLY a settlement that is really proven. An unknown domain
        never reaches the receipt and never reaches the exit.
        """
        if settlement.get("ok"):
            return settlement
        told = False
        while True:
            self._state = STATE_RECOVERY_HELD
            if not told:
                self._send(
                    {
                        "kind": "CUSTODIAN_HELD",
                        "protocol": PROTOCOL,
                        "draw_id": self.draw_id,
                        "ticket_digest": self.ticket_digest,
                        "code": "DOMAIN_UNKNOWN",
                        "message": str(settlement.get("reason", "the domain could not be proven gone")),
                        "reasons": list(settlement.get("reasons", [])),
                        "anchor_held": True,
                    }
                )
                told = True
            answer = self._wait_for_recovery()
            if answer == "gone":
                # The Host is not there any more. The local recovery continues
                # with the same anchor and the same responsibility, and it waits
                # a bounded interval so that it never spins.
                self._local_pause()
            self._state = STATE_SETTLING
            # The census is asked again. The ACTIONS are not repeated: the
            # polite signal was sent once, and the hard signal that is still
            # OWED is sent by the pass that needs it.
            settlement = self._settle_domain()
            if settlement.get("ok"):
                return settlement

    def _local_pause(self) -> None:
        """Wait a bounded interval, so that the local recovery never spins."""
        time.sleep(RECOVERY_POLL_SECONDS)

    def _unregister_dead_endpoints(self) -> None:
        """Unregister the endpoints that are not there any more.

        The wait ownership is NOT dropped with them: this program is still the
        only wait owner of the draw, and the local recovery polls the domain
        itself.
        """
        self._host_is_gone = True
        try:
            self._selector.unregister(self._control_read)
        except (KeyError, ValueError, OSError):
            pass

    def _wait_for_recovery(self) -> str:
        """Wait for the next step of the recovery, bounded, without a busy loop.

        It returns "recheck" when the Host asked for one, "poll" when the wait
        simply passed, and "gone" when the Host is not there any more.

        A "gone" is NOT a proof that the domain ended: the local recovery
        continues, and the wait ownership is never dropped because the proof
        cannot be delivered.
        """
        if self._host_is_gone:
            # The dead endpoint was unregistered: there is nothing left to read,
            # and the local recovery polls the domain itself.
            return "gone"
        try:
            events = self._selector.select(RECOVERY_POLL_SECONDS)
        except OSError:
            # The selector failed. That is not a proof of anything, and it is not
            # authority to leave: the dead endpoints are unregistered and the
            # local recovery continues.
            self._record_event("selector-failed-in-recovery")
            self._unregister_dead_endpoints()
            return "gone"
        for key, _mask in events:
            name = key.data
            if name == "wakeup":
                self._drain_wakeup()
            elif name == "control":
                try:
                    for message in self._read_control():
                        kind = message.get("kind")
                        if kind == "RECHECK":
                            self._record_event("recheck")
                            return "recheck"
                        elif kind == "CANCEL":
                            # The Host asked to stop. The responsibility stays
                            # HERE until the domain is provably gone: the request
                            # is recorded, and the anchor is kept. A cancel is
                            # not authority to leave.
                            self._record_event("cancel-in-recovery")
                except CustodianFailure:
                    # The control channel ended: the Host is gone. The dead
                    # endpoint is unregistered, and the local recovery continues.
                    self._record_event("control-closed-in-recovery")
                    self._unregister_dead_endpoints()
                    return "gone"
            elif name == "exec-status":
                self._read_exec_status()
        return "poll"

    # -- the receipt ---------------------------------------------------------------

    def _canonical_item(self, item: dict) -> str:
        """The exact text of one item of the receipt, as both ends compute it."""
        kind = item.get("t")
        value = item.get("v")
        if kind == "e":
            return str(value)
        return json.dumps(value, separators=(",", ":"), sort_keys=True)

    def _receipt_items(self) -> list[dict]:
        """The bulk of the receipt: the events, the waits and the identities.

        The identity item is the FULL epoch of the target AND how that epoch
        ended: the identity of a process is its number AND its ticks, and a
        number that was given to somebody else is not the same process.
        """
        items: list[dict] = []
        for event in self._events:
            items.append({"t": "e", "v": event})
        for wait in self.waits:
            items.append({"t": "w", "v": wait})
        for pid in sorted(self.identities):
            epoch = self._epoch_of(pid) or {}
            items.append({"t": "i", "v": {
                "pid": int(epoch.get("pid", pid)),
                "ppid": int(epoch.get("ppid", 0)),
                "pgid": int(epoch.get("pgid", 0)),
                "sid": int(epoch.get("sid", 0)),
                "start_ticks": str(epoch.get("start_ticks", "")),
                "completion": str(self._completions.get(pid, "unknown")),
            }})
        return items

    def _receipt_segments(self, items: list[dict]) -> list[list[dict]]:
        """The bulk of the receipt, split into segments that are BOUNDED.

        Every segment is far below the 16KiB that a segment may never reach, and
        the whole bulk never has to fit into one frame.
        """
        segments: list[list[dict]] = []
        current: list[dict] = []
        for item in items:
            candidate = current + [item]
            size = len(json.dumps(candidate, separators=(",", ":")).encode("utf-8"))
            if size > RECEIPT_SEGMENT_ITEMS_BYTES and current:
                segments.append(current)
                current = [item]
            else:
                current = candidate
        if current:
            segments.append(current)
        return segments

    def _stream_digest(self, texts: list[str]) -> str:
        """The digest of a stream of canonical texts."""
        digest = hashlib.sha256()
        for text in texts:
            digest.update((text + "\n").encode("utf-8"))
        return digest.hexdigest()

    def _queue_segment(self, body: dict) -> bool:
        """Put ONE segment of the receipt on the control channel.

        The queue is emptied first: the segments of a receipt are written one at
        a time, so that a receipt of any size fits through a queue of sixteen
        frames, and so that the reserve of the final summary is never consumed
        by a segment.
        """
        deadline = time.monotonic() + RECEIPT_FLUSH_SECONDS
        while self._control.pending:
            self._flush_control()
            if not self._control.pending:
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            if not self._wait_writable(min(POLL_SECONDS, remaining)):
                return False
        self.sequence += 1
        message = dict(body)
        message["seq"] = self.sequence
        try:
            frame = encode_frame(message)
        except CustodianFailure:
            self.diagnostics_lost = True
            return False
        if not self._control.queue(frame):
            self.diagnostics_lost = True
            return False
        self._flush_control()
        return True

    def _group_disposition(self, settlement: dict) -> str:
        """What really happened to the group of the worker.

        ``not-established``     the group was never established: there was no
                                child, or the child never made a session of
                                its own. It is NOT the answer of a group
                                probe, and it is not inferred from an exec
                                failure.
        ``established-gone``     the group was the worker's own, and a FRESH
                                probe proved that it is gone.
        ``unknown``              anything else: the group may still be there,
                                and it may not be used as a proof.
        """
        if self.fork_attempt_state != "born":
            return "not-established"
        if not self._session_established:
            return "not-established"
        if settlement.get("group_esrch"):
            return "established-gone"
        return "unknown"

    def _stream_disposition(self) -> dict:
        """The facts of the two streams of the worker."""
        return {
            "stdout": self.stdout_ledger.facts(),
            "stderr": self.stderr_ledger.facts(),
        }

    def _streams_are_clean(self) -> bool:
        """Whether both streams really ended at their end of file."""
        for ledger in (self.stdout_ledger, self.stderr_ledger):
            if ledger.disposition == STREAM_NOT_OPENED:
                continue
            if ledger.disposition != STREAM_EOF or ledger.read_error is not None:
                return False
        return True

    def _raw_tree_terminal(self, settlement: dict) -> dict:
        """The LOCAL facts that prove that the domain of this draw is gone.

        It does NOT require the reader to be closed, the receipt to be
        delivered or the Host to be there: it is the local root ownership
        chain - the subreaper that was confirmed before the fork, the sole
        wait ownership, the terminal wait of the worker, the ECHILD that was
        really seen after that wait, the group of the worker and every epoch
        that was retained.
        """
        return {
            "worker_wait": self._worker_wait,
            "post_worker_echild": self._echild_after_wait_ordinal is not None,
            "echild_after_wait_ordinal": self._echild_after_wait_ordinal,
            "original_group_state": self._group_disposition(settlement),
            "retained_epochs_gone": bool(settlement.get("known_ids_gone")),
            "post_worker_wait_count": int(self._post_worker_waits),
            "worker_wait_was_last": self._post_worker_waits == 0,
            "anchor_preserved_until_worker_wait": bool(self._anchor_preserved_until_worker_wait),
            "authority_revoked": self.signal_authority == "revoked",
        }

    def _raw_tree_proves_the_end(self, settlement: dict) -> bool:
        """Whether the LOCAL root ownership chain really proves the end.

        It is NOT the qualification of a RESULT: a draw that really failed
        may have its resources really ended, and that is a FAILED SETTLEMENT
        - it is not a success, and it is not held for ever.
        """
        facts = self._raw_tree_terminal(settlement)
        if not self._subreaper_before_fork:
            return False
        if self.fork_attempt_state != "born":
            # The NO-FORK branch has its own facts: there is no worker wait,
            # and the ECHILD is the actual one of a program that never forked.
            return bool(settlement.get("echild")) and facts["original_group_state"] == "not-established"
        if facts["worker_wait"] is None:
            return False
        if not facts["post_worker_echild"]:
            return False
        if facts["echild_after_wait_ordinal"] < int(facts["worker_wait"].get("ordinal", 0)):
            return False
        if not facts["retained_epochs_gone"]:
            return False
        if facts["original_group_state"] != "established-gone":
            return False
        return True

    def _resource_proof_complete(self, settlement: dict) -> bool:
        """Whether the RESOURCES of this draw really ended.

        It is the local root ownership chain AND the actual end of the streams:
        a budget failure, a lost diagnostic or a cut transcript does NOT
        change it. Those are the qualification of a RESULT, and they are
        checked by `_transcript_complete`.
        """
        return self._raw_tree_proves_the_end(settlement) and self._streams_are_clean()

    def _transcript_complete(self, settlement: dict) -> bool:
        """Whether the transcript of this draw is complete.

        It is the qualification of a RESULT: nothing failed, nothing was cut,
        nothing overflowed, the streams really ended at their end of file, and
        the worker was really waited for exactly once and it was the LAST
        wait.
        """
        if self._failure is not None or self.diagnostics_lost:
            return False
        if self._events_truncated or self._identity_overflow:
            return False
        if not self._resource_proof_complete(settlement):
            return False
        if self._post_worker_waits > 0:
            # A wait AFTER the worker: the worker was not the last one, and a
            # complete result is refused. The FAILED proof still holds.
            return False
        return True

    def _failed_terminal_certificate(self, settlement: dict) -> dict:
        """The bounded certificate that the resources of a FAILED draw ended.

        It proves the END of the resources and never the delivery of a
        result: the creative eligibility of such a draw is false, and the
        Host may not deliver an image because of it.
        """
        identity_texts = [self._canonical_item(item) for item in self._identity_items()]
        return {
            "version": 1,
            "root_scope": "sole-custodian-subtree",
            "custodian_epoch": None if self.custodian_identity is None else {
                "pid": int(self.custodian_identity.get("pid", 0)),
                "ppid": int(self.custodian_identity.get("ppid", 0)),
                "pgid": int(self.custodian_identity.get("pgid", 0)),
                "sid": int(self.custodian_identity.get("sid", 0)),
                "start_ticks": str(self.custodian_identity.get("start_ticks", "")),
            },
            "forked_pid": self.worker_pid or None,
            "worker_epoch": None if self.original_worker_epoch is None else {
                "pid": int(self.original_worker_epoch.get("pid", 0)),
                "pgid": int(self.original_worker_epoch.get("pgid", 0)),
                "sid": int(self.original_worker_epoch.get("sid", 0)),
                "start_ticks": str(self.original_worker_epoch.get("start_ticks", "")),
            },
            "subreaper_before_fork": bool(self._subreaper_before_fork),
            "sole_wait_owner": True,
            "no_new_fork_after_termination": True,
            "worker_wait": self._worker_wait,
            "post_worker_echild": self._echild_after_wait_ordinal is not None,
            "echild_after_wait_ordinal": self._echild_after_wait_ordinal,
            "original_group_state": self._group_disposition(settlement),
            "retained_epochs_gone": bool(settlement.get("known_ids_gone")),
            "anchor_preserved_until_worker_wait": bool(self._anchor_preserved_until_worker_wait),
            "worker_wait_was_last": self._post_worker_waits == 0,
            "post_worker_wait_count": int(self._post_worker_waits),
            "authority_revoked": self.signal_authority == "revoked",
            "lifetime": {
                "events": self._event_count,
                "waits": len(self.waits),
                "identities": len(self.identities),
                "events_digest": self.event_digest(),
                "waits_digest": self._stream_digest(
                    [self._canonical_item(item) for item in self.waits]),
                "identities_digest": self._stream_digest(identity_texts),
                "events_truncated": self._events_truncated,
                "identity_overflow": self._identity_overflow,
                "transcript_complete": False,
            },
            "stream_disposition": self._stream_disposition(),
            "resource_proof_complete": bool(self._resource_proof_complete(settlement)),
        }

    def _identity_items(self) -> list[dict]:
        """The identity items of the receipt, in the order they were kept."""
        return [
            {"t": "i", "v": {
                "pid": int(identity.get("pid", 0)),
                "start_ticks": str(identity.get("start_ticks", "")),
            }}
            for identity in self.identities.values()
        ]

    def _send_receipt(self, identity: dict, settlement: dict) -> None:
        """The receipt of the draw: the proof that the domain is really gone.

        It is written in two parts: the SEGMENTS carry the bulk, and the final
        SUMMARY carries the totals, the digests, the status and the binding. The
        summary is small and it uses the reserved terminal slot of the queue.

        It is the receipt of the VERSION 2 of this private protocol: every
        segment and the summary carry it, and the Host refuses a receipt that
        does not.
        """
        items = self._receipt_items()
        segments = self._receipt_segments(items)
        count = len(segments)
        wait_texts = [self._canonical_item(item) for item in items if item.get("t") == "w"]
        identity_texts = [self._canonical_item(item) for item in items if item.get("t") == "i"]
        for index, chunk in enumerate(segments):
            body = {
                "kind": "RECEIPT_SEGMENT",
                "protocol": PROTOCOL,
                "receipt_version": RECEIPT_VERSION,
                "draw_id": self.draw_id,
                "ticket_digest": self.ticket_digest,
                "index": index,
                "count": count,
                "items": chunk,
                "items_digest": self._stream_digest([self._canonical_item(item) for item in chunk]),
            }
            if len(json.dumps(body, separators=(",", ":")).encode("utf-8")) >= RECEIPT_SEGMENT_MAX_BYTES:
                # A segment that does not fit is refused: it may not be sent.
                self.diagnostics_lost = True
                return
            if not self._queue_segment(body):
                # The segment could not be written: the receipt is incomplete,
                # and an incomplete receipt may not be used as a proof.
                self.diagnostics_lost = True
                return
        # The KIND of the proof follows the TRANSCRIPT: a draw whose resources
        # really ended but whose transcript did not survive is a FAILED
        # SETTLEMENT - it proves the end of the resources and it delivers
        # nothing.
        complete = self._transcript_complete(settlement)
        receipt = {
            "kind": "DOMAIN_REAPED",
            "protocol": PROTOCOL,
            "receipt_version": RECEIPT_VERSION,
            "proof_kind": PROOF_COMPLETE if complete else PROOF_FAILED_TERMINAL,
            "creative_eligible": bool(complete),
            "failure": None if self._failure is None else {
                "code": str(self._failure.code),
                "message": str(self._failure.message)[:1024],
            },
            "draw_id": self.draw_id,
            "ticket_digest": self.ticket_digest,
            "outcome": "reaped" if settlement.get("ok") else "unknown",
            "custodian": {
                "pid": identity["pid"],
                "ppid": identity["ppid"],
                "pgid": identity["pgid"],
                "sid": identity["sid"],
                "start_ticks": str(identity["start_ticks"]),
            },
            "worker": {
                "pid": self.worker_pid,
                "ppid": self.worker_identity["ppid"] if self.worker_identity else None,
                "pgid": self.worker_identity["pgid"] if self.worker_identity else None,
                "sid": self.worker_identity["sid"] if self.worker_identity else None,
                "start_ticks": str(self.worker_identity["start_ticks"]) if self.worker_identity else None,
            },
            "startup_kind": self.startup_kind,
            "fork_attempt_state": self.fork_attempt_state,
            "fork_errno": self.fork_errno,
            "forked_pid": self.worker_pid or None,
            "worker_epoch": None if self.original_worker_epoch is None else {
                "pid": int(self.original_worker_epoch.get("pid", 0)),
                "pgid": int(self.original_worker_epoch.get("pgid", 0)),
                "sid": int(self.original_worker_epoch.get("sid", 0)),
                "start_ticks": str(self.original_worker_epoch.get("start_ticks", "")),
            },
            "worker_wait": self._worker_wait,
            "last_actual_wait_ordinal": self._wait_ordinal,
            "echild_after_wait_ordinal": self._echild_after_wait_ordinal,
            "group_disposition": self._group_disposition(settlement),
            "stream_disposition": self._stream_disposition(),
            "failed_terminal": None if complete else self._failed_terminal_certificate(settlement),
            "exec": self._exec_status,
            "signals": list(self.signals) + list(self._recent_signals),
            "signals_truncated": self.signal_facts_saturated,
            "signal_facts_total": self.signal_facts_total,
            "signal_authority": self.signal_authority,
            "signal_authority_reason": self.signal_authority_reason,
            "original_worker_epoch": None if self.original_worker_epoch is None else {
                "pid": int(self.original_worker_epoch.get("pid", 0)),
                "pgid": int(self.original_worker_epoch.get("pgid", 0)),
                "sid": int(self.original_worker_epoch.get("sid", 0)),
                "start_ticks": str(self.original_worker_epoch.get("start_ticks", "")),
            },
            "current_worker_observation": None if self.current_worker_observation is None else {
                "pid": int(self.current_worker_observation.get("pid", 0)),
                "start_ticks": str(self.current_worker_observation.get("start_ticks", "")),
                "state": str(self.current_worker_observation.get("state", "")),
            },
            "events_count": self._event_count,
            "events_digest": self.event_digest(),
            "waits_count": len(self.waits),
            "waits_digest": self._stream_digest(wait_texts),
            "identities_count": len(self.identities),
            "identities_digest": self._stream_digest(identity_texts),
            "segments": count,
            "events_truncated": self._events_truncated,
            "identity_overflow": self._identity_overflow,
            "anchor_retained": self.anchor_held,
            "echild": bool(settlement.get("echild")),
            "group_esrch": bool(settlement.get("group_esrch")),
            "known_ids_gone": bool(settlement.get("known_ids_gone")),
            "diagnostics_lost": self.diagnostics_lost or self._control.lost,
            "stdout_bytes": self.stdout_bytes,
            "stderr_bytes": self.stderr_bytes,
            "failure": None if self._failure is None else {
                "code": self._failure.code,
                "message": str(self._failure)[:4096],
            },
            "state": self._state,
        }
        if not settlement.get("ok"):
            receipt["reason"] = str(settlement.get("reason", "unknown"))
        self._send(receipt, reserved=True)

    def _flush_receipt(self) -> bool:
        """Write the receipt out, within a real bounded deadline.

        A socket that is full is RESUMED: the write waits for the socket to
        become writable again. A socket that stays full ends this program with a
        non-success exit - and the domain has already been reaped, so nothing is
        left behind.
        """
        deadline = time.monotonic() + RECEIPT_FLUSH_SECONDS
        while self._control.pending:
            self._flush_control()
            if not self._control.pending:
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            if not self._wait_writable(min(POLL_SECONDS, remaining)):
                return False
        self._flush_control()
        if self._control.broken or self._control.lost:
            return False
        return not self._control.pending

    def _wait_writable(self, timeout: float) -> bool:
        """Wait for the control channel to become writable again.

        It is a SEPARATE step and not a part of the flush: the write that could
        not be completed waits for the socket, and the socket is asked and not
        the loop.

        The descriptor that is watched is the ONE the writer really holds - the
        control channel itself. It is not another descriptor that happens to
        exist, and an error of the selector is a FAILURE and never a proof
        that the socket is writable.
        """
        try:
            select.select([], [self._control.fd], [], timeout)
            return True
        except (OSError, ValueError):
            return False

    def _best_effort_settle(self) -> None:
        """When something went wrong, the group still has to be stopped."""
        if self.worker_pid <= 0:
            return
        try:
            self._settle_domain()
        except Exception:  # pragma: no cover - defensive
            pass


def main() -> int:
    try:
        return Custodian().run()
    except CustodianFailure as failure:
        try:
            sys.stderr.write(
                json.dumps({"kind": "CUSTODIAN_FAILED", "code": failure.code, "message": str(failure)}) + "\n"
            )
        except Exception:  # pragma: no cover - defensive
            pass
        return 2
    except Exception as error:  # pragma: no cover - defensive
        try:
            sys.stderr.write(
                json.dumps({"kind": "CUSTODIAN_FAILED", "code": "UNEXPECTED", "message": str(error)}) + "\n"
            )
        except Exception:
            pass
        return 2


if __name__ == "__main__":
    sys.exit(main())
