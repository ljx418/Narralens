#!/usr/bin/env python3.12
# -*- coding: utf-8 -*-
"""The unit tests of the custodian of a draw.

They are PURE. Nothing is forked, no signal is sent, no prctl is called, no
process is started, and nothing of the Host or of the network is touched. The
custodian is imported by its ABSOLUTE path, so that the test really runs the
bytes of the production file - and importing it has no side effect: the module
does nothing at import time, and everything it does happens inside its run().

The kernel is MOCKED at its boundaries: the identities it reports, the groups it
knows, the clock, and the writes of the control channel. What is NOT mocked is
the logic itself: the order of the waits, the ownership of the descriptors, the
classification of the errors and the reserve of the final receipt are the real
ones.

What they prove, and what they would have failed on the P1R bytes:

  - the sequence of the control messages starts at zero and grows with every
    message: the P1R bytes incremented a sequence that was never initialised,
    and the first message of a draw raised AttributeError;
  - the custodian refuses to run outside its own session and its own group: the
    P1R bytes were started by the Host WITHOUT detached:true, and the custodian
    inherited the group of the Host;
  - the GET of PR_GET_CHILD_SUBREAPER really takes a POINTER to an int: the P1R
    bytes declared the second argument as a c_ulong and passed a byref of it,
    which is an ArgumentError before the kernel is even asked;
  - the exec pipe belongs to the CHILD until the exec, and the parent closes its
    own copy at once: the P1R bytes kept the write end of the exec pipe in the
    parent, so the EOF that proves the exec never came;
  - a short write keeps the tail of the frame, and the final receipt has a
    reserve of its own: the P1R bytes removed a frame that was only half
    written;
  - the custodian is not one of the targets it has to prove gone: the P1R bytes
    recorded their own identity in the very table the proof walks;
  - a grandchild that ignores the polite signal still gets the hard one, and
    the worker is reaped LAST: the P1R bytes decided the escalation by the exit
    of the worker alone;
  - a process that could not be asked about is never "gone": the P1R bytes
    turned every error of the kernel into an empty group.
"""

import ctypes
import errno
import importlib.util
import json
import os
import pathlib
import signal
import sys
import tempfile
import time
import unittest

#: The custodian of the production. It is imported by its absolute path.
CUSTODIAN_PATH = (
    pathlib.Path(__file__).resolve().parents[4]
    / "src" / "adapters" / "openfilm" / "cache-process-custodian.py"
)


