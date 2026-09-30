/* ============================================================================
 * NEON SERPENT · 玩法与蛇体
 * - 逻辑层：网格 + 步进队列 + 输入缓冲（不会被吞指令）
 * - 表现层：Catmull-Rom 管状体沿队列插值推进，头尾极细、中段饱满
 * - 蛇身分段色相环流 + 能量脉冲波 + 拾取倍率光环
 * ==========================================================================*/
(function (global) {
  "use strict";
  const N = global.N;
  const THREE = global.THREE;

  /* ====================================================================== */
  /* 蛇体：TubeGeometry 每帧重建（约 220 段 × 12 边 = 2600 顶点，可控）       */
  /* ====================================================================== */
  const TUBE_FS = `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vViewDir;

    uniform float uTime;
    uniform float uLength;      // 实际占用长度比例
    uniform float uHeadGlow;
    uniform float uEnergy;      // 0~1 高能状态
    uniform float uFlash;       // 受击闪白
    uniform vec3  uHeadColor;
    uniform vec3  uCoreColor;

    vec3 hue(float h){
      // 廉价 HSL->RGB，h 在 [0,1)
      vec3 k = mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0);
      return clamp(min(k, 4.0 - k), 0.0, 1.0);
    }

    void main(){
      float t = vUv.x;                    // 0 = 尾, 1 = 头
      vec2 fw = fwidth(vUv);
      float aa = max(fw.x, fw.y);

      // ---- 蛇身色相环流：沿长度循环 + 随时间流动 ----
      float hueShift = t * 0.86 + uTime * 0.045 + uEnergy * 0.20;
      vec3 body = mix(uCoreColor, hue(hueShift) * 0.75 + 0.25, 0.85);

      // ---- 能量脉冲：多个波包沿身体向后跑 ----
      float wave = sin((t * 44.0 - uTime * 5.2)) * 0.5 + 0.5;
      float pulse = pow(wave, 3.4) * (0.28 + 0.55 * uEnergy);

      // ---- 头部高亮：前 8% 强烈 ----
      float headMask = smoothstep(0.90, 1.0, t) * uHeadGlow;
      float tailMask = smoothstep(0.10, 0.0, t);

      // ---- 菲涅尔边缘光：勾勒霓虹轮廓 ----
      float fres = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0), 2.4);

      vec3 col = body;
      col += hue(hueShift + 0.06) * pulse * 1.25;
      col += uHeadColor * headMask * 2.2;
      col += vec3(0.62, 0.95, 1.0) * fres * (0.55 + 1.5 * uHeadGlow);
      col += vec3(1.0, 0.96, 0.90) * uFlash * 1.6;

      // ---- 头尾收缩：让管体有"锥形"的实感（配合半径曲线）----
      float edgeFade = smoothstep(0.0, 0.045, t) * smoothstep(0.0, 0.03, 1.0 - t);

      // 高频细节：细密缠丝纹
      float fil = sin(t * 620.0) * 0.5 + 0.5;
      col += body * fil * 0.16;

      float alpha = (0.80 + fres * 0.5 + pulse * 0.4 + headMask * 0.6) * edgeFade;
      alpha *= smoothstep(0.0, 0.02, uLength - t);
      alpha = clamp(alpha, 0.0, 1.0);

      gl_FragColor = vec4(col * (0.85 + pulse * 0.5 + headMask * 1.1), alpha);
    }
  `;

  const TUBE_VS = `
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vViewDir;
    void main(){
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec4 wn = modelMatrix * vec4(normal, 0.0);
      vNormalW = wn.xyz;
      vViewDir = cameraPosition - wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  function Serpent(opts) {
    this.tubeSegments = opts.tubeSegments || 240;
    this.radialSegments = opts.radialSegments || 12;
    this.headRadius = 0.62;
    this.tailRadius = 0.16;

    this.geo = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(0, 0, 0.1), new THREE.Vector3(0, 0, 0.2)]),
      this.tubeSegments,
      this.headRadius,
      this.radialSegments,
      false
    );

    this.mat = new THREE.ShaderMaterial({
      vertexShader: TUBE_VS,
      fragmentShader: TUBE_FS,
      uniforms: {
        uTime: { value: 0 },
        uLength: { value: 1 },
        uHeadGlow: { value: 1 },
        uEnergy: { value: 0 },
        uFlash: { value: 0 },
        uHeadColor: { value: new THREE.Color(0x9ff8ff) },
        uCoreColor: { value: new THREE.Color(0x14e0c8) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;

    // 头部实体（让蛇头有分量，不是纯发光）
    const headGeo = new THREE.SphereGeometry(0.60, 32, 24);
    const headMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a2a3a,
      emissive: 0x18d8e8,
      emissiveIntensity: 1.7,
      metalness: 0.62,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.5,
    });
    this.head = new THREE.Mesh(headGeo, headMat);
    this.head.renderOrder = 24;
    this.headMat = headMat;

    // 头部光环（billboard）
    const haloCanvas = (() => {
      const s = 128;
      const c = document.createElement("canvas"); c.width = c.height = s;
      const g = c.getContext("2d");
      const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      rg.addColorStop(0, "rgba(190,255,255,0.95)");
      rg.addColorStop(0.22, "rgba(80,240,255,0.55)");
      rg.addColorStop(0.55, "rgba(60,140,255,0.16)");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg; g.fillRect(0, 0, s, s);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloCanvas, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true, opacity: 0.9,
    }));
    this.halo.scale.setScalar(4.4);
    this.halo.renderOrder = 25;

    // 轨迹点（渲染世界坐标，供游戏层采样）
    this.points = [];
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this.curve = new THREE.CatmullRomCurve3([], false, "catmullrom", 0.5);
  }

  // pts: THREE.Vector3 数组，索引 0 = 头。visualLength: 实际占用长度比例(0~1，用于尾巴收缩)
  Serpent.prototype.updateGeometry = function (pts, visualLength) {
    const n = pts.length;
    this.ptsRef = pts;
    if (n < 3) {
      this.mesh.visible = false; this.head.visible = false; this.halo.visible = false;
      return;
    }
    this.mesh.visible = true; this.head.visible = true; this.halo.visible = true;

    this.curve.points = pts;
    const old = this.geo;
    this.geo = new THREE.TubeGeometry(this.curve, this.tubeSegments, this.headRadius, this.radialSegments, false);
    this._applyTaper(this.geo, pts);
    this.mesh.geometry = this.geo;
    if (old) old.dispose();

    // 头部实体 + 光环
    const h = pts[0];
    this.head.position.copy(h);
    this.halo.position.copy(h);
    const ahead = pts[1] || pts[2];
    const dir = this._tmpA.copy(h).sub(ahead);
    if (dir.lengthSq() > 1e-8) {
      this.head.lookAt(this._tmpB.copy(h).add(dir));
      this._lastDir = dir.clone().normalize();
    }
    this.tailFade = visualLength === undefined ? 1 : visualLength;
    void this._lastDir;
  };

  // 半径锥形：尾细 → 中段饱满 → 头略膨大。
  // TubeGeometry 顶点按 i = seg*(radialSegments+1) + r 排列，可直接按段索引计算中心线。
  Serpent.prototype._applyTaper = function (geo, pts) {
    const rad = this.radialSegments + 1;
    const posAttr = geo.attributes.position;
    const nrmAttr = geo.attributes.normal;
    const arr = posAttr.array;
    const narr = nrmAttr.array;
    const tube = this.tubeSegments;
    const nPts = pts.length;
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      const seg = (i / rad) | 0;
      const t = seg / tube;                       // 0 = 尾, 1 = 头
      // 半径权重曲线
      const taper = 0.30 + Math.pow(t, 0.60) * 0.70 + Math.pow(t, 6.0) * 0.30;

      // 该段对应的中心线位置（Catmull-Rom 段索引 → 点索引映射近似为线性）
      const fi = t * (nPts - 1);
      const i0 = Math.min(nPts - 1, Math.max(0, Math.floor(fi)));
      const i1 = Math.min(nPts - 1, i0 + 1);
      const fr = fi - i0;
      const a = pts[i0], b = pts[i1];
      const cx = a.x + (b.x - a.x) * fr;
      const cy = a.y + (b.y - a.y) * fr;
      const cz = a.z + (b.z - a.z) * fr;

      const i3 = i * 3;
      arr[i3] = cx + (arr[i3] - cx) * taper;
      arr[i3 + 1] = cy + (arr[i3 + 1] - cy) * taper;
      arr[i3 + 2] = cz + (arr[i3 + 2] - cz) * taper;

      // 法线重算：用原始径向方向（顶点-中心线）归一化即可，近似且稳定
      let dx = arr[i3] - cx, dy = arr[i3 + 1] - cy, dz = arr[i3 + 2] - cz;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      narr[i3] = dx / len; narr[i3 + 1] = dy / len; narr[i3 + 2] = dz / len;
    }
    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
    geo.computeBoundingSphere();
  };

  Serpent.prototype.dispose = function () {
    this.geo.dispose();
    this.mat.dispose();
    this.head.geometry.dispose();
    this.headMat.dispose();
    this.halo.material.map.dispose();
    this.halo.material.dispose();
  };

  /* ====================================================================== */
  /* 食物：能量核心                                                        */
  /* ====================================================================== */
  const CORE_VS = `
    varying vec3 vN; varying vec3 vV; varying vec3 vP;
    uniform float uTime;
    void main(){
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vP = wp.xyz;
      vV = cameraPosition - wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const CORE_FS = `
    precision highp float;
    varying vec3 vN; varying vec3 vV; varying vec3 vP;
    uniform float uTime;
    uniform vec3  uColor;
    uniform float uPulse;
    uniform float uRarity;   // 0 普通 1 稀有

    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x){
      vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
    }

    void main(){
      vec3 n = normalize(vN);
      vec3 v = normalize(vV);
      float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);

      // 内部能量流动（等离子纹）
      float t = uTime * (0.9 + uRarity * 0.7);
      float nz = noise(vP * 2.6 + vec3(0.0, t, t * 0.6));
      float nz2 = noise(vP * 6.2 - vec3(t * 0.8, 0.0, t * 0.4));
      float veins = pow(smoothstep(0.42, 0.92, nz * 0.7 + nz2 * 0.4), 1.6);

      vec3 col = uColor * (0.60 + uPulse * 1.4);
      col += uColor * veins * (1.4 + uRarity * 1.6);
      col += vec3(1.0) * fres * (0.9 + uRarity * 1.4);
      col += vec3(0.85, 0.92, 1.0) * pow(veins, 3.0) * 1.2;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function makeCore(color, rarity, size) {
    const geo = new THREE.IcosahedronGeometry(size || 0.54, rarity > 0.5 ? 5 : 3);
    const mat = new THREE.ShaderMaterial({
      vertexShader: CORE_VS, fragmentShader: CORE_FS,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uPulse: { value: 0 },
        uRarity: { value: rarity || 0 },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 20;

    // 外壳线框（全息感）
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry((size || 0.54) * 1.85, rarity > 0.5 ? 2 : 1),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(0.9),
        wireframe: true, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    shell.renderOrder = 21;

    const g = new THREE.Group();
    g.add(mesh); g.add(shell);

    // 光晕
    const s = 128;
    const c = document.createElement("canvas"); c.width = c.height = s;
    const ctx2 = c.getContext("2d");
    const rg = ctx2.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, "rgba(255,255,255,0.95)");
    rg.addColorStop(0.18, "rgba(255,255,255,0.42)");
    rg.addColorStop(0.5, "rgba(120,180,255,0.12)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx2.fillStyle = rg; ctx2.fillRect(0, 0, s, s);
    const haloTex = new THREE.CanvasTexture(c);
    haloTex.colorSpace = THREE.SRGBColorSpace;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, color: new THREE.Color(color),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
    }));
    halo.scale.setScalar((size || 0.54) * 9);
    g.add(halo);

    return { group: g, mesh, shell, halo, mat, color: new THREE.Color(color), rarity: rarity || 0 };
  }

  /* ====================================================================== */
  /* 游戏逻辑                                                              */
  /* ====================================================================== */
  function Game(cfg) {
    this.grid = cfg.grid || 22;
    this.reset(cfg);
  }

  Game.prototype.reset = function (cfg) {
    cfg = cfg || {};
    const half = (this.grid - 1) / 2;
    this.cell = cfg.cell || 1.7;
    this.snake = [];
    // 蛇身逻辑格坐标（整数），索引 0 = 头
    const sx = 0, sz = 0;
    for (let i = 0; i < 5; i++) this.snake.push({ x: sx - i * 0 + 0, z: sz + i });
    this.dir = { x: 0, z: -1 };
    this.pendingDirs = [];
    this.growQueue = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.level = 1;
    this.eaten = 0;
    this.baseStep = cfg.baseStep || 0.148;   // 每格耗时（秒）
    this.minStep = 0.056;
    this.stepAccum = 0;
    this.alive = true;
    this.started = false;
    this.magnet = 0;
    this.shield = 0;
    this.ghost = 0;
    this.elapsed = 0;
    this.lastStepCount = 0;
    this.pathHistory = [];
    this.foods = [];
    this.particlesBurst = null;
    this.events = [];
    this.half = half;
    this.spawnFood(3);
  };

  Game.prototype.stepDuration = function () {
    // 速度随进度增长：格数 / 分数 / 等级三重驱动，但保留可玩下限
    const progress = N.clamp01(this.eaten / 90);
    const s = N.lerp(this.baseStep, this.minStep, N.easeOutCubic(progress));
    return s;
  };

  Game.prototype.speedRatio = function () {
    // 0~1，供色相/音频/粒子强度使用
    return N.invLerp(this.baseStep, this.minStep, this.stepDuration());
  };

  Game.prototype.spawnFood = function (count) {
    const want = count === undefined ? 1 : count;
    while (this.foods.length < want) {
      const cell = this.freeCell();
      if (!cell) break;
      const rare = Math.random() < 0.10;
      const f = {
        x: cell.x, z: cell.z,
        type: rare ? (Math.random() < 0.62 ? "combo" : "time") : "normal",
        rarity: rare ? 1 : 0,
        born: 0,
        _g: null,
      };
      this.foods.push(f);
    }
  };

  Game.prototype.freeCell = function () {
    const half = this.half;
    let tries = 0;
    while (tries++ < 400) {
      const x = N.randInt(-half, half);
      const z = N.randInt(-half, half);
      let bad = false;
      for (const s of this.snake) if (s.x === x && s.z === z) { bad = true; break; }
      if (!bad) for (const f of this.foods) if (f.x === x && f.z === z) { bad = true; break; }
      if (!bad) return { x, z };
    }
    // 兜底：线性扫描
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        let bad = false;
        for (const s of this.snake) if (s.x === x && s.z === z) { bad = true; break; }
        if (!bad) for (const f of this.foods) if (f.x === x && f.z === z) { bad = true; break; }
        if (!bad) return { x, z };
      }
    }
    return null;
  };

  // 入队方向；同向/反向会被过滤，避免自撞与丢指令
  Game.prototype.input = function (dx, dz) {
    if (!this.alive) return false;
    const last = this.pendingDirs.length
      ? this.pendingDirs[this.pendingDirs.length - 1]
      : this.dir;
    if (last.x === dx && last.z === dz) return false;
    if (last.x === -dx && last.z === -dz) return false;
    if (this.pendingDirs.length >= 2) return false;
    this.pendingDirs.push({ x: dx, z: dz });
    return true;
  };

  Game.prototype.tick = function (dt) {
    if (!this.alive || !this.started) return null;
    this.elapsed += dt;

    // 连击窗口衰减
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.combo > 0) {
        this.combo = 0;
        this.events.push({ type: "comboBreak" });
      }
    }
    if (this.magnet > 0) this.magnet -= dt;
    if (this.shield > 0) this.shield -= dt;
    if (this.ghost > 0) this.ghost -= dt;

    const dur = this.stepDuration();
    this.stepAccum += dt;
    let stepped = false;

    while (this.stepAccum >= dur) {
      this.stepAccum -= dur;
      const ev = this.advance();
      stepped = true;
      if (ev) this.events.push(ev);
      if (!this.alive) break;
    }
    return stepped;
  };

  Game.prototype.advance = function () {
    if (this.pendingDirs.length) this.dir = this.pendingDirs.shift();

    const head = this.snake[0];
    let nx = head.x + this.dir.x;
    let nz = head.z + this.dir.z;

    // 穿墙模式（高等级奖励）——保持关闭，越界即死，规则清晰
    const half = this.half;
    if (nx < -half || nx > half || nz < -half || nz > half) {
      return this.die("wall");
    }
    // 自撞（尾巴即将移开的格子不算）
    const tailIdx = this.snake.length - 1;
    for (let i = 0; i < this.snake.length; i++) {
      if (this.growQueue > 0 && i === tailIdx) continue;
      const s = this.snake[i];
      if (s.x === nx && s.z === nz) {
        if (this.shield > 0) {
          this.shield = 0;
          this.growQueue = Math.max(0, this.growQueue - 1);
          return { type: "shieldBreak", x: nx, z: nz };
        }
        return this.die("self", i);
      }
    }

    this.snake.unshift({ x: nx, z: nz });

    if (this.growQueue > 0) {
      this.growQueue--;
    } else {
      this.snake.pop();
    }

    // 拾取判定
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      if (f.x === nx && f.z === nz) {
        this.foods.splice(i, 1);
        return this.eat(f, nx, nz);
      }
    }
    this.spawnFood(3);
    return null;
  };

  Game.prototype.eat = function (f, x, z) {
    this.combo++;
    this.comboTimer = 2.6;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.eaten++;

    let gain = 10;
    let grow = 2;

    if (f.type === "combo") {
      gain = 30 + this.combo * 8;
      grow = 4;
    } else if (f.type === "time") {
      gain = 20;
      grow = 2;
      this.shield = 9.0;
    } else {
      // 连击倍率：每 5 连 +0.5x，上限 5x
      const mult = 1 + Math.min(4, Math.floor(this.combo / 5) * 0.5);
      gain = Math.round(10 * mult);
      grow = 2;
    }
    gain = Math.round(gain * (1 + this.speedRatio() * 0.6));

    this.score += gain;
    this.growQueue += grow;

    const newLevel = 1 + Math.floor(this.eaten / 8);
    let levelUp = false;
    if (newLevel > this.level) {
      this.level = newLevel;
      levelUp = true;
    }

    this.spawnFood(3);

    return {
      type: levelUp ? "levelup" : "eat",
      x, z, f, gain, levelUp,
      combo: this.combo,
      level: this.level,
    };
  };

  Game.prototype.die = function (reason, idx) {
    this.alive = false;
    return { type: "death", reason: reason, index: idx === undefined ? 0 : idx };
  };

  Game.prototype.headWorld = function (cellSize, out) {
    const h = this.snake[0];
    out = out || new THREE.Vector3();
    out.set(h.x * cellSize, 0, h.z * cellSize);
    return out;
  };

  // 生成插值后的世界坐标点链，索引 0 之外还前置一个"幽灵头"用于曲线外推。
  // alpha = 当前步进进度 0~1。
  // 语义：节点 i 显示在「逻辑格 i」与「逻辑格 i+1」之间；头部额外向目标格推进 alpha，
  //       形成头部先出发、身体依次跟上的波浪式推进（这是"顺滑感"的关键）。
  Game.prototype.buildWorldPoints = function (cellSize, alpha, out) {
    const pts = out || [];
    const n = this.snake.length;
    const total = n + 2;                 // [前置外推头] + n 个节点 + [尾外推]
    while (pts.length < total) pts.push(new THREE.Vector3());
    pts.length = total;

    const T = N.clamp01(alpha);

    // 节点 i 的显示位置
    for (let i = 0; i < n; i++) {
      const a = this.snake[i];
      const b = this.snake[Math.min(i + 1, n - 1)];
      const t = i === 0 ? T : 0;
      pts[i + 1].set(
        (a.x + (b.x - a.x) * t) * cellSize,
        0,
        (a.z + (b.z - a.z) * t) * cellSize
      );
    }

    // 尾端外推：尾部回缩，制造"身体被拉长后回收"的弹性
    const last = pts[n], prev = pts[n - 1];
    const back = (1 - T) * 0.85;
    pts[n + 1].set(
      last.x + (last.x - prev.x) * back,
      0,
      last.z + (last.z - prev.z) * back
    );

    // 头部外推：蛇头走在身体最前面，形成追逐感
    const h0 = pts[1], h1 = pts[2] || h0;
    const lead = 0.52 + T * 0.42;
    pts[0].set(
      h0.x + (h0.x - h1.x) * lead,
      0,
      h0.z + (h0.z - h1.z) * lead
    );

    return pts;
  };

  global.Serpent = Serpent;
  global.makeCore = makeCore;
  global.Game = Game;
})(window);
