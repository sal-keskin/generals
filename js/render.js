/* Tank Lab — Canvas 2D renderer: terrain tiles, roads, props, tank, effects
 * and the minimap. Everything is drawn in world metres via one transform.
 */
'use strict';
(function () {
  const G = window.G;
  const { clamp, smoothstep } = G;
  const { SIZE } = G.WORLD;
  const M = G.MASK;
  const CHUNK = 128; // metres per terrain tile
  const CPX = 256; // pixels per terrain tile (2 px/m)
  const PXM = 48; // asset rasterisation density (px per metre)

  const FIELD_RGB = {
    wheat: [208, 182, 100],
    plough: [124, 94, 64],
    green: [110, 152, 64],
    hay: [186, 172, 96],
  };

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  class Renderer {
    constructor(canvas, world) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.world = world;
      this.chunks = new Map();
      this.frame = 0;
      this.s4 = new Float32Array(4);
      this.rgb = new Float32Array(3);
      this.assets = {};
      this.makeSprites();
      this.loadAssets();
    }

    // ---------------------------------------------------------- assets --
    loadAssets() {
      const load = (name, src, wm, hm) => {
        const img = new Image();
        img.onload = () => {
          const c = makeCanvas(Math.round(wm * PXM), Math.round(hm * PXM));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          this.assets[name] = c;
        };
        img.src = src;
      };
      load('hull', 'assets/tank-hull.svg', 7, 2.7);
      load('turret', 'assets/tank-turret.svg', 3.4, 2.6);
      load('barrel', 'assets/tank-barrel.svg', 4.6, 0.4);
    }

    makeSprites() {
      const rnd = G.rng(42);
      // soft round sprites for smoke/fire/flash, tinted per colour on demand
      this.soft = new Map();
      // tree canopies: unit radius drawn into 128px
      this.trees = [];
      const palettes = [
        ['#2f5a24', '#3d7330', '#4f8a3a', '#6aa24a'],
        ['#355f2a', '#467a33', '#5b9140', '#7aae58'],
        ['#2c5322', '#3b6b2c', '#527f36', '#6f9a46'],
        ['#3a5c26', '#4d7631', '#64903f', '#86a95a'],
      ];
      for (let v = 0; v < 4; v++) {
        const c = makeCanvas(128, 128), x = c.getContext('2d'), pal = palettes[v];
        for (let layer = 0; layer < 4; layer++) {
          const n = 7 - layer;
          for (let i = 0; i < n; i++) {
            const a = rnd() * 6.28, d = (1 - layer * 0.22) * 34 * rnd();
            const r = 30 - layer * 5 + rnd() * 8;
            const cx = 64 + Math.cos(a) * d - layer * 3, cy = 64 + Math.sin(a) * d - layer * 3;
            const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
            g.addColorStop(0, pal[Math.min(3, layer + 1)]);
            g.addColorStop(1, pal[layer]);
            x.fillStyle = g;
            x.beginPath();
            x.arc(cx, cy, r, 0, 6.28);
            x.fill();
          }
        }
        this.trees.push(c);
      }
      this.conifers = [];
      for (let v = 0; v < 2; v++) {
        const c = makeCanvas(128, 128), x = c.getContext('2d');
        const cols = v ? ['#1f3f27', '#2a5232', '#386641', '#4a7a50'] : ['#22422a', '#2d5636', '#3b6b44', '#517f55'];
        for (let layer = 0; layer < 4; layer++) {
          const R = 62 - layer * 14, n = 11;
          x.fillStyle = cols[layer];
          x.beginPath();
          for (let i = 0; i <= n * 2; i++) {
            const a = (i / (n * 2)) * 6.283 + layer * 0.3;
            const r = i % 2 ? R * 0.62 : R;
            x.lineTo(64 + Math.cos(a) * r - layer * 2, 64 + Math.sin(a) * r - layer * 2);
          }
          x.fill();
        }
        x.fillStyle = '#5c4630';
        x.beginPath();
        x.arc(60, 60, 4, 0, 6.28);
        x.fill();
        this.conifers.push(c);
      }
      const sh = makeCanvas(64, 64), sx = sh.getContext('2d');
      const g = sx.createRadialGradient(32, 32, 4, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.42)');
      g.addColorStop(0.7, 'rgba(0,0,0,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      sx.fillStyle = g;
      sx.fillRect(0, 0, 64, 64);
      this.shadowSprite = sh;
      const sc = makeCanvas(64, 64), cx = sc.getContext('2d');
      const g2 = cx.createRadialGradient(32, 32, 2, 32, 32, 32);
      g2.addColorStop(0, 'rgba(20,18,15,0.85)');
      g2.addColorStop(0.5, 'rgba(25,22,18,0.55)');
      g2.addColorStop(1, 'rgba(30,25,20,0)');
      cx.fillStyle = g2;
      cx.fillRect(0, 0, 64, 64);
      this.scorchSprite = sc;
      // fine ground detail texture, multiplied over the terrain
      const dt = makeCanvas(128, 128), dx = dt.getContext('2d');
      const id = dx.createImageData(128, 128);
      for (let i = 0; i < 128 * 128; i++) {
        const v = 255 - Math.pow(rnd(), 3) * 70;
        id.data[i * 4] = v;
        id.data[i * 4 + 1] = v;
        id.data[i * 4 + 2] = v - 4;
        id.data[i * 4 + 3] = 255;
      }
      dx.putImageData(id, 0, 0);
      this.detail = dt;
    }

    softSprite(color) {
      let s = this.soft.get(color);
      if (s) return s;
      s = makeCanvas(64, 64);
      const x = s.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, color);
      g.addColorStop(0.45, color + 'aa');
      g.addColorStop(1, color + '00');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      this.soft.set(color, s);
      return s;
    }

    // --------------------------------------------------------- terrain --
    /** Terrain colour (with lighting) at a world point → this.rgb. */
    terrainRGB(x, y, fine) {
      const w = this.world, s = w.sample(x, y, this.s4), out = this.rgb;
      const h = s[0], gx = s[1], gy = s[2], forest = s[3];
      const m = w.maskAt(x, y);
      let r, g, b, lit = true;
      const n1 = fine ? w.noise.noise(x / 37, y / 37) : 0;
      if (h < 0) {
        const t = smoothstep(0, 9, -h);
        r = 78 - 50 * t;
        g = 138 - 74 * t;
        b = 150 - 52 * t;
        if (h > -0.7) {
          r += 30;
          g += 30;
          b += 24;
        }
        lit = false;
        if (fine) {
          const rip = w.noise.noise(x / 6 + y / 13, y / 5) * 6;
          r += rip;
          g += rip;
          b += rip;
        }
      } else if (m === M.M_URBAN) {
        r = 152; g = 150; b = 144;
        if (fine && ((x % 6) < 0.5 || (y % 6) < 0.5)) {
          r -= 14; g -= 14; b -= 14;
        }
      } else if (m === M.M_GRAVEL) {
        r = 166 + n1 * 14; g = 156 + n1 * 14; b = 134 + n1 * 12;
      } else if (m >= M.M_FIELD && m !== 255) {
        const f = w.fields[m - M.M_FIELD];
        const c = FIELD_RGB[f.type];
        const ca = Math.cos(f.a), sa = Math.sin(f.a);
        const v = -(x - f.x) * sa + (y - f.y) * ca;
        const stripe = 1 + 0.09 * Math.sin(v * 2.1);
        r = c[0] * stripe + n1 * 8; g = c[1] * stripe + n1 * 8; b = c[2] * stripe;
      } else if (h < 1.3) {
        r = 198; g = 184; b = 138;
      } else {
        // grass: patchy, drier on hills, darker in forests
        const dry = smoothstep(20, 70, h);
        r = 92 + n1 * 12 + dry * 22;
        g = 128 + n1 * 14 + dry * 6;
        b = 60 + n1 * 6 + dry * 8;
        const fd = smoothstep(0.0, 0.22, forest);
        r -= fd * 30; g -= fd * 30; b -= fd * 16;
        if (m === M.M_PARK) {
          r = 96; g = 142; b = 66;
        }
        const slope = Math.sqrt(gx * gx + gy * gy);
        const rock = Math.max(smoothstep(0.32, 0.6, slope), smoothstep(80, 105, h));
        r += (132 - r) * rock; g += (124 - g) * rock; b += (112 - b) * rock;
        const snow = smoothstep(108, 130, h);
        r += (236 - r) * snow; g += (240 - g) * snow; b += (244 - b) * snow;
      }
      if (lit) {
        // hill shading, light from the north-west
        const nl = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const lam = (0.55 * gx + 0.6 * gy + 0.58) * nl;
        let k = clamp(1 + (lam / 0.58 - 1) * 0.6, 0.62, 1.25);
        // contour lines every 10 m (heavier every 50 m)
        if (fine && h > 0 && m !== M.M_URBAN) {
          const f10 = h / 10, dd = Math.abs(f10 - Math.round(f10)) * 10;
          const gm = Math.max(0.03, Math.sqrt(gx * gx + gy * gy));
          const dist = dd / gm;
          if (dist < 0.9) {
            const major = Math.round(f10) % 5 === 0;
            k *= 1 - (major ? 0.2 : 0.1) * (1 - smoothstep(0.2, 0.9, dist));
          }
        }
        r *= k; g *= k; b *= k;
      }
      if (x < 0 || y < 0 || x > SIZE || y > SIZE) {
        // outside the playable area: dim and desaturate
        const l = (r + g + b) / 3;
        r = (r * 0.5 + l * 0.5) * 0.72;
        g = (g * 0.5 + l * 0.5) * 0.72;
        b = (b * 0.5 + l * 0.5) * 0.76;
      }
      out[0] = r;
      out[1] = g;
      out[2] = b;
      return out;
    }

    buildChunk(cx, cy) {
      const c = makeCanvas(CPX, CPX), x = c.getContext('2d');
      const img = x.createImageData(CPX, CPX), d = img.data;
      const sc = CHUNK / CPX;
      let k = 0;
      for (let py = 0; py < CPX; py++) {
        const wy = cy * CHUNK + (py + 0.5) * sc;
        for (let px = 0; px < CPX; px++) {
          const wx = cx * CHUNK + (px + 0.5) * sc;
          const rgb = this.terrainRGB(wx, wy, true);
          const grain = 1 + (G.hash2((wx * 2) | 0, (wy * 2) | 0) - 0.5) * 0.07;
          d[k] = rgb[0] * grain;
          d[k + 1] = rgb[1] * grain;
          d[k + 2] = rgb[2] * grain;
          d[k + 3] = 255;
          k += 4;
        }
      }
      x.putImageData(img, 0, 0);
      return c;
    }

    drawTerrain(ctx, v) {
      const cx0 = Math.floor(v.x0 / CHUNK), cx1 = Math.floor(v.x1 / CHUNK);
      const cy0 = Math.floor(v.y0 / CHUNK), cy1 = Math.floor(v.y1 / CHUNK);
      let budget = this.frame < 2 ? 999 : 3;
      const missing = [];
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const key = cx + ',' + cy;
          let ch = this.chunks.get(key);
          if (!ch) missing.push([cx, cy, key]);
          else {
            ch.used = this.frame;
            ctx.drawImage(ch.c, cx * CHUNK, cy * CHUNK, CHUNK + 0.6, CHUNK + 0.6);
          }
        }
      }
      // build nearest missing tiles first; placeholders for the rest
      const mx = (v.x0 + v.x1) / 2, my = (v.y0 + v.y1) / 2;
      missing.sort((a, b) => Math.hypot(a[0] * CHUNK - mx, a[1] * CHUNK - my) - Math.hypot(b[0] * CHUNK - mx, b[1] * CHUNK - my));
      for (const [cx, cy, key] of missing) {
        if (budget-- > 0) {
          const ch = { c: this.buildChunk(cx, cy), used: this.frame };
          this.chunks.set(key, ch);
          ctx.drawImage(ch.c, cx * CHUNK, cy * CHUNK, CHUNK + 0.6, CHUNK + 0.6);
        } else {
          const rgb = this.terrainRGB(cx * CHUNK + 64, cy * CHUNK + 64, false);
          ctx.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
          ctx.fillRect(cx * CHUNK, cy * CHUNK, CHUNK + 0.6, CHUNK + 0.6);
        }
      }
      if (this.chunks.size > 170) {
        const arr = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
        for (let i = 0; i < arr.length - 150; i++) this.chunks.delete(arr[i][0]);
      }
      // fine detail
      if (!this.detailPattern) this.detailPattern = ctx.createPattern(this.detail, 'repeat');
      const pat = this.detailPattern;
      if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(10 / 128));
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = clamp((v.zoom - 3) / 8, 0, 1) * 0.55;
      if (ctx.globalAlpha > 0.01) {
        ctx.fillStyle = pat;
        ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
      }
      ctx.restore();
    }

    // ----------------------------------------------------------- roads ---
    drawRoads(ctx, v) {
      const roads = this.world.roads;
      const vis = [];
      for (const r of roads) {
        for (const c of r.chunks) {
          if (c.maxx < v.x0 || c.minx > v.x1 || c.maxy < v.y0 || c.miny > v.y1) continue;
          vis.push([r, c]);
        }
      }
      if (!vis.length) return;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const path = (r, c) => {
        const p = r.pts;
        ctx.beginPath();
        ctx.moveTo(p[c.i0 * 2], p[c.i0 * 2 + 1]);
        for (let i = c.i0 + 1; i <= c.i1; i++) ctx.lineTo(p[i * 2], p[i * 2 + 1]);
      };
      // bridges: deck shadow and railings underneath everything else
      for (const [r, c] of vis) {
        for (let i = c.i0; i < c.i1; i++) {
          if (!r.bridge[i]) continue;
          const p = r.pts, ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = r.w + 3;
          ctx.beginPath();
          ctx.moveTo(ax + 2, ay + 3);
          ctx.lineTo(bx + 2, by + 3);
          ctx.stroke();
          ctx.strokeStyle = '#7d776c';
          ctx.lineWidth = r.w + 2.4;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
      for (const [r, c] of vis) {
        ctx.strokeStyle = r.kind === 'dirt' ? 'rgba(110,92,64,0.55)' : '#3f3f3c';
        ctx.lineWidth = r.w + (r.kind === 'dirt' ? 1.8 : 1.2);
        path(r, c);
        ctx.stroke();
      }
      for (const [r, c] of vis) {
        ctx.strokeStyle = r.kind === 'dirt' ? '#a48b64' : r.kind === 'highway' ? '#4b4c4f' : '#56575a';
        ctx.lineWidth = r.w;
        path(r, c);
        ctx.stroke();
      }
      if (v.zoom > 2.5) {
        ctx.lineCap = 'butt';
        for (const [r, c] of vis) {
          if (r.kind === 'dirt') {
            ctx.strokeStyle = 'rgba(120,98,66,0.5)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([]);
          } else if (r.kind === 'street') {
            continue;
          } else {
            ctx.strokeStyle = r.kind === 'highway' ? 'rgba(238,236,226,0.85)' : 'rgba(230,200,90,0.8)';
            ctx.lineWidth = 0.22;
            ctx.setLineDash([3, 5]);
          }
          path(r, c);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // bridge railings
        ctx.strokeStyle = '#d8d3c8';
        ctx.lineWidth = 0.35;
        for (const [r, c] of vis) {
          const p = r.pts, o = r.w / 2 + 0.9;
          for (let i = c.i0; i < c.i1; i++) {
            if (!r.bridge[i]) continue;
            const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[i * 2 + 2], by = p[i * 2 + 3];
            const l = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / l, ny = (bx - ax) / l;
            ctx.beginPath();
            ctx.moveTo(ax + nx * o, ay + ny * o);
            ctx.lineTo(bx + nx * o, by + ny * o);
            ctx.moveTo(ax - nx * o, ay - ny * o);
            ctx.lineTo(bx - nx * o, by - ny * o);
            ctx.stroke();
          }
        }
      }
    }

    // ---------------------------------------------------------- decals ---
    drawMarks(ctx, v) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(48,40,30,0.24)';
      ctx.lineWidth = 0.6;
      for (const t of this.world.marks) {
        if (t.n < 2) continue;
        ctx.beginPath();
        const start = (t.head - t.n + t.cap) % t.cap;
        let pen = false;
        for (let k = 0; k < t.n; k++) {
          const i = (start + k) % t.cap, x = t.x[i], y = t.y[i];
          const inView = x > v.x0 - 5 && x < v.x1 + 5 && y > v.y0 - 5 && y < v.y1 + 5;
          if (!inView || t.b[i] || !pen) {
            ctx.moveTo(x, y);
            pen = inView;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    drawDecals(ctx, v) {
      for (const d of this.world.decals) {
        if (d.x < v.x0 - 30 || d.x > v.x1 + 30 || d.y < v.y0 - 30 || d.y > v.y1 + 30) continue;
        switch (d.type) {
          case 'scorch':
            ctx.drawImage(this.scorchSprite, d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
            break;
          case 'rubble': {
            if (!d.bits) {
              const r = G.rng(d.seed);
              d.bits = [];
              for (let i = 0; i < 26; i++) d.bits.push([(r() - 0.5) * d.w * 0.95, (r() - 0.5) * d.h * 0.95, 0.6 + r() * 2.4, r() * 3, r() < 0.4]);
            }
            ctx.save();
            ctx.translate(d.x, d.y);
            ctx.rotate(d.a);
            ctx.fillStyle = 'rgba(40,36,32,0.35)';
            ctx.fillRect(-d.w / 2 - 1, -d.h / 2 - 1, d.w + 2, d.h + 2);
            ctx.fillStyle = '#6f6a63';
            ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
            for (const b of d.bits) {
              ctx.fillStyle = b[4] ? d.color || '#8a5040' : '#8f897f';
              ctx.save();
              ctx.translate(b[0], b[1]);
              ctx.rotate(b[3]);
              ctx.fillRect(-b[2] / 2, -b[2] / 2, b[2], b[2] * 0.7);
              ctx.restore();
            }
            ctx.restore();
            break;
          }
          case 'debris': {
            if (!d.bits) {
              const r = G.rng(d.seed);
              d.bits = [];
              for (let i = 0; i < 7; i++) d.bits.push([(r() - 0.5) * d.w, (r() - 0.5) * d.h, 0.2 + r() * 0.5, r() * 3]);
            }
            ctx.fillStyle = d.color;
            for (const b of d.bits) {
              ctx.save();
              ctx.translate(d.x + b[0], d.y + b[1]);
              ctx.rotate(b[3]);
              ctx.fillRect(-b[2], -b[2] / 3, b[2] * 2, b[2] * 0.66);
              ctx.restore();
            }
            break;
          }
          case 'log': {
            ctx.save();
            ctx.translate(d.x, d.y);
            ctx.rotate(d.a);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(0.3, -d.r + 0.4, d.len, d.r * 2);
            ctx.fillStyle = '#6b4f35';
            ctx.fillRect(0, -d.r, d.len, d.r * 2);
            ctx.fillStyle = '#c9a77a';
            ctx.beginPath();
            ctx.arc(0, 0, d.r, 0, 6.28);
            ctx.fill();
            const spr = d.conifer ? this.conifers[0] : this.trees[1];
            ctx.globalAlpha = 0.9;
            ctx.drawImage(spr, d.len * 0.45, -d.canopy * 0.55, d.canopy * 1.25, d.canopy * 1.1);
            ctx.restore();
            break;
          }
          case 'target':
            ctx.save();
            ctx.translate(d.x, d.y);
            ctx.rotate(d.a);
            ctx.fillStyle = '#5a4a3a';
            ctx.fillRect(-1.4, -0.15, 2.8, 0.3);
            ctx.fillStyle = '#b8b3a6';
            ctx.fillRect(0.4, -0.7, 0.9, 0.9);
            ctx.fillStyle = '#c4382c';
            ctx.fillRect(-1.1, 0.2, 0.7, 0.6);
            ctx.restore();
            break;
        }
      }
    }

    // ------------------------------------------------------- entities ---
    visible(v) {
      const out = [];
      this.world.query(v.x0 - 30, v.y0 - 30, v.x1 + 30, v.y1 + 30, (e) => {
        if (e.alive) out.push(e);
      });
      return out;
    }

    drawShadows(ctx, list) {
      ctx.fillStyle = 'rgba(10,14,8,0.26)';
      for (const e of list) {
        if (e.kind !== 'building') continue;
        const b = e.body, h = e.height || 8;
        const ox = h * 0.22, oy = h * 0.3;
        if (e.style === 'silo') {
          ctx.beginPath();
          ctx.arc(b.x + ox, b.y + oy, b.radius, 0, 6.28);
          ctx.fill();
          ctx.save();
          ctx.lineWidth = b.radius * 2;
          ctx.strokeStyle = 'rgba(10,14,8,0.26)';
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x + ox, b.y + oy);
          ctx.stroke();
          ctx.restore();
          continue;
        }
        const wv = b.wv, pts = [];
        for (let i = 0; i < wv.length; i += 2) pts.push(wv[i], wv[i + 1], wv[i] + ox, wv[i + 1] + oy);
        const hull = G.convexHull(pts);
        ctx.beginPath();
        ctx.moveTo(hull[0], hull[1]);
        for (let i = 2; i < hull.length; i += 2) ctx.lineTo(hull[i], hull[i + 1]);
        ctx.fill();
      }
    }

    drawProps(ctx, list, dt) {
      for (const e of list) {
        if (e.kind === 'tree' || e.kind === 'building') continue;
        const b = e.body;
        if (e.flash > 0 && !e.awake) e.flash -= dt;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        switch (e.kind) {
          case 'jersey':
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(-1.5, -0.25, 3.2, 0.95);
            ctx.fillStyle = '#b9b7ae';
            ctx.fillRect(-1.6, -0.4, 3.2, 0.8);
            ctx.fillStyle = '#d7d5cd';
            ctx.fillRect(-1.6, -0.14, 3.2, 0.28);
            ctx.fillStyle = '#c0392b';
            ctx.fillRect(-1.6, -0.4, 0.35, 0.8);
            ctx.fillRect(1.25, -0.4, 0.35, 0.8);
            ctx.strokeStyle = '#6f6d66';
            ctx.lineWidth = 0.06;
            ctx.strokeRect(-1.6, -0.4, 3.2, 0.8);
            break;
          case 'block':
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(-0.7, -0.6, 1.9, 1.9);
            ctx.fillStyle = '#a8a69e';
            ctx.fillRect(-0.9, -0.9, 1.8, 1.8);
            ctx.fillStyle = '#c3c1b9';
            ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
            ctx.strokeStyle = '#7a7871';
            ctx.lineWidth = 0.07;
            ctx.strokeRect(-0.9, -0.9, 1.8, 1.8);
            ctx.beginPath();
            ctx.moveTo(-0.7, -0.7);
            ctx.lineTo(0.7, 0.7);
            ctx.stroke();
            break;
          case 'crate':
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(-0.5, -0.45, 1.5, 1.5);
            ctx.fillStyle = e.tint < 0.5 ? '#a8743f' : '#9a6a38';
            ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
            ctx.strokeStyle = '#5e3f20';
            ctx.lineWidth = 0.1;
            ctx.strokeRect(-0.65, -0.65, 1.3, 1.3);
            ctx.lineWidth = 0.06;
            ctx.beginPath();
            ctx.moveTo(-0.65, -0.22);
            ctx.lineTo(0.65, -0.22);
            ctx.moveTo(-0.65, 0.22);
            ctx.lineTo(0.65, 0.22);
            ctx.moveTo(-0.6, -0.6);
            ctx.lineTo(0.6, 0.6);
            ctx.stroke();
            break;
          case 'barrel': {
            const col = e.tint < 0.55 ? '#b33a2a' : e.tint < 0.8 ? '#2f5f8a' : '#c9a227';
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath();
            ctx.arc(0.18, 0.25, 0.45, 0, 6.28);
            ctx.fill();
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(0, 0, 0.45, 0, 6.28);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.45)';
            ctx.lineWidth = 0.07;
            ctx.beginPath();
            ctx.arc(0, 0, 0.32, 0, 6.28);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath();
            ctx.arc(-0.14, -0.14, 0.12, 0, 6.28);
            ctx.fill();
            break;
          }
          case 'teeth':
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(-0.55, -0.45, 1.5, 1.5);
            ctx.fillStyle = '#9f9d96';
            ctx.fillRect(-0.75, -0.75, 1.5, 1.5);
            ctx.fillStyle = '#c4c2bb';
            ctx.beginPath();
            ctx.moveTo(-0.75, -0.75);
            ctx.lineTo(0.75, -0.75);
            ctx.lineTo(0, 0);
            ctx.fill();
            ctx.fillStyle = '#85837c';
            ctx.beginPath();
            ctx.moveTo(-0.75, 0.75);
            ctx.lineTo(0.75, 0.75);
            ctx.lineTo(0, 0);
            ctx.fill();
            break;
          case 'sandbag': {
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(-1.5, -0.4, 3.4, 1.2);
            ctx.fillStyle = '#b8a479';
            ctx.fillRect(-1.7, -0.6, 3.4, 1.2);
            ctx.strokeStyle = '#8a7752';
            ctx.lineWidth = 0.07;
            for (let i = -1.7; i < 1.7; i += 0.68) ctx.strokeRect(i, -0.6, 0.68, 0.6);
            for (let i = -1.36; i < 1.6; i += 0.68) ctx.strokeRect(i, 0, 0.68, 0.6);
            break;
          }
          case 'wall':
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(-e.w / 2 + 0.3, -0.1, e.w, 0.9);
            ctx.fillStyle = '#9a523d';
            ctx.fillRect(-e.w / 2, -0.3, e.w, 0.6);
            ctx.strokeStyle = '#6b3426';
            ctx.lineWidth = 0.05;
            ctx.beginPath();
            ctx.moveTo(-e.w / 2, 0);
            ctx.lineTo(e.w / 2, 0);
            for (let x = -e.w / 2; x < e.w / 2; x += 0.5) {
              ctx.moveTo(x, -0.3);
              ctx.lineTo(x, 0);
              ctx.moveTo(x + 0.25, 0);
              ctx.lineTo(x + 0.25, 0.3);
            }
            ctx.stroke();
            ctx.strokeStyle = '#5a2c20';
            ctx.lineWidth = 0.08;
            ctx.strokeRect(-e.w / 2, -0.3, e.w, 0.6);
            break;
          case 'target': {
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath();
            ctx.arc(0.3, 0.4, 1.3, 0, 6.28);
            ctx.fill();
            const pulse = 0.5 + 0.5 * Math.sin(this.world.time * 4);
            ctx.strokeStyle = `rgba(255,80,60,${0.25 + pulse * 0.35})`;
            ctx.lineWidth = 0.25;
            ctx.beginPath();
            ctx.arc(0, 0, 1.9 + pulse * 0.4, 0, 6.28);
            ctx.stroke();
            const rings = ['#f4efe4', '#d23a2c', '#f4efe4', '#d23a2c'];
            for (let i = 0; i < 4; i++) {
              ctx.fillStyle = rings[i];
              ctx.beginPath();
              ctx.arc(0, 0, 1.3 - i * 0.32, 0, 6.28);
              ctx.fill();
            }
            ctx.strokeStyle = '#5a4a3a';
            ctx.lineWidth = 0.12;
            ctx.beginPath();
            ctx.arc(0, 0, 1.3, 0, 6.28);
            ctx.stroke();
            break;
          }
        }
        if (e.flash > 0) {
          ctx.globalAlpha = Math.min(1, e.flash * 5) * 0.6;
          ctx.fillStyle = '#fff';
          const r = b.radius;
          ctx.fillRect(-r, -r, r * 2, r * 2);
        }
        ctx.restore();
      }
    }

    drawBuildings(ctx, list, dt) {
      for (const e of list) {
        if (e.kind !== 'building') continue;
        const b = e.body;
        if (e.flash > 0) e.flash -= dt;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        const w = e.w, h = e.h;
        if (e.style === 'silo') {
          const r = b.radius;
          const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
          g.addColorStop(0, '#e2e4e6');
          g.addColorStop(1, '#8c9095');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, 6.28);
          ctx.fill();
          ctx.strokeStyle = '#6c7075';
          ctx.lineWidth = 0.2;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.55, 0, 6.28);
          ctx.moveTo(r * 0.15, 0);
          ctx.arc(0, 0, r * 0.15, 0, 6.28);
          ctx.stroke();
        } else if (e.style === 'gable') {
          const along = w >= h;
          ctx.fillStyle = e.roof;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          if (along) ctx.fillRect(-w / 2, -h / 2, w, h / 2);
          else ctx.fillRect(-w / 2, -h / 2, w / 2, h);
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          if (along) ctx.fillRect(-w / 2, 0, w, h / 2);
          else ctx.fillRect(0, -h / 2, w / 2, h);
          // tile courses
          ctx.strokeStyle = 'rgba(0,0,0,0.13)';
          ctx.lineWidth = 0.12;
          ctx.beginPath();
          if (along) for (let y = -h / 2 + 0.7; y < h / 2; y += 0.7) { ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); }
          else for (let x = -w / 2 + 0.7; x < w / 2; x += 0.7) { ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); }
          ctx.stroke();
          ctx.strokeStyle = 'rgba(40,20,15,0.6)';
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          if (along) { ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); }
          else { ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2); }
          ctx.stroke();
          if (e.detail > 0.5) {
            ctx.fillStyle = '#6b5a4c';
            ctx.fillRect(along ? w * 0.22 : -h * 0.1, along ? -h * 0.32 : h * 0.18, 0.9, 0.9);
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = 0.25;
          ctx.strokeRect(-w / 2, -h / 2, w, h);
        } else if (e.style === 'hangar') {
          const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
          g.addColorStop(0, '#9aa292');
          g.addColorStop(0.5, e.roof);
          g.addColorStop(1, '#4a5046');
          ctx.fillStyle = g;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 0.15;
          ctx.beginPath();
          for (let x = -w / 2 + 2; x < w / 2; x += 2) { ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); }
          ctx.stroke();
          ctx.strokeStyle = '#30352c';
          ctx.lineWidth = 0.3;
          ctx.strokeRect(-w / 2, -h / 2, w, h);
        } else {
          ctx.fillStyle = e.roof;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeStyle = 'rgba(0,0,0,0.28)';
          ctx.lineWidth = 0.7;
          ctx.strokeRect(-w / 2 + 0.35, -h / 2 + 0.35, w - 0.7, h - 0.7);
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 0.25;
          ctx.beginPath();
          ctx.moveTo(-w / 2, h / 2);
          ctx.lineTo(-w / 2, -h / 2);
          ctx.lineTo(w / 2, -h / 2);
          ctx.stroke();
          // roof clutter
          const r = G.rng(e.id * 13 + 7);
          const n = Math.floor(1 + r() * Math.min(5, (w * h) / 150));
          for (let i = 0; i < n; i++) {
            const bw = 1.2 + r() * 2.5, bh = 1 + r() * 2;
            const x = (r() - 0.5) * (w - bw - 3), y = (r() - 0.5) * (h - bh - 3);
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.fillRect(x + 0.3, y + 0.4, bw, bh);
            ctx.fillStyle = r() < 0.5 ? '#b9b8b2' : '#7f8287';
            ctx.fillRect(x, y, bw, bh);
          }
        }
        const dmg = 1 - e.hp / e.maxHp;
        if (dmg > 0.01) {
          ctx.globalAlpha = dmg * 0.55;
          ctx.fillStyle = '#2b2622';
          if (e.style === 'silo') {
            ctx.beginPath();
            ctx.arc(0, 0, b.radius, 0, 6.28);
            ctx.fill();
          } else ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(20,16,12,0.7)';
          ctx.lineWidth = 0.25;
          const r = G.rng(e.id);
          ctx.beginPath();
          for (let i = 0; i < Math.ceil(dmg * 6); i++) {
            let x = (r() - 0.5) * w * 0.8, y = (r() - 0.5) * h * 0.8;
            ctx.moveTo(x, y);
            for (let k = 0; k < 4; k++) {
              x += (r() - 0.5) * 4;
              y += (r() - 0.5) * 4;
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }
        if (e.flash > 0) {
          ctx.globalAlpha = Math.min(1, e.flash * 5) * 0.35;
          ctx.fillStyle = '#fff';
          ctx.fillRect(-w / 2, -h / 2, w, h);
        }
        ctx.restore();
        if (dmg > 0.45 && Math.random() < dt * 6) this.world.particle(0, b.x + (Math.random() - 0.5) * w * 0.5, b.y + (Math.random() - 0.5) * h * 0.5, 0.5, -0.3, 3, 2 + dmg * 2, '#55504a');
      }
    }

    drawTrees(ctx, list, tank) {
      const tx = tank.body.x, ty = tank.body.y;
      for (const e of list) {
        if (e.kind !== 'tree') continue;
        const r = e.canopy, b = e.body;
        ctx.drawImage(this.shadowSprite, b.x - r + r * 0.4, b.y - r + r * 0.55, r * 2.1, r * 2.1);
      }
      for (const e of list) {
        if (e.kind !== 'tree') continue;
        const r = e.canopy, b = e.body;
        const d = Math.hypot(b.x - tx, b.y - ty);
        ctx.globalAlpha = d < r + 4.5 ? 0.38 : 1;
        if (e.flash > 0) e.flash -= 1 / 60;
        const spr = e.conifer ? this.conifers[e.variant & 1] : this.trees[e.variant];
        ctx.drawImage(spr, b.x - r, b.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }

    // ------------------------------------------------------------- tank --
    drawTank(ctx, tank) {
      const b = tank.body, T = G.TANK, A = this.assets;
      ctx.save();
      // soft drop shadow, offset in world space (light from the north-west)
      ctx.translate(b.x + 0.55, b.y + 0.75);
      ctx.rotate(b.a);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-3.6, -1.9, 7.2, 3.8, 0.6) : ctx.rect(-3.6, -1.9, 7.2, 3.8);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      // tracks with animated tread links
      for (let side = 0; side < 2; side++) {
        const y0 = side ? T.trackY : -T.trackY;
        ctx.fillStyle = '#26261f';
        ctx.fillRect(-3.58, y0 - 0.34, 7.16, 0.68);
        const off = ((tank.track[side] % 0.36) + 0.36) % 0.36;
        ctx.strokeStyle = '#4a4a3f';
        ctx.lineWidth = 0.14;
        ctx.beginPath();
        for (let x = -3.58 + off; x < 3.58; x += 0.36) {
          ctx.moveTo(x, y0 - 0.32);
          ctx.lineTo(x, y0 + 0.32);
        }
        ctx.stroke();
        ctx.strokeStyle = '#121210';
        ctx.lineWidth = 0.06;
        ctx.strokeRect(-3.58, y0 - 0.34, 7.16, 0.68);
      }
      if (A.hull) ctx.drawImage(A.hull, -3.5, -1.35, 7, 2.7);
      else {
        ctx.fillStyle = '#6f7c45';
        ctx.fillRect(-3.5, -1.35, 7, 2.7);
      }
      ctx.translate(T.turretPivot, 0);
      ctx.rotate(tank.turret);
      const rc = tank.recoil * tank.recoil * 0.75;
      // turret shadow on the hull
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(0.25, 0.3, 1.7, 1.25, 0, 0, 6.28);
      ctx.fill();
      if (A.barrel) ctx.drawImage(A.barrel, 0.75 - rc, -0.2, 4.6, 0.4);
      else {
        ctx.fillStyle = '#4b552d';
        ctx.fillRect(0.75 - rc, -0.08, 4.6, 0.16);
      }
      if (A.turret) ctx.drawImage(A.turret, -1.75, -1.3, 3.4, 2.6);
      else {
        ctx.fillStyle = '#7d8a50';
        ctx.beginPath();
        ctx.ellipse(0, 0, 1.6, 1.15, 0, 0, 6.28);
        ctx.fill();
      }
      ctx.restore();
    }

    // -------------------------------------------------------- effects ----
    drawShells(ctx) {
      ctx.lineCap = 'round';
      for (const s of this.world.shells) {
        const sp = Math.hypot(s.vx, s.vy), dx = s.vx / sp, dy = s.vy / sp;
        ctx.strokeStyle = 'rgba(255,200,120,0.35)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - dx * 14, s.y - dy * 14);
        ctx.stroke();
        ctx.strokeStyle = '#fff3c4';
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - dx * 7, s.y - dy * 7);
        ctx.stroke();
      }
    }

    drawParticles(ctx, v, layer) {
      const P = this.world.particles;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        if (p.x < v.x0 - 20 || p.x > v.x1 + 20 || p.y < v.y0 - 20 || p.y > v.y1 + 20) continue;
        const t = p.life / p.max;
        const high = p.kind === 0 || p.kind === 1 || p.kind === 6 || p.kind === 5;
        if (high !== (layer === 1)) continue;
        switch (p.kind) {
          case 0:
          case 7: {
            const s = p.size * (1 + (1 - t) * 1.6);
            ctx.globalAlpha = t * (p.kind === 7 ? 0.35 : 0.5);
            ctx.drawImage(this.softSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
            break;
          }
          case 1:
          case 6: {
            const s = p.size * (p.kind === 6 ? 0.6 + (1 - t) * 0.8 : 0.5 + t * 0.6);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = t;
            ctx.drawImage(this.softSprite(p.color), p.x - s, p.y - s, s * 2, s * 2);
            ctx.globalCompositeOperation = 'source-over';
            break;
          }
          case 2:
            ctx.globalAlpha = t;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 0.14;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
            ctx.stroke();
            break;
          case 3:
          case 4:
            ctx.globalAlpha = Math.min(1, t * 3);
            ctx.fillStyle = p.color;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            ctx.restore();
            break;
          case 5:
            ctx.globalAlpha = Math.min(1, t * 2);
            ctx.fillStyle = p.color;
            ctx.font = 'bold 2.4px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.text, p.x, p.y);
            break;
        }
      }
      ctx.globalAlpha = 1;
    }

    drawAim(ctx, tank, aim, v) {
      const T = G.TANK;
      const [px, py] = tank.pivot();
      const a = tank.turretWorldAngle();
      const dx = Math.cos(a), dy = Math.sin(a);
      const L = T.shellRange;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,240,200,0.25)';
      ctx.lineWidth = 1.2 / v.zoom;
      ctx.setLineDash([6 / v.zoom, 6 / v.zoom]);
      ctx.beginPath();
      ctx.moveTo(px + dx * (T.muzzle + 1), py + dy * (T.muzzle + 1));
      ctx.lineTo(px + dx * L, py + dy * L);
      ctx.stroke();
      ctx.setLineDash([]);
      if (aim) {
        const r = 14 / v.zoom;
        ctx.strokeStyle = 'rgba(255,90,60,0.9)';
        ctx.lineWidth = 2 / v.zoom;
        ctx.beginPath();
        ctx.arc(aim[0], aim[1], r, 0, 6.28);
        ctx.moveTo(aim[0] - r * 1.6, aim[1]);
        ctx.lineTo(aim[0] - r * 0.5, aim[1]);
        ctx.moveTo(aim[0] + r * 0.5, aim[1]);
        ctx.lineTo(aim[0] + r * 1.6, aim[1]);
        ctx.moveTo(aim[0], aim[1] - r * 1.6);
        ctx.lineTo(aim[0], aim[1] - r * 0.5);
        ctx.moveTo(aim[0], aim[1] + r * 0.5);
        ctx.lineTo(aim[0], aim[1] + r * 1.6);
        ctx.stroke();
        if (tank.reload > 0) {
          ctx.strokeStyle = 'rgba(255,220,120,0.9)';
          ctx.lineWidth = 3 / v.zoom;
          ctx.beginPath();
          ctx.arc(aim[0], aim[1], r * 1.35, -Math.PI / 2, -Math.PI / 2 + 6.283 * (1 - tank.reload / T.reloadTime));
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ------------------------------------------------------------ frame --
    draw(cam, tank, aim, dt) {
      this.frame++;
      const c = this.canvas, ctx = this.ctx;
      const dpr = cam.dpr, z = cam.zoom * dpr;
      const W = c.width, H = c.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#1a1d18';
      ctx.fillRect(0, 0, W, H);
      const sx = cam.x + cam.shakeX, sy = cam.y + cam.shakeY;
      ctx.setTransform(z, 0, 0, z, W / 2 - sx * z, H / 2 - sy * z);
      ctx.imageSmoothingEnabled = true;
      const v = {
        x0: sx - W / 2 / z, x1: sx + W / 2 / z, y0: sy - H / 2 / z, y1: sy + H / 2 / z, zoom: cam.zoom,
      };
      this.drawTerrain(ctx, v);
      this.drawRoads(ctx, v);
      this.drawMarks(ctx, v);
      this.drawDecals(ctx, v);
      const list = this.visible(v);
      this.drawShadows(ctx, list);
      this.drawProps(ctx, list, dt);
      this.drawParticles(ctx, v, 0);
      this.drawTank(ctx, tank);
      this.drawBuildings(ctx, list, dt);
      this.drawShells(ctx);
      this.drawTrees(ctx, list, tank);
      this.drawParticles(ctx, v, 1);
      // map boundary fence
      ctx.strokeStyle = 'rgba(255,90,60,0.55)';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(0, 0, SIZE, SIZE);
      ctx.setLineDash([]);
      this.drawAim(ctx, tank, aim, v);
      return v;
    }

    // --------------------------------------------------------- minimap ---
    buildMap(px) {
      const c = makeCanvas(px, px), x = c.getContext('2d');
      const img = x.createImageData(px, px), d = img.data;
      const s = SIZE / px;
      let k = 0;
      for (let j = 0; j < px; j++) {
        for (let i = 0; i < px; i++) {
          const rgb = this.terrainRGB((i + 0.5) * s, (j + 0.5) * s, false);
          // darken forests so they read on the map
          const f = smoothstep(0.02, 0.2, this.s4[3]) * (this.world.maskAt((i + 0.5) * s, (j + 0.5) * s) === 0 ? 1 : 0);
          d[k] = rgb[0] * (1 - f * 0.35);
          d[k + 1] = rgb[1] * (1 - f * 0.25);
          d[k + 2] = rgb[2] * (1 - f * 0.35);
          d[k + 3] = 255;
          k += 4;
        }
      }
      x.putImageData(img, 0, 0);
      x.scale(px / SIZE, px / SIZE);
      x.lineJoin = 'round';
      for (const r of this.world.roads) {
        x.strokeStyle = r.kind === 'dirt' ? '#b49a70' : r.kind === 'highway' ? '#e8e2d0' : '#cfc9b8';
        x.lineWidth = Math.max(r.w, (r.kind === 'highway' ? 2.2 : 1.4) * s);
        x.beginPath();
        const p = r.pts;
        x.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) x.lineTo(p[i], p[i + 1]);
        x.stroke();
      }
      x.fillStyle = '#5e4a40';
      for (const e of this.world.entities) {
        if (e.kind !== 'building') continue;
        const b = e.body;
        x.fillRect(b.minx, b.miny, Math.max(b.maxx - b.minx, s), Math.max(b.maxy - b.miny, s));
      }
      this.map = c;
      this.mapPx = px;
      return c;
    }

    markDestroyedOnMap(e) {
      if (!this.map) return;
      const x = this.map.getContext('2d');
      x.save();
      x.setTransform(this.mapPx / SIZE, 0, 0, this.mapPx / SIZE, 0, 0);
      x.fillStyle = '#3a3633';
      const b = e.body;
      x.fillRect(b.minx, b.miny, b.maxx - b.minx, b.maxy - b.miny);
      x.restore();
    }
  }

  G.Renderer = Renderer;
})();
