/**
 * 相对路径: ./src/physics.js
 * 说明: 物理层，SYKM 风格。
 *   所有可调参数均为实例属性，支持 Lively 桥接运行时覆盖。
 *   timeScale = 7（SYKM 的 3 是其自身单位制下的倍率，不可直接搬）
 */

import { reportError } from './errors.js';

const N_BODIES = 3;
const G        = 1.0;
const X1 = 1 / (2 - Math.cbrt(2));
const X0 = 1 - 2 * X1;

const MASSES = [1.68, 1.40, 1.00];

const BASE_POSITIONS = [
  [-12.2, 0.0, -9.2],
  [  9.8, 0.0, -3.7],
  [ -1.2, 0.0,  7.3],
];

function generateInitialState() {
  const positions  = new Float64Array(9);
  const velocities = new Float64Array(9);

  for (let i = 0; i < 3; i++) {
    const jp = 1 + (Math.random() - 0.5) * 0.06;
    positions[i*3+0] = BASE_POSITIONS[i][0] * jp;
    positions[i*3+1] = BASE_POSITIONS[i][1] + (Math.random() - 0.5) * 1.5;
    positions[i*3+2] = BASE_POSITIONS[i][2] * jp;

    const v = 0.15 + Math.random() * 0.20;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);

    velocities[i*3+0] = v * Math.sin(phi) * Math.cos(theta);
    velocities[i*3+1] = v * Math.cos(phi) * 0.3;
    velocities[i*3+2] = v * Math.sin(phi) * Math.sin(theta);
  }

  return { positions, velocities };
}

// ═══ core.state ═══
const coreState = {
  id: 'core.state',
  provides: ['core.state'],
  requires: [],
  priority: 0,

  async init(_bus) {
    const N = N_BODIES;
    this.N = N;
    this.positions  = new Float64Array(N * 3);
    this.velocities = new Float64Array(N * 3);
    this.masses     = new Float64Array(MASSES);

    this._snapFront = {
      positions:  new Float64Array(N * 3),
      velocities: new Float64Array(N * 3),
      masses:     this.masses, N,
    };
    this._snapBack = {
      positions:  new Float64Array(N * 3),
      velocities: new Float64Array(N * 3),
      masses:     this.masses, N,
    };

    this._resetState();
    this.commit();
  },

  _resetState() {
    const { positions, velocities } = generateInitialState();
    this.positions.set(positions);
    this.velocities.set(velocities);
    this.zeroMomentum();
  },

  zeroMomentum() {
    try {
      const { N, masses: m, velocities: v } = this;
      let px = 0, py = 0, pz = 0, M = 0;
      for (let i = 0; i < N; i++) {
        px += m[i]*v[i*3+0]; py += m[i]*v[i*3+1]; pz += m[i]*v[i*3+2];
        M  += m[i];
      }
      for (let i = 0; i < N; i++) {
        v[i*3+0] -= px/M; v[i*3+1] -= py/M; v[i*3+2] -= pz/M;
      }
    } catch (err) { reportError('30001', err); throw err; }
  },

  centroid() {
    try {
      const { N, masses: m, positions: p } = this;
      let cx = 0, cy = 0, cz = 0, M = 0;
      for (let i = 0; i < N; i++) {
        cx += m[i]*p[i*3+0]; cy += m[i]*p[i*3+1]; cz += m[i]*p[i*3+2];
        M  += m[i];
      }
      return [cx/M, cy/M, cz/M];
    } catch (err) { reportError('30002', err); return [0,0,0]; }
  },

  maxRadius(center) {
    try {
      const { N, positions: p } = this;
      let R2 = 0;
      for (let i = 0; i < N; i++) {
        const dx = p[i*3+0]-center[0];
        const dy = p[i*3+1]-center[1];
        const dz = p[i*3+2]-center[2];
        const r2 = dx*dx + dy*dy + dz*dz;
        if (r2 > R2) R2 = r2;
      }
      return Math.sqrt(R2);
    } catch (err) { reportError('30003', err); return 0; }
  },

  commit() {
    try {
      const back = this._snapBack;
      back.positions.set(this.positions);
      back.velocities.set(this.velocities);
      const t = this._snapFront;
      this._snapFront = back;
      this._snapBack  = t;
    } catch (err) { reportError('30004', err); throw err; }
  },

  snapshot() { return this._snapFront; },
};

