# Narralens skill library

Reusable fragments for skills that talk to the Narralens Host. The entry skill
(`skills/narralens/SKILL.md`) is the one an agent loads; the fragments here are the
parts that more than one skill needs, kept apart so they can be corrected once.

| fragment | what it is |
|---|---|
| `lib/agent-registry.ts` | The typed view of the frozen registry: tool names, resource URIs, route metadata and the error table, read from the same modules the façade uses. |
| `lib/errors.md` | The contract's error codes, what each one means and what to do about it. |
| `lib/reconnect.md` | What to do when the Host is unreachable, a cursor expires or a call is interrupted. |

## Using the registry view

```ts
import { exposedToolNames, AGENT_RESOURCES, errorCodeForStatus } from "./lib/agent-registry.js";

exposedToolNames();       // the exact tool allowlist, in registry order
AGENT_RESOURCES;          // the resource URIs and the route each projects from
errorCodeForStatus(410);  // "CURSOR_EXPIRED"
```

The view is built from `contracts/agent-driven-a.registry.json` and the production
validator, so it cannot drift from what the façade actually exposes. If the contract
changes, the view throws at load time instead of describing the old surface.

## What this library does not do

It does not talk to the Host, does not start processes and does not hold credentials.
It is a description of the contract surface plus the runbooks for handling its
failures. Starting the server is `skills/narralens/bin/narralens-mcp.mjs`.
