/* Tank Lab — tank dynamics.
 *
 * The hull is one rigid body. Like the 1996 car model it is built on, each
 * contact point measures its own velocity, splits it into "along the track"
 * and "sideways" components and resists both: a little along the track
 * (rolling), a lot sideways (grip). Instead of steered front wheels, a tank
 * steers by driving its two tracks at different speeds (skid steering), so the
 * turning torque comes from the left/right track forces themselves.
 */
'use strict';
(function () {
  const G = (typeof window !== 'undefined' ? window : globalThis).G;

  const T = (G.TANK = {
    length: 7.0,
    width: 3.7,
    mass: 30000,
    trackY: 1.58, // lateral offset of each track's centre line
    contactX: [-2.7, -0.9, 0.9, 2.7], // contact points along each track
    trackForce: 60000, // max drive force per track (N)
    kRoll: 833, // rolling resistance per contact point (N per m/s)
    kLat: 7400, // sideways resistance per contact point (N per m/s)
    latCap: 22000, // sideways grip limit per contact point (N)
    brakeMax: 26000, // brake force limit per contact point (N)
    reverseScale: 0.6,
    turretSpeed: 1.25, // rad/s
    turretPivot: -0.35, // turret ring position along the hull
    muzzle: 5.25, // muzzle distance from turret pivot
    reloadTime: 1.8,
    shellSpeed: 260,
    shellRange: 1100,
    recoilImpulse: 14000,
  });

  class Tank {
    constructor(x, y, a) {
      this.body = new G.Body({
        x, y, a,
        shape: G.boxShape(T.length, T.width),
        mass: T.mass,
        restitution: 0.08,
        friction: 0.45,
      });
      this.turret = 0; // relative to hull
      this.reload = 0;
      this.recoil = 0;
      this.track = [0, 0]; // distance travelled by each track (tread animation)
      this.trackV = [0, 0];
      this.throttle = [0, 0];
      this.speed = 0;
      this.surface = null;
      this.dist = 0;
    }

    /** Signed forward speed (m/s). */
    forwardSpeed() {
      const b = this.body;
      return b.vx * Math.cos(b.a) + b.vy * Math.sin(b.a);
    }

    turretWorldAngle() {
      return this.body.a + this.turret;
    }
    pivot() {
      const b = this.body;
      return [b.x + Math.cos(b.a) * T.turretPivot, b.y + Math.sin(b.a) * T.turretPivot];
    }

    /**
     * Apply engine, track and terrain forces for one step.
     * input: {drive, turn, brake, turretTurn, aim:[x,y]|null}
     */
    applyForces(dt, input, world) {
      const b = this.body;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const fwdX = c, fwdY = s, rgtX = -s, rgtY = c;
      const surf = world.surfaceAt(b.x, b.y);
      this.surface = surf;

      // skid steering: mix drive and turn into left/right track throttles
      let drive = input.drive;
      if (drive < 0) drive *= T.reverseScale;
      const turnMix = 1 - 0.45 * Math.abs(input.drive);
      let L = drive + input.turn * turnMix;
      let R = drive - input.turn * turnMix;
      const mx = Math.max(1, Math.abs(L), Math.abs(R));
      L /= mx;
      R /= mx;
      // smooth the throttle a little (engine/transmission lag)
      const k = 1 - Math.exp(-dt * 6);
      this.throttle[0] += (L - this.throttle[0]) * k;
      this.throttle[1] += (R - this.throttle[1]) * k;

      const coasting = Math.abs(input.drive) < 0.05 && Math.abs(input.turn) < 0.05;
      const rollK = T.kRoll * surf.roll * (coasting ? 1.8 : 1);
      const latK = T.kLat * surf.lat;
      const n = T.contactX.length;
      for (let side = 0; side < 2; side++) {
        const ly = side === 0 ? -T.trackY : T.trackY;
        const drv = (this.throttle[side] * T.trackForce * surf.grip) / n;
        let vSum = 0;
        for (let i = 0; i < n; i++) {
          const lx = T.contactX[i];
          const px = b.x + lx * c - ly * s, py = b.y + lx * s + ly * c;
          const vx = b.pointVelX(px, py), vy = b.pointVelY(px, py);
          const vf = vx * fwdX + vy * fwdY;
          const vl = vx * rgtX + vy * rgtY;
          vSum += vf;
          let ff = drv - rollK * vf;
          if (input.brake) {
            const bf = Math.min(Math.abs(vf) * T.kRoll * 30, T.brakeMax);
            ff -= Math.sign(vf) * bf;
          }
          let fl = -latK * vl;
          const cap = T.latCap * surf.grip;
          if (fl > cap) fl = cap;
          else if (fl < -cap) fl = -cap;
          b.applyForce(fwdX * ff + rgtX * fl, fwdY * ff + rgtY * fl, px, py);
        }
        this.trackV[side] = vSum / n;
        this.track[side] += (vSum / n) * dt;
      }

      // gravity along the terrain slope
      const g = world.gradientAt(b.x, b.y);
      b.fx -= T.mass * 9.81 * g[0] * 0.9;
      b.fy -= T.mass * 9.81 * g[1] * 0.9;

      // turret
      const ta = this.turretWorldAngle();
      const step = T.turretSpeed * dt;
      if (input.aim) {
        const [px, py] = this.pivot();
        const want = Math.atan2(input.aim[1] - py, input.aim[0] - px);
        const d = G.wrapAngle(want - ta);
        this.turret += G.clamp(d, -step, step);
      } else if (input.turretTurn) {
        this.turret += input.turretTurn * step;
      }
      this.turret = G.wrapAngle(this.turret);

      if (this.reload > 0) this.reload = Math.max(0, this.reload - dt);
      if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 2.2);
    }

    afterStep() {
      const b = this.body;
      this.speed = Math.hypot(b.vx, b.vy);
    }

    /** Fire the main gun. Returns the shell spawn info or null if reloading. */
    fire(world) {
      if (this.reload > 0) return null;
      const b = this.body;
      const a = this.turretWorldAngle();
      const dx = Math.cos(a), dy = Math.sin(a);
      const [px, py] = this.pivot();
      const mx = px + dx * T.muzzle, my = py + dy * T.muzzle;
      this.reload = T.reloadTime;
      this.recoil = 1;
      b.applyImpulse(-dx * T.recoilImpulse, -dy * T.recoilImpulse, px, py);
      world.spawnShell(mx, my, dx * T.shellSpeed + b.vx, dy * T.shellSpeed + b.vy, T.shellRange / T.shellSpeed, this);
      world.muzzleBlast(mx, my, dx, dy, b.vx, b.vy);
      return { x: mx, y: my, dx, dy };
    }
  }
  G.Tank = Tank;
})();