def _load_custodian():
    """Import the custodian of the production, without running its main."""
    spec = importlib.util.spec_from_file_location("narralens_cache_custodian", CUSTODIAN_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("the custodian could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


custodian = _load_custodian()

#: The ledger of the RAW EDGES that this suite REFUSED.
#:
#: It is a ledger of its own, and not a fact of a case: the custodian catches
#: the errors of its own kernel calls, and a refusal that a production
#: ``except`` swallowed would let the case look green. Every case asserts
#: that the ledger holds exactly what it declared.
RAW_EDGE_DENIALS: list[str] = []

#: The raw edges that must NEVER reach the real operating system from this
#: suite: a signal, a spawn, a fork, an exec, a wait and a prctl call.
DENIED_RAW_EDGES = (
    "kill",
    "killpg",
    "fork",
    "forkpty",
    "posix_spawn",
    "posix_spawnp",
    "spawnv",
    "spawnve",
    "spawnl",
    "spawnle",
    "execv",
    "execve",
    "execvp",
    "execvpe",
    "execl",
    "execle",
    "execlp",
    "execle",
    "wait",
    "waitpid",
    "wait3",
    "wait4",
    "waitid",
    "system",
    "popen",
)

#: The raw edges of the REAL operating system, as they were before the guard.
_REAL_OS_EDGES: dict[str, object] = {}

#: The loaders of the C LIBRARY. Loading it and asking it for prctl reaches
#: the kernel, and it is a raw edge of its own.
DENIED_CTYPES_EDGES = ("CDLL", "PyDLL")

#: The loaders of the C library, as they were before the guard.
_REAL_CTYPES_EDGES: dict[str, object] = {}

#: The REGISTRATION edges of the signal handlers of THIS process. They change
#: the real process, and a pure case has no business changing it.
DENIED_SIGNAL_EDGES = (
    "signal",
    "set_wakeup_fd",
    "alarm",
    "kill",
    "pthread_kill",
)

#: The registration edges of the signal handlers, as they were before.
_REAL_SIGNAL_EDGES: dict[str, object] = {}


def _denied_raw_edge(name: str):
    """REFUSE one raw edge of the operating system, and RECORD the refusal."""
    def deny(*_args, **_kwargs):
        RAW_EDGE_DENIALS.append(name)
        raise PermissionError(
            errno.EPERM,
            "the raw edge %r is denied in this suite: install an explicit implementation" % name,
        )
    return deny


def install_raw_edge_guards() -> None:
    """Deny the raw edges of the REAL operating system, BEFORE any effect."""
    for name in DENIED_RAW_EDGES:
        if name in _REAL_OS_EDGES:
            continue
        _REAL_OS_EDGES[name] = getattr(os, name, None)
        setattr(os, name, _denied_raw_edge(name))
    # The C LIBRARY is a raw edge too: the prctl call of the custodian
    # reaches the kernel through it.
    for name in DENIED_CTYPES_EDGES:
        if name in _REAL_CTYPES_EDGES:
            continue
        _REAL_CTYPES_EDGES[name] = getattr(ctypes, name, None)
        setattr(ctypes, name, _denied_raw_edge("ctypes." + name))
    # The REGISTRATION of a signal handler changes THIS process: it is a raw
    # edge of its own.
    for name in DENIED_SIGNAL_EDGES:
        if name in _REAL_SIGNAL_EDGES:
            continue
        _REAL_SIGNAL_EDGES[name] = getattr(signal, name, None)
        setattr(signal, name, _denied_raw_edge("signal." + name))


def restore_raw_edge_guards() -> None:
    """Give the raw edges of the real operating system back."""
    for name, original in list(_REAL_OS_EDGES.items()):
        setattr(os, name, original)
        del _REAL_OS_EDGES[name]
    for name, original in list(_REAL_CTYPES_EDGES.items()):
        setattr(ctypes, name, original)
        del _REAL_CTYPES_EDGES[name]
    for name, original in list(_REAL_SIGNAL_EDGES.items()):
        setattr(signal, name, original)
        del _REAL_SIGNAL_EDGES[name]


def setUpModule() -> None:
    """The global guard goes up BEFORE the first case of this suite."""
    install_raw_edge_guards()


def tearDownModule() -> None:
    """The global guard comes down, and the ledger must be empty."""
    assert not RAW_EDGE_DENIALS, (
        "a raw edge of the operating system was refused outside a case: %r" % RAW_EDGE_DENIALS
    )
    restore_raw_edge_guards()


class _RawEdgeGuardedCase(unittest.TestCase):
    """The base of every case of this suite.

    It asserts, at the end of every case, that the raw edges of the operating
    system that were refused are EXACTLY the ones the case declared. A refusal
    that the custodian caught and swallowed is still a fact, and the case must
    see it.
    """

    #: The refusals that this case expects.
    expected_raw_edge_denials: list[str] = []

    def setUp(self) -> None:
        del RAW_EDGE_DENIALS[:]
        self.expected_raw_edge_denials = []

    def tearDown(self) -> None:
        self.assertEqual(
            list(RAW_EDGE_DENIALS),
            list(self.expected_raw_edge_denials),
            "a raw edge of the operating system was refused in this case",
        )
        del RAW_EDGE_DENIALS[:]
        self.expected_raw_edge_denials = []




def _identity(pid: int, ppid: int = 1, pgid: int | None = None, sid: int | None = None,
              start_ticks: int = 100, state: str = "S") -> dict:
    """One identity, as the kernel reports it."""
    return {
        "pid": pid,
        "ppid": ppid,
        "pgid": pid if pgid is None else pgid,
        "sid": pid if sid is None else sid,
        "start_ticks": start_ticks,
        "state": state,
    }


class FakeSelect:
    """The selector of the control channel, as a script.

    It is the LOW level of the wait: the wait itself is the real one of the
    custodian. The script says whether the socket became writable, and it
    remembers WHICH descriptor it was asked about - so that the descriptor of
    the writer and the descriptor of the wait may be compared.
    """

    def __init__(self, writable: bool = True, error: OSError | None = None) -> None:
        self.writable = writable
        self.error = error
        self.calls: list = []

    def select(self, read, write, except_fds, timeout):
        self.calls.append({
            "read": list(read),
            "write": list(write),
            "except": list(except_fds),
            "timeout": timeout,
        })
        if self.error is not None:
            raise self.error
        if not self.writable:
            return ([], [], [])
        return ([], list(write), [])


class FakeClock:
    """The clock of the custodian, as a script.

    Every reading moves it by ``step`` seconds: a step that is big enough
    makes the deadline of the receipt run out.
    """

    def __init__(self, step: float = 0.0) -> None:
        self.now = 0.0
        self.step = step

    def monotonic(self) -> float:
        value = self.now
        self.now += self.step
        return value


class FakeSettlementOperations(custodian.SettlementOperations):
    """The kernel of the settlement, as a script.

    The script says what is alive at every step, and the operations remember the
    ORDER of everything they were asked to do - so that the order of the waits
    may be looked at, and not only the words of the source.
    """

    def __init__(self, live: list | None = None, group_id: int = 0) -> None:
        self.calls: list = []
        self.live = list(live or [])
        self.clock = 0.0
        self.group_answer = "gone"
        self.echild_answer = True
        #: The group that may be aimed at RIGHT NOW. It is the authority of
        #: the group, and it is ZERO when the group may not be aimed at.
        self.group_id = group_id

    def signal_group(self, pgid: int, number: int) -> str:
        self.calls.append(("signal-group", pgid, number))
        if number == signal.SIGKILL:
            self.live = []
        return "sent"

    def signal_pid(self, pid: int, number: int) -> str:
        self.calls.append(("signal-pid", pid, number))
        if number == signal.SIGKILL:
            self.live = []
        return "sent"

    def worker_group_id(self) -> int:
        self.calls.append("worker-group-id")
        return self.group_id

    def target_census(self):
        self.calls.append("live")
        return custodian.TargetCensus(live=list(self.live))

    def reap_adopted(self):
        self.calls.append("reap-adopted")
        return [], False

    def reap_worker(self):
        self.calls.append("reap-worker")
        return {"pid": 200, "status": {"kind": "exited", "code": 0}}, False

    def echild(self) -> bool:
        self.calls.append("echild")
        return self.echild_answer

    def group_state(self, pgid: int) -> str:
        self.calls.append(("group-state", pgid))
        return self.group_answer

    def monotonic(self) -> float:
        return self.clock

    def sleep(self, seconds: float) -> None:
        self.clock += seconds


class TheSequenceOfTheControlChannel(_RawEdgeGuardedCase):
    """The sequence number of every message of the control channel."""

    def test_the_sequence_starts_at_zero_and_grows_with_every_message(self) -> None:
        instance = custodian.Custodian()
        try:
            # The P1R bytes incremented a sequence that was never initialised: the
            # first message of a draw raised AttributeError.
            self.assertEqual(instance.sequence, 0)
            instance._control = custodian.ControlWriter(-1, write=lambda data: len(data))
            instance._send({"kind": "C_HELLO"})
            self.assertEqual(instance.sequence, 1)
            instance._send({"kind": "FORKED"})
            self.assertEqual(instance.sequence, 2)
            instance._send({"kind": "DOMAIN_REAPED"}, reserved=True)
            self.assertEqual(instance.sequence, 3)
        finally:
            instance._selector.close()

    def test_a_frame_that_is_too_large_is_refused_and_says_so(self) -> None:
        instance = custodian.Custodian()
        try:
            instance._control = custodian.ControlWriter(-1, write=lambda data: len(data))
            instance._send({"kind": "C_HELLO", "padding": "x" * (custodian.MAX_CONTROL_FRAME + 10)})
            self.assertTrue(instance.diagnostics_lost)
            self.assertEqual(instance.sequence, 1)
        finally:
            instance._selector.close()


class TheGateOfTheGroup(_RawEdgeGuardedCase):
    """The custodian has to be outside the group it reaps."""

    def test_a_custodian_that_leads_its_own_session_and_group_is_isolated(self) -> None:
        self.assertTrue(custodian.custodian_is_isolated(_identity(10)))
        self.assertTrue(custodian.custodian_is_isolated(_identity(10, pgid=10, sid=10)))

    def test_a_custodian_that_shares_the_group_of_the_host_is_refused(self) -> None:
        # The P1R bytes were started WITHOUT detached:true: the custodian was in
        # the group of the Host, and the group it had to reap was its own.
        self.assertFalse(custodian.custodian_is_isolated(_identity(10, pgid=7, sid=9)))
        self.assertFalse(custodian.custodian_is_isolated(_identity(10, pgid=10, sid=9)))
        self.assertFalse(custodian.custodian_is_isolated(None))
        self.assertFalse(custodian.custodian_is_isolated({"pid": 10}))


class ThePrctlCall(_RawEdgeGuardedCase):
    """The conversion of the prctl call, checked without the kernel."""

    def test_the_get_takes_a_pointer_to_an_int(self) -> None:
        calls = []

        def fake(option, arg2, arg3, arg4, arg5):
            calls.append((option, arg2))
            arg2[0] = 1
            return 0

        confirmed, code = custodian.prctl_get_child_subreaper(fake)
        self.assertTrue(confirmed)
        self.assertEqual(code, 0)
        option, arg2 = calls[0]
        self.assertEqual(option, custodian.PR_GET_CHILD_SUBREAPER)
        # The P1R bytes declared the second argument as a c_ulong and passed a
        # byref of it: the conversion itself raised before the kernel was asked.
        self.assertIsInstance(arg2, ctypes.POINTER(ctypes.c_int))
        self.assertEqual(arg2._type_, ctypes.c_int)

    def test_the_value_of_the_get_is_stored_in_an_int(self) -> None:
        value = ctypes.c_int(0)
        pointer = custodian.prctl_get_arg2(value)
        pointer[0] = 1
        self.assertEqual(value.value, 1)
        self.assertIsInstance(value, ctypes.c_int)

    def test_the_set_takes_the_plain_value(self) -> None:
        calls = []

        def fake(option, arg2, arg3, arg4, arg5):
            calls.append((option, arg2))
            return 0

        self.assertEqual(custodian.prctl_set_child_subreaper(fake), 0)
        option, arg2 = calls[0]
        self.assertEqual(option, custodian.PR_SET_CHILD_SUBREAPER)
        # The SET wants the VALUE, and not a pointer to it.
        self.assertIsInstance(arg2, int)
        self.assertEqual(arg2, 1)

    def test_a_refused_get_is_not_a_confirmation(self) -> None:
        def fake(option, arg2, arg3, arg4, arg5):
            return -1

        confirmed, _code = custodian.prctl_get_child_subreaper(fake)
        self.assertFalse(confirmed)


class TheExecPipe(_RawEdgeGuardedCase):
    """The ownership of the pipe that tells whether the exec worked."""

    def test_the_EOF_with_the_marker_of_the_session_IS_the_success(self) -> None:
        # The write end is closed by the kernel when the image is replaced, and
        # that close IS the proof that the exec worked - and only together with
        # the marker that says that the session was really established.
        marker = custodian.encode_setup_record(
            custodian.SETUP_STAGE_SETSID, True, None, True)
        records, legal = custodian.decode_setup_records(marker)
        self.assertTrue(legal)
        status = custodian.classify_setup(records, legal)
        self.assertTrue(status["ok"])
        self.assertTrue(status["session_established"])

    def test_the_EOF_without_the_marker_is_NOT_a_success(self) -> None:
        # An isolated EOF says that the pipe was closed, and nothing else: the
        # setup is UNKNOWN, and it is never read as a success.
        records, legal = custodian.decode_setup_records(b"")
        self.assertTrue(legal)
        status = custodian.classify_setup(records, legal)
        self.assertFalse(status["ok"])
        self.assertFalse(status["session_established"])

    def test_the_stage_of_the_failure_is_the_stage_the_child_reported(self) -> None:
        # A setsid that failed and an exec that failed may carry the SAME
        # errno, and they are two different facts.
        setsid = custodian.encode_setup_record(
            custodian.SETUP_STAGE_SETSID, False, errno.EPERM, False)
        records, legal = custodian.decode_setup_records(setsid)
        self.assertTrue(legal)
        status = custodian.classify_setup(records, legal)
        self.assertFalse(status["ok"])
        self.assertEqual(status["stage"], custodian.SETUP_STAGE_SETSID)
        self.assertEqual(status["errno"], errno.EPERM)
        self.assertFalse(status["session_established"])
        exec_failure = custodian.encode_setup_record(
            custodian.SETUP_STAGE_EXEC, False, errno.EPERM, True)
        records, legal = custodian.decode_setup_records(exec_failure)
        self.assertTrue(legal)
        status = custodian.classify_setup(records, legal)
        self.assertFalse(status["ok"])
        self.assertEqual(status["stage"], custodian.SETUP_STAGE_EXEC)
        self.assertEqual(status["errno"], errno.EPERM)
        self.assertTrue(status["session_established"])

    def test_a_record_that_cannot_be_parsed_is_an_unknown_setup(self) -> None:
        records, legal = custodian.decode_setup_records(b"not-a-record\n")
        self.assertFalse(legal)
        status = custodian.classify_setup(records, legal)
        self.assertFalse(status["ok"])
        self.assertIsNone(status["stage"])

    def test_the_pipe_carries_at_most_two_records(self) -> None:
        # Three records do not fit: the setup is UNKNOWN, and the excess is
        # never read as a success.
        payload = b"".join(
            custodian.encode_setup_record(custodian.SETUP_STAGE_SETSID, True, None, True)
            for _ in range(3)
        )
        records, legal = custodian.decode_setup_records(payload)
        self.assertFalse(legal)
        self.assertLessEqual(len(records), custodian.MAX_SETUP_RECORDS)

    def test_the_status_is_never_read_blocking(self) -> None:
        instance = custodian.Custodian()
        read_fd, write_fd = os.pipe()
        try:
            os.set_blocking(read_fd, False)
            instance._exec_read = read_fd
            finished = []
            instance._finish_exec = lambda status: finished.append(status)
            # Nothing was written yet: the read is EAGAIN and NOTHING happens.
            # The P1R bytes read this pipe SYNCHRONOUSLY, before the fork had
            # even returned, and the custodian froze there for ever.
            instance._read_exec_status()
            self.assertEqual(finished, [])
            # The child reports a failure and leaves.
            os.write(write_fd, custodian.encode_setup_record(
                custodian.SETUP_STAGE_EXEC, False, errno.ENOENT, True))
            os.close(write_fd)
            # The records arrive in their own turn, and the end of the pipe in
            # another one: the reading is NEVER blocking, and it is bounded.
            for _ in range(8):
                instance._read_exec_status()
                if finished:
                    break
            self.assertEqual(len(finished), 1)
            self.assertFalse(finished[0]["ok"])
            self.assertEqual(finished[0]["stage"], custodian.SETUP_STAGE_EXEC)
            self.assertEqual(finished[0]["errno"], errno.ENOENT)
        finally:
            instance._selector.close()
            try:
                os.close(read_fd)
            except OSError:
                pass

    def test_the_child_keeps_the_exec_pipe_and_closes_every_other_descriptor(self) -> None:
        # The descriptors 0, 1, 2 and 3 stay: they are the standard streams and
        # the draw socket. The control channel of the Host is closed, and so is
        # every other pipe - but the exec status pipe is KEPT, because it has to
        # survive until the exec itself closes it.
        open_descriptors = [0, 1, 2, 3, 4, 5, 6, 7, 8]
        closed = custodian.descriptors_to_close(open_descriptors, 7)
        self.assertNotIn(7, closed)
        self.assertIn(4, closed)
        self.assertIn(5, closed)
        self.assertIn(6, closed)
        self.assertIn(8, closed)
        self.assertNotIn(3, closed)
        self.assertNotIn(0, closed)

    def test_the_parent_closes_its_own_copy_of_the_exec_pipe_and_of_the_draw_socket(self) -> None:
        closed = custodian.parent_close_set(5, 6, 7, 8)
        # The write end of the exec pipe: the P1R bytes kept it, and the EOF that
        # proves the exec never came.
        self.assertIn(8, closed)
        # The draw socket: the EOF the Host observes has to be the worker's.
        self.assertIn(custodian.DRAW_FD, closed)


class TheControlWriter(_RawEdgeGuardedCase):
    """The bounded writer of the control channel."""

    def test_a_short_write_keeps_the_tail_of_the_frame(self) -> None:
        written = []
        state = {"calls": 0}

        def writer(data: bytes) -> int:
            state["calls"] += 1
            written.append(bytes(data))
            if state["calls"] == 1:
                # A SHORT write: seven of the ten bytes went out.
                return 7
            if state["calls"] == 2:
                # The socket is full: the rest of the frame has to wait.
                raise BlockingIOError()
            return len(data)

        channel = custodian.ControlWriter(-1, write=writer)
        self.assertTrue(channel.queue(b"0123456789"))
        channel.flush()
        # Only seven bytes went out: the frame is NOT gone, and the rest of it
        # is still owed to the socket.
        self.assertEqual(channel.remaining, 3)
        self.assertTrue(channel.pending)
        channel.flush()
        self.assertEqual(channel.remaining, 0)
        self.assertFalse(channel.pending)
        # The second write started at the OFFSET and not at the beginning.
        self.assertEqual(written[0], b"0123456789")
        self.assertEqual(written[1], b"789")

    def test_the_final_receipt_has_a_reserve_of_its_own(self) -> None:
        channel = custodian.ControlWriter(-1, write=lambda data: len(data))
        # The ordinary frames may not use the reserve of the final receipt.
        for _ in range(custodian.CONTROL_QUEUE_FRAMES - custodian.CONTROL_RESERVE_FRAMES):
            self.assertTrue(channel.queue(b"x"))
        self.assertTrue(channel.lost is False)
        # The next ordinary frame does not fit: the reserve is not its own.
        self.assertFalse(channel.queue(b"x"))
        self.assertTrue(channel.lost)
        # The FINAL receipt does fit: it has a frame slot and a byte reserve of
        # its own.
        terminal = custodian.ControlWriter(-1, write=lambda data: len(data))
        for _ in range(custodian.CONTROL_QUEUE_FRAMES - custodian.CONTROL_RESERVE_FRAMES):
            terminal.queue(b"x")
        self.assertTrue(terminal.queue(b"final", reserved=True))
        self.assertFalse(terminal.lost)

    def test_a_reserved_frame_that_is_too_large_is_refused(self) -> None:
        channel = custodian.ControlWriter(-1, write=lambda data: len(data))
        self.assertFalse(channel.queue(b"x" * (custodian.CONTROL_RESERVE_BYTES + 1), reserved=True))
        self.assertTrue(channel.lost)


class TheIdentitiesOfTheTargets(_RawEdgeGuardedCase):
    """The custodian is not one of the targets it has to prove gone."""

    def test_the_custodian_is_not_one_of_its_own_targets(self) -> None:
        instance = custodian.Custodian()
        try:
            instance.custodian_identity = _identity(100)
            instance._record_target(_identity(200))
            self.assertNotIn(100, instance.identities)
            self.assertIn(200, instance.identities)
        finally:
            instance._selector.close()

    def test_the_custodian_may_stay_alive_while_it_proves_the_domain_gone(self) -> None:
        instance = custodian.Custodian()
        try:
            instance.custodian_identity = _identity(100, start_ticks=10)
            instance._record_target(_identity(200, start_ticks=20))
            original = custodian.read_process_identity

            def fake(pid: int):
                if pid == 100:
                    # The custodian itself: it is alive, and it is not a target.
                    return _identity(100, start_ticks=10), "known"
                if pid == 200:
                    return None, "gone"
                return None, "gone"

            custodian.read_process_identity = fake
            try:
                # The P1R bytes put their own identity into the very table the
                # proof walks: known_ids_gone was ALWAYS false, and a successful
                # receipt was impossible.
                self.assertTrue(instance._known_targets_gone())
            finally:
                custodian.read_process_identity = original
        finally:
            instance._selector.close()

    def test_a_target_that_could_not_be_asked_about_is_never_gone(self) -> None:
        instance = custodian.Custodian()
        try:
            instance._record_target(_identity(200, start_ticks=20))
            original = custodian.read_process_identity

            def fake(pid: int):
                return None, "unknown"

            original_members = custodian.group_members
            original_children = custodian.direct_children
            custodian.read_process_identity = fake
            # The enumeration could not be made either: the census is UNKNOWN.
            custodian.group_members = lambda pgid: None
            custodian.direct_children = lambda: None
            try:
                self.assertFalse(instance._known_targets_gone())
                # It also keeps the settlement open: it is not a gone target.
                census = instance._target_census()
                self.assertTrue(census.unknown)
            finally:
                custodian.read_process_identity = original
                custodian.group_members = original_members
                custodian.direct_children = original_children
        finally:
            instance._selector.close()


class TheSettlementOfTheDomain(_RawEdgeGuardedCase):
    """The order of the signals and of the waits."""

    def test_a_grandchild_that_ignores_the_polite_signal_still_gets_the_hard_one(self) -> None:
        operations = FakeSettlementOperations(live=[_identity(300)], group_id=200)
        settlement = custodian.TargetSettlement(operations, 200, True, 200)
        result = settlement.run()
        # The worker was already gone: only the grandchild was alive. The
        # escalation is decided by ALL of the targets, and not by the exit of
        # the worker alone.
        groups = [call for call in operations.calls if isinstance(call, tuple) and call[0] == "signal-group"]
        self.assertEqual(groups[0], ("signal-group", 200, signal.SIGTERM))
        self.assertIn(("signal-group", 200, signal.SIGKILL), groups)
        self.assertTrue(result["echild"])
        self.assertTrue(result["group_esrch"])

    def test_the_worker_is_reaped_last(self) -> None:
        operations = FakeSettlementOperations(live=[], group_id=200)
        settlement = custodian.TargetSettlement(operations, 200, True, 200)
        settlement.run()
        names = [call if isinstance(call, str) else call[0] for call in operations.calls]
        # EVERY adopted descendant is reaped BEFORE the worker: the anchor of the
        # worker is held while the signals are still needed.
        self.assertIn("reap-worker", names)
        self.assertLess(names.index("reap-adopted"), names.index("reap-worker"))
        self.assertLess(max(index for index, name in enumerate(names) if name == "reap-adopted"),
                        names.index("reap-worker"))

    def test_no_hard_signal_is_sent_when_everything_already_ended(self) -> None:
        operations = FakeSettlementOperations(live=[], group_id=200)
        settlement = custodian.TargetSettlement(operations, 200, True, 200)
        settlement.run()
        groups = [call for call in operations.calls if isinstance(call, tuple) and call[0] == "signal-group"]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0][2], signal.SIGTERM)

    def test_without_a_group_only_the_exact_child_is_signalled(self) -> None:
        operations = FakeSettlementOperations(live=[])
        settlement = custodian.TargetSettlement(operations, 200, False, 0)
        settlement.run()
        pids = [call for call in operations.calls if isinstance(call, tuple) and call[0] == "signal-pid"]
        groups = [call for call in operations.calls if isinstance(call, tuple) and call[0] == "signal-group"]
        # Before the worker had its own session, the group of the Host is never
        # aimed at: only the exact unreaped child is handled.
        self.assertEqual(len(pids), 1)
        self.assertEqual(pids[0][1], 200)
        self.assertEqual(groups, [])

    def test_a_group_that_could_not_be_asked_is_not_an_empty_group(self) -> None:
        original = os.killpg
        try:
            os.killpg = lambda pgid, number: (_ for _ in ()).throw(OSError(errno.EIO, "io"))
            self.assertEqual(custodian.group_state(4242), "unknown")
            os.killpg = lambda pgid, number: (_ for _ in ()).throw(ProcessLookupError())
            self.assertEqual(custodian.group_state(4242), "gone")
            os.killpg = lambda pgid, number: None
            self.assertEqual(custodian.group_state(4242), "present")
        finally:
            os.killpg = original

    def test_a_signal_that_could_not_be_delivered_is_not_a_delivery(self) -> None:
        original = os.killpg
        try:
            os.killpg = lambda pgid, number: (_ for _ in ()).throw(OSError(errno.EPERM, "no"))
            self.assertEqual(custodian.signal_group(4242, signal.SIGTERM), "failed")
            os.killpg = lambda pgid, number: (_ for _ in ()).throw(ProcessLookupError())
            self.assertEqual(custodian.signal_group(4242, signal.SIGTERM), "gone")
        finally:
            os.killpg = original