// ═══ physics.yoshida ═══
const physicsYoshida = {
  id: 'physics.yoshida',
  provides: ['physics.step'],
  requires: ['core.state'],
  priority: 10,

  async init(bus) {
    this.state = bus.getModule('core.state');
    this.G     = G;

    this.timeScale          = 12;
    this.gravityExponent    = 3;
    this.softening          = 3.4;
    this.softeningExt       = 3.5;
    this.cageRadius         = 32;
    this.cageExponent       = 2;
    this.cageStrength       = 1.0;
    this.repulsionRadius    = 3.0;
    this.repulsionStrength  = 1.0;

    this.safetyFactor = 0.028;
    this.hMin         = 1e-4;
    this.hMax         = 0.05;
    this.minSubsteps  = 4;
    this.maxSubsteps  = 64;
    this.maxRealDt    = 0.05;
    this.maxScaledDt  = 0.3;

    const N = this.state.N;
    this._acc = new Float64Array(N * 3);
    const m = this.state.masses;
    this._Gm = new Float64Array(N);
    for (let i = 0; i < N; i++) this._Gm[i] = this.G * m[i];
  },

  _minPairDistance() {
    const x = this.state.positions;
    const N = this.state.N;
    let rmin2 = Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = x[j*3+0]-x[i*3+0];
        const dy = x[j*3+1]-x[i*3+1];
        const dz = x[j*3+2]-x[i*3+2];
        const r2 = dx*dx+dy*dy+dz*dz;
        if (r2 < rmin2) rmin2 = r2;
      }
    }
    return Math.sqrt(rmin2);
  },

  _characteristicTime() {
    const m = this.state.masses;
    const M = Math.max(m[0], m[1], m[2]);
    let rmin = this._minPairDistance();
    if (!isFinite(rmin) || rmin < this.softening) rmin = this.softening;
    return Math.sqrt((rmin * rmin * rmin) / (this.G * M));
  },

  update(dt, bus) {
    try {
      const realDt   = Math.min(dt, this.maxRealDt);
      const scaledDt = Math.min(realDt * this.timeScale, this.maxScaledDt);

      const tau = this._characteristicTime();
      let h = this.safetyFactor * tau;
      if (h < this.hMin) h = this.hMin;
      if (h > this.hMax) h = this.hMax;

      let substeps = Math.ceil(scaledDt / h);
      if (substeps < this.minSubsteps) substeps = this.minSubsteps;
      if (substeps > this.maxSubsteps) substeps = this.maxSubsteps;
      h = scaledDt / substeps;

      for (let s = 0; s < substeps; s++) {
        this._verlet(X1 * h);
        this._verlet(X0 * h);
        this._verlet(X1 * h);
      }

      this.state.commit();
      bus.emit('physics.stepped', this.state.snapshot());
    } catch (err) { reportError('20011', err); throw err; }
  },

  _verlet(h) {
    try {
      const S = this.state;
      const N = S.N;
      const x = S.positions, v = S.velocities, a = this._acc;
      this._accel(x, a);
      for (let i = 0; i < N * 3; i++) {
        v[i] += 0.5 * h * a[i];
        x[i] += h * v[i];
      }
      this._accel(x, a);
      for (let i = 0; i < N * 3; i++) v[i] += 0.5 * h * a[i];
    } catch (err) { reportError('30010', err, { h }); throw err; }
  },

  _accel(x, a) {
    try {
      const N    = this.state.N;
      const Gm   = this._Gm;
      const eps  = this.softening;
      const ext  = this.softeningExt;
      const exp  = this.gravityExponent;
      const cR   = this.cageRadius;
      const cE   = this.cageExponent;
      const cS   = this.cageStrength;
      const repR = this.repulsionRadius;
      const repS = this.repulsionStrength;

      a.fill(0);

      const C = this.state.centroid();

      for (let i = 0; i < N; i++) {
        const dxc = C[0] - x[i*3+0];
        const dyc = C[1] - x[i*3+1];
        const dzc = C[2] - x[i*3+2];
        const rc2 = dxc*dxc + dyc*dyc + dzc*dzc;
        const rc  = Math.sqrt(rc2);
        if (rc > cR && rc2 > 1e-12) {
          const over = (rc - cR) / cR;
          const cageForce = cS * Math.pow(over, cE) / rc;
          a[i*3+0] += cageForce * dxc;
          a[i*3+1] += cageForce * dyc;
          a[i*3+2] += cageForce * dzc;
        }

        for (let j = i + 1; j < N; j++) {
          const dx = x[j*3+0] - x[i*3+0];
          const dy = x[j*3+1] - x[i*3+1];
          const dz = x[j*3+2] - x[i*3+2];
          const r2 = dx*dx + dy*dy + dz*dz;
          const r  = Math.sqrt(r2);

          let softFactor;
          if (r < eps) {
            softFactor = 0;
          } else if (r < ext * eps) {
            const t = (r - eps) / (ext * eps - eps);
            softFactor = t * t * (3 - 2 * t);
          } else {
            softFactor = 1;
          }

          const rPow = Math.pow(r, exp);
          const gravityMag = Gm[j] * softFactor / rPow;

          let ax = gravityMag * dx / r;
          let ay = gravityMag * dy / r;
          let az = gravityMag * dz / r;

          if (r < repR && r2 > 1e-12) {
            const repForce = repS * (repR - r) / repR;
            const invR = 1 / r;
            ax -= repForce * dx * invR;
            ay -= repForce * dy * invR;
            az -= repForce * dz * invR;
          }

          a[i*3+0] += ax; a[i*3+1] += ay; a[i*3+2] += az;
          a[j*3+0] -= ax; a[j*3+1] -= ay; a[j*3+2] -= az;
        }
      }
    } catch (err) { reportError('30011', err); throw err; }
  },
};

