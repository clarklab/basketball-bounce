// The scene is ray traced in two fragment passes over a full-screen triangle.
//   FLOOR: the hardwood, which never changes, accumulated once into a texture.
//   FRAME: every frame: the baked floor, the ball's shadow on it, and the ball.

export const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform vec3 uCam;   // camera position; it looks along -z, level with the floor
uniform vec2 uLens;  // x: tan(fovY / 2), y: vertical lens shift in NDC (places the horizon)

vec3 cameraRay(vec2 frag) {
  vec2 ndc = (frag - 0.5 * uRes) / (0.5 * uRes.y);
  return normalize(vec3(ndc.x * uLens.x, (ndc.y - uLens.y) * uLens.x, -1.0));
}

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float hash(ivec2 p, int k) {
  uint h = pcg(uint(p.x) + pcg(uint(p.y) + pcg(uint(k))));
  return float(h >> 8) * (1.0 / 16777216.0);
}
float hash(ivec3 p) {
  uint h = pcg(uint(p.x) + pcg(uint(p.y) + pcg(uint(p.z))));
  return float(h >> 8) * (1.0 / 16777216.0);
}
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
`;

export const FLOOR_FRAG = COMMON + /* glsl */ `
uniform vec2 uJitter;   // sub-pixel offset of this sample
uniform float uWeight;  // 1 / (samples so far), blended as a running average
uniform float uEncode;  // 1.0 when the target is 8-bit and needs gamma-encoded storage
uniform int uSample;

out vec4 outColor;

const float PLANK_W = 0.091;   // measured from the reference frame
const float PLANK_L = 0.87;
const float SEAM_X = -0.034;

float vnoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  return mix(mix(hash(c, 0), hash(c + ivec2(1, 0), 0), u.x),
             mix(hash(c + ivec2(0, 1), 0), hash(c + ivec2(1, 1), 0), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.7; a *= 0.5; }
  return s;
}

// Butt joint inside a cell of a plank column, in cell units.
float joint(int col, int cell) {
  return float(cell) + 0.18 + 0.64 * hash(ivec2(col, cell), 1);
}

// Box-filtered coverage of a line of half-width hw at distance d, for a footprint w.
float lineCov(float d, float hw, float w) {
  w = max(w, 1e-6);
  return clamp((min(d + 0.5 * w, hw) - max(d - 0.5 * w, -hw)) / w, 0.0, 1.0);
}

