/* ============================================================================
 * NEON SERPENT · 渲染核心
 * - 程序化环境贴图（PMREM, 零 HDR 素材）→ PBR 反射
 * - HDR 半浮点渲染目标 → ACES Filmic → Bloom → 色散 → 暗角 → 胶片颗粒 → 抖动
 * - 程序化银河：恒星、螺旋星云带、尘埃带、动态体积光
 * - 对象池粒子系统（Points, additive）+ 冲击波 + 网格
 * ==========================================================================*/
(function (global) {
  "use strict";
  const N = global.N;
  const THREE = global.THREE;

  const S = {};

  /* ====================================================================== */
  /* 一、程序化环境贴图（IBL）                                              */
  /*     思路：用 Canvas2D 画一张 2:1 等距圆柱 HDR 感的霓虹环境，           */
  /*     经 PMREMGenerator 卷积成辐照度贴图，给所有 PBR 材质提供反射。      */
  /* ====================================================================== */
  function buildEnvironment(renderer) {
    const w = 1024, h = 512;
    const cvs = document.createElement("canvas");
    cvs.width = w; cvs.height = h;
    const c = cvs.getContext("2d");

    // 天顶到地平线：深空蓝 -> 紫
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0.00, "#050215");
    sky.addColorStop(0.35, "#0a0530");
    sky.addColorStop(0.62, "#160a45");
    sky.addColorStop(0.80, "#2a0d54");
    sky.addColorStop(1.00, "#05010f");
    c.fillStyle = sky; c.fillRect(0, 0, w, h);

    // 三大霓虹光源（模拟场景中的"棚灯 + 轮廓灯"）
    const lights = [
      { x: 0.18, y: 0.34, r: 0.42, col: [0, 255, 213], a: 0.95 },
      { x: 0.62, y: 0.22, r: 0.38, col: [124, 108, 255], a: 0.85 },
      { x: 0.86, y: 0.55, r: 0.34, col: [255, 110, 190], a: 0.75 },
      { x: 0.42, y: 0.78, r: 0.30, col: [255, 196, 108], a: 0.45 },
    ];
    c.globalCompositeOperation = "lighter";
    for (const L of lights) {
      const g = c.createRadialGradient(L.x * w, L.y * h, 1, L.x * w, L.y * h, L.r * w);
      g.addColorStop(0, `rgba(${L.col[0]},${L.col[1]},${L.col[2]},${L.a})`);
      g.addColorStop(0.42, `rgba(${L.col[0]},${L.col[1]},${L.col[2]},${L.a * 0.28})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    // 脉冲星斑点缀
    for (let i = 0; i < 460; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const a = Math.random() * 0.5;
      const s = Math.pow(Math.random(), 3) * 2.6 + 0.4;
      const hue = 160 + Math.random() * 160;
      c.fillStyle = `hsla(${hue} 100% 82% / ${a})`;
      c.beginPath(); c.arc(x, y, s, 0, N.TAU); c.fill();
    }
    c.globalCompositeOperation = "source-over";

    const tex = new THREE.CanvasTexture(cvs);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.NoColorSpace;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    tex.dispose();
    return rt.texture;
  }

  /* ====================================================================== */
  /* 二、银河天穹                                                            */
  /* ====================================================================== */
  // 3D 值噪声（用于星云带）
  function hash3(x, y, z) {
    let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return h - Math.floor(h);
  }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    function g(a, b, cc) { return hash3(xi + a, yi + b, zi + cc); }
    const x00 = N.lerp(g(0, 0, 0), g(1, 0, 0), u);
    const x10 = N.lerp(g(0, 1, 0), g(1, 1, 0), u);
    const x01 = N.lerp(g(0, 0, 1), g(1, 0, 1), u);
    const x11 = N.lerp(g(0, 1, 1), g(1, 1, 1), u);
    return N.lerp(N.lerp(x00, x10, v), N.lerp(x01, x11, v), w);
  }
  function fbm(x, y, z, oct) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < (oct || 4); i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
    return s;
  }

  const GALAXY_VS = `
    varying vec3 vDir;
    void main(){
      vDir = normalize(position);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_Position.z = gl_Position.w; // 永远贴在最远
    }
  `;

  const GALAXY_FS = `
    precision highp float;
    varying vec3 vDir;
    uniform float uTime;
    uniform float uDensity;
    uniform vec3  uTintA;
    uniform vec3  uTintB;
    uniform vec3  uTintC;

    float hash31(vec3 p){
      p = fract(p * vec3(443.897, 441.423, 437.195));
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }
    float vnoise(vec3 x){
      vec3 i = floor(x), f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i + vec3(0,0,0)), n100 = hash31(i + vec3(1,0,0));
      float n010 = hash31(i + vec3(0,1,0)), n110 = hash31(i + vec3(1,1,0));
      float n001 = hash31(i + vec3(0,0,1)), n101 = hash31(i + vec3(1,0,1));
      float n011 = hash31(i + vec3(0,1,1)), n111 = hash31(i + vec3(1,1,1));
      return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                 mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
    }
    float fbm(vec3 p){
      float s = 0.0, a = 0.5;
      for(int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.02; a *= 0.5; }
      return s;
    }

    void main(){
      vec3 d = normalize(vDir);

      // ---- 基底深空渐变 ----
      float horizon = smoothstep(-0.55, 0.65, d.y);
      vec3 col = mix(vec3(0.008, 0.004, 0.028), vec3(0.020, 0.014, 0.062), horizon);

      // ---- 银河带：绕 X 轴倾斜的扁平面 ----
      vec3 bandN = normalize(vec3(0.32, 0.90, -0.16));
      float band = 1.0 - abs(dot(d, bandN));
      float core = pow(smoothstep(0.72, 1.0, band), 2.2);

      // ---- 星云噪声（两层不同频率 + 缓慢流动）----
      vec3 q = d * 2.35 + vec3(0.0, uTime * 0.0075, uTime * 0.0042);
      float n1 = fbm(q * 1.6);
      float n2 = fbm(q * 4.4 + 11.3);
      float dust = smoothstep(0.34, 0.86, n1 * 0.68 + n2 * 0.42);

      vec3 nebA = uTintA * (0.85 * core) * dust;
      vec3 nebB = uTintB * pow(core, 0.7) * (1.0 - dust) * 0.62;
      vec3 nebC = uTintC * pow(core, 1.7) * dust * 0.34;
      col += (nebA + nebB + nebC) * uDensity;

      // ---- 尘埃暗带：切碎星云，制造分层 ----
      float dark = smoothstep(0.30, 0.72, fbm(q * 2.9 + 47.0));
      col *= mix(1.0, 0.28, dark * core * 0.75);

      // ---- 三层恒星 ----
      float t1 = hash31(floor(d * 340.0));
      float t2 = hash31(floor(d * 720.0) + 3.7);
      float t3 = hash31(floor(d * 1500.0) + 9.1);
      float s1 = smoothstep(0.9972, 1.0, t1) * 3.1;
      float s2 = smoothstep(0.9990, 1.0, t2) * 2.0;
      float s3 = smoothstep(0.99972, 1.0, t3) * 1.1;
      float twinkle = 0.72 + 0.28 * sin(uTime * 1.9 + t1 * 240.0);
      float star = (s1 + s2 + s3) * twinkle;
      vec3 starCol = mix(vec3(0.68, 0.85, 1.0), vec3(1.0, 0.86, 0.72), hash31(floor(d * 260.0) + 21.0));
      col += starCol * star * uDensity * 0.9;

      // ---- 地平线雾晕，把网格与天穹缝合 ----
      float ground = smoothstep(0.06, -0.32, d.y);
      col = mix(col, vec3(0.020, 0.006, 0.050), ground * 0.88);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function buildGalaxy(quality) {
    const geo = new THREE.SphereGeometry(1, 64, 40);
    const mat = new THREE.ShaderMaterial({
      vertexShader: GALAXY_VS,
      fragmentShader: GALAXY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uDensity: { value: quality },
        uTintA: { value: new THREE.Color(0.42, 0.22, 1.00) },   // 靛紫
        uTintB: { value: new THREE.Color(1.00, 0.24, 0.72) },   // 品红
        uTintC: { value: new THREE.Color(0.00, 0.95, 0.82) },   // 青
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.scale.setScalar(4000);
    return mesh;
  }

  /* ====================================================================== */
  /* 三、后处理管线（HDR → ACES → Bloom → 色散 → 暗角 → 颗粒 → 抖动）        */
  /* ====================================================================== */
  const POST_VS = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  // 预过滤：阈值 + 软膝 + 4 次降采样打包（13-tap）
  const PRE_VS = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;
  const PRE_FS = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uScene;
    uniform vec2  uTexel;      // 1/源尺寸
    uniform float uThreshold;
    uniform float uSoftKnee;
    uniform float uClamp;

    vec3 fetch(vec2 uv){ return texture2D(uScene, uv).rgb; }
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    vec3 quad(float s){
      // 外圈 4 角
      vec3 a = fetch(vUv + uTexel * vec2(-1.0, -1.0) * s).rgb;
      vec3 b = fetch(vUv + uTexel * vec2( 1.0, -1.0) * s).rgb;
      vec3 c = fetch(vUv + uTexel * vec2(-1.0,  1.0) * s).rgb;
      vec3 d = fetch(vUv + uTexel * vec2( 1.0,  1.0) * s).rgb;
      return (a + b + c + d) * 0.25;
    }

    void main(){
      vec3 c = quad(1.0);
      c += fetch(vUv + uTexel * vec2(0.0, -1.0) * 2.0).rgb;
      c += fetch(vUv + uTexel * vec2(0.0,  1.0) * 2.0).rgb;
      c += fetch(vUv + uTexel * vec2(-1.0, 0.0) * 2.0).rgb;
      c += fetch(vUv + uTexel * vec2( 1.0, 0.0) * 2.0).rgb;
      c += quad(3.0) * 2.0;
      c += quad(8.0) * 0.0625;
      c /= 8.0; // 近似 1/7 权重，避免过曝堆积

      float l = max(lum(c), 1e-5);
      float knee = uThreshold * uSoftKnee + 1e-5;
      float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee);
      float contrib = max(soft, l - uThreshold) / l;
      vec3 outc = c * contrib;
      outc = min(outc, vec3(uClamp));
      gl_FragColor = vec4(outc, 1.0);
    }
  `;

  const DOWN_FS = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uSrc;
    uniform vec2 uTexel;
    void main(){
      vec3 c = texture2D(uSrc, vUv).rgb * 4.0;
      c += texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
      c += texture2D(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
      c += texture2D(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
      c += texture2D(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
      c += texture2D(uSrc, vUv + uTexel * vec2(-2.0,  0.0)).rgb * 0.5;
      c += texture2D(uSrc, vUv + uTexel * vec2( 2.0,  0.0)).rgb * 0.5;
      c += texture2D(uSrc, vUv + uTexel * vec2( 0.0, -2.0)).rgb * 0.5;
      c += texture2D(uSrc, vUv + uTexel * vec2( 0.0,  2.0)).rgb * 0.5;
      gl_FragColor = vec4(c / 9.0, 1.0);
    }
  `;

  const UP_FS = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uSrc;      // 更小一级
    uniform sampler2D uPrev;     // 本级已有内容（加性叠加）
    uniform vec2  uTexel;
    uniform float uScale;
    void main(){
      vec3 c = texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
      c += texture2D(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
      c += texture2D(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
      c += texture2D(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
      c *= 0.25;
      vec3 p = texture2D(uPrev, vUv).rgb;
      gl_FragColor = vec4(p + c * uScale, 1.0);
    }
  `;

  const COMP_FS = `
    precision highp float;
    varying vec2 vUv;

    uniform sampler2D uScene;
    uniform sampler2D uBloom;
    uniform vec2  uRes;
    uniform float uTime;
    uniform float uBloomStrength;
    uniform float uExposure;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uDamage;      // 受击/危险 红闪
    uniform float uLevelUp;     // 升级 白闪
    uniform float uDeath;       // 死亡 去饱和 + 收缩
    uniform float uGameOver;

    // ---- ACES Filmic 色调映射（Narkowicz 拟合）----
    vec3 aces(vec3 x){
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    float hash(vec2 p){
      p = fract(p * vec2(233.34, 851.73));
      p += dot(p, p + 23.45);
      return fract(p.x * p.y);
    }
    vec3 hueShift(vec3 col, float a){
      const vec3 k = vec3(0.57735);
      float ca = cos(a);
      return col * ca + cross(k, col) * sin(a) + k * dot(k, col) * (1.0 - ca);
    }

    void main(){
      vec2 uv = vUv;
      vec2 cen = uv - 0.5;
      float r2 = dot(cen, cen);

      // ---- 死亡：透镜收缩挤压 ----
      if(uDeath > 0.0){
        float k = uDeath;
        uv = 0.5 + cen * (1.0 + k * 0.16 * (0.35 + r2 * 2.2));
      }

      // ---- 径向色散（仅在全屏合成阶段做一次，成本极低）----
      vec2 dir = normalize(cen + 1e-6);
      float ca = uAberration * (0.0016 + r2 * 0.011);
      vec3 col;
      col.r = texture2D(uScene, uv + dir * ca).r;
      col.g = texture2D(uScene, uv).g;
      col.b = texture2D(uScene, uv - dir * ca).b;

      vec3 bloom = texture2D(uBloom, uv).rgb;
      col += bloom * uBloomStrength;

      col *= uExposure;
      // 轻微色相漂移让霓虹更有"电"感
      col = hueShift(col, 0.02 * r2);

      col = aces(col);

      // ---- 暗角 ----
      float vig = 1.0 - uVignette * smoothstep(0.10, 0.86, r2 * 1.55);
      col *= vig;

      // ---- 事件叠加 ----
      col = mix(col, vec3(1.0, 0.24, 0.34), uDamage * (0.22 + 0.30 * smoothstep(0.0, 0.5, r2)));
      col += vec3(0.85, 0.95, 1.0) * uLevelUp * 0.55;

      // ---- 死亡：去饱和 + 压暗 ----
      float g = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(g) * 0.72, uDeath * 0.78);
      col = mix(col, col * 0.55, uGameOver * 0.45);

      // ---- 胶片颗粒 ----
      if(uGrain > 0.0){
        float n = hash(uv * uRes + fract(uTime) * 137.0) - 0.5;
        col += n * uGrain * 0.055;
      }

      // ---- 抖动，消除 HDR 到 8bit 的色带 ----
      col += (hash(uv * uRes * 0.87 + 7.77) - 0.5) / 255.0;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function makeRT(w, h, type, depth) {
    const rt = new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
      type: type || THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: depth !== false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
  }

  function PostFX(renderer, caps) {
    this.renderer = renderer;
    this.caps = caps;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.qScene = new THREE.Scene();
    this.qCam = new THREE.Camera();
    this.qScene.add(this.quad);
    this.quad.frustumCulled = false;

    const spread = 8;
    this.mips = [];
    for (let i = 0; i < spread; i++) {
      this.mips.push({
        rt: makeRT(64, 64, THREE.HalfFloatType, false),
        mat: null,
      });
    }

    this.preMat = new THREE.ShaderMaterial({
      vertexShader: PRE_VS, fragmentShader: PRE_FS,
      uniforms: {
        uScene: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: 0.72 },
        uSoftKnee: { value: 0.58 },
        uClamp: { value: 26.0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.downMat = new THREE.ShaderMaterial({
      vertexShader: POST_VS, fragmentShader: DOWN_FS,
      uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      vertexShader: POST_VS, fragmentShader: UP_FS,
      uniforms: {
        uSrc: { value: null }, uPrev: { value: null },
        uTexel: { value: new THREE.Vector2() }, uScale: { value: 1.0 },
      },
      depthTest: false, depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: POST_VS, fragmentShader: COMP_FS,
      uniforms: {
        uScene: { value: null }, uBloom: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uBloomStrength: { value: 1.0 },
        uExposure: { value: 1.06 }, uGrain: { value: 1 }, uVignette: { value: 0.62 },
        uAberration: { value: 1.0 }, uDamage: { value: 0 },
        uLevelUp: { value: 0 }, uDeath: { value: 0 }, uGameOver: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });

    this.enabled = true;
    this.bloomEnabled = true;
    this.absSupported = caps.absSupport;
    this.mipCount = 6;
  }

  PostFX.prototype.setSize = function (w, h) {
    if (this.rtScene) this.rtScene.dispose();
    this.rtScene = makeRT(w, h, THREE.HalfFloatType, true);
    const bw = Math.max(8, w >> 1), bh = Math.max(8, h >> 1);
    let cw = bw, ch = bh;
    for (let i = 0; i < this.mips.length; i++) {
      if (i > 0) { cw = Math.max(4, cw >> 1); ch = Math.max(4, ch >> 1); }
      const m = this.mips[i];
      m.rt.dispose();
      m.rt = makeRT(cw, ch, THREE.HalfFloatType, false);
      m.w = cw; m.h = ch;
    }
    this.compMat.uniforms.uRes.value.set(w, h);
    this.texel = new THREE.Vector2(1 / w, 1 / h);
  };

  PostFX.prototype.render = function (scene, camera, time, events) {
    const r = this.renderer;
    const src = this.rtScene;
    const comp = this.compMat.uniforms;

    // ---------- 1. 主场景 → HDR 缓冲 ----------
    r.setRenderTarget(src);
    r.clear();
    r.render(scene, camera);

    const useBloom = this.enabled && this.bloomEnabled;
    if (!useBloom) {
      r.setRenderTarget(null);
      comp.uScene.value = src.texture;
      comp.uBloom.value = src.texture;
      comp.uBloomStrength.value = 0.0;
      comp.uTime.value = time;
      this._applyEvents(comp, events);
      this.quad.material = this.compMat;
      r.render(this.qScene, this.qCam);
      return;
    }

    // ---------- 2. 预过滤 → mip0 ----------
    const m0 = this.mips[0];
    this.preMat.uniforms.uScene.value = src.texture;
    this.preMat.uniforms.uTexel.value.copy(this.texel);
    this.quad.material = this.preMat;
    r.setRenderTarget(m0.rt);
    r.render(this.qScene, this.qCam);

    const levels = Math.min(this.mipCount, this.mips.length);

    // ---------- 3. 逐级降采样（13-tap）----------
    for (let i = 1; i < levels; i++) {
      const dst = this.mips[i], s = this.mips[i - 1];
      this.downMat.uniforms.uSrc.value = s.rt.texture;
      this.downMat.uniforms.uTexel.value.set(1 / s.w, 1 / s.h);
      this.quad.material = this.downMat;
      r.setRenderTarget(dst.rt);
      r.render(this.qScene, this.qCam);
    }

    // ---------- 4. 逐级上采样加性叠加（9-tap 帐篷）----------
    r.autoClear = false;
    for (let i = levels - 2; i >= 0; i--) {
      const dst = this.mips[i], s = this.mips[i + 1];
      this.upMat.uniforms.uSrc.value = s.rt.texture;
      this.upMat.uniforms.uPrev.value = dst.rt.texture;
      this.upMat.uniforms.uTexel.value.set(1 / s.w, 1 / s.h);
      this.upMat.uniforms.uScale.value = 0.82;
      this.quad.material = this.upMat;
      r.setRenderTarget(dst.rt);
      r.render(this.qScene, this.qCam);
    }
    r.autoClear = true;

    // ---------- 5. 合成到屏幕 ----------
    r.setRenderTarget(null);
    comp.uScene.value = src.texture;
    comp.uBloom.value = this.mips[0].rt.texture;
    comp.uBloomStrength.value = this._bloomStrength;
    comp.uTime.value = time;
    this._applyEvents(comp, events);
    this.quad.material = this.compMat;
    r.render(this.qScene, this.qCam);
  };

  PostFX.prototype._applyEvents = function (comp, ev) {
    ev = ev || {};
    comp.uBloomStrength.value = this._bloomStrength || 0;
    comp.uDamage.value = N.damp(comp.uDamage.value, ev.damage || 0, 9, 1 / 60);
    comp.uLevelUp.value = ev.levelUp || 0;
    comp.uDeath.value = ev.death || 0;
    comp.uGameOver.value = ev.gameOver || 0;
    comp.uGrain.value = this.grainOn ? 1 : 0;
    comp.uVignette.value = ev.vignette !== undefined ? ev.vignette : 0.62;
    comp.uAberration.value = ev.aberration !== undefined ? ev.aberration : 1.0;
    comp.uExposure.value = ev.exposure !== undefined ? ev.exposure : 1.06;
  };

  PostFX.prototype.setBloom = function (v) {
    this._bloomStrength = v;
  };
  PostFX.prototype.setLevels = function (n) {
    this.mipCount = N.clamp(n | 0, 1, this.mips.length);
  };
  PostFX.prototype.dispose = function () {
    if (this.rtScene) this.rtScene.dispose();
    for (const m of this.mips) m.rt.dispose();
    this.preMat.dispose(); this.downMat.dispose(); this.upMat.dispose(); this.compMat.dispose();
  };

  /* ====================================================================== */
  /* 四、粒子系统（单 draw call，CPU 侧对象池）                              */
  /* ====================================================================== */
  const PART_VS = `
    attribute float aSize;
    attribute float aAlpha;
    attribute vec3  aColor;
    varying vec3 vCol;
    varying float vAlpha;
    uniform float uScale;
    uniform float uPixelRatio;
    void main(){
      vCol = aColor;
      vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uScale * uPixelRatio / max(0.15, -mv.z);
      gl_PointSize = clamp(gl_PointSize, 0.6, 210.0);
    }
  `;
  const PART_FS = `
    precision highp float;
    varying vec3 vCol;
    varying float vAlpha;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float d = dot(c, c) * 4.0;
      if(d > 1.0) discard;
      float core = pow(1.0 - d, 3.2);
      float halo = pow(1.0 - d, 1.05) * 0.32;
      float a = (core + halo) * vAlpha;
      if(a < 0.004) discard;
      gl_FragColor = vec4(vCol * (0.62 + core * 1.35), a);
    }
  `;

  function ParticleSystem(capacity) {
    this.cap = capacity;
    this.count = 0;

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      vertexShader: PART_VS, fragmentShader: PART_FS,
      uniforms: {
        uScale: { value: 620 },
        uPixelRatio: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.geo = g;
    this.mat = mat;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 40;
  }

  ParticleSystem.prototype.emit = function (o) {
    if (this.count >= this.cap) return -1;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx; this.vel[i3 + 1] = o.vy; this.vel[i3 + 2] = o.vz;
    this.col[i3] = o.r; this.col[i3 + 1] = o.g; this.col[i3 + 2] = o.b;
    this.size[i] = o.size;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.alpha[i] = o.alpha === undefined ? 1 : o.alpha;
    this.baseAlpha[i] = this.alpha[i];
    this.drag[i] = o.drag === undefined ? 1.8 : o.drag;
    this.grav[i] = o.grav === undefined ? 0 : o.grav;
    this.spin[i] = 0;
    this.grow[i] = o.grow === undefined ? -0.6 : o.grow;
    return i;
  };

  ParticleSystem.prototype.update = function (dt) {
    const cap = this.cap;
    const pos = this.pos, vel = this.vel, life = this.life, size = this.size, alpha = this.alpha;
    const drag = this.drag, grav = this.grav, grow = this.grow, maxLife = this.maxLife, baseAlpha = this.baseAlpha;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        // 与末尾交换，O(1) 回收
        const j = n - 1;
        if (i !== j) {
          const i3 = i * 3, j3 = j * 3;
          pos[i3] = pos[j3]; pos[i3 + 1] = pos[j3 + 1]; pos[i3 + 2] = pos[j3 + 2];
          vel[i3] = vel[j3]; vel[i3 + 1] = vel[j3 + 1]; vel[i3 + 2] = vel[j3 + 2];
          this.col[i3] = this.col[j3]; this.col[i3 + 1] = this.col[j3 + 1]; this.col[i3 + 2] = this.col[j3 + 2];
          size[i] = size[j]; alpha[i] = alpha[j]; life[i] = life[j];
          maxLife[i] = maxLife[j]; drag[i] = drag[j]; grav[i] = grav[j];
          grow[i] = grow[j]; baseAlpha[i] = baseAlpha[j];
        }
        n--; i--;
        continue;
      }
      const i3 = i * 3;
      const k = Math.exp(-drag[i] * dt);
      vel[i3] *= k; vel[i3 + 1] = vel[i3 + 1] * k + grav[i] * dt; vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = life[i] / maxLife[i];
      alpha[i] = baseAlpha[i] * (t < 0.25 ? t / 0.25 : Math.min(1, (1 - t) / 0.12 + 0.0) * 0.0 + Math.pow(t, 0.62));
      size[i] = Math.max(0.15, size[i] * (1 + grow[i] * dt));
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    if (n > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
  };

  ParticleSystem.prototype.clear = function () {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  };

  /* ====================================================================== */
  /* 五、冲击波（地面扩散环）                                                */
  /* ====================================================================== */
  const RING_VS = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `;
  const RING_FS = `
    precision highp float;
    varying vec2 vUv;
    uniform vec3  uColor;
    uniform float uProgress;
    uniform float uOpacity;
    uniform float uThickness;
    uniform float uTime;
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c) * 2.0;
      float ring = smoothstep(uThickness + 0.06, 0.0, abs(r - uProgress));
      float inner = smoothstep(uProgress, uProgress * 0.55, r) * 0.22;
      float edge = smoothstep(1.02, 0.94, r);
      float a = (ring + inner) * uOpacity * edge;
      if(a < 0.004) discard;
      gl_FragColor = vec4(uColor * (1.25 + ring * 1.4), a);
    }
  `;

  function ShockRings(max, quality) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    this.geo = geo;
    this.group = new THREE.Group();
    for (let i = 0; i < max; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: RING_VS, fragmentShader: RING_FS,
        uniforms: {
          uColor: { value: new THREE.Color(1, 1, 1) },
          uProgress: { value: 0 }, uOpacity: { value: 0 },
          uThickness: { value: 0.16 }, uTime: { value: 0 },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 30;
      this.group.add(m);
      this.items.push({ mesh: m, mat, t: 0, life: 0, size: 1, active: false });
    }
  }
  ShockRings.prototype.spawn = function (x, y, z, color, size, life, thickness) {
    for (const it of this.items) {
      if (it.active) continue;
      it.active = true;
      it.t = 0; it.life = life || 0.7; it.size = size || 6;
      it.mesh.visible = true;
      it.mesh.position.set(x, y, z);
      it.mesh.scale.set(it.size, it.size, 1);
      it.mat.uniforms.uColor.value.copy(color);
      it.mat.uniforms.uOpacity.value = 0.9;
      it.mat.uniforms.uThickness.value = thickness === undefined ? 0.15 : thickness;
      return it;
    }
    return null;
  };
  ShockRings.prototype.update = function (dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const p = it.t / it.life;
      if (p >= 1) { it.active = false; it.mesh.visible = false; continue; }
      const e = N.easeOutQuart(p);
      it.mat.uniforms.uProgress.value = e;
      it.mat.uniforms.uOpacity.value = Math.pow(1 - p, 1.7) * 0.92;
      it.mesh.scale.setScalar(it.size * (0.12 + e * 1.0));
    }
  };

  /* ====================================================================== */
  /* 六、地面网格                                                            */
  /* ====================================================================== */
  const GRID_VS = `
    varying vec2 vWorld;
    varying vec3 vPos;
    void main(){
      vPos = position;
      vWorld = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const GRID_FS = `
    precision highp float;
    varying vec2 vWorld;
    uniform float uCell;
    uniform float uTime;
    uniform float uRadius;
    uniform float uPulse;
    uniform vec3  uColorA;
    uniform vec3  uColorB;
    uniform vec3  uFocus;
    uniform float uFocusAmt;

    float gridLine(vec2 p, float period, float width){
      vec2 q = p / period;
      vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
      float l = min(g.x, g.y);
      return 1.0 - min(l / width, 1.0);
    }

    void main(){
      vec2 p = vWorld;
      float minor = gridLine(p, uCell * 4.0, 1.5) * 0.30;
      float major = gridLine(p, uCell, 1.0) * 0.75;

      float r = length(p);
      float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, r);

      vec3 col = uColorA * minor + uColorB * major;

      // 焦点光晕（蛇头附近的地面泛光）
      float d = length(p - uFocus.xz);
      float halo = exp(-d * d * 0.0075) * 0.9 * uFocusAmt;
      col += uColorA * halo;

      // 呼吸脉冲：从中心向外扩散的环
      float wave = sin(r * 0.42 - uTime * 1.35) * 0.5 + 0.5;
      col *= 0.78 + 0.34 * wave * (1.0 - uFocusAmt * 0.4);

      float a = (minor + major + halo + 0.012) * fade;
      a += uPulse * fade * 0.10;
      gl_FragColor = vec4(col, a);
    }
  `;

  function buildGrid(cell, radius, colorA, colorB) {
    const geo = new THREE.PlaneGeometry(radius * 2.4, radius * 2.4, 1, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: GRID_VS, fragmentShader: GRID_FS,
      uniforms: {
        uCell: { value: cell },
        uTime: { value: 0 },
        uRadius: { value: radius },
        uPulse: { value: 0 },
        uColorA: { value: new THREE.Color(colorA || 0x1b2a6e) },
        uColorB: { value: new THREE.Color(colorB || 0x5f4dff) },
        uFocus: { value: new THREE.Vector3() },
        uFocusAmt: { value: 1 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.001;
    m.renderOrder = 5;
    m.frustumCulled = false;
    return m;
  }

  /* ====================================================================== */
  /* 导出                                                                    */
  /* ====================================================================== */
  S.buildEnvironment = buildEnvironment;
  S.buildGalaxy = buildGalaxy;
  S.PostFX = PostFX;
  S.ParticleSystem = ParticleSystem;
  S.ShockRings = ShockRings;
  S.buildGrid = buildGrid;
  S.makeRT = makeRT;
  S.fbm = fbm;

  global.SC = S;
})(window);