// ═══ physics.constraints ═══
const physicsConstraints = {
  id: 'physics.constraints',
  provides: [],
  requires: ['physics.step', 'core.state'],
  priority: 20,

  async init(bus) {
    this.state = bus.getModule('core.state');

    this.escapeDist         = 67.5;
    this.escapeFrameLimit   = 90;
    this.escapeFrames       = 0;
    this.collapseRadius     = 0.5;
    this.collapseFrameLimit = 150;
    this.collapseFrames     = 0;

    this._autoReset = true;

    bus.on('ui.command', ({ action }) => {
      if (action === 'reset') this.reset(bus, 'manual');
    });
  },

  update(_dt, bus) {
    try {
      const S = this.state;
      const N = S.N;
      const x = S.positions;
      const C = S.centroid();

      const eD2 = this.escapeDist * this.escapeDist;
      let escaped = false;
      for (let i = 0; i < N; i++) {
        const dx = x[i*3+0]-C[0], dy = x[i*3+1]-C[1], dz = x[i*3+2]-C[2];
        if (dx*dx + dy*dy + dz*dz > eD2) { escaped = true; break; }
      }
      if (escaped) {
        this.escapeFrames++;
        if (this._autoReset && this.escapeFrames > this.escapeFrameLimit) {
          this.reset(bus, 'escape');
        }
      } else {
        this.escapeFrames = 0;
      }

      let minPair2 = Infinity;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = x[j*3+0]-x[i*3+0];
          const dy = x[j*3+1]-x[i*3+1];
          const dz = x[j*3+2]-x[i*3+2];
          const r2 = dx*dx + dy*dy + dz*dz;
          if (r2 < minPair2) minPair2 = r2;
        }
      }
      const minPair = Math.sqrt(minPair2);
      if (minPair < this.collapseRadius) {
        this.collapseFrames++;
        if (this._autoReset && this.collapseFrames > this.collapseFrameLimit) {
          this.reset(bus, 'collapse');
        }
      } else {
        this.collapseFrames = 0;
      }
    } catch (err) { reportError('20013', err); }
  },

  reset(bus, reason = 'auto') {
    try {
      const S = this.state;
      S._resetState();
      S.commit();
      this.escapeFrames = 0;
      this.collapseFrames = 0;
      bus.emit('physics.reset', { reason });
    } catch (err) { reportError('30013', err, { reason }); }
  },
};

