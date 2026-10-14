// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { HostApiClient } from "../../src/app/director/api/HostApiClient.js";
import type { AssetImportMetadata } from "../../src/contracts/types.js";

afterEach(() => vi.unstubAllGlobals());

describe("D4.2.1 HostApiClient", () => {
  it("sends a bounded two-part multipart import with JSON field semantics and exposes upload completion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "session-token" }),
      { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const client = new HostApiClient("http://127.0.0.1:4173");
    await client.start();
    let uploadComplete = false;
    const metadata: AssetImportMetadata = { idempotency_key: "ui-test-key",
      source: { kind: "owned", label: "camera" }, license: { status: "cleared", label: "owned", commercial_use: true } };
    const file = new File(["mp4"], "take.mp4", { type: "video/mp4" });
    const result = await client.importAsset("d1-30s", file, metadata, { onUploadComplete: () => { uploadComplete = true; } });
    const request = FakeXmlHttpRequest.last!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://127.0.0.1:4173/api/projects/d1-30s/assets/import");
    expect(request.headers.authorization).toBe("Bearer session-token");
    expect(request.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=----NarralensUpload/u);
    expect(request.body).toBeInstanceOf(Blob);
    const wire = await (request.body as Blob).text();
    expect(wire).toContain('name="metadata"\r\nContent-Type: application/json');
    expect(wire).toContain('name="file"; filename="upload.mp4"\r\nContent-Type: video/mp4');
    expect(wire).toContain(JSON.stringify(metadata));
    expect(wire).toContain("mp4");
    expect(uploadComplete).toBe(true);
    expect(result).toMatchObject({ asset_id: "asset_test", created: true });
  });
});

class FakeXmlHttpRequest extends EventTarget {
  static last: FakeXmlHttpRequest | undefined;
  readonly upload = new EventTarget();
  readonly headers: Record<string, string> = {};
  status = 201;
  responseText = JSON.stringify({ format: "narralens.asset-import-response@1.0", asset_id: "asset_test",
    manifest_format: "narralens.asset-manifest@2", manifest_sha256: "a".repeat(64), created: true, migrated_from_v1: false });
  method = "";
  url = "";
  body: Document | XMLHttpRequestBodyInit | null = null;

  constructor() { super(); FakeXmlHttpRequest.last = this; }
  open(method: string, url: string): void { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string): void { this.headers[name] = value; }
  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body ?? null;
    this.upload.dispatchEvent(new Event("load"));
    this.dispatchEvent(new Event("load"));
  }
  abort(): void { this.dispatchEvent(new Event("abort")); }
}
