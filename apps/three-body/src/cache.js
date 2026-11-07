/**
 * 相对路径: ./src/cache.js
 * 说明: 缓存层。cache.seed / cache.texture / cache.trajectory。
 *
 *   本次改动：
 *     ★ cache.trajectory 新增 setCapacity(n)，运行时重建缓冲区
 */

import { reportError } from './errors.js';

// ═══ cache.seed ═══
const cacheSeed = {
  id: 'cache.seed',
  provides: ['cache.seed'],
  requires: [],
  priority: 0,

  async init(_bus) {
    this._state = 0;
    this._seed  = 0;
    this.setSeed('THREE-BODY-DEFAULT');
  },

  hash(str) {
    try {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 16777619);
      }
      return h >>> 0;
    } catch (err) { reportError('30040', err); return 0; }
  },

  setSeed(seedStr) {
    this._seed  = this.hash(String(seedStr));
    this._state = this._seed >>> 0;
    return this._seed;
  },

  next() {
    try {
      let t = (this._state += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    } catch (err) { reportError('30041', err); return 0; }
  },

  range(min, max) { return min + this.next() * (max - min); },

  async handle(cap, payload) {
    if (cap === 'cache.seed') {
      if (payload?.seed !== undefined) return this.setSeed(payload.seed);
      return this._seed;
    }
  },
};

// ═══ cache.texture ═══
const cacheTexture = {
  id: 'cache.texture',
  provides: ['cache.texture'],
  requires: [],
  priority: 0,

  async init(_bus) { this._pool = new Map(); },

  get(key, factory) {
    if (this._pool.has(key)) return this._pool.get(key);
    const v = factory();
    this._pool.set(key, v);
    return v;
  },

  has(key) { return this._pool.has(key); },

  release(key) {
    const v = this._pool.get(key);
    if (v && typeof v.dispose === 'function') v.dispose();
    this._pool.delete(key);
  },

  clear() {
    for (const [, v] of this._pool) {
      if (v && typeof v.dispose === 'function') v.dispose();
    }
    this._pool.clear();
  },
};

// ═══ cache.trajectory ═══
const cacheTrajectory = {
  id: 'cache.trajectory',
  provides: ['cache.trajectory'],
  requires: ['core.state'],
  priority: 15,

  async init(bus) {
    this.state    = bus.getModule('core.state');
    this.capacity = 512;
    this._buffers = [];
    for (let i = 0; i < this.state.N; i++) {
      this._buffers.push({
        data: new Float32Array(this.capacity * 3),
        head: 0, size: 0,
      });
    }
  },

  update(_dt, _bus) {
    try {
      const N = this.state.N;
      const p = this.state.snapshot().positions;
      for (let i = 0; i < N; i++) {
        const buf = this._buffers[i];
        const idx = buf.head * 3;
        buf.data[idx + 0] = p[i*3 + 0];
        buf.data[idx + 1] = p[i*3 + 1];
        buf.data[idx + 2] = p[i*3 + 2];
        buf.head = (buf.head + 1) % this.capacity;
        if (buf.size < this.capacity) buf.size++;
      }
    } catch (err) { reportError('30042', err); }
  },

  // ★ 新增：运行时重建轨迹缓冲区
  setCapacity(n) {
    try {
      const nc = Math.max(128, Math.min(4096, Math.round(Number(n) || 512)));
      if (nc === this.capacity) return;
      this.capacity = nc;
      for (const b of this._buffers) {
        b.data = new Float32Array(nc * 3);
        b.head = 0;
        b.size = 0;
      }
    } catch (err) { reportError('30042', err, { n }); }
  },

  get(i) { return this._buffers[i]; },

  clear() {
    for (const b of this._buffers) { b.head = 0; b.size = 0; }
  },
};

export const modules = [cacheSeed, cacheTexture, cacheTrajectory];

export default function install(bus) {
  try {
    for (const m of modules) bus.register(m);
    return modules.map(m => m.id);
  } catch (err) {
    reportError('00041', err, { bundle: 'cache.js' });
    throw err;
  }
}