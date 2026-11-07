/**
 * 相对路径: ./src/api.js
 * 说明: API 层。api.audio 增强：
 *   - init 预创建 AudioContext，监听全局首次手势解锁
 *   - click() 噪声 burst + 低频“咚”，音量更大更清脆
 *   - 新增 unlock() 供 UI pointerdown 抢先调用
 */

import { reportError } from './errors.js';

// ═══ api.dom ═══
const apiDom = {
  id: 'api.dom',
  provides: ['api.dom'],
  requires: [],
  priority: 0,

  async init(_bus) {
    this.window   = typeof window   !== 'undefined' ? window   : null;
    this.document = typeof document !== 'undefined' ? document : null;
    this._raf = this.window?.requestAnimationFrame?.bind(this.window)
             ?? ((cb) => setTimeout(() => cb(performance.now()), 16));
  },

  now() { return performance.now(); },

  raf(cb) {
    try { return this._raf(cb); }
    catch (err) { reportError('30050', err); return 0; }
  },

  canvas(id) { return this.document?.getElementById(id) ?? null; },

  on(target, event, handler, opts) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(event, handler, opts);
    return () => target.removeEventListener(event, handler);
  },

  viewport() {
    if (!this.window) return { w: 1920, h: 1080, dpr: 1 };
    return {
      w: this.window.innerWidth,
      h: this.window.innerHeight,
      dpr: this.window.devicePixelRatio || 1,
    };
  },
};

// ═══ api.storage ═══
const apiStorage = {
  id: 'api.storage',
  provides: ['api.storage'],
  requires: [],
  priority: 0,

  async init(_bus) {
    this._prefix = 'three-body:';
    this._memory = new Map();
    this._hasLS  = false;
    try {
      const probe = '__probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      this._hasLS = true;
    } catch {
      console.warn('[api.storage] localStorage unavailable, using memory');
    }
  },

  get(key, fallback = null) {
    const k = this._prefix + key;
    try {
      const raw = this._hasLS ? localStorage.getItem(k) : this._memory.get(k);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (err) { reportError('30051', err, { key }); return fallback; }
  },

  set(key, value) {
    const k = this._prefix + key;
    const raw = JSON.stringify(value);
    try {
      if (this._hasLS) localStorage.setItem(k, raw);
      else this._memory.set(k, raw);
    } catch (err) { reportError('30052', err, { key }); }
  },

  remove(key) {
    const k = this._prefix + key;
    try {
      if (this._hasLS) localStorage.removeItem(k);
      else this._memory.delete(k);
    } catch {}
  },
};

// ═══ api.audio ═══
const apiAudio = {
  id: 'api.audio',
  provides: ['api.audio'],
  requires: [],
  priority: 0,

  async init(_bus) {
    this._master  = 0.85;
    this._enabled = true;
    this._ctx     = null;

    const Ctx = (typeof window !== 'undefined')
      && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) return;

    try { this._ctx = new Ctx(); }
    catch { this._ctx = null; return; }

    const unlockOnce = () => this.unlock();
    ['pointerdown', 'touchstart', 'keydown'].forEach(evt => {
      window.addEventListener(evt, unlockOnce, { passive: true, capture: true });
    });
  },

  setEnabled(v) { this._enabled = !!v; },
  isEnabled()   { return this._enabled; },
  setMaster(v)  { this._master = Math.max(0, Math.min(1, v)); },

  unlock() {
    const ctx = this._ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  },

  click() {
    try {
      const ctx = this._ctx;
      if (!ctx || !this._enabled) return;

      if (ctx.state !== 'running') {
        ctx.resume().catch(() => {});
        return;
      }

      const t = ctx.currentTime;
      const master = this._master;

      // 噪声 burst
      const noiseDur = 0.035;
      const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * noiseDur));
      const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 1.8;

      const gN = ctx.createGain();
      gN.gain.setValueAtTime(0.0001, t);
      gN.gain.exponentialRampToValueAtTime(0.55 * master, t + 0.002);
      gN.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

      noise.connect(bp).connect(gN).connect(ctx.destination);
      noise.start(t);
      noise.stop(t + 0.05);

      // 低频咚
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.09);

      const gO = ctx.createGain();
      gO.gain.setValueAtTime(0.0001, t);
      gO.gain.exponentialRampToValueAtTime(0.35 * master, t + 0.003);
      gO.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

      osc.connect(gO).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    } catch (err) {
      reportError('30054', err);
    }
  },

  tone(freq, dur = 0.15, peak = 0.1, type = 'sine') {
    try {
      const ctx = this._ctx;
      if (!ctx || !this._enabled) return;
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => {});
        return;
      }

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);

      const gain = ctx.createGain();
      const p = peak * this._master;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(p, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (err) {
      reportError('30055', err, { freq });
    }
  },
};

// ═══ api.wasm（预留） ═══
const apiWasm = {
  id: 'api.wasm',
  provides: ['api.wasm'],
  requires: [],
  priority: 0,

  async init(_bus) {
    this._cache     = new Map();
    this._enabled   = false;
    this._supported = typeof WebAssembly === 'object';
  },

  isSupported() { return this._supported; },
  isEnabled()   { return this._enabled; },
  enable()      { this._enabled = true; },
  disable()     { this._enabled = false; },

  async load(url, imports = {}) {
    if (!this._supported) return null;
    if (this._cache.has(url)) return this._cache.get(url);

    const t = performance.now();
    try {
      const resp = await fetch(url);
      const type = resp.headers.get('content-type') || '';
      let instance;
      if (type.includes('application/wasm')) {
        const { instance: inst } = await WebAssembly.instantiateStreaming(resp, imports);
        instance = inst;
      } else {
        const buf = await resp.arrayBuffer();
        const { instance: inst } = await WebAssembly.instantiate(buf, imports);
        instance = inst;
      }
      const result = {
        instance, exports: instance.exports,
        loadMs: performance.now() - t,
      };
      this._cache.set(url, result);
      return result;
    } catch (err) {
      reportError('30053', err, { url });
      return null;
    }
  },

  async handle(cap, payload) {
    if (cap === 'api.wasm') {
      const url = payload?.url;
      if (!url) return null;
      return await this.load(url, payload.imports || {});
    }
  },
};

export const modules = [apiDom, apiStorage, apiAudio, apiWasm];

export default function install(bus) {
  try {
    for (const m of modules) bus.register(m);
    return modules.map(m => m.id);
  } catch (err) {
    reportError('00051', err, { bundle: 'api.js' });
    throw err;
  }
}