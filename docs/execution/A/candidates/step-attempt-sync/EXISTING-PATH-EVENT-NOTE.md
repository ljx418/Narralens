# Separate existing-path event note — not changed by factoring

Current recordStepAttempt existing-attempt branch updates StepAttempt and Run checkpoint/workflow_revision, then returns projectRun without tx.emit. New-attempt branch emits workflow.run.state_changed. The candidate intentionally preserves this original asymmetry.

For actual task worker progress, MAIN should separately decide/implement a correctly scoped event mirror for existing-attempt advancement, with original Run scope/input_digest/attempt and atomic outbox+cp event projection. Do not merely call a second async event transaction after step mutation, and do not emit duplicate new-attempt/task accepted facts on idempotent reserve replay. It is a separate semantic fix, not an automatic scope addition or a reason to hold this parity factoring at a new manual gate.

A focused positive should observe the current original update through actual Context/event cursor; negative rollback should leave checkpoint/event/job receipt unchanged if event insertion fails. No such test is claimed here. Original full-source SHA and verbatim callback hash are in candidate-manifest.json.
