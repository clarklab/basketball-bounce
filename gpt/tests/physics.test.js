import test from 'node:test';
import assert from 'node:assert/strict';
import { BasketballPhysics } from '../src/physics.js';

const advance = (ball, duration, frame = 1 / 60) => {
  for (let i = 0; i < Math.round(duration / frame); i++) ball.step(frame);
};

test('a resting ball remains still indefinitely', () => {
  const ball = new BasketballPhysics();
  advance(ball, 60);
  assert.deepEqual(ball.position, { x: 0, y: 0.12, z: 0 });
  assert.deepEqual(ball.scale, { x: 1, y: 1, z: 1 });
  assert.equal(ball.sleeping, true);
});

test('the initial arc follows gravity to the requested apex', () => {
  const ball = new BasketballPhysics().toss({ height: 1.15 });
  let highest = 0;
  while (ball.velocity.y > 0) {
    ball.step(1 / 960);
    highest = Math.max(highest, ball.position.y);
  }
  assert.ok(Math.abs(highest - 1.27) < 0.004, `apex: ${highest}`);
});

test('a compliant impact returns the specified fraction of vertical speed', () => {
  const ball = new BasketballPhysics().toss({ height: 1.15 });
  while (ball.impactCount === 0) ball.step(1 / 960);
  const incoming = ball.lastImpactSpeed;
  while (ball.position.y <= ball.radius) ball.step(1 / 960);
  const ratio = ball.velocity.y / incoming;
  assert.ok(Math.abs(ratio - 0.77) < 0.03, `restitution: ${ratio}`);
});

test('contact deforms visibly without changing volume or going below the floor', () => {
  const ball = new BasketballPhysics().toss({ height: 1.3 });
  let maximumCompression = 0;
  let maximumStretch = 1;
  for (let i = 0; i < 4 * 960; i++) {
    ball.step(1 / 960);
    maximumCompression = Math.max(maximumCompression, ball.compression);
    maximumStretch = Math.max(maximumStretch, ball.scale.y);
    assert.ok(ball.position.y - ball.radius * ball.scale.y >= -1e-12);
    assert.ok(Math.abs(ball.scale.x * ball.scale.y * ball.scale.z - 1) < 1e-12);
    assert.ok(ball.position.y > 0.08);
  }
  assert.ok(maximumCompression > 0.015 && maximumCompression < 0.04);
  assert.ok(maximumStretch > 1.005 && maximumStretch <= 1.055);
});

test('30, 60, and 120 Hz rendering produce identical physics', () => {
  const balls = [30, 60, 120].map((fps) => {
    const ball = new BasketballPhysics().toss({ height: 1.15, x: 0.045, z: -0.01 });
    advance(ball, 4, 1 / fps);
    return ball;
  });
  for (const ball of balls.slice(1)) {
    assert.deepEqual(ball.position, balls[0].position);
    assert.deepEqual(ball.velocity, balls[0].velocity);
    assert.deepEqual(ball.quaternion, balls[0].quaternion);
    assert.deepEqual(ball.scale, balls[0].scale);
  }
});

test('energy dissipates into stable rest, with a normalized spin quaternion', () => {
  const ball = new BasketballPhysics().toss({ height: 1.2, x: 0.04 });
  advance(ball, 12);
  assert.equal(ball.sleeping, true);
  assert.equal(ball.position.y, ball.radius);
  assert.deepEqual(ball.velocity, { x: 0, y: 0, z: 0 });
  assert.deepEqual(ball.scale, { x: 1, y: 1, z: 1 });
  assert.ok(Math.abs(Math.hypot(...Object.values(ball.quaternion)) - 1) < 1e-12);
  assert.ok(ball.impactCount >= 5);
});

test('another click launches an already falling ball upward', () => {
  const ball = new BasketballPhysics().toss();
  advance(ball, 0.65);
  assert.ok(ball.velocity.y < 0);
  const y = ball.position.y;
  ball.toss({ height: 0.4, x: -0.02 });
  assert.equal(ball.position.y, y);
  assert.ok(ball.velocity.y > 0);
  assert.equal(ball.velocity.x, -0.02);
});
