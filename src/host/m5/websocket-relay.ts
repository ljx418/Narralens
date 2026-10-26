import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";

/**
 * A minimal WebSocket relay (Wave 3 `04` §1, `02` §4).
 *
 * The Gateway has to carry the Studio's live event stream: the browser may only talk to
 * the Gateway's own origin, and the Studio's event stream is on the Studio's origin. Node
 * 22 ships a WebSocket *client* but no server, and the repository may not gain a
 * dependency (no network, and `02` §7 requires an ADR, a pinned version, a licence and a
 * lockfile for anything new). So the framing is implemented here, once, and it implements
 * exactly what the Studio's stream uses: text and binary data frames, ping, pong and
 * close, with no fragmentation (the upstream sends whole messages).
 *
 * It is deliberately small. A general-purpose WebSocket library would be more code than
 * the whole Gateway, and the point of the Gateway is to be auditable.
 */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const OPCODE = {
  continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa,
} as const;

export interface DecodedFrame {
  readonly opcode: number;
  readonly payload: Buffer;
}

/** The `Sec-WebSocket-Accept` value for a client's key. */
export function acceptValue(key: string): string {
  return createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
}

/**
 * Decode as many whole frames as the buffer holds.
 *
 * A partial frame stays in the buffer: a WebSocket frame can arrive in pieces, and
 * treating half a frame as a message would corrupt the stream.
 */
export function decodeFrames(buffer: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]!;
    const second = buffer[offset + 1]!;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      const big = buffer.readBigUInt64BE(cursor);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WEBSOCKET_FRAME_TOO_LARGE");
      length = Number(big);
      cursor += 8;
    }
    let mask: Buffer | undefined;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (cursor + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask !== undefined) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = payload[index]! ^ mask[index % 4]!;
      }
    }
    frames.push({ opcode, payload });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/** Encode one frame. Server-to-client frames are never masked. */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Pump the frames of one side into the other.
 *
 * The upstream connection is a built-in `WebSocket`, so its messages arrive whole; the
 * browser's side is a raw socket, so its frames are decoded here. Control frames (ping,
 * pong, close) are answered rather than forwarded, because the two sides have separate
 * keep-alives and forwarding one side's pong to the other would be a lie.
 */
export function relayFrames(source: AsyncIterable<unknown>, send: (frame: DecodedFrame) => void,
  onClose: () => void): void {
  void (async () => {
    try {
      for await (const message of source) {
        const payload = typeof message === "string" ? Buffer.from(message, "utf8")
          : message instanceof ArrayBuffer ? Buffer.from(message)
            : Buffer.from(message as Buffer);
        send({ opcode: OPCODE.text, payload });
      }
    } catch { /* the upstream went away: the close handler below ends the relay */ }
    onClose();
  })();
}

/** Write the 101 handshake onto a raw socket. */
export function writeHandshake(socket: Duplex, key: string, extraHeaders: Record<string, string> = {}): void {
  const lines = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptValue(key)}`,
    ...Object.entries(extraHeaders).map(([name, value]) => `${name}: ${value}`),
    "", "",
  ];
  socket.write(lines.join("\r\n"));
}
