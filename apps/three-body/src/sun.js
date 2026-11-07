/**
 * 相对路径: ./src/sun.js
 * 说明: 太阳着色器模块（几何球体版）。
 *
 *   架构：
 *     - Surface: SphereGeometry(radius, 48, 48) 前向渲染
 *     - Halo:    SphereGeometry(radius * 4.6, 32, 32) BackSide + 加法混合
 *
 *   LOD：
 *     - 从 startLevel 开始，每 riseMs 提升一档，直到 targetLevel
 *     - 若 options.fixedLevel 指定，则跳过渐进，永久锁定
 *     - options: { startLevel, riseMs, fixedLevel }
 *
 *   健壮性：
 *     - 参数校验、uniform 长度校验、dispose 幂等、debug()
 *
 *   本次改动：
 *     ★ radius 从 const 形参改为可写 let，暴露 setRadius(r) 供 Lively 桥接
 */

import * as THREE from 'three';
import { reportError } from './errors.js';

export const STAR_PRESETS = {
  blue: {
    base: [0.78, 0.90, 1.00], chromo: [0.50, 0.72, 1.00], corona: [0.68, 0.84, 1.00],
    limb: 0.42, granContrast: 0.55, brightness: 0.90,
  },
  yellow: {
    base: [1.00, 0.97, 0.90], chromo: [1.00, 0.62, 0.35], corona: [1.00, 0.92, 0.78],
    limb: 0.45, granContrast: 0.42, brightness: 1.35,
  },
  red: {
    base: [1.00, 0.82, 0.62], chromo: [1.00, 0.38, 0.16], corona: [1.00, 0.72, 0.50],
    limb: 0.55, granContrast: 0.48, brightness: 1.20,
  },
};

const LOD_CONFIGS = {
  1: { CORONA_STEPS: 3,  PROM_STEPS: 3,  ENABLE_CME: 0, ENABLE_CHROMO: 0, ENABLE_HAZE: 0 },
  2: { CORONA_STEPS: 5,  PROM_STEPS: 4,  ENABLE_CME: 0, ENABLE_CHROMO: 0, ENABLE_HAZE: 0 },
  3: { CORONA_STEPS: 7,  PROM_STEPS: 5,  ENABLE_CME: 0, ENABLE_CHROMO: 1, ENABLE_HAZE: 0 },
  4: { CORONA_STEPS: 9,  PROM_STEPS: 7,  ENABLE_CME: 0, ENABLE_CHROMO: 1, ENABLE_HAZE: 1 },
  5: { CORONA_STEPS: 11, PROM_STEPS: 9,  ENABLE_CME: 1, ENABLE_CHROMO: 1, ENABLE_HAZE: 1 },
  6: { CORONA_STEPS: 13, PROM_STEPS: 11, ENABLE_CME: 1, ENABLE_CHROMO: 1, ENABLE_HAZE: 1 },
  7: { CORONA_STEPS: 15, PROM_STEPS: 13, ENABLE_CME: 1, ENABLE_CHROMO: 1, ENABLE_HAZE: 1 },
  8: { CORONA_STEPS: 18, PROM_STEPS: 15, ENABLE_CME: 1, ENABLE_CHROMO: 1, ENABLE_HAZE: 1 },
  9: { CORONA_STEPS: 20, PROM_STEPS: 18, ENABLE_CME: 1, ENABLE_CHROMO: 1, ENABLE_HAZE: 1 },
};

const MAX_CORONA_STEPS = 20;
const MAX_PROM_STEPS   = 18;
const DEFAULT_START_LEVEL = 1;
const DEFAULT_RISE_MS     = 700;

// ═══════════════════════════════════════════════════════════════
// GLSL
// ═══════════════════════════════════════════════════════════════
const COMMON = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float uTime;
uniform float uR;
uniform vec3  uStarPos;

uniform vec3  uFlareDir[3];
uniform vec4  uFlareData[3];
uniform vec3  uPromA[2];
uniform vec3  uPromB[2];
uniform vec2  uPromData[2];

uniform vec3  uBaseColor;
uniform vec3  uChromoColor;
uniform vec3  uCoronaColor;
uniform float uLimb;
uniform float uGranContrast;
uniform float uBrightness;
uniform float uLifeEvolve;
uniform float uFlattening;
uniform float uMagConnect;

uniform int   uCoronaSteps;
uniform int   uPromSteps;
uniform float uEnableCME;
uniform float uEnableChromo;
uniform float uEnableHaze;

