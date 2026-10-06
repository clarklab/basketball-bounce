import * as THREE from 'three';

// The board dimensions and grain live in world units, so the material continues
// to read as hardwood when the camera moves close to the floor.
const TEXTURE_SIZE = 2048;
const BOARD_COUNT = 32;
const PATCH_WIDTH = 2.56;
const PATCH_DEPTH = 4.48;
const FLOOR_SIZE = 80;

function randomGenerator(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, y, seed) {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx *= fx * (3 - 2 * fx);
  fy *= fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  return canvas;
}

function makeWoodTextures(renderer) {
  const colorCanvas = makeCanvas();
  const bumpCanvas = makeCanvas();
  const roughnessCanvas = makeCanvas();
  const colorContext = colorCanvas.getContext('2d');
  const bumpContext = bumpCanvas.getContext('2d');
  const roughnessContext = roughnessCanvas.getContext('2d');
  const colorImage = colorContext.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const bumpImage = bumpContext.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const roughnessImage = roughnessContext.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const colors = colorImage.data;
  const bumps = bumpImage.data;
  const roughness = roughnessImage.data;
  const boardWidth = TEXTURE_SIZE / BOARD_COUNT;
  const random = randomGenerator(207031);

  for (let column = 0; column < BOARD_COUNT; column += 1) {
    // Wrap one complete staggered column. No horizontal line crosses the patch.
    const offset = Math.floor(random() * TEXTURE_SIZE);
    const numberOfBoards = 8 + Math.floor(random() * 2);
    const weights = Array.from({ length: numberOfBoards }, () => 0.62 + random() * 0.7);
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const boards = [];
    let start = 0;

    for (let index = 0; index < numberOfBoards; index += 1) {
      const end = index === numberOfBoards - 1
        ? TEXTURE_SIZE
        : start + Math.round((weights[index] / weightTotal) * TEXTURE_SIZE);
      const tone = (random() - 0.5) * 48;
      const warmth = (random() - 0.5) * 12;
      const length = end - start;
      const knotCount = random() < 0.73 ? (random() < 0.3 ? 2 : 1) : 0;
      const knots = Array.from({ length: knotCount }, () => ({
        x: boardWidth * (0.14 + random() * 0.72),
        y: length * (0.12 + random() * 0.76),
        width: 3.4 + random() * 6.5,
        height: 8 + random() * 15,
        skew: (random() - 0.5) * 2.6,
        strength: 0.65 + random() * 0.5,
      }));
      boards.push({
        start,
        end,
        length,
        red: 168 + tone + warmth,
        green: 104 + tone * 0.7 + warmth * 0.1,
        blue: 51 + tone * 0.42 - warmth * 0.4,
        seed: Math.floor(random() * 65536),
        phase: random() * Math.PI * 2,
        bow: (random() - 0.5) * 10,
        growthX: boardWidth * (-0.6 + random() * 2.2),
        growthY: length * (-0.2 + random() * 1.4),
        finish: random() * 22,
        knots,
      });
      start = end;
    }

    for (let y = 0; y < TEXTURE_SIZE; y += 1) {
      const wrappedY = (y + offset) % TEXTURE_SIZE;
      const board = boards.find((entry) => wrappedY >= entry.start && wrappedY < entry.end);
      const localY = wrappedY - board.start;
      const endDistance = Math.min(localY, board.length - 1 - localY);
      const endSeam = Math.exp(-endDistance * 1.55);
      const curve = Math.sin(localY * 0.009 + board.phase) * 1.7
        + Math.sin(localY * 0.027 + board.phase * 2) * 0.52
        + board.bow * Math.sin((localY / board.length) * Math.PI);

      for (let x = 0; x < boardWidth; x += 1) {
        let grainX = x + curve;
        let knotShade = 0;
        let knotDepth = 0;

        for (const knot of board.knots) {
          const dy = (localY - knot.y) / knot.height;
          const dx = (x - knot.x + Math.sin(dy * 1.8) * knot.skew) / knot.width;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < 48) {
            // Grain flows around the knots instead of painting dots over it.
            grainX += ((x - knot.x) * 4.2) / (1 + distanceSquared);
            const distance = Math.sqrt(distanceSquared);
            const irregularity = noise(x * 0.29, localY * 0.2, board.seed + 1741);
            const core = Math.exp(-distanceSquared * (1.05 + irregularity * 1.3));
            const rings = Math.sin(distance * 13 + irregularity * 3)
              * Math.exp(-distance * 0.66);
            const split = Math.exp(-Math.abs(dx + Math.sin(dy * 5) * 0.14) * 15)
              * Math.exp(-Math.abs(dy) * 0.7);
            knotShade += (-core * 79 + rings * 11 - split * 18) * knot.strength;
            knotDepth += core * 12;
          }
        }

        const broadGrain = noise(grainX * 0.105, localY * 0.009, board.seed);
        const fineGrain = noise(grainX * 0.74, localY * 0.035, board.seed + 917);
        const grainPores = noise(grainX * 1.7, localY * 0.23, board.seed + 4381);
        const waviness = noise(grainX * 0.028, localY * 0.022, board.seed + 219);
        const growthDX = grainX - board.growthX;
        const growthDY = (localY - board.growthY) * 0.13;
        const growthRadius = Math.sqrt(growthDX * growthDX + growthDY * growthDY);
        const growthRings = Math.pow(Math.max(0,
          Math.sin(growthRadius * 0.85 + waviness * 5 + broadGrain * 1.4)), 7)
          * (3 + fineGrain * 5);
        const brokenPores = Math.pow(Math.max(0, 0.44 - grainPores), 1.4) * 34;
        const fiber = Math.pow(Math.max(0, 0.66 - fineGrain), 2) * 30;
        const fleck = hash(x, localY, board.seed) - 0.5;
        const grainShade = (broadGrain - 0.5) * 30
          + (fineGrain - 0.5) * 10
          + (waviness - 0.5) * 10
          + (grainPores - 0.5) * 3.5
          + fleck * 2.2 - fiber + knotShade - growthRings - brokenPores;

        const edgeDistance = Math.min(x, boardWidth - 1 - x);
        const sideSeam = Math.exp(-edgeDistance * 1.8);
        const seam = Math.max(sideSeam, endSeam * 0.87);
        const seamDarkening = 1 - seam * 0.64;
        // A very small light bevel makes each board distinct at grazing angles.
        const bevel = x === 2 ? 3 : 0;
        const pixel = (y * TEXTURE_SIZE + column * boardWidth + x) * 4;
        colors[pixel] = (board.red + grainShade + bevel) * seamDarkening;
        colors[pixel + 1] = (board.green + grainShade * 0.78 + bevel) * seamDarkening;
        colors[pixel + 2] = (board.blue + grainShade * 0.49 + bevel) * seamDarkening;
        colors[pixel + 3] = 255;

        const height = 151 - seam * 108 + (fineGrain - 0.5) * 8
          + (grainPores - 0.5) * 4 - knotDepth;
        bumps[pixel] = height;
        bumps[pixel + 1] = height;
        bumps[pixel + 2] = height;
        bumps[pixel + 3] = 255;

        const surface = 184 + board.finish + (broadGrain - 0.5) * 16
          + (waviness - 0.5) * 14 + seam * 30;
        roughness[pixel] = surface;
        roughness[pixel + 1] = surface;
        roughness[pixel + 2] = surface;
        roughness[pixel + 3] = 255;
      }
    }
  }

  colorContext.putImageData(colorImage, 0, 0);
  bumpContext.putImageData(bumpImage, 0, 0);
  roughnessContext.putImageData(roughnessImage, 0, 0);
  const anisotropy = Math.min(16, renderer?.capabilities.getMaxAnisotropy() ?? 8);

  return [colorCanvas, bumpCanvas, roughnessCanvas].map((canvas, index) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.name = ['Hardwood / color', 'Hardwood / height', 'Hardwood / lacquer'][index];
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    texture.repeat.set(FLOOR_SIZE / PATCH_WIDTH, FLOOR_SIZE / PATCH_DEPTH);
    texture.offset.set(0.19, 0.37);
    texture.colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return texture;
  });
}

/** An 80 m hardwood floor, centered at the origin on XZ, top surface at y = 0. */
export function createFloor(renderer) {
  const [map, bumpMap, roughnessMap] = makeWoodTextures(renderer);
  const material = new THREE.MeshPhysicalMaterial({
    map,
    bumpMap,
    bumpScale: 0.0011,
    roughnessMap,
    roughness: 0.77,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.42,
  });
  material.name = 'Warm worn hardwood';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), material);
  mesh.name = 'Hardwood court floor';
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}
