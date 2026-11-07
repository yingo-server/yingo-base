/**
 * 相对路径: ./src/lively-bridge.js
 * 说明: Lively Wallpaper 参数桥接。
 *   将 LivelyProperties.json 中的全部配置映射到运行时参数。
 *   支持 read → apply → listen → persist 完整闭环。
 */

import { reportError } from './errors.js';

const LIVELY_DEFAULTS = {
  displayQuality:       'high',
  timeScale:            12,
  escapeFrameLimit:     90,
  autoReset:            true,
  trajectoryLength:     512,
  cameraFov:            38,
  cameraZoomSpeed:      2.8,
  cameraMinDistance:    3,
  cameraMaxDistance:    250,
  cameraSmoothPos:      0.08,
  starCount:            2000,
  sunRadius:            0.7,
  bloomStrength:        1.0,
  bloomRadius:          0.6,
  bloomThreshold:       0.9,
  'dev.gravityExponent':    3,
  'dev.softening':          3.4,
  'dev.softeningExt':       3.5,
  'dev.cageRadius':         32,
  'dev.cageExponent':       2,
  'dev.repulsionRadius':    3.0,
  'dev.safetyFactor':       0.028,
  'dev.maxSubsteps':        64,
  'dev.escapeDist':         67.5,
  'dev.lodStartLevel':      'medium',
  'dev.lodRiseMs':          700,
  'dev.pixelRatio':         2.0,
};

const LOD_MAP = {
  'potato': 1, 'low': 2, 'medium': 4,
  'high': 6, 'ultra': 8, 'super ultra': 9,
};

const QUALITY_PIXEL_RATIO = {
  'potato': 0.5,
  'low': 0.75,
  'medium': 1.0,
  'high': 2.0,
  'ultra': 2.5,
  'super ultra': 3.0,
};

const isLively = () => {
  try {
    return typeof window.livelyPropertyListener !== 'undefined'
        || typeof lively !== 'undefined';
  } catch (_) { return false; }
};

export function installLivelyBridge(bus) {
  try {
    const config = { ...LIVELY_DEFAULTS };
    const livelyEnv = isLively();

    if (livelyEnv) {
      try {
        for (const key of Object.keys(LIVELY_DEFAULTS)) {
          const v = lively.getProperty(key);
          if (v !== undefined && v !== null && v !== '') config[key] = v;
        }
      } catch (err) {
        reportError('00070', err, { phase: 'lively.getProperty' });
      }
    }

    applyConfig(bus, config);

    window.livelyPropertyListener = (name, val) => {
      try {
        config[name] = val;
        applyConfig(bus, { [name]: val });
        if (livelyEnv && typeof lively.setProperty === 'function') {
          try { lively.setProperty(name, val); } catch (_) {}
        }
      } catch (err) {
        reportError('00071', err, { name, val });
      }
    };

    if (!livelyEnv) {
      window.__livelyBridge = { config, isLively: false };
      console.log('[lively-bridge] 非 Lively 环境，使用默认参数');
    }

    return config;
  } catch (err) {
    reportError('00072', err, { phase: 'lively-bridge.install' });
    return { ...LIVELY_DEFAULTS };
  }
}

