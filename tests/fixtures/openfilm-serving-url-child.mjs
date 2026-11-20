/**
 * The real owned serving, and a RAW request target that no client library sends.
 *
 * It is a child process on purpose: the request target `//[` is not something a
 * client may send, and the case is about what the serving DOES with it - so the
 * child has to be able to die (or not) without taking the whole test run with it.
 *
 * It starts the FIXED pinned serving on its own loopback listener, sends the raw
 * targets over a plain TCP socket (never `fetch`, never `http.request`: they would
 * normalise the target before it reached the server), and reports what came back.
 *
 * argv: <vendorRoot> <projectDir>
 */
import { connect } from "node:net";

const [vendorRoot, projectDir] = process.argv.slice(2);
if (!vendorRoot || !projectDir) {
  process.stderr.write("INVALID_ARGUMENTS\n");
  process.exit(2);
}

// Run through tsx: the production module is TypeScript with `.js` import specifiers.
const adapter = await import("tsx/esm").then(
  async () => import("../../src/adapters/openfilm/openfilm-upstream.ts"),
);

const PAGE_ORIGIN_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; frame-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'",
};

const producer = await adapter.createPinnedOpenFilmCacheProducer(vendorRoot);
const owner = await adapter.createPinnedOpenFilmServingOwner(producer, projectDir, { headers: PAGE_ORIGIN_HEADERS });
const port = Number(new URL(owner.origin).port);

/** One raw request, written by hand on a plain socket. */
const raw = (target, host) => new Promise((done, failed) => {
  const socket = connect(port, "127.0.0.1");
  let text = "";
  socket.setEncoding("utf8");
  socket.once("connect", () => {
    socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  });
  socket.on("data", chunk => { text += chunk; });
  socket.once("error", failed);
  socket.once("close", () => done(text));
});

const report = { port };
try {
  // The malformed target: it must be REFUSED, by the serving itself, with the
  // policy headers on the answer.
  report.badTarget = await raw("//[", `127.0.0.1:${port}`);
  // The same serving, right after: a legal asset must still be answered.
  report.good = await raw("/hello.txt", `127.0.0.1:${port}`);
  // A Host that is not this listener's own: refused.
  report.wrongHost = await raw("/hello.txt", `evil.example:${port}`);
  // A path out of the root: refused.
  report.escape = await raw("/../outside.txt", `127.0.0.1:${port}`);
  // A file that is not there: refused.
  report.absent = await raw("/nothing.txt", `127.0.0.1:${port}`);
} finally {
  // Everything this child started is released BEFORE it reports.
  await owner.close();
  await producer.close();
}
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(0);
