// Rigid-body basketball: gravity, buoyancy, drag, Magnus lift, a pressurised-shell
// floor contact with Coulomb friction, and a damped shell mode for the wobble.
// SI units throughout. y is up, the floor is the plane y = 0.

export const GRAVITY = 9.81;
const AIR_DENSITY = 1.2;

export const BALL = (() => {
  const radius = 0.119; // size 7, 749 mm circumference
  const mass = 0.62;
  // An inflated shell pressed into a flat floor pushes back with
  // (gauge pressure) x (contact patch area) ~ 2*pi*R*p * depth, a linear spring.
  // Regulation pressure (8 psi) gives about 4e4 N/m and a squash that is over within
  // a frame. This is a soft ball, a little over 2 psi, so the deformation reads on screen.
  const stiffness = 1.2e4;
  const restitution = 0.78;
  const lnE = Math.log(restitution);
  const dampingRatio = -lnE / Math.hypot(Math.PI, lnE);
  return Object.freeze({
    radius,
    mass,
    stiffness,
    restitution,
    damping: 2 * dampingRatio * Math.sqrt(stiffness * mass),
    inertia: (2 / 3) * mass * radius * radius, // thin spherical shell
    area: Math.PI * radius * radius,
    volume: (4 / 3) * Math.PI * radius ** 3,
    friction: 0.7, // rubber on finished hardwood
    rollingResistance: 0.02,
    dragCoefficient: 0.5,
    maxLiftCoefficient: 0.3,
    spinDrag: 2e-5, // N*m*s, air torque on a spinning ball
    wallRestitution: 0.6,
  });
})();

// Lowest shell mode (oblate <-> prolate). Driven by the contact force, it adds
// the lingering squash and the stretch on the way back up. Visual only: it does
// not feed back into the rigid-body motion.
const SHELL_OMEGA = 2 * Math.PI * 16;
const SHELL_DAMPING = 0.3;
const SHELL_GAIN = 1.5; // strain rate per m/s of contact impulse
const PATCH = 0.4; // share of the compression that flattens into a contact patch
const DRILL = (3 * Math.PI) / 16; // torque arm of a uniform-pressure disc, in patch radii

const STEP = 1 / 4000;
const MAX_FRAME = 0.1;

const R = BALL.radius;
const M = BALL.mass;
const I = BALL.inertia;
const NET_WEIGHT = M * GRAVITY - AIR_DENSITY * BALL.volume * GRAVITY;

export function createBall({ x = 0, y = R, z = 0, q = [0, 0, 0, 1] } = {}) {
  return {
    p: [x, y, z],
    v: [0, 0, 0],
    w: [0, 0, 0], // angular velocity, world frame
    q: [...q], // orientation quaternion [x, y, z, w]
    s: 0, // shell-mode strain (vertical stretch as a fraction of R)
    sv: 0,
    acc: 0,
    still: 0,
    asleep: false,
  };
}

const F = { fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, sa: 0 };

