/**
 * 相对路径: ./src/bus.js
 * 说明: 系统总线。修复：
 *   - loadModule 将相对路径规范化到 document.baseURI
 *   - emit 兼容 async handler
 *   - boot 中 init/start 分别使用 codes.init / codes.start
 *   - getStatus(id) 供渲染层查询模块实时状态
 *   - loadModule 兼容单模块与 bundle 两种形态
 */

import { reportError } from './errors.js';

const MODULE_CODES = {
  'core.state':          { init: '20001' },
  'physics.yoshida':     { init: '20010', update: '20011' },
  'physics.constraints': { init: '20012', update: '20013' },
  'perf.monitor':        { init: '20014', update: '20015' },
  'camera.controller':   { init: '20020', start: '20021', update: '20022' },
  'render.main':         { init: '20023', update: '20024' },
  'render.postfx':       { init: '20025', update: '20026' },
  'ui.overlay':          { init: '20027' },
  'cache.seed':          { init: '20030' },
  'cache.texture':       { init: '20031' },
  'cache.trajectory':    { init: '20032', update: '20033' },
  'api.dom':             { init: '20040' },
  'api.storage':         { init: '20041' },
  'api.wasm':            { init: '20042' },
};

function baseURI() {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  if (typeof location !== 'undefined' && location.href)     return location.href;
  return 'http://localhost/';
}

export class SimulationBus {
  constructor() {
    this._modules      = new Map();
    this._listeners    = new Map();
    this._capabilities = new Map();
    this._status       = new Map();
    this._booted       = false;
    this._frame        = 0;
    this._t0           = 0;
  }

  // ─── 注册 ────────────────────────────────────────────
  register(module) {
    try {
      if (!module || !module.id) throw new Error('module.id required');
      if (this._modules.has(module.id)) throw new Error(`duplicate id "${module.id}"`);

      this._modules.set(module.id, module);
      this._status.set(module.id, 'pending');

      if (Array.isArray(module.provides)) {
        for (const cap of module.provides) {
          if (!this._capabilities.has(cap)) this._capabilities.set(cap, []);
          this._capabilities.get(cap).push(module.id);
        }
      }
      this.emit('system.module.registered', { id: module.id });
    } catch (err) {
      reportError('00011', err, { moduleId: module?.id });
      throw err;
    }
  }

  unregister(id) {
    try {
      const m = this._modules.get(id);
      if (!m) return;
      if (Array.isArray(m.provides)) {
        for (const cap of m.provides) {
          const arr = this._capabilities.get(cap);
          if (!arr) continue;
          const i = arr.indexOf(id);
          if (i >= 0) arr.splice(i, 1);
        }
      }
      this._modules.delete(id);
      this._status.delete(id);
      this.emit('system.module.unregistered', { id });
    } catch (err) {
      reportError('00019', err, { moduleId: id });
    }
  }

  getModule(id) { return this._modules.get(id); }
  getStatus(id) { return this._status.get(id) || 'unknown'; }

  hasCapability(cap) {
    const arr = this._capabilities.get(cap);
    if (!arr) return false;
    return arr.some(id => this._status.get(id) === 'running');
  }

  // ─── 依赖拓扑 ────────────────────────────────────────
  _topoSort() {
    const nodes = [...this._modules.values()];
    const capProvider = new Map();
    for (const m of nodes) {
      for (const cap of m.provides || []) {
        if (!capProvider.has(cap)) capProvider.set(cap, []);
        capProvider.get(cap).push(m.id);
      }
    }
    const visited = new Set();
    const result  = [];
    const visit = (m, stack) => {
      if (!m) return;
      if (visited.has(m.id)) return;
      if (stack.has(m.id)) {
        reportError('00018', new Error(`circular at "${m.id}"`),
          { chain: [...stack, m.id].join('→') });
        return;
      }
      stack.add(m.id);
      for (const cap of m.requires || []) {
        for (const pid of capProvider.get(cap) || []) {
          visit(this._modules.get(pid), stack);
        }
      }
      stack.delete(m.id);
      visited.add(m.id);
      result.push(m);
    };
    for (const m of nodes) visit(m, new Set());
    return result;
  }

