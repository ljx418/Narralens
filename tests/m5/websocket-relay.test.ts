import { describe, expect, it } from "vitest";
import { OPCODE, decodeFrames, encodeClientFrame, encodeFrame } from
  "../../src/host/m5/websocket-relay.js";

describe("M5 WebSocket relay framing", () => {
  it("masks every client-to-upstream frame and decodes the original payload", () => {
    const payload = Buffer.from('{"visible":true}', "utf8");
    const encoded = encodeClientFrame(OPCODE.text, payload, Buffer.from([1, 2, 3, 4]));
    expect(encoded[1]! & 0x80).toBe(0x80);
    const decoded = decodeFrames(encoded);
    expect(decoded.rest).toHaveLength(0);
    expect(decoded.frames).toEqual([{ opcode: OPCODE.text, payload }]);
  });

  it("keeps an incomplete frame buffered and forwards a complete server frame unmasked", () => {
    const encoded = encodeFrame(OPCODE.text, Buffer.from("event", "utf8"));
    const first = decodeFrames(encoded.subarray(0, 3));
    expect(first.frames).toHaveLength(0);
    const second = decodeFrames(Buffer.concat([first.rest, encoded.subarray(3)]));
    expect(second.rest).toHaveLength(0);
    expect(second.frames[0]?.payload.toString("utf8")).toBe("event");
    expect(encoded[1]! & 0x80).toBe(0);
  });
});
