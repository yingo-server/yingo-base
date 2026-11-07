/**
 * 相对路径: ./src/ui.js
 * 说明: UI 与视觉层。
 *   - 几何球体版 sun.js
 *   - LOD 由 ui.js 派发目标档位，sun.js 内部渐进到达
 *   - 支持 URL 参数：?lod=N / max / min / auto
 *                    ?lodStart=N / ?lodRise=ms
 *   - 双击聚焦 + 缩放
 *   - 全面 try/catch
 *   - render.first.ready 在首次成功渲染后 emit
 *
 *   适配 Lively：
 *     ★ 星场半径 12000~16000，自定义 shader，尺寸跟随 DPR
 *     ★ camera.far 40000，renderer 启用 logarithmicDepthBuffer
 *     ★ pointermove 拖动方向：theta += dx，phi -= dy
 */

import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { reportError } from './errors.js';
import { createSunMesh, STAR_PRESETS } from './sun.js';

// ═══ LOD URL 配置 ═══
function parseLodConfig() {
  const cfg = { mode: 'auto', fixedLevel: null, startLevel: null, riseMs: null };
  try {
    const params = new URLSearchParams(window.location.search);
    const lod = params.get('lod');
    if (lod === 'max') { cfg.mode = 'fixed'; cfg.fixedLevel = 9; }
    else if (lod === 'min') { cfg.mode = 'fixed'; cfg.fixedLevel = 1; }
    else if (lod === 'auto' || lod === null || lod === '') { cfg.mode = 'auto'; }
    else {
      const n = parseInt(lod, 10);
      if (Number.isInteger(n) && n >= 1 && n <= 9) { cfg.mode = 'fixed'; cfg.fixedLevel = n; }
    }
    const rise = parseInt(params.get('lodRise'), 10);
    if (Number.isInteger(rise) && rise >= 0) cfg.riseMs = rise;
    const start = parseInt(params.get('lodStart'), 10);
    if (Number.isInteger(start) && start >= 1 && start <= 9) cfg.startLevel = start;
  } catch (_) {}
  return cfg;
}

function distanceToLevel(dist) {
  if (!isFinite(dist)) return 5;
  if (dist >= 200) return 1;
  if (dist <= 5)   return 9;
  const t = (200 - dist) / 195;
  return Math.max(1, Math.min(9, Math.round(1 + t * 8)));
}

// ═══ 点击特效 ═══
(function injectRippleStyles() {
  try {
    if (document.getElementById('ui-ripple-styles')) return;
    const s = document.createElement('style');
    s.id = 'ui-ripple-styles';
    s.textContent = `
      @keyframes ui-ripple {
        0%   { transform: scale(0.25); opacity: 1; }
        100% { transform: scale(3.4);  opacity: 0; }
      }
      @keyframes ui-glow {
        0%   { transform: scale(0.4); opacity: 0.85; }
        100% { transform: scale(2.6); opacity: 0; }
      }
    `;
    document.head.appendChild(s);
  } catch (_) {}
})();

function spawnRipple(button, clientX, clientY) {
  try {
    const rect = button.getBoundingClientRect();
    let cx = clientX - rect.left;
    let cy = clientY - rect.top;
    if (!cx && !cy) { cx = rect.width / 2; cy = rect.height / 2; }

    const ring = document.createElement('span');
    ring.style.cssText = `
      position:absolute; left:${cx}px; top:${cy}px;
      width:36px; height:36px; margin-left:-18px; margin-top:-18px;
      border-radius:50%;
      border:1.2px solid rgba(150,200,240,0.9);
      box-shadow: 0 0 8px rgba(120,180,220,0.7), inset 0 0 6px rgba(120,180,220,0.5);
      pointer-events:none;
      animation: ui-ripple 0.62s cubic-bezier(0.16,1,0.3,1) forwards;
    `;
    button.appendChild(ring);
    setTimeout(() => { try { ring.remove(); } catch (_) {} }, 720);

    const glow = document.createElement('span');
    glow.style.cssText = `
      position:absolute; left:${cx}px; top:${cy}px;
      width:20px; height:20px; margin-left:-10px; margin-top:-10px;
      border-radius:50%;
      background:radial-gradient(circle,
        rgba(200,230,255,0.95) 0%,
        rgba(130,180,230,0.5) 40%,
        rgba(80,140,200,0.15) 70%,
        transparent 90%);
      pointer-events:none;
      animation: ui-glow 0.42s ease-out forwards;
    `;
    button.appendChild(glow);
    setTimeout(() => { try { glow.remove(); } catch (_) {} }, 520);
  } catch (err) { reportError('30032', err); }
}

