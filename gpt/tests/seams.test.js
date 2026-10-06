import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSeamDistances, windingField, windingPoint, SEAM_BASIS } from '../src/seams.js';

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const length = vector => Math.hypot(...vector);
const normalize = vector => vector.map(value => value / length(vector));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const minimumDistance = point => Math.min(...canonicalSeamDistances(point));

test('the rendered seams divide the entire sphere into eight equal connected panels', () => {
  // Flood-fill the actual groove-distance mask, including the back and both
  // poles. A front-only arrangement of independent oval caps fails this test.
  const rows = 256;
  const columns = 512;
  const labels = new Int16Array(rows * columns).fill(-1);
  const areaWeights = new Float64Array(rows);
  for (let row = 0; row < rows; row++) {
    const latitude = -Math.PI / 2 + (row + 0.5) * Math.PI / rows;
    const radial = Math.cos(latitude);
    areaWeights[row] = radial;
    for (let column = 0; column < columns; column++) {
      const angle = (column + 0.5) * Math.PI * 2 / columns;
      const point = [radial * Math.cos(angle), radial * Math.sin(angle), Math.sin(latitude)];
      if (minimumDistance(point) < 0.020) labels[row * columns + column] = -2;
    }
  }
  const areas = [];
  const queue = new Int32Array(labels.length);
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1) continue;
    const region = areas.length;
    labels[start] = region;
    queue[0] = start;
    let head = 0;
    let tail = 1;
    let area = 0;
    while (head < tail) {
      const current = queue[head++];
      const row = Math.floor(current / columns);
      const column = current % columns;
      area += areaWeights[row];
      const neighbors = [row * columns + (column + 1) % columns,
        row * columns + (column + columns - 1) % columns];
      if (row > 0) neighbors.push(current - columns);
      if (row < rows - 1) neighbors.push(current + columns);
      for (const neighbor of neighbors) {
        if (labels[neighbor] === -1) {
          labels[neighbor] = region;
          queue[tail++] = neighbor;
        }
      }
    }
    areas.push(area);
  }
  assert.equal(areas.length, 8, `connected panels: ${areas.length}`);
  const mean = areas.reduce((sum, value) => sum + value, 0) / areas.length;
  assert.ok(areas.every(area => Math.abs(area / mean - 1) < 0.005), `panel areas: ${areas}`);
});

test('the winding seam is closed, stays on the ball, and never crosses itself', () => {
  const samples = Array.from({ length: 720 }, (_, index) => windingPoint(index * Math.PI * 2 / 720));
  assert.ok(length(subtract(windingPoint(0), windingPoint(Math.PI * 2))) < 1e-12);
  for (let index = 0; index < samples.length; index++) {
    const point = samples[index];
    assert.ok(Math.abs(length(point) - 1) < 1e-12);
    assert.ok(canonicalSeamDistances(point)[2] < 1e-12);
    // Tight turns are sampled more densely than the broad arcs: check each
    // quarter-step instead of imposing an angle-to-distance speed limit.
    const angle = index * Math.PI * 2 / samples.length;
    for (let substep = 0; substep < 4; substep++) {
      const a = windingPoint(angle + substep / 4 * Math.PI * 2 / samples.length);
      const b = windingPoint(angle + (substep + 1) / 4 * Math.PI * 2 / samples.length);
      assert.ok(length(subtract(a, b)) < 0.020);
    }
    for (let other = index + 12; other < samples.length; other++) {
      if (samples.length - other + index < 12) continue;
      assert.ok(length(subtract(point, samples[other])) > 0.025,
        `nonadjacent seam approaches itself at samples ${index}, ${other}`);
    }
  }
});

test('the winding seam crosses each great circle exactly twice, away from the two poles', () => {
  const counts = [0, 0];
  const steps = 2000;
  for (let index = 0; index < steps; index++) {
    const before = windingPoint((index + 0.37) * Math.PI * 2 / steps);
    const after = windingPoint((index + 1.37) * Math.PI * 2 / steps);
    for (let axis = 0; axis < 2; axis++) if (before[axis] * after[axis] < 0) counts[axis]++;
  }
  assert.deepEqual(counts, [2, 2]);
  for (const pole of [[0, 0, 1], [0, 0, -1]]) {
    assert.ok(Math.abs(windingField(pole)) > 0.1, 'three seams must not meet at a pole');
  }
});

test('groove width is consistent along both front and back curves', () => {
  const offset = 0.012;
  let largestRelativeError = 0;
  const hemispheres = new Set();
  for (let index = 0; index < 360; index++) {
    const angle = (index + 0.25) * Math.PI * 2 / 360;
    const point = windingPoint(angle);
    // Derive the perpendicular direction geometrically from the curve, rather
    // than reusing the shader's field gradient or distance normalization.
    const tangent = subtract(windingPoint(angle + 1e-5), windingPoint(angle - 1e-5));
    const across = normalize(cross(point, tangent));
    hemispheres.add(Math.sign(point[2]));
    for (const side of [-1, 1]) {
      const displaced = point.map((value, axis) => value * Math.cos(offset) + side * across[axis] * Math.sin(offset));
      const measured = canonicalSeamDistances(displaced)[2];
      largestRelativeError = Math.max(largestRelativeError, Math.abs(measured / offset - 1));
    }
  }
  assert.equal(hemispheres.size, 2);
  assert.ok(largestRelativeError < 0.04, `width variation: ${largestRelativeError}`);
});

test('all eight panels are congruent and rotating the material axes preserves the shape', () => {
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(length(SEAM_BASIS[axis]) - 1) < 1e-12);
    for (let other = axis + 1; other < 3; other++) assert.ok(Math.abs(dot(SEAM_BASIS[axis], SEAM_BASIS[other])) < 1e-12);
  }
  assert.ok(dot(cross(SEAM_BASIS[0], SEAM_BASIS[1]), SEAM_BASIS[2]) > 0.999999999999);
  const regions = new Set();
  let point = normalize([0.30, 0.40, 0.86]);
  const originalDistance = minimumDistance(point);
  for (let turn = 0; turn < 4; turn++) {
    for (const reflection of [-1, 1]) {
      const equivalent = [point[0] * reflection, point[1], point[2]];
      regions.add([Math.sign(equivalent[0]), Math.sign(equivalent[1]), Math.sign(windingField(equivalent))].join(','));
      assert.ok(Math.abs(minimumDistance(equivalent) - originalDistance) < 1e-12);
      const world = [0, 1, 2].map(axis => equivalent.reduce((sum, value, i) => sum + value * SEAM_BASIS[i][axis], 0));
      const recovered = SEAM_BASIS.map(axis => dot(world, axis));
      assert.ok(length(subtract(equivalent, recovered)) < 1e-12);
    }
    point = [-point[1], point[0], -point[2]];
  }
  assert.equal(regions.size, 8);
});
