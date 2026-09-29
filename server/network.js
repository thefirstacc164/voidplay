'use strict';

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

function frame(type, payload) {
  const body = packr.pack(payload === undefined ? null : payload);
  const buf = Buffer.allocUnsafe(1 + body.length);
  buf[0] = type;
  body.copy(buf, 1);
  return buf;
}

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

function send(ws, type, payload) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(frame(type, payload));
    } catch (err) {
    }
  }
}

module.exports = { MSG, KEY, packr, unpackr, frame, parse, send };