function forces(ball, h) {
  const [, py] = ball.p;
  const [vx, vy, vz] = ball.v;
  const [wx, wy, wz] = ball.w;
  let fx = 0, fy = -NET_WEIGHT, fz = 0;
  let tx = -BALL.spinDrag * wx, ty = -BALL.spinDrag * wy, tz = -BALL.spinDrag * wz;
  let normal = 0;

  const speed = Math.hypot(vx, vy, vz);
  if (speed > 1e-6) {
    const q = 0.5 * AIR_DENSITY * BALL.area * speed;
    const drag = q * BALL.dragCoefficient;
    fx -= drag * vx; fy -= drag * vy; fz -= drag * vz;
    // Magnus lift along w x v, with a lift coefficient that follows the spin ratio.
    const cx = wy * vz - wz * vy, cy = wz * vx - wx * vz, cz = wx * vy - wy * vx;
    const cross = Math.hypot(cx, cy, cz);
    if (cross > 1e-9) {
      const spinRatio = (R * cross) / (speed * speed);
      const lift = (q * speed * Math.min(BALL.maxLiftCoefficient, spinRatio)) / cross;
      fx += lift * cx; fy += lift * cy; fz += lift * cz;
    }
  }

  const depth = R - py;
  if (depth > 0) {
    normal = Math.max(0, BALL.stiffness * depth - BALL.damping * vy);
    fy += normal;
    if (normal > 0) {
      // Velocity of the contact point: v + w x (0, -arm, 0).
      const arm = py;
      const sx = vx + wz * arm, sz = vz - wx * arm;
      const slip = Math.hypot(sx, sz);
      if (slip > 1e-9) {
        // Coulomb friction, capped at the force that would stop the slip this kick (stick).
        const stick = slip / (h * (1 / M + (arm * arm) / I));
        const ft = Math.min(BALL.friction * normal, stick) / slip;
        const ffx = -ft * sx, ffz = -ft * sz;
        fx += ffx; fz += ffz;
        tx -= arm * ffz; tz += arm * ffx;
      }
      const roll = Math.hypot(wx, wz);
      if (roll > 1e-9) {
        const tr = Math.min(BALL.rollingResistance * normal * R, (I * roll) / h) / roll;
        tx -= tr * wx; tz -= tr * wz;
      }
      // Pivoting friction over the contact patch slows spin about the vertical.
      const patch = Math.sqrt(depth * (2 * R - depth));
      const td = Math.min(DRILL * BALL.friction * normal * patch, (I * Math.abs(wy)) / h);
      ty -= Math.sign(wy) * td;
    }
  }

  F.fx = fx; F.fy = fy; F.fz = fz;
  F.tx = tx; F.ty = ty; F.tz = tz;
  F.sa = -SHELL_OMEGA * SHELL_OMEGA * ball.s - 2 * SHELL_DAMPING * SHELL_OMEGA * ball.sv - (SHELL_GAIN * normal) / M;
}

function kick(ball, h) {
  forces(ball, h);
  const { v, w } = ball;
  v[0] += (F.fx / M) * h; v[1] += (F.fy / M) * h; v[2] += (F.fz / M) * h;
  w[0] += (F.tx / I) * h; w[1] += (F.ty / I) * h; w[2] += (F.tz / I) * h;
  ball.sv += F.sa * h;
}

function drift(ball, h, env) {
  const { p, v, w, q } = ball;
  p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;
  ball.s += ball.sv * h;

  // dq/dt = 0.5 * (w, 0) * q
  const [qx, qy, qz, qw] = q;
  const k = 0.5 * h;
  q[0] = qx + k * (w[0] * qw + w[1] * qz - w[2] * qy);
  q[1] = qy + k * (w[1] * qw + w[2] * qx - w[0] * qz);
  q[2] = qz + k * (w[2] * qw + w[0] * qy - w[1] * qx);
  q[3] = qw - k * (w[0] * qx + w[1] * qy + w[2] * qz);
  const n = 1 / Math.hypot(q[0], q[1], q[2], q[3]);
  q[0] *= n; q[1] *= n; q[2] *= n; q[3] *= n;

  // The edges of the view act as walls so the ball cannot leave the scene.
  const e = BALL.wallRestitution;
  const limit = Math.max(0, env.halfWidthAt(p[2]));
  if (p[0] > limit) { p[0] = limit; if (v[0] > 0) v[0] *= -e; }
  else if (p[0] < -limit) { p[0] = -limit; if (v[0] < 0) v[0] *= -e; }
  if (p[2] > env.zMax) { p[2] = env.zMax; if (v[2] > 0) v[2] *= -e; }
  else if (p[2] < env.zMin) { p[2] = env.zMin; if (v[2] < 0) v[2] *= -e; }
}