// ═══ camera.controller ═══
const cameraController = {
  id: 'camera.controller',
  provides: ['camera.target'],
  requires: ['core.state'],
  priority: 30,

  async init(bus) {
    this.bus = bus;
    this.state = bus.getModule('core.state');
    if (!this.state) throw new Error('core.state unavailable');

    this.fov     = 38;
    this.k       = 2.8;
    this.minDist = 3;
    this.maxDist = 250;

    this._R_smooth = 10;
    this._alphaR   = 0.08;

    this._theta = 0;
    this._phi   = Math.PI / 2 - 0.25;

    const st = Math.sin(this._phi), ct = Math.cos(this._phi);
    const d0 = 80;
    this._pos     = new THREE.Vector3(d0 * st, d0 * ct, 0);
    this._look    = new THREE.Vector3(0, 0, 0);
    this._tmpPos  = new THREE.Vector3();
    this._tmpLook = new THREE.Vector3();

    this._dragging = false;
    this._dragLast = { x: 0, y: 0 };
    this._focusIndex = null;

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._tmpSphere = new THREE.Sphere();
    this._tmpVec3 = new THREE.Vector3();
  },

  start(bus) {
    const canvas = document.getElementById('stage');
    if (!canvas) throw new Error('#stage not found');

    canvas.addEventListener('pointerdown', (e) => {
      try {
        this._dragging = true;
        this._dragLast = { x: e.clientX, y: e.clientY };
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      } catch (err) { reportError('30020', err); }
    });

    canvas.addEventListener('pointermove', (e) => {
      try {
        if (!this._dragging) return;
        const dx = e.clientX - this._dragLast.x;
        const dy = e.clientY - this._dragLast.y;
        this._dragLast = { x: e.clientX, y: e.clientY };
        this._theta += dx * 0.005;
        this._phi = Math.max(0.15, Math.min(Math.PI - 0.15, this._phi - dy * 0.005));
      } catch (err) { reportError('30021', err); }
    });

    canvas.addEventListener('pointerup', (e) => {
      try {
        this._dragging = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      } catch (err) { reportError('30022', err); }
    });

    canvas.addEventListener('wheel', (e) => {
      try {
        const zoomFactor = 1 + e.deltaY * 0.001;
        this.k = Math.max(0.15, Math.min(6.0, this.k * zoomFactor));
      } catch (err) { reportError('30023', err); }
    }, { passive: true });

    canvas.addEventListener('dblclick', (e) => {
      try { this._handleDoubleClick(e, bus); }
      catch (err) { reportError('30024', err); }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._focusIndex = null;
    });

    bus.on('physics.reset', () => {
      this._theta = 0;
      this._phi = Math.PI / 2 - 0.25;
      this.k = 2.8;
      this._focusIndex = null;
    });
  },

  _handleDoubleClick(e, bus) {
    const render = bus.getModule('render.main');
    if (!render || !render.camera || !render.camera.isCamera) return;

    const camera = render.camera;
    const snap = this.state.snapshot();
    const N = this.state.N;

    this._ndc.x = (e.clientX / innerWidth) * 2 - 1;
    this._ndc.y = -(e.clientY / innerHeight) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, camera);

    const hitRadius = 2.5;
    let hitIndex = -1;
    let minDist = Infinity;

    for (let i = 0; i < N; i++) {
      this._tmpSphere.center.set(
        snap.positions[i * 3 + 0],
        snap.positions[i * 3 + 1],
        snap.positions[i * 3 + 2],
      );
      this._tmpSphere.radius = hitRadius;
      if (this._raycaster.ray.intersectsSphere(this._tmpSphere)) {
        this._tmpVec3.copy(this._tmpSphere.center);
        const d = camera.position.distanceTo(this._tmpVec3);
        if (d < minDist) { minDist = d; hitIndex = i; }
      }
    }

    if (hitIndex === this._focusIndex) this._focusIndex = null;
    else if (hitIndex >= 0) this._focusIndex = hitIndex;
  },

  update(_dt, bus) {
    try {
      const snap = this.state.snapshot();
      let C, R;

      if (this._focusIndex !== null) {
        const idx = Math.max(0, Math.min(this.state.N - 1, this._focusIndex));
        C = [
          snap.positions[idx * 3 + 0],
          snap.positions[idx * 3 + 1],
          snap.positions[idx * 3 + 2],
        ];
        R = 1.4;
      } else {
        C = this.state.centroid();
        R = this.state.maxRadius(C);
      }

      if (!isFinite(R) || R <= 0) R = 10;
      this._R_smooth = this._alphaR * R + (1 - this._alphaR) * this._R_smooth;

      const dist = this._R_smooth / Math.tan(this.fov * Math.PI / 360) * this.k;
      const d = Math.max(this.minDist, Math.min(this.maxDist, dist));

      const st = Math.sin(this._phi), ct = Math.cos(this._phi);
      const sx = st * Math.cos(this._theta);
      const sy = st * Math.sin(this._theta);
      const sz = ct;

      this._tmpPos.set(C[0] + sx * d, C[1] + sz * d, C[2] + sy * d);

      const posLerp = this._focusIndex !== null ? 0.16 : 0.08;
      const lookLerp = this._focusIndex !== null ? 0.20 : 0.10;

      this._pos.lerp(this._tmpPos, posLerp);
      this._tmpLook.set(C[0], C[1], C[2]);
      this._look.lerp(this._tmpLook, lookLerp);

      bus.emit('camera.target', {
        position: [this._pos.x, this._pos.y, this._pos.z],
        lookAt:   [this._look.x, this._look.y, this._look.z],
        radius:   this._R_smooth,
        focusIndex: this._focusIndex,
      });
    } catch (err) { reportError('20022', err); }
  },
};