class TheEventChain(_RawEdgeGuardedCase):
    """The chain of events of the receipt."""

    def test_the_digest_covers_every_event(self) -> None:
        instance = custodian.Custodian()
        try:
            instance._record_event("one")
            instance._record_event("two")
            self.assertEqual(instance._event_count, 2)
            self.assertEqual(instance._events, ["one", "two"])
            self.assertFalse(instance._events_truncated)
            self.assertEqual(len(instance.event_digest()), 64)
        finally:
            instance._selector.close()

    def test_a_chain_that_did_not_fit_says_so(self) -> None:
        instance = custodian.Custodian()
        try:
            for index in range(custodian.MAX_EVENT_RECORDS + 5):
                instance._record_event("event:%d" % index)
            self.assertTrue(instance._events_truncated)
            self.assertEqual(instance._event_count, custodian.MAX_EVENT_RECORDS + 5)
            self.assertEqual(len(instance._events), custodian.MAX_EVENT_RECORDS)
        finally:
            instance._selector.close()



class _FakeClock:
    """A clock that only moves when the program sleeps.

    The action deadlines of the settlement are ACTION deadlines: a test that
    waited for them in real time would take eighteen seconds per case.
    """

    def __init__(self, real) -> None:
        self._real = real
        self.now = 1000.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds

    def __getattr__(self, name):
        return getattr(self._real, name)


class _FakeOs:
    """The kernel calls of the custodian, as a script.

    The DANGEROUS edges are not inherited: a raw signal, a fork, an exec, a
    wait or a prctl call may never fall through to the real operating system
    from here. Every one of them is REFUSED and RECORDED, and a case that
    needs one installs an EXPLICIT implementation of its own.
    """

    def __init__(self, real, waitpid, waitid, read=None, killpg=None, kill=None) -> None:
        self._real = real
        self.waitpid = waitpid
        self.waitid = waitid
        self.read = read if read is not None else _failing_read
        # The default of the two raw signal edges is the REFUSAL, not an
        # answer: a case that forgot its script must fail, not look green.
        self.killpg = killpg if killpg is not None else _denied_raw_edge("killpg")
        self.kill = kill if kill is not None else _denied_raw_edge("kill")

    def __getattr__(self, name):
        if name in DENIED_RAW_EDGES:
            # The raw edge is NOT inherited from the real operating system.
            return _denied_raw_edge(name)
        return getattr(self._real, name)


def _failing_read(fd: int, size: int):
    """A read of an endpoint that is not there any more."""
    raise OSError(9, "bad file descriptor")


def _failing_killpg(pgid: int, number: int):
    """A group that is not there any more: the answer is ESRCH, and nothing else.

    It is a SCRIPTED answer, and a case that installs it says so.
    """
    raise ProcessLookupError()


class _FakeEvent:
    """One event of the selector."""

    def __init__(self, data) -> None:
        self.data = data


class _FakeSelector:
    """The selector of the custodian, as a script.

    It is the boundary that is mocked: the ORDER of the waits, the census and
    the recovery around it are the real ones.
    """

    def __init__(self, events=None, error=None) -> None:
        self.events = list(events or [])
        self.error = error
        self.registered = []
        self.unregistered = []

    def select(self, timeout=None):
        if self.error is not None:
            raise self.error
        if self.events:
            return self.events.pop(0)
        return []

    def register(self, fd, events, data) -> None:
        self.registered.append((fd, events, data))

    def unregister(self, fd) -> None:
        self.unregistered.append(fd)
        self.registered = [entry for entry in self.registered if entry[0] != fd]

    def close(self) -> None:
        pass


class TheGuardOfTheRawEdges(_RawEdgeGuardedCase):
    """The raw edges of the operating system, as they are refused here.

    A case that FORGOT its script must fail, and it must fail BEFORE any
    effect: the refusal is recorded, and it is never an answer.
    """

    def test_a_missing_killpg_script_is_a_refusal_and_not_a_gone_group(self) -> None:
        """The group probe without a script is REFUSED: it is not "gone"."""
        fake = _FakeOs(os, lambda _pid, _options: (0, 0), lambda *_args: None)
        # There is NO script for the group probe: the default is the refusal.
        with self.assertRaises(PermissionError):
            fake.killpg(200, 0)
        self.assertIn("killpg", RAW_EDGE_DENIALS)
        self.expected_raw_edge_denials = ["killpg"]

    def test_a_missing_kill_script_is_a_refusal_and_not_a_delivery(self) -> None:
        """The signal of one process without a script is REFUSED."""
        fake = _FakeOs(os, lambda _pid, _options: (0, 0), lambda *_args: None)
        with self.assertRaises(PermissionError):
            fake.kill(200, 15)
        self.assertIn("kill", RAW_EDGE_DENIALS)
        self.expected_raw_edge_denials = ["kill"]

    def test_a_missing_prctl_script_is_a_refusal_and_not_a_library(self) -> None:
        """The C library is a raw edge: loading it to ask for prctl is refused."""
        with self.assertRaises(PermissionError):
            ctypes.CDLL("libc.so.6")
        self.assertIn("ctypes.CDLL", RAW_EDGE_DENIALS)
        self.expected_raw_edge_denials = ["ctypes.CDLL"]

    def test_a_missing_signal_script_is_a_refusal_and_not_a_handler(self) -> None:
        """The registration of a signal handler of THIS process is refused."""
        with self.assertRaises(PermissionError):
            signal.signal(signal.SIGTERM, lambda *_args: None)
        self.assertIn("signal.signal", RAW_EDGE_DENIALS)
        self.expected_raw_edge_denials = ["signal.signal"]