// Advances the ball by one display frame using fixed leapfrog substeps.
// Returns the impacts that happened and, if the ball bottomed out against the floor
// during the frame, its pose at that deepest point: a contact lasts about one frame,
// so the caller can show that pose instead of missing the squash between two samples.
export function advance(ball, dt, env) {
  const frame = { impacts: [], peak: null };
  if (ball.asleep) return frame;

  ball.acc += Math.min(dt, MAX_FRAME);
  // Only a compression that was still deepening counts; a frame that starts on the
  // way back out has already shown its deepest point.
  let deepest = Math.max(0, R - ball.p[1]);
  while (ball.acc >= STEP) {
    ball.acc -= STEP;
    const before = R - ball.p[1];
    const vyIn = ball.v[1];
    kick(ball, STEP / 2);
    drift(ball, STEP, env);
    kick(ball, STEP / 2);
    const depth = R - ball.p[1];
    if (before <= 0 && depth > 0) frame.impacts.push({ speed: -vyIn });
    if (depth > deepest) {
      deepest = depth;
      frame.peak ??= { p: [0, 0, 0], q: [0, 0, 0, 1], s: 0, depth: 0 };
      const peak = frame.peak;
      peak.p[0] = ball.p[0]; peak.p[1] = ball.p[1]; peak.p[2] = ball.p[2];
      peak.q[0] = ball.q[0]; peak.q[1] = ball.q[1]; peak.q[2] = ball.q[2]; peak.q[3] = ball.q[3];
      peak.s = ball.s;
      peak.depth = depth;
    }
  }

  const quiet =
    R - ball.p[1] > 0 &&
    Math.hypot(ball.v[0], ball.v[1], ball.v[2]) < 0.003 &&
    Math.hypot(ball.w[0], ball.w[1], ball.w[2]) < 0.03 &&
    Math.abs(ball.sv) < 0.005;
  ball.still = quiet ? ball.still + dt : 0;
  if (ball.still > 0.5) {
    ball.asleep = true;
    ball.v[0] = ball.v[1] = ball.v[2] = 0;
    ball.w[0] = ball.w[1] = ball.w[2] = 0;
    ball.sv = 0;
  }
  return frame;
}

// Tosses the ball straight up. (ox, oy) is where it was struck, in ball radii from
// its centre as seen by the viewer: an off-centre hit sends it the other way with spin.
export function toss(ball, { speed = 4.4, ox = 0, oy = 0, rand = Math.random } = {}) {
  const jitter = () => rand() * 2 - 1;
  ball.asleep = false;
  ball.still = 0;
  ball.v[0] = ball.v[0] * 0.25 - ox * 0.3;
  ball.v[1] = speed;
  ball.v[2] = ball.v[2] * 0.25 - oy * 0.15 + jitter() * 0.05;
  ball.w[0] = ball.w[0] * 0.3 + jitter() * 2;
  ball.w[1] = ball.w[1] * 0.3 + jitter() * 5;
  ball.w[2] = ball.w[2] * 0.3 + ox * 5 + jitter();
  ball.sv -= SHELL_GAIN * speed; // the launch impulse squeezes the shell like a bounce does
}

// Rendered shape for a centre-of-mass height y and shell strain s: an ellipsoid with
// horizontal semi-axis a and vertical semi-axis b centred at height cy. Against the
// floor the top keeps following the centre of mass while the bottom flattens.
export function ballShape(y, s) {
  const free = R * (1 + s);
  let b = free, cy = y;
  if (y < free) {
    const top = y + free;
    const bottom = -PATCH * (free - y);
    b = (top - bottom) / 2;
    cy = (top + bottom) / 2;
  }
  return { a: R * Math.sqrt(R / b), b, cy }; // volume-preserving bulge
}

export function energy(ball) {
  const [vx, vy, vz] = ball.v;
  const [wx, wy, wz] = ball.w;
  const depth = Math.max(0, R - ball.p[1]);
  return (
    0.5 * M * (vx * vx + vy * vy + vz * vz) +
    0.5 * I * (wx * wx + wy * wy + wz * wz) +
    NET_WEIGHT * ball.p[1] +
    0.5 * BALL.stiffness * depth * depth
  );
}
