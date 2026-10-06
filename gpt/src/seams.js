/**
 * Conventional eight-panel basketball topology: two orthogonal great circles
 * and one closed, non-self-intersecting winding seam. Wilson describes this
 * construction in US7909715B2 (the conventional channels, not its extra ones).
 * https://patents.google.com/patent/US7909715B2/en
 *
 * The winding seam is the intersection of a sphere and a hyperbolic saddle:
 * y² - x² = bend * z. Its two bows on the front continue into the two side bows
 * on the back. It crosses each great circle twice, producing eight congruent
 * panels. Unlike independent small circles, it cannot leave closed oval caps.
 */
export const SEAM_BEND = 0.30;

// Orthonormal material axes retain the reference's resting seam orientation.
export const SEAM_BASIS = [
  [0.9307251904181726, -0.3653098872458993, -0.0173004682435096],
  [0.3542353560047067, 0.9122516537608515, -0.20570423614211308],
  [0.0909281720770579, 0.18532567682590517, 0.9784612721164518],
];

export function windingField([x, y, z]) {
  return y * y - x * x - SEAM_BEND * z;
}

export function canonicalSeamDistances([x, y, z]) {
  const field = windingField([x, y, z]);
  const gradient = [-2 * x, 2 * y, -SEAM_BEND];
  const normalPart = gradient[0] * x + gradient[1] * y + gradient[2] * z;
  const surfaceGradient = Math.hypot(gradient[0] - x * normalPart,
    gradient[1] - y * normalPart, gradient[2] - z * normalPart);
  return [Math.abs(x), Math.abs(y), Math.abs(field) / Math.max(surfaceGradient, 0.0001)];
}

/** A complete periodic parameterization of the winding seam, used for QA. */
export function windingPoint(angle) {
  const c = Math.cos(2 * angle);
  // Stable quadratic root, including c = 0; longitude is monotonic, so the
  // curve closes exactly once without crossings or discontinuous branches.
  const z = -2 * c / (SEAM_BEND + Math.sqrt(SEAM_BEND ** 2 + 4 * c * c));
  const radial = Math.sqrt(1 - z * z);
  return [radial * Math.cos(angle), radial * Math.sin(angle), z];
}

const vector = values => `vec3(${values.map(v => v.toFixed(10)).join(', ')})`;

export const basketballSeamGLSL = `
  float ballSeams(vec3 p) {
    vec3 q = vec3(dot(p, ${vector(SEAM_BASIS[0])}),
                  dot(p, ${vector(SEAM_BASIS[1])}),
                  dot(p, ${vector(SEAM_BASIS[2])}));
    float winding = q.y * q.y - q.x * q.x - ${SEAM_BEND.toFixed(8)} * q.z;
    vec3 gradient = vec3(-2.0 * q.x, 2.0 * q.y, -${SEAM_BEND.toFixed(8)});
    vec3 surfaceGradient = gradient - q * dot(gradient, q);
    // Normalize in the sphere's tangent plane: the curved groove has the
    // same physical width as the great-circle grooves all the way around.
    float curvedDistance = abs(winding) / max(length(surfaceGradient), 0.0001);
    return min(min(abs(q.x), abs(q.y)), curvedDistance);
  }
`;