class TheRealAdapter(_RawEdgeGuardedCase):
    """The REAL adapter: Custodian._settle_domain -> KernelSettlementOperations.

    The kernel is mocked AT ITS EDGES - the proc reads, the waits and the clock -
    and the state machine, the collection, the reaping and the ORDER of the waits
    are the real ones. The FakeSettlementOperations above are NOT used here: they
    hand the state machine a list of their own, and they could not show what the
    real adapter does with an enumeration that failed.
    """

    def setUp(self) -> None:
        super().setUp()
        self.real_os = custodian.os
        self.real_time = custodian.time
        self.real_identity = custodian.read_process_identity
        self.real_members = custodian.group_members
        self.real_children = custodian.direct_children
        self.real_signal_group = custodian.signal_group
        self.real_signal_pid = custodian.signal_pid
        self.instance = custodian.Custodian()
        self.waits: list = []
        self.calls: list = []
        self.signals: list = []
        self.identities: dict = {}
        self.members: list | None = []
        self.children: list | None = []
        self.reapable: set = set()
        self.worker_pid = 0
        self.worker_reapable = False
        self.sent: list = []

    def tearDown(self) -> None:
        custodian.os = self.real_os
        custodian.time = self.real_time
        custodian.read_process_identity = self.real_identity
        custodian.group_members = self.real_members
        custodian.direct_children = self.real_children
        custodian.signal_group = self.real_signal_group
        custodian.signal_pid = self.real_signal_pid
        self.instance._selector.close()
        super().tearDown()
    # -- the mocked kernel ------------------------------------------------------

    def _identity(self, pid: int):
        return self.identities.get(pid, (None, "gone"))

    def _members(self, pgid: int):
        return self.members

    def _children(self):
        return self.children

    def _signal_group(self, pgid: int, number: int) -> str:
        self.signals.append(("group", pgid, number))
        if number == signal.SIGKILL:
            self.on_kill()
        return "sent"

    def _signal_pid(self, pid: int, number: int) -> str:
        self.signals.append(("pid", pid, number))
        if number == signal.SIGKILL:
            self.on_kill()
        return "sent"

    def on_kill(self) -> None:
        """What the hard signal really did. The default: nothing."""

    def _waitid(self, which, pid, options):
        # The worker has not exited yet: waitid with WNOWAIT returns None.
        return None

    def _waitpid(self, pid, options):
        self.calls.append(pid)
        if pid == -1:
            # ECHILD: this process has no children left.
            raise ChildProcessError()
        if pid == self.worker_pid:
            if not self.worker_reapable:
                return (0, 0)
            self.worker_reapable = False
            self.waits.append(pid)
            # A reaped process is gone: the kernel does not list it any more.
            self.identities[pid] = (None, "gone")
            return (pid, 0)
        if pid in self.reapable:
            self.reapable.discard(pid)
            self.waits.append(pid)
            self.identities[pid] = (None, "gone")
            return (pid, 0)
        return (0, 0)

    def _install(self) -> None:
        custodian.time = _FakeClock(self.real_time)
        # The group probe is SCRIPTED here: the answer of this suite is that
        # the group is gone. It is an explicit implementation, never a default.
        custodian.os = _FakeOs(
            self.real_os, self._waitpid, self._waitid, killpg=_failing_killpg)
        custodian.read_process_identity = self._identity
        custodian.group_members = self._members
        custodian.direct_children = self._children
        custodian.signal_group = self._signal_group
        custodian.signal_pid = self._signal_pid

    # -- the cases ---------------------------------------------------------------

    def test_an_unknown_census_keeps_the_anchor_of_the_worker(self) -> None:
        """An enumeration that could not be made is UNKNOWN, and not an empty list.

        The P1R2 bytes turned it into an empty list, the state machine believed
        that there was nothing left, and it reaped the worker - which released
        the anchor while its group may still have been there.
        """
        self.worker_pid = 200
        self.instance.worker_pid = 200
        self.identities = {200: (_identity(200), "known")}
        self.members = None
        self.children = None
        self._install()
        result = self.instance._settle_domain()
        self.assertFalse(result["ok"])
        self.assertTrue(result["unknown"])
        self.assertTrue(result["anchor_held"])
        # The worker was NOT reaped: the anchor is held.
        self.assertNotIn(200, self.waits)
        self.assertNotIn(200, self.calls)

    def test_a_zombie_worker_and_a_living_grandchild_are_reaped_in_that_order(self) -> None:
        """A zombie is not alive, and it is not gone either.

        The grandchild that ignores the polite signal still gets the hard one,
        and it is reaped BEFORE the worker: the anchor of the worker is held
        while the signals are still needed.
        """
        self.worker_pid = 200
        zombie = _identity(200, state="Z")
        grandchild = _identity(300)
        self.identities = {200: (zombie, "known"), 300: (grandchild, "known")}
        self.members = [zombie, grandchild]
        self.children = [200, 300]
        self.reapable = {300}
        self.worker_reapable = True
        self.instance.worker_pid = 200
        self.instance.worker_identity = zombie

        def on_kill() -> None:
            self.identities[300] = (None, "gone")
            self.members = [zombie]

        self.on_kill = on_kill
        self._install()
        result = self.instance._settle_domain()
        self.assertTrue(result["ok"], result)
        # The hard signal really went to the group of the worker.
        self.assertIn(("group", 200, signal.SIGKILL), self.signals)
        # The grandchild was reaped BEFORE the worker.
        self.assertEqual(self.waits, [300, 200])
        # ECHILD was asked only AFTER the worker was reaped: waitpid(-1) while
        # the anchor is held would reap it.
        self.assertLess(self.calls.index(300), self.calls.index(200))
        self.assertLess(self.calls.index(200), self.calls.index(-1))

    def test_an_enumeration_that_fails_after_the_kill_keeps_the_anchor(self) -> None:
        """A target that could not be asked about after the hard signal is UNKNOWN.

        The P1R2 bytes would have gone on to reap the worker and to leave: the
        orphans it left were nobody's.
        """
        self.worker_pid = 200
        zombie = _identity(200, state="Z")
        grandchild = _identity(300)
        self.identities = {200: (zombie, "known"), 300: (grandchild, "known")}
        self.members = [zombie, grandchild]
        self.children = [200, 300]
        self.instance.worker_pid = 200
        self.instance.worker_identity = zombie

        def on_kill() -> None:
            # The group cannot be enumerated any more.
            self.members = None

        self.on_kill = on_kill
        self._install()
        result = self.instance._settle_domain()
        self.assertFalse(result["ok"])
        self.assertTrue(result["unknown"])
        self.assertTrue(result["anchor_held"])
        # The worker was NOT reaped.
        self.assertNotIn(200, self.waits)

    def test_a_failure_after_the_fork_is_reported_and_the_domain_is_settled(self) -> None:
        """An unexpected failure after the fork keeps the owner.

        The P1R2 bytes let it escape to the outside, where the whole program
        returned 2 and the domain was left behind.
        """
        instance = custodian.Custodian()
        sent: list = []

        def explode(_deadline: float) -> None:
            raise OSError(5, "the selector could not be registered")

        instance._setup = lambda: None
        instance.verify_own_integrity = lambda: None
        instance.enable_subreaper = lambda: True
        instance._send = lambda payload, reserved=False: sent.append(payload)
        instance._run_loop = explode
        instance._settle_domain = lambda: {"ok": True, "echild": True, "group_esrch": True, "known_ids_gone": True}
        instance._send_receipt = lambda identity, settlement: sent.append({"kind": "DOMAIN_REAPED"})
        instance._flush_receipt = lambda: True
        original_isolated = custodian.custodian_is_isolated
        original_identity = custodian.read_process_identity
        custodian.custodian_is_isolated = lambda identity: True
        custodian.read_process_identity = lambda pid: (_identity(os.getpid()), "known")
        try:
            code = instance.run()
        finally:
            custodian.custodian_is_isolated = original_isolated
            custodian.read_process_identity = original_identity
            instance._selector.close()
        # The failure was reported, and it was NOT a success.
        self.assertNotEqual(code, 0)
        self.assertTrue(any(message.get("kind") == "CUSTODIAN_FAILED" for message in sent))
        self.assertTrue(any(message.get("kind") == "DOMAIN_REAPED" for message in sent))

    def test_the_receipt_is_segmented_and_bounded(self) -> None:
        """The bulk of the receipt does not fit into one frame, and it is split.

        The P1R2 bytes stuffed every event, every wait and every identity into
        ONE reserved frame of sixteen kilobytes: a real transcript could not
        fit, and the proof was lost.
        """
        instance = custodian.Custodian()
        try:
            for index in range(400):
                instance._record_event("event-%d:%s" % (index, "x" * 120))
            segments = instance._receipt_segments(instance._receipt_items())
            self.assertGreater(len(segments), 1)
            for chunk in segments:
                body = json.dumps(chunk, separators=(",", ":")).encode("utf-8")
                self.assertLess(len(body), custodian.RECEIPT_SEGMENT_MAX_BYTES)
        finally:
            instance._selector.close()

    def test_the_receipt_flush_waits_for_a_later_writable(self) -> None:
        """A socket that is full is RESUMED, and not given up on.

        The P1R2 bytes flushed twice and left: the proof of a settled draw was
        lost because the socket happened to be full.

        The wait is the REAL one of the custodian: only the selector and the
        write are mocked, so the descriptor that is watched is the one the
        writer really holds.
        """
        instance = custodian.Custodian()
        attempts = {"count": 0}
        written: list = []

        def writer(data: bytes) -> int:
            attempts["count"] += 1
            if attempts["count"] == 1:
                # The socket is full: the frame stays, with its offset.
                raise BlockingIOError()
            written.append(bytes(data))
            return len(data)

        selector = FakeSelect()
        original_select = custodian.select
        custodian.select = selector
        try:
            instance._control = custodian.ControlWriter(-1, write=writer)
            instance._control.queue(b"the final receipt")
            self.assertTrue(instance._flush_receipt())
            # It waited for the socket, and it wrote the frame out.
            self.assertEqual(len(selector.calls), 1)
            self.assertFalse(instance._control.pending)
            # The frame went out WHOLE, and it went out from its offset.
            self.assertEqual(written, [b"the final receipt"])
        finally:
            custodian.select = original_select
            instance._selector.close()

    def test_a_broken_channel_is_not_a_success(self) -> None:
        """A transport that broke is not a settled draw."""
        instance = custodian.Custodian()

        def writer(data: bytes) -> int:
            raise OSError(32, "the pipe broke")

        selector = FakeSelect()
        original_select = custodian.select
        custodian.select = selector
        try:
            instance._control = custodian.ControlWriter(-1, write=writer)
            instance._control.queue(b"the final receipt")
            self.assertFalse(instance._flush_receipt())
        finally:
            custodian.select = original_select
            instance._selector.close()

    def test_the_wait_watches_the_descriptor_of_the_writer(self) -> None:
        """The wait asks about the control channel and not about another fd.

        The R4A bytes read a field that was never written - ``_control_write`` -
        so a socket that was really full raised an AttributeError instead of
        waiting. The wait now asks about the descriptor the writer holds.
        """
        instance = custodian.Custodian()
        local = os.open(os.devnull, os.O_WRONLY)
        selector = FakeSelect()
        original_select = custodian.select
        custodian.select = selector
        try:
            # The custodian hands its OWN descriptor to the writer.
            self.assertEqual(instance._control.fd, custodian.CONTROL_FD)
            self.assertEqual(instance._control_read, instance._control.fd)
            # There is no second descriptor of the control channel any more.
            self.assertFalse(hasattr(instance, "_control_write"))
            instance._control = custodian.ControlWriter(local, write=lambda data: len(data))
            self.assertTrue(instance._wait_writable(0.5))
            # The selector was asked about the descriptor of the WRITER.
            self.assertEqual(len(selector.calls), 1)
            self.assertEqual(selector.calls[0]["write"], [local])
        finally:
            custodian.select = original_select
            os.close(local)
            instance._selector.close()

    def test_a_full_socket_is_resumed_and_the_frame_goes_out_whole(self) -> None:
        """The REAL wait resumes a full socket, and the frame is not cut.

        The write is short, then the socket is full, the real wait asks the
        selector about the control descriptor, the socket becomes writable and
        the rest of the frame goes out FROM ITS OFFSET.
        """
        instance = custodian.Custodian()
        local = os.open(os.devnull, os.O_WRONLY)
        body = b"the final receipt"
        attempts = {"count": 0}
        calls: list = []

        def writer(data: bytes) -> int:
            attempts["count"] += 1
            calls.append(bytes(data))
            if attempts["count"] == 1:
                # A SHORT write: eight of the seventeen bytes went out.
                return 8
            if attempts["count"] == 2:
                # The socket is full: the rest of the frame has to wait.
                raise BlockingIOError()
            return len(data)

        selector = FakeSelect()
        original_select = custodian.select
        custodian.select = selector
        try:
            instance._control = custodian.ControlWriter(local, write=writer)
            instance._control.queue(body)
            self.assertTrue(instance._flush_receipt())
            # The wait watched the descriptor of the writer.
            self.assertEqual(selector.calls[0]["write"], [local])
            # The frame went out WHOLE: the first write took the beginning and
            # the second one took exactly the rest of it.
            self.assertEqual(calls[0], body)
            self.assertEqual(calls[1], body[8:])
            self.assertFalse(instance._control.pending)
            self.assertEqual(instance._control.remaining, 0)
        finally:
            custodian.select = original_select
            os.close(local)
            instance._selector.close()

    def test_a_descriptor_that_cannot_be_asked_about_fails_closed(self) -> None:
        """A selector that fails is a FAILURE and not a writable socket."""
        instance = custodian.Custodian()
        local = os.open(os.devnull, os.O_WRONLY)
        selector = FakeSelect(error=OSError(9, "Bad file descriptor"))
        original_select = custodian.select
        custodian.select = selector
        try:
            def writer(data: bytes) -> int:
                raise BlockingIOError()

            instance._control = custodian.ControlWriter(local, write=writer)
            instance._control.queue(b"the final receipt")
            # The receipt was NOT written, and it is NOT a success.
            self.assertFalse(instance._flush_receipt())
            self.assertTrue(instance._control.pending)
        finally:
            custodian.select = original_select
            os.close(local)
            instance._selector.close()

    def test_a_deadline_that_runs_out_fails_closed(self) -> None:
        """A receipt that cannot be written in time is not a success."""
        instance = custodian.Custodian()
        local = os.open(os.devnull, os.O_WRONLY)
        selector = FakeSelect()
        clock = FakeClock(step=1000.0)
        original_select = custodian.select
        original_time = custodian.time
        custodian.select = selector
        custodian.time = clock
        try:
            def writer(data: bytes) -> int:
                raise BlockingIOError()

            instance._control = custodian.ControlWriter(local, write=writer)
            instance._control.queue(b"the final receipt")
            self.assertFalse(instance._flush_receipt())
            # The deadline was already gone: the socket was never even asked.
            self.assertEqual(len(selector.calls), 0)
        finally:
            custodian.select = original_select
            custodian.time = original_time
            os.close(local)
            instance._selector.close()

    def test_a_segment_that_cannot_be_written_is_not_a_success(self) -> None:
        """A segment of a receipt that does not go out is not a proof."""
        instance = custodian.Custodian()
        local = os.open(os.devnull, os.O_WRONLY)
        selector = FakeSelect()
        clock = FakeClock(step=1000.0)
        original_select = custodian.select
        original_time = custodian.time
        custodian.select = selector
        custodian.time = clock
        try:
            def writer(data: bytes) -> int:
                raise BlockingIOError()

            instance._control = custodian.ControlWriter(local, write=writer)
            # The channel already owes a frame that never goes out.
            instance._control.queue(b"the pending frame")
            self.assertFalse(instance._queue_segment({"kind": "RECEIPT_SEGMENT"}))
        finally:
            custodian.select = original_select
            custodian.time = original_time
            os.close(local)
            instance._selector.close()


