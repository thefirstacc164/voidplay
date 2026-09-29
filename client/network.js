(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VP = root.VP || {};
  root.VP.net = api.net;
  root.VP.msgpack = api.msgpack;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TE = new TextEncoder();
  const TD = new TextDecoder('utf-8');

  function Reader(u8) { this.u8 = u8; this.p = 0; }

  Reader.prototype.take = function (n) {
    if (this.p + n > this.u8.length) throw new Error('msgpack: truncated');
    const s = this.u8.subarray(this.p, this.p + n);
    this.p += n;
    return s;
  };

  Reader.prototype.readArray = function (n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = this.read();
    return a;
  };

  Reader.prototype.readMap = function (n) {
    const o = {};
    for (let i = 0; i < n; i++) { const k = this.read(); o[k] = this.read(); }
    return o;
  };

  Reader.prototype.readBigIntBE = function (n, signed) {
    let v = 0n;
    for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(this.u8[this.p + i]);
    this.p += n;
    if (signed && v >= 1n << BigInt(n * 8 - 1)) v -= 1n << BigInt(n * 8);
    return v;
  };

  Reader.prototype.readFloat = function (n) {
    const dv = new DataView(this.u8.buffer, this.u8.byteOffset + this.p, n);
    this.p += n;
    return n === 4 ? dv.getFloat32(0, false) : dv.getFloat64(0, false);
  };

  Reader.prototype.read = function () {
    const b = this.u8[this.p++];
    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 256;
    if (b >= 0xa0 && b <= 0xbf) return TD.decode(this.take(b & 0x1f));
    if (b >= 0x90 && b <= 0x9f) return this.readArray(b & 0x0f);
    if (b >= 0x80 && b <= 0x8f) return this.readMap(b & 0x0f);
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xcc: return this.take(1)[0];
      case 0xcd: { const t = this.take(2); return (t[0] << 8) | t[1]; }
      case 0xce: { const t = this.take(4); return ((t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]) >>> 0; }
      case 0xcf: return Number(this.readBigIntBE(8, false));
      case 0xd0: { const v = this.take(1)[0]; return v < 128 ? v : v - 256; }
      case 0xd1: { const t = this.take(2); const v = (t[0] << 8) | t[1]; return v < 32768 ? v : v - 65536; }
      case 0xd2: { const t = this.take(4); return (t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]; }
      case 0xd3: return Number(this.readBigIntBE(8, true));
      case 0xca: return this.readFloat(4);
      case 0xcb: return this.readFloat(8);
      case 0xd9: return TD.decode(this.take(this.take(1)[0]));
      case 0xda: { const t = this.take(2); return TD.decode(this.take((t[0] << 8) | t[1])); }
      case 0xdb: { const t = this.take(4); return TD.decode(this.take(((t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]) >>> 0)); }
      case 0xdc: { const t = this.take(2); return this.readArray((t[0] << 8) | t[1]); }
      case 0xdd: { const t = this.take(4); return this.readArray(((t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]) >>> 0); }
      case 0xde: { const t = this.take(2); return this.readMap((t[0] << 8) | t[1]); }
      case 0xdf: { const t = this.take(4); return this.readMap(((t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]) >>> 0); }
      case 0xc4: return this.take(this.take(1)[0]);
      case 0xc5: { const t = this.take(2); return this.take((t[0] << 8) | t[1]); }
      case 0xc6: { const t = this.take(4); return this.take(((t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]) >>> 0); }
      default: throw new Error('msgpack: unsupported code 0x' + b.toString(16));
    }
  };

  const f64buf = new DataView(new ArrayBuffer(8));

  function encNumber(v, out) {
    if (Number.isInteger(v)) {
      if (v >= 0 && v < 128) { out.push(v); return; }
      if (v < 0 && v >= -32) { out.push(v & 0xff); return; }
      if (v > 0) {
        if (v < 256) { out.push(0xcc, v); return; }
        if (v < 65536) { out.push(0xcd, v >> 8, v & 0xff); return; }
        if (v <= 4294967295) { out.push(0xce, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return; }
      } else {
        if (v >= -128) { out.push(0xd0, v & 0xff); return; }
        if (v >= -32768) { out.push(0xd1, (v >> 8) & 255, v & 0xff); return; }
        if (v >= -2147483648) { out.push(0xd2, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return; }
      }
    }
    f64buf.setFloat64(0, v, false);
    out.push(0xcb);
    for (let i = 0; i < 8; i++) out.push(f64buf.getUint8(i));
  }

  function enc(v, out) {
    if (v === null || v === undefined) { out.push(0xc0); return; }
    const t = typeof v;
    if (t === 'boolean') { out.push(v ? 0xc3 : 0xc2); return; }
    if (t === 'number') { encNumber(v, out); return; }
    if (t === 'string') {
      const b = TE.encode(v);
      const n = b.length;
      if (n < 32) out.push(0xa0 | n);
      else if (n < 256) out.push(0xd9, n);
      else if (n < 65536) out.push(0xda, n >> 8, n & 0xff);
      else out.push(0xdb, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      for (let i = 0; i < n; i++) out.push(b[i]);
      return;
    }
    if (Array.isArray(v)) {
      const n = v.length;
      if (n < 16) out.push(0x90 | n);
      else if (n < 65536) out.push(0xdc, n >> 8, n & 0xff);
      else out.push(0xdd, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      for (let i = 0; i < n; i++) enc(v[i], out);
      return;
    }
    if (v instanceof Uint8Array) {
      const n = v.length;
      if (n < 256) out.push(0xc4, n);
      else if (n < 65536) out.push(0xc5, n >> 8, n & 0xff);
      else out.push(0xc6, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      for (let i = 0; i < n; i++) out.push(v[i]);
      return;
    }
    const keys = Object.keys(v);
    const n = keys.length;
    if (n < 16) out.push(0x80 | n);
    else if (n < 65536) out.push(0xde, n >> 8, n & 0xff);
    else out.push(0xdf, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
    for (let i = 0; i < n; i++) { enc(keys[i], out); enc(v[keys[i]], out); }
  }

  const msgpack = {
    encode(value) {
      const out = [];
      enc(value, out);
      return new Uint8Array(out);
    },
    decode(u8, startPos) {
      const r = new Reader(u8);
      if (startPos) r.p = startPos;
      const value = r.read();
      return { value, pos: r.p };
    },
  };

  const MSG = { INPUT: 1, STATE: 2, ROOM: 3, SOCIAL: 4 };

  const net = {
    ws: null,
    connected: false,
    deliberatelyClosed: false,
    _seq: 0,
    _ping: 0,
    _sendT: new Float64Array(64),
    _sendSeq: new Int32Array(64).fill(-1),
    _handlers: {},
    _inputTimer: 0,
    _inputFn: null,
    _reconnectDelay: 500,
  };

  function fire(type, payload) {
    const list = net._handlers[type];
    if (list) for (let i = 0; i < list.length; i++) list[i](payload);
  }

  function onOpen() {
    net.connected = true;
    net._reconnectDelay = 500;
    net._sendSeq.fill(-1);
    net._ping = 0;
    fire('open', null);
  }

  function updatePing(ack) {
    if (!(ack > 0)) return;
    const slot = ack % 64;
    if (net._sendSeq[slot] === ack) {
      const rtt = performance.now() - net._sendT[slot];
      if (rtt >= 0 && rtt < 10000) net._ping = net._ping ? net._ping * 0.8 + rtt * 0.2 : rtt;
    }
  }

  function onFrame(ev) {
    const u8 = new Uint8Array(ev.data);
    if (u8.length < 1) return;
    const type = u8[0];
    let payload = null;
    try {
      if (u8.length > 1) payload = msgpack.decode(u8, 1).value;
    } catch (err) {
      return;
    }
    if (type === MSG.STATE) updatePing(payload && payload.a);
    fire(type, payload);
  }

  net.connect = function () {
    net.deliberatelyClosed = false;
    if (net.ws) { try { net.ws.close(); } catch (e) { /* noop */ } }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host + '/ws');
    net.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = onOpen;
    ws.onmessage = onFrame;
    ws.onclose = function () {
      const wasConnected = net.connected;
      net.connected = false;
      fire('close', { wasConnected });
      if (!net.deliberatelyClosed) {
        setTimeout(() => { if (!net.deliberatelyClosed) net.connect(); }, net._reconnectDelay);
        net._reconnectDelay = Math.min(5000, net._reconnectDelay * 2);
      }
      if (!wasConnected) { /* never opened; reconnect loop keeps trying */ }
    };
    ws.onerror = function () { try { ws.close(); } catch (e) { /* noop */ } };
  };

  net.close = function () {
    net.deliberatelyClosed = true;
    net.stopInputs();
    if (net.ws) { try { net.ws.close(); } catch (e) { /* noop */ } }
  };

  net.on = function (type, fn) {
    (net._handlers[type] = net._handlers[type] || []).push(fn);
  };

  net.send = function (type, payload) {
    if (!net.ws || net.ws.readyState !== 1) return false;
    const body = msgpack.encode(payload);
    const frame = new Uint8Array(1 + body.length);
    frame[0] = type;
    frame.set(body, 1);
    net.ws.send(frame);
    return true;
  };

  net.sendInput = function (keys) {
    net._seq = (net._seq + 1) >>> 0;
    const seq = net._seq;
    const slot = seq % 64;
    net._sendT[slot] = performance.now();
    net._sendSeq[slot] = seq;
    net.send(MSG.INPUT, [keys & 63, seq]);
  };

  net.peekSeq = function () { return net._seq + 1; };

  net.startInputs = function (getKeys) {
    net._inputFn = getKeys;
    if (!net._inputTimer) {
      net._inputTimer = setInterval(() => {
        if (net.ws && net.ws.readyState === 1) net.sendInput(net._inputFn ? net._inputFn() : 0);
      }, 50);
    }
  };

  net.stopInputs = function () {
    if (net._inputTimer) { clearInterval(net._inputTimer); net._inputTimer = 0; }
  };

  net.ping = function () { return Math.round(net._ping); };
  net.MSG = MSG;

  return { net, msgpack, MSG };
});
