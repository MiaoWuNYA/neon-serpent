/* ============================================================================
 * NEON SERPENT · 程序化音频引擎
 * 零素材：全部音效由 WebAudio 振荡器 / 噪声 / 滤波器实时合成
 * 含：环境铺底 Drone、自适应 BPM 节拍、音阶上行连击、冲击音、UI 音
 * ==========================================================================*/
(function (global) {
  "use strict";
  const N = global.N;

  const A = {};

  // 五声音阶（宫商角徵羽）+ 八度展开，保证连击音永远和谐
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
  const NOTE = (semi) => 110 * Math.pow(2, semi / 12);

  let ctx = null;
  let master = null;
  let musicBus = null, sfxBus = null;
  let comp = null;
  let unlocked = false;
  let noiseBuf = null;

  const S = {
    enabled: true,
    music: true,
    volume: 0.85,
    bpm: 96,
    combo: 0,
    level: 1,
    playing: false,
  };

  /* ------------------------------------------------------------------ */
  /* 初始化                                                              */
  /* ------------------------------------------------------------------ */
  function init() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { S.enabled = false; return null; }
    try { ctx = new AC({ latencyHint: "interactive" }); } catch (e) { ctx = new AC(); }

    master = ctx.createGain();
    master.gain.value = 0;

    // 总线压缩器：多音叠加不爆音，保持"大场面"响度
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 26;
    comp.ratio.value = 4.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    // 轻微立体展宽
    const widen = ctx.createGain();
    widen.gain.value = 1.0;

    master.connect(comp);
    comp.connect(widen);
    widen.connect(ctx.destination);

    musicBus = ctx.createGain(); musicBus.gain.value = 0.42;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.72;
    musicBus.connect(master);
    sfxBus.connect(master);

    // 预生成白噪声缓冲（2s 单声道）
    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    buildDrone();
    buildScheduler();
    return ctx;
  }

  /* ------------------------------------------------------------------ */
  /* 环境铺底：4 层失谐锯齿 + 低通 + 慢 LFO + 空灵钟声                    */
  /* ------------------------------------------------------------------ */
  let droneGain, droneFilter, droneLfo, droneVoices = [];
  function buildDrone() {
    droneGain = ctx.createGain();
    droneGain.gain.value = 0.0;
    droneGain.connect(musicBus);

    droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 320;
    droneFilter.Q.value = 3.2;
    droneFilter.connect(droneGain);

    // 慢速 LFO 扫滤波，制造呼吸感
    droneLfo = ctx.createOscillator();
    droneLfo.frequency.value = 0.045;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 210;
    droneLfo.connect(lfoAmt);
    lfoAmt.connect(droneFilter.frequency);
    droneLfo.start();

    const roots = [55, 55.4, 82.5, 110.2];
    const amps = [0.34, 0.26, 0.14, 0.09];
    for (let i = 0; i < roots.length; i++) {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "triangle" : "sawtooth";
      o.frequency.value = roots[i];
      const g = ctx.createGain();
      g.gain.value = amps[i];
      o.connect(g); g.connect(droneFilter);
      o.start();
      droneVoices.push(o);
    }

    // 泛音粉尘：极轻的高频正弦，随时间漂移
    const air = ctx.createOscillator();
    air.type = "sine";
    air.frequency.value = 1320;
    const airG = ctx.createGain();
    airG.gain.value = 0.012;
    const airLfo = ctx.createOscillator();
    airLfo.frequency.value = 0.11;
    const airLfoAmt = ctx.createGain();
    airLfoAmt.gain.value = 0.009;
    airLfo.connect(airLfoAmt); airLfoAmt.connect(airG.gain);
    airLfo.start();
    air.connect(airG); airG.connect(musicBus);
    air.start();
  }

  /* ------------------------------------------------------------------ */
  /* 节拍调度器：16 分音符栅格，look-ahead 25ms/100ms                    */
  /* ------------------------------------------------------------------ */
  const sched = { next: 0, step: 0, timer: 0, running: false };
  function buildScheduler() {
    sched.next = ctx.currentTime;
  }

  function kick(t, level) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + 0.34);
  }

  function hat(t, level, open) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 1.8;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 7200;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 11000; bp.Q.value = 0.9;
    const g = ctx.createGain();
    const dur = open ? 0.16 : 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20 * level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  function bass(t, semi, dur, level) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = NOTE(semi);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(1100, t + 0.06);
    f.frequency.exponentialRampToValueAtTime(210, t + dur);
    f.Q.value = 7.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.30 * level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function pluck(t, semi, dur, level) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = NOTE(semi + 24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13 * level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const dl = ctx.createDelay(0.6);
    dl.delayTime.value = 60 / S.bpm / 2;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    dl.connect(fb); fb.connect(dl);
    const wet = ctx.createGain(); wet.gain.value = 0.36;
    o.connect(g); g.connect(musicBus); g.connect(dl); dl.connect(wet); wet.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // 低音走向：随等级上升，营造压迫 → 高潮
  const PROG = [
    [0, 0, 5, 3], [0, 7, 5, 3], [0, 0, -2, 3], [0, 7, 10, 5],
  ];

  function schedulerTick() {
    if (!ctx || !S.playing || !S.music || !S.enabled) return;
    const spb = 60 / S.bpm / 4; // 16 分音符
    const now = ctx.currentTime;
    // 提前 0.12s 排布，避免移动端主线程抖动导致掉拍
    while (sched.next < now + 0.12) {
      const t = sched.next;
      const s = sched.step % 16;
      const lv = N.clamp(0.55 + S.level * 0.06, 0.55, 1.0);
      const prog = PROG[(Math.floor(sched.step / 16) % PROG.length)];

      if (s === 0 || s === 10) kick(t, lv);
      if (s % 4 === 2) hat(t, lv * 0.85, false);
      if (s === 7 || s === 15) hat(t, lv, true);
      if (s === 0) bass(t, prog[0], spb * 6, lv);
      if (s === 3) bass(t, prog[1], spb * 2.4, lv * 0.8);
      if (s === 6) bass(t, prog[2], spb * 3.2, lv * 0.85);
      if (s === 11) bass(t, prog[3], spb * 3.6, lv * 0.9);
      if (S.level >= 3 && (s === 5 || s === 13)) pluck(t, PENTA[(sched.step * 3) % PENTA.length], spb * 2.2, lv * 0.7);

      sched.next += spb;
      sched.step++;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 对外控制                                                            */
  /* ------------------------------------------------------------------ */
  function unlock() {
    if (!ctx) init();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (!unlocked) {
      unlocked = true;
      // 淡入主输出
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.0001, t);
      master.gain.linearRampToValueAtTime(S.volume * 0.9, t + 0.6);
      if (droneGain) {
        droneGain.gain.cancelScheduledValues(t);
        droneGain.gain.setValueAtTime(0.0001, t);
        droneGain.gain.linearRampToValueAtTime(S.music ? 0.5 : 0.0, t + 2.4);
      }
    }
    if (!sched.running) {
      sched.running = true;
      sched.next = Math.max(sched.next, ctx.currentTime + 0.05);
      sched.timer = setInterval(schedulerTick, 25);
    }
  }

  function setVolume(v) {
    S.volume = N.clamp01(v);
    if (ctx && unlocked) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(S.volume * 0.9, ctx.currentTime + 0.08);
    }
  }

  function setMusic(on) {
    S.music = !!on;
    if (ctx && unlocked && droneGain) {
      droneGain.gain.cancelScheduledValues(ctx.currentTime);
      droneGain.gain.linearRampToValueAtTime(on ? 0.5 : 0.0, ctx.currentTime + 1.1);
    }
    if (on) unlock();
  }

  /* ---------------------------- 单发音效 ---------------------------- */
  // 拾取：音阶上行 + 亮铃，连击越高音越高
  function pickup(combo) {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime;
    const semi = PENTA[Math.min(combo, PENTA.length - 1)];
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o.type = "sine"; o2.type = "triangle";
    o.frequency.value = NOTE(semi + 36);
    o2.frequency.value = NOTE(semi + 48);
    const g = ctx.createGain(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.10, t + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); o2.connect(g2); g.connect(sfxBus); g2.connect(sfxBus);
    // 短混响尾
    const dl = ctx.createDelay(0.5);
    dl.delayTime.value = 0.115;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const wet = ctx.createGain(); wet.gain.value = 0.30;
    g.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(sfxBus);
    o.start(t); o.stop(t + 0.46);
    o2.start(t); o2.stop(t + 0.34);
    // 高频闪片
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 9000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.10, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(hp); hp.connect(ng); ng.connect(sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.14);
  }

  // 转向：极短的气流声，随速度变亮
  function turn(rate) {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 1.0;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.07);
    bp.Q.value = 4.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055 * N.clamp(rate, 0.4, 1.4), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    src.connect(bp); bp.connect(g); g.connect(sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.12);
  }

  // 死亡：下坠扫频 + 低频轰击
  function death() {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(680, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 1.25);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(150, t + 1.25);
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(f); f.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + 1.45);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(90, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.7, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    sub.connect(sg); sg.connect(sfxBus);
    sub.start(t); sub.stop(t + 0.95);

    // 玻璃碎裂质感
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.7;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.30, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(hp); hp.connect(ng); ng.connect(sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.75);
  }

  // 等级提升：上行琶音 + 白噪冲击（"降临"感）
  function levelUp() {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime;
    const steps = [0, 4, 7, 12, 16, 19, 24, 28];
    for (let i = 0; i < steps.length; i++) {
      const st = t + i * 0.055;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = NOTE(steps[i] + 24);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.16, st + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.36);
      o.connect(g); g.connect(sfxBus);
      o.start(st); o.stop(st + 0.4);
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 1.4;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.30, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    src.connect(bp); bp.connect(ng); ng.connect(sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.85);
  }

  // 得分里程碑 / 近失（贴脸擦过）
  function nearMiss() {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(180, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + 0.18);
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    src.connect(bp); bp.connect(g); g.connect(sfxBus);
    src.start(t, Math.random()); src.stop(t + 0.3);
  }

  // UI：悬停/点击
  function ui(kind) {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    const base = kind === "confirm" ? 880 : kind === "back" ? 320 : 620;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(kind === "confirm" ? 1320 : base * 0.86, t + 0.10);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + 0.16);
  }

  // 连击断链
  function comboBreak() {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const st = t + i * 0.06;
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = 220 / (i + 1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.09, st + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.12);
      o.connect(g); g.connect(sfxBus);
      o.start(st); o.stop(st + 0.14);
    }
  }

  /* ------------------------------------------------------------------ */
  A.init = init;
  A.unlock = unlock;
  A.setVolume = setVolume;
  A.setMusic = setMusic;
  A.setEnabled = function (on) { S.enabled = !!on; if (on) unlock(); };
  A.isEnabled = () => S.enabled;
  A.setPlaying = function (on) {
    S.playing = !!on;
    if (on) { sched.next = Math.max(sched.next, (ctx ? ctx.currentTime : 0) + 0.06); }
  };
  A.setLevel = function (lv) { S.level = N.clamp(lv, 1, 12); S.bpm = N.clamp(92 + (lv - 1) * 7, 92, 178); };
  A.setCombo = function (c) { S.combo = c; };
  A.pickup = pickup;
  A.turn = turn;
  A.death = death;
  A.levelUp = levelUp;
  A.nearMiss = nearMiss;
  A.ui = ui;
  A.comboBreak = comboBreak;
  A.state = S;
  A.ctx = () => ctx;

  global.A = A;
})(window);
