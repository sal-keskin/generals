/* Tank Lab — the 5 × 5 km world: terrain, roads, buildings, barriers, trees,
 * plus the simulation that ties the tank, props, shells and effects together.
 */
'use strict';
(function () {
  const G = (typeof window !== 'undefined' ? window : globalThis).G;
  const { clamp, lerp, smoothstep } = G;

  const SIZE = 5000; // map edge length (m)
  const PAD = 600; // terrain also exists this far outside the map (scenery)
  const RES = 5; // height grid resolution (m)
  const GN = (SIZE + PAD * 2) / RES + 1;
  const MRES = 2; // surface mask resolution (m)
  const MN = SIZE / MRES;
  const CELL = 20; // spatial hash cell (m)
  const CN = SIZE / CELL;
  G.WORLD = { SIZE, PAD };

  // surface mask values
  const M_GRASS = 0, M_ROAD = 1, M_DIRT = 2, M_VERGE = 3, M_GRAVEL = 4, M_URBAN = 5, M_PARK = 6, M_FIELD = 10;
  G.MASK = { M_GRASS, M_ROAD, M_DIRT, M_VERGE, M_GRAVEL, M_URBAN, M_PARK, M_FIELD };

  const BASE = [1700, 4450]; // training ground / spawn
  const TOWN = [2500, 2500];
  const VILLAGES = [
    [1000, 1000],
    [1000, 3950],
    [3900, 3900],
  ];
  const FARM = [4000, 900];
  const HILLS = [
    [800, 700, 55, 380], [4200, 1500, 60, 420], [3600, 4300, 45, 300], [850, 3000, 50, 330],
    [1900, 3650, 38, 300], [3300, 1000, 50, 330], [3300, 3300, 28, 260], [1500, 600, 30, 260],
  ];
  const LAKES = [
    [3700, 2700, 50, 240], [1250, 1700, 42, 190], [650, 3350, 34, 130], [4350, 4250, 30, 120],
  ];
  const RIVER = [1700, -700, 1900, 300, 1650, 1050, 2050, 1750, 2900, 1950, 3450, 2250, 3700, 2700,
    4150, 3050, 4700, 3300, 5700, 3450];
  const FLAT = [
    [TOWN[0], TOWN[1], 480, 760], [BASE[0], BASE[1], 230, 430], [1000, 1000, 120, 280],
    [1000, 3950, 120, 280], [3900, 3900, 120, 280], [FARM[0], FARM[1], 110, 250],
  ];

  const ROAD_W = { highway: 13, road: 9, street: 9, dirt: 5.5 };
  const ROADS = [
    ['highway', [-100, 2300, 700, 2150, 1500, 2350, 1960, 2500, 2140, 2500, 2500, 2500, 2860, 2500, 3040, 2500, 3400, 2330, 4100, 2050, 5100, 2150]],
    ['highway', [2450, -100, 2600, 800, 2400, 1600, 2500, 1960, 2500, 2140, 2500, 2500, 2500, 2860, 2500, 3040, 2650, 3350, 2400, 4200, 2550, 5100]],
    ['road', [1500, 2350, 1300, 3000, 1050, 3500, 1000, 3950, 1300, 4500, 1700, 4450]],
    ['road', [2400, 1600, 1800, 1300, 1000, 1000, 600, 500, 300, -100]],
    ['road', [2650, 3300, 3300, 3600, 3900, 3900, 4400, 4500, 4700, 5100]],
    ['road', [4100, 2050, 4000, 1500, 4000, 900, 4500, 600, 5100, 450]],
    ['dirt', [1000, 1000, 850, 1600, 700, 2150]],
    ['dirt', [3900, 3900, 4300, 3500, 4750, 3000]],
    ['dirt', [2420, 4280, 2100, 4400, 1700, 4450]],
    ['dirt', [3300, 2350, 3500, 1500, 3300, 1000, 4000, 900]],
    ['dirt', [1700, 4450, 1720, 4200, 1700, 3950]],
  ];

  // Props that can be destroyed or pushed around.
  const DEF = {
    jersey: { mass: 1800, hp: 110, w: 3.2, h: 0.8, crush: 14, mu: 0.6 },
    block: { mass: 2600, hp: 170, w: 1.8, h: 1.8, crush: 16, mu: 0.65 },
    crate: { mass: 260, hp: 22, w: 1.4, h: 1.4, crush: 6, mu: 0.5 },
    barrel: { mass: 200, hp: 12, r: 0.45, crush: 10, mu: 0.35, explosive: true },
    wall: { hp: 60 },
    sandbag: { hp: 80 },
    teeth: { hp: 220 },
    target: { hp: 1 },
    tree: { hp: 12 },
  };

  function catmull(c, step) {
    const out = [];
    const n = c.length / 2;
    for (let i = 0; i < n - 1; i++) {
      const p0 = i > 0 ? i - 1 : i, p3 = i + 2 < n ? i + 2 : i + 1;
      const ax = c[p0 * 2], ay = c[p0 * 2 + 1], bx = c[i * 2], by = c[i * 2 + 1];
      const cx = c[i * 2 + 2], cy = c[i * 2 + 3], dx = c[p3 * 2], dy = c[p3 * 2 + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(cx - bx, cy - by) / step));
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push(
          0.5 * (2 * bx + (-ax + cx) * t + (2 * ax - 5 * bx + 4 * cx - dx) * t2 + (-ax + 3 * bx - 3 * cx + dx) * t3),
          0.5 * (2 * by + (-ay + cy) * t + (2 * ay - 5 * by + 4 * cy - dy) * t2 + (-ay + 3 * by - 3 * cy + dy) * t3),
        );
      }
    }
    out.push(c[c.length - 2], c[c.length - 1]);
    return out;
  }

  // Shared surface descriptors (avoid per-frame allocation).
  const SURF = {
    road: { name: 'Asphalt', roll: 1.0, lat: 1.0, grip: 1.0, dust: 0 },
    dirt: { name: 'Dirt track', roll: 1.2, lat: 1.0, grip: 1.0, dust: 1 },
    gravel: { name: 'Gravel', roll: 1.15, lat: 1.0, grip: 1.0, dust: 0.6 },
    urban: { name: 'Pavement', roll: 1.05, lat: 1.0, grip: 1.0, dust: 0 },
    grass: { name: 'Grass', roll: 1.55, lat: 0.95, grip: 0.95, dust: 0.25 },
    field: { name: 'Farmland', roll: 1.85, lat: 0.9, grip: 0.9, dust: 1 },
    sand: { name: 'Sand', roll: 2.1, lat: 0.85, grip: 0.85, dust: 1 },
    rock: { name: 'Rock', roll: 1.4, lat: 1.0, grip: 0.9, dust: 0.3 },
    snow: { name: 'Snow', roll: 1.9, lat: 0.7, grip: 0.7, dust: 0 },
    water: { name: 'Shallow water', roll: 6, lat: 1.2, grip: 0.6, dust: 0 },
    deep: { name: 'Deep water', roll: 22, lat: 2, grip: 0.4, dust: 0 },
  };

  class World {
    constructor(seed) {
      this.seed = seed;
      this.rand = G.rng(seed);
      this.noise = G.makeNoise(seed);
      this.noise2 = G.makeNoise(seed * 7 + 3);
      this.H = new Float32Array(GN * GN);
      this.GX = new Float32Array(GN * GN);
      this.GY = new Float32Array(GN * GN);
      this.F = new Float32Array(GN * GN); // forest noise
      this.mask = new Uint8Array(MN * MN); // base ground type
      this.road = new Uint8Array(MN * MN); // 1 paved, 2 dirt, 3 verge
      this.cells = new Array(CN * CN).fill(null);
      this.entities = [];
      this.awake = [];
      this.roads = [];
      this.fields = [];
      this.decals = [];
      this.shells = [];
      this.particles = [];
      this.emitters = [];
      this.pending = [];
      this.events = [];
      this.marks = [new MarkTrail(2600), new MarkTrail(2600)];
      this.stats = { destroyed: 0, targets: 0, targetsTotal: 0, shots: 0, hits: 0, trees: 0, buildings: 0 };
      this.qid = 1;
      this.nextId = 1;
      this.spawn = { x: BASE[0], y: BASE[1] + 30, a: -Math.PI / 2 };
      this.time = 0;
      this._g = [0, 0];
    }

    // ------------------------------------------------------------ build --
    /** Generation steps as [label, fn] pairs (lets the UI show progress). */
    buildSteps() {
      return [
        ['Raising hills', () => this.genHeights()],
        ['Paving roads', () => this.genRoads()],
        ['Ploughing fields', () => this.genFields()],
        ['Building the town', () => this.genTown()],
        ['Building villages', () => this.genVillages()],
        ['Setting up the training ground', () => this.genTraining()],
        ['Placing roadblocks', () => this.genRoadblocks()],
        ['Placing targets', () => this.genTargets()],
        ['Planting forests', () => this.genTrees()],
      ];
    }
    build(progress) {
      for (const [label, fn] of this.buildSteps()) {
        if (progress) progress(label);
        fn();
      }
    }

    rawHeight(x, y) {
      const n = this.noise;
      let h = 15 + n.fbm(x / 1100, y / 1100, 5) * 42;
      for (const g of HILLS) {
        const dx = x - g[0], dy = y - g[1];
        h += g[2] * Math.exp(-(dx * dx + dy * dy) / (g[3] * g[3]));
      }
      for (const g of LAKES) {
        const dx = x - g[0], dy = y - g[1];
        h -= g[2] * Math.exp(-(dx * dx + dy * dy) / (g[3] * g[3]));
      }
      // mountains around the edge of the map (the "surroundings")
      const d = Math.min(x, y, SIZE - x, SIZE - y);
      if (d < 450) {
        const t = 1 - smoothstep(-60, 450, d);
        h += t * t * (115 + n.fbm(x / 280, y / 280, 4) * 70);
      }
      if (d < 0) h += -d * 0.1;
      return h;
    }

    genHeights() {
      const H = this.H;
      const flat = FLAT.map((f) => [f[0], f[1], f[2], f[3], Math.max(6, this.rawHeight(f[0], f[1]))]);
      for (let j = 0; j < GN; j++) {
        const y = j * RES - PAD;
        for (let i = 0; i < GN; i++) {
          const x = i * RES - PAD;
          let h = this.rawHeight(x, y);
          for (const f of flat) {
            const dx = x - f[0], dy = y - f[1];
            const d2 = dx * dx + dy * dy;
            if (d2 < f[3] * f[3]) h = lerp(h, f[4], 1 - smoothstep(f[2], f[3], Math.sqrt(d2)));
          }
          H[j * GN + i] = h;
          this.F[j * GN + i] = this.noise2.fbm(x / 650 + 11, y / 650 - 3, 4);
        }
      }
      // carve the river
      const rd = new Float32Array(GN * GN).fill(1e9);
      const pts = catmull(RIVER, 20);
      this.river = pts;
      const R = 140;
      for (let k = 0; k < pts.length - 2; k += 2) {
        const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3];
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + PAD) / RES));
        const i1 = Math.min(GN - 1, Math.ceil((Math.max(ax, bx) + R + PAD) / RES));
        const j0 = Math.max(0, Math.floor((Math.min(ay, by) - R + PAD) / RES));
        const j1 = Math.min(GN - 1, Math.ceil((Math.max(ay, by) + R + PAD) / RES));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const d = G.distSeg(i * RES - PAD, j * RES - PAD, ax, ay, bx, by);
            const idx = j * GN + i;
            if (d < rd[idx]) rd[idx] = d;
          }
        }
      }
      for (let k = 0; k < H.length; k++) {
        if (rd[k] < R) {
          const w = Math.pow(1 - smoothstep(8, 135, rd[k]), 1.6);
          H[k] = Math.min(H[k], lerp(H[k], -3.5, w));
        }
      }
      // gradients (central differences)
      for (let j = 1; j < GN - 1; j++) {
        for (let i = 1; i < GN - 1; i++) {
          const k = j * GN + i;
          this.GX[k] = (H[k + 1] - H[k - 1]) / (2 * RES);
          this.GY[k] = (H[k + GN] - H[k - GN]) / (2 * RES);
        }
      }
    }

    /** Bilinear lookup in a grid: returns value; writes indices to reuse. */
    heightAt(x, y) {
      let gx = (x + PAD) / RES, gy = (y + PAD) / RES;
      gx = gx < 0 ? 0 : gx > GN - 1.001 ? GN - 1.001 : gx;
      gy = gy < 0 ? 0 : gy > GN - 1.001 ? GN - 1.001 : gy;
      const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = j * GN + i, H = this.H;
      return (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fy) + (H[k + GN] * (1 - fx) + H[k + GN + 1] * fx) * fy;
    }
    /** Writes [h, gx, gy, forest] into out. */
    sample(x, y, out) {
      let gx = (x + PAD) / RES, gy = (y + PAD) / RES;
      gx = gx < 0 ? 0 : gx > GN - 1.001 ? GN - 1.001 : gx;
      gy = gy < 0 ? 0 : gy > GN - 1.001 ? GN - 1.001 : gy;
      const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = j * GN + i;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const H = this.H, X = this.GX, Y = this.GY, F = this.F;
      out[0] = H[k] * w00 + H[k + 1] * w10 + H[k + GN] * w01 + H[k + GN + 1] * w11;
      out[1] = X[k] * w00 + X[k + 1] * w10 + X[k + GN] * w01 + X[k + GN + 1] * w11;
      out[2] = Y[k] * w00 + Y[k + 1] * w10 + Y[k + GN] * w01 + Y[k + GN + 1] * w11;
      out[3] = F[k] * w00 + F[k + 1] * w10 + F[k + GN] * w01 + F[k + GN + 1] * w11;
      return out;
    }
    gradientAt(x, y) {
      const s = this.sample(x, y, (this._s4 = this._s4 || new Float32Array(4)));
      this._g[0] = s[1];
      this._g[1] = s[2];
      return this._g;
    }
    maskAt(x, y) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 255;
      return this.mask[((y / MRES) | 0) * MN + ((x / MRES) | 0)];
    }
    roadAt(x, y) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 0;
      return this.road[((y / MRES) | 0) * MN + ((x / MRES) | 0)];
    }
    surfaceAt(x, y) {
      const rd = this.roadAt(x, y);
      if (rd === M_ROAD) return SURF.road;
      if (rd === M_DIRT) return SURF.dirt;
      const m = this.maskAt(x, y);
      const s = this.sample(x, y, (this._s4b = this._s4b || new Float32Array(4)));
      const h = s[0];
      if (h < -2.5) return SURF.deep;
      if (h < 0) return SURF.water;
      if (m === M_GRAVEL) return SURF.gravel;
      if (m === M_URBAN) return SURF.urban;
      if (m >= M_FIELD && m !== 255) return SURF.field;
      if (h < 1.3) return SURF.sand;
      if (h > 108) return SURF.snow;
      if (s[1] * s[1] + s[2] * s[2] > 0.2) return SURF.rock;
      return SURF.grass;
    }

    // ----------------------------------------------------------- roads ---
    addRoad(kind, ctrl, width) {
      const pts = catmull(ctrl, 8);
      const road = { kind, w: width || ROAD_W[kind], pts, bridge: null, chunks: [] };
      this.roads.push(road);
      return road;
    }

    genRoads() {
      for (const [kind, ctrl] of ROADS) this.addRoad(kind, ctrl);
      // town grid
      const T0 = TOWN[0] - 360, TS = 90;
      this.town = { x0: T0, y0: TOWN[1] - 360, step: TS, n: 8 };
      for (let k = 0; k <= 8; k++) {
        const v = T0 + k * TS;
        if (v === TOWN[0]) continue; // highways already run along the centre lines
        this.addRoad('street', [v, TOWN[1] - 372, v, TOWN[1] + 372]);
        this.addRoad('street', [TOWN[0] - 372, v, TOWN[0] + 372, v]);
      }
      // a cross street through each village
      for (const c of VILLAGES.concat([FARM])) {
        const p = this.nearestRoadPoint(c[0], c[1]);
        const nx = -p.hy, ny = p.hx;
        this.addRoad('road', [c[0] - nx * 170 + p.hx * 20, c[1] - ny * 170 + p.hy * 20, c[0], c[1], c[0] + nx * 170 - p.hx * 25, c[1] + ny * 170 - p.hy * 25], 7);
      }

      // urban ground under the town
      const ux0 = TOWN[0] - 372, ux1 = TOWN[0] + 372;
      this.fillMaskRect(ux0, ux0, ux1, ux1, M_URBAN, true);
      // gravel under the training ground
      this.fillMaskRect(BASE[0] - 190, BASE[1] - 120, BASE[0] + 190, BASE[1] + 120, M_GRAVEL, true);

      for (const r of this.roads) {
        const val = r.kind === 'dirt' ? M_DIRT : M_ROAD;
        const hw = r.w / 2;
        const p = r.pts;
        r.bridge = new Uint8Array(p.length / 2);
        for (let i = 0; i < p.length - 2; i += 2) {
          this.stampSegment(p[i], p[i + 1], p[i + 2], p[i + 3], hw, val, r.kind === 'street' ? 0 : 4);
          r.bridge[i / 2] = this.heightAt((p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2) < 0.3 ? 1 : 0;
        }
        // culling chunks
        for (let i = 0; i < p.length / 2 - 1; i += 14) {
          const e = Math.min(p.length / 2 - 1, i + 14);
          let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
          for (let k = i; k <= e; k++) {
            minx = Math.min(minx, p[k * 2]);
            maxx = Math.max(maxx, p[k * 2]);
            miny = Math.min(miny, p[k * 2 + 1]);
            maxy = Math.max(maxy, p[k * 2 + 1]);
          }
          r.chunks.push({ i0: i, i1: e, minx: minx - r.w, miny: miny - r.w, maxx: maxx + r.w, maxy: maxy + r.w });
        }
      }
    }

    fillMaskRect(x0, y0, x1, y1, val, force) {
      const i0 = clamp(Math.floor(x0 / MRES), 0, MN - 1), i1 = clamp(Math.floor(x1 / MRES), 0, MN - 1);
      const j0 = clamp(Math.floor(y0 / MRES), 0, MN - 1), j1 = clamp(Math.floor(y1 / MRES), 0, MN - 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * MN + i;
          if (force || this.mask[k] === M_GRASS) this.mask[k] = val;
        }
      }
    }

    stampSegment(ax, ay, bx, by, hw, val, verge) {
      const r = hw + verge;
      const i0 = clamp(Math.floor((Math.min(ax, bx) - r) / MRES), 0, MN - 1);
      const i1 = clamp(Math.ceil((Math.max(ax, bx) + r) / MRES), 0, MN - 1);
      const j0 = clamp(Math.floor((Math.min(ay, by) - r) / MRES), 0, MN - 1);
      const j1 = clamp(Math.ceil((Math.max(ay, by) + r) / MRES), 0, MN - 1);
      const M = this.road;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = G.distSeg((i + 0.5) * MRES, (j + 0.5) * MRES, ax, ay, bx, by);
          const k = j * MN + i;
          if (d <= hw) {
            if (val === M_ROAD || M[k] !== M_ROAD) M[k] = val;
          } else if (d <= r && M[k] === 0) M[k] = M_VERGE;
        }
      }
    }

    nearestRoadPoint(x, y, filter) {
      let best = Infinity, out = null;
      for (const r of this.roads) {
        if (filter && !filter(r)) continue;
        const p = r.pts;
        for (let i = 0; i < p.length - 2; i += 2) {
          const d = G.distSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]);
          if (d < best) {
            best = d;
            const hx = p[i + 2] - p[i], hy = p[i + 3] - p[i + 1], l = Math.hypot(hx, hy) || 1;
            const ex = hx / l, ey = hy / l;
            const t = clamp((x - p[i]) * ex + (y - p[i + 1]) * ey, 0, l);
            out = { x: p[i] + ex * t, y: p[i + 1] + ey * t, hx: ex, hy: ey, w: r.w, road: r, d };
          }
        }
      }
      return out;
    }

    // ---------------------------------------------------------- fields ---
    genFields() {
      const rnd = this.rand;
      const centres = [[1000, 1000, 7], [1000, 3950, 7], [3900, 3900, 7], [FARM[0], FARM[1], 9], [1550, 2950, 4], [3450, 1400, 4], [3100, 3500, 3], [600, 1900, 3]];
      const types = ['wheat', 'plough', 'green', 'wheat', 'hay', 'green'];
      for (const [cx, cy, count] of centres) {
        let placed = 0;
        for (let tries = 0; tries < 60 && placed < count; tries++) {
          const ang = rnd() * Math.PI * 2, dist = 140 + rnd() * 380;
          const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist;
          const w = 110 + rnd() * 170, h = 80 + rnd() * 130, a = (rnd() - 0.5) * 0.9 + (rnd() < 0.5 ? 0 : Math.PI / 2);
          const r = Math.hypot(w, h) / 2;
          if (x < 450 + r || y < 450 + r || x > SIZE - 450 - r || y > SIZE - 450 - r) continue;
          if (Math.hypot(x - TOWN[0], y - TOWN[1]) < 560 + r) continue;
          if (Math.hypot(x - BASE[0], y - BASE[1]) < 480 + r) continue;
          let ok = true;
          for (const f of this.fields) if (Math.hypot(f.x - x, f.y - y) < (f.r + r) * 0.85) ok = false;
          const c = Math.cos(a), s = Math.sin(a);
          for (let u = -1; u <= 1 && ok; u++) {
            for (let v = -1; v <= 1 && ok; v++) {
              const px = x + (u * w * c) / 2 - (v * h * s) / 2, py = y + (u * w * s) / 2 + (v * h * c) / 2;
              const hh = this.heightAt(px, py);
              const g = this.gradientAt(px, py);
              if (hh < 1.5 || hh > 70 || Math.hypot(g[0], g[1]) > 0.16) ok = false;
            }
          }
          if (!ok) continue;
          const f = { x, y, w, h, a, r, type: types[Math.floor(rnd() * types.length)], id: this.fields.length };
          this.fields.push(f);
          placed++;
          // rasterise into the mask
          const i0 = clamp(Math.floor((x - r) / MRES), 0, MN - 1), i1 = clamp(Math.ceil((x + r) / MRES), 0, MN - 1);
          const j0 = clamp(Math.floor((y - r) / MRES), 0, MN - 1), j1 = clamp(Math.ceil((y + r) / MRES), 0, MN - 1);
          for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
              const dx = (i + 0.5) * MRES - x, dy = (j + 0.5) * MRES - y;
              const lu = dx * c + dy * s, lv = -dx * s + dy * c;
              const k = j * MN + i;
              if (Math.abs(lu) < w / 2 && Math.abs(lv) < h / 2 && this.mask[k] === M_GRASS && !this.road[k]) this.mask[k] = M_FIELD + f.id;
            }
          }
        }
      }
    }

    // -------------------------------------------------------- entities ---
    gridRange(b) {
      return [
        clamp(Math.floor(b.minx / CELL), 0, CN - 1), clamp(Math.floor(b.miny / CELL), 0, CN - 1),
        clamp(Math.floor(b.maxx / CELL), 0, CN - 1), clamp(Math.floor(b.maxy / CELL), 0, CN - 1),
      ];
    }
    gridInsert(e) {
      const r = (e.cr = this.gridRange(e.body));
      for (let j = r[1]; j <= r[3]; j++) {
        for (let i = r[0]; i <= r[2]; i++) {
          const k = j * CN + i;
          (this.cells[k] || (this.cells[k] = [])).push(e);
        }
      }
    }
    gridRemove(e) {
      const r = e.cr;
      if (!r) return;
      for (let j = r[1]; j <= r[3]; j++) {
        for (let i = r[0]; i <= r[2]; i++) {
          const c = this.cells[j * CN + i];
          if (!c) continue;
          const ix = c.indexOf(e);
          if (ix >= 0) {
            c[ix] = c[c.length - 1];
            c.pop();
          }
        }
      }
      e.cr = null;
    }
    gridMove(e) {
      const r = this.gridRange(e.body), o = e.cr;
      if (o && r[0] === o[0] && r[1] === o[1] && r[2] === o[2] && r[3] === o[3]) return;
      this.gridRemove(e);
      this.gridInsert(e);
    }
    /** Calls fn(entity) once for each entity whose cells overlap the box. */
    query(minx, miny, maxx, maxy, fn) {
      const q = ++this.qid;
      const i0 = clamp(Math.floor(minx / CELL), 0, CN - 1), i1 = clamp(Math.floor(maxx / CELL), 0, CN - 1);
      const j0 = clamp(Math.floor(miny / CELL), 0, CN - 1), j1 = clamp(Math.floor(maxy / CELL), 0, CN - 1);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = this.cells[j * CN + i];
          if (!c) continue;
          for (let k = 0; k < c.length; k++) {
            const e = c[k];
            if (e.q === q) continue;
            e.q = q;
            if (fn(e) === false) return;
          }
        }
      }
    }

    addEntity(kind, body, extra) {
      const d = DEF[kind] || {};
      const e = Object.assign({ id: this.nextId++, kind, body, alive: true, dyn: body.invM > 0, awake: false, hp: d.hp || 100, flash: 0, q: 0 }, extra || {});
      e.maxHp = e.hp;
      this.entities.push(e);
      this.gridInsert(e);
      return e;
    }
    addProp(kind, x, y, a) {
      const d = DEF[kind];
      const shape = d.r ? G.circleShape(d.r) : G.boxShape(d.w, d.h);
      const body = new G.Body({ x, y, a, shape, mass: d.mass, restitution: 0.2, friction: d.mu });
      return this.addEntity(kind, body, { tint: this.rand() });
    }
    addStatic(kind, x, y, w, h, a, extra) {
      const body = new G.Body({ x, y, a, shape: G.boxShape(w, h), mass: 0, friction: 0.6 });
      return this.addEntity(kind, body, Object.assign({ w, h }, extra));
    }
    addBuilding(x, y, w, h, a, o) {
      const area = w * h;
      return this.addStatic('building', x, y, w, h, a, {
        hp: clamp(area * 0.45, 120, 520),
        height: o.height,
        roof: o.roof,
        style: o.style,
        detail: this.rand(),
      });
    }

    /** True if a w×h rectangle at (x,y,a) is on free, buildable land. */
    canBuild(x, y, w, h, a, margin) {
      const c = Math.cos(a), s = Math.sin(a);
      for (let u = -1; u <= 1; u++) {
        for (let v = -1; v <= 1; v++) {
          const px = x + (u * (w / 2 + 1) * c) - v * (h / 2 + 1) * s;
          const py = y + (u * (w / 2 + 1) * s) + v * (h / 2 + 1) * c;
          const m = this.maskAt(px, py);
          if ((m !== M_GRASS && m !== M_URBAN && m !== M_GRAVEL) || this.roadAt(px, py)) return false;
          if (this.heightAt(px, py) < 1.5) return false;
        }
      }
      const g = this.gradientAt(x, y);
      if (Math.hypot(g[0], g[1]) > 0.3) return false;
      const r = Math.hypot(w, h) / 2 + margin;
      let free = true;
      this.query(x - r, y - r, x + r, y + r, (e) => {
        if (e.kind === 'tree') return;
        const b = e.body;
        if (b.maxx > x - r && b.minx < x + r && b.maxy > y - r && b.miny < y + r && Math.hypot(b.x - x, b.y - y) < r + b.radius * 0.8) {
          free = false;
          return false;
        }
      });
      return free;
    }

    // ------------------------------------------------------------- town --
    genTown() {
      const rnd = this.rand;
      const { x0, y0, step } = this.town;
      const flatRoofs = ['#8d8f93', '#a39e93', '#7b7f86', '#b0a99a', '#6f747b', '#9a8f80', '#83888c'];
      const tiles = ['#9b4b3a', '#a8563f', '#7a3b30', '#8a5a44', '#b06a4a'];
      for (let bj = 0; bj < 8; bj++) {
        for (let bi = 0; bi < 8; bi++) {
          const bx0 = x0 + bi * step + 8, by0 = y0 + bj * step + 8;
          const S = step - 16; // usable block size
          const cx = bx0 + S / 2, cy = by0 + S / 2;
          const dc = Math.hypot(cx - TOWN[0], cy - TOWN[1]);
          const tall = 1 - clamp(dc / 520, 0, 1);
          if (bi === 4 && bj === 3) {
            this.town.plaza = [cx, cy];
            continue; // central plaza (a target sits here)
          }
          const r = rnd();
          if (r < 0.12 && dc > 120) {
            this.fillMaskRect(bx0 + 2, by0 + 2, bx0 + S - 2, by0 + S - 2, M_PARK, true);
            continue;
          }
          if (r < 0.38) {
            const ins = 3 + rnd() * 8;
            this.addBuilding(cx, cy, S - ins * 2, S - ins * 2 - rnd() * 10, 0, {
              height: 10 + tall * 30 + rnd() * 10, roof: flatRoofs[Math.floor(rnd() * flatRoofs.length)], style: 'flat',
            });
            continue;
          }
          // four lots
          for (let ly = 0; ly < 2; ly++) {
            for (let lx = 0; lx < 2; lx++) {
              if (rnd() < 0.12) continue;
              const w = 18 + rnd() * 15, h = 18 + rnd() * 15;
              const set = 1 + rnd() * 3;
              const px = lx === 0 ? bx0 + set + w / 2 : bx0 + S - set - w / 2;
              const py = ly === 0 ? by0 + set + h / 2 : by0 + S - set - h / 2;
              const gable = tall < 0.35 && rnd() < 0.55;
              this.addBuilding(px, py, w, h, 0, {
                height: gable ? 7 + rnd() * 4 : 8 + tall * 22 + rnd() * 10,
                roof: gable ? tiles[Math.floor(rnd() * tiles.length)] : flatRoofs[Math.floor(rnd() * flatRoofs.length)],
                style: gable ? 'gable' : 'flat',
              });
            }
          }
        }
      }
    }

    genVillages() {
      const rnd = this.rand;
      const tiles = ['#9b4b3a', '#a8563f', '#7a3b30', '#5f6a73', '#8a5a44', '#b06a4a', '#6b5f55'];
      for (const c of VILLAGES) {
        for (const r of this.roads) {
          if (r.kind === 'street') continue;
          const p = r.pts;
          let acc = 0;
          for (let i = 0; i < p.length - 2; i += 2) {
            const sx = p[i + 2] - p[i], sy = p[i + 3] - p[i + 1], l = Math.hypot(sx, sy);
            acc += l;
            if (acc < 22) continue;
            acc = rnd() * 6;
            const mx = p[i], my = p[i + 1];
            if (Math.hypot(mx - c[0], my - c[1]) > 210) continue;
            const hx = sx / l, hy = sy / l, nx = -hy, ny = hx;
            for (const side of [-1, 1]) {
              if (rnd() < 0.25) continue;
              const w = 9 + rnd() * 5, d = 8 + rnd() * 4;
              const off = r.w / 2 + 5 + d / 2 + rnd() * 4;
              const x = mx + nx * off * side, y = my + ny * off * side;
              const a = Math.atan2(hy, hx);
              if (!this.canBuild(x, y, w, d, a, 2.5)) continue;
              this.addBuilding(x, y, w, d, a, { height: 6 + rnd() * 3, roof: tiles[Math.floor(rnd() * tiles.length)], style: 'gable' });
            }
          }
        }
      }
      // the farm
      const p = this.nearestRoadPoint(FARM[0] + 40, FARM[1] + 40);
      const a = Math.atan2(p.hy, p.hx), nx = -p.hy, ny = p.hx;
      const put = (along, side, w, h, o) => {
        const x = FARM[0] + p.hx * along + nx * side, y = FARM[1] + p.hy * along + ny * side;
        if (this.canBuild(x, y, w, h, a, 1)) this.addBuilding(x, y, w, h, a, o);
      };
      put(-30, 22, 14, 10, { height: 7, roof: '#8a3f32', style: 'gable' });
      put(10, 30, 28, 15, { height: 10, roof: '#6d6255', style: 'gable' });
      put(40, 26, 12, 8, { height: 5, roof: '#7d8085', style: 'flat' });
      put(10, -28, 24, 14, { height: 9, roof: '#7f4a35', style: 'gable' });
      const sx = FARM[0] + p.hx * 34 - nx * 24, sy = FARM[1] + p.hy * 34 - ny * 24;
      const silo = new G.Body({ x: sx, y: sy, a: 0, shape: G.ngonShape(4, 10), mass: 0 });
      this.addEntity('building', silo, { hp: 240, height: 16, roof: '#b9bcc0', style: 'silo', w: 8, h: 8, detail: 0.5 });
    }

    // --------------------------------------------------- training ground --
    genTraining() {
      const [bx, by] = BASE;
      const rnd = this.rand;
      // base buildings
      this.addBuilding(bx - 140, by - 70, 44, 24, 0, { height: 12, roof: '#6c7466', style: 'hangar' });
      this.addBuilding(bx - 140, by - 20, 44, 24, 0, { height: 12, roof: '#6c7466', style: 'hangar' });
      this.addBuilding(bx - 150, by + 50, 32, 11, 0, { height: 6, roof: '#7b7d72', style: 'flat' });
      this.addBuilding(bx - 150, by + 78, 32, 11, 0, { height: 6, roof: '#7b7d72', style: 'flat' });
      this.addBuilding(bx + 160, by - 100, 5, 5, 0, { height: 14, roof: '#5d5a52', style: 'flat' });

      // jersey barrier lines
      for (let i = 0; i < 9; i++) this.addProp('jersey', bx - 15 + i * 3.4, by - 95, 0);
      for (let i = 0; i < 7; i++) this.addProp('jersey', bx + 8 + i * 3.4, by - 112, 0);
      // slalom gates heading north
      for (let i = 0; i < 7; i++) {
        const y = by - 170 - i * 42, x = bx + (i % 2 ? 16 : -16);
        this.addProp('jersey', x - 1.8, y, Math.PI / 2 + 0.3);
        this.addProp('jersey', x + 1.8, y, Math.PI / 2 - 0.3);
        this.addProp('block', x, y + 6, 0);
      }
      // crate pyramid and crate wall
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4 - r; c++) this.addProp('crate', bx + 60 + c * 1.55 + r * 0.75, by - 40 + r * 1.55, 0);
      for (let i = 0; i < 12; i++) this.addProp('crate', bx + 95, by + 10 + i * 1.5, 0);
      for (let i = 0; i < 6; i++) this.addProp('crate', bx + 96.5, by + 14 + i * 1.5, 0);
      // barrel clusters
      for (const [ox, oy] of [[120, -60], [130, 50], [-20, 95], [40, 80]]) {
        for (let i = 0; i < 7; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.addProp('barrel', bx + ox + (i ? Math.cos(a) : 0) * 1.0, by + oy + (i ? Math.sin(a) : 0) * 1.0, 0);
        }
      }
      // concrete blocks: a little wall and a scattered field
      for (let i = 0; i < 8; i++) this.addProp('block', bx + 40 + i * 1.9, by + 50, 0);
      for (let i = 0; i < 5; i++) this.addProp('block', bx + 41 + i * 1.9, by + 48.1, 0);
      for (let i = 0; i < 10; i++) this.addProp('block', bx + 150 + rnd() * 30, by + 20 + rnd() * 70, rnd() * 3);
      // dragon's teeth line
      for (let i = 0; i < 14; i++) this.addStatic('teeth', bx - 100 + i * 5.5, by - 105, 1.5, 1.5, Math.PI / 4, {});
      // sandbag positions
      for (let i = 0; i < 6; i++) {
        const a = Math.PI + (i / 5) * Math.PI;
        this.addStatic('sandbag', bx - 60 + Math.cos(a) * 8, by + 40 + Math.sin(a) * 8, 3.4, 1.2, a + Math.PI / 2, {});
      }
      // brick compound with a gate
      const cx = bx + 70, cy = by - 220, W = 44, Hh = 32, seg = 4;
      for (let x = -W / 2 + seg / 2; x < W / 2; x += seg) {
        this.addStatic('wall', cx + x, cy - Hh / 2, seg, 0.6, 0, {});
        if (Math.abs(x) > 5) this.addStatic('wall', cx + x, cy + Hh / 2, seg, 0.6, 0, {});
      }
      for (let y = -Hh / 2 + seg / 2; y < Hh / 2; y += seg) {
        this.addStatic('wall', cx - W / 2, cy + y, seg, 0.6, Math.PI / 2, {});
        this.addStatic('wall', cx + W / 2, cy + y, seg, 0.6, Math.PI / 2, {});
      }
      for (let i = 0; i < 9; i++) this.addProp('crate', cx - 8 + (i % 3) * 1.5, cy - 4 + Math.floor(i / 3) * 1.5, 0);
      this.addProp('barrel', cx + 10, cy + 2, 0);
      this.addProp('barrel', cx + 11, cy + 3, 0);
      this.addBuilding(cx + 12, cy - 8, 12, 8, 0, { height: 5, roof: '#8b8478', style: 'flat' });
    }

    roadblock(x, y, props) {
      const p = this.nearestRoadPoint(x, y, (r) => r.kind !== 'street');
      const nx = -p.hy, ny = p.hx, a = Math.atan2(ny, nx), half = p.w / 2;
      for (let s = -half + 1.7; s < 0; s += 3.3) this.addProp('jersey', p.x + nx * s, p.y + ny * s, a);
      for (let s = half - 1.7; s > 0; s -= 3.3) this.addProp('jersey', p.x + nx * s + p.hx * 16, p.y + ny * s + p.hy * 16, a);
      const rnd = this.rand;
      for (let i = 0; i < (props || 4); i++) {
        const side = rnd() < 0.5 ? -1 : 1, along = rnd() * 16;
        const off = (half + 2 + rnd() * 3) * side;
        this.addProp(rnd() < 0.5 ? 'barrel' : 'crate', p.x + nx * off + p.hx * along, p.y + ny * off + p.hy * along, rnd() * 3);
      }
    }

    genRoadblocks() {
      const d = 410;
      this.roadblock(TOWN[0] - d, TOWN[1], 5);
      this.roadblock(TOWN[0] + d, TOWN[1], 5);
      this.roadblock(TOWN[0], TOWN[1] - d, 5);
      this.roadblock(TOWN[0], TOWN[1] + d, 5);
      for (const c of VILLAGES) this.roadblock(c[0] + 150, c[1] + 60, 6);
      // a few bridge checkpoints
      let n = 0;
      for (const r of this.roads) {
        if (r.kind === 'street' || n >= 3) continue;
        for (let i = 0; i < r.bridge.length; i++) {
          if (r.bridge[i]) {
            const k = Math.max(0, i - 6) * 2;
            this.roadblock(r.pts[k], r.pts[k + 1], 3);
            n++;
            break;
          }
        }
      }
    }

    genTargets() {
      const spots = [];
      for (let i = 0; i < 6; i++) spots.push([BASE[0] - 100 + i * 40, BASE[1] - 430 - (i % 2) * 50]);
      spots.push(this.town.plaza);
      spots.push([1040, 1040], [1040, 3990], [3940, 3860], [FARM[0] + 60, FARM[1] - 50]);
      spots.push([800, 700], [4200, 1500], [3600, 4300], [3420, 2750]);
      for (const [sx, sy] of spots) {
        let done = false;
        for (let r = 0; r < 90 && !done; r += 4) {
          for (let k = 0; k < 8 && !done; k++) {
            const a = (k / 8) * Math.PI * 2 + r;
            const x = sx + Math.cos(a) * r, y = sy + Math.sin(a) * r;
            if (this.roadAt(x, y) || this.heightAt(x, y) < 1.5) continue;
            if (!this.canBuild(x, y, 2.6, 2.6, 0, 4)) continue;
            const body = new G.Body({ x, y, a: 0, shape: G.circleShape(1.3), mass: 0 });
            this.addEntity('target', body, {});
            this.stats.targetsTotal++;
            done = true;
          }
        }
      }
    }

    genTrees() {
      const rnd = this.rand;
      const step = 11;
      const s4 = new Float32Array(4);
      const clearZones = [[BASE[0], BASE[1], 260], [BASE[0], BASE[1] - 330, 190]];
      for (let y = step / 2; y < SIZE; y += step) {
        for (let x = step / 2; x < SIZE; x += step) {
          const px = x + (rnd() - 0.5) * step * 0.95, py = y + (rnd() - 0.5) * step * 0.95;
          const m = this.maskAt(px, py);
          if (this.roadAt(px, py)) continue;
          let dens;
          this.sample(px, py, s4);
          const h = s4[0];
          if (m === M_PARK) dens = 0.3;
          else if (m !== M_GRASS) continue;
          else {
            dens = smoothstep(0.02, 0.2, s4[3]) * 0.95 + 0.015;
            const d = Math.min(px, py, SIZE - px, SIZE - py);
            if (d < 450) dens = Math.max(dens, 0.55 * (1 - d / 450));
            dens *= 1 - smoothstep(85, 110, h);
          }
          if (rnd() > dens) continue;
          if (h < 1.6 || s4[1] * s4[1] + s4[2] * s4[2] > 0.36) continue;
          let clear = true;
          for (const z of clearZones) if (Math.hypot(px - z[0], py - z[1]) < z[2]) clear = false;
          if (!clear) continue;
          const canopy = dens > 0.45 ? 3.3 + rnd() * 2.9 : 2.4 + rnd() * 2.3;
          let blocked = false;
          this.query(px - 3, py - 3, px + 3, py + 3, (e) => {
            if (e.kind === 'tree') return;
            const b = e.body;
            if (px > b.minx - 3 && px < b.maxx + 3 && py > b.miny - 3 && py < b.maxy + 3) {
              blocked = true;
              return false;
            }
          });
          if (blocked) continue;
          const conifer = rnd() < (h > 45 ? 0.75 : 0.22);
          const body = new G.Body({ x: px, y: py, a: 0, shape: G.circleShape(0.45 + canopy * 0.07), mass: 0, friction: 0.6 });
          this.addEntity('tree', body, { canopy, conifer, variant: Math.floor(rnd() * 4), rot: rnd() * 6.28 });
        }
      }
    }

    // ------------------------------------------------------- simulation --
    wake(e) {
      if (!e.dyn || e.awake || !e.alive) return;
      e.awake = true;
      e.sleep = 0;
      this.awake.push(e);
    }

    /** One fixed simulation step. */
    step(dt, input) {
      this.time += dt;
      this.dt = dt;
      const tank = this.tank;
      tank.applyForces(dt, input, this);
      tank.body.integrate(dt);
      const awake = this.awake.slice();
      for (const e of awake) {
        const b = e.body;
        // ground friction on props sliding over the terrain
        const sp = Math.hypot(b.vx, b.vy), dv = 9.81 * DEF[e.kind].mu * dt;
        if (sp <= dv) {
          b.vx = 0;
          b.vy = 0;
        } else {
          b.vx *= 1 - dv / sp;
          b.vy *= 1 - dv / sp;
        }
        const dw = (dv * 2.5) / Math.max(0.5, b.radius);
        b.w = Math.abs(b.w) <= dw ? 0 : b.w - Math.sign(b.w) * dw;
        b.integrate(dt);
      }
      // collisions
      const list = [];
      this.gather(this.tankEnt, list);
      for (const e of awake) if (e.alive) this.gather(e, list);
      G.solveContacts(list, 6);
      for (const m of list) {
        // heavy impacts crush light props
        for (const e of [m.ea, m.eb]) {
          if (!e.dyn || e.kind === 'tank' || !e.alive) continue;
          const dv = m.impulse * e.body.invM;
          const crush = DEF[e.kind].crush;
          if (dv > crush) this.damage(e, (dv - crush) * 9, m.nx, m.ny);
        }
      }
      this.keepInside(tank.body);
      for (const e of awake) {
        if (!e.alive) continue;
        const b = e.body;
        this.keepInside(b);
        this.gridMove(e);
        if (Math.abs(b.vx) + Math.abs(b.vy) < 0.04 && Math.abs(b.w) < 0.04) {
          e.sleep += dt;
          if (e.sleep > 0.6) {
            b.vx = b.vy = b.w = 0;
            e.awake = false;
            const ix = this.awake.indexOf(e);
            if (ix >= 0) this.awake.splice(ix, 1);
          }
        } else e.sleep = 0;
      }
      tank.afterStep();
      this.stepShells(dt);
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const p = this.pending[i];
        p.t -= dt;
        if (p.t <= 0) {
          this.pending.splice(i, 1);
          this.explode(p.x, p.y, p.opts);
        }
      }
    }

    gather(e, list) {
      const b = e.body;
      const isTank = e.kind === 'tank';
      this.query(b.minx - 0.2, b.miny - 0.2, b.maxx + 0.2, b.maxy + 0.2, (o) => {
        if (o === e || !o.alive) return;
        if (!isTank && o.dyn && o.awake && o.id < e.id) return; // handled from o
        const m = G.collide(b, o.body);
        if (!m) return;
        if (o.kind === 'tree' && (isTank || e.dyn)) {
          // ram trees over
          // a fast hit snaps it; a tank leaning on it for a moment pushes it over
          const vn = b.vx * m.nx + b.vy * m.ny;
          if (isTank) o.push = (o.push || 0) + this.dt;
          if (vn > (isTank ? 2.2 : 9) || o.push > 0.7) {
            this.destroy(o, m.nx, m.ny);
            b.vx *= 0.9;
            b.vy *= 0.9;
            return;
          }
        }
        if (o.dyn) this.wake(o);
        m.A = b;
        m.B = o.body;
        m.ea = e;
        m.eb = o;
        m.impulse = 0;
        list.push(m);
      });
    }

    keepInside(b) {
      const lo = 2, hi = SIZE - 2;
      let hit = false;
      if (b.minx < lo) { b.x += lo - b.minx; b.vx = Math.abs(b.vx) * 0.2; hit = true; }
      if (b.maxx > hi) { b.x -= b.maxx - hi; b.vx = -Math.abs(b.vx) * 0.2; hit = true; }
      if (b.miny < lo) { b.y += lo - b.miny; b.vy = Math.abs(b.vy) * 0.2; hit = true; }
      if (b.maxy > hi) { b.y -= b.maxy - hi; b.vy = -Math.abs(b.vy) * 0.2; hit = true; }
      if (hit) b.update();
    }

    // ----------------------------------------------------------- shells --
    spawnShell(x, y, vx, vy, life) {
      this.shells.push({ x, y, vx, vy, life, px: x, py: y });
      this.stats.shots++;
      this.events.push({ type: 'fire', x, y });
    }

    stepShells(dt) {
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const s = this.shells[i];
        const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
        let best = 2, hit = null;
        this.query(Math.min(s.x, nx) - 2, Math.min(s.y, ny) - 2, Math.max(s.x, nx) + 2, Math.max(s.y, ny) + 2, (e) => {
          if (!e.alive) return;
          const t = G.raycastBody(s.x, s.y, nx, ny, e.body);
          if (t >= 0 && t < best) {
            best = t;
            hit = e;
          }
        });
        s.px = s.x;
        s.py = s.y;
        s.life -= dt;
        const sp = Math.hypot(s.vx, s.vy), dx = s.vx / sp, dy = s.vy / sp;
        if (hit) {
          const hx = s.x + (nx - s.x) * best, hy = s.y + (ny - s.y) * best;
          this.shells.splice(i, 1);
          this.stats.hits++;
          this.explode(hx, hy, { hit, dx, dy });
          continue;
        }
        s.x = nx;
        s.y = ny;
        if (nx < 0 || ny < 0 || nx > SIZE || ny > SIZE) {
          this.shells.splice(i, 1);
        } else if (s.life <= 0) {
          this.shells.splice(i, 1);
          this.explode(nx, ny, { dx, dy, ground: true });
        }
      }
    }

    damage(e, amount, dx, dy) {
      if (!e.alive) return;
      e.hp -= amount;
      e.flash = 0.18;
      if (e.hp <= 0) this.destroy(e, dx || 0, dy || 0);
    }

    destroy(e, dx, dy) {
      if (!e.alive) return;
      e.alive = false;
      this.gridRemove(e);
      if (e.awake) {
        const ix = this.awake.indexOf(e);
        if (ix >= 0) this.awake.splice(ix, 1);
        e.awake = false;
      }
      const b = e.body;
      this.stats.destroyed++;
      const rnd = Math.random;
      switch (e.kind) {
        case 'tree': {
          this.stats.trees++;
          const a = dx || dy ? Math.atan2(dy, dx) + (rnd() - 0.5) * 0.6 : rnd() * 6.28;
          this.addDecal({ type: 'log', x: b.x, y: b.y, a, len: e.canopy * 2.1, r: b.radius, conifer: e.conifer, canopy: e.canopy });
          for (let i = 0; i < 14; i++) this.particle(4, b.x + Math.cos(a) * e.canopy, b.y + Math.sin(a) * e.canopy, (rnd() - 0.5) * 6, (rnd() - 0.5) * 6, 1.4, 0.35, e.conifer ? '#2f5a34' : '#4f7d32');
          this.events.push({ type: 'crash', x: b.x, y: b.y, vol: 0.4 });
          break;
        }
        case 'building': {
          this.stats.buildings++;
          const verts = b.shape.type === 'poly' ? Array.from(b.wv) : null;
          this.addDecal({ type: 'rubble', x: b.x, y: b.y, a: b.a, verts, w: e.w, h: e.h, seed: e.id, color: e.roof });
          this.emitters.push({ x: b.x, y: b.y, t: 26, r: Math.min(e.w, e.h) * 0.35 });
          for (let i = 0; i < 40; i++) {
            const a = rnd() * 6.28, s = 4 + rnd() * 14;
            this.particle(3, b.x + (rnd() - 0.5) * e.w * 0.6, b.y + (rnd() - 0.5) * e.h * 0.6, Math.cos(a) * s, Math.sin(a) * s, 1.5 + rnd(), 0.4 + rnd() * 0.6, rnd() < 0.5 ? e.roof : '#8f8a80');
          }
          for (let i = 0; i < 26; i++) this.particle(0, b.x + (rnd() - 0.5) * e.w, b.y + (rnd() - 0.5) * e.h, (rnd() - 0.5) * 5, (rnd() - 0.5) * 5, 3 + rnd() * 3, 5 + rnd() * 5, '#9a958c');
          this.events.push({ type: 'collapse', x: b.x, y: b.y, e });
          break;
        }
        case 'barrel':
          this.pending.push({ t: 0.08 + rnd() * 0.15, x: b.x, y: b.y, opts: { big: true } });
          break;
        case 'target':
          this.stats.targets++;
          this.particle(5, b.x, b.y - 3, 0, -4, 1.6, 1, '#ffd166', '+1 TARGET');
          this.events.push({ type: 'target', x: b.x, y: b.y });
          this.addDecal({ type: 'target', x: b.x, y: b.y, a: rnd() * 6 });
          break;
        default: {
          const col = e.kind === 'crate' ? '#9a6b3c' : e.kind === 'wall' ? '#8e4b38' : e.kind === 'sandbag' ? '#b49e74' : '#a7a69f';
          const n = e.kind === 'crate' ? 12 : 9;
          for (let i = 0; i < n; i++) {
            const a = rnd() * 6.28, s = 3 + rnd() * 9;
            this.particle(3, b.x, b.y, Math.cos(a) * s + dx * 4, Math.sin(a) * s + dy * 4, 1.0 + rnd(), 0.25 + rnd() * 0.35, col);
          }
          this.particle(0, b.x, b.y, 0, 0, 2.5, 2.5, '#a8a49a');
          this.addDecal({ type: 'debris', x: b.x, y: b.y, a: b.a, w: (DEF[e.kind].w || e.w || 1.5) * 1.1, h: (DEF[e.kind].h || e.h || 1.5) * 1.3, color: col, seed: e.id });
          this.events.push({ type: 'crash', x: b.x, y: b.y, vol: 0.5 });
        }
      }
    }

    explode(x, y, o) {
      o = o || {};
      const big = !!o.big;
      const radius = big ? 11 : 7, splash = big ? 60 : 35, imp = big ? 9000 : 4200;
      if (o.hit) {
        const e = o.hit;
        if (e.dyn) {
          this.wake(e);
          e.body.applyImpulse(o.dx * imp * 0.8, o.dy * imp * 0.8, x, y);
        }
        this.damage(e, 70, o.dx, o.dy);
      }
      this.query(x - radius - 4, y - radius - 4, x + radius + 4, y + radius + 4, (e) => {
        if (!e.alive || e === o.hit) return;
        const b = e.body;
        const d = Math.max(0, Math.hypot(b.x - x, b.y - y) - b.radius * 0.6);
        if (d >= radius) return;
        const f = 1 - d / radius;
        const ax = (b.x - x) / (d + 0.5), ay = (b.y - y) / (d + 0.5), l = Math.hypot(ax, ay) || 1;
        if (e.dyn) {
          this.wake(e);
          b.applyImpulse((ax / l) * imp * f, (ay / l) * imp * f, b.x + (Math.random() - 0.5) * 0.6, b.y + (Math.random() - 0.5) * 0.6);
        }
        this.damage(e, splash * f, ax / l, ay / l);
      });
      const tb = this.tank.body, td = Math.hypot(tb.x - x, tb.y - y);
      if (td < radius + 4) {
        const f = 1 - td / (radius + 4);
        tb.applyImpulse(((tb.x - x) / (td + 0.1)) * imp * 3 * f, ((tb.y - y) / (td + 0.1)) * imp * 3 * f, tb.x, tb.y);
      }
      // effects
      const water = this.heightAt(x, y) < 0 && this.roadAt(x, y) !== M_ROAD;
      const rnd = Math.random;
      const k = big ? 1.6 : 1;
      this.particle(6, x, y, 0, 0, 0.22, big ? 8 : 5, '#ffcf7a');
      if (water) {
        for (let i = 0; i < 24; i++) {
          const a = rnd() * 6.28, s = rnd() * 8;
          this.particle(0, x, y, Math.cos(a) * s, Math.sin(a) * s, 1.2 + rnd(), 1 + rnd() * 2, '#dfeef5');
        }
      } else {
        for (let i = 0; i < 16 * k; i++) {
          const a = rnd() * 6.28, s = rnd() * 9 * k;
          this.particle(1, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + rnd() * 0.35, 2.2 * k + rnd() * 2, '#ffa040');
        }
        for (let i = 0; i < 18 * k; i++) {
          const a = rnd() * 6.28, s = rnd() * 6 * k;
          this.particle(0, x, y, Math.cos(a) * s, Math.sin(a) * s, 1.8 + rnd() * 2.5, 2 + rnd() * 3 * k, rnd() < 0.5 ? '#6b6660' : '#8d8880');
        }
        for (let i = 0; i < 14 * k; i++) {
          const a = rnd() * 6.28, s = 10 + rnd() * 30;
          this.particle(2, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.2 + rnd() * 0.35, 0.15, '#ffd27a');
        }
        if (!o.hit || o.hit.kind !== 'building') this.addDecal({ type: 'scorch', x, y, r: (big ? 4.5 : 2.8) * (0.8 + rnd() * 0.4), a: rnd() * 6.28 });
        if (big) this.emitters.push({ x, y, t: 6, r: 1.2 });
      }
      this.events.push({ type: 'explosion', x, y, big, water });
    }

    muzzleBlast(x, y, dx, dy, vx, vy) {
      const rnd = Math.random;
      this.particle(6, x + dx * 1.5, y + dy * 1.5, vx, vy, 0.12, 6, '#ffe7a8');
      for (let i = 0; i < 6; i++) this.particle(1, x + dx * (1 + i * 0.6), y + dy * (1 + i * 0.6), dx * 20 + vx, dy * 20 + vy, 0.12 + rnd() * 0.08, 1.3, '#ffb347');
      for (let i = 0; i < 14; i++) {
        const s = rnd() * 16, side = (rnd() - 0.5) * 12;
        this.particle(0, x, y, dx * s - dy * side + vx, dy * s + dx * side + vy, 1.2 + rnd() * 1.6, 1.2 + rnd() * 1.5, '#cfcac0');
      }
    }

    // ---------------------------------------------------- particles etc --
    /** kind: 0 smoke, 1 fire, 2 spark, 3 debris, 4 leaf, 5 text, 6 flash, 7 dust */
    particle(kind, x, y, vx, vy, life, size, color, text) {
      if (this.particles.length > 2200) this.particles.shift();
      this.particles.push({ kind, x, y, vx, vy, life, max: life, size, color, text, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10 });
    }

    addDecal(d) {
      this.decals.push(d);
      if (this.decals.length > 900) {
        const ix = this.decals.findIndex((q) => q.type === 'scorch' || q.type === 'debris');
        this.decals.splice(ix >= 0 ? ix : 0, 1);
      }
    }

    /** Per-frame visual effects (not part of the fixed physics step). */
    updateEffects(dt) {
      const P = this.particles;
      let w = 0;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        const drag = p.kind === 2 ? 1.5 : p.kind === 3 ? 2.2 : p.kind === 0 || p.kind === 7 ? 1.4 : 3;
        p.vx -= p.vx * drag * dt;
        p.vy -= p.vy * drag * dt;
        if (p.kind === 0) {
          p.vx += 0.9 * dt; // light breeze
          p.vy -= 0.4 * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        P[w++] = p;
      }
      P.length = w;
      for (let i = this.emitters.length - 1; i >= 0; i--) {
        const em = this.emitters[i];
        em.t -= dt;
        if (em.t <= 0) {
          this.emitters.splice(i, 1);
          continue;
        }
        const rate = Math.min(1, em.t / 6);
        if (Math.random() < 14 * dt * rate) this.particle(0, em.x + (Math.random() - 0.5) * em.r * 2, em.y + (Math.random() - 0.5) * em.r * 2, 0.5, -0.3, 4 + Math.random() * 3, 3 + Math.random() * 3, '#4f4b47');
        if (Math.random() < 18 * dt * rate) this.particle(1, em.x + (Math.random() - 0.5) * em.r * 2, em.y + (Math.random() - 0.5) * em.r * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.4, 1.2 + Math.random() * 1.6 * Math.max(1, em.r * 0.3), '#ff9a3a');
      }
      for (const e of this.awake) if (e.flash > 0) e.flash -= dt;
      this.trackEffects(dt);
    }

    trackEffects(dt) {
      const t = this.tank, b = t.body;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const surf = t.surface;
      const moving = t.speed > 0.4 || Math.abs(b.w) > 0.15;
      for (let side = 0; side < 2; side++) {
        const ly = side === 0 ? -G.TANK.trackY : G.TANK.trackY;
        const lx = -2.9;
        const px = b.x + lx * c - ly * s, py = b.y + lx * s + ly * c;
        const water = surf && (surf === SURF.water || surf === SURF.deep);
        this.marks[side].add(px, py, !moving || water, surf === SURF.road || surf === SURF.urban ? 0.5 : 1);
        if (surf && surf.dust && t.speed > 2.5 && Math.random() < surf.dust * dt * (6 + t.speed)) {
          this.particle(7, px - c * 0.5, py - s * 0.5, -c * 2 + (Math.random() - 0.5) * 2, -s * 2 + (Math.random() - 0.5) * 2, 1.2 + Math.random(), 1.4 + t.speed * 0.08, surf === SURF.field ? '#a89466' : '#b3a68a');
        }
        if (water && t.speed > 1.2 && Math.random() < dt * 20) {
          this.particle(0, px + c * 3, py + s * 3, -s * (side ? 3 : -3), c * (side ? 3 : -3), 0.8, 1.2, '#e8f2f6');
        }
      }
      // exhaust
      const thr = Math.abs(t.throttle[0]) + Math.abs(t.throttle[1]);
      if (Math.random() < dt * (3 + thr * 10)) {
        const ex = b.x - 3.4 * c, ey = b.y - 3.4 * s;
        this.particle(0, ex + s * 0.8, ey - c * 0.8, -c * 2 + b.vx * 0.5, -s * 2 + b.vy * 0.5, 0.9 + thr * 0.5, 0.6 + thr * 0.3, '#5b5955');
      }
    }
  }

  /** Ring buffer of track-mark points. */
  class MarkTrail {
    constructor(cap) {
      this.cap = cap;
      this.x = new Float32Array(cap);
      this.y = new Float32Array(cap);
      this.b = new Uint8Array(cap); // 1 = gap before this point
      this.s = new Float32Array(cap); // strength
      this.head = 0;
      this.n = 0;
      this.lx = NaN;
      this.ly = NaN;
      this.gap = true;
    }
    add(x, y, gap, strength) {
      if (gap) {
        this.gap = true;
        return;
      }
      const d = Math.hypot(x - this.lx, y - this.ly);
      if (!(d > 0.7)) {
        if (d === d) return;
      }
      const i = this.head;
      this.x[i] = x;
      this.y[i] = y;
      this.b[i] = this.gap || d > 4 ? 1 : 0;
      this.s[i] = strength;
      this.gap = false;
      this.lx = x;
      this.ly = y;
      this.head = (i + 1) % this.cap;
      if (this.n < this.cap) this.n++;
    }
  }

  G.World = World;
  G.SURF = SURF;
})();