// p.x runs across the planks, p.y along them (away from the camera).
vec3 wood(vec2 p) {
  vec2 fp = fwidth(p);

  float xs = (p.x - SEAM_X) / PLANK_W;
  float colf = floor(xs);
  int column = int(colf);
  float ax = (xs - colf - 0.5) * PLANK_W;
  float v = p.y / PLANK_L + hash(ivec2(column, 0), 2) * 31.0;
  int cell = int(floor(v));
  float j0 = joint(column, cell);
  bool before = v < j0;
  int id = before ? cell - 1 : cell;
  float a = before ? joint(column, cell - 1) : j0;
  float b = before ? j0 : joint(column, cell + 1);
  float len = (b - a) * PLANK_L;
  float al = (v - a) * PLANK_L;

  ivec2 pid = ivec2(column, id);
  float r0 = hash(pid, 3), r1 = hash(pid, 4), r2 = hash(pid, 5), r3 = hash(pid, 6);
  vec2 seed = vec2(hash(pid, 7), hash(pid, 8)) * 97.0;

  // Growth rings: the board is a slice through a log lying roughly along it, so the
  // ring pattern is the distance from the pith, bent by noise. A tilted slice gives
  // cathedral arches, a deep one gives straight grain.
  vec2 q = vec2(ax + (r0 - 0.5) * 0.12, mix(0.018, 0.10, r1) + (al - 0.5 * len) * (r2 - 0.5) * 0.14);
  vec2 wp = vec2(ax * 24.0, al * 2.4) + seed;
  q += (vec2(vnoise(wp), vnoise(wp + 41.3)) - 0.5) * 0.009;
  float g = length(q) * mix(170.0, 320.0, r3) + (fbm(vec2(ax * 70.0, al * 3.6) + seed) - 0.47) * 1.7;

  float knot = 0.0, halo = 0.0;
  if (hash(pid, 9) < 0.15) {
    vec2 kc = vec2((hash(pid, 10) - 0.5) * 0.5 * PLANK_W, (0.2 + 0.6 * hash(pid, 11)) * len);
    float kr = mix(0.0025, 0.0065, hash(pid, 12));
    vec2 dk = (vec2(ax, al) - kc) * vec2(1.0, 0.5);
    float d = length(dk);
    g += 2.4 * exp(-d * d / (kr * kr * 9.0));       // grain flows around the knot
    knot = 1.0 - smoothstep(kr * 0.65, kr * 1.1, d);
    halo = exp(-d * d / (kr * kr * 5.0));
  }

  float fw = fwidth(g);
  float ph = fract(g);
  float late = smoothstep(0.42, 0.9, ph) * (1.0 - smoothstep(0.9, 1.0, ph));
  late = mix(late, 0.27, smoothstep(0.35, 1.0, fw));

  float fine = 1.0 - smoothstep(0.25, 0.9, fp.x * 1300.0);
  float fibre = (vnoise(vec2(ax * 1300.0, al * 24.0) + seed) - 0.5) * fine
              + (vnoise(vec2(ax * 380.0, al * 8.0) + seed * 1.7) - 0.5) * 0.8;
  float blotch = fbm(vec2(ax * 10.0, al * 1.5) + seed * 0.37) - 0.47;

  // Board tone: mostly honey, a few pale and a few dark boards.
  float t = hash(pid, 13);
  vec3 dark = toLinear(vec3(0.585, 0.385, 0.210));
  vec3 mid = toLinear(vec3(0.690, 0.470, 0.290));
  vec3 pale = toLinear(vec3(0.790, 0.600, 0.420));
  vec3 col = t < 0.75 ? mix(dark, mid, smoothstep(0.0, 0.75, t)) : mix(mid, pale, pow((t - 0.75) / 0.25, 1.8));
  col *= 1.0 + 0.24 * (al / len - 0.5);            // each board runs darker toward its near end
  col *= mix(vec3(1.0), vec3(0.80, 0.71, 0.60), late * mix(0.4, 1.0, hash(pid, 14)));
  col *= 1.0 + 0.14 * fibre + 0.20 * blotch;
  col = mix(col, col * vec3(0.60, 0.48, 0.38), halo * 0.5);
  col = mix(col, toLinear(vec3(0.33, 0.19, 0.10)) * (0.8 + 0.4 * late), knot * 0.85);

  // Eased board edges, then the dark gap between boards.
  float ex = 0.5 * PLANK_W - abs(ax);
  float ey = min(al, len - al);
  float bx = max(0.0040, 1.5 * fp.x), by = max(0.0040, 1.5 * fp.y);
  col *= 1.0 - 0.42 * (1.0 - smoothstep(0.0, bx, ex)) * (0.0040 / bx);
  col *= 1.0 - 0.42 * (1.0 - smoothstep(0.0, by, ey)) * (0.0040 / by);
  float gap = max(lineCov(ex, 0.0011, fp.x), lineCov(ey, 0.0009, fp.y));
  return mix(col, toLinear(vec3(0.15, 0.085, 0.045)), gap);
}

void main() {
  vec3 rd = cameraRay(gl_FragCoord.xy + uJitter);
  // Evaluated for every pixel so the derivatives inside wood() stay defined.
  float t = min(uCam.y / max(-rd.y, 1e-4), 400.0);
  vec3 pos = uCam + t * rd;
  vec3 col = wood(vec2(pos.x, -pos.z));

  // Pool of light, measured from the reference frame: brightest a few metres out,
  // a little dimmer underfoot, and rolling off to black well before the horizon.
  float reach = length(pos.xz - uCam.xz);
  float far = clamp(6.129 / reach - 0.0563, 0.0, 1.0);
  float pool = pow(1.0 - pow(1.0 - far, 1.875), 2.2) * mix(0.86, 1.0, smoothstep(2.4, 3.6, reach));
  col *= 1.15 * pool * step(1e-4, -rd.y);

  if (uEncode > 0.5) {
    col = pow(col, vec3(1.0 / 2.2));
    col += (hash(ivec2(gl_FragCoord.xy), uSample) - 0.5) / 255.0;
  }
  outColor = vec4(col, uWeight);
}`;

export const FRAME_FRAG = COMMON + /* glsl */ `
uniform sampler2D uFloor;
uniform float uDecode;    // 1.0 when the floor texture is gamma-encoded
uniform vec3 uBallPos;    // ellipsoid centre
uniform vec3 uBallAxes;   // ellipsoid semi-axes
uniform mat3 uBallRot;    // ball frame -> world
uniform float uRadius;    // undeformed radius
uniform int uFrame;

