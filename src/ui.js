/* ============================================================================
 * NEON SERPENT · UI / HUD / 输入
 * - 双语（默认中文，一键切 EN）
 * - 主菜单 / HUD / 暂停 / 结算 / 设置
 * - 键盘 + 触屏滑动 + 虚拟摇杆 + 全屏 + 震动反馈
 * ==========================================================================*/
(function (global) {
  "use strict";
  const N = global.N;

  const I18N = {
    zh: {
      title: "霓虹蛇域", sub: "NEON SERPENT",
      tagline: "吞噬能量 · 进化形态 · 别撞上自己",
      start: "开始游戏", howto: "操作说明", settings: "设置", back: "返回",
      resume: "继续", restart: "重新开始", menu: "主菜单", quit: "退出到主菜单",
      score: "得分", best: "最高", level: "形态", len: "长度", combo: "连击", speed: "速度",
      paused: "已暂停", gameover: "生命体征消失", newRecord: "新纪录！",
      statScore: "本局得分", statLen: "最终长度", statCombo: "最高连击", statTime: "存活时间",
      quality: "画质", sound: "音效", music: "背景乐", language: "语言",
      touchMode: "触控方式", touchSwipe: "滑动", touchStick: "摇杆",
      fullscreen: "全屏", on: "开", off: "关",
      tipKeys: "方向键 / WASD 转向 · 空格暂停 · R 重开",
      tipTouch: "滑动屏幕转向 · 双击暂停",
      tapToStart: "点击开始", go: "开始",
      hint1: "吃能量核心成长，每 5 连击永久提升得分倍率",
      hint2: "青蓝核心 = 普通 · 品红棱晶 = 连击奖励 · 金色核心 = 护盾 9 秒",
      hint3: "护盾可免疫一次自撞；速度随进食不断提升",
      confirmQuit: "确认退出？当前进度将丢失",
      yes: "确认", no: "取消",
      ready: "准备", lowPower: "已自动降低画质以保证流畅",
    },
    en: {
      title: "NEON SERPENT", sub: "霓虹蛇域",
      tagline: "Devour energy · Evolve · Don't bite yourself",
      start: "START", howto: "HOW TO PLAY", settings: "SETTINGS", back: "BACK",
      resume: "RESUME", restart: "RESTART", menu: "MENU", quit: "QUIT TO MENU",
      score: "SCORE", best: "BEST", level: "FORM", len: "LENGTH", combo: "COMBO", speed: "SPEED",
      paused: "PAUSED", gameover: "VITAL SIGNS LOST", newRecord: "NEW RECORD!",
      statScore: "SCORE", statLen: "FINAL LENGTH", statCombo: "MAX COMBO", statTime: "SURVIVED",
      quality: "QUALITY", sound: "SFX", music: "MUSIC", language: "LANGUAGE",
      touchMode: "TOUCH", touchSwipe: "SWIPE", touchStick: "JOYSTICK",
      fullscreen: "FULLSCREEN", on: "ON", off: "OFF",
      tipKeys: "ARROWS / WASD to turn · SPACE pause · R restart",
      tipTouch: "Swipe to turn · Double-tap to pause",
      tapToStart: "TAP TO START", go: "GO",
      hint1: "Eat cores to grow. Every 5-combo raises the score multiplier.",
      hint2: "Cyan = normal · Magenta prism = combo bonus · Gold = shield for 9s",
      hint3: "Shield absorbs one self-collision. Speed rises with every meal.",
      confirmQuit: "Quit now? Current run will be lost.",
      yes: "YES", no: "CANCEL",
      ready: "READY", lowPower: "Quality auto-lowered to keep it smooth",
    },
  };

  const CSS = `
  :root{
    --c1:#00ffd5; --c2:#7c8cff; --c3:#f472b6; --c4:#ffd36e;
    --ink:#e8ecff; --dim:#8a93c8; --panel:rgba(10,6,32,.62);
    --font:-apple-system,BlinkMacSystemFont,"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",system-ui,"Segoe UI",sans-serif;
    --safe-l:env(safe-area-inset-left,0px); --safe-r:env(safe-area-inset-right,0px);
    --safe-t:env(safe-area-inset-top,0px); --safe-b:env(safe-area-inset-bottom,0px);
  }
  #hud{position:fixed;inset:0;pointer-events:none;font-family:var(--font);color:var(--ink);
       -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
       z-index:10;}
  #hud *{box-sizing:border-box;}
  .layer{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
         opacity:0;visibility:hidden;transition:opacity .34s cubic-bezier(.16,1,.3,1),visibility .34s;}
  .layer.on{opacity:1;visibility:visible;}
  .layer.menu{pointer-events:auto;background:radial-gradient(ellipse at 50% 42%,rgba(28,8,72,.42),rgba(3,0,12,.86) 72%);}
  .layer.play{pointer-events:none;background:transparent;}

  /* ---------------- 标题 ---------------- */
  .brand{text-align:center;transform:translateY(-2vh);}
  .brand h1{margin:0;font-size:clamp(34px,10.5vw,96px);font-weight:900;letter-spacing:.06em;line-height:1;
    background:linear-gradient(96deg,#00ffd5 0%,#7c9dff 34%,#f472b6 64%,#ffd36e 100%);
    -webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 0 34px rgba(0,255,213,.34)) drop-shadow(0 0 90px rgba(124,140,255,.22));}
  .brand .en{margin-top:10px;font-size:clamp(10px,3.2vw,15px);letter-spacing:.62em;color:#93a0e0;font-weight:600;}
  .brand .tl{margin-top:16px;font-size:clamp(11px,3.1vw,14px);color:#6f79b4;letter-spacing:.12em;}

  /* ---------------- 按钮 ---------------- */
  .btns{margin-top:clamp(26px,5vh,52px);display:flex;flex-direction:column;gap:12px;width:min(78vw,320px);}
  .btn{pointer-events:auto;position:relative;border:1px solid rgba(140,160,255,.26);border-radius:14px;
    padding:14px 20px;font-size:clamp(14px,4vw,17px);font-weight:700;letter-spacing:.14em;color:var(--ink);
    background:linear-gradient(180deg,rgba(60,50,140,.30),rgba(20,10,50,.30));
    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    transition:transform .16s cubic-bezier(.16,1,.3,1),border-color .2s,box-shadow .2s,background .2s;
    overflow:hidden;text-align:center;cursor:pointer;}
  .btn::after{content:"";position:absolute;inset:0;border-radius:14px;pointer-events:none;
    background:linear-gradient(120deg,transparent 30%,rgba(255,255,255,.16) 48%,transparent 66%);
    transform:translateX(-120%);transition:transform .55s cubic-bezier(.16,1,.3,1);}
  .btn:hover::after,.btn:active::after{transform:translateX(120%);}
  .btn:hover{border-color:rgba(0,255,213,.6);box-shadow:0 0 0 1px rgba(0,255,213,.16),0 12px 40px -10px rgba(0,255,213,.5);}
  .btn:active{transform:scale(.965);}
  .btn.primary{border-color:rgba(0,255,213,.5);
    background:linear-gradient(180deg,rgba(0,255,213,.20),rgba(0,120,180,.14));
    box-shadow:0 0 46px -12px rgba(0,255,213,.65);}
  .btn.primary .k{color:#bffdf1;}

  /* ---------------- HUD ---------------- */
  .hudbar{position:absolute;top:calc(var(--safe-t) + 12px);left:calc(var(--safe-l) + 14px);
          right:calc(var(--safe-r) + 14px);display:flex;justify-content:space-between;align-items:flex-start;
          gap:10px;pointer-events:none;}
  .card{background:var(--panel);border:1px solid rgba(140,160,255,.20);border-radius:12px;
        padding:8px 12px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}
  .k{font-size:9px;letter-spacing:.24em;color:var(--dim);font-weight:700;}
  .v{font-size:clamp(17px,5.2vw,25px);font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.02em;line-height:1.12;}
  .v.score{background:linear-gradient(90deg,#fff,#9ff8e6);-webkit-background-clip:text;background-clip:text;color:transparent;}
  .stack{display:flex;flex-direction:column;gap:8px;align-items:flex-start;}
  .stack.right{align-items:flex-end;}
  .mini{display:flex;gap:8px;}
  .mini .card{padding:6px 10px;}
  .mini .v{font-size:clamp(13px,3.6vw,16px);}

  /* 速度条 */
  .speedwrap{margin-top:2px;width:110px;height:4px;border-radius:99px;background:rgba(120,140,255,.16);overflow:hidden;}
  .speedwrap i{display:block;height:100%;width:0%;border-radius:99px;
    background:linear-gradient(90deg,#00ffd5,#7c8cff 60%,#f472b6);
    box-shadow:0 0 12px rgba(0,255,213,.7);transition:width .25s ease;}

  /* 连击浮现 */
  .combo{position:absolute;left:50%;top:calc(var(--safe-t) + 15vh);transform:translate(-50%,0) scale(.7);
    font-weight:900;font-size:clamp(30px,10vw,68px);letter-spacing:.02em;opacity:0;
    background:linear-gradient(92deg,#fff,#ffd36e 40%,#f472b6);-webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 0 24px rgba(255,180,90,.7));pointer-events:none;white-space:nowrap;}
  .combo.pop{animation:comboPop .62s cubic-bezier(.16,1,.3,1) forwards;}
  @keyframes comboPop{
    0%{opacity:0;transform:translate(-50%,10px) scale(.55) rotate(-6deg);}
    28%{opacity:1;transform:translate(-50%,0) scale(1.16) rotate(2deg);}
    52%{transform:translate(-50%,0) scale(1.0) rotate(0deg);}
    100%{opacity:0;transform:translate(-50%,-26px) scale(.94);}
  }
  /* 拾取飘分 */
  .float{position:absolute;font-weight:900;font-size:clamp(15px,4.4vw,22px);pointer-events:none;
    color:#eafff8;text-shadow:0 0 18px rgba(0,255,213,.95),0 0 42px rgba(0,255,213,.5);
    animation:floatUp .82s cubic-bezier(.16,1,.3,1) forwards;white-space:nowrap;}
  @keyframes floatUp{
    0%{opacity:0;transform:translate(-50%,0) scale(.6);}
    22%{opacity:1;transform:translate(-50%,-16px) scale(1.14);}
    100%{opacity:0;transform:translate(-50%,-74px) scale(1);}
  }
  /* 升级横幅 */
  .banner{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%) scale(.8);opacity:0;
    font-weight:900;letter-spacing:.30em;font-size:clamp(20px,6.4vw,42px);white-space:nowrap;
    color:#fff;text-shadow:0 0 28px rgba(0,255,213,.95),0 0 70px rgba(124,140,255,.8);pointer-events:none;}
  .banner.go{animation:bannerGo 1.25s cubic-bezier(.16,1,.3,1) forwards;}
  @keyframes bannerGo{
    0%{opacity:0;transform:translate(-50%,-50%) scale(.7);letter-spacing:.9em;}
    22%{opacity:1;transform:translate(-50%,-50%) scale(1.04);letter-spacing:.30em;}
    78%{opacity:1;transform:translate(-50%,-50%) scale(1.0);}
    100%{opacity:0;transform:translate(-50%,-50%) scale(1.06);}
  }
  /* 危险脉冲边框 */
  .danger{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .3s;
    box-shadow:inset 0 0 110px 20px rgba(255,40,90,.42);}
  .danger.on{animation:dangerPulse 1.1s ease-in-out infinite;}
  @keyframes dangerPulse{0%,100%{opacity:.30}50%{opacity:.72}}

  /* 移动端控制 */
  .stick{position:absolute;width:132px;height:132px;border-radius:50%;pointer-events:auto;
    left:calc(var(--safe-l) + 20px);bottom:calc(var(--safe-b) + 24px);
    background:radial-gradient(circle at 50% 50%,rgba(120,140,255,.10),rgba(10,6,32,.30));
    border:1px solid rgba(140,160,255,.24);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    opacity:0;transition:opacity .25s;touch-action:none;}
  .stick.on{opacity:.62;}
  .stick i{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;
    background:radial-gradient(circle at 40% 36%,rgba(0,255,213,.92),rgba(0,140,190,.42));
    box-shadow:0 0 26px rgba(0,255,213,.85);}
  .pausefab{position:absolute;pointer-events:auto;right:calc(var(--safe-r) + 14px);bottom:calc(var(--safe-b) + 26px);
    width:52px;height:52px;border-radius:50%;border:1px solid rgba(140,160,255,.26);
    background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    display:flex;align-items:center;justify-content:center;gap:4px;opacity:0;transition:opacity .25s;}
  .pausefab.on{opacity:.85;}
  .pausefab b{display:block;width:4px;height:16px;border-radius:2px;background:#cfd8ff;}

  /* ---------------- 面板 ---------------- */
  .panel{pointer-events:auto;width:min(90vw,430px);max-height:86vh;overflow-y:auto;
    background:linear-gradient(180deg,rgba(16,10,44,.86),rgba(6,3,22,.90));
    border:1px solid rgba(140,160,255,.24);border-radius:20px;padding:24px 22px;
    backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
    box-shadow:0 30px 90px -20px rgba(0,0,0,.9),0 0 70px -30px rgba(0,255,213,.35);
    transform:translateY(14px) scale(.97);transition:transform .38s cubic-bezier(.16,1,.3,1);}
  .layer.on .panel{transform:translateY(0) scale(1);}
  .panel h2{margin:0 0 4px;font-size:clamp(24px,7vw,34px);font-weight:900;letter-spacing:.06em;
    background:linear-gradient(94deg,#fff,#9ff8e6 50%,#8fb0ff);-webkit-background-clip:text;background-clip:text;color:transparent;}
  .panel .lead{font-size:11px;letter-spacing:.4em;color:var(--dim);margin-bottom:20px;font-weight:700;}
  .row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 0;
    border-bottom:1px solid rgba(140,160,255,.10);}
  .row:last-child{border-bottom:none;}
  .row .lbl{font-size:13px;letter-spacing:.10em;color:#b9c2ee;font-weight:600;}
  .seg{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
  .seg button{pointer-events:auto;border:1px solid rgba(140,160,255,.24);background:rgba(255,255,255,.03);
    color:#aab4e6;border-radius:9px;padding:7px 11px;font-size:12px;font-weight:700;letter-spacing:.06em;
    font-family:var(--font);transition:all .18s;cursor:pointer;}
  .seg button.on{background:linear-gradient(180deg,rgba(0,255,213,.24),rgba(0,140,190,.16));
    border-color:rgba(0,255,213,.72);color:#d8fffa;box-shadow:0 0 20px -6px rgba(0,255,213,.75);}
  .seg button:active{transform:scale(.94);}
  .stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 4px;}
  .stat{background:rgba(120,140,255,.07);border:1px solid rgba(140,160,255,.14);border-radius:13px;padding:13px;}
  .stat .k{margin-bottom:5px;}
  .stat .v{font-size:clamp(19px,5.6vw,26px);}
  .rec{margin:12px 0 2px;text-align:center;font-weight:900;letter-spacing:.22em;font-size:clamp(13px,3.8vw,17px);
    color:#ffe08a;text-shadow:0 0 22px rgba(255,200,90,.85);}
  .tips{margin-top:16px;font-size:12px;line-height:1.9;color:#8b94c8;}
  .tips b{color:#9ff8e6;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px;}
  .grid2 .btn{width:100%;padding:13px 10px;font-size:13px;letter-spacing:.10em;}

  /* 竖屏提示（横屏更好玩，但不强制） */
  .rotate{position:absolute;left:50%;top:14%;transform:translateX(-50%);display:none;
    font-size:11px;letter-spacing:.22em;color:#7a83b8;text-align:center;line-height:1.7;}
  @media (orientation:portrait) and (max-height:520px){ .rotate{display:block;} }

  /* 低矮视口压缩 */
  @media (max-height:430px){
    .brand{transform:translateY(-4vh) scale(.86);}
    .btns{margin-top:14px;gap:8px;}
    .btn{padding:10px 16px;}
  }
  /* 顶部菜单位 */
  .topbar{position:absolute;top:calc(var(--safe-t) + 12px);right:calc(var(--safe-r) + 14px);
    display:flex;gap:8px;pointer-events:auto;}
  .iconbtn{width:40px;height:40px;border-radius:11px;border:1px solid rgba(140,160,255,.22);
    background:var(--panel);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    display:flex;align-items:center;justify-content:center;color:#c3cbff;font-size:15px;cursor:pointer;
    transition:all .18s;}
  .iconbtn:hover{border-color:rgba(0,255,213,.55);color:#9ff8e6;}
  .iconbtn:active{transform:scale(.92);}
  .brandtag{position:absolute;bottom:calc(var(--safe-b) + 12px);left:0;right:0;text-align:center;
    font-size:10px;letter-spacing:.3em;color:#4e5788;pointer-events:none;}
  `;

  /* ====================================================================== */
  function buildUI(opts) {
    const cfg = opts.cfg;
    let lang = cfg.lang || "zh";
    const t = (k) => (I18N[lang][k] !== undefined ? I18N[lang][k] : I18N.zh[k]);

    const style = document.getElementById("uicss");
    if (style) style.textContent = CSS;

    const root = document.getElementById("hud");
    root.innerHTML = "";

    const el = N.el;
    const L = {};

    /* -------------------- 主菜单 -------------------- */
    const menu = el("div", "layer menu on");
    menu.innerHTML = `
      <div class="topbar">
        <div class="iconbtn" data-act="lang" title="Language">文/A</div>
        <div class="iconbtn" data-act="fs" title="Fullscreen">⛶</div>
      </div>
      <div class="brand">
        <h1 data-i18n="title"></h1>
        <div class="en" data-i18n="sub"></div>
        <div class="tl" data-i18n="tagline"></div>
      </div>
      <div class="btns">
        <div class="btn primary" data-act="start" data-i18n="start"></div>
        <div class="btn" data-act="how" data-i18n="howto"></div>
        <div class="btn" data-act="settings" data-i18n="settings"></div>
      </div>
      <div class="rotate">建议横屏游玩 · ROTATE FOR BEST VIEW</div>
      <div class="brandtag">WEBGL2 · PROCEDURAL RENDER · NO ASSETS</div>
    `;
    root.appendChild(menu);

    /* -------------------- 游戏内 HUD -------------------- */
    const play = el("div", "layer play");
    play.innerHTML = `
      <div class="danger"></div>
      <div class="hudbar">
        <div class="stack">
          <div class="card"><div class="k" data-i18n="score"></div><div class="v score" data-hud="score">0</div></div>
          <div class="speedwrap"><i data-hud="speedbar"></i></div>
        </div>
        <div class="stack right">
          <div class="card"><div class="k" data-i18n="best"></div><div class="v" data-hud="best">0</div></div>
          <div class="mini">
            <div class="card"><div class="k" data-i18n="level"></div><div class="v" data-hud="level">1</div></div>
            <div class="card"><div class="k" data-i18n="len"></div><div class="v" data-hud="len">5</div></div>
          </div>
        </div>
      </div>
      <div class="combo" data-hud="combo"></div>
      <div class="banner" data-hud="banner"></div>
      <div class="stick"><i></i></div>
      <div class="pausefab"><b></b><b></b></div>
    `;
    root.appendChild(play);

    const floats = el("div", "layer play on");
    floats.style.mixBlendMode = "screen";
    root.appendChild(floats);

    /* -------------------- 暂停 -------------------- */
    const pause = el("div", "layer menu");
    pause.innerHTML = `
      <div class="panel" style="text-align:center">
        <h2 data-i18n="paused"></h2>
        <div class="lead">PAUSED</div>
        <div class="grid2">
          <div class="btn primary" data-act="resume" data-i18n="resume"></div>
          <div class="btn" data-act="restart" data-i18n="restart"></div>
        </div>
        <div class="grid2" style="grid-template-columns:1fr">
          <div class="btn" data-act="menu" data-i18n="menu"></div>
        </div>
      </div>
    `;
    root.appendChild(pause);

    /* -------------------- 结算 -------------------- */
    const over = el("div", "layer menu");
    over.innerHTML = `
      <div class="panel">
        <h2 data-i18n="gameover"></h2>
        <div class="lead">RUN TERMINATED</div>
        <div class="rec" data-hud="record" style="display:none" data-i18n="newRecord"></div>
        <div class="stats">
          <div class="stat"><div class="k" data-i18n="statScore"></div><div class="v" data-hud="oScore">0</div></div>
          <div class="stat"><div class="k" data-i18n="statLen"></div><div class="v" data-hud="oLen">0</div></div>
          <div class="stat"><div class="k" data-i18n="statCombo"></div><div class="v" data-hud="oCombo">0</div></div>
          <div class="stat"><div class="k" data-i18n="statTime"></div><div class="v" data-hud="oTime">0s</div></div>
        </div>
        <div class="grid2">
          <div class="btn primary" data-act="restart" data-i18n="restart"></div>
          <div class="btn" data-act="menu" data-i18n="menu"></div>
        </div>
      </div>
    `;
    root.appendChild(over);

    /* -------------------- 设置 -------------------- */
    const settings = el("div", "layer menu");
    settings.innerHTML = `
      <div class="panel">
        <h2 data-i18n="settings"></h2>
        <div class="lead">SETTINGS</div>
        <div class="row"><div class="lbl" data-i18n="quality"></div><div class="seg" data-seg="quality"></div></div>
        <div class="row"><div class="lbl" data-i18n="sound"></div><div class="seg" data-seg="sound"></div></div>
        <div class="row"><div class="lbl" data-i18n="music"></div><div class="seg" data-seg="music"></div></div>
        <div class="row" data-row="touch"><div class="lbl" data-i18n="touchMode"></div><div class="seg" data-seg="touch"></div></div>
        <div class="row"><div class="lbl" data-i18n="language"></div><div class="seg" data-seg="lang"></div></div>
        <div class="grid2" style="grid-template-columns:1fr">
          <div class="btn" data-act="back" data-i18n="back"></div>
        </div>
      </div>
    `;
    root.appendChild(settings);

    /* -------------------- 玩法说明 -------------------- */
    const how = el("div", "layer menu");
    how.innerHTML = `
      <div class="panel">
        <h2 data-i18n="howto"></h2>
        <div class="lead">HOW TO PLAY</div>
        <div class="tips">
          <div>① <span data-i18n="hint1"></span></div>
          <div>② <span data-i18n="hint2"></span></div>
          <div>③ <span data-i18n="hint3"></span></div>
        </div>
        <div class="tips" style="margin-top:14px;border-top:1px solid rgba(140,160,255,.12);padding-top:12px">
          <div>⌨ <span data-i18n="tipKeys"></span></div>
          <div>📱 <span data-i18n="tipTouch"></span></div>
        </div>
        <div class="grid2" style="grid-template-columns:1fr">
          <div class="btn" data-act="back" data-i18n="back"></div>
        </div>
      </div>
    `;
    root.appendChild(how);

    /* -------------------- 语言刷新 -------------------- */
    function applyI18n() {
      root.querySelectorAll("[data-i18n]").forEach((n) => {
        const k = n.getAttribute("data-i18n");
        if (I18N[lang][k] !== undefined) n.textContent = I18N[lang][k];
      });
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
      document.title = lang === "zh" ? "NEON SERPENT · 霓虹蛇域" : "NEON SERPENT";
    }

    /* -------------------- 设置项渲染 -------------------- */
    const QUAL_LABEL = () => N.QUALITY.map((q) => (lang === "zh" ? q.name : q.name_en));

    function mkSeg(seg, items, getIdx, onPick) {
      seg.innerHTML = "";
      items.forEach((label, i) => {
        const b = el("button", getIdx() === i ? "on" : "", label);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          onPick(i);
          renderSegs();
          if (global.A) global.A.ui("click");
        });
        seg.appendChild(b);
      });
    }

    function renderSegs() {
      mkSeg(root.querySelector('[data-seg="quality"]'), QUAL_LABEL(),
        () => cfg.quality, (i) => { cfg.quality = i; cfg.auto = false; opts.onQuality && opts.onQuality(i); });

      mkSeg(root.querySelector('[data-seg="sound"]'), [t("on"), t("off")],
        () => (cfg.sound ? 0 : 1), (i) => { cfg.sound = i === 0; opts.onSound && opts.onSound(cfg.sound); });

      mkSeg(root.querySelector('[data-seg="music"]'), [t("on"), t("off")],
        () => (cfg.music ? 0 : 1), (i) => { cfg.music = i === 0; opts.onMusic && opts.onMusic(cfg.music); });

      mkSeg(root.querySelector('[data-seg="touch"]'),
        [t("touchSwipe"), t("touchStick")],
        () => (cfg.touchMode === "swipe" ? 0 : 1),
        (i) => { cfg.touchMode = i === 0 ? "swipe" : "stick"; opts.onTouchMode && opts.onTouchMode(cfg.touchMode); });

      mkSeg(root.querySelector('[data-seg="lang"]'), ["中文", "EN"],
        () => (lang === "zh" ? 0 : 1),
        (i) => { lang = i === 0 ? "zh" : "en"; cfg.lang = lang; applyI18n(); renderSegs(); opts.onLang && opts.onLang(lang); });

      // 触控模式行仅移动端显示
      const row = root.querySelector('[data-row="touch"]');
      if (row) row.style.display = N.device().touch ? "flex" : "none";
    }

    /* -------------------- 层级控制 -------------------- */
    const layers = { menu, play, pause, over, settings, how };
    let current = "menu";
    function show(name) {
      Object.keys(layers).forEach((k) => {
        layers[k].classList.toggle("on", k === name || (k === "play" && (name === "pause" || name === "over")));
        if (k === "play") layers[k].classList.toggle("on", name !== "menu" && name !== "settings" && name !== "how");
      });
      // 结算/暂停时 HUD 仍显示（被面板覆盖），菜单时隐藏
      play.style.opacity = (name === "menu" || name === "settings" || name === "how") ? "0" : "1";
      current = name;
    }

    /* -------------------- 交互事件绑定 -------------------- */
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const act = b.getAttribute("data-act");
      if (global.A) global.A.ui(act === "start" || act === "restart" || act === "resume" ? "confirm" : "hover");
      switch (act) {
        case "start": case "restart": opts.onStart && opts.onStart(); break;
        case "resume": opts.onResume && opts.onResume(); break;
        case "menu": opts.onMenu && opts.onMenu(); break;
        case "settings": settings._from = current; show("settings"); break;
        case "how": how._from = current; show("how"); break;
        case "back": show(settings._from || how._from || "menu"); break;
        case "lang": lang = lang === "zh" ? "en" : "zh"; cfg.lang = lang; applyI18n(); renderSegs(); break;
        case "fs": N.requestFullscreen(); break;
      }
    });

    const fab = play.querySelector(".pausefab");
    fab.addEventListener("click", (e) => { e.stopPropagation(); opts.onPause && opts.onPause(); });

    /* -------------------- 触控输入 -------------------- */
    const stickEl = play.querySelector(".stick");
    const knob = stickEl.querySelector("i");
    const touchState = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0, fired: false, moved: false };
    let lastTap = 0;

    function stickVisible(on) {
      if ("ontouchstart" in window || navigator.maxTouchPoints > 0) stickEl.classList.toggle("on", on);
      fab.classList.toggle("on", on);
    }

    function setKnob(dx, dy) {
      const max = 44;
      const len = Math.hypot(dx, dy);
      const k = len > max ? max / len : 1;
      knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
    }

    let swipeStart = null;

    function onPointerDown(e) {
      if (current !== "play") return;
      // 摇杆区域
      if (cfg.touchMode === "stick" && e.target === stickEl || (cfg.touchMode === "stick" && e.target === knob)) {
        touchState.active = true; touchState.id = e.pointerId;
        const r = stickEl.getBoundingClientRect();
        touchState.ox = r.left + r.width / 2; touchState.oy = r.top + r.height / 2;
        touchState.fired = false;
        stickEl.setPointerCapture && stickEl.setPointerCapture(e.pointerId);
        return;
      }
      // 忽略 UI 上的滑动
      if (e.target.closest(".btn, .iconbtn, .pausefab, .panel")) return;

      const now = performance.now();
      if (now - lastTap < 300) { lastTap = 0; opts.onPause && opts.onPause(); return; }
      lastTap = now;

      swipeStart = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      const rect = touchState;
      void rect;
      // 摇杆模式下，屏幕其它区域也能操作摇杆：把摇杆挪到按下点
      if (cfg.touchMode === "stick") {
        touchState.active = true;
        touchState.id = e.pointerId;
        const r = stickEl.getBoundingClientRect();
        touchState.ox = r.left + r.width / 2; touchState.oy = r.top + r.height / 2;
        touchState.fired = false;
      }
    }

    function onPointerMove(e) {
      if (swipeStart && e.pointerId === swipeStart.id) {
        const dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
        const dist = Math.hypot(dx, dy);
        const threshold = Math.max(16, Math.min(window.innerWidth, window.innerHeight) * 0.045);
        if (dist > threshold) {
          swipeStart.moved = true;
          if (Math.abs(dx) > Math.abs(dy)) opts.onDir && opts.onDir(dx > 0 ? 1 : -1, 0);
          else opts.onDir && opts.onDir(0, dy > 0 ? 1 : -1);
          // 重置起点，支持连续滑动多次转向
          swipeStart.x = e.clientX; swipeStart.y = e.clientY;
          if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) {} }
        }
      }
      if (touchState.active && e.pointerId === touchState.id && cfg.touchMode === "stick") {
        const dx = e.clientX - touchState.ox, dy = e.clientY - touchState.oy;
        setKnob(dx, dy);
        const dist = Math.hypot(dx, dy);
        const dead = 14;
        if (dist > dead) {
          const ang = Math.atan2(dy, dx);
          // 把角度吸附到 4 方向；用象限 + 迟滞避免抖动
          const snapped = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
          const ndx = Math.round(Math.cos(snapped));
          const ndy = Math.round(Math.sin(snapped));
          const key = ndx + "," + ndy;
          if (key !== touchState.lastKey) {
            touchState.lastKey = key;
            opts.onDir && opts.onDir(ndx, ndy);
            if (navigator.vibrate) { try { navigator.vibrate(6); } catch (err) {} }
          }
        }
      }
    }

    function onPointerUp(e) {
      if (swipeStart && e.pointerId === swipeStart.id) swipeStart = null;
      if (touchState.active && e.pointerId === touchState.id) {
        touchState.active = false;
        setKnob(0, 0);
        touchState.lastKey = null;
      }
    }

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });

    // 防止移动端双击缩放 / 长按选择
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => e.preventDefault());
    document.addEventListener("contextmenu", (e) => { if (current === "play") e.preventDefault(); });

    /* -------------------- 对外 API -------------------- */
    const api = {
      show, layers, t: (k) => t(k), lang: () => lang, applyI18n, renderSegs,
      setTouchVisible: stickVisible,
      get uiRoot() { return root; },
      setHud(key, val) {
        const n = root.querySelector(`[data-hud="${key}"]`);
        if (n) n.textContent = val;
      },
      setSpeed(p) {
        const n = root.querySelector('[data-hud="speedbar"]');
        if (n) n.style.width = Math.round(N.clamp01(p) * 100) + "%";
      },
      setDanger(on) {
        const n = play.querySelector(".danger");
        if (n) n.classList.toggle("on", !!on);
      },
      showCombo(text) {
        const n = root.querySelector('[data-hud="combo"]');
        if (!n) return;
        n.textContent = text;
        n.classList.remove("pop");
        void n.offsetWidth;
        n.classList.add("pop");
      },
      showBanner(text) {
        const n = root.querySelector('[data-hud="banner"]');
        if (!n) return;
        n.textContent = text;
        n.classList.remove("go");
        void n.offsetWidth;
        n.classList.add("go");
      },
      // 世界坐标 → 屏幕坐标飘分
      floatText(worldX, worldY, worldZ, text, camera, color) {
        const v = new THREE.Vector3(worldX, worldY, worldZ).project(camera);
        if (v.z > 1) return;
        const x = (v.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
        const d = el("div", "float", text);
        d.style.left = x + "px"; d.style.top = y + "px";
        if (color) { d.style.color = color; d.style.textShadow = `0 0 18px ${color}, 0 0 42px ${color}`; }
        floats.appendChild(d);
        setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 860);
      },
      setOverStats(o) {
        api.setHud("oScore", o.score);
        api.setHud("oLen", o.len);
        api.setHud("oCombo", "x" + o.combo);
        api.setHud("oTime", o.time);
        const rec = root.querySelector('[data-hud="record"]');
        if (rec) rec.style.display = o.record ? "block" : "none";
      },
      refresh() { applyI18n(); renderSegs(); },
    };

    applyI18n();
    renderSegs();
    stickVisible(false);

    return api;
  }

  global.buildUI = buildUI;
  global.I18N = I18N;
})(window);
