import * as THREE from 'three';
import { basketballSeamGLSL } from './seams.js';

function leatherTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#454545';
  context.fillRect(0, 0, size, size);
  let seed = 71823;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  const spacing = 8;
  for (let row = -1; row <= size / spacing; row++) {
    for (let column = -1; column <= size / spacing; column++) {
      const x = column * spacing + (row % 2) * spacing * .5 + random() * 1.7;
      const y = row * spacing + random() * 1.7;
      const radius = 2.6 + random() * .9;
      const brightness = 135 + random() * 80;
      const gradient = context.createRadialGradient(x - .5, y - .6, .1, x, y, radius);
      gradient.addColorStop(0, `rgb(${brightness},${brightness},${brightness})`);
      gradient.addColorStop(.6, '#999999');
      gradient.addColorStop(1, '#494949');
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(x, y, radius, radius * (.8 + random() * .2), random(), 0, Math.PI * 2);
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 3);
  texture.anisotropy = 8;
  return texture;
}

/** Analytic seams stay crisp at any size, including the UV texture seam. */
export function createBall(radius = .12) {
  const bump = leatherTexture();
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ac360e', roughness: .34, metalness: 0,
    clearcoat: .30, clearcoatRoughness: .23,
    bumpMap: bump, bumpScale: .00020,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLeatherPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeatherPosition = normalize(position);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vLeatherPosition;
      ${basketballSeamGLSL}
    `).replace('#include <map_fragment>', `#include <map_fragment>
      vec3 leatherPoint = normalize(vLeatherPosition);
      float channelDistance = ballSeams(leatherPoint);
      float channel = 1.0 - smoothstep(0.010, 0.021, channelDistance);
      float panelNoise = sin(leatherPoint.x * 83.0 + sin(leatherPoint.y * 59.0)) * sin(leatherPoint.z * 101.0) * 0.015;
      diffuseColor.rgb *= 1.0 + panelNoise;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.011, 0.013, 0.010), channel * 0.97);
    `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float channelHeight = -0.00055 * (1.0 - smoothstep(0.003, 0.030, channelDistance));
      normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(channelHeight), dFdy(channelHeight)), faceDirection);
    `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.73, channel);
    `);
  };
  material.customProgramCacheKey = () => 'basketball-leather-continuous-seams-v2';
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 96), material);
  ball.name = 'Pebbled leather basketball';
  ball.castShadow = true;
  ball.receiveShadow = true;
  return ball;
}
