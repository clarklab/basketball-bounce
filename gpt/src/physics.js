/**
 * A basketball in SI units. Contact uses a unilateral Kelvin–Voigt spring;
 * a fixed 960 Hz step resolves its short, compliant impacts at any frame rate.
 * No animation curve controls the trajectory: gravity and contact forces do.
 */
export class BasketballPhysics {
  constructor({
    radius = 0.12,
    mass = 0.62,
    gravity = 9.81,
    restitution = 0.77,
    stiffness = 22500,
    fixedStep = 1 / 960,
    bounds = null,
  } = {}) {
    this.radius = radius;
    this.mass = mass;
    this.gravity = gravity;
    this.restitution = restitution;
    this.stiffness = stiffness;
    this.fixedStep = fixedStep;
    this.bounds = bounds;
    // Thin shell inertia describes an inflated ball better than a solid sphere.
    this.inertia = (2 / 3) * mass * radius * radius;
    const logRestitution = Math.log(restitution);
    const dampingRatio = -logRestitution / Math.hypot(Math.PI, logRestitution);
    this.damping = 2 * dampingRatio * Math.sqrt(stiffness * mass);
    this.position = { x: 0, y: radius, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.angularVelocity = { x: 0, y: 0, z: 0 };
    this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    this.scale = { x: 1, y: 1, z: 1 };
    this.reset();
  }

  reset() {
    Object.assign(this.position, { x: 0, y: this.radius, z: 0 });
    Object.assign(this.velocity, { x: 0, y: 0, z: 0 });
    Object.assign(this.angularVelocity, { x: 0, y: 0, z: 0 });
    Object.assign(this.quaternion, { x: 0, y: 0, z: 0, w: 1 });
    Object.assign(this.scale, { x: 1, y: 1, z: 1 });
    this.compression = 0;
    this.grounded = true;
    this.sleeping = true;
    this.time = 0;
    this.impactCount = 0;
    this.lastImpactSpeed = 0;
    this.lastImpactTime = -Infinity;
    this._accumulator = 0;
    this._contact = false;
    this._quietTime = 0;
    this._shape = 1;
    this._shapeVelocity = 0;
    return this;
  }

  /**
   * Toss to `height` metres above the current center. x/z are lateral velocities
   * in m/s, and spin is world angular velocity in rad/s. Another click catches
   * the current downward momentum and gives the ball a fresh upward impulse.
   */
  toss({ height = 1.15, x = 0, z = 0, spin = { x: 0.38, y: -0.22, z: 0.14 } } = {}) {
    this.sleeping = false;
    this.grounded = false;
    this._contact = false;
    this._quietTime = 0;
    this.position.y = Math.max(this.radius, this.position.y);
    Object.assign(this.velocity, {
      x,
      y: Math.sqrt(2 * this.gravity * Math.max(0.02, height)),
      z,
    });
    Object.assign(this.angularVelocity, {
      x: spin.x ?? 0,
      y: spin.y ?? 0,
      z: spin.z ?? 0,
    });
    this.compression = 0;
    return this;
  }

  /**
   * Advance elapsed seconds. Gaps above 250 ms are capped so a resumed browser
   * tab does not play a long burst of missed physics. Ordinary frames preserve
   * their exact elapsed time, including the fixed-step fractional remainder.
   */
  step(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new RangeError('Physics elapsed time must be finite and nonnegative.');
    }
    this._accumulator += Math.min(seconds, 0.25);
    while (this._accumulator + 1e-12 >= this.fixedStep) {
      this._integrate(this.fixedStep);
      this._accumulator -= this.fixedStep;
    }
    return this;
  }

  _integrate(dt) {
    this.time += dt;
    if (this.sleeping) return;

    const p = this.position;
    const v = this.velocity;
    const w = this.angularVelocity;
    const r = this.radius;
    const penetration = Math.max(0, r - p.y);
    const touching = p.y <= r;
    let normalForce = 0;

    if (touching) {
      if (!this._contact && v.y < -0.12) {
        this.impactCount += 1;
        this.lastImpactSpeed = -v.y;
        this.lastImpactTime = this.time;
      }
      // A floor can push the ball but cannot pull it down on spring release.
      normalForce = Math.max(0, this.stiffness * penetration - this.damping * v.y);
      this._applyContactFriction(normalForce, dt);
    }
    this._contact = touching;

    // Semi-implicit Euler is stable for this spring at the fixed internal step.
    // The tiny air drag acts on translation/spin, never as an upward lift force.
    const airDrag = Math.exp(-0.012 * dt);
    v.x *= airDrag;
    v.z *= airDrag;
    v.y += (-this.gravity + normalForce / this.mass) * dt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;

    // Guard only pathological, externally assigned velocities. Normal tosses
    // are fully resolved by the contact spring and never reach this limit.
    if (p.y < r * 0.42) {
      p.y = r * 0.42;
      v.y = Math.max(0, -v.y * this.restitution);
    }

    this._applyBounds();
    const spinDrag = Math.exp(-0.025 * dt);
    w.x *= spinDrag;
    w.y *= spinDrag;
    w.z *= spinDrag;
    this._rotate(dt);

    this.compression = Math.max(0, r - p.y);
    this.grounded = p.y <= r + 0.00001;
    this._updateShape(dt);

    // Stop residual numerical chatter once translational and rotational energy
    // are tiny; settled position is the undeformed radius for a clean contact.
    const quiet = this.grounded && Math.abs(v.y) < 0.025
      && Math.hypot(v.x, v.z) < 0.012
      && Math.hypot(w.x, w.y, w.z) < 0.11;
    this._quietTime = quiet ? this._quietTime + dt : 0;
    if (this._quietTime > 0.16) {
      p.y = r;
      Object.assign(v, { x: 0, y: 0, z: 0 });
      Object.assign(w, { x: 0, y: 0, z: 0 });
      Object.assign(this.scale, { x: 1, y: 1, z: 1 });
      this._shape = 1;
      this._shapeVelocity = 0;
      this.compression = 0;
      this.sleeping = true;
      this.grounded = true;
    }
  }

