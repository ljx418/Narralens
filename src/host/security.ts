import { timingSafeEqual } from "node:crypto";

const loopbackNames = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isAllowedLoopbackOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    const target = new URL(`http://${host.toLowerCase()}`);
    const source = new URL(origin);
    return loopbackNames.has(target.hostname) && source.origin === target.origin;
  } catch {
    return false;
  }
}

export function isAllowedBrowserRequest(headers: { origin?: string; host?: string; referer?: string; secFetchSite?: string }): boolean {
  if (isAllowedLoopbackOrigin(headers.origin, headers.host)) return true;
  if (!headers.host || headers.secFetchSite !== "same-origin" || !headers.referer) return false;
  try {
    const target = new URL(`http://${headers.host.toLowerCase()}`);
    const source = new URL(headers.referer);
    return loopbackNames.has(target.hostname) && source.origin === target.origin;
  } catch { return false; }
}

export function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function assertProjectId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error("INVALID_PROJECT_ID");
  return value;
}
