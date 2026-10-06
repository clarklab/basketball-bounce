import * as THREE from 'three';
import { createFloor } from './floor.js';
import { createBall } from './ball.js';
import { BasketballPhysics } from './physics.js';
import './style.css';

const canvas = document.querySelector('#court');
const target = document.querySelector('#ball-target');
const status = document.querySelector('#status');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch {
  document.querySelector('#fallback').hidden = false;
  target.hidden = true;
  throw new Error('This scene requires WebGL 2.');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, .045);
const camera = new THREE.PerspectiveCamera(50, 1, .025, 60);
camera.layers.enable(1);
const physics = new BasketballPhysics();
const floor = createFloor(renderer);
scene.add(floor);

const ambient = new THREE.HemisphereLight(0xcbd8ed, 0x5e3321, .78);
scene.add(ambient);
const key = new THREE.SpotLight(0xffebd8, 35, 14, Math.PI * .40, .9, 2);
key.position.set(1.6, 3.2, 2.1);
key.target.position.set(0, 0, -.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = .1;
key.shadow.camera.far = 12;
key.shadow.bias = -.00008;
key.shadow.normalBias = .001;
key.shadow.radius = 4;
scene.add(key, key.target);
const highlight = new THREE.PointLight(0xfff2dd, 5.0, 8, 2);
highlight.position.set(.85, 1.55, .45);
scene.add(highlight);
const rim = new THREE.PointLight(0xdce9ff, .85, 5, 2);
rim.position.set(-.15, 1.8, -.8);
scene.add(rim);

// World-axis deformation wraps a separate rotating ball so the impact always
// flattens against the floor, regardless of the current seam orientation.
const body = new THREE.Group();
const rotation = new THREE.Group();
const ball = createBall(physics.radius);
const initialOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.256, 0, 0));
ball.quaternion.copy(initialOrientation);
rotation.add(ball);
body.add(rotation);
scene.add(body);
ball.layers.enable(1);
const leatherFill = new THREE.AmbientLight(0xd3a385, 1.0);
leatherFill.layers.set(1);
scene.add(leatherFill);

// Soft occlusion supplements the dynamic light shadow at contact. It expands
// and fades continuously with height instead of sticking to the flying ball.
const shadowCanvas = document.createElement('canvas');
shadowCanvas.width = shadowCanvas.height = 256;
const shadowContext = shadowCanvas.getContext('2d');
const gradient = shadowContext.createRadialGradient(128, 128, 0, 128, 128, 128);
gradient.addColorStop(0, 'rgba(0,0,0,.72)');
gradient.addColorStop(.25, 'rgba(0,0,0,.57)');
gradient.addColorStop(.55, 'rgba(0,0,0,.22)');
gradient.addColorStop(1, 'rgba(0,0,0,0)');
shadowContext.fillStyle = gradient;
shadowContext.fillRect(0, 0, 256, 256);
const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  map: new THREE.CanvasTexture(shadowCanvas), transparent: true, opacity: .85,
  depthWrite: false, toneMapped: false,
}));
contactShadow.rotation.x = -Math.PI / 2;
contactShadow.position.y = .0007;
scene.add(contactShadow);

let width = 1, height = 1, maximumRise = 1.1;
let needsRender = true;
const projected = new THREE.Vector3();
const projectedEdge = new THREE.Vector3();
const cameraDistance = 1.60;
function resize() {
  needsRender = true;
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setSize(width, height);
  const aspect = width / height;
  camera.aspect = aspect;
  camera.fov = THREE.MathUtils.lerp(50, 41, THREE.MathUtils.smoothstep(aspect, .65, 1.6));
  const halfFrustum = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const pitch = halfFrustum * .034;
  camera.position.set(0, physics.radius + cameraDistance * halfFrustum * .564, cameraDistance);
  camera.lookAt(0, camera.position.y - pitch * cameraDistance, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  maximumRise = cameraDistance * halfFrustum * 1.25;
}
window.addEventListener('resize', resize);
resize();

let pressStart = 0;
let pressX = 0;
let pointerId = null;
function toss(hold = 0, horizontalOffset = 0) {
  needsRender = true;
  // Cap the target apex to the camera view even if caught and tossed midair.
  const currentRise = Math.max(0, physics.position.y - physics.radius);
  const available = Math.max(.035, maximumRise - currentRise);
  const rise = Math.min(available, maximumRise * (.80 + Math.min(hold, 750) / 750 * .20));
  const lateral = THREE.MathUtils.clamp(-physics.position.x * .35 + horizontalOffset * .07, -.08, .08);
  physics.toss({ height: rise, x: lateral, z: -physics.position.z * .3,
    spin: { x: .32, y: -.18, z: -.12 + horizontalOffset * .45 } });
  status.textContent = 'Basketball tossed.';
}
target.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointerId !== null) return;
  event.preventDefault();
  pointerId = event.pointerId;
  pressStart = performance.now();
  pressX = event.clientX;
  target.setPointerCapture(event.pointerId);
});
target.addEventListener('pointerup', event => {
  if (event.pointerId !== pointerId) return;
  const bounds = target.getBoundingClientRect();
  const offset = THREE.MathUtils.clamp((pressX - bounds.left - bounds.width / 2) / (bounds.width / 2), -1, 1);
  toss(performance.now() - pressStart, offset);
  target.releasePointerCapture(event.pointerId);
  pointerId = null;
});
target.addEventListener('pointercancel', () => { pointerId = null; });
target.addEventListener('click', event => { if (event.detail === 0) toss(); });
window.addEventListener('keydown', event => {
  if (event.code === 'KeyR') { needsRender = true; physics.reset(); status.textContent = 'Basketball reset.'; }
  if (event.code === 'Space' && event.target !== target) { event.preventDefault(); if (!event.repeat) toss(); }
});

function updateScene() {
  body.position.copy(physics.position);
  body.scale.copy(physics.scale);
  rotation.quaternion.copy(physics.quaternion);
  const elevation = Math.max(0, physics.position.y - physics.radius);
  contactShadow.position.x = physics.position.x;
  contactShadow.position.z = physics.position.z;
  const shadowSize = .32 + elevation * .40;
  contactShadow.scale.set(shadowSize * physics.scale.x, shadowSize, 1);
  contactShadow.material.opacity = .88 / (1 + elevation * 5.0);
  projected.copy(body.position).project(camera);
  projectedEdge.copy(body.position).add(new THREE.Vector3(physics.radius * physics.scale.x, 0, 0)).project(camera);
  const radiusPixels = Math.abs(projectedEdge.x - projected.x) * width / 2;
  const diameter = Math.max(44, radiusPixels * 2.08);
  target.style.width = `${diameter}px`;
  target.style.height = `${diameter * physics.scale.y / physics.scale.x}px`;
  target.style.transform = `translate(${(projected.x * .5 + .5) * width - diameter / 2}px, ${(-projected.y * .5 + .5) * height - diameter * physics.scale.y / physics.scale.x / 2}px)`;
}
let previous = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min((now - previous) / 1000, .05));
  previous = now;
  const wasMoving = !physics.sleeping;
  if (!document.hidden) physics.step(dt);
  if (!document.hidden && (needsRender || wasMoving || !physics.sleeping)) {
    updateScene();
    renderer.render(scene, camera);
    needsRender = false;
  }
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { previous = performance.now(); needsRender = true; });
updateScene();
requestAnimationFrame(frame);