class TheRecoveryOfAnUnknownDomain(_RawEdgeGuardedCase):
    """The REAL _recover and _wait_for_recovery, with the kernel mocked at its edges.

    The R3 bytes had a finite budget of the RESPONSIBILITY: after sixty seconds
    the custodian gave the draw up, sent an unknown receipt and left while its
    group might still have been alive. A finite expiry of the only wait owner of
    a draw is not a settlement, and it is not an approved budget.

    These cases drive the REAL recovery, the REAL wait of the recovery and the
    REAL settlement of the kernel adapter. The kernel is mocked at its edges -
    the proc reads, the waits, the clock and the selector - and the ORDER of the
    waits, the census and the state machine are the real ones.
    """

    def setUp(self) -> None:
        super().setUp()
        self.real_os = custodian.os
        self.real_time = custodian.time
        self.real_identity = custodian.read_process_identity
        self.real_members = custodian.group_members
        self.real_children = custodian.direct_children
        self.real_signal_group = custodian.signal_group
        self.real_signal_pid = custodian.signal_pid
        self.instance = custodian.Custodian()
        self.real_selector = self.instance._selector
        self.instance._selector = _FakeSelector()
        self.sent: list = []
        self.waits: list = []
        self.calls: list = []
        self.signals: list = []
        self.reaped: set = set()
        self.settled_seen = False
        self.n_reaped_before_settled: bool | None = None
        #: The census is UNKNOWN until the clock has passed this moment. It is
        #: what makes the recovery run for LONGER than sixty seconds.
        self.unknown_until = 1070.0
        self.clock_object = _FakeClock(self.real_time)
        self.instance.worker_pid = 200
        self.instance.worker_identity = _identity(200, state="Z")
        self.instance._send = lambda payload, reserved=False: self.sent.append(payload)
        self.instance._failure = custodian.CustodianFailure("SOMETHING", "the original failure of the draw")

    def tearDown(self) -> None:
        custodian.os = self.real_os
        custodian.time = self.real_time
        custodian.read_process_identity = self.real_identity
        custodian.group_members = self.real_members
        custodian.direct_children = self.real_children
        custodian.signal_group = self.real_signal_group
        custodian.signal_pid = self.real_signal_pid
        self.instance._selector.close()
        self.real_selector.close()
        super().tearDown()
    # -- the mocked kernel ------------------------------------------------------

    def _identity(self, pid: int):
        if pid == 200 and 200 not in self.reaped:
            return (_identity(200, state="Z"), "known")
        return (None, "gone")

    def _members(self, pgid: int):
        if self.clock_object.now < self.unknown_until:
            # The group cannot be enumerated: the census is UNKNOWN.
            return None
        if not self.settled_seen:
            self.settled_seen = True
            # What the ledger looked like at the moment the census became
            # certain: the worker must NOT have been reaped before that.
            self.n_reaped_before_settled = 200 in self.waits
        return [_identity(200, state="Z")]

    def _children(self):
        if self.clock_object.now < self.unknown_until:
            return None
        return [200]

    def _waitpid(self, pid, options):
        self.calls.append(pid)
        if pid == -1:
            raise ChildProcessError()
        if pid == 200:
            self.waits.append(pid)
            # A reaped process is gone: the kernel does not list it any more.
            self.reaped.add(pid)
            return (pid, 0)
        return (0, 0)

    def _waitid(self, which, pid, options):
        return None

    def _signal_group(self, pgid: int, number: int) -> str:
        self.signals.append(("group", pgid, number))
        return "sent"

    def _signal_pid(self, pid: int, number: int) -> str:
        self.signals.append(("pid", pid, number))
        return "sent"

    def _install(self) -> None:
        custodian.time = self.clock_object
        # The group probe is SCRIPTED here: the answer of this suite is that
        # the group is gone. It is an explicit implementation, never a default.
        custodian.os = _FakeOs(
            self.real_os, self._waitpid, self._waitid, killpg=_failing_killpg)
        custodian.read_process_identity = self._identity
        custodian.group_members = self._members
        custodian.direct_children = self._children
        custodian.signal_group = self._signal_group
        custodian.signal_pid = self._signal_pid

    # -- the cases ---------------------------------------------------------------

    def test_the_recovery_has_no_expiry_and_keeps_the_anchor(self) -> None:
        """More than sixty seconds of UNKNOWN does not end the responsibility.

        The R3 bytes stopped the recovery after sixty seconds, sent an unknown
        receipt and left: the sole wait owner of a draw whose group might still
        have been alive.
        """
        self._install()
        settlement = self.instance._settle_domain()
        self.assertFalse(settlement["ok"])
        self.assertTrue(settlement["unknown"])
        result = self.instance._recover(settlement)
        # The recovery ran for LONGER than the budget the R3 bytes had.
        self.assertGreater(self.clock_object.now - 1000.0, 60.0)
        # It returns ONLY a settlement that is really proven.
        self.assertTrue(result["ok"])
        # No final receipt was sent while the domain was unknown.
        self.assertFalse(any(message.get("kind") == "DOMAIN_REAPED" for message in self.sent))
        self.assertTrue(any(message.get("kind") == "CUSTODIAN_HELD" for message in self.sent))
        # The worker was NOT reaped while the census was unknown.
        self.assertFalse(self.n_reaped_before_settled)
        self.assertEqual(self.waits, [200])
        # The recovery sent no second signal: the polite and the hard one had
        # already been sent.
        self.assertEqual(len(self.signals), 2)
        # The original failure was kept: the domain ended, the draw did not.
        self.assertIsNotNone(self.instance._failure)
        self.assertEqual(self.instance._failure.code, "SOMETHING")

    def test_the_recovery_survives_the_end_of_the_control_channel(self) -> None:
        """The end of the control channel is not a proof and not authority to leave.

        The Host is gone: the dead endpoint is unregistered, and the LOCAL
        recovery continues with the same anchor and the same responsibility.
        """
        self.instance._selector = _FakeSelector(events=[[(_FakeEvent("control"), 1)]])
        self._install()
        settlement = self.instance._settle_domain()
        self.assertTrue(settlement["unknown"])
        result = self.instance._recover(settlement)
        self.assertTrue(result["ok"])
        # The dead endpoint was unregistered.
        self.assertIn(custodian.CONTROL_FD, self.instance._selector.unregistered)
        self.assertTrue(self.instance._host_is_gone)
        # The wait ownership was NOT dropped: the worker was reaped only by the
        # settlement that really proved the domain.
        self.assertFalse(self.n_reaped_before_settled)
        self.assertEqual(self.waits, [200])
        # And no receipt was delivered to a Host that is not there.
        self.assertFalse(any(message.get("kind") == "DOMAIN_REAPED" for message in self.sent))

    def test_the_recovery_survives_a_failing_selector(self) -> None:
        """A selector that fails is not a proof and not authority to leave."""
        self.instance._selector = _FakeSelector(error=OSError(5, "input/output error"))
        self._install()
        settlement = self.instance._settle_domain()
        self.assertTrue(settlement["unknown"])
        result = self.instance._recover(settlement)
        self.assertTrue(result["ok"])
        self.assertTrue(self.instance._host_is_gone)
        self.assertFalse(self.n_reaped_before_settled)
        self.assertEqual(self.waits, [200])
        self.assertEqual(self.instance._failure.code, "SOMETHING")


class TheUnknownIdentityOfTheWorker(_RawEdgeGuardedCase):
    """The worker EXISTS from the fork, even when its identity cannot be read.

    The R3A bytes read the worker only when it ALREADY had an identity, and
    they skipped it in the list of the children: a live N was then a domain
    with NO target at all, the settlement ended without ever sending the hard
    signal, and a recovery that found the N again never escalated.

    The kernel is mocked at its edges - the identity reads, the group, the
    children, the waits and the clock - and the census, the signals and the
    order of the waits are the REAL ones.
    """

    def setUp(self) -> None:
        super().setUp()
        self.real_os = custodian.os
        self.real_time = custodian.time
        self.real_identity = custodian.read_process_identity
        self.real_members = custodian.group_members
        self.real_children = custodian.direct_children
        self.real_signal_group = custodian.signal_group
        self.real_signal_pid = custodian.signal_pid
        self.instance = custodian.Custodian()
        self.instance._selector = _FakeSelector()
        #: The worker was forked: its NUMBER is a fact.
        self.instance.worker_pid = 200
        #: Its identity was never read. It is not a fact.
        self.instance.worker_identity = None
        self.clock = _FakeClock(self.real_time)
        self.signals: list = []
        self.waits: list = []
        #: The hard signal was sent: the worker is gone.
        self.killed = False

    def tearDown(self) -> None:
        custodian.os = self.real_os
        custodian.time = self.real_time
        custodian.read_process_identity = self.real_identity
        custodian.group_members = self.real_members
        custodian.direct_children = self.real_children
        custodian.signal_group = self.real_signal_group
        custodian.signal_pid = self.real_signal_pid
        self.instance._selector.close()
        super().tearDown()
    # -- the mocked kernel ------------------------------------------------------

    def _identity(self, pid: int):
        if self.killed:
            return (None, "gone")
        if self.clock.now < 1000.5:
            # The identity of the worker CANNOT be read yet.
            return (None, "unknown")
        if pid == 200:
            return (_identity(200, state="S"), "known")
        return (None, "gone")

    def _members(self, pgid: int):
        if self.clock.now < 1000.5:
            return None
        if self.killed:
            return []
        return [_identity(200, state="S")]

    def _children(self):
        if self.clock.now < 1000.5:
            return None
        return [] if self.killed else [200]

    def _waitpid(self, pid, options):
        if pid == -1:
            raise ChildProcessError()
        if pid == 200:
            self.waits.append(pid)
            return (pid, 0)
        return (0, 0)

    def _waitid(self, which, pid, options):
        return None

    def _signal_group(self, pgid: int, number: int) -> str:
        self.signals.append(("group", pgid, number))
        if number == signal.SIGKILL:
            self.killed = True
        return "sent"

    def _signal_pid(self, pid: int, number: int) -> str:
        self.signals.append(("pid", pid, number))
        if number == signal.SIGKILL:
            self.killed = True
        return "sent"

    def _install(self) -> None:
        custodian.time = self.clock
        # The group probe is SCRIPTED here: the answer of this suite is that
        # the group is gone. It is an explicit implementation, never a default.
        custodian.os = _FakeOs(
            self.real_os, self._waitpid, self._waitid, killpg=_failing_killpg)
        custodian.read_process_identity = self._identity
        custodian.group_members = self._members
        custodian.direct_children = self._children
        custodian.signal_group = self._signal_group
        custodian.signal_pid = self._signal_pid

    # -- the cases ---------------------------------------------------------------

    def test_an_unreadable_worker_is_unknown_and_never_an_empty_domain(self) -> None:
        """The worker was forked: it is a target, and an unreadable one is UNKNOWN."""
        self._install()
        try:
            census = self.instance._target_census()
            self.assertTrue(census.unknown)
            self.assertFalse(census.settled)
            self.assertIn("the identity of the worker could not be read", census.reasons)
        finally:
            self.tearDown()

    def test_the_hard_signal_is_owed_and_is_sent_when_the_identity_returns(self) -> None:
        """The hard signal that is OWED is sent, in the same lifetime.

        The polite signal went to the exact unreaped child - the group of the
        worker was not known then, and a group that is not the worker's own is
        never aimed at. When the identity became readable, the group of the
        worker was the worker's OWN group, and the hard signal that was still
        owed went there.
        """
        self._install()
        try:
            result = self.instance._settle_domain()
            self.assertTrue(result["ok"])
            kinds = [entry[0] for entry in self.signals]
            # The polite signal went to the EXACT child: the group of the
            # worker was not the worker's own group yet.
            self.assertEqual(self.signals[0][0], "pid")
            self.assertEqual(self.signals[0][1], 200)
            self.assertEqual(self.signals[0][2], signal.SIGTERM)
            # The hard signal was sent ONCE, and it went to the group that was
            # verified in the meantime.
            self.assertEqual(kinds.count("group"), 1)
            self.assertEqual(kinds.count("pid"), 1)
            hard = [entry for entry in self.signals if entry[2] == signal.SIGKILL]
            self.assertEqual(len(hard), 1)
            self.assertEqual(hard[0][0], "group")
            self.assertEqual(hard[0][1], 200)
            # The worker was reaped, and it was reaped LAST.
            self.assertEqual(self.waits, [200])
        finally:
            self.tearDown()

    def test_a_second_pass_never_repeats_a_signal(self) -> None:
        """The actions are the state of ONE lifetime: they are never repeated."""
        self._install()
        try:
            self.instance._settle_domain()
            first = list(self.signals)
            self.instance._settle_domain()
            # The second pass added NOTHING: the polite signal and the hard
            # signal were sent once each.
            self.assertEqual(len(self.signals), len(first))
        finally:
            self.tearDown()


