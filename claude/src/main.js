import { BALL, GRAVITY, createBall, advance, toss, ballShape } from './physics.js';
import { Renderer } from './renderer.js';
import { createAudio } from './audio.js';

const R = BALL.radius;
const rad = (deg) => (deg * Math.PI) / 180;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a) => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};

// Camera recovered from the reference frame: a 34 degree portrait view from 56 cm
// above the floor, 2.42 m from the ball, with the horizon 47.4% of the way down.
// The ball rests at the origin.
const VIEW = { height: 0.559, distance: 2.422, lensShift: 0.0526, fovPortrait: 34, fovLandscape: 28.5 };
const MAX_PIXELS = 5e6;

function quatFromBasis(x, y, z) {
  const trace = x[0] + y[1] + z[2];
  let q;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = 2 * Math.sqrt(1 + x[0] - y[1] - z[2]);
    q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  } else if (y[1] > z[2]) {
    const s = 2 * Math.sqrt(1 + y[1] - x[0] - z[2]);
    q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + z[2] - x[0] - y[1]);
    q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
  }
  return q;
}

function quatToMat3([x, y, z, w], out) {
  out[0] = 1 - 2 * (y * y + z * z); out[1] = 2 * (x * y + z * w); out[2] = 2 * (x * z - y * w);
  out[3] = 2 * (x * y - z * w); out[4] = 1 - 2 * (x * x + z * z); out[5] = 2 * (y * z + x * w);
  out[6] = 2 * (x * z + y * w); out[7] = 2 * (y * z - x * w); out[8] = 1 - 2 * (x * x + y * y);
  return out;
}

// Orientation of the ball in the reference frame. In the ball's own frame the side
// seams loop around +-x and the two great circles cross on +-z; on screen that crossing
// sits up and right of centre and the x axis leans 22.5 degrees clockwise from vertical.
function restOrientation() {
  const toCamera = normalize([0, VIEW.height - R, VIEW.distance]);
  const right = [1, 0, 0];
  const up = cross(toCamera, right);
  const toWorld = (a) => [0, 1, 2].map((i) => a[0] * right[i] + a[1] * up[i] + a[2] * toCamera[i]);
  const z = toWorld(normalize([0.097, 0.246, 0.964]));
  const lean = toWorld([0.383, 0.924, 0]);
  const along = dot(lean, z);
  const x = normalize(lean.map((c, i) => c - along * z[i]));
  return quatFromBasis(x, cross(z, x), z);
}

const canvas = document.getElementById('scene');
const muteButton = document.getElementById('mute');

