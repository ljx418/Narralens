# Reconnecting

Three different things look like "the connection broke". They have different causes
and different fixes, and treating them as one is how a client ends up replaying
side effects.

## The Host is unreachable

Symptoms: `CAPABILITY_UNAVAILABLE` ("the host could not be reached"), or the MCP
transport itself fails to start.

1. Check the Host is up: `narralens_health_read`. If that call answers, the Host is
   up and the problem was transient.
2. If it does not answer, wait and retry with backoff — 1 s, 2 s, 4 s, 8 s, capped at
   30 s. Three attempts is usually enough to see a Host that is restarting.
3. Do **not** resend a call that creates or changes something until you have read
   back whether it took effect. A request that was accepted but whose answer was lost
   is not a failed request. Read the job, the run or the project state first; if the
   effect is there, do not send it again.
4. If the Host was restarted, its instance generation changed. Cursors and any
   assumption about the previous generation are stale: take a fresh snapshot.
5. A write that comes back as `PROVIDER_RESULT_UNKNOWN` follows the same rule, and
   adds one: keep the **original** idempotency key. Replaying under a new key is a
   new request, and it may apply the change twice.

## A cursor expired

Symptoms: `CURSOR_EXPIRED`.

A cursor expired because it was too old, or because its position fell out of the
retained event window. Either way the events it points at are gone.

1. Take a fresh snapshot (`narralens://projects/{id}/events-snapshot`, or the Host's
   snapshot route).
2. Rebuild the view from the snapshot. The snapshot is the state, not a delta.
3. Continue from the snapshot's cursor.

Do not retry the expired cursor. It will fail identically, and every attempt costs a
round trip.

## The MCP transport dropped

Symptoms: the client reports a closed transport, or a call never returns.

1. The transport is a child process. Check whether it is still alive before assuming
   the Host is down — the two are independent.
2. Reconnect by spawning a new server process and connecting again. The façade holds
   no state: a fresh process serves the same registry, and the Host's state lives in
   the Host.
3. After reconnecting, read the state again before acting. The window between the
   drop and the reconnect may have contained events, and the new server's snapshot
   will include them.

## What not to do

- Do not retry a write blindly after a disconnect. Read first.
- Do not keep an old cursor "just in case" and send it alongside a new one. Both are
  verified; a stale one is refused, and the refusal is the correct behaviour.
- Do not restart the Host to fix a cursor problem. The Host restarting invalidates
  cursors; it does not repair them.
- Do not treat a shared Host as yours to stop. Starting and stopping the Host is the
  launcher's decision, and a shared instance is not stopped by anyone.
