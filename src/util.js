/* ============================================================================
 * NEON SERPENT · 霓虹蛇域
 * 数学 / 噪声 / 对象池 / 设备探测 / 存储
 * 目标：零依赖工具层，供 scene / game / ui / main 共用
 * ==========================================================================*/
(function (global) {
  "use strict";

  const N = {};

  /* ------------------------------ 数学常量 ------------------------------ */
  N.TAU = Math.PI * 2;
  N.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  N.clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  N.lerp = (a, b, t) => a + (b - a) * t;
  N.invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  N.smoothstep = (e0, e1, x) => {
    const t = N.clamp01((x - e0) / (e1 - e0 || 1e-9));
    return t * t * (3 - 2 * t);
  };
  N.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  N.easeInCubic = (t) => t * t * t;
  N.easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
  N.easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  N.easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  N.easeOutBack = (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  N.easeOutElastic = (t) => {
    const c4 = N.TAU / 3;
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  };

  // 帧率无关的指数趋近（lambda 越大越快）
  N.damp = (a, b, lambda, dt) => N.lerp(a, b, 1 - Math.exp(-lambda * dt));

  N.rand = (a, b) => a + Math.random() * (b - a);
  N.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  N.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  N.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

  /* ---------------------------- 确定性随机数 ---------------------------- */
  // mulberry32：小而快，做星域/网格的确定性布局
  N.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ------------------------------- 颜色 ------------------------------- */
  // hex -> [r,g,b] 线性空间（近似，用于材质）
  N.hexToRgb = function (hex) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  };
  N.hsl = function (h, s, l, a) {
    return a === undefined
      ? `hsl(${(h * 360) | 0} ${(s * 100) | 0}% ${(l * 100) | 0}%)`
      : `hsla(${(h * 360) | 0} ${(s * 100) | 0}% ${(l * 100) | 0}% / ${a})`;
  };
  N.rgba = function (r, g, b, a) {
    return `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;
  };
  // 霓虹调色板（HSL 循环）
  N.palette = function (t, sat, lig) {
    const h = (t % 1 + 1) % 1;
    return new global.THREE.Color().setHSL(h, sat === undefined ? 0.85 : sat, lig === undefined ? 0.58 : lig);
  };
  // 蛇身主色带：青 -> 靛 -> 品红 -> 琥珀 -> 青（闭环）
  N.serpentGradient = function (t, out) {
    const hue = (0.46 + t * 0.86) % 1;
    out = out || new global.THREE.Color();
    out.setHSL(hue, 0.92, 0.60);
    return out;
  };

  /* ------------------------------- 对象池 ------------------------------- */
  N.Pool = class Pool {
    constructor(factory, reset, size) {
      this.factory = factory; this.reset = reset;
      this.free = []; this.used = [];
      for (let i = 0; i < (size || 0); i++) this.free.push(factory());
    }
    get() {
      const o = this.free.length ? this.free.pop() : this.factory();
      if (this.reset) this.reset(o);
      this.used.push(o);
      return o;
    }
    release(o) {
      const i = this.used.indexOf(o);
      if (i >= 0) this.used.splice(i, 1);
      this.free.push(o);
    }
    releaseAll() {
      while (this.used.length) this.free.push(this.used.pop());
    }
  };

  /* ---------------------------- 设备能力探测 ---------------------------- */
  N.device = function () {
    const ua = navigator.userAgent || "";
    const maxTouch = navigator.maxTouchPoints || 0;
    const touch = ("ontouchstart" in global.window) || maxTouch > 0;
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MiuiBrowser|OppoBrowser|VivoBrowser|UCBrowser|Quark/i.test(ua);
    const iPadOS = /Macintosh/.test(ua) && maxTouch > 1;
    const isMobile = uaMobile || iPadOS;
    const dpr = global.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || navigator.deviceMemory === 0 ? navigator.deviceMemory : (navigator.deviceMemory || 4);
    const screenPx = (global.screen ? Math.min(screen.width, screen.height) : 400) * dpr;
    return {
      touch, isMobile, iPadOS, dpr, cores, mem,
      screenPx,
      isIOS: /iPhone|iPad|iPod/.test(ua) || iPadOS,
      isAndroid: /Android/.test(ua),
      reducedMotion: global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
      saveData: navigator.connection ? !!navigator.connection.saveData : false,
      webgl2: (() => {
        try { return !!document.createElement("canvas").getContext("webgl2"); } catch (e) { return false; }
      })(),
      // 粗粒度档位建议（仍会被 FPS 自适应覆盖）
      lowPower: (uaMobile && cores <= 4) || screenPx < 700,
    };
  };

  /* ------------------------------- 存储 ------------------------------- */
  const KEY = "neon-serpent/v1";
  N.store = {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
    },
    save(o) {
      try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 隐私模式忽略 */ }
    },
    patch(p) {
      const o = N.store.load();
      Object.assign(o, p);
      N.store.save(o);
      return o;
    },
  };

  /* ------------------------- 画质档位定义 ------------------------- */
  // 0 = 极致 / 1 = 高 / 2 = 平衡 / 3 = 流畅 / 4 = 省电
  N.QUALITY = [
    { id: 0, name: "极致", name_en: "ULTRA",  dpr: 2.00, bloom: 1.00, galaxy: 1.00, particles: 1.00, grain: 1, motion: true,  trails: 1, softShadow: true  },
    { id: 1, name: "高",   name_en: "HIGH",   dpr: 1.65, bloom: 0.85, galaxy: 0.80, particles: 0.80, grain: 1, motion: true,  trails: 1, softShadow: true  },
    { id: 2, name: "平衡", name_en: "BALANCED", dpr: 1.30, bloom: 0.70, galaxy: 0.55, particles: 0.55, grain: 1, motion: true,  trails: 1, softShadow: false },
    { id: 3, name: "流畅", name_en: "SMOOTH", dpr: 1.00, bloom: 0.50, galaxy: 0.35, particles: 0.32, grain: 0, motion: true,  trails: 0, softShadow: false },
    { id: 4, name: "省电", name_en: "BATTERY", dpr: 0.80, bloom: 0.00, galaxy: 0.18, particles: 0.16, grain: 0, motion: false, trails: 0, softShadow: false },
  ];

  /* ------------------------------ FPS 采样 ------------------------------ */
  N.FpsMeter = class FpsMeter {
    constructor(window_) {
      this.buf = new Float32Array(window_ || 45);
      this.i = 0; this.n = 0; this.avg = 60; this.worst = 60;
    }
    push(dt) {
      const fps = dt > 0 ? 1 / dt : 60;
      this.buf[this.i] = fps;
      this.i = (this.i + 1) % this.buf.length;
      if (this.n < this.buf.length) this.n++;
      let s = 0, w = 1e9;
      for (let k = 0; k < this.n; k++) { const v = this.buf[k]; s += v; if (v < w) w = v; }
      this.avg = s / this.n;
      this.worst = w;
      return this.avg;
    }
    reset() { this.n = 0; this.i = 0; }
  };

  /* -------------------------------- DOM -------------------------------- */
  N.el = function (tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  N.$ = (s, r) => (r || document).querySelector(s);
  N.$$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  /* ---------------------------- 全屏 / 屏幕锁定 ---------------------------- */
  N.requestFullscreen = function () {
    const e = document.documentElement;
    const fn = e.requestFullscreen || e.webkitRequestFullscreen || e.mozRequestFullScreen || e.msRequestFullscreen || e.webkitEnterFullscreen;
    if (fn) { try { fn.call(e, { navigationUI: "hide" }); } catch (err) { try { fn.call(e); } catch (e2) {} } }
    if (screen.orientation && screen.orientation.lock) {
      try { screen.orientation.lock("any").catch(() => {}); } catch (e) {}
    }
  };
  N.isFullscreen = function () {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  };

  global.N = N;
})(window);