out vec4 outColor;

// A row of ceiling lamps running away from the camera, 6 m up. Together they cast the
// shadow, which smears toward the viewer at rest and splits into separate soft
// shadows as the ball leaves the floor.
const int LAMPS = 5;
const vec3 LAMP_FIRST = vec3(0.4, 6.0, 0.54);
const vec3 LAMP_STEP = vec3(0.0, 0.0, -1.26);
const float LAMP_SIZE = 0.13;                      // angular radius seen from the floor
// Lamp just above the camera: most of the light on the side of the ball we see.
const vec3 FRONT_LIGHT = vec3(0.0, 1.25, 2.6);
// Small bright lamp up and to the right: it only matters for the glossy highlight.
const vec3 KEY_DIR = vec3(0.527, 0.850, 0.007);
// Cool light that fills the shadow.
const vec3 SHADOW_FILL = vec3(0.012, 0.014, 0.016);

const vec3 SEAM_COLOR = vec3(0.012, 0.009, 0.008);
const float SEAM_HALF = 0.018;                     // channel half-width, radians
// The two side seams are circular arcs when the ball is seen along its z axis.
const float ARC_CENTRE = 0.883, ARC_RADIUS = 0.635;

float seamDistance(vec3 m) {
  float great = asin(min(abs(m.x), abs(m.y)));     // the two great circles
  vec2 g = vec2(abs(m.x) - ARC_CENTRE, m.y);
  float s = length(g);
  g /= s;
  float gn = g.x * abs(m.x) + g.y * m.y;
  float arc = abs(s - ARC_RADIUS) / sqrt(max(1.0 - gn * gn, 1e-4));
  return min(great, arc);
}