class TheAuthorityOfTheSignal(_RawEdgeGuardedCase):
    """The authority to signal the ORIGINAL worker of a draw.

    It is bound ONCE to the epoch of the fork, it is never refreshed by a
    later observation, and it is revoked FOR EVER when the anchor was reaped
    or when the number belongs to another process now.
    """

    def setUp(self) -> None:
        super().setUp()
        self.real_os = custodian.os
        self.real_time = custodian.time
        self.real_identity = custodian.read_process_identity
        self.real_members = custodian.group_members
        self.real_children = custodian.direct_children
        self.real_signal_group = custodian.signal_group
        self.real_signal_pid = custodian.signal_pid
        self.instance = custodian.Custodian()
        self.signals: list = []
        self.identities: dict = {}
        self.members: list | None = []
        self.children: list | None = []
        self.waits: list = []

    def tearDown(self) -> None:
        custodian.os = self.real_os
        custodian.time = self.real_time
        custodian.read_process_identity = self.real_identity
        custodian.group_members = self.real_members
        custodian.direct_children = self.real_children
        custodian.signal_group = self.real_signal_group
        custodian.signal_pid = self.real_signal_pid
        self.instance._selector.close()
        super().tearDown()
    # -- the mocked kernel ------------------------------------------------------

    def _identity(self, pid: int):
        return self.identities.get(pid, (None, "gone"))

    def _members(self, pgid: int):
        return self.members

    def _children(self):
        return self.children

    def _signal_group(self, pgid: int, number: int) -> str:
        self.signals.append(("group", pgid, number))
        return "sent"

    def _signal_pid(self, pid: int, number: int) -> str:
        self.signals.append(("pid", pid, number))
        return "sent"

    def _waitid(self, which, pid, options):
        return None

    def _echild_waitid(self, which, pid, options):
        raise ChildProcessError()

    def _waitpid(self, pid, options):
        if pid == -1:
            raise ChildProcessError()
        return (0, 0)

    def _install(self, waitid=None) -> None:
        custodian.time = _FakeClock(self.real_time)
        # The group probe is SCRIPTED here as well: the answer of this suite is
        # that the group is gone. It is an explicit implementation, never a
        # default.
        custodian.os = _FakeOs(
            self.real_os, self._waitpid,
            waitid if waitid is not None else self._waitid,
            killpg=_failing_killpg)
        custodian.read_process_identity = self._identity
        custodian.group_members = self._members
        custodian.direct_children = self._children
        custodian.signal_group = self._signal_group
        custodian.signal_pid = self._signal_pid

    def _bind(self, instance, identity: dict) -> None:
        instance.worker_pid = int(identity["pid"])
        instance.original_worker_epoch = identity
        instance.worker_identity = identity
        instance.signal_authority = "bound"

    # -- the cases ---------------------------------------------------------------

    def test_the_epoch_of_the_fork_is_bound_once_and_never_replaced(self) -> None:
        """The epoch of the fork is the authority, and it never changes."""
        instance = custodian.Custodian()
        try:
            first = _identity(200, start_ticks=100)
            second = _identity(200, start_ticks=999)
            self.assertTrue(instance._bind_original_epoch(first))
            self.assertFalse(instance._bind_original_epoch(second))
            self.assertEqual(str(instance.original_worker_epoch["start_ticks"]), "100")
            self.assertEqual(instance.signal_authority, "bound")
            # A later observation is a SNAPSHOT: it never changes what the fork
            # was, and it never replaces the epoch.
            instance.current_worker_observation = second
            self.assertEqual(str(instance.original_worker_epoch["start_ticks"]), "100")
            self.assertEqual(instance.signal_authority, "bound")
        finally:
            instance._selector.close()

    def test_the_reap_of_the_worker_revokes_the_authority_for_ever(self) -> None:
        """An anchor that was reaped may never be aimed at again."""
        instance = custodian.Custodian()
        try:
            self._bind(instance, _identity(200, start_ticks=100))
            instance.anchor_reaped = True
            decision = instance._authorise_signal("pid", 200)
            self.assertFalse(decision["allowed"])
            self.assertTrue(decision["permanent"])
            self.assertEqual(instance.signal_authority, "revoked")
        finally:
            instance._selector.close()

    def test_the_loss_of_the_wait_authority_revokes_the_signal_for_ever(self) -> None:
        """ECHILD means that this program is not the wait owner any more."""
        self._bind(self.instance, _identity(200, start_ticks=100))
        self.identities = {200: (_identity(200, start_ticks=100), "known")}
        self._install(waitid=self._echild_waitid)
        decision = self.instance._authorise_signal("pid", 200)
        self.assertFalse(decision["allowed"])
        self.assertTrue(decision["permanent"])
        self.assertTrue(self.instance.anchor_reaped)
        self.assertEqual(self.instance.signal_authority, "revoked")

    def test_a_reused_number_after_the_reap_is_never_signalled(self) -> None:
        """The number of a reaped worker belongs to somebody else now.

        The authority was lost with the anchor, and the action that is still
        OWED may never be spent on a substitute.
        """
        self._bind(self.instance, _identity(200, start_ticks=100))
        self.instance.anchor_reaped = True
        # The number was given to an UNRELATED process.
        self.identities = {200: (_identity(200, start_ticks=999), "known")}
        self.members = [_identity(200, start_ticks=999)]
        self.children = [200]
        self._install()
        result = self.instance._settle_domain()
        # NOTHING reached the kernel: the raw dispatch never happened.
        self.assertEqual(self.signals, [])
        self.assertFalse(result["ok"])
        self.assertTrue(result.get("unknown"))
        # And the refusal is a bounded fact, never a delivery.
        self.assertIn("refused-forbidden", " ".join(self.instance.signals))

    def test_a_group_that_could_not_be_asked_is_not_the_cached_group(self) -> None:
        """The group that was verified earlier is NEVER a fallback."""
        original = _identity(200, start_ticks=100)
        self._bind(self.instance, original)
        self.identities = {200: (original, "known")}
        # The group could not be enumerated.
        self.members = None
        self.children = [200]
        self._install()
        self.instance._settle_domain()
        kinds = [entry[0] for entry in self.signals]
        self.assertNotIn("group", kinds)
        # The exact child was aimed at instead, and only that.
        self.assertIn(("pid", 200, signal.SIGTERM), self.signals)

    def test_the_owed_hard_signal_goes_to_the_original_group_only_once(self) -> None:
        """The hard signal that is OWED is sent once, to the ORIGINAL group."""
        original = _identity(200, start_ticks=100)
        self._bind(self.instance, original)
        self.identities = {200: (original, "known")}
        self.members = [original]
        self.children = [200]
        self._install()
        # The polite signal was already sent: the hard one is OWED.
        self.instance._actions.term_sent = True
        self.instance._actions.deadline = 0.0
        self.instance._settle_domain()
        hard = [entry for entry in self.signals if entry[2] == signal.SIGKILL]
        self.assertEqual(len(hard), 1)
        self.assertEqual(hard[0][0], "group")
        self.assertEqual(hard[0][1], 200)
        # A second pass repeats NOTHING: the action is the state of ONE
        # lifetime.
        self.signals.clear()
        self.instance._settle_domain()
        self.assertEqual(self.signals, [])