function applyConfig(bus, partial) {
  const phys  = bus.getModule('physics.yoshida');
  const cons  = bus.getModule('physics.constraints');
  const cam   = bus.getModule('camera.controller');
  const rend  = bus.getModule('render.main');
  const post  = bus.getModule('render.postfx');

  for (const [key, val] of Object.entries(partial)) {
    if (key.startsWith('dev.')) {
      applyDevConfig(bus, key, val);
      continue;
    }

    switch (key) {
      case 'displayQuality': {
        const pr = QUALITY_PIXEL_RATIO[val] ?? 2.0;
        if (rend?.renderer) rend.renderer.setPixelRatio(Math.min(pr, 3));
        break;
      }
      case 'timeScale':
        if (phys) phys.timeScale = clamp(val, 1, 20);
        break;
      case 'escapeFrameLimit':
        if (cons) cons.escapeFrameLimit = Math.round(clamp(val, 10, 600));
        break;
      case 'autoReset':
        if (cons) cons._autoReset = !!val;
        break;
      case 'trajectoryLength': {
        const traj = bus.getModule('cache.trajectory');
        if (traj && typeof traj.setCapacity === 'function') {
          traj.setCapacity(clamp(val, 128, 4096));
        }
        break;
      }
      case 'cameraFov': {
        if (cam) cam.fov = clamp(val, 10, 90);
        if (rend?.camera) {
          rend.camera.fov = cam?.fov ?? clamp(val, 10, 90);
          rend.camera.updateProjectionMatrix();
        }
        break;
      }
      case 'cameraZoomSpeed':
        if (cam) cam.k = clamp(val, 0.2, 10);
        break;
      case 'cameraMinDistance':
        if (cam) cam.minDist = clamp(val, 0.5, 50);
        break;
      case 'cameraMaxDistance':
        if (cam) cam.maxDist = clamp(val, 20, 1000);
        break;
      case 'cameraSmoothPos':
        if (cam) cam._alphaR = clamp(val, 0.005, 0.5);
        break;
      case 'starCount':
        rebuildStarfield(bus, Math.round(clamp(val, 200, 10000)));
        break;
      case 'sunRadius': {
        const r = clamp(val, 0.1, 3.0);
        if (rend?.suns) {
          for (const s of rend.suns) {
            if (s && typeof s.setRadius === 'function') s.setRadius(r);
          }
        }
        break;
      }
      case 'bloomStrength':
        if (post?.bloom) post.bloom.strength = clamp(val, 0, 5);
        break;
      case 'bloomRadius':
        if (post?.bloom) post.bloom.radius = clamp(val, 0, 2);
        break;
      case 'bloomThreshold':
        if (post?.bloom) post.bloom.threshold = clamp(val, 0, 2);
        break;
      default:
        break;
    }
  }
}

function applyDevConfig(bus, key, val) {
  const phys = bus.getModule('physics.yoshida');
  const cons = bus.getModule('physics.constraints');
  const rend = bus.getModule('render.main');

  switch (key) {
    case 'dev.gravityExponent':
      if (phys) phys.gravityExponent = clamp(val, 2, 5);
      break;
    case 'dev.softening':
      if (phys) phys.softening = clamp(val, 0.5, 10);
      break;
    case 'dev.softeningExt':
      if (phys) phys.softeningExt = clamp(val, 1, 10);
      break;
    case 'dev.cageRadius':
      if (phys) phys.cageRadius = clamp(val, 10, 100);
      break;
    case 'dev.cageExponent':
      if (phys) phys.cageExponent = clamp(val, 1, 5);
      break;
    case 'dev.repulsionRadius':
      if (phys) phys.repulsionRadius = clamp(val, 0.5, 10);
      break;
    case 'dev.safetyFactor':
      if (phys) phys.safetyFactor = clamp(val, 0.001, 0.2);
      break;
    case 'dev.maxSubsteps':
      if (phys) phys.maxSubsteps = Math.round(clamp(val, 4, 512));
      break;
    case 'dev.escapeDist':
      if (cons) cons.escapeDist = clamp(val, 20, 500);
      break;
    case 'dev.lodStartLevel': {
      const lv = LOD_MAP[val] ?? 4;
      if (rend?.suns) {
        for (const s of rend.suns) {
          if (s?.setTargetLevel) s.setTargetLevel(lv);
        }
      }
      break;
    }
    case 'dev.lodRiseMs':
      if (rend?.suns) {
        for (const s of rend.suns) {
          if (s?.setRiseMs) s.setRiseMs(clamp(val, 50, 5000));
        }
      }
      break;
    case 'dev.pixelRatio':
      if (rend?.renderer) rend.renderer.setPixelRatio(clamp(val, 0.5, 4));
      break;
    default:
      break;
  }
}

function rebuildStarfield(bus, count) {
  try {
    const rend = bus.getModule('render.main');
    if (!rend) return;
    if (rend.starfield) {
      rend.scene.remove(rend.starfield);
      rend.starfield.geometry.dispose();
      rend.starfield.material.dispose();
      rend.starfield = null;
    }
    rend._buildStarfield(count);
  } catch (err) {
    reportError('00073', err, { count });
  }
}

function clamp(v, lo, hi) {
  v = Number(v);
  if (!isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

export default installLivelyBridge;