// ═══ render.main ═══
const STAR_KEYS = ['blue', 'yellow', 'red'];

const renderMain = {
  id: 'render.main',
  provides: ['render.frame'],
  requires: ['core.state', 'camera.target'],
  priority: 40,

  async init(bus) {
    this.bus = bus;
    this.state = bus.getModule('core.state');
    const canvas = document.getElementById('stage');
    if (!canvas) throw new Error('#stage not found');

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000206);

    this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 40000);
    this.camera.position.set(80, 20, 0);
    this.camera.lookAt(0, 0, 0);

    this.lodConfig = parseLodConfig();
    console.log('[LOD] config:', this.lodConfig);

    this.suns = [];
    const shuffled = [...STAR_KEYS].sort(() => Math.random() - 0.5);
    for (let i = 0; i < this.state.N; i++) {
      const key = shuffled[i % shuffled.length];
      try {
        const sun = createSunMesh(key, 0.7, {
          startLevel: this.lodConfig.startLevel ?? undefined,
          riseMs:     this.lodConfig.riseMs ?? undefined,
          fixedLevel: this.lodConfig.fixedLevel ?? undefined,
        });
        this.scene.add(sun.group);
        this.suns.push(sun);
      } catch (err) {
        reportError('20023', err, { index: i, key });
        this.suns.push(null);
      }
    }

    this._buildStarfield(2000);

    this._frameCount = 0;
    this._readyEmitted = false;
    this._consecutiveErrors = 0;

    bus.on('camera.target', ({ position, lookAt }) => {
      try {
        this.camera.position.set(position[0], position[1], position[2]);
        this.camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
      } catch (err) { reportError('20024', err, { phase: 'camera.target' }); }
    });

    bus.on('render.resize', ({ w, h }) => {
      try {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      } catch (err) { reportError('20024', err, { phase: 'resize' }); }
    });

    addEventListener('resize', () => {
      bus.emit('render.resize', { w: innerWidth, h: innerHeight });
    });
  },

  _buildStarfield(count) {
    try {
      const R_MIN = 12000;
      const R_MAX = 16000;

      const positions = new Float32Array(count * 3);
      const colors    = new Float32Array(count * 3);
      const sizes     = new Float32Array(count);

      const clusterCount = 4 + Math.floor(Math.random() * 3);
      const clusters = [];
      for (let k = 0; k < clusterCount; k++) {
        clusters.push({
          theta:  Math.random() * Math.PI * 2,
          phi:    Math.acos(2 * Math.random() - 1),
          spread: 0.05 + Math.random() * 0.12,
        });
      }

      const tempTable = [
        { p: 0.04, r: 0.75, g: 0.85, b: 1.00 },
        { p: 0.40, r: 0.98, g: 0.98, b: 1.00 },
        { p: 0.35, r: 1.00, g: 0.97, b: 0.88 },
        { p: 0.18, r: 1.00, g: 0.88, b: 0.72 },
        { p: 0.03, r: 1.00, g: 0.72, b: 0.55 },
      ];
      function pickColor() {
        const u = Math.random();
        let acc = 0;
        for (const t of tempTable) {
          acc += t.p;
          if (u < acc) return [t.r, t.g, t.b];
        }
        return [1, 1, 1];
      }

      for (let i = 0; i < count; i++) {
        let theta, phi;
        if (Math.random() < 0.10) {
          const c = clusters[Math.floor(Math.random() * clusters.length)];
          theta = c.theta + (Math.random() - 0.5) * c.spread * 2;
          phi   = c.phi   + (Math.random() - 0.5) * c.spread * 2;
        } else {
          theta = Math.random() * Math.PI * 2;
          phi   = Math.acos(2 * Math.random() - 1);
        }

        const sinPhi = Math.sin(phi);
        const r = R_MIN + Math.random() * (R_MAX - R_MIN);

        positions[i*3+0] = r * sinPhi * Math.cos(theta);
        positions[i*3+1] = r * sinPhi * Math.sin(theta);
        positions[i*3+2] = r * Math.cos(phi);

        const b = Math.pow(Math.random(), 4);
        const intensity = 0.30 + b * 0.90;
        const size = 0.4 + b * 1.2;

        const [cr, cg, cb] = pickColor();
        colors[i*3+0] = cr * intensity;
        colors[i*3+1] = cg * intensity;
        colors[i*3+2] = cb * intensity;
        sizes[i] = size;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('aColor',   new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));

      const mat = new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: this.renderer.getPixelRatio() } },
        vertexShader: `
          attribute vec3 aColor;
          attribute float aSize;
          uniform float uPixelRatio;
          varying vec3 vColor;
          void main() {
            vColor = aColor;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * uPixelRatio;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            vec2 c = gl_PointCoord - vec2(0.5);
            float d = length(c);
            if (d > 0.5) discard;
            float alpha = smoothstep(0.5, 0.15, d);
            gl_FragColor = vec4(vColor, alpha);
          }
        `,
        transparent: true,
        blending:    THREE.AdditiveBlending,
        depthTest:   true,
        depthWrite:  false,
      });

      this.starfield = new THREE.Points(geo, mat);
      this.starfield.renderOrder = -1000;
      this.starfield.frustumCulled = false;
      this.scene.add(this.starfield);
    } catch (err) {
      reportError('30030', err, { count });
    }
  },

  update(_dt, bus) {
    try {
      const snap = this.state.snapshot();
      const N = this.state.N;
      const t = performance.now() / 1000;

      if (this.starfield?.material?.uniforms?.uPixelRatio) {
        this.starfield.material.uniforms.uPixelRatio.value =
          this.renderer.getPixelRatio();
      }

      const PMODE_PERIOD = 60.0;
      const PMODE_AMP    = 0.0026;
      const pulse = 1.0 + PMODE_AMP * Math.sin(t * 2.0 * Math.PI / PMODE_PERIOD);

      for (let i = 0; i < N; i++) {
        const sun = this.suns[i];
        if (!sun) continue;

        const px = snap.positions[i*3+0];
        const py = snap.positions[i*3+1];
        const pz = snap.positions[i*3+2];

        sun.group.position.set(px, py, pz);

        if (!sun.isFixed || !sun.isFixed()) {
          const dx = this.camera.position.x - px;
          const dy = this.camera.position.y - py;
          const dz = this.camera.position.z - pz;
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          const level = distanceToLevel(dist);
          if (sun.getTargetLevel && sun.getTargetLevel() !== level) {
            sun.setTargetLevel(level);
          }
        }

        sun.update(t, [px, py, pz], this.camera, pulse);
      }

      const postfx = bus.getModule('render.postfx');
      const postfxActive =
        bus.getStatus('render.postfx') === 'running'
        && postfx
        && postfx._enabled !== false
        && postfx._failed !== true;

      if (!postfxActive) {
        this.renderer.render(this.scene, this.camera);
      }

      this._frameCount++;
      this._consecutiveErrors = 0;

      if (!this._readyEmitted && this._frameCount > 3) {
        this._readyEmitted = true;
        bus.emit('render.first.ready', {});
      }
    } catch (err) {
      this._consecutiveErrors = (this._consecutiveErrors || 0) + 1;
      if (this._consecutiveErrors <= 3) {
        reportError('20024', err, { consecutive: this._consecutiveErrors });
      }
    }
  },
};

