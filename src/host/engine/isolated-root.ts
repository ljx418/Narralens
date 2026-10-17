/**
 * Construction of an `AbsoluteServerPath`.
 *
 * The brand exists so a client can never supply a server path: only Host composition code
 * creates one, and adapters receive one rather than minting their own. The constructor lives
 * in its own module precisely so an architecture fitness test can assert that nothing under
 * `src/adapters/**` imports it.
 */

import type { AbsoluteServerPath } from "./engine-port.js";

export function absoluteServerPath(value: string): AbsoluteServerPath {
  return { [Symbol.for("narralens.AbsoluteServerPath")]: true, value } as unknown as AbsoluteServerPath;
}

export function isAbsoluteServerPath(value: unknown): value is AbsoluteServerPath {
  return typeof value === "object" && value !== null && "value" in value;
}