const float ROUT = 4.6;
const float PI   = 3.14159265;

float hash13(vec3 p3){
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3){
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}
float fbm2(vec3 p){
  float s = 0.0;
  float a = 0.5;
  s += a * vnoise(p); p = p * 2.03 + vec3(13.7, 7.3, 5.1); a *= 0.5;
  s += a * vnoise(p);
  return s / 0.75;
}
float fbm3(vec3 p){
  float s = 0.0;
  float a = 0.5;
  s += a * vnoise(p); p = p * 2.03 + vec3(13.7, 7.3, 5.1); a *= 0.5;
  s += a * vnoise(p); p = p * 2.03 + vec3(13.7, 7.3, 5.1); a *= 0.5;
  s += a * vnoise(p);
  return s / 0.875;
}
vec2 worley(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float f1 = 1e9;
  float f2 = 1e9;
  for (int x = -1; x <= 1; x++){
    for (int y = -1; y <= 1; y++){
      for (int z = -1; z <= 1; z++){
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = hash33(ip + g);
        vec3 r = g + o - fp;
        float d = dot(r, r);
        if (d < f1){ f2 = f1; f1 = d; }
        else if (d < f2){ f2 = d; }
      }
    }
  }
  return vec2(sqrt(f1), sqrt(f2));
}
vec3 warp(vec3 p, float freq, float amt){
  return p + amt * (vec3(
    vnoise(p * freq + 11.7),
    vnoise(p * freq + 31.3),
    vnoise(p * freq + 57.9)
  ) - 0.5);
}
vec3 rotY(vec3 p, float a){
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
float diffOmega(vec3 dir){
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  return 0.020 * (1.0 - 0.34 * sin(lat) * sin(lat));
}
vec3 sunToWorld(vec3 a){ return rotY(a, uTime * diffOmega(a)); }
vec3 worldToSun(vec3 p){
  vec3 pn = p / max(uR, 0.001);
  return rotY(p, -uTime * diffOmega(pn));
}
float flareEnv(float a){
  float rise = smoothstep(0.0, 0.07, a);
  float fall = exp(-a * 2.6);
  float fade = 1.0 - smoothstep(0.82, 1.0, a);
  return rise * fall * fade;
}

vec3 spotField(vec3 pr, float activity){
  float t = uTime;
  vec3 drift = vec3(t * 0.0006, t * 0.0009, t * 0.0004);
  vec3 warped = warp(pr, 4.0, 0.10);
  float seed = worley(warped * 8.0 + drift).x;
  vec3 prN = normalize(pr);
  float latBias = 1.0 - smoothstep(0.62, 0.95, abs(prN.y));
  float inAct = smoothstep(0.55, 0.72, activity) * latBias;
  float sizeVar = vnoise(pr * 4.5 + vec3(23.7) + drift * 0.3);
  float umbraR = 0.015 + 0.020 * sizeVar;
  float halfR  = 0.045 + 0.040 * sizeVar;
  float plageR = halfR * 2.4;
  float umbra = (1.0 - smoothstep(umbraR * 0.55, umbraR, seed)) * inAct;
  float penumbraRaw = (1.0 - smoothstep(umbraR, halfR, seed)) * inAct;
  float fib = vnoise(vec3(seed * 30.0, prN.x * 8.0, prN.y * 8.0 + t * 0.05));
  float penumbra = clamp(penumbraRaw * (0.45 + 0.85 * fib), 0.0, 1.0);
  penumbra = max(penumbra, umbra);
  float plage = (smoothstep(halfR, halfR + 0.04, seed)
               - smoothstep(plageR - 0.04, plageR, seed)) * inAct;
  plage = max(plage, 0.0);
  return vec3(umbra, penumbra, plage);
}

vec3 promFootField(vec3 n){
  float total = 0.0;
  vec2 dirAcc = vec2(0.0);
  for (int i = 0; i < 2; i++){
    float strength = uPromData[i].x;
    if (strength <= 0.005) continue;
    vec3 a = sunToWorld(normalize(uPromA[i]));
    vec3 b = sunToWorld(normalize(uPromB[i]));
    float da = acos(clamp(dot(n, a), -1.0, 1.0));
    float db = acos(clamp(dot(n, b), -1.0, 1.0));
    float ga = exp(-pow(da / 0.18, 2.0));
    float gb = exp(-pow(db / 0.18, 2.0));
    total += (ga + gb) * strength;
    vec3 ta = a - dot(a, n) * n;
    vec3 tb = b - dot(b, n) * n;
    float la = length(ta);
    float lb = length(tb);
    if (la > 1e-3) dirAcc += (ta / la).xy * ga;
    if (lb > 1e-3) dirAcc += (tb / lb).xy * gb;
  }
  float dl = length(dirAcc);
  if (dl > 1e-3) dirAcc /= dl;
  return vec3(total, dirAcc);
}

vec3 stellarSurface(vec3 p, vec3 n, vec3 v){
  float t = uTime;
  vec3 pr = worldToSun(p);

  vec3 drift = vec3(t * 0.004, t * 0.007, t * 0.003);
  float activity = fbm2(pr * 1.8 + vec3(t * 0.0015, 0.0, 0.0));

  vec3 spot = spotField(pr, activity);
  vec3 prom = promFootField(n);
  float umbra = spot.x;
  float penumbra = spot.y;
  float plage = spot.z;
  float promFoot = prom.x;
  vec2 promDir = prom.yz;

  vec3 sgW = warp(pr, 3.0, 0.35);
  float sgF1 = worley(sgW * 18.0 + drift * 0.20).x;
  float superGran = 1.0 - smoothstep(0.0, 0.85, sgF1);

  vec3 midW = warp(pr, 6.0, 0.25);
  float midF1 = worley(midW * 55.0 + drift * 0.5).x;
  float midGran = 1.0 - smoothstep(0.0, 0.75, midF1);

  vec3 gW = warp(pr, 10.0, 0.16);
  if (uLifeEvolve > 0.5){
    vec3 lifeOff = vec3(
      vnoise(gW * 3.0 + uTime * 0.06),
      vnoise(gW * 3.0 + uTime * 0.06 + 17.3),
      vnoise(gW * 3.0 + uTime * 0.06 + 43.7)
    ) - 0.5;
    gW += lifeOff * 0.0013;
  }

  vec2 gw = worley(gW * 150.0 + drift * 1.0);
  float f1 = gw.x;
  float f2 = gw.y;
  float core = 1.0 - smoothstep(0.0, 0.52, f1);
  float lane = smoothstep(0.02, 0.22, f2 - f1);
  float gran = mix(0.15, 1.0, core * lane);
  float subtle = fbm3(pr * 90.0 + drift * 2.0);
  gran *= 0.94 + 0.12 * subtle;

  gran *= 1.0 - umbra * 0.92;
  gran *= 1.0 - (penumbra - umbra) * 0.30;

  if (promFoot > 0.01){
    float footTurb = vnoise(pr * 22.0 + vec3(promDir * 4.0, t * 0.25));
    float footAmp = clamp(promFoot, 0.0, 1.0);
    gran = mix(gran, gran * (0.65 + 0.85 * footTurb), footAmp * 0.7);
  }

  float bright = 0.70 + uGranContrast * gran
               + 0.05 * (superGran - 0.5)
               + 0.04 * (midGran - 0.5)
               + 0.05 * (activity - 0.5);
  bright *= 1.0 + plage * 0.20;

  float mu = clamp(dot(n, v), 0.0, 1.0);
  float limb = 1.0 - uLimb * (1.0 - mu);
  bright *= limb;

  vec3 col = uBaseColor * bright * uBrightness;

  float darken = umbra * 0.88 + (penumbra - umbra) * 0.50;
  vec3 spotTint = mix(vec3(1.0), vec3(1.00, 0.82, 0.65), umbra * 0.75);
  col *= (1.0 - max(darken, 0.0)) * spotTint;

  if (uEnableHaze > 0.5){
    float frontHaze = pow(1.0 - mu, 1.6);
    float hazeNoise = fbm3(pr * 40.0 + vec3(t * 0.06, t * 0.04, 0.0));
    col += uCoronaColor * frontHaze * (0.35 + 0.65 * hazeNoise) * 0.55;
  }

  if (uEnableChromo > 0.5){
    float rim = pow(1.0 - mu, 4.0);
    float spic = fbm3(pr * 70.0 + vec3(t * 0.10, t * 0.065, 0.0));
    col += uChromoColor * rim * (0.25 + 0.75 * spic) * 0.45;
  }

  for (int i = 0; i < 3; i++){
    vec3 fd = normalize(uFlareDir[i]);
    float fa = clamp(uFlareData[i].x, 0.0, 1.0);
    float fi = uFlareData[i].y;
    if (fi <= 0.0) continue;
    float env = flareEnv(fa);
    if (env < 0.002) continue;
    float ang = acos(clamp(dot(pr, fd), -1.0, 1.0));
    float footR = 0.045 + 0.090 * fa;
    float foot = exp(-pow(ang / footR, 2.0)) * 2.4;
    float haloR = 0.13 + 0.22 * fa;
    float halo = exp(-pow(ang / haloR, 2.0)) * 0.60;
    float e = env * fi * (foot + halo);
    vec3 flareCol = mix(uBaseColor, vec3(1.0), 0.35);
    col += flareCol * e * (0.30 + 0.70 * mu);
  }

  return col;
}

vec3 coronaSample(vec3 p){
  float r = length(p);
  float rr = r / uR;
  float fall = pow(rr, -2.2) * exp(-(rr - 1.0) * 1.6);
  vec3 dir = p / r;
  float n = fbm3(dir * 4.0 + vec3(0.0, uTime * 0.008, uTime * 0.005));
  float fil = 0.40 + 0.60 * n;
  float mixT = clamp((rr - 1.0) / 1.5, 0.0, 1.0) * 0.6;
  vec3 tint = mix(uCoronaColor, uChromoColor, mixT);
  return tint * fall * fil;
}

vec3 flareCME(vec3 p){
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++){
    float fi = uFlareData[i].y;
    if (fi <= 0.0) continue;
    float fa = clamp(uFlareData[i].x, 0.0, 1.0);
    float env = flareEnv(fa);
    if (env < 0.002) continue;
    vec3 fd = sunToWorld(normalize(uFlareDir[i]));
    vec3 center = fd * (uR + fa * 0.90);
    float shellR = 0.22 + fa * 0.75;
    float d = length(p - center);
    float shell = exp(-pow((d - shellR) / (0.15 + 0.28 * fa), 2.0));
    float turb = vnoise(p * 6.0 + vec3(uTime * 0.35, uTime * 0.22, 0.0));
    shell *= 0.30 + 1.30 * turb;
    acc += uCoronaColor * shell * env * fi * 0.50;
  }
  return acc;
}