float noise3(vec3 p) {
  vec3 i = floor(p), f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 c = ivec3(i);
  return mix(
    mix(mix(hash(c), hash(c + ivec3(1, 0, 0)), u.x), mix(hash(c + ivec3(0, 1, 0)), hash(c + ivec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash(c + ivec3(0, 0, 1)), hash(c + ivec3(1, 0, 1)), u.x), mix(hash(c + ivec3(0, 1, 1)), hash(c + ivec3(1, 1, 1)), u.x), u.y),
    u.z);
}

// Fraction of a disc light (angular radius al) hidden by a disc occluder
// (angular radius ao) whose centre is an angle sep away.
float discOverlap(float al, float ao, float sep) {
  float full = min(1.0, (ao * ao) / (al * al));
  float lo = abs(ao - al), hi = ao + al;
  return full * (1.0 - smoothstep(lo, hi, sep));
}

// How much of the floor's light survives at point p under the ball.
float floorLight(vec3 p) {
  vec3 toBall = uBallPos - p;
  float dist = length(toBall);
  vec3 bd = toBall / dist;
  float spread = uBallAxes.x;

  float ao = asin(min(0.72 * spread / dist, 1.0));
  float shadow = 0.0;
  for (int i = 0; i < LAMPS; i++) {
    vec3 ld = normalize(LAMP_FIRST + float(i) * LAMP_STEP - p);
    shadow += discOverlap(LAMP_SIZE, ao, acos(clamp(dot(ld, bd), -1.0, 1.0)));
  }
  shadow /= float(LAMPS);

  // The ball also blocks the light bounced around the hall where it sits close to the floor.
  float occ = clamp(bd.y * spread * spread / (dist * dist), 0.0, 1.0);
  return (1.0 - 0.84 * shadow) * (1.0 - 0.5 * occ * occ);
}

// Leather colour for a given amount of light. The green and blue channels fall away
// faster than red, so the shaded side deepens toward maroon (fitted to the reference).
vec3 leather(float light) {
  float r = 0.52 * light;
  return vec3(r, 0.180 * pow(r, 1.40), 0.103 * pow(r, 2.95));
}

vec3 shadeBall(vec3 u, vec3 m, vec3 wp, vec3 rd, float aa) {
  vec3 n = normalize(u / uBallAxes);
  vec3 v = -rd;

  float sd = seamDistance(m);
  float seam = 1.0 - smoothstep(SEAM_HALF - aa, SEAM_HALF + aa, sd);
  float recess = 1.0 - smoothstep(SEAM_HALF, SEAM_HALF * 3.0, sd);

  // Pebbled leather: a fine bump, faded out once the grain is smaller than a pixel.
  const float GRAIN = 58.0;
  float grainAmt = (1.0 - smoothstep(0.2, 0.55, aa * GRAIN)) * (1.0 - seam);
  float pebble = 0.0;
  if (grainAmt > 0.01) {
    vec3 gp = m * GRAIN;
    const float e = 0.35;
    float c = noise3(gp);
    vec3 grad = vec3(noise3(gp + vec3(e, 0, 0)), noise3(gp + vec3(0, e, 0)), noise3(gp + vec3(0, 0, e))) - c;
    grad = uBallRot * grad;
    n = normalize(n - 0.16 * grainAmt * (grad - n * dot(grad, n)));
    pebble = (c - 0.5) * grainAmt;
  }

  float nv = clamp(dot(n, v), 0.0, 1.0);

  // Diffuse light, fitted to the reference frame: dim hall ambience (a touch more of it
  // once the ball is clear of its own shadow), the ceiling lamps, and the front lamp.
  float lift = smoothstep(0.0, 5.0, wp.y / uRadius);
  float ambient = mix(0.119, 0.16, lift) + 0.042 * (0.5 + 0.5 * n.y);
  float top = pow(clamp((n.y + 0.646) / 1.646, 0.0, 1.0), 1.26) + 0.68 * smoothstep(0.72, 1.0, n.y);
  vec3 fl = normalize(FRONT_LIGHT - wp);
  float front = pow(max(dot(n, fl), 0.0), 4.0);
  float light = ambient + 0.237 * top + 0.855 * front;
  light *= (1.0 + 0.10 * pebble) * (1.0 - 0.25 * recess);
  vec3 col = mix(leather(light), SEAM_COLOR * light, seam);

  // Gloss: a white core inside a wide warm skirt from the key lamp, the ceiling lamps
  // catching the top rim at a grazing angle, and the front lamp glinting in the smooth
  // rubber channels.
  float kh = max(dot(n, normalize(KEY_DIR + v)), 0.0);
  float core = 0.55 * pow(kh, 430.0);
  float skirt = 0.52 * pow(kh, 46.0);
  float rim = 0.80 * pow(max(0.8 - nv, 0.0), 1.65) * smoothstep(0.05, 0.75, n.y);
  float channel = 0.05 * pow(max(dot(n, normalize(fl + v)), 0.0), 16.0) * seam;
  col += (vec3(core) + vec3(1.0, 0.86, 0.64) * (skirt + rim)) * mix(1.0, 0.6, seam) + vec3(channel);

  return col;
}

vec3 shoulder(vec3 x) {
  const float k = 0.82;
  return mix(x, k + (1.0 - k) * tanh((x - k) / (1.0 - k)), step(k, x));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec3 rd = cameraRay(frag);

  // Ray against the ball, in the space where the ellipsoid is a unit sphere.
  vec3 inv = 1.0 / uBallAxes;
  vec3 oc = (uCam - uBallPos) * inv;
  vec3 d = rd * inv;
  float dd = dot(d, d);
  float tca = -dot(oc, d) / dd;
  vec3 pc = oc + tca * d;                  // closest approach to the centre
  float h2 = dot(pc, pc);
  float h = sqrt(h2);
  float thc = sqrt(max(1.0 - h2, 0.0) / dd);
  // A miss just outside the silhouette shades the silhouette point, which keeps the
  // surface quantities continuous for the derivatives and the edge anti-aliasing.
  vec3 u = h < 1.0 ? oc + (tca - thc) * d : pc / h;
  vec3 wp = uBallPos + u * uBallAxes;
  vec3 m = transpose(uBallRot) * u;
  float edge = clamp((1.0 - h) / max(fwidth(h), 1e-6) + 0.5, 0.0, 1.0);
  float aboveFloor = clamp(wp.y / max(fwidth(wp.y), 1e-6) + 0.5, 0.0, 1.0);
  float aa = max(length(dFdx(m)), length(dFdy(m)));
  float cover = edge * aboveFloor * step(0.0, tca);

  vec3 col = texelFetch(uFloor, ivec2(frag), 0).rgb;
  if (uDecode > 0.5) col = toLinear(col);
  if (rd.y < -1e-4 && cover < 1.0) {
    float lit = floorLight(uCam + rd * (uCam.y / -rd.y));
    col = col * lit + SHADOW_FILL * (1.0 - lit);
  }
  if (cover > 0.0) {
    col = mix(col, shadeBall(u, m, wp, rd, aa), cover);
  }

  col = pow(shoulder(col), vec3(1.0 / 2.2));
  col += (hash(ivec2(frag), uFrame) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;