  // ─── 生命周期 ────────────────────────────────────────
  async boot() {
    if (this._booted) return;
    this._t0 = performance.now();
    this.emit('system.boot.begin', { moduleCount: this._modules.size });

    for (const m of this._topoSort()) {
      const codes = MODULE_CODES[m.id] || {};

      try {
        if (typeof m.init === 'function') await m.init(this);
      } catch (err) {
        reportError(codes.init || '00012', err, { moduleId: m.id, phase: 'init' });
        this._status.set(m.id, 'failed');
        this.emit('system.module.failed', { id: m.id, phase: 'init', error: String(err) });
        continue;
      }

      try {
        if (typeof m.start === 'function') await m.start(this);
      } catch (err) {
        reportError(codes.start || codes.init || '00012', err,
          { moduleId: m.id, phase: 'start' });
        this._status.set(m.id, 'failed');
        this.emit('system.module.failed', { id: m.id, phase: 'start', error: String(err) });
        continue;
      }

      this._status.set(m.id, 'running');
      this.emit('system.module.started', { id: m.id });
    }

    this._booted = true;
    this.emit('system.boot.done', {
      durationMs: performance.now() - this._t0,
      health: this.health(),
    });
  }

  async shutdown() {
    for (const m of this._topoSort().reverse()) {
      try {
        if (typeof m.stop === 'function')    await m.stop(this);
        if (typeof m.destroy === 'function') await m.destroy(this);
        this._status.set(m.id, 'stopped');
      } catch (err) {
        reportError('00013', err, { moduleId: m.id, phase: 'shutdown' });
      }
    }
    this._booted = false;
    this.emit('system.shutdown.done', {});
  }

  // ─── 事件 ────────────────────────────────────────────
  on(event, handler, priority = 0) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    const arr = this._listeners.get(event);
    arr.push({ handler, priority });
    arr.sort((a, b) => a.priority - b.priority);
    return () => this.off(event, handler);
  }

  once(event, handler, priority = 0) {
    const wrapped = (payload) => { this.off(event, wrapped); handler(payload); };
    return this.on(event, wrapped, priority);
  }

  off(event, handler) {
    const arr = this._listeners.get(event);
    if (!arr) return;
    const i = arr.findIndex(x => x.handler === handler);
    if (i >= 0) arr.splice(i, 1);
  }

  emit(event, payload) {
    const arr = this._listeners.get(event);
    if (!arr || arr.length === 0) return;
    for (const { handler } of arr) {
      try {
        const r = handler(payload);
        if (r && typeof r.then === 'function') {
          r.catch(err => reportError('00017', err, { event, async: true }));
        }
      } catch (err) {
        reportError('00017', err, { event });
      }
    }
  }

  // ─── 请求 / 响应 ────────────────────────────────────
  async request(capability, payload) {
    try {
      const ids = this._capabilities.get(capability) || [];
      if (ids.length === 0) throw new Error(`no provider for "${capability}"`);
      const mod = this._modules.get(ids[0]);
      if (typeof mod.handle !== 'function') throw new Error(`"${ids[0]}" has no handle()`);
      return await mod.handle(capability, payload, this);
    } catch (err) {
      reportError('00015', err, { capability });
      throw err;
    }
  }

  // ─── 帧驱动 ──────────────────────────────────────────
  tick(dt) {
    const running = [...this._modules.values()]
      .filter(m => this._status.get(m.id) === 'running')
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));

    this.emit('core.tick', { dt, frame: this._frame++ });

    for (const m of running) {
      if (typeof m.update !== 'function') continue;
      const codes = MODULE_CODES[m.id] || {};
      try {
        m.update(dt, this);
      } catch (err) {
        reportError(codes.update || '00016', err, { moduleId: m.id });
      }
    }
  }

  // ─── 健康 ────────────────────────────────────────────
  health() {
    const modules = {};
    for (const [id, s] of this._status) modules[id] = s;
    return {
      booted: this._booted,
      moduleCount: this._modules.size,
      modules,
      failed: Object.entries(modules)
        .filter(([, s]) => s === 'failed')
        .map(([id]) => id),
    };
  }

  // ─── 加载 bundle ────────────────────────────────────
  async loadModule(path) {
    let url;
    try {
      url = new URL(path, baseURI()).href;
    } catch (err) {
      reportError('00014', err, { path, phase: 'resolve' });
      throw err;
    }

    const t = performance.now();
    this.emit('system.module.loading', { path, url });

    try {
      const mod = await import(/* @vite-ignore */ url);
      const d = mod.default;

      let ids = [];
      if (typeof d === 'function') {
        const result = await d(this);
        if (Array.isArray(result)) ids = result;
      } else if (d && typeof d === 'object' && d.id) {
        this.register(d);
        ids = [d.id];
      } else {
        throw new Error(`invalid module shape at "${url}"`);
      }

      this.emit('system.module.loaded', {
        path, url, ids, durationMs: performance.now() - t,
      });
      return ids;
    } catch (err) {
      reportError('00014', err, { path, url });
      this.emit('system.module.failed', {
        path, url, phase: 'load', error: String(err),
      });
      throw err;
    }
  }
}

export default SimulationBus;