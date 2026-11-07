/**
 * 相对路径: ./src/errors.js
 * 说明: 错误码定义与报告。
 *   新增 Lively 桥接相关错误码（00070-00073）。
 */

export const ERR = {
  '00001': 'bootstrap: entry initialization failed',
  '00002': 'bootstrap: importmap resolution failed',
  '00003': 'bootstrap: main frame loop failed',
  '00010': 'bus.js: construction failed',
  '00011': 'bus.js: register failed',
  '00012': 'bus.js: boot failed',
  '00013': 'bus.js: shutdown failed',
  '00014': 'bus.js: loadModule failed',
  '00015': 'bus.js: request failed',
  '00016': 'bus.js: tick handler threw',
  '00017': 'bus.js: emit handler threw',
  '00018': 'bus.js: circular dependency',
  '00019': 'bus.js: unregister failed',
  '00020': 'physics.js: bundle load failed',
  '00021': 'physics.js: bundle install failed',
  '00030': 'ui.js: bundle load failed',
  '00031': 'ui.js: bundle install failed',
  '00040': 'cache.js: bundle load failed',
  '00041': 'cache.js: bundle install failed',
  '00050': 'api.js: bundle load failed',
  '00051': 'api.js: bundle install failed',
  '00060': 'sun.js: createSunMesh failed',
  '00061': 'sun.js: shader compile failed',
  '00062': 'sun.js: invalid preset',

  // ★ Lively 桥接
  '00070': 'lively-bridge: getProperty failed',
  '00071': 'lively-bridge: handler failed',
  '00072': 'lively-bridge: install failed',
  '00073': 'lively-bridge: rebuildStarfield failed',

  '20001': 'core.state: init failed',
  '20010': 'physics.yoshida: init failed',
  '20011': 'physics.yoshida: update failed',
  '20012': 'physics.constraints: init failed',
  '20013': 'physics.constraints: update failed',
  '20014': 'perf.monitor: init failed',
  '20015': 'perf.monitor: update failed',
  '20020': 'camera.controller: init failed',
  '20021': 'camera.controller: start failed',
  '20022': 'camera.controller: update failed',
  '20023': 'render.main: init failed',
  '20024': 'render.main: update failed',
  '20025': 'render.postfx: init failed',
  '20026': 'render.postfx: update failed',
  '20027': 'ui.overlay: init failed',
  '20030': 'cache.seed: init failed',
  '20031': 'cache.texture: init failed',
  '20032': 'cache.trajectory: init failed',
  '20033': 'cache.trajectory: update failed',
  '20040': 'api.dom: init failed',
  '20041': 'api.storage: init failed',
  '20042': 'api.wasm: init failed',

  '30001': 'core.state.zeroMomentum: computation failed',
  '30002': 'core.state.centroid: computation failed',
  '30003': 'core.state.maxRadius: computation failed',
  '30004': 'core.state.commit: buffer swap failed',
  '30010': 'physics.yoshida._verlet: verlet step failed',
  '30011': 'physics.yoshida._accel: force computation failed',
  '30012': 'physics.constraints.update: constraint application failed',
  '30013': 'physics.constraints.reset: state reset failed',
  '30014': 'perf.monitor._energy: energy computation failed',
  '30015': 'perf.monitor._angularMomentum: angular momentum computation failed',
  '30020': 'camera.controller._onPointerDown: handler failed',
  '30021': 'camera.controller._onPointerMove: handler failed',
  '30022': 'camera.controller._onPointerUp: handler failed',
  '30023': 'camera.controller._onWheel: handler failed',
  '30024': 'camera.controller._onDoubleClick: focus raycast failed',
  '30025': 'camera.controller: focus smoothing failed',
  '30030': 'render.main._buildStarfield: construction failed',
  '30031': 'render.postfx.update: composer render failed',
  '30032': 'ui.overlay._iconButton: button construction failed',
  '30033': 'ui.overlay._iconButton: audio trigger failed',
  '30040': 'cache.seed.hash: hash failed',
  '30041': 'cache.seed.next: PRNG step failed',
  '30042': 'cache.trajectory.update: buffer write failed',
  '30050': 'api.dom.raf: rAF dispatch failed',
  '30051': 'api.storage.get: read failed',
  '30052': 'api.storage.set: write failed',
  '30053': 'api.wasm.load: instantiation failed',
  '30054': 'api.audio.click: audio synthesis failed',
  '30055': 'api.audio.tone: audio synthesis failed',
  '30060': 'sun.js.updateFlares: flare update failed',
  '30061': 'sun.js.updateProminences: prominence update failed',
  '30062': 'sun.js.update: uniform push failed',
  '30063': 'sun.js.setLevel: LOD swap failed',
  '30064': 'sun.js._validateParams: invalid parameters',
  '30065': 'sun.js._validateUniforms: uniform length mismatch',
};

const SEEN = new Set();

function ctxKey(ctx) {
  if (!ctx) return '';
  try {
    return Object.keys(ctx).sort().map(k => `${k}=${String(ctx[k])}`).join('|');
  } catch { return '?'; }
}

export function reportError(code, err, ctx = {}) {
  const msg  = ERR[code] || 'unknown error';
  const key  = `${code}::${ctxKey(ctx)}`;
  const head = `[${code}] ${msg}`;
  if (SEEN.has(key)) { console.error(`${head}  (repeat)`); return; }
  SEEN.add(key);
  console.error(head);
  if (ctx && Object.keys(ctx).length > 0) console.error('  context:', ctx);
  if (err !== undefined && err !== null) {
    console.error('  error:', err);
    if (err.stack) console.error('  stack:\n', err.stack);
  }
}

export function resetSeen() { SEEN.clear(); }

export function guard(code, fn) {
  return function (...args) {
    try { return fn.apply(this, args); }
    catch (err) { reportError(code, err, { argsCount: args.length }); throw err; }
  };
}

export function guardAsync(code, fn) {
  return async function (...args) {
    try { return await fn.apply(this, args); }
    catch (err) { reportError(code, err, { argsCount: args.length }); throw err; }
  };
}