function start() {
  let renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (error) {
    console.error(error);
    document.body.classList.add('unsupported');
    return;
  }

  const audio = createAudio();
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ball = createBall({ y: calm ? R : R + 0.62, q: restOrientation() });
  const env = { halfWidthAt: () => 1, zMin: -1.5, zMax: 0.2 };
  const pose = { position: [0, R, 0], axes: [R, R, R], rotation: new Float32Array(9), radius: R };
  let camera = null;
  let aspect = 1;
  let tossSpeed = 4.4;

  function setPose(p, q, s) {
    const shape = ballShape(p[1], s);
    pose.position[0] = p[0]; pose.position[1] = shape.cy; pose.position[2] = p[2];
    pose.axes[0] = shape.a; pose.axes[1] = shape.b; pose.axes[2] = shape.a;
    quatToMat3(q, pose.rotation);
  }

  function layout() {
    const cssWidth = canvas.clientWidth, cssHeight = canvas.clientHeight;
    if (!cssWidth || !cssHeight) return;
    let dpr = Math.min(window.devicePixelRatio || 1, 3);
    dpr = Math.min(dpr, Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight)));
    renderer.resize(Math.max(1, Math.round(cssWidth * dpr)), Math.max(1, Math.round(cssHeight * dpr)));

    // Wide windows get a slightly tighter lens. Lowering the camera with it keeps the
    // ball's resting spot at the same height on screen.
    aspect = cssWidth / cssHeight;
    const portrait = Math.tan(rad(VIEW.fovPortrait) / 2);
    const wide = smoothstep(0.62, 1.5, aspect);
    const tanHalfFov = Math.tan(rad(VIEW.fovPortrait + (VIEW.fovLandscape - VIEW.fovPortrait) * wide) / 2);
    camera = {
      position: [0, (VIEW.height * tanHalfFov) / portrait, VIEW.distance],
      tanHalfFov,
      lensShift: VIEW.lensShift,
    };
    renderer.setCamera(camera);

    env.halfWidthAt = (z) => (VIEW.distance - z) * tanHalfFov * aspect - 0.9 * R;
    const limit = Math.max(0, env.halfWidthAt(ball.p[2]));
    ball.p[0] = Math.max(-limit, Math.min(limit, ball.p[0])); // a narrower window may have passed it
    // A toss carries the ball to just under the top edge of the view.
    const top = camera.position[1] + (1 - VIEW.lensShift) * tanHalfFov * VIEW.distance;
    tossSpeed = 1.015 * Math.sqrt(2 * GRAVITY * Math.max(0.3, top - 2.3 * R));
    // Resizing clears the canvas, so redraw now rather than a frame later.
    step(0);
    wake();
  }

  // Closest approach of the view ray through a pointer position to the ball,
  // measured in ball radii from its centre (x right, y up).
  function aim(event) {
    const rect = canvas.getBoundingClientRect();
    const nx = (((event.clientX - rect.left) / rect.width) * 2 - 1) * aspect;
    const ny = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    const dir = normalize([nx * camera.tanHalfFov, (ny - camera.lensShift) * camera.tanHalfFov, -1]);
    const toBall = pose.position.map((c, i) => c - camera.position[i]);
    const t = dot(toBall, dir);
    const miss = dir.map((c, i) => c * t - toBall[i]);
    return { x: miss[0] / R, y: miss[1] / R, distance: Math.hypot(...miss) / R };
  }

  function throwBall(x = 0, y = 0) {
    toss(ball, { speed: tossSpeed, ox: Math.max(-1, Math.min(1, x)), oy: Math.max(-1, Math.min(1, y)) });
    wake();
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    audio.unlock();
    const hit = aim(event);
    if (hit.distance <= (event.pointerType === 'mouse' ? 1.1 : 1.4)) throwBall(hit.x, hit.y);
  });
  // A touch only counts as a user gesture once the finger lifts.
  canvas.addEventListener('pointerup', () => audio.unlock());
  canvas.addEventListener('touchend', () => audio.unlock(), { passive: true });

  // The ball moves under a still mouse, so the cursor is rechecked every frame.
  let hover = null;
  function updateCursor() {
    const cursor = hover && aim(hover).distance <= 1.1 ? 'pointer' : '';
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }
  canvas.addEventListener('pointermove', (event) => {
    hover = event.pointerType === 'mouse' ? { clientX: event.clientX, clientY: event.clientY } : null;
    updateCursor();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    updateCursor();
  });
  window.addEventListener('keydown', (event) => {
    if (event.target === muteButton || event.repeat) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      audio.unlock();
      throwBall();
    }
  });

  let muted = false;
  try { muted = localStorage.getItem('bounce-muted') === '1'; } catch { /* storage unavailable */ }
  const applyMute = () => {
    audio.setMuted(muted);
    muteButton.setAttribute('aria-pressed', String(muted));
  };
  applyMute();
  muteButton.addEventListener('click', () => {
    muted = !muted;
    applyMute();
    audio.unlock();
    try { localStorage.setItem('bounce-muted', muted ? '1' : '0'); } catch { /* storage unavailable */ }
  });

  // The loop only runs while something is changing: the ball is moving or the
  // floor is still accumulating samples.
  let request = 0;
  let last = null;
  let paused = false;
  function wake() {
    if (!request && !paused) request = requestAnimationFrame(tick);
  }
  function step(dt) {
    const frame = advance(ball, dt, env);
    for (const impact of frame.impacts) audio.impact(impact.speed);

    // A bounce is over in about a frame. If the deepest moment fell between two
    // frames, show it rather than the ball already on its way back up.
    const peak = frame.peak;
    if (peak && peak.depth > 0.003 && peak.depth > R - ball.p[1] + 0.002) setPose(peak.p, peak.q, peak.s);
    else setPose(ball.p, ball.q, ball.s);
    renderer.render(pose);
    updateCursor();
  }
  function tick(now) {
    request = 0;
    step(last === null ? 0 : Math.min((now - last) / 1000, 0.1));
    last = now;
    if (!ball.asleep || renderer.baking) wake();
    else last = null;
  }

  new ResizeObserver(layout).observe(canvas);
  // Moving the window to a screen with another pixel density changes no CSS size.
  const watchDensity = () => {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', () => { layout(); watchDensity(); }, { once: true });
  };
  watchDensity();
  canvas.addEventListener('webglcontextrestored', wake);
  layout();

  if (new URLSearchParams(location.search).has('debug')) {
    // Console handle for poking at the simulation: bounce.toss(), bounce.pause(true),
    // bounce.step(1 / 60), ...
    window.bounce = {
      ball, renderer, pose, step, toss: throwBall,
      pause(value) {
        paused = value;
        last = null;
        wake();
      },
      // Colours at [x, y] canvas pixels (y down) of a freshly rendered frame.
      probe(points) {
        step(0);
        const gl = renderer.gl, px = new Uint8Array(4);
        return points.map(([x, y]) => {
          gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return [px[0], px[1], px[2]];
        });
      },
    };
  }
}

start();