vec3 renderCorona(vec3 ro, vec3 rd){
  float b = dot(ro, rd);
  float c = dot(ro, ro);
  float discO = b * b - (c - ROUT * ROUT);
  if (discO < 0.0) return vec3(0.0);
  float sq = sqrt(discO);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  float discI = b * b - (c - uR * uR);
  if (discI > 0.0){
    float tIn = -b - sqrt(discI);
    if (tIn > 0.0) t1 = min(t1, tIn);
  }
  if (t1 <= t0) return vec3(0.0);
  float dt = (t1 - t0) / float(max(uCoronaSteps, 1));
  float jitter = hash13(vec3(gl_FragCoord.xy, 0.0));
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_CORONA_STEPS}; i++){
    if (i >= uCoronaSteps) break;
    float tt = t0 + (float(i) + jitter) * dt;
    vec3 p = ro + rd * tt;
    vec3 s = coronaSample(p);
    if (uEnableCME > 0.5) s += flareCME(p);
    sum += s * dt;
  }
  return sum * 0.55;
}

vec3 prominenceSample(vec3 p){
  vec3 acc = vec3(0.0);
  float r = length(p);
  float t = uTime;
  for (int i = 0; i < 2; i++){
    float strength = uPromData[i].x;
    if (strength <= 0.005) continue;
    vec3 a = sunToWorld(normalize(uPromA[i]));
    vec3 b = sunToWorld(normalize(uPromB[i]));
    vec3 nrm = cross(a, b);
    float nl = length(nrm);
    if (nl < 1e-4) continue;
    nrm /= nl;
    vec3 dir = p / r;
    vec3 dirArc = dir - dot(dir, nrm) * nrm;
    float dl = length(dirArc);
    if (dl < 1e-4) continue;
    dirArc /= dl;
    float da = dot(dirArc, a);
    float db = dot(dirArc, b);
    if (da < 0.0 || db < 0.0) continue;
    float totalArc = acos(clamp(dot(a, b), -1.0, 1.0));
    if (totalArc < 1e-3) continue;
    float u = acos(clamp(da, -1.0, 1.0)) / totalArc;
    float h = 0.34 * sin(PI * u) * (0.75 + 0.5 * strength);
    float delta = acos(clamp(dot(dir, dirArc), -1.0, 1.0));
    float rDiff = r - (uR + h);
    float aDiff = r * delta;
    float dist = sqrt(rDiff * rDiff + aDiff * aDiff);
    float width = 0.014 + 0.006 * sin(PI * u);
    float turb = vnoise(p * 7.0 + vec3(t * 0.12, t * 0.08, 0.0));
    turb = 0.55 + 0.90 * turb;
    float heightFall = 0.35 + 0.65 * sin(PI * u);
    float glow = exp(-pow(dist / width, 2.0)) * turb * heightFall;
    vec3 promCol = vec3(uChromoColor.r, uChromoColor.g * 0.6, uChromoColor.b * 0.4);
    acc += promCol * glow * strength * 2.6;
    if (uMagConnect > 0.5){
      float magWidth = 0.045;
      float magGlow = exp(-pow(dist / magWidth, 2.0)) * turb * heightFall * 0.22;
      acc += uCoronaColor * magGlow * strength * 0.5;
    }
  }
  return acc;
}