// ═══ render.postfx ═══
const renderPostfx = {
  id: 'render.postfx',
  provides: ['render.postfx'],
  requires: ['render.frame'],
  priority: 50,

  async init(bus) {
    try {
      this.render = bus.getModule('render.main');
      if (!this.render) throw new Error('render.main unavailable');
      const { renderer, scene, camera } = this.render;

      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(scene, camera));

      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(innerWidth, innerHeight),
        1.0, 0.6, 0.9,
      );
      this.composer.addPass(this.bloom);
      this.bloom.renderToScreen = true;

      this._enabled = true;
      this._failed  = false;

      bus.on('render.resize', ({ w, h }) => {
        try {
          this.composer.setSize(w, h);
          this.bloom.setSize(w, h);
        } catch (_) {}
      });

      bus.on('ui.command', ({ action }) => {
        if (action === 'toggle-bloom') {
          this._enabled = !this._enabled;
          bus.emit('render.postfx.toggled', { enabled: this._enabled });
        }
      });
    } catch (err) {
      reportError('20025', err);
      throw err;
    }
  },

  update(_dt, _bus) {
    try {
      if (this._enabled) {
        this.composer.render();
      } else {
        const { renderer, scene, camera } = this.render;
        renderer.render(scene, camera);
      }
    } catch (err) {
      reportError('30031', err);
      this._enabled = false;
      this._failed  = true;
      try {
        const { renderer, scene, camera } = this.render;
        renderer.render(scene, camera);
      } catch (err2) {
        reportError('30031', err2, { phase: 'fallback' });
      }
    }
  },
};

