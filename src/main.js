/* ============================================================================
 * NEON SERPENT · 主引擎
 * 装配：渲染器 / 场景 / 后处理 / 玩法 / 蛇体 / 粒子 / 相机 / UI / 音频 / 输入
 * ==========================================================================*/
(function (global) {
  "use strict";
  const N = global.N;
  const THREE = global.THREE;

  const CELL = 1.7;
  const GRID = 21;

  const state = {
    mode: "boot",           // boot | menu | play | pause | over
    score: 0, best: 0,
    combo: 0, maxCombo: 0,
    time: 0,
    shake: 0,
    shakeDecay: 6,
    flash: 0,
    deathT: 0,
    levelUpFlash: 0,
    damage: 0,
    camDist: 30,
    camHeight: 29,
    camAim: new THREE.Vector3(),
    camPos: new THREE.Vector3(0, 29, 30),
    camTarget: new THREE.Vector3(),
    orbit: 0,
    orbitSpeed: 0.035,
    parallax: new THREE.Vector2(),
    parallaxSmooth: new THREE.Vector2(),
    timeScale: 1,
    slowmo: 0,
    autoQuality: true,
    frame: 0,
  };

  const cfg = Object.assign({
    quality: 1,
    sound: true,
    music: true,
    lang: "zh",
    touchMode: "swipe",
    volume: 0.85,
  }, N.store.load());

  let renderer, scene, camera, postfx, particles, rings, grid, galaxy, env;
  let serpent, game, ui, foodPool = [];
  let caps = {};
  let fps = new N.FpsMeter(60);
  let lastTime = 0, accum = 0;
  let qualityIdx = cfg.quality;
  let autoDowngradeTimer = 0, autoUpgradeTimer = 0;
  let lowPowerNoticeShown = false;

  const worldPts = [];
  const tmpV = new THREE.Vector3();
  const headWorld = new THREE.Vector3();

  /* ====================================================================== */
  /* 初始化                                                                 */
  /* ====================================================================== */
  function init() {
    const canvas = document.getElementById("gl");
    CAPS();

    const P = (p, t) => { try { if (global.__NEON_PROGRESS) global.__NEON_PROGRESS(p, t); } catch (e) {} };

    // 能力预检：先于 three.js 建上下文，给出可读的失败原因
    P(0.86, "正在检测图形能力…");
    let probeGL = null;
    try {
      probeGL = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: true, stencil: false })
             || canvas.getContext("webgl", { alpha: false, depth: true });
    } catch (e) { probeGL = null; }
    if (!probeGL) {
      throw new Error("此设备/浏览器未启用 WebGL，请更换浏览器或关闭省电模式");
    }
    const isGL2 = typeof WebGL2RenderingContext !== "undefined" && probeGL instanceof WebGL2RenderingContext;
    caps.webgl2 = isGL2;
    if (!isGL2 && !probeGL.getExtension("OES_texture_half_float")) {
      throw new Error("显卡不支持半浮点贴图，无法运行 HDR 渲染");
    }

    P(0.87, "正在创建渲染上下文…");

    const q = N.QUALITY[qualityIdx];
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);

    renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false,
      powerPreference: "high-performance",
      stencil: false, depth: true,
      preserveDrawingBuffer: false,
      context: probeGL,          // 复用已通过预检的上下文，避免重复创建
    });
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;  // 自己走 ACES，不再二次转换
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    renderer.shadowMap.enabled = false;
    renderer.info.autoReset = true;

    caps.maxTexture = renderer.capabilities.maxTextureSize;
    caps.floatLinear = !!(
      renderer.extensions.get("OES_texture_half_float_linear") ||
      renderer.capabilities.isWebGL2
    );

    // 监听上下文丢失（移动端切后台/显存压力很常见），给出可恢复提示
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      if (global.__NEON_FATAL) global.__NEON_FATAL("显卡上下文丢失，请刷新页面");
    }, false);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 6000);
    camera.position.copy(state.camPos);

    // ---- 环境贴图（PBR 反射）----
    P(0.88, "正在卷积环境光照…");
    env = SC.buildEnvironment(renderer);
    scene.environment = env;

    // ---- 天穹 ----
    galaxy = SC.buildGalaxy(q.galaxy);
    scene.add(galaxy);

    // ---- 地面网格 ----
    grid = SC.buildGrid(CELL, GRID * CELL * 0.72);
    scene.add(grid);

    // ---- 蛇 ----
    P(0.91, "正在构建蛇体网格…");
    serpent = new Serpent({
      tubeSegments: q.id === 0 ? 300 : q.id === 1 ? 240 : q.id === 2 ? 180 : 130,
      radialSegments: q.id <= 1 ? 14 : 10,
    });
    scene.add(serpent.mesh);
    scene.add(serpent.head);
    scene.add(serpent.halo);

    // ---- 环境光补光（保证暗部不死黑）----
    const hemi = new THREE.HemisphereLight(0x6f7cff, 0x120030, 0.55);
    scene.add(hemi);
    const key = new THREE.PointLight(0x00ffd5, 55, 90, 2.0);
    key.position.set(0, 16, 0);
    scene.add(key);
    const rim = new THREE.PointLight(0xff3fa0, 34, 110, 2.0);
    rim.position.set(-20, 12, -20);
    scene.add(rim);
    const fill = new THREE.PointLight(0x5f6dff, 30, 110, 2.0);
    fill.position.set(22, 10, 18);
    scene.add(fill);
    state.keyLight = key;

    // ---- 粒子 ----
    const pcap = q.id === 0 ? 9000 : q.id === 1 ? 6000 : q.id === 2 ? 3600 : 1800;
    particles = new SC.ParticleSystem(pcap);
    particles.mat.uniforms.uPixelRatio.value = dpr;
    scene.add(particles.points);

    // ---- 冲击波 ----
    rings = new SC.ShockRings(q.id <= 2 ? 14 : 8);
    scene.add(rings.group);

    // ---- 玩法 ----
    game = new Game({ grid: GRID, cell: CELL, baseStep: 0.150 });

    // ---- 后处理 ----
    P(0.93, "正在装配后处理管线…");
    postfx = new SC.PostFX(renderer, caps);
    postfx.setSize(bufW(), bufH());
    applyQuality(qualityIdx, true);

    // ---- UI ----
    P(0.95, "正在构建界面…");
    ui = buildUI({
      cfg,
      onStart: startRun,
      onResume: resumeRun,
      onMenu: () => gotoMenu(),
      onPause: () => (state.mode === "play" ? pauseRun() : resumeRun()),
      onQuality: (i) => { state.autoQuality = false; applyQuality(i, false); N.store.patch({ quality: i }); },
      onSound: (on) => { cfg.sound = on; A.setEnabled(on); N.store.patch({ sound: on }); },
      onMusic: (on) => { cfg.music = on; A.setMusic(on); N.store.patch({ music: on }); },
      onTouchMode: (m) => { cfg.touchMode = m; N.store.patch({ touchMode: m }); },
      onLang: (l) => N.store.patch({ lang: l }),
      onDir: (dx, dz) => {
        if (state.mode !== "play") return;
        if (game.input(dx, dz)) {
          A.turn(1);
          // 轻微视觉反馈：转向脉冲
          state.turnPulse = 1;
        }
      },
    });

    // ---- 输入 ----
    bindKeyboard();
    bindPointer();
    bindResize();

    // ---- 自适应画质 ----
    if (N.device().lowPower && cfg.quality < 2 && cfg.auto !== false) {
      applyQuality(3, false);
      state.autoQuality = true;
      setTimeout(() => { if (!lowPowerNoticeShown) { lowPowerNoticeShown = true; ui.showBanner(ui.t("lowPower")); } }, 2600);
    }

    A.setVolume(cfg.volume);
    A.setEnabled(cfg.sound !== false);
    A.setMusic(cfg.music !== false);

    // 首屏进度收尾
    // 着色器预热：three.js 惰性编译，若不预热，遮罩淡出后首帧会长时间冻住界面
    // （表现为"卡在正在编译着色器"）。这里在遮罩可见期间把全部程序编译完。
    P(0.97, "正在编译着色器…");
    warmupShaders();

    P(1.0, "就绪");
    document.getElementById("boot").classList.add("hide");
    setTimeout(() => { const b = document.getElementById("boot"); if (b && b.parentNode) b.parentNode.removeChild(b); }, 1000);

    state.mode = "menu";
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  /* 编译并缓存全部渲染程序，避免首帧卡顿。
   * 逐个材质调用 compile()，再跑若干次最小渲染把后处理链路的 program 也建起来。 */
  function warmupShaders() {
    const compiled = new Set();
    const tryCompile = (obj) => {
      if (!obj || compiled.has(obj)) return;
      compiled.add(obj);
      try { renderer.compile(scene, camera); } catch (e) { /* 单个失败不阻塞启动 */ }
    };

    // 1) 主场景所有材质（蛇管体 / 蛇头 / 核心 / 网格 / 天穹 / 粒子 / 冲击环）
    try { renderer.compile(scene, camera); } catch (e) {}

    // 2) 隐藏对象也编译一遍（食物核心初始不可见，首帧才创建 → 否则吃到时卡顿）
    try {
      const probe = makeCore(0x33f0ff, 1, 0.5);
      probe.group.position.set(0, -9999, 0);
      scene.add(probe.group);
      renderer.compile(scene, camera);
      scene.remove(probe.group);
      // 顺带把第一颗核心放进对象池复用，省一次构建
      probe.group.visible = false;
      probe.inUse = false;
      probe.rarity = 1;
      foodPool.push(probe);
    } catch (e) { /* 预热失败不影响运行 */ }

    tryCompile(serpent && serpent.mesh);

    // 3) 后处理链路：用一次真实渲染把每个 pass 的 program 建起来
    try {
      postfx.render(scene, camera, 0, {
        damage: 0, levelUp: 0, death: 0, gameOver: 0,
        vignette: 0.6, aberration: 1.0, exposure: 1.0,
      });
    } catch (e) {}

    // 4) 强制同步，确保 GPU 侧真正完成编译（否则卡顿只是被推迟到下一帧）
    try { renderer.getContext().finish(); } catch (e) {}
  }

  function CAPS() { caps = { webgl2: true, absSupport: true }; }

  function bufW() { return Math.floor(window.innerWidth * renderer.getPixelRatio()); }
  function bufH() { return Math.floor(window.innerHeight * renderer.getPixelRatio()); }

  /* ====================================================================== */
  /* 画质切换                                                               */
  /* ====================================================================== */
  function applyQuality(idx, first) {
    qualityIdx = N.clamp(idx, 0, N.QUALITY.length - 1);
    const q = N.QUALITY[qualityIdx];
    cfg.quality = qualityIdx;

    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    postfx.enabled = true;
    postfx.bloomEnabled = q.bloom > 0;
    postfx.setBloom(q.bloom * 1.35);
    postfx.grainOn = q.grain > 0;
    postfx.setLevels(qualityIdx === 0 ? 7 : qualityIdx === 1 ? 6 : qualityIdx === 2 ? 5 : 4);
    postfx.setSize(bufW(), bufH());

    particles.mat.uniforms.uPixelRatio.value = dpr;
    particles.capEnabled = q.particles;
    galaxy.material.uniforms.uDensity.value = q.galaxy;
    grid.material.uniforms.uRadius.value = GRID * CELL * 0.72;

    if (serpent) {
      serpent.tubeSegments = qualityIdx === 0 ? 300 : qualityIdx === 1 ? 240 : qualityIdx === 2 ? 180 : 130;
    }
    if (ui) ui.renderSegs();
    if (!first && ui) ui.setHud("best", state.best);
    void q.motion;
  }

  /* ====================================================================== */
  /* 流程控制                                                               */
  /* ====================================================================== */
  function startRun() {
    A.unlock();
    game.reset({ grid: GRID, cell: CELL, baseStep: 0.150 });
    game.started = true;
    state.mode = "play";
    state.score = 0; state.combo = 0; state.maxCombo = 0; state.time = 0;
    state.deathT = 0; state.slowmo = 0; state.timeScale = 1;
    state.shake = 0; state.damage = 0; state.levelUpFlash = 0;
    particles.clear();
    clearFoods();
    syncFoods();
    serpent.mat.uniforms.uFlash.value = 0;

    camera.position.set(0, state.camHeight, state.camDist);
    ui.show("play");
    ui.setHud("score", "0");
    ui.setHud("best", state.best);
    ui.setHud("level", "1");
    ui.setHud("len", "5");
    ui.setSpeed(0);
    ui.setDanger(false);
    ui.setTouchVisible(N.device().touch);
    A.setPlaying(true);
    A.setLevel(1);
    if (A.ctx() && A.ctx().state === "suspended") A.ctx().resume().catch(() => {});
  }

  function pauseRun() {
    if (state.mode !== "play") return;
    state.mode = "pause";
    A.setPlaying(false);
    ui.show("pause");
    ui.setTouchVisible(false);
  }

  function resumeRun() {
    if (state.mode !== "pause") return;
    state.mode = "play";
    A.setPlaying(true);
    A.unlock();
    ui.show("play");
    ui.setTouchVisible(N.device().touch);
  }

  function gotoMenu() {
    state.mode = "menu";
    A.setPlaying(false);
    ui.show("menu");
    ui.setTouchVisible(false);
    particles.clear();
    clearFoods();
    // 相机拉远做展示位
    state.camDist = 44; state.camHeight = 34;
  }

  function gameOver() {
    state.mode = "over";
    A.setPlaying(false);
    A.death();
    state.shake = 1.6;
    state.slowmo = 1.0;
    state.deathT = 0;

    const record = state.score > state.best;
    if (record) { state.best = state.score; N.store.patch({ best: state.best }); }

    const secs = Math.floor(state.time);
    const timeStr = secs >= 60
      ? `${Math.floor(secs / 60)}m ${secs % 60}s`
      : `${secs}s`;

    // 蛇体炸裂
    burstSnake(1.0);
    rings.spawn(serpent.head.position.x, 0.05, serpent.head.position.z, new THREE.Color(0xff3f6e), 26, 1.1, 0.10);

    setTimeout(() => {
      if (state.mode !== "over") return;
      ui.setOverStats({
        score: state.score, len: game.snake.length,
        combo: state.maxCombo, time: timeStr, record,
      });
      ui.show("over");
      ui.setTouchVisible(false);
    }, 1150);
  }

  /* ====================================================================== */
  /* 食物对象池                                                             */
  /* ====================================================================== */
  function clearFoods() {
    for (const g of foodPool) g.group.visible = false;
    // 顺便清理 game.foods
    game.foods.forEach((f) => { const o = f._g; if (o) o.group.visible = false; });
    game.foods.length = 0;
  }

  function pickFood(color, rarity) {
    // 简单对象池：复用同稀有度的实例
    for (const o of foodPool) {
      if (!o.inUse && o.rarity === rarity) { o.inUse = true; return o; }
    }
    const size = rarity ? 0.62 : 0.48;
    const o = makeCore(color, rarity, size);
    o.inUse = true;
    o.rarity = rarity;
    scene.add(o.group);
    foodPool.push(o);
    return o;
  }

  const FOOD_COLORS = {
    normal: 0x33f0ff,
    combo: 0xff44c8,
    time: 0xffc63f,
  };

  function syncFoods() {
    const used = new Set();
    for (const f of game.foods) {
      const rarity = f.rarity || 0;
      if (!f._g) {
        f._g = pickFood(FOOD_COLORS[f.type] || FOOD_COLORS.normal, rarity);
        f._g.group.position.set(f.x * CELL, 0.95, f.z * CELL);
        f._g.spawnT = 0;
        // 生成冲击波
        rings.spawn(f.x * CELL, 0.06, f.z * CELL, new THREE.Color(FOOD_COLORS[f.type]), 6, 0.75, 0.16);
      }
      f._g.group.visible = true;
      used.add(f._g);
      const t = f._g.spawnT = (f._g.spawnT || 0) + 1 / 60;
      const s = N.easeOutBack(N.clamp01(t / 0.34));
      f._g.group.scale.setScalar(0.35 + s * 0.65);
    }
    for (const o of foodPool) {
      if (!used.has(o)) { o.inUse = false; o.group.visible = false; }
    }
  }

  /* ====================================================================== */
  /* 粒子上层 API                                                           */
  /* ====================================================================== */
  function emitBurst(x, y, z, color, count, power, spread) {
    const q = N.QUALITY[qualityIdx].particles;
    const n = Math.max(4, Math.round(count * q));
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      // 球面均匀分布 + 少量向外的快速火花
      const u = Math.random() * 2 - 1;
      const th = Math.random() * N.TAU;
      const r = Math.sqrt(1 - u * u);
      const sp = power * (0.35 + Math.random() * 0.95);
      const fast = Math.random() < 0.22;
      particles.emit({
        x: x + (Math.random() - 0.5) * 0.18,
        y: y + (Math.random() - 0.5) * 0.18,
        z: z + (Math.random() - 0.5) * 0.18,
        vx: r * Math.cos(th) * sp * (fast ? 2.3 : 1),
        vy: u * sp * (fast ? 2.3 : 1) + (fast ? 0 : 1.4 * Math.random()),
        vz: r * Math.sin(th) * sp * (fast ? 2.3 : 1),
        r: c.r * (0.8 + Math.random() * 0.7),
        g: c.g * (0.8 + Math.random() * 0.7),
        b: c.b * (0.8 + Math.random() * 0.7),
        size: (spread || 0.16) * (14 + Math.random() * 34) * (fast ? 1.5 : 1),
        life: 0.42 + Math.random() * (fast ? 0.9 : 0.55),
        drag: fast ? 0.9 : 2.3,
        grav: fast ? -5.5 : -2.4,
        grow: fast ? -1.4 : -0.8,
      });
    }
  }

  // 蛇身炸开：沿身体采样点发射粒子
  function burstSnake(power) {
    const pts = worldPts;
    const step = Math.max(1, Math.floor(pts.length / 26));
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const col = N.serpentGradient(1 - i / pts.length);
      emitBurst(p.x, 0.55, p.z, col, 26, 7.5 * power, 0.2);
    }
  }

  /* ====================================================================== */
  /* 相机                                                                   */
  /* ====================================================================== */
  function updateCamera(dt) {
    const playing = state.mode === "play";
    const speedRatio = playing ? game.speedRatio() : 0.2;

    // 基础距离随速度收紧，制造速度感
    const targetDist = playing ? N.lerp(30, 21.5, speedRatio) : state.camDist;
    const targetHeight = playing ? N.lerp(27, 19.5, speedRatio) : state.camHeight;

    state.camDist = N.damp(state.camDist, targetDist, 1.6, dt);
    state.camHeight = N.damp(state.camHeight, targetHeight, 1.6, dt);

    // 跟随头部（平滑），叠加 Idle 时的展示轨道
    if (game.snake.length && playing) {
      const h = headWorld.set(game.snake[0].x * CELL, 0, game.snake[0].z * CELL);
      state.camAim.lerp(tmpV.set(h.x * 0.42, 1.2, h.z * 0.42), 1 - Math.exp(-3.4 * dt));
    } else if (state.mode !== "play") {
      state.orbit += dt * state.orbitSpeed;
      state.camAim.lerp(tmpV.set(0, 1.5, 0), 1 - Math.exp(-1.6 * dt));
    }

    // 视差（鼠标 / 重力感应）
    state.parallaxSmooth.x = N.damp(state.parallaxSmooth.x, state.parallax.x, 2.4, dt);
    state.parallaxSmooth.y = N.damp(state.parallaxSmooth.y, state.parallax.y, 2.4, dt);

    // 呼吸式起伏 + 轨道角度
    const t = state.time;
    const breathe = Math.sin(t * 0.62) * 0.85 + Math.sin(t * 1.31) * 0.32;
    let angle, radius;
    if (playing) {
      angle = 0;
      radius = state.camDist;
    } else {
      angle = state.orbit;
      radius = state.camDist;
    }

    const px = Math.sin(angle) * radius;
    const pz = Math.cos(angle) * radius;
    const py = state.camHeight + breathe;

    state.camPos.x = N.damp(state.camPos.x, state.camAim.x + px + state.parallaxSmooth.x * 6.5, 3.2, dt);
    state.camPos.y = N.damp(state.camPos.y, py + state.parallaxSmooth.y * -3.2, 3.2, dt);
    state.camPos.z = N.damp(state.camPos.z, state.camAim.z + pz, 3.2, dt);

    // 屏幕震动
    let sx = 0, sy = 0, sz = 0;
    if (state.shake > 0.001) {
      state.shake = Math.max(0, state.shake - state.shakeDecay * dt * (0.4 + state.shake));
      const s = state.shake * 0.55;
      const tt = performance.now() * 0.001;
      sx = (Math.sin(tt * 61.3) + Math.sin(tt * 143.7) * 0.5) * s;
      sy = (Math.sin(tt * 79.1) + Math.sin(tt * 191.3) * 0.5) * s;
      sz = Math.sin(tt * 53.7) * s * 0.6;
    }

    camera.position.set(state.camPos.x + sx, Math.max(3.2, state.camPos.y + sy), state.camPos.z + sz);
    camera.lookAt(state.camAim.x + sx * 0.6, state.camAim.y + 1.4 + sy * 0.4, state.camAim.z + sz * 0.6);

    // FOV 随速度轻微拉宽 → 速度感
    const fovTarget = playing ? N.lerp(48, 60, speedRatio) : 50;
    camera.fov = N.damp(camera.fov, fovTarget, 2.2, dt);
    camera.updateProjectionMatrix();
  }

  /* ====================================================================== */
  /* 主循环                                                                 */
  /* ====================================================================== */
  function loop(now) {
    requestAnimationFrame(loop);
    const rawDt = Math.min(0.05, Math.max(0.0005, (now - lastTime) / 1000));
    lastTime = now;
    state.frame++;

    // 慢动作（死亡时）
    if (state.slowmo > 0) {
      state.slowmo = Math.max(0, state.slowmo - rawDt * 0.85);
      state.timeScale = N.lerp(1, 0.16, N.easeOutCubic(state.slowmo));
    } else {
      state.timeScale = N.damp(state.timeScale, 1, 5, rawDt);
    }
    const dt = rawDt * state.timeScale;
    state.time += dt;

    fps.push(rawDt);

    /* --------- 逻辑 --------- */
    if (state.mode === "play") {
      const before = game.snake.length;
      game.tick(dt);
      void before;
      state.time += 0; // 已在上面累加

      // 事件消费
      const evs = game.events;
      for (let i = 0; i < evs.length; i++) handleEvent(evs[i]);
      evs.length = 0;

      if (!game.alive && state.mode === "play") gameOver();

      state.score = game.score;
      state.combo = game.combo;
      if (game.combo > state.maxCombo) state.maxCombo = game.combo;

      ui.setHud("score", state.score.toLocaleString ? state.score.toLocaleString() : state.score);
      ui.setHud("level", game.level);
      ui.setHud("len", game.snake.length);
      ui.setSpeed(game.speedRatio());
      A.setLevel(game.level);
      A.setCombo(game.combo);

      // 危险提示：接近自身
      ui.setDanger(game.combo === 0 && game.snake.length > 24 && playingNearMiss());
    } else if (state.mode === "over" || state.mode === "pause") {
      const evs = game.events; evs.length = 0;
      state.gameOverT = (state.gameOverT || 0) + dt;
    }

    /* --------- 表现 --------- */
    const alpha = state.mode === "play" && game.started
      ? N.clamp01(game.stepAccum / game.stepDuration())
      : 1;
    game.buildWorldPoints(CELL, state.mode === "play" ? alpha : 1, worldPts);

    if (worldPts.length >= 4 && state.mode !== "menu") {
      serpent.updateGeometry(worldPts, 1);
    } else if (state.mode === "menu") {
      // 菜单里让蛇缓慢盘旋做展示
      menuIdleSerpent();
    }

    // 蛇体着色器
    const u = serpent.mat.uniforms;
    u.uTime.value = state.time;
    u.uEnergy.value = game.speedRatio();
    u.uHeadGlow.value = state.mode === "play"
      ? 0.85 + Math.sin(state.time * 6.2) * 0.15
      : 0.7;
    u.uFlash.value = N.damp(u.uFlash.value, 0, 6, rawDt);
    serpent.headMat.emissiveIntensity = 1.4 + game.speedRatio() * 1.6 + Math.sin(state.time * 5.1) * 0.18;
    serpent.halo.material.opacity = 0.72 + Math.sin(state.time * 4.3) * 0.16;

    // 头部拖尾粒子（速度越快越多）
    if (state.mode === "play" && game.alive && qualityIdx <= 3) {
      headWorld.set(worldPts[0] ? worldPts[0].x : 0, 0.5, worldPts[0] ? worldPts[0].z : 0);
      const rate = N.lerp(0.35, 1.0, game.speedRatio());
      const emitN = Math.random() < rate * 0.92 ? 2 : 1;
      const dx = game.dir.x, dz = game.dir.z;
      for (let i = 0; i < emitN; i++) {
        const c = N.serpentGradient(1);
        particles.emit({
          x: headWorld.x - dx * 0.4 + (Math.random() - 0.5) * 0.5,
          y: 0.42 + Math.random() * 0.4,
          z: headWorld.z - dz * 0.4 + (Math.random() - 0.5) * 0.5,
          vx: -dx * 2.6 + (Math.random() - 0.5) * 1.2,
          vy: 0.5 + Math.random() * 0.9,
          vz: -dz * 2.6 + (Math.random() - 0.5) * 1.2,
          r: c.r * 0.55, g: c.g * 0.95, b: c.b * 0.95,
          size: 10 + Math.random() * 16,
          life: 0.32 + Math.random() * 0.3,
          drag: 2.6, grav: 1.2, grow: -0.5,
        });
      }
      // 地面摩擦火花
      if (Math.random() < 0.22) {
        const c = N.serpentGradient(1);
        particles.emit({
          x: headWorld.x, y: 0.06, z: headWorld.z,
          vx: (Math.random() - 0.5) * 3.5, vy: 0.7 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 3.5,
          r: c.r, g: c.g, b: c.b,
          size: 8 + Math.random() * 10, life: 0.28 + Math.random() * 0.22,
          drag: 3.2, grav: -4.5, grow: -1.0,
        });
      }
    }

    particles.update(rawDt);
    rings.update(rawDt);

    // 食物动画
    for (const f of game.foods) {
      if (!f._g || !f._g.group.visible) continue;
      const g = f._g;
      const tt = state.time;
      const pulse = 0.5 + 0.5 * Math.sin(tt * (3.2 + (f.rarity ? 1.6 : 0)) + f.x);
      g.mat.uniforms.uTime.value = tt;
      g.mat.uniforms.uPulse.value = pulse * (f.rarity ? 1.15 : 0.7);
      g.mesh.rotation.y += rawDt * 0.9;
      g.mesh.rotation.x += rawDt * 0.42;
      g.shell.rotation.y -= rawDt * 0.62;
      g.shell.rotation.z += rawDt * 0.31;
      g.shell.material.opacity = 0.24 + pulse * 0.30;
      g.halo.material.opacity = 0.55 + pulse * 0.42;
      g.halo.scale.setScalar((f.rarity ? 0.62 : 0.48) * (8.4 + pulse * 2.4));
      // 漂浮
      g.group.position.y = 0.92 + Math.sin(tt * 2.1 + f.z * 0.7) * 0.16;
    }

    // 网格
    const gu = grid.material.uniforms;
    gu.uTime.value = state.time;
    gu.uFocus.value.copy(worldPts[0] || tmpV);
    gu.uFocusAmt.value = N.damp(gu.uFocusAmt.value, state.mode === "play" ? 1 : 0.35, 3, rawDt);
    gu.uPulse.value = N.damp(gu.uPulse.value, state.combo * 0.08, 4, rawDt);

    // 天穹
    galaxy.material.uniforms.uTime.value = state.time;
    galaxy.position.copy(camera.position);

    // 光源跟随
    if (state.keyLight) {
      state.keyLight.position.set(
        (worldPts[0] ? worldPts[0].x : 0),
        15,
        (worldPts[0] ? worldPts[0].z : 0)
      );
      state.keyLight.intensity = 48 + game.combo * 3.5;
    }

    // 相机
    updateCamera(rawDt);

    /* --------- 事件衰减 --------- */
    state.levelUpFlash = Math.max(0, state.levelUpFlash - rawDt * 2.2);
    state.damage = Math.max(0, state.damage - rawDt * 1.8);

    /* --------- 渲染 --------- */
    const ev = {
      damage: state.damage,
      levelUp: state.levelUpFlash,
      death: state.mode === "over" ? N.clamp01((state.deathT += rawDt) / 1.4) : 0,
      gameOver: state.mode === "over" ? N.clamp01(state.deathT / 1.4) * 0.5 : 0,
      vignette: state.mode === "play" ? 0.58 + game.speedRatio() * 0.16 : 0.66,
      aberration: state.mode === "over" ? 2.6 : 1.0 + game.combo * 0.06,
      exposure: state.mode === "play" ? 1.05 + game.speedRatio() * 0.10 : 1.02,
    };
    postfx.render(scene, camera, state.time, ev);

    /* --------- 自适应画质 --------- */
    autoTune(rawDt);
  }

  /* ====================================================================== */
  /* 事件处理                                                               */
  /* ====================================================================== */
  function handleEvent(ev) {
    if (!ev) return;
    switch (ev.type) {
      case "eat": {
        const f = ev.f;
        const type = f ? f.type : "normal";
        const col = FOOD_COLORS[type] || FOOD_COLORS.normal;
        const rarity = f ? f.rarity : 0;
        const cnt = (type === "combo" ? 68 : 44) * (N.QUALITY[qualityIdx].particles);
        emitBurst(ev.x * CELL, 0.95, ev.z * CELL, col, cnt, 8.2 + (rarity ? 4.5 : 0), rarity ? 0.24 : 0.17);
        rings.spawn(ev.x * CELL, 0.05, ev.z * CELL, new THREE.Color(col), rarity ? 16 : 11, 0.72, rarity ? 0.10 : 0.16);
        state.shake = Math.min(0.85, state.shake + (rarity ? 0.42 : 0.20));
        state.damage = 0;
        A.pickup(game.combo);
        if (navigator.vibrate) { try { navigator.vibrate(rarity ? [18, 26, 18] : 14); } catch (e) {} }

        // 飘分
        const colCss = "#" + new THREE.Color(col).getHexString();
        ui.floatText(ev.x * CELL, 1.6, ev.z * CELL, "+" + ev.gain, camera, colCss);

        // 连击提示
        if (game.combo > 1 && game.combo % 5 === 0) {
          const mult = (1 + Math.min(4, Math.floor(game.combo / 5) * 0.5)).toFixed(1);
          ui.showCombo(`x${game.combo}  ·  ${mult}×`);
        } else if (game.combo > 2) {
          ui.showCombo(`x${game.combo}`);
        }
        break;
      }
      case "levelup": {
        state.levelUpFlash = 1;
        state.shake = Math.min(1.0, state.shake + 0.5);
        ui.showBanner(`${ui.t("level")} ${ev.level}`);
        A.levelUp();
        // 全屏扩散环
        rings.spawn(0, 0.08, 0, new THREE.Color(0x66ffe0), 46, 1.35, 0.06);
        rings.spawn(0, 0.08, 0, new THREE.Color(0xff66c8), 38, 1.05, 0.05);
        emitBurst(serpent.head.position.x, 0.8, serpent.head.position.z, 0x9ff8e6, 90, 11, 0.22);
        if (navigator.vibrate) { try { navigator.vibrate([12, 40, 12, 40, 26]); } catch (e) {} }
        break;
      }
      case "comboBreak": {
        A.comboBreak();
        break;
      }
      case "shieldBreak": {
        state.damage = 0.85;
        state.shake = 1.1;
        emitBurst(ev.x * CELL, 0.8, ev.z * CELL, 0xffc63f, 120, 14, 0.26);
        rings.spawn(ev.x * CELL, 0.05, ev.z * CELL, new THREE.Color(0xffc63f), 22, 1.0, 0.08);
        ui.showCombo(ui.lang() === "zh" ? "护盾破碎" : "SHIELD BREAK");
        if (navigator.vibrate) { try { navigator.vibrate([30, 40, 30]); } catch (e) {} }
        break;
      }
      case "death": {
        serpent.mat.uniforms.uFlash.value = 1;
        break;
      }
    }
  }

  // 头部周围 3 格内有身体 → 危险
  function playingNearMiss() {
    const h = game.snake[0];
    for (let i = 4; i < game.snake.length; i++) {
      const s = game.snake[i];
      const d = Math.abs(s.x - h.x) + Math.abs(s.z - h.z);
      if (d <= 2) return true;
    }
    return false;
  }

  /* ====================================================================== */
  /* 菜单展示蛇                                                             */
  /* ====================================================================== */
  function menuIdleSerpent() {
    const t = state.time;
    const pts = worldPts;
    const need = 48;
    while (pts.length < need) pts.push(new THREE.Vector3());
    pts.length = need;
    // 用一个连续解析曲线（利萨如式螺旋）作为展示蛇
    for (let i = 0; i < need; i++) {
      const u = i / (need - 1);
      const a = t * 0.42 - u * 3.4;
      const r = 6.2 + Math.sin(t * 0.35 + u * 2.4) * 1.5;
      pts[i].set(
        Math.cos(a) * r,
        0,
        Math.sin(a) * r * 0.86
      );
    }
    serpent.updateGeometry(pts, 1);
  }

  /* ====================================================================== */
  /* 自适应画质                                                             */
  /* ====================================================================== */
  function autoTune(dt) {
    if (!state.autoQuality) return;
    const avg = fps.avg;
    if (state.mode !== "play") return;

    if (avg < 46 && qualityIdx < 4) {
      autoDowngradeTimer += dt;
      autoUpgradeTimer = 0;
      if (autoDowngradeTimer > 2.4) {
        autoDowngradeTimer = 0;
        qualityIdx++;
        applyQuality(qualityIdx, false);
        ui.showBanner(N.QUALITY[qualityIdx].name + " " + (ui.lang() === "zh" ? "画质" : "QUALITY"));
        fps.reset();
      }
    } else if (avg > 57 && qualityIdx > 0 && N.QUALITY[qualityIdx].id !== 0) {
      autoUpgradeTimer += dt;
      autoDowngradeTimer = 0;
      if (autoUpgradeTimer > 9) {
        autoUpgradeTimer = 0;
        qualityIdx--;
        applyQuality(qualityIdx, false);
        fps.reset();
      }
    } else {
      autoDowngradeTimer = Math.max(0, autoDowngradeTimer - dt * 0.7);
      autoUpgradeTimer = Math.max(0, autoUpgradeTimer - dt * 0.5);
    }
  }

  /* ====================================================================== */
  /* 输入                                                                   */
  /* ====================================================================== */
  function bindKeyboard() {
    const MAP = {
      ArrowUp: [0, -1], KeyW: [0, -1],
      ArrowDown: [0, 1], KeyS: [0, 1],
      ArrowLeft: [-1, 0], KeyA: [-1, 0],
      ArrowRight: [1, 0], KeyD: [1, 0],
    };
    window.addEventListener("keydown", (e) => {
      if (MAP[e.code]) {
        e.preventDefault();
        if (state.mode === "menu") { startRun(); }
        if (state.mode === "play") {
          const d = MAP[e.code];
          if (game.input(d[0], d[1])) { A.turn(1); state.turnPulse = 1; }
        }
        return;
      }
      if (e.code === "Space" || e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        if (state.mode === "play") pauseRun();
        else if (state.mode === "pause") resumeRun();
        return;
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        if (state.mode === "play" || state.mode === "over" || state.mode === "pause") startRun();
        return;
      }
      if (e.code === "Enter") {
        if (state.mode === "menu") startRun();
        else if (state.mode === "over") startRun();
      }
      if (e.code === "KeyF") N.requestFullscreen();
    }, { passive: false });
  }

  function bindPointer() {
    window.addEventListener("pointermove", (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      state.parallax.x = N.clamp(nx, -1, 1);
      state.parallax.y = N.clamp(ny, -1, 1);
    }, { passive: true });

    // 桌面：点击画布从菜单开局
    window.addEventListener("pointerdown", (e) => {
      if (state.mode === "menu" && e.target && e.target.id === "gl") startRun();
    }, { passive: true });

    // 陀螺仪视差（移动端）
    if (window.DeviceOrientationEvent) {
      const onOrient = (e) => {
        if (e.gamma == null) return;
        state.parallax.x = N.clamp(e.gamma / 34, -1, 1);
        state.parallax.y = N.clamp(((e.beta || 45) - 45) / 34, -1, 1);
      };
      window.addEventListener("deviceorientation", onOrient, { passive: true });
    }
  }

  function bindResize() {
    let rt = 0;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const w = window.innerWidth, h = window.innerHeight;
        camera.aspect = w / h;
        // 竖屏时拉远视角，保证网格完整可见
        const portrait = h > w;
        camera.fov = portrait ? 62 : 50;
        state.baseFov = camera.fov;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        postfx.setSize(bufW(), bufH());
      }, 120);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", () => setTimeout(onResize, 260));
    onResize();
  }

  /* ====================================================================== */
  // 启动收尾：无论成功或失败，都要让用户看到明确结果，绝不停在加载态
  global.__NEON_READY = function () {};

  function boot() {
    // 清除启动兜底计时器
    if (global.__NEON_BOOT_GUARD) { clearTimeout(global.__NEON_BOOT_GUARD); global.__NEON_BOOT_GUARD = null; }
    try {
      init();
      global.__NEON_READY();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      // 优先走引导层提供的统一错误出口
      if (global.__NEON_FATAL) {
        global.__NEON_FATAL("启动失败：" + msg);
      } else {
        const tip = document.getElementById("boottip");
        const b = document.getElementById("boot");
        if (b) b.classList.remove("hide");
        if (tip) { tip.innerHTML = "启动失败：" + msg; tip.style.color = "#ff7c9c"; }
      }
      // 不抛出，避免污染控制台导致看起来像"卡死"
      if (global.console) console.error("[NEON] 初始化失败:", err);
    }
  }

  if (document.readyState === "loading") {
    global.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    // 脚本可能在 DOMContentLoaded 之后才注入（CDN 顺序加载时会发生）
    boot();
  }
})(window);