class TheRevokedAuthorityStillProvesTheDomain(_RawEdgeGuardedCase):
    """The signal authority is revoked for ever, and the PROOF goes on.

    The two are SEPARATE things: this program may never aim at the number of
    the worker again, and it must still be able to PROVE that the original
    domain ended - the census, the reaping, the ECHILD, the group and the
    known identities.
    """

    def setUp(self) -> None:
        super().setUp()
        self.real_os = custodian.os
        self.real_time = custodian.time
        self.real_identity = custodian.read_process_identity
        self.real_members = custodian.group_members
        self.real_children = custodian.direct_children
        self.real_signal_group = custodian.signal_group
        self.real_signal_pid = custodian.signal_pid
        self.instance = custodian.Custodian()
        #: The RAW dispatch of the kernel: the calls that really reached
        #: os.killpg, with the number that was asked for.
        self.raw: list = []
        self.identities: dict = {}
        self.members: list | None = []
        self.children: list | None = []
        self.waits: list = []
        self.unknown_group = False
        #: The RAW PROBE of the group is UNKNOWN while the CENSUS of it is
        #: empty. They are two different facts, and a case that needs one of
        #: them says which one it needs.
        self.probe_unknown = False
        self.killpg_mode = "allow"

    def tearDown(self) -> None:
        custodian.os = self.real_os
        custodian.time = self.real_time
        custodian.read_process_identity = self.real_identity
        custodian.group_members = self.real_members
        custodian.direct_children = self.real_children
        custodian.signal_group = self.real_signal_group
        custodian.signal_pid = self.real_signal_pid
        self.instance._selector.close()
        super().tearDown()
    # -- the mocked kernel ------------------------------------------------------

    def _identity(self, pid: int):
        return self.identities.get(pid, (None, "gone"))

    def _members(self, pgid: int):
        if self.unknown_group:
            return None
        return self.members

    def _children(self):
        return self.children

    def _killpg(self, pgid: int, number: int) -> None:
        """The RAW group call of the kernel: the probe (0) and the signals."""
        self.raw.append(("group", pgid, number))
        if number == 0:
            # The PROBE of the group: it says whether the group still exists.
            if self.unknown_group or self.probe_unknown:
                raise OSError(errno.EIO, "the group could not be asked")
            if not self.members:
                raise ProcessLookupError()
            return
        if self.killpg_mode == "refuse":
            raise PermissionError(1, "the signal was refused")
        if self.killpg_mode == "allow-and-die":
            self.identities[200] = (None, "gone")
            self.members = []
            self.children = []
            return
        # The polite signal really ends the worker: it becomes a ZOMBIE, and
        # the anchor of the worker is still HELD by this program.
        self.identities[200] = (_identity(200, state="Z", start_ticks=100), "known")

    def _kill(self, pid: int, number: int) -> None:
        """The RAW call of the kernel for ONE process.

        It is mocked here for the same reason as the group one: a case of this
        file may never reach a real signal of this machine.
        """
        self.raw.append(("pid", pid, number))
        if self.killpg_mode == "refuse":
            raise PermissionError(1, "the signal was refused")
        if self.killpg_mode == "allow-and-die":
            self.identities[200] = (None, "gone")
            self.members = []
            self.children = []
            return
        self.identities[200] = (_identity(200, state="Z", start_ticks=100), "known")

    def _waitid(self, which, pid, options):
        return None

    def _waitpid(self, pid, options):
        if pid == -1:
            raise ChildProcessError()
        if pid == self.instance.worker_pid:
            identity, _state = self.identities.get(pid, (None, "gone"))
            if identity is None:
                # It was really consumed already: the wait for that number is
                # an ECHILD.
                raise ChildProcessError()
            if str(identity.get("state")) == "Z":
                # The zombie is REALLY consumed here: the anchor of the worker
                # is released by this wait and by no other.
                self.waits.append(pid)
                self.identities[pid] = (None, "gone")
                return (pid, 0)
            return (0, 0)
        return (0, 0)

    def _install(self) -> None:
        custodian.time = _FakeClock(self.real_time)
        fake_os = _FakeOs(self.real_os, self._waitpid, self._waitid)
        fake_os.killpg = self._killpg
        fake_os.kill = self._kill
        custodian.os = fake_os
        custodian.read_process_identity = self._identity
        custodian.group_members = self._members
        custodian.direct_children = self._children

    def _bind(self, identity: dict) -> None:
        self.instance.worker_pid = int(identity["pid"])
        self.instance.original_worker_epoch = identity
        self.instance.worker_identity = identity
        self.instance.signal_authority = "bound"

    # -- the cases ---------------------------------------------------------------

    def test_a_revoked_authority_still_proves_that_the_original_domain_ended(self) -> None:
        """TERM ends N; N is really reaped; the group probe is unknown.

        The owed hard signal is refused - the authority is gone with the
        anchor - and the domain is STILL proven gone afterwards, by the SAME
        responsibility. No substitute is ever signalled.
        """
        original = _identity(200, start_ticks=100)
        self._bind(original)
        self.identities = {200: (original, "known")}
        self.members = [original]
        self.children = [200]
        self._install()
        # The first pass: the polite signal really goes to the ORIGINAL group
        # (the raw dispatch is recorded), the worker becomes a zombie, and the
        # wait REALLY consumes it - the anchor is released HERE.
        first = self.instance._settle_domain()
        self.assertEqual(
            [call for call in self.raw if call[2] != 0],
            [("group", 200, signal.SIGTERM)],
        )
        self.assertFalse(first["ok"])
        self.assertIn(200, self.waits)
        self.assertTrue(self.instance.anchor_reaped)
        # The second pass: the group can no longer be enumerated and the owed
        # hard signal is refused, because the anchor was reaped. The refusal is
        # a bounded fact and NOT a delivery.
        self.unknown_group = True
        self.raw.clear()
        second = self.instance._settle_domain()
        self.assertFalse(second["ok"])
        # NOTHING reached the kernel after the reap.
        self.assertEqual([call for call in self.raw if call[2] != 0], [])
        self.assertEqual(self.instance.signal_authority, "revoked")
        # The anchor was really reaped: the held record says so, and it does
        # not claim that the anchor is still held.
        self.assertFalse(second["anchor_held"])
        # The third pass: the group probe recovers, and the domain is proven
        # gone by the SAME responsibility - the evidence collection was never
        # revoked with the signal authority.
        self.unknown_group = False
        self.members = []
        self.children = []
        third = self.instance._settle_domain()
        self.assertTrue(third["ok"], third)
        self.assertEqual([call for call in self.raw if call[2] != 0], [])
        # And the proof of the ORIGINAL group is a REAL raw probe of the
        # ORIGINAL group: it is not a default that says "gone".
        self.assertIn(("group", 200, 0), self.raw)

    def test_the_original_group_is_proved_by_a_raw_probe_after_the_revoke(self) -> None:
        """The ORIGINAL group is proved by a RAW probe, even after the revoke.

        The census of the group is EMPTY and the children are gone: those are
        two OTHER facts, and NEITHER of them is the proof that the ORIGINAL
        group is gone. The raw probe of the ORIGINAL group is UNKNOWN, so the
        domain stays HELD - and NO destructive signal is dispatched to
        anybody. The SAME responsibility converges when - and only when - the
        raw probe of the ORIGINAL group answers ESRCH.
        """
        original = _identity(200, start_ticks=100)
        self._bind(original)
        self.identities = {200: (original, "known")}
        self.members = [original]
        self.children = [200]
        self._install()
        # The first pass: the polite signal really goes to the ORIGINAL group,
        # the worker really becomes a zombie and the wait REALLY consumes it.
        first = self.instance._settle_domain()
        self.assertFalse(first["ok"])
        self.assertIn(200, self.waits)
        self.assertTrue(self.instance.anchor_reaped)
        # The second pass: the census of the group cannot be read, so the owed
        # hard signal is asked for - and it is REFUSED, because the anchor was
        # reaped. The destructive authority is revoked FOR EVER.
        self.unknown_group = True
        self.raw.clear()
        second = self.instance._settle_domain()
        self.assertFalse(second["ok"])
        self.assertEqual([call for call in self.raw if call[2] != 0], [])
        self.assertEqual(self.instance.signal_authority, "revoked")
        # The census RECOVERS: it is empty, and the children are gone. Those
        # are two OTHER facts, and NEITHER of them is the proof that the
        # ORIGINAL group is gone - the raw probe of it is UNKNOWN.
        self.unknown_group = False
        self.members = []
        self.children = []
        self.probe_unknown = True
        self.raw.clear()
        third = self.instance._settle_domain()
        # The domain is NOT proven gone: the proof of the ORIGINAL group is
        # missing, and the responsibility stays here.
        self.assertFalse(third["ok"])
        self.assertFalse(third["group_esrch"])
        # The ORIGINAL group REALLY was probed: the raw probe of the original
        # PGID is in the raw record.
        self.assertIn(("group", 200, 0), self.raw)
        # And NO destructive signal was dispatched: not to the ORIGINAL group,
        # and not to any replacement.
        self.assertEqual([call for call in self.raw if call[2] != 0], [])
        # The SAME responsibility converges when the raw probe answers ESRCH -
        # and it converges by that probe, and by nothing else.
        self.probe_unknown = False
        self.raw.clear()
        fourth = self.instance._settle_domain()
        self.assertTrue(fourth["ok"], fourth)
        self.assertTrue(fourth["group_esrch"])
        self.assertIn(("group", 200, 0), self.raw)
        self.assertEqual([call for call in self.raw if call[2] != 0], [])

    def test_a_persistent_refusal_keeps_the_debt_and_the_history_bounded(self) -> None:
        """A raw refusal never consumes the debt, and the facts stay bounded.

        The raw kernel call is the one that refuses - not a patch of the layer
        above it - and the retained history is bounded while the rounds are
        not.
        """
        original = _identity(200, start_ticks=100)
        self._bind(original)
        self.identities = {200: (original, "known")}
        self.members = [original]
        self.children = [200]
        self.killpg_mode = "refuse"
        self._install()
        for _ in range(40):
            self.instance._settle_domain()
        # The raw dispatch really happened, and it really was refused.
        self.assertGreater(len([call for call in self.raw if call[2] != 0]), 0)
        # The debt was NOT consumed: the polite signal is still owed.
        self.assertFalse(self.instance._actions.term_sent)
        self.assertFalse(self.instance._actions.kill_sent)
        # And the retained facts are BOUNDED: they did not grow with the
        # rounds. The bound is a CONSTANT of the program, and it is checked
        # after the semantic assertions so that the failure of the bound is
        # the SEMANTIC one.
        self.assertLessEqual(len(self.instance.signals), 32)
        # The refusal is never a delivery.
        self.assertTrue(all("sent" not in text for text in self.instance.signals))
        # The later delivery that IS allowed converges the same responsibility.
        self.killpg_mode = "allow-and-die"
        result = self.instance._settle_domain()
        self.assertTrue(result["ok"], result)
        # The saturation of the retained facts is COUNTED, and the bound is a
        # constant of the program.
        self.assertGreater(self.instance.signal_facts_total, len(self.instance.signals))
        self.assertEqual(custodian.MAX_RETAINED_SIGNAL_FACTS, 32)


class TheMonotonicAuthorisationOfADraw(_RawEdgeGuardedCase):
    """The authorisation of a draw is MONOTONE.

    The binding is SEALED and the ONE attempt is CONSUMED by the first legal
    authorisation, before any descriptor is allocated and before the fork.
    Neither is ever given back: a repeated authorisation, or one that arrives
    after the termination, changes no binding, allocates no descriptor and
    forks nothing.

    The cases below drive the ACTUAL control loop of this program with a REAL
    batch of messages, and they count the REAL attempts.
    """

    def _run_the_batch(self, messages: list[dict]) -> tuple[custodian.Custodian, list[dict]]:
        """Run the ACTUAL control loop over ONE batch of messages."""
        instance = custodian.Custodian()
        attempts: list[dict] = []
        batches = [list(messages)]

        class _Key:
            def __init__(self, data: str) -> None:
                self.data = data

        instance._selector.select = lambda timeout: [(_Key("control"), None)]
        instance._read_control = lambda: batches.pop(0) if batches else []
        instance._drain_worker_streams = lambda: None
        instance._flush_control = lambda: None
        instance._send = lambda payload, reserved=False: None

        def fake_spawn(node: str, worker: str, environment: dict) -> dict:
            attempts.append({"node": node, "worker": worker})
            stdout_read, stdout_write = os.pipe()
            stderr_read, stderr_write = os.pipe()
            exec_read, exec_write = os.pipe()
            for fd in (stdout_write, stderr_write, exec_write):
                try:
                    os.close(fd)
                except OSError:
                    pass
            return {
                "pid": 4242,
                "stdout_read": stdout_read,
                "stderr_read": stderr_read,
                "exec_read": exec_read,
            }

        instance._spawn_worker = fake_spawn
        try:
            instance._run_loop(time.monotonic() + 1.0)
        finally:
            instance._selector.close()
        return instance, attempts

    def _authorisation(self, draw_id: str = "draw-1") -> dict:
        return {
            "kind": "AUTHORIZE_FORK",
            "draw_id": draw_id,
            "ticket_digest": "ticket-1",
            "node_path": "/usr/bin/node",
            "worker_path": "/tmp/worker.mjs",
        }

    def test_two_authorisations_fork_at_most_once(self) -> None:
        # C06-ONESHOT: AUTH,AUTH. The SECOND authorisation changes no binding,
        # allocates no descriptor and forks nothing.
        instance, attempts = self._run_the_batch([self._authorisation(), self._authorisation()])
        # The SECOND authorisation forked nothing, and it changed no binding.
        self.assertEqual(len(attempts), 1)
        self.assertEqual(instance.draw_id, "draw-1")
        self.assertEqual(instance.authorization_state, "sealed")
        # And the refusal is a bounded protocol failure, not a fork.
        self.assertIsNotNone(instance._failure)

    def test_a_cancel_before_the_authorisation_forks_nothing(self) -> None:
        # C06-ONESHOT: CANCEL,AUTH. The authorisation that arrives after the
        # termination is refused, and there is no child at all.
        instance, attempts = self._run_the_batch([
            {"kind": "CANCEL"},
            self._authorisation(),
        ])
        # There is no child at all, and the authorisation that came after the
        # termination was refused.
        self.assertEqual(attempts, [])
        self.assertEqual(instance.authorization_state, "terminated")
        self.assertIsNotNone(instance._failure)

    def test_an_authorisation_before_the_cancel_forks_once(self) -> None:
        # C06-ONESHOT: AUTH,CANCEL. There is exactly one child, and the
        # cancel that follows does not fork a second one.
        instance, attempts = self._run_the_batch([
            self._authorisation(),
            {"kind": "CANCEL"},
        ])
        # There is exactly ONE child, and the cancel that followed did not
        # fork a second one.
        self.assertEqual(len(attempts), 1)
        self.assertEqual(instance.authorization_state, "terminated")

    def test_a_refused_authorisation_keeps_the_original_binding(self) -> None:
        # C06-ONESHOT: the binding of the FIRST legal authorisation is the
        # binding of the draw, and a refused one does not replace it.
        instance = custodian.Custodian()
        def fake_spawn(node: str, worker: str, environment: dict) -> dict:
            stdout_read, stdout_write = os.pipe()
            stderr_read, stderr_write = os.pipe()
            exec_read, exec_write = os.pipe()
            for fd in (stdout_write, stderr_write, exec_write):
                try:
                    os.close(fd)
                except OSError:
                    pass
            return {
                "pid": 4242,
                "stdout_read": stdout_read,
                "stderr_read": stderr_read,
                "exec_read": exec_read,
            }

        instance._spawn_worker = fake_spawn
        instance._authorize_fork(self._authorisation("draw-original"))
        self.assertEqual(instance.draw_id, "draw-original")
        self.assertEqual(instance.authorization_state, "sealed")
        self.assertTrue(instance.fork_attempt_consumed)
        # A second authorisation is refused, and it does not change anything.
        with self.assertRaises(custodian.CustodianFailure):
            instance._authorize_fork(self._authorisation("draw-other"))
        self.assertEqual(instance.draw_id, "draw-original")
        instance._selector.close()

    def test_a_fork_that_fails_keeps_the_attempt_consumed(self) -> None:
        # C06-ONESHOT: the attempt is consumed BEFORE the fork, and a fork
        # that really failed never gives it back.
        instance = custodian.Custodian()

        def failing_spawn(node: str, worker: str, environment: dict) -> dict:
            raise OSError(errno.EAGAIN, "the fork could not be made")

        instance._spawn_worker = failing_spawn
        try:
            with self.assertRaises(custodian.CustodianFailure):
                instance._authorize_fork(self._authorisation())
            self.assertEqual(instance.fork_attempt_state, "failed-no-child")
            self.assertEqual(instance.fork_errno, errno.EAGAIN)
            self.assertEqual(instance.startup_kind, custodian.STARTUP_FORK_FAILED)
            self.assertTrue(instance.fork_attempt_consumed)
            # And a second authorisation does not fork either.
            with self.assertRaises(custodian.CustodianFailure):
                instance._authorize_fork(self._authorisation())
        finally:
            instance._selector.close()