vec3 renderProminence(vec3 ro, vec3 rd){
  bool anyActive = false;
  for (int i = 0; i < 2; i++){
    if (uPromData[i].x > 0.005) { anyActive = true; break; }
  }
  if (!anyActive) return vec3(0.0);
  bool nearPlane = false;
  for (int i = 0; i < 2; i++){
    if (uPromData[i].x <= 0.005) continue;
    vec3 aR = sunToWorld(normalize(uPromA[i]));
    vec3 bR = sunToWorld(normalize(uPromB[i]));
    vec3 nrm = cross(aR, bR);
    float nl = length(nrm);
    if (nl < 1e-4) continue;
    nrm /= nl;
    if (abs(dot(rd, nrm)) < 0.55) { nearPlane = true; break; }
  }
  if (!nearPlane) return vec3(0.0);
  const float PROM_R = 1.7;
  float b = dot(ro, rd);
  float c = dot(ro, ro);
  float discO = b * b - (c - PROM_R * PROM_R);
  if (discO < 0.0) return vec3(0.0);
  float sq = sqrt(discO);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  float discI = b * b - (c - uR * uR);
  if (discI > 0.0){
    float tIn = -b - sqrt(discI);
    if (tIn > 0.0) t1 = min(t1, tIn);
  }
  if (t1 <= t0) return vec3(0.0);
  float dt = (t1 - t0) / float(max(uPromSteps, 1));
  float jitter = hash13(vec3(gl_FragCoord.xy, 7.3));
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_PROM_STEPS}; i++){
    if (i >= uPromSteps) break;
    float tt = t0 + (float(i) + jitter) * dt;
    vec3 p = ro + rd * tt;
    sum += prominenceSample(p) * dt;
  }
  return sum * 0.5;
}