// ═══ perf.monitor ═══
const perfMonitor = {
  id: 'perf.monitor',
  provides: ['perf.sample'],
  requires: ['core.state'],
  priority: 70,

  async init(bus) {
    this.state = bus.getModule('core.state');
    this.fps = 0;
    this.E0 = null;
    this.L0 = null;
    this._prevFrameTime = performance.now();
    this._frameDelta = 16.6;
    this._accum = 0;
    this._count = 0;

    bus.on('core.tick', () => {
      const now = performance.now();
      this._frameDelta = now - this._prevFrameTime;
      this._prevFrameTime = now;
    }, -1);
  },

  update(_dt, bus) {
    try {
      this._accum += this._frameDelta;
      this._count++;
      if (this._count < 30) return;

      const avgDelta = this._accum / this._count;
      this.fps = avgDelta > 0 ? 1000 / avgDelta : 0;
      this._accum = 0;
      this._count = 0;

      const E = this._energy();
      const L = this._angularMomentum();

      if (this.E0 === null && isFinite(E)) this.E0 = E;
      if (this.L0 === null && Array.isArray(L) && L.every(isFinite)) this.L0 = L;

      const energyDrift = (this.E0 && isFinite(E))
        ? (E - this.E0) / Math.abs(this.E0) : 0;

      const angularDrift = (this.L0 && Array.isArray(L) && L.every(isFinite))
        ? Math.hypot(L[0]-this.L0[0], L[1]-this.L0[1], L[2]-this.L0[2]) : 0;

      bus.emit('perf.sample', {
        fps: this.fps, energy: E, energyDrift,
        angularMomentum: L, angularDrift,
      });
    } catch (err) { reportError('20015', err); }
  },

  _energy() {
    try {
      const S = this.state;
      const { N, positions: x, velocities: v, masses: m } = S;
      let K = 0, U = 0;
      for (let i = 0; i < N; i++) {
        K += 0.5 * m[i] * (v[i*3+0]**2 + v[i*3+1]**2 + v[i*3+2]**2);
        for (let j = i + 1; j < N; j++) {
          const dx = x[j*3+0]-x[i*3+0];
          const dy = x[j*3+1]-x[i*3+1];
          const dz = x[j*3+2]-x[i*3+2];
          const r2 = dx*dx + dy*dy + dz*dz;
          const r  = Math.sqrt(r2);
          if (r > 1e-6) {
            const phys = S._ownerYoshida;
            const exp = phys ? phys.gravityExponent : 3;
            if (exp !== 1) {
              U -= G * m[i] * m[j] / ((exp - 1) * Math.pow(r, exp - 1));
            }
          }
        }
      }
      return K + U;
    } catch (err) { reportError('30014', err); return NaN; }
  },

  _angularMomentum() {
    try {
      const S = this.state;
      const { N, positions: x, velocities: v, masses: m } = S;
      let Lx = 0, Ly = 0, Lz = 0;
      for (let i = 0; i < N; i++) {
        const px = m[i]*v[i*3+0], py = m[i]*v[i*3+1], pz = m[i]*v[i*3+2];
        const rx = x[i*3+0], ry = x[i*3+1], rz = x[i*3+2];
        Lx += ry*pz - rz*py;
        Ly += rz*px - rx*pz;
        Lz += rx*py - ry*px;
      }
      return [Lx, Ly, Lz];
    } catch (err) { reportError('30015', err); return [0,0,0]; }
  },
};

function linkModules(bus) {
  try {
    const phys = bus.getModule('physics.yoshida');
    const state = bus.getModule('core.state');
    if (phys && state) state._ownerYoshida = phys;
  } catch (_) {}
}

export const modules = [coreState, physicsYoshida, physicsConstraints, perfMonitor];

export default function install(bus) {
  try {
    for (const m of modules) bus.register(m);
    setTimeout(() => linkModules(bus), 0);
    return modules.map(m => m.id);
  } catch (err) {
    reportError('00021', err, { bundle: 'physics.js' });
    throw err;
  }
}