class TheStreamsOfTheWorker(_RawEdgeGuardedCase):
    """The facts of the streams of the worker, for the WHOLE lifetime.

    Every read goes through the ledger of its stream, so that the receipt
    carries the bytes that were REALLY read, the bounded tail, whether the end
    of the file was really seen, and the error that stopped the reading.
    """

    def test_the_end_of_the_file_is_registered_once(self) -> None:
        # C07-EOF: a read of ZERO bytes is the end of the file, and it is
        # registered once.
        instance = custodian.Custodian()
        read_fd, write_fd = os.pipe()
        try:
            os.set_blocking(read_fd, False)
            instance._worker_stdout_read = read_fd
            instance._worker_stderr_read = -1
            os.write(write_fd, b"hello")
            os.close(write_fd)
            instance._drain_worker_streams()
            # The bytes were really read, and the end of the file was really
            # seen.
            self.assertEqual(instance.stdout_ledger.bytes, 5)
            self.assertEqual(instance.stdout_ledger.facts()["tail_bytes"], 5)
            self.assertTrue(instance.stdout_ledger.eof)
            self.assertIsNone(instance.stdout_ledger.read_error)
            self.assertEqual(instance.stdout_ledger.disposition, custodian.STREAM_EOF)
            # And the end of the file is registered once: a second drain does
            # not change the facts.
            instance._drain_worker_streams()
            self.assertEqual(instance.stdout_ledger.disposition, custodian.STREAM_EOF)
            self.assertEqual(instance.stdout_ledger.bytes, 5)
        finally:
            instance._selector.close()
            try:
                os.close(read_fd)
            except OSError:
                pass

    def test_a_read_that_fails_is_NOT_the_end_of_the_file(self) -> None:
        # C07-EIO: a read error is kept as an error, and it is never read as
        # an end of file.
        instance = custodian.Custodian()
        read_fd, write_fd = os.pipe()
        try:
            os.set_blocking(read_fd, False)
            instance._worker_stdout_read = read_fd
            instance._worker_stderr_read = -1
            os.close(read_fd)
            instance._drain_worker_streams()
            self.assertFalse(instance.stdout_ledger.eof)
            self.assertIsNotNone(instance.stdout_ledger.read_error)
            self.assertEqual(instance.stdout_ledger.disposition, custodian.STREAM_READ_FAILED)
            # And the diagnostics are lost: the failure of a read is a fact.
            self.assertTrue(instance.diagnostics_lost)
        finally:
            instance._selector.close()
            try:
                os.close(write_fd)
            except OSError:
                pass

    def test_a_stream_that_was_never_opened_is_not_an_end_of_the_file(self) -> None:
        # C07-EOF: a stream that was never obtained has no bytes, no tail and
        # no end of file - it is NOT a stream that was read and that ended.
        ledger = custodian.OwnedStreamLedger("stdout")
        facts = ledger.facts()
        self.assertEqual(facts["ownership"], "not-opened")
        self.assertEqual(facts["bytes"], 0)
        self.assertEqual(facts["tail_bytes"], 0)
        self.assertFalse(facts["eof"])
        self.assertIsNone(facts["read_error"])
        self.assertEqual(facts["disposition"], custodian.STREAM_NOT_OPENED)


class TheShapesOfTheReceipt(_RawEdgeGuardedCase):
    """The shapes that the C writes and the Host parses.

    The identity of a process is its number AND its ticks, and the way an
    epoch ended is a fact of its own: the same number that was given to
    somebody else is not the same process, and a process that the ORIGINAL
    parent reaped is not a wait of this program.
    """

    def _instance(self) -> custodian.Custodian:
        instance = custodian.Custodian()
        self.addCleanup(instance._selector.close)
        return instance

    def test_the_identity_item_carries_the_full_epoch_and_its_completion(self) -> None:
        instance = self._instance()
        instance.identities[200] = {
            "pid": 200, "ppid": 100, "pgid": 200, "sid": 200, "start_ticks": 20,
        }
        instance._completions[200] = "waited-by-custodian"
        items = instance._receipt_items()
        identity = [item for item in items if item.get("t") == "i"]
        self.assertEqual(len(identity), 1)
        value = identity[0]["v"]
        self.assertEqual(value["pid"], 200)
        self.assertEqual(value["ppid"], 100)
        self.assertEqual(value["pgid"], 200)
        self.assertEqual(value["sid"], 200)
        self.assertEqual(value["start_ticks"], "20")
        self.assertEqual(value["completion"], "waited-by-custodian")

    def test_a_target_that_the_parent_reaped_is_not_a_wait_of_this_program(self) -> None:
        # The epoch is really gone and this program did NOT wait for it: the
        # completion says so, and it is not a wait.
        instance = self._instance()
        instance.identities[300] = {
            "pid": 300, "ppid": 100, "pgid": 300, "sid": 300, "start_ticks": 30,
        }
        original_identity = custodian.read_process_identity
        custodian.read_process_identity = lambda pid: (
            (None, "gone") if pid == 300 else original_identity(pid)
        )
        try:
            self.assertTrue(instance._known_targets_gone())
        finally:
            custodian.read_process_identity = original_identity
        self.assertEqual(instance._completions.get(300), "parent-reaped-observed-gone")
        items = instance._receipt_items()
        identity = [item for item in items if item.get("t") == "i"]
        self.assertEqual(identity[0]["v"]["completion"], "parent-reaped-observed-gone")

    def test_the_wait_item_carries_its_order_and_its_category(self) -> None:
        instance = self._instance()
        instance.worker_pid = 200
        instance.identities[200] = {
            "pid": 200, "ppid": 100, "pgid": 200, "sid": 200, "start_ticks": 20,
        }
        instance._completions[200] = "waited-by-custodian"
        instance._wait_ordinal = 3
        instance._worker_wait = {
            "pid": 200,
            "status": {"kind": "exited", "code": 0},
            "order": 3,
            "category": "worker",
            "epoch": instance._epoch_of(200),
        }
        instance.waits.append(dict(instance._worker_wait))
        items = instance._receipt_items()
        wait = [item for item in items if item.get("t") == "w"]
        self.assertEqual(len(wait), 1)
        value = wait[0]["v"]
        self.assertEqual(value["order"], 3)
        self.assertEqual(value["category"], "worker")
        self.assertEqual(value["epoch"]["start_ticks"], "20")
        self.assertEqual(value["status"]["kind"], "exited")

    def test_a_fork_that_failed_closes_every_parent_side_once(self) -> None:
        # The fork really failed: there is NO child, every parent side is
        # closed, and the streams were never inherited.
        instance = self._instance()
        original_fork = os.fork

        def failing_fork() -> int:
            raise OSError(errno.EAGAIN, "the fork could not be made")

        os.fork = failing_fork
        try:
            with self.assertRaises(OSError):
                instance._spawn_worker("/usr/bin/node", "/tmp/worker.mjs", {})
        finally:
            os.fork = original_fork
        self.assertEqual(instance.stdout_ledger.disposition, custodian.STREAM_NEVER_INHERITED)
        self.assertEqual(instance.stderr_ledger.disposition, custodian.STREAM_NEVER_INHERITED)
        self.assertTrue(instance.stdout_ledger.closed)
        self.assertFalse(instance.stdout_ledger.eof)

    def test_the_transcript_and_the_resources_are_two_different_facts(self) -> None:
        # A draw that really failed may have its resources really ended: the
        # FAILED proof holds, and the qualification of a RESULT does not.
        instance = self._instance()
        instance._failure = custodian.CustodianFailure("DIAGNOSTIC_BUDGET", "the worker wrote too much")
        instance.diagnostics_lost = True
        settlement = {
            "ok": True,
            "echild": True,
            "group_esrch": True,
            "known_ids_gone": True,
        }
        instance._worker_wait = {
            "pid": 200,
            "status": {"kind": "exited", "code": 0},
            "ordinal": 1,
            "category": "worker",
            "epoch": None,
        }
        instance._echild_after_wait_ordinal = 1
        instance._subreaper_before_fork = True
        instance._session_established = True
        instance.fork_attempt_state = "born"
        instance.stdout_ledger.disposition = custodian.STREAM_EOF
        instance.stderr_ledger.disposition = custodian.STREAM_EOF
        # The RESOURCES really ended.
        self.assertTrue(instance._resource_proof_complete(settlement))
        # And the RESULT is not qualified: the transcript did not survive.
        self.assertFalse(instance._transcript_complete(settlement))

    def test_a_late_wait_after_the_worker_refuses_the_result_but_keeps_the_end(self) -> None:
        # The worker was NOT the last process that was waited for: the result is
        # refused, and the FAILED proof of the resources still holds.
        instance = self._instance()
        instance._worker_wait = {
            "pid": 200,
            "status": {"kind": "exited", "code": 0},
            "ordinal": 1,
            "category": "worker",
            "epoch": None,
        }
        instance._post_worker_waits = 1
        instance._echild_after_wait_ordinal = 2
        instance._subreaper_before_fork = True
        instance._session_established = True
        instance.fork_attempt_state = "born"
        instance.stdout_ledger.disposition = custodian.STREAM_EOF
        instance.stderr_ledger.disposition = custodian.STREAM_EOF
        settlement = {
            "ok": True,
            "echild": True,
            "group_esrch": True,
            "known_ids_gone": True,
        }
        self.assertTrue(instance._resource_proof_complete(settlement))
        self.assertFalse(instance._transcript_complete(settlement))
        facts = instance._raw_tree_terminal(settlement)
        self.assertFalse(facts["worker_wait_was_last"])
        self.assertEqual(facts["post_worker_wait_count"], 1)

    def test_a_stream_that_wrote_too_much_keeps_its_budget_failure(self) -> None:
        # The budget of a stream is a STICKY fact: the bytes are counted, and
        # the failure is kept even when the domain really ended.
        #
        # The bytes live in a FILE: a pipe of 64KiB would block the writer
        # before the reader ever looks at it.
        instance = self._instance()
        handle, path = tempfile.mkstemp(prefix="narralens-stream-")
        try:
            os.write(handle, b"x" * (custodian.MAX_STREAM_BYTES + 1))
            os.close(handle)
            read_fd = os.open(path, os.O_RDONLY)
            try:
                instance._worker_stdout_read = read_fd
                instance._worker_stderr_read = -1
                # Every round of a stream is BOUNDED: the second round is
                # what reads the byte that broke the budget.
                instance._drain_worker_streams()
                instance._drain_worker_streams()
                # The bytes were really counted, and the budget failed.
                self.assertEqual(instance.stdout_ledger.bytes, custodian.MAX_STREAM_BYTES + 1)
                self.assertTrue(instance.diagnostics_lost)
            finally:
                instance._worker_stdout_read = -1
                os.close(read_fd)
        finally:
            instance._selector.close()
            try:
                os.unlink(path)
            except OSError:
                pass


if __name__ == "__main__":
    unittest.main()