vec3 tonemap(vec3 x){
  x = max(x, vec3(0.0));
  float m = max(max(x.r, x.g), x.b);
  float mNew = m / (1.0 + max(0.0, m - 0.85) * 0.6);
  return x * (mNew / max(m, 1e-5));
}
`;

const VERT_SURFACE = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vWorldPos;
void main() {
  vLocalPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG_SURFACE = COMMON + /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vWorldPos;
void main() {
  vec3 n = normalize(vLocalPos);
  vec3 v = normalize(cameraPosition - vWorldPos);
  vec3 col = stellarSurface(vLocalPos, n, v);
  col = tonemap(col);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT_HALO = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG_HALO = COMMON + /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - ro);
  vec3 roLocal = ro - uStarPos;
  float b = dot(roLocal, rd);
  float c = dot(roLocal, roLocal);
  float discO = b * b - (c - ROUT * ROUT);
  if (discO < 0.0) discard;
  float discI = b * b - (c - uR * uR);
  if (discI > 0.0) {
    float tIn = -b - sqrt(discI);
    if (tIn > 0.0) discard;
  }
  vec3 col = renderCorona(roLocal, rd);
  col += renderProminence(roLocal, rd);
  col = tonemap(col);
  col = pow(col, vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════
// JS 端耀斑 / 日珥
// ═══════════════════════════════════════════════════════════════
function randomFlareDir() {
  const cz = 0.10 + Math.random() * 0.90;
  const sp = Math.sqrt(Math.max(0.0, 1.0 - cz * cz));
  const ph = Math.random() * Math.PI * 2.0;
  return [sp * Math.cos(ph), sp * Math.sin(ph), cz];
}

function randomPromBaseDir() {
  const cz = (Math.random() - 0.5) * 0.35;
  const sp = Math.sqrt(Math.max(0.0, 1.0 - cz * cz));
  const ph = Math.random() * Math.PI * 2.0;
  return [sp * Math.cos(ph), sp * Math.sin(ph), cz];
}

function rotateToward(base, span) {
  let tx = Math.random() - 0.5;
  let ty = Math.random() - 0.5;
  let tz = Math.random() - 0.5;
  const d = tx * base[0] + ty * base[1] + tz * base[2];
  tx -= d * base[0]; ty -= d * base[1]; tz -= d * base[2];
  const l = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (l < 1e-4) return rotateToward(base, span);
  tx /= l; ty /= l; tz /= l;
  const c = Math.cos(span), s = Math.sin(span);
  const cx = ty * base[2] - tz * base[1];
  const cy = tz * base[0] - tx * base[2];
  const cz2 = tx * base[1] - ty * base[0];
  return [
    base[0] * c + cx * s,
    base[1] * c + cy * s,
    base[2] * c + cz2 * s,
  ];
}

function updateFlares(state, t) {
  try {
    state.flares = state.flares.filter(f => t - f.start < f.duration);
    if (t >= state.nextFlareAt) {
      if (state.flares.length < 3) {
        state.flares.push({
          dir: randomFlareDir(),
          start: t,
          duration: 4.0 + Math.random() * 6.5,
          intensity: 0.75 + Math.random() * 0.75,
        });
        state.nextFlareAt = t + 1.2 + Math.random() * 3.5;
      } else {
        state.nextFlareAt = t + 1.0 + Math.random() * 3.0;
      }
    }
  } catch (err) { reportError('30060', err); }
}

function packFlares(state, dirArr, dataArr) {
  dirArr.fill(0);
  dataArr.fill(0);
  for (let i = 0; i < state.flares.length && i < 3; i++) {
    const f = state.flares[i];
    dirArr[i * 3 + 0] = f.dir[0];
    dirArr[i * 3 + 1] = f.dir[1];
    dirArr[i * 3 + 2] = f.dir[2];
    let age = (state._now - f.start) / f.duration;
    if (age < 0) age = 0;
    if (age > 1) age = 1;
    dataArr[i * 4 + 0] = age;
    dataArr[i * 4 + 1] = f.intensity;
  }
}

function promEnv(age) {
  if (age < 0 || age > 1) return 0;
  const rise = Math.min(1, age / 0.15);
  const fall = age < 0.75 ? 1 : (1 - (age - 0.75) / 0.25);
  return rise * fall;
}

function updateProminences(state, t) {
  try {
    state.prominences = state.prominences.filter(p => t - p.start < p.duration);
    if (t >= state.nextPromAt) {
      if (state.prominences.length < 2) {
        const a = randomPromBaseDir();
        const span = 0.55 + Math.random() * 0.55;
        const b = rotateToward(a, span);
        state.prominences.push({
          a, b, start: t,
          duration: 8.0 + Math.random() * 8.0,
          strength: 0.75 + Math.random() * 0.45,
        });
        state.nextPromAt = t + 4.0 + Math.random() * 6.0;
      } else {
        state.nextPromAt = t + 2.5 + Math.random() * 2.0;
      }
    }
  } catch (err) { reportError('30061', err); }
}

function packProminences(state, aArr, bArr, dataArr) {
  aArr.fill(0); bArr.fill(0); dataArr.fill(0);
  for (let i = 0; i < state.prominences.length && i < 2; i++) {
    const pr = state.prominences[i];
    aArr[i * 3 + 0] = pr.a[0];
    aArr[i * 3 + 1] = pr.a[1];
    aArr[i * 3 + 2] = pr.a[2];
    bArr[i * 3 + 0] = pr.b[0];
    bArr[i * 3 + 1] = pr.b[1];
    bArr[i * 3 + 2] = pr.b[2];
    const age = (state._now - pr.start) / pr.duration;
    dataArr[i * 2 + 0] = pr.strength * promEnv(age);
  }
}

// ═══════════════════════════════════════════════════════════════
// 校验
// ═══════════════════════════════════════════════════════════════
function validateParams(presetKey, radius) {
  if (!STAR_PRESETS[presetKey]) {
    reportError('00062', new Error(`unknown preset: ${presetKey}`), { presetKey });
    return false;
  }
  if (!(typeof radius === 'number' && radius > 0 && isFinite(radius))) {
    reportError('30064', new Error(`invalid radius: ${radius}`), { radius });
    return false;
  }
  return true;
}

function validateUniforms(uniforms) {
  const checks = [
    ['uFlareDir',  9],
    ['uFlareData', 12],
    ['uPromA',     6],
    ['uPromB',     6],
    ['uPromData',  4],
  ];
  for (const [name, expected] of checks) {
    const v = uniforms[name]?.value;
    const len = (v && typeof v.length === 'number') ? v.length : -1;
    if (len !== expected) {
      reportError('30065', new Error(`uniform ${name} length ${len} ≠ ${expected}`),
        { uniform: name, got: len, expected });
      return false;
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// 工厂
// ═══════════════════════════════════════════════════════════════
export function createSunMesh(presetKey, _initialRadius = 0.7, options = {}) {
  // ★ radius 从形参改为可写变量
  let radius = _initialRadius;

  try {
    if (!validateParams(presetKey, radius)) {
      presetKey = 'yellow';
      radius = 0.7;
    }

    const opts = options || {};
    const startLevel = Number.isInteger(opts.startLevel)
      ? Math.max(1, Math.min(9, opts.startLevel))
      : DEFAULT_START_LEVEL;
    let _riseMs = (Number.isFinite(opts.riseMs) && opts.riseMs >= 0)
      ? opts.riseMs
      : DEFAULT_RISE_MS;
    const fixedLevel = Number.isInteger(opts.fixedLevel)
      ? Math.max(1, Math.min(9, opts.fixedLevel))
      : null;

    const preset = STAR_PRESETS[presetKey];

    const uniforms = {
      uTime:         { value: 0 },
      uR:            { value: radius },
      uStarPos:      { value: new THREE.Vector3() },

      uFlareDir:     { value: new Float32Array(9) },
      uFlareData:    { value: new Float32Array(12) },
      uPromA:        { value: new Float32Array(6) },
      uPromB:        { value: new Float32Array(6) },
      uPromData:     { value: new Float32Array(4) },

      uBaseColor:    { value: new THREE.Color(...preset.base) },
      uChromoColor:  { value: new THREE.Color(...preset.chromo) },
      uCoronaColor:  { value: new THREE.Color(...preset.corona) },
      uLimb:         { value: preset.limb },
      uGranContrast: { value: preset.granContrast },
      uBrightness:   { value: preset.brightness },
      uLifeEvolve:   { value: 1.0 },
      uFlattening:   { value: 0.0 },
      uMagConnect:   { value: 1.0 },

      uCoronaSteps:  { value: LOD_CONFIGS[startLevel].CORONA_STEPS },
      uPromSteps:    { value: LOD_CONFIGS[startLevel].PROM_STEPS },
      uEnableCME:    { value: LOD_CONFIGS[startLevel].ENABLE_CME },
      uEnableChromo: { value: LOD_CONFIGS[startLevel].ENABLE_CHROMO },
      uEnableHaze:   { value: LOD_CONFIGS[startLevel].ENABLE_HAZE },
    };

    if (!validateUniforms(uniforms)) {
      throw new Error('uniform validation failed');
    }

    const surfaceGeo = new THREE.SphereGeometry(radius, 48, 48);
    const surfaceMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader:   VERT_SURFACE,
      fragmentShader: FRAG_SURFACE,
      transparent:    false,
      depthTest:      true,
      depthWrite:     true,
      toneMapped:     false,
    });
    const surface = new THREE.Mesh(surfaceGeo, surfaceMat);

    const haloGeo = new THREE.SphereGeometry(radius * 4.6, 32, 32);
    const haloMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader:   VERT_HALO,
      fragmentShader: FRAG_HALO,
      transparent:    true,
      blending:       THREE.AdditiveBlending,
      depthTest:      true,
      depthWrite:     false,
      side:           THREE.BackSide,
      toneMapped:     false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);

    const group = new THREE.Group();
    group.add(surface);
    group.add(halo);

    const state = {
      flares: [],
      nextFlareAt: 2.5,
      prominences: [],
      nextPromAt: 5.0,
      _now: 0,
    };

    let disposed = false;
    let level = startLevel;
    let targetLevel = fixedLevel !== null ? fixedLevel : startLevel;
    let lastRiseTime = 0;

    function applyLevel(lv) {
      const cfg = LOD_CONFIGS[lv];
      if (!cfg) return;
      uniforms.uCoronaSteps.value  = cfg.CORONA_STEPS;
      uniforms.uPromSteps.value    = cfg.PROM_STEPS;
      uniforms.uEnableCME.value    = cfg.ENABLE_CME;
      uniforms.uEnableChromo.value = cfg.ENABLE_CHROMO;
      uniforms.uEnableHaze.value   = cfg.ENABLE_HAZE;
      level = lv;
    }

    if (fixedLevel !== null) {
      applyLevel(fixedLevel);
    }

    return {
      group,
      surface,
      halo,
      materials: { surface: surfaceMat, halo: haloMat },
      uniforms,
      radius,
      presetKey,

      setTargetLevel(newLevel) {
        if (disposed) return;
        if (fixedLevel !== null) return;
        try {
          targetLevel = Math.max(1, Math.min(9, Math.round(newLevel)));
        } catch (err) {
          reportError('30063', err, { level: newLevel });
        }
      },

      setRiseMs(ms) {
        if (disposed || fixedLevel !== null) return;
        try {
          _riseMs = Math.max(50, Math.min(5000, Number(ms) || DEFAULT_RISE_MS));
        } catch (err) {
          reportError('30063', err, { ms });
        }
      },

      // ★ 新增：运行时调整太阳半径，重建几何
      setRadius(newRadius) {
        if (disposed) return;
        const r = Number(newRadius);
        if (!(isFinite(r) && r > 0)) return;
        radius = r;
        this.radius = r;
        uniforms.uR.value = r;
        try {
          surface.geometry.dispose();
          surface.geometry = new THREE.SphereGeometry(r, 48, 48);
          halo.geometry.dispose();
          halo.geometry = new THREE.SphereGeometry(r * 4.6, 32, 32);
        } catch (err) {
          reportError('00060', err, { phase: 'setRadius', r });
        }
      },

      getLevel() { return level; },
      getTargetLevel() { return targetLevel; },
      isFixed() { return fixedLevel !== null; },

      update(t, pos, camera, pulse = 1.0) {
        if (disposed) return;
        try {
          if (!isFinite(t)) { t = 0; }
          if (!Array.isArray(pos) || pos.length < 3
              || !isFinite(pos[0]) || !isFinite(pos[1]) || !isFinite(pos[2])) {
            return;
          }
          if (!camera || !camera.isCamera) return;
          if (!isFinite(pulse) || pulse <= 0) pulse = 1.0;

          state._now = t;
          const u = uniforms;
          u.uTime.value = t;
          u.uR.value = radius * pulse;
          u.uStarPos.value.set(pos[0], pos[1], pos[2]);

          updateFlares(state, t);
          packFlares(state, u.uFlareDir.value, u.uFlareData.value);
          updateProminences(state, t);
          packProminences(state, u.uPromA.value, u.uPromB.value, u.uPromData.value);

          if (fixedLevel !== null) {
            // 固定模式
          } else {
            const now = performance.now();
            if (level < targetLevel && now - lastRiseTime > _riseMs) {
              applyLevel(level + 1);
              lastRiseTime = now;
            } else if (level > targetLevel) {
              applyLevel(targetLevel);
            }
          }
        } catch (err) {
          reportError('30062', err);
        }
      },

      dispose() {
        if (disposed) return;
        disposed = true;
        try { surfaceGeo.dispose(); } catch (_) {}
        try { haloGeo.dispose(); } catch (_) {}
        try { surfaceMat.dispose(); } catch (_) {}
        try { haloMat.dispose(); } catch (_) {}
      },

      debug() {
        return {
          presetKey: this.presetKey,
          radius: this.radius,
          level,
          targetLevel,
          fixedLevel,
          startLevel,
          riseMs: _riseMs,
          flares: state.flares.length,
          prominences: state.prominences.length,
          disposed,
        };
      },
    };
  } catch (err) {
    reportError('00060', err, { presetKey, radius });
    return {
      group: new THREE.Group(),
      surface: null, halo: null,
      materials: {}, uniforms: {},
      radius, presetKey,
      setTargetLevel() {}, setRiseMs() {}, setRadius() {},
      getLevel() { return 1; },
      getTargetLevel() { return 1; }, isFixed() { return false; },
      update() {}, dispose() {}, debug() { return { failed: true }; },
    };
  }
}