  _applyContactFriction(normalForce, dt) {
    const v = this.velocity;
    const w = this.angularVelocity;
    const r = this.radius;
    // Relative speed of the shell at its contact point, including rotation.
    const slipX = v.x + w.z * r;
    const slipZ = v.z - w.x * r;
    const effectiveInverseMass = 1 / this.mass + r * r / this.inertia;
    let jx = -slipX / effectiveInverseMass;
    let jz = -slipZ / effectiveInverseMass;
    const impulse = Math.hypot(jx, jz);
    const maximum = 0.58 * normalForce * dt;
    if (impulse > maximum && impulse > 0) {
      jx *= maximum / impulse;
      jz *= maximum / impulse;
    }
    v.x += jx / this.mass;
    v.z += jz / this.mass;
    w.x -= r * jz / this.inertia;
    w.z += r * jx / this.inertia;

    // Rubber hysteresis dissipates rolling motion; torsional contact friction
    // dissipates vertical spin. These act only while the ball is on the floor.
    const rollingDrag = Math.exp(-4.2 * dt);
    v.x *= rollingDrag;
    v.z *= rollingDrag;
    w.x *= rollingDrag;
    w.z *= rollingDrag;
    w.y *= Math.exp(-7 * dt);
  }

  _applyBounds() {
    if (!this.bounds) return;
    for (const axis of ['x', 'z']) {
      const bound = this.bounds[axis];
      if (!(bound > 0)) continue;
      if (Math.abs(this.position[axis]) > bound) {
        this.position[axis] = Math.sign(this.position[axis]) * bound;
        this.velocity[axis] *= -0.65;
      }
    }
  }

  _updateShape(dt) {
    const r = this.radius;
    if (this.compression > 0) {
      // The compressed lower surface stays exactly on the floor. The radial
      // scale below preserves the ellipsoid's volume throughout deformation.
      this._shape = Math.max(0.42, this.position.y / r);
      this._shapeVelocity = this.velocity.y / r;
    } else {
      // Small viscoelastic ring-down after the shell releases the floor. The
      // constrained velocity avoids a cartoon stretch on a fast rebound.
      this._shapeVelocity = Math.max(-4, Math.min(4, this._shapeVelocity));
      this._shapeVelocity += (55 * 55 * (1 - this._shape)
        - 2 * 0.55 * 55 * this._shapeVelocity) * dt;
      this._shape += this._shapeVelocity * dt;
    }
    const sy = Math.min(this.position.y / r, Math.max(0.42, Math.min(1.055, this._shape)));
    this.scale.y = sy;
    this.scale.x = this.scale.z = 1 / Math.sqrt(sy);
  }

  _rotate(dt) {
    const w = this.angularVelocity;
    const q = this.quaternion;
    const speed = Math.hypot(w.x, w.y, w.z);
    if (speed < 1e-12) return;
    const factor = Math.sin(speed * dt * 0.5) / speed;
    const x = w.x * factor;
    const y = w.y * factor;
    const z = w.z * factor;
    const s = Math.cos(speed * dt * 0.5);
    const qx = s * q.x + x * q.w + y * q.z - z * q.y;
    const qy = s * q.y - x * q.z + y * q.w + z * q.x;
    const qz = s * q.z + x * q.y - y * q.x + z * q.w;
    const qw = s * q.w - x * q.x - y * q.y - z * q.z;
    const inverseLength = 1 / Math.hypot(qx, qy, qz, qw);
    Object.assign(q, {
      x: qx * inverseLength,
      y: qy * inverseLength,
      z: qz * inverseLength,
      w: qw * inverseLength,
    });
  }
}