// ═══ ui.overlay ═══
const uiOverlay = {
  id: 'ui.overlay',
  provides: ['ui.command'],
  requires: [],
  priority: 60,

  async init(bus) {
    this.bus = bus;
    const root = document.createElement('div');
    root.id = 'ui-overlay';
    root.style.cssText = `position:fixed; inset:0; pointer-events:none; z-index:100;`;
    document.body.appendChild(root);
    this.root = root;

    const top = document.createElement('div');
    top.style.cssText = `
      position:absolute; top:22px; right:22px;
      display:flex; gap:6px; pointer-events:auto;
    `;
    root.appendChild(top);

    this._iconButton(top, 'M4 4v6h6 M20 20v-6h-6 M5 19a9 9 0 0 0 14-7 M19 5a9 9 0 0 0-14 7',
      () => bus.emit('ui.command', { action: 'reset' }), 'restart');
    this._iconButton(top, 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
      () => bus.emit('ui.command', { action: 'toggle-bloom' }), 'bloom');
    this._iconButton(top, 'M12 2v20 M2 12h20',
      () => bus.emit('ui.command', { action: 'open-seed' }), 'seed');
    this._iconButton(top, 'M3 12h18 M12 3v18',
      () => bus.emit('ui.command', { action: 'open-settings' }), 'settings');
  },

  _iconButton(parent, path, onClick, label) {
    try {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.style.cssText = `
        width:42px; height:42px;
        background:transparent;
        border:none; outline:none;
        padding:0; margin:0;
        cursor:pointer;
        position:relative;
        display:flex; align-items:center; justify-content:center;
        color:rgba(200,208,216,0.42);
        transition: color .25s ease, transform .18s ease, filter .25s ease;
        -webkit-tap-highlight-color: transparent;
      `;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.2"
             stroke-linecap="round" stroke-linejoin="round"
             style="position:relative; z-index:1; pointer-events:none;">
          <path d="${path}" />
        </svg>
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.color = 'rgba(220,232,242,0.95)';
        btn.style.filter = 'drop-shadow(0 0 6px rgba(130,190,230,0.7))';
        btn.style.transform = 'scale(1.12)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.color = 'rgba(200,208,216,0.42)';
        btn.style.filter = 'none';
        btn.style.transform = 'scale(1)';
      });
      btn.addEventListener('pointerdown', () => {
        const audio = this.bus.getModule('api.audio');
        if (audio && typeof audio.unlock === 'function') {
          try { audio.unlock(); } catch (_) {}
        }
        btn.style.transform = 'scale(0.92)';
      });
      btn.addEventListener('pointerup', () => {
        btn.style.transform = 'scale(1.12)';
      });
      btn.addEventListener('click', (e) => {
        spawnRipple(btn, e.clientX, e.clientY);
        const audio = this.bus.getModule('api.audio');
        if (audio && typeof audio.click === 'function') {
          try { audio.click(); }
          catch (err) { reportError('30033', err, { label }); }
        }
        try { onClick(e); } catch (err) { reportError('30032', err, { label }); }
      });
      parent.appendChild(btn);
    } catch (err) { reportError('30032', err, { label }); }
  },
};

export const modules = [cameraController, renderMain, renderPostfx, uiOverlay];

export default function install(bus) {
  try {
    for (const m of modules) bus.register(m);
    return modules.map(m => m.id);
  } catch (err) {
    reportError('00031', err, { bundle: 'ui.js' });
    throw err;
  }
}