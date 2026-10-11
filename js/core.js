/* Tank Lab — core: math helpers, noise, 2D rigid bodies and collisions.
 *
 * World units are metres, kilograms and seconds. The y axis points down
 * (screen space), so a positive angular velocity turns clockwise on screen.
 */
'use strict';
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const G = (root.G = root.G || {});

  // ---------------------------------------------------------------- math --
  G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.smoothstep = (a, b, x) => {
    const t = G.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  G.wrapAngle = (a) => {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  };
  /** Distance from point p to segment ab. */
  G.distSeg = (px, py, ax, ay, bx, by) => {
    const ex = bx - ax, ey = by - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + ex * t), dy = py - (ay + ey * t);
    return Math.sqrt(dx * dx + dy * dy);
  };
  /** Small, fast seeded PRNG (mulberry32). */
  G.rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /** Integer hash → [0,1). Used for per-pixel grain. */
  G.hash2 = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) & 1023) / 1024;
  };

  // --------------------------------------------------------------- noise --
  G.makeNoise = (seed) => {
    const rnd = G.rng(seed);
    const perm = new Uint8Array(512);
    const vals = new Float32Array(256);
    const p = [];
    for (let i = 0; i < 256; i++) {
      p.push(i);
      vals[i] = rnd() * 2 - 1;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    function noise(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const x0 = ix & 255, y0 = iy & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
      const a = vals[perm[perm[x0] + y0]], b = vals[perm[perm[x1] + y0]];
      const c = vals[perm[perm[x0] + y1]], d = vals[perm[perm[x1] + y1]];
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    }
    function fbm(x, y, oct) {
      let s = 0, amp = 0.5, f = 1, n = 0;
      for (let i = 0; i < oct; i++) {
        s += amp * noise(x * f + i * 17.3, y * f - i * 9.1);
        n += amp;
        amp *= 0.5;
        f *= 2.03;
      }
      return s / n;
    }
    return { noise, fbm };
  };

  // -------------------------------------------------------------- shapes --
  /** Convex polygon, vertices ordered so that (ey, -ex) is the outward normal. */
  G.boxShape = (w, h) => {
    const x = w / 2, y = h / 2;
    return { type: 'poly', lv: [-x, -y, x, -y, x, y, -x, y], w, h };
  };
  G.ngonShape = (r, n) => {
    const lv = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      lv.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return { type: 'poly', lv, w: r * 2, h: r * 2 };
  };
  G.circleShape = (r) => ({ type: 'circle', r });

  // ---------------------------------------------------------- rigid body --
  class Body {
    constructor(o) {
      this.x = o.x;
      this.y = o.y;
      this.a = o.a || 0;
      this.vx = 0;
      this.vy = 0;
      this.w = 0; // angular velocity (rad/s)
      this.fx = 0;
      this.fy = 0;
      this.t = 0; // accumulated torque
      this.shape = o.shape;
      const m = o.mass || 0;
      this.mass = m;
      this.invM = m > 0 ? 1 / m : 0;
      let I = o.inertia;
      if (I === undefined && m > 0) {
        const s = o.shape;
        I = s.type === 'circle' ? 0.5 * m * s.r * s.r : (m * (s.w * s.w + s.h * s.h)) / 12;
      }
      this.invI = m > 0 ? 1 / I : 0;
      this.e = o.restitution !== undefined ? o.restitution : 0.15;
      this.mu = o.friction !== undefined ? o.friction : 0.5;
      if (this.shape.type === 'poly') {
        const n = this.shape.lv.length;
        this.wv = new Float64Array(n);
        this.wn = new Float64Array(n);
        let r = 0;
        for (let i = 0; i < n; i += 2) r = Math.max(r, Math.hypot(this.shape.lv[i], this.shape.lv[i + 1]));
        this.radius = r;
      } else {
        this.radius = this.shape.r;
      }
      this.update();
    }

    /** Recompute world-space vertices, normals and bounding box. */
    update() {
      const r = this.radius;
      if (this.shape.type === 'circle') {
        this.minx = this.x - r;
        this.miny = this.y - r;
        this.maxx = this.x + r;
        this.maxy = this.y + r;
        return;
      }
      const c = Math.cos(this.a), s = Math.sin(this.a);
      const lv = this.shape.lv, wv = this.wv, wn = this.wn, n = lv.length;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (let i = 0; i < n; i += 2) {
        const x = this.x + lv[i] * c - lv[i + 1] * s;
        const y = this.y + lv[i] * s + lv[i + 1] * c;
        wv[i] = x;
        wv[i + 1] = y;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        const ex = wv[j] - wv[i], ey = wv[j + 1] - wv[i + 1];
        const l = Math.hypot(ex, ey) || 1;
        wn[i] = ey / l;
        wn[i + 1] = -ex / l;
      }
      this.minx = minx;
      this.miny = miny;
      this.maxx = maxx;
      this.maxy = maxy;
    }

    /** Apply a force at world point (px, py). */
    applyForce(fx, fy, px, py) {
      this.fx += fx;
      this.fy += fy;
      this.t += (px - this.x) * fy - (py - this.y) * fx;
    }
    applyImpulse(jx, jy, px, py) {
      this.vx += jx * this.invM;
      this.vy += jy * this.invM;
      this.w += ((px - this.x) * jy - (py - this.y) * jx) * this.invI;
    }
    /** Velocity of a world point attached to the body. */
    pointVelX(px, py) {
      return this.vx - this.w * (py - this.y);
    }
    pointVelY(px, py) {
      return this.vy + this.w * (px - this.x);
    }
    integrate(dt) {
      this.vx += this.fx * this.invM * dt;
      this.vy += this.fy * this.invM * dt;
      this.w += this.t * this.invI * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.a += this.w * dt;
      this.fx = this.fy = this.t = 0;
      this.update();
    }
  }
  G.Body = Body;

  // ---------------------------------------------------------- collisions --
  // Each test returns null or a manifold {nx, ny, c:[x, y, depth, ...]} whose
  // normal points from A towards B.
  let _sep = 0;
  function maxSeparation(A, B) {
    const av = A.wv, an = A.wn, bv = B.wv;
    let best = -Infinity, bi = 0;
    for (let i = 0; i < av.length; i += 2) {
      const nx = an[i], ny = an[i + 1], px = av[i], py = av[i + 1];
      let mn = Infinity;
      for (let j = 0; j < bv.length; j += 2) {
        const d = nx * (bv[j] - px) + ny * (bv[j + 1] - py);
        if (d < mn) mn = d;
      }
      if (mn > best) {
        best = mn;
        bi = i;
      }
    }
    _sep = best;
    return bi;
  }

  function polyPoly(A, B) {
    const ia = maxSeparation(A, B), sa = _sep;
    if (sa > 0) return null;
    const ib = maxSeparation(B, A), sb = _sep;
    if (sb > 0) return null;
    let R, I, ri, flip;
    if (sb > sa + 0.005) {
      R = B; I = A; ri = ib; flip = true;
    } else {
      R = A; I = B; ri = ia; flip = false;
    }
    const rv = R.wv, L = rv.length;
    const nx = R.wn[ri], ny = R.wn[ri + 1];
    const v1x = rv[ri], v1y = rv[ri + 1], v2x = rv[(ri + 2) % L], v2y = rv[(ri + 3) % L];
    // incident edge: the one most anti-parallel to the reference normal
    const iv = I.wv, inn = I.wn, IL = iv.length;
    let ii = 0, md = Infinity;
    for (let j = 0; j < IL; j += 2) {
      const d = nx * inn[j] + ny * inn[j + 1];
      if (d < md) {
        md = d;
        ii = j;
      }
    }
    let p1x = iv[ii], p1y = iv[ii + 1], p2x = iv[(ii + 2) % IL], p2y = iv[(ii + 3) % IL];
    let tx = v2x - v1x, ty = v2y - v1y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // clip against the side planes of the reference edge
    const o1 = tx * v1x + ty * v1y;
    let d1 = o1 - (tx * p1x + ty * p1y), d2 = o1 - (tx * p2x + ty * p2y);
    if (d1 > 0 && d2 > 0) return null;
    if (d1 > 0) {
      const s = d1 / (d1 - d2);
      p1x += (p2x - p1x) * s;
      p1y += (p2y - p1y) * s;
    } else if (d2 > 0) {
      const s = d2 / (d2 - d1);
      p2x += (p1x - p2x) * s;
      p2y += (p1y - p2y) * s;
    }
    const o2 = tx * v2x + ty * v2y;
    d1 = tx * p1x + ty * p1y - o2;
    d2 = tx * p2x + ty * p2y - o2;
    if (d1 > 0 && d2 > 0) return null;
    if (d1 > 0) {
      const s = d1 / (d1 - d2);
      p1x += (p2x - p1x) * s;
      p1y += (p2y - p1y) * s;
    } else if (d2 > 0) {
      const s = d2 / (d2 - d1);
      p2x += (p1x - p2x) * s;
      p2y += (p1y - p2y) * s;
    }
    const c = [];
    const s1 = nx * (p1x - v1x) + ny * (p1y - v1y);
    if (s1 <= 0) c.push(p1x, p1y, -s1);
    const s2 = nx * (p2x - v1x) + ny * (p2y - v1y);
    if (s2 <= 0) c.push(p2x, p2y, -s2);
    if (!c.length) return null;
    return flip ? { nx: -nx, ny: -ny, c } : { nx, ny, c };
  }

  function polyCircle(P, C) {
    const cx = C.x, cy = C.y, r = C.radius;
    const pv = P.wv, pn = P.wn, L = pv.length;
    let best = -Infinity, bi = 0;
    for (let i = 0; i < L; i += 2) {
      const s = pn[i] * (cx - pv[i]) + pn[i + 1] * (cy - pv[i + 1]);
      if (s > r) return null;
      if (s > best) {
        best = s;
        bi = i;
      }
    }
    const nx = pn[bi], ny = pn[bi + 1];
    if (best < 1e-6) return { nx, ny, c: [cx - nx * r, cy - ny * r, r - best] };
    const v1x = pv[bi], v1y = pv[bi + 1], v2x = pv[(bi + 2) % L], v2y = pv[(bi + 3) % L];
    const ex = v2x - v1x, ey = v2y - v1y;
    let t = ((cx - v1x) * ex + (cy - v1y) * ey) / (ex * ex + ey * ey);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = v1x + ex * t, qy = v1y + ey * t;
    const dx = cx - qx, dy = cy - qy, d = Math.hypot(dx, dy);
    if (d > r) return null;
    if (d < 1e-9) return { nx, ny, c: [qx, qy, r] };
    return { nx: dx / d, ny: dy / d, c: [qx, qy, r - d] };
  }

  function circleCircle(A, B) {
    const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), r = A.radius + B.radius;
    if (d > r) return null;
    const nx = d > 1e-9 ? dx / d : 1, ny = d > 1e-9 ? dy / d : 0;
    return { nx, ny, c: [A.x + nx * A.radius, A.y + ny * A.radius, r - d] };
  }

  G.collide = (A, B) => {
    if (A.maxx < B.minx || B.maxx < A.minx || A.maxy < B.miny || B.maxy < A.miny) return null;
    const ta = A.shape.type, tb = B.shape.type;
    if (ta === 'poly' && tb === 'poly') return polyPoly(A, B);
    if (ta === 'poly') return polyCircle(A, B);
    if (tb === 'poly') {
      const m = polyCircle(B, A);
      if (m) {
        m.nx = -m.nx;
        m.ny = -m.ny;
      }
      return m;
    }
    return circleCircle(A, B);
  };

  /** Sequential-impulse contact solver (non-accumulating, game-grade). */
  G.solveContacts = (list, iters) => {
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < list.length; k++) {
        const m = list[k], A = m.A, B = m.B, nx = m.nx, ny = m.ny, c = m.c;
        for (let i = 0; i < c.length; i += 3) {
          const px = c[i], py = c[i + 1];
          const rax = px - A.x, ray = py - A.y, rbx = px - B.x, rby = py - B.y;
          const rvx = B.vx - B.w * rby - (A.vx - A.w * ray);
          const rvy = B.vy + B.w * rbx - (A.vy + A.w * rax);
          const vn = rvx * nx + rvy * ny;
          if (vn > 0) continue;
          const rnA = rax * ny - ray * nx, rnB = rbx * ny - rby * nx;
          const kn = A.invM + B.invM + A.invI * rnA * rnA + B.invI * rnB * rnB;
          if (kn <= 0) continue;
          const e = it === 0 && vn < -1.5 ? Math.max(A.e, B.e) : 0;
          const j = (-(1 + e) * vn) / kn / (c.length / 3);
          m.impulse += j;
          let jx = nx * j, jy = ny * j;
          // friction along the tangent
          const tx = -ny, ty = nx;
          const vt = rvx * tx + rvy * ty;
          const rtA = rax * ty - ray * tx, rtB = rbx * ty - rby * tx;
          const kt = A.invM + B.invM + A.invI * rtA * rtA + B.invI * rtB * rtB;
          let jt = -vt / kt;
          const maxF = Math.sqrt(A.mu * B.mu) * j;
          jt = jt < -maxF ? -maxF : jt > maxF ? maxF : jt;
          jx += tx * jt;
          jy += ty * jt;
          A.vx -= jx * A.invM;
          A.vy -= jy * A.invM;
          A.w -= (rax * jy - ray * jx) * A.invI;
          B.vx += jx * B.invM;
          B.vy += jy * B.invM;
          B.w += (rbx * jy - rby * jx) * B.invI;
        }
      }
    }
    // positional correction to remove residual overlap
    for (let k = 0; k < list.length; k++) {
      const m = list[k], A = m.A, B = m.B, c = m.c;
      let depth = 0;
      for (let i = 2; i < c.length; i += 3) depth = Math.max(depth, c[i]);
      const tot = A.invM + B.invM;
      if (tot <= 0) continue;
      const corr = (Math.max(depth - 0.01, 0) * 0.8) / tot;
      A.x -= m.nx * corr * A.invM;
      A.y -= m.ny * corr * A.invM;
      B.x += m.nx * corr * B.invM;
      B.y += m.ny * corr * B.invM;
      if (A.invM) A.update();
      if (B.invM) B.update();
    }
  };

  // ------------------------------------------------------------- raycast --
  /** Segment p0→p1 against a body; returns hit fraction in [0,1] or -1. */
  G.raycastBody = (x0, y0, x1, y1, b) => {
    const dx = x1 - x0, dy = y1 - y0;
    if (b.shape.type === 'circle') {
      const fx = x0 - b.x, fy = y0 - b.y, r = b.radius;
      const a = dx * dx + dy * dy, bb = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
      if (c <= 0) return 0;
      const disc = bb * bb - 4 * a * c;
      if (disc < 0) return -1;
      const t = (-bb - Math.sqrt(disc)) / (2 * a);
      return t >= 0 && t <= 1 ? t : -1;
    }
    const v = b.wv, n = b.wn;
    let tin = 0, tout = 1;
    for (let i = 0; i < v.length; i += 2) {
      const num = n[i] * (v[i] - x0) + n[i + 1] * (v[i + 1] - y0);
      const den = n[i] * dx + n[i + 1] * dy;
      if (den === 0) {
        if (num < 0) return -1;
      } else {
        const t = num / den;
        if (den < 0) {
          if (t > tin) tin = t;
        } else if (t < tout) tout = t;
        if (tin > tout) return -1;
      }
    }
    return tin;
  };

  /** Convex hull (monotone chain) of a flat point list; returns flat list. */
  G.convexHull = (pts) => {
    const p = [];
    for (let i = 0; i < pts.length; i += 2) p.push([pts[i], pts[i + 1]]);
    p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    }
    up.pop();
    lo.pop();
    const out = [];
    for (const q of lo.concat(up)) out.push(q[0], q[1]);
    return out;
  };
})();
