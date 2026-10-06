import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL, GRAVITY, createBall, advance, toss, ballShape, energy } from '../src/physics.js';

const R = BALL.radius;
const OPEN = { halfWidthAt: () => 100, zMin: -100, zMax: 100 };
const FRAME = 1 / 60;

function run(ball, seconds, env = OPEN, onFrame) {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i++) {
    const frame = advance(ball, FRAME, env);
    if (onFrame) onFrame(frame, i);
  }
}

test('falls under gravity at the analytic rate', () => {
  const ball = createBall({ y: R + 1 });
  let t = 0;
  while (ball.p[1] > R) { advance(ball, FRAME, OPEN); t += FRAME; }
  const ideal = Math.sqrt(2 / GRAVITY);
  // Drag and buoyancy slow it slightly; one frame of quantisation on top.
  assert.ok(t >= ideal - FRAME && t < ideal * 1.03 + FRAME, `fell in ${t}s, ideal ${ideal}s`);
});

test('rebounds like a regulation ball (drop 1.8 m, return 1.2-1.4 m at the top)', () => {
  // FIBA: dropped from 1.8 m (bottom of ball), the top must rebound to 1.2-1.4 m.
  const ball = createBall({ y: R + 1.8 });
  let bounced = false, apex = 0;
  run(ball, 2.2, OPEN, () => {
    if (ball.v[1] > 0) bounced = true;
    if (bounced) apex = Math.max(apex, ball.p[1] + R);
  });
  assert.ok(apex > 1.15 && apex < 1.45, `top of ball rebounded to ${apex.toFixed(3)} m`);
});

test('never gains energy while bouncing', () => {
  const ball = createBall({ y: R + 1.2 });
  ball.w = [3, 2, -4];
  ball.v = [0.4, 0, -0.2];
  let prev = energy(ball), worst = 0;
  run(ball, 6, OPEN, () => {
    const e = energy(ball);
    worst = Math.max(worst, e - prev);
    prev = e;
  });
  assert.ok(worst < 2e-3, `energy rose by ${worst} J in a frame`);
});

test('settles on the floor and goes to sleep', () => {
  const ball = createBall({ y: R + 0.8 });
  run(ball, 12);
  assert.equal(ball.asleep, true);
  const sag = BALL.mass * GRAVITY / BALL.stiffness;
  assert.ok(Math.abs(ball.p[1] - (R - sag)) < 2e-4, `rest height ${ball.p[1]}`);
  assert.deepEqual(ball.v, [0, 0, 0]);
});

test('a toss from rest reaches the ballistic apex and comes back', () => {
  const ball = createBall();
  run(ball, 1);
  toss(ball, { speed: 4.4, rand: () => 0.5 });
  assert.equal(ball.asleep, false);
  let apex = 0;
  run(ball, 1.2, OPEN, () => { apex = Math.max(apex, ball.p[1]); });
  const ideal = R + 4.4 ** 2 / (2 * GRAVITY);
  assert.ok(apex < ideal && apex > ideal * 0.95, `apex ${apex.toFixed(3)} vs ideal ${ideal.toFixed(3)}`);
  run(ball, 10);
  assert.equal(ball.asleep, true);
});

test('spin grips the floor and kicks the ball sideways', () => {
  // Contact point moves +x when wz > 0, so friction pushes the ball toward -x.
  const ball = createBall({ y: R + 0.5 });
  ball.w = [0, 0, 20];
  let bounced = false;
  run(ball, 0.6, OPEN, () => { if (ball.v[1] > 0) bounced = true; });
  assert.ok(bounced);
  assert.ok(ball.v[0] < -0.3, `vx after bounce ${ball.v[0]}`);
  assert.ok(ball.w[2] < 20 && ball.w[2] > 0, `spin after bounce ${ball.w[2]}`);
});

test('spin in flight curves the path (Magnus lift)', () => {
  const still = createBall({ y: R + 3 });
  const spun = createBall({ y: R + 3 });
  still.v = [3, 0, 0];
  spun.v = [3, 0, 0];
  spun.w = [0, 0, 25]; // w x v points +y: lift
  run(still, 0.5);
  run(spun, 0.5);
  assert.ok(spun.p[1] > still.p[1] + 0.01, `lifted by ${spun.p[1] - still.p[1]} m`);
});

test('rolling ball comes to a stop', () => {
  const ball = createBall();
  ball.v = [0.8, 0, 0];
  ball.w = [0, 0, -0.8 / R];
  run(ball, 30);
  assert.equal(ball.asleep, true);
  assert.ok(ball.p[0] > 0.3, `rolled ${ball.p[0]} m`);
});

test('side walls keep the ball in play', () => {
  const env = { halfWidthAt: () => 0.4, zMin: -1, zMax: 0.3 };
  const ball = createBall({ y: R + 0.6 });
  ball.v = [2.5, 0, 1.5];
  let maxX = 0, maxZ = 0;
  run(ball, 5, env, () => {
    maxX = Math.max(maxX, Math.abs(ball.p[0]));
    maxZ = Math.max(maxZ, ball.p[2]);
  });
  assert.ok(maxX <= 0.4 + 1e-6, `x reached ${maxX}`);
  assert.ok(maxZ <= 0.3 + 1e-6, `z reached ${maxZ}`);
});

test('shape is a sphere in flight and squashes against the floor', () => {
  const free = ballShape(R + 0.5, 0);
  assert.ok(Math.abs(free.a - R) < 1e-12 && Math.abs(free.b - R) < 1e-12);
  assert.equal(free.cy, R + 0.5);

  const pressed = ballShape(R - 0.025, 0);
  assert.ok(pressed.b < R, 'shorter');
  assert.ok(pressed.a > R, 'wider');
  assert.ok(pressed.cy - pressed.b <= 0, 'flat patch sits on the floor');
  assert.ok(Math.abs(pressed.cy + pressed.b - (2 * R - 0.025)) < 1e-12, 'top follows the centre of mass');
});

test('reports each impact and the deepest compression of the frame', () => {
  const ball = createBall({ y: R + 1 });
  const impacts = [];
  let deepest = 0;
  run(ball, 1.2, OPEN, (frame) => {
    impacts.push(...frame.impacts);
    if (frame.peak) deepest = Math.max(deepest, frame.peak.depth);
  });
  assert.ok(impacts.length >= 1);
  assert.ok(Math.abs(impacts[0].speed - Math.sqrt(2 * GRAVITY)) < 0.15, `impact speed ${impacts[0].speed}`);
  // A pressurised shell at this speed compresses by v*sqrt(m/k).
  const expected = impacts[0].speed * Math.sqrt(BALL.mass / BALL.stiffness);
  assert.ok(Math.abs(deepest - expected) / expected < 0.12, `depth ${deepest} vs ${expected}`);
});

test('the deepest pose is reported once per bounce, not again on the way back up', () => {
  for (const drop of [0.5, 0.75, 1, 1.1]) {
    const ball = createBall({ y: R + drop });
    let held = 0;
    run(ball, 0.75, OPEN, (frame) => {
      if (frame.peak && frame.peak.depth > R - ball.p[1] + 0.002) held++;
    });
    assert.ok(held <= 1, `drop ${drop} m held the squash for ${held} frames`);
  }
});
