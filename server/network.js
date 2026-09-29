'use strict';

/**
 * VOIDPLAY — server/network.js
 * ---------------------------------------------------------------------------
 * Binary wire protocol used by every WebSocket frame (server side).
 *
 *   FRAME = [ msgType (1 byte) ][ MessagePack payload ]
 *
 *   msgType:
 *     0x01  INPUT   client → server   [ keys (u8 bitmask), seq (int) ]
 *     0x02  STATE   server → client   { a: ackSeq, f: full?, d: stateDelta }
 *     0x03  ROOM    both directions   { e: eventName, ... }
 *     0x04  SOCIAL  both directions   { e: eventName, ... }
 *
 *   Input key bitmask:
 *     UP=1  DOWN=2  LEFT=4  RIGHT=8  ACTION1=16  ACTION2=32
 *
 * The Packr/Unpackr instances are configured with `useRecords: false` and
 * `moreTypes: false` so the payload is plain, portable MessagePack —
 * the small decoder in client/network.js reads it without needing any
 * browser-side dependency.
 * ---------------------------------------------------------------------------
 */

const { Packr, Unpackr } = require('msgpackr');

const MSG = Object.freeze({
  INPUT: 0x01,
  STATE: 0x02,
  ROOM: 0x03,
  SOCIAL: 0x04,
});

const KEY = Object.freeze({
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  ACTION1: 16,
  ACTION2: 32,
});

const packr = new Packr({ useRecords: false, moreTypes: false });
const unpackr = new Unpackr({ useRecords: false, moreTypes: false });

/** Build a binary frame: [type][msgpack payload]. */
function frame(type, payload) {
  const body = packr.pack(payload === undefined ? null : payload);
  const buf = Buffer.allocUnsafe(1 + body.length);
  buf[0] = type;
  body.copy(buf, 1);
  return buf;
}

/** Parse a received frame. Accepts Buffer / ArrayBuffer / Uint8Array. */
function parse(data) {
  let u8;
  if (Buffer.isBuffer(data)) {
    u8 = data;
  } else if (data instanceof Uint8Array) {
    u8 = data;
  } else if (data && data.byteLength !== undefined) {
    u8 = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
  } else {
    return null;
  }
  if (u8.length < 1) return null;
  const type = u8[0];
  let payload = null;
  if (u8.length > 1) {
    try {
      payload = unpackr.unpack(u8.subarray(1));
    } catch (err) {
      return null; // malformed frame — drop silently
    }
  }
  return { type, payload };
}

/** Send a framed binary message if the socket is open. */
function send(ws, type, payload) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(frame(type, payload));
    } catch (err) {
      /* socket died mid-send; the close handler will clean up */
    }
  }
}

module.exports = { MSG, KEY, packr, unpackr, frame, parse, send };
