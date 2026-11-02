import { NarralensHost } from "../src/host/server.js";

for (let attempt = 0; attempt < 3; attempt += 1) {
  const started = Date.now();
  const host = new NarralensHost();
  const port = await host.listen(0);
  const listened = Date.now();
  const origin = `http://127.0.0.1:${port}`;
  await fetch(`${origin}/api/session`, { headers: { origin } });
  const fetched = Date.now();
  process.stdout.write(`listen=${listened - started}ms session=${fetched - listened}ms\n`);
  await host.close();
}
