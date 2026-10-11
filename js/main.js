/* Tank Lab — boot, input, camera, HUD and the main loop. */
'use strict';
(function () {
  const G = window.G;
  const { clamp } = G;
  const { SIZE } = G.WORLD;
  const $ = (id) => document.getElementById(id);
  const STEP = 1 / 120;
  const SEED = 1996;

  const canvas = $('game');
  const sound = new G.Sound();
  let world, renderer, tank;

  const state = {
    paused: false,
    started: false,
    startTime: 0,
    elapsed: 0,
    finished: false,
    deadZone: true,
    speedZoom: true,
    help: true,
    bigmap: false,
  };
  const cam = { x: 0, y: 0, zoom: 14, base: 14, dpr: 1, shake: 0, shakeX: 0, shakeY: 0 };

  // ---------------------------------------------------------------- input --
  const keys = new Set();
  const mouse = { x: 0, y: 0, active: false, down: false, moved: 0 };
  const touch = { drive: 0, turn: 0, turret: 0, fire: false, brake: false, enabled: false };

  function toggle(code) {
    switch (code) {
      case 'KeyZ':
        state.deadZone = !state.deadZone;
        toast(`Camera dead zone ${state.deadZone ? 'on' : 'off'}`);
        break;
      case 'KeyX':
        state.speedZoom = !state.speedZoom;
        toast(`Speed zoom ${state.speedZoom ? 'on' : 'off'}`);
        break;
      case 'KeyM':
        state.bigmap = !state.bigmap;
        $('bigmap').classList.toggle('hidden', !state.bigmap);
        if (state.bigmap) drawBigMap();
        break;
      case 'KeyN':
        sound.setMuted(!sound.muted);
        break;
      case 'KeyH':
        state.help = !state.help;
        $('help').classList.toggle('hidden', !state.help);
        break;
      case 'KeyP':
        state.paused = !state.paused;
        $('paused').classList.toggle('hidden', !state.paused);
        break;
      case 'KeyR':
        resetTank();
        break;
      case 'Equal':
      case 'NumpadAdd':
        cam.base = clamp(cam.base * 1.2, 2.5, 24);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        cam.base = clamp(cam.base / 1.2, 2.5, 24);
        break;
      case 'Escape':
        if (state.help) toggle('KeyH');
        if (state.bigmap) toggle('KeyM');
        break;
    }
    syncButtons();
  }

  function syncButtons() {
    const z = $('btn-z'), x = $('btn-x'), n = $('btn-n');
    z.textContent = `Z · ${state.deadZone ? 'on' : 'off'}`;
    z.classList.toggle('on', state.deadZone);
    x.textContent = `X · ${state.speedZoom ? 'on' : 'off'}`;
    x.classList.toggle('on', state.speedZoom);
    n.textContent = `Sound · ${sound.muted ? 'off' : 'on'}`;
    n.classList.toggle('on', !sound.muted);
  }

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    sound.init();
    if (!e.repeat) {
      if (state.help && (e.code === 'Enter' || e.code === 'Space')) {
        toggle('KeyH');
        return;
      }
      toggle(e.code);
    }
    if (e.code === 'KeyQ' || e.code === 'KeyE') mouse.active = false;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });
  canvas.addEventListener('mousedown', (e) => {
    sound.init();
    if (e.button === 0) mouse.down = true;
    mouse.active = true;
  });
  window.addEventListener('mouseup', () => (mouse.down = false));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.base = clamp(cam.base * Math.exp(-e.deltaY * 0.0012), 2.5, 24);
    },
    { passive: false },
  );
  document.querySelectorAll('.toolbar button').forEach((b) =>
    b.addEventListener('click', () => {
      sound.init();
      toggle(b.dataset.key);
      b.blur();
    }),
  );
  $('help-close').addEventListener('click', () => {
    sound.init();
    toggle('KeyH');
  });
  $('bigmap').addEventListener('click', () => toggle('KeyM'));
  $('minimap').addEventListener('click', () => toggle('KeyM'));

  // touch controls: a drive stick on the left, turret + fire buttons on the right
  function setupTouch() {
    touch.enabled = true;
    $('touch').classList.remove('hidden');
    const stick = $('stick'), knob = $('knob');
    let id = null;
    const move = (t) => {
      const r = stick.getBoundingClientRect();
      let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      knob.style.transform = `translate(${dx * 45}px, ${dy * 45}px)`;
      touch.drive = clamp(-dy * 1.3, -1, 1);
      touch.turn = clamp(dx * 1.3, -1, 1);
    };
    stick.addEventListener('touchstart', (e) => {
      sound.init();
      id = e.changedTouches[0].identifier;
      move(e.changedTouches[0]);
      e.preventDefault();
    });
    stick.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) move(t);
      e.preventDefault();
    });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === id) {
          id = null;
          touch.drive = touch.turn = 0;
          knob.style.transform = '';
        }
      }
    };
    stick.addEventListener('touchend', end);
    stick.addEventListener('touchcancel', end);
    const hold = (el, on, off) => {
      el.addEventListener('touchstart', (e) => {
        sound.init();
        on();
        e.preventDefault();
      });
      el.addEventListener('touchend', (e) => {
        off();
        e.preventDefault();
      });
      el.addEventListener('touchcancel', off);
    };
    hold($('t-fire'), () => (touch.fire = true), () => (touch.fire = false));
    hold($('t-brake'), () => (touch.brake = true), () => (touch.brake = false));
    hold($('t-tl'), () => (touch.turret = -1), () => (touch.turret = 0));
    hold($('t-tr'), () => (touch.turret = 1), () => (touch.turret = 0));
  }
  if ('ontouchstart' in window || (window.matchMedia && matchMedia('(pointer: coarse)').matches)) setupTouch();

  function readInput() {
    const k = (c) => keys.has(c);
    let drive = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0) + touch.drive;
    let turn = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + touch.turn;
    const turretTurn = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0) + touch.turret;
    let aim = null;
    if (mouse.active && !touch.enabled) aim = screenToWorld(mouse.x, mouse.y);
    return {
      drive: clamp(drive, -1, 1),
      turn: clamp(turn, -1, 1),
      brake: k('ShiftLeft') || k('ShiftRight') || touch.brake,
      turretTurn,
      aim,
      fire: k('Space') || k('KeyF') || mouse.down || touch.fire,
    };
  }

  function screenToWorld(sx, sy) {
    const z = cam.zoom;
    return [cam.x + (sx - innerWidth / 2) / z, cam.y + (sy - innerHeight / 2) / z];
  }

  // ------------------------------------------------------------------ HUD --
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('toast');
    t.innerHTML = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1600);
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  let hudT = 0;
  function updateHud(dt) {
    hudT -= dt;
    const T = G.TANK;
    $('hud-reload').style.width = `${(1 - tank.reload / T.reloadTime) * 100}%`;
    if (hudT > 0) return;
    hudT = 0.1;
    const st = world.stats;
    $('hud-targets').textContent = `${st.targets} / ${st.targetsTotal}`;
    $('hud-destroyed').textContent = st.destroyed;
    $('hud-time').textContent = fmtTime(state.elapsed);
    $('hud-speed').textContent = Math.round(Math.abs(tank.forwardSpeed()) * 3.6);
    $('hud-surface').textContent = tank.surface ? tank.surface.name : '—';
    const b = tank.body;
    const col = String.fromCharCode(65 + clamp(Math.floor(b.x / 500), 0, 9));
    const row = clamp(Math.floor(b.y / 500), 0, 9) + 1;
    $('hud-grid').textContent = `${col}${row} · ${Math.round(world.heightAt(b.x, b.y))} m`;
    $('hud-gun').textContent = tank.reload > 0 ? 'Loading…' : 'Ready';
  }

  let mapT = 0;
  function drawMinimap(dt) {
    mapT -= dt;
    if (mapT > 0) return;
    mapT = 1 / 15;
    const c = $('minimap');
    const px = Math.round(c.clientWidth * cam.dpr);
    if (c.width !== px) {
      c.width = px;
      c.height = px;
    }
    const x = c.getContext('2d');
    const R = 450; // metres shown either side
    const b = tank.body, map = renderer.map, s = renderer.mapPx / SIZE;
    x.fillStyle = '#1a1d18';
    x.fillRect(0, 0, px, px);
    x.drawImage(map, (b.x - R) * s, (b.y - R) * s, R * 2 * s, R * 2 * s, 0, 0, px, px);
    const k = px / (R * 2);
    const toMap = (wx, wy) => [(wx - b.x + R) * k, (wy - b.y + R) * k];
    // targets
    for (const e of targets) {
      if (!e.alive) continue;
      let [mx, my] = toMap(e.body.x, e.body.y);
      const inside = mx > 4 && my > 4 && mx < px - 4 && my < px - 4;
      mx = clamp(mx, 4, px - 4);
      my = clamp(my, 4, px - 4);
      x.fillStyle = inside ? '#ff4a36' : 'rgba(255,74,54,0.6)';
      x.beginPath();
      x.arc(mx, my, (inside ? 3.5 : 2.5) * cam.dpr, 0, 6.28);
      x.fill();
    }
    // view rectangle
    const v = lastView;
    if (v) {
      const [a0, b0] = toMap(v.x0, v.y0), [a1, b1] = toMap(v.x1, v.y1);
      x.strokeStyle = 'rgba(255,255,255,0.5)';
      x.lineWidth = cam.dpr;
      x.strokeRect(a0, b0, a1 - a0, b1 - b0);
    }
    drawTankArrow(x, px / 2, px / 2, b.a, 6 * cam.dpr);
  }

  function drawTankArrow(x, mx, my, a, s) {
    x.save();
    x.translate(mx, my);
    x.rotate(a);
    x.fillStyle = '#3fd1b0';
    x.strokeStyle = '#0b1513';
    x.lineWidth = s * 0.3;
    x.beginPath();
    x.moveTo(s * 1.5, 0);
    x.lineTo(-s, s);
    x.lineTo(-s * 0.4, 0);
    x.lineTo(-s, -s);
    x.closePath();
    x.stroke();
    x.fill();
    x.restore();
  }

  function drawBigMap() {
    const c = $('bigmap-canvas');
    const css = Math.floor(Math.min(innerWidth * 0.92, innerHeight * 0.8));
    const px = Math.round(css * cam.dpr);
    c.width = px;
    c.height = px;
    c.style.width = css + 'px';
    c.style.height = css + 'px';
    const x = c.getContext('2d');
    x.drawImage(renderer.map, 0, 0, px, px);
    const k = px / SIZE;
    x.strokeStyle = 'rgba(255,255,255,0.18)';
    x.lineWidth = 1;
    x.font = `${11 * cam.dpr}px system-ui, sans-serif`;
    x.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i <= 10; i++) {
      x.beginPath();
      x.moveTo(i * 500 * k, 0);
      x.lineTo(i * 500 * k, px);
      x.moveTo(0, i * 500 * k);
      x.lineTo(px, i * 500 * k);
      x.stroke();
      if (i < 10) {
        x.fillText(String.fromCharCode(65 + i), i * 500 * k + 4 * cam.dpr, 13 * cam.dpr);
        x.fillText(String(i + 1), 4 * cam.dpr, i * 500 * k + 26 * cam.dpr);
      }
    }
    for (const e of targets) {
      if (!e.alive) continue;
      x.fillStyle = '#ff4a36';
      x.strokeStyle = '#fff';
      x.beginPath();
      x.arc(e.body.x * k, e.body.y * k, 4.5 * cam.dpr, 0, 6.28);
      x.fill();
      x.stroke();
    }
    drawTankArrow(x, tank.body.x * k, tank.body.y * k, tank.body.a, 7 * cam.dpr);
  }

  // --------------------------------------------------------------- camera --
  let lastView = null;
  function updateCamera(dt, input) {
    const b = tank.body;
    const speed = Math.hypot(b.vx, b.vy);
    let tx = b.x + b.vx * 0.9, ty = b.y + b.vy * 0.9;
    if (input.aim) {
      const ax = clamp((input.aim[0] - b.x) * 0.2, -25, 25), ay = clamp((input.aim[1] - b.y) * 0.2, -25, 25);
      tx += ax;
      ty += ay;
    }
    const want = state.speedZoom ? cam.base / (1 + speed * 0.045) : cam.base;
    cam.zoom += (want - cam.zoom) * (1 - Math.exp(-dt * 2.5));
    const k = 1 - Math.exp(-dt * 3.5);
    if (state.deadZone) {
      const hw = (innerWidth / cam.zoom) * 0.1, hh = (innerHeight / cam.zoom) * 0.1;
      const dx = tx - cam.x, dy = ty - cam.y;
      if (Math.abs(dx) > hw) cam.x += (dx - Math.sign(dx) * hw) * k * 1.6;
      if (Math.abs(dy) > hh) cam.y += (dy - Math.sign(dy) * hh) * k * 1.6;
    } else {
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
    }
    cam.x = clamp(cam.x, -250, SIZE + 250);
    cam.y = clamp(cam.y, -250, SIZE + 250);
    cam.shake = Math.max(0, cam.shake - dt * 2.5);
    const s = cam.shake * cam.shake * 1.6;
    cam.shakeX = (Math.random() - 0.5) * s;
    cam.shakeY = (Math.random() - 0.5) * s;
  }

  function resize() {
    cam.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * cam.dpr);
    canvas.height = Math.round(innerHeight * cam.dpr);
    if (state.bigmap) drawBigMap();
  }
  window.addEventListener('resize', resize);

  function resetTank() {
    if (!tank) return;
    const b = tank.body;
    b.x = world.spawn.x;
    b.y = world.spawn.y;
    b.a = world.spawn.a;
    b.vx = b.vy = b.w = 0;
    b.update();
    tank.turret = 0;
    cam.x = b.x;
    cam.y = b.y;
    world.marks.forEach((m) => (m.gap = true));
  }

  // --------------------------------------------------------------- events --
  function handleEvents() {
    const b = tank.body;
    for (const ev of world.events) {
      const d = Math.hypot(ev.x - b.x, ev.y - b.y);
      switch (ev.type) {
        case 'fire':
          sound.fire();
          cam.shake = Math.max(cam.shake, 0.55);
          break;
        case 'explosion':
          sound.explosion(d, ev.big);
          cam.shake = Math.max(cam.shake, clamp(1 - d / (ev.big ? 120 : 70), 0, 1) * (ev.big ? 1 : 0.6));
          break;
        case 'crash':
          sound.crash(d, ev.vol);
          break;
        case 'collapse':
          renderer.markDestroyedOnMap(ev.e);
          toast('Building destroyed');
          break;
        case 'target': {
          const st = world.stats;
          sound.chime();
          if (st.targets >= st.targetsTotal && !state.finished) {
            state.finished = true;
            toast(`All ${st.targetsTotal} targets destroyed in <span style="color:#3fd1b0">${fmtTime(state.elapsed)}</span><br><small>Keep exploring — or press R to return to base</small>`, 7000);
          } else toast(`Target destroyed · ${st.targets} / ${st.targetsTotal}`);
          break;
        }
      }
    }
    world.events.length = 0;
  }

  // ----------------------------------------------------------------- loop --
  let targets = [];
  let last = 0, acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    const input = readInput();
    if (state.paused || state.help || state.bigmap) {
      dt = 0;
      input.fire = false;
    }
    if (!state.started && (Math.abs(input.drive) > 0 || Math.abs(input.turn) > 0 || input.fire)) {
      state.started = true;
    }
    if (state.started && !state.finished) state.elapsed += dt;
    if (input.fire && dt > 0) tank.fire(world);
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 10) {
      world.step(STEP, input);
      acc -= STEP;
      n++;
    }
    if (n === 10) acc = 0;
    if (dt > 0) world.updateEffects(dt);
    handleEvents();
    updateCamera(Math.max(dt, 1 / 240), input);
    sound.engine(tank.speed, (Math.abs(tank.throttle[0]) + Math.abs(tank.throttle[1])) / 2);
    lastView = renderer.draw(cam, tank, input.aim, dt);
    updateHud(dt);
    drawMinimap(dt);
  }

  // ----------------------------------------------------------------- boot --
  function boot() {
    resize();
    if (innerWidth < 760) cam.base = cam.zoom = 9;
    world = new G.World(SEED);
    const bar = $('loading-bar'), text = $('loading-text');
    const steps = world.buildSteps();
    steps.push(['Drawing the map', () => {
      tank = new G.Tank(world.spawn.x, world.spawn.y, world.spawn.a);
      world.tank = tank;
      world.tankEnt = { kind: 'tank', body: tank.body, id: 0, dyn: true, alive: true, q: 0 };
      targets = world.entities.filter((e) => e.kind === 'target');
      renderer = new G.Renderer(canvas, world);
      renderer.buildMap(800);
    }]);
    let i = 0;
    const next = () => {
      if (i < steps.length) {
        const [label, fn] = steps[i++];
        text.textContent = label + '…';
        bar.style.width = `${(i / steps.length) * 100}%`;
        // give the browser a frame to paint the label, then do the work
        requestAnimationFrame(() => setTimeout(() => {
          fn();
          next();
        }, 0));
        return;
      }
      cam.x = tank.body.x;
      cam.y = tank.body.y - 10;
      $('loading').classList.add('hidden');
      $('help').classList.toggle('hidden', !state.help);
      syncButtons();
      updateHud(1);
      requestAnimationFrame((t) => {
        last = t;
        frame(t);
      });
    };
    next();
  }

  requestAnimationFrame(() => setTimeout(boot, 30));
  // expose for debugging in the console
  window.TankLab = { get world() { return world; }, get tank() { return tank; }, cam, state };
})();
