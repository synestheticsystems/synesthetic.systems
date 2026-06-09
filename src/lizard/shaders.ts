// GLSL ES 3.00 shaders for the morphing lizard field.
//
// Vertex shader: per instance, compute a morph amount t (0 = flat rhombus,
// 1 = full lizard) from distance to the pointer plus a slow global wave —
// sampled at each vertex's REST position so tiles sharing an edge always agree
// and the tiling stays gap-free. Then lerp between triangle and lizard
// positions, rotate by the instance orientation, and project through a pan/zoom
// camera.
//
// Fragment shader: jewel-tone fill plus interior detail drawn in lizard space —
// a spine and eye that fade IN as the creature forms, and the short-diagonal
// split line that fades in as it flattens back into two triangles.

export const VERTEX_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 aTriPos;       // per-vertex: flat-rhombus position
layout(location = 1) in vec2 aLizPos;       // per-vertex: lizard position
layout(location = 2) in vec2 aInstCenter;   // per-instance: tile centroid (world)
layout(location = 3) in float aInstRot;     // per-instance: rotation (radians)
layout(location = 4) in float aColorIndex;  // per-instance: 0..2

uniform vec2  uResolution;
uniform vec2  uMouseWorld;
uniform float uTime;
uniform float uViewScale;
uniform vec2  uViewOffset;
uniform float uMorphInner;
uniform float uMorphOuter;
uniform float uGlobalMorphBase;
uniform float uMouseActive;
uniform float uCurvBoost;
uniform float uRadialAmp;

out float vT;
out float vColorIndex;
out vec2  vLiz;
out vec2  vWorld;

void main() {
  float c = cos(aInstRot);
  float s = sin(aInstRot);

  // Sample the morph field at the REST (flat) world position so two tiles that
  // share an edge sample identical t there -> shared edge stays matched.
  vec2 triRot = vec2(aTriPos.x * c - aTriPos.y * s, aTriPos.x * s + aTriPos.y * c);
  vec2 restWorld = aInstCenter + triRot;

  float d = distance(restWorld, uMouseWorld);
  // proximity to the pointer: 1 right at the cursor, 0 beyond the outer radius
  float prox = (1.0 - smoothstep(uMorphInner, uMorphOuter, d)) * uMouseActive;
  float wave = 0.5 + 0.5 * sin(uTime * 0.25 + dot(restWorld, vec2(0.0035, 0.0029)));
  float globalT = mix(uGlobalMorphBase, 1.0, wave);
  // near the cursor, MULTIPLY the creature's curvature (amplify the deformation),
  // proportional to proximity. t > 1 just extrapolates past the base shape and
  // stays gap-free, so limbs bulge and curl outward under the pointer.
  float t = globalT * (1.0 + uCurvBoost * prox);

  vec2 local = mix(aTriPos, aLizPos, t);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 world = aInstCenter + rotated;

  // subtle radial ripple over the whole field. It's a continuous function of
  // world position, so adjacent tiles displace shared edges identically and the
  // tiling stays gap-free.
  float rr = length(world);
  vec2 rdir = world / max(rr, 0.001);
  float ripple = sin(rr * 0.016 - uTime * 0.6) + 0.4 * sin(rr * 0.029 + uTime * 0.45);
  world += rdir * ripple * uRadialAmp;

  vec2 screen = world * uViewScale + uViewOffset;
  vec2 clip = (screen / uResolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);

  vT = t;
  vColorIndex = aColorIndex;
  vLiz = aLizPos;
  vWorld = world;
}
`;

// Minimal program for the stationary line-art test: draws each tile's boundary
// (full-lizard positions) as a dark ink outline on a cream ground, no morph,
// no motion — purely to judge whether a recognizable lizard falls out.
export const LINE_VERTEX_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 1) in vec2 aLizPos;
layout(location = 2) in vec2 aInstCenter;
layout(location = 3) in float aInstRot;

uniform vec2  uResolution;
uniform float uViewScale;
uniform vec2  uViewOffset;

void main() {
  float c = cos(aInstRot);
  float s = sin(aInstRot);
  vec2 r = vec2(aLizPos.x * c - aLizPos.y * s, aLizPos.x * s + aLizPos.y * c);
  vec2 world = aInstCenter + r;
  vec2 screen = world * uViewScale + uViewOffset;
  vec2 clip = (screen / uResolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const LINE_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 uInk;
out vec4 fragColor;
void main() { fragColor = vec4(uInk, 1.0); }
`;

export const FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;

in float vT;
in float vColorIndex;
in vec2  vLiz;
in vec2  vWorld;

uniform float uHexR; // hexagon circumradius
uniform float uTime;

out vec4 fragColor;

const float DEG = 0.01745329252;

// Cool ramp: deep blue -> azure -> teal -> forest green -> deep moss. Sampled by
// world position + time so the field reads as one flowing wash, not flat solids.
vec3 ramp(float s) {
  s = clamp(s, 0.0, 1.0);
  vec3 c0 = vec3(0.04, 0.13, 0.30); // deep blue
  vec3 c1 = vec3(0.10, 0.34, 0.62); // azure
  vec3 c2 = vec3(0.07, 0.47, 0.50); // teal
  vec3 c3 = vec3(0.11, 0.41, 0.24); // forest green
  vec3 c4 = vec3(0.13, 0.27, 0.15); // deep moss
  float x = s * 4.0;
  if (x < 1.0) return mix(c0, c1, x);
  if (x < 2.0) return mix(c1, c2, x - 1.0);
  if (x < 3.0) return mix(c2, c3, x - 2.0);
  return mix(c3, c4, x - 3.0);
}

// distance from point p to segment ab
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  return length(p - a - ab * h);
}

void main() {
  // Field gradient: blue -> teal -> forest green flowing across the plane and
  // drifting slowly, so the whole palette reads as one cohesive wash.
  float fieldS = 0.5
    + 0.42 * sin(dot(vWorld, vec2(0.0013, 0.0017)) + uTime * 0.05)
    + 0.08 * sin(dot(vWorld, vec2(-0.0019, 0.0008)) - uTime * 0.037);
  vec3 hue = ramp(fieldS);

  // soft directional gradient across each creature's body (a sheen)
  float sheen = clamp(dot(vLiz / uHexR, vec2(0.45, 0.89)) * 0.7 + 0.5, 0.0, 1.0);

  // three tone levels so neighbouring tiles stay distinct but harmonise
  float level = mix(0.68, 1.1, vColorIndex * 0.5);

  vec3 col = hue * level * mix(0.78, 1.28, sheen);

  fragColor = vec4(col, 1.0);
}
`;
