// Builds one Escher-style lizard tile as a deformation of a regular hexagon —
// the construction behind Escher's "Reptiles" — plus the p3 instance lattice
// that tiles the plane gap-free with a three-colour pinwheel.
//
// How it works:
//   - A regular hexagon's vertices are 3-fold rotation centres of the
//     honeycomb: rotating a tile 120 deg about an (alternate) vertex maps it
//     exactly onto its neighbour.
//   - So we design THREE free edges (e0, e2, e4). The other three (e5, e1, e3)
//     are forced to be 120 deg rotations of them about the shared vertices.
//     This needs no edge self-symmetry, so the three free edges can sculpt a
//     head, legs and a tail freely.
//   - Scaling every edge's deformation by t in [0,1] keeps the rotation
//     relationships intact, so the tiling stays gap-free at every t. t = 1 is
//     the lizard; t = 0 is a regular hexagon, which fans into six triangles
//     from its centre — the "melts into triangles" effect.

const DEG = Math.PI / 180;

export type TileGeometry = {
  triPositions: Float32Array; // vec2 per vertex, rest shape (regular hexagon)
  lizPositions: Float32Array; // vec2 per vertex, deformed shape (lizard)
  indices: Uint16Array; // centroid-fan triangulation (shared by both shapes)
  vertexCount: number;
  indexCount: number;
  hexR: number; // hexagon circumradius (= edge length), world px
  boundingRadius: number;
};

export type InstanceData = {
  centers: Float32Array; // vec2 per instance (hexagon centre, world px)
  rotations: Float32Array; // float per instance (radians: 0, 120, 240 deg)
  colorIndices: Float32Array; // float per instance (0..2)
  count: number;
};

// Each free edge carries localized features (Gaussian bumps along the edge):
// p = position (0..1), w = width, an = outward-normal amplitude, at = tangential
// amplitude. Detrended at use so the corners stay pinned (gap-free). Crucially
// the tiling stays gap-free for ANY feature values (proven), so these can be
// animated freely over time — the live field random-walks around BASE_FEATURES.
export type Feature = { p: number; w: number; an: number; at: number };
export type Features = Record<number, Feature[]>;

// The base creature the live field wanders around. Three free edges (e0,e2,e4);
// the other three are forced 120-degree rotations of them.
export const BASE_FEATURES: Features = {
  // e0 (v0->v1): a rounded head at v0, a neck pinch, then a foreleg.
  0: [
    { p: 0.24, w: 0.18, an: 0.44, at: 0.0 },
    { p: 0.5, w: 0.07, an: -0.2, at: 0.0 },
    { p: 0.74, w: 0.1, an: 0.3, at: 0.06 },
  ],
  // e2 (v2->v3): one clean hind-leg lobe.
  2: [{ p: 0.5, w: 0.14, an: 0.42, at: -0.08 }],
  // e4 (v4->v5): a tapering tail.
  4: [
    { p: 0.32, w: 0.14, an: 0.34, at: 0.06 },
    { p: 0.58, w: 0.09, an: 0.16, at: 0.04 },
  ],
};

const SAMPLES_PER_EDGE = 22; // a touch coarser -> more angular outline
const ROUGH_AMP = 0.05; // craggy high-frequency edge detail (fraction of R)

function rot(px: number, py: number, cx: number, cy: number, deg: number): [number, number] {
  const a = deg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function hexVerts(R: number): Array<[number, number]> {
  const verts: Array<[number, number]> = [];
  for (let k = 0; k < 6; k++) {
    verts.push([R * Math.cos(60 * k * DEG), R * Math.sin(60 * k * DEG)]);
  }
  return verts;
}

// Craggy high-frequency detail along an edge (deterministic per edge, so forced
// rotated edges and neighbours stay consistent -> gap-free).
function roughAt(edge: number, s: number): number {
  return Math.sin(s * 19.0 + edge * 2.7) + 0.55 * Math.sin(s * 37.0 + edge * 5.3);
}

// Gaussian-feature displacement at param s for one edge, detrended so disp(0) =
// disp(1) = 0 (corners pinned -> gap-free for any feature values), plus a static
// roughness term on the normal so the silhouette reads rough/angular.
function profileAt(features: Features, edge: number, s: number): { n: number; t: number } {
  const feats = features[edge];
  let n = 0;
  let t = 0;
  let n0 = 0;
  let t0 = 0;
  let n1 = 0;
  let t1 = 0;
  for (const f of feats) {
    const g = Math.exp(-(((s - f.p) / f.w) ** 2));
    const g0 = Math.exp(-((f.p / f.w) ** 2));
    const g1 = Math.exp(-(((1 - f.p) / f.w) ** 2));
    n += f.an * g;
    t += f.at * g;
    n0 += f.an * g0;
    t0 += f.at * g0;
    n1 += f.an * g1;
    t1 += f.at * g1;
  }
  const rn = n - ((1 - s) * n0 + s * n1);
  const rt = t - ((1 - s) * t0 + s * t1);
  // detrended roughness so the corners stay pinned
  const rg = roughAt(edge, s) - ((1 - s) * roughAt(edge, 0) + s * roughAt(edge, 1));
  return { n: rn + ROUGH_AMP * rg, t: rt };
}

// point on a FREE edge (0,2,4) at param s, deformed or straight
function freeEdgePoint(
  R: number,
  verts: Array<[number, number]>,
  features: Features,
  edge: number,
  s: number,
  deformed: boolean,
): [number, number] {
  const a = verts[edge];
  const b = verts[(edge + 1) % 6];
  const sx = a[0] + (b[0] - a[0]) * s;
  const sy = a[1] + (b[1] - a[1]) * s;
  if (!deformed) return [sx, sy];
  const tx = (b[0] - a[0]) / R;
  const ty = (b[1] - a[1]) / R;
  const nx = ty; // outward normal for CCW hexagon
  const ny = -tx;
  const d = profileAt(features, edge, s);
  return [sx + nx * d.n * R + tx * d.t * R, sy + ny * d.n * R + ty * d.t * R];
}

// point on ANY edge i at param s. Determined edges are 120 deg rotations of a
// free edge about the shared vertex: e5<-e0@v0, e1<-e2@v2, e3<-e4@v4.
function edgePoint(
  R: number,
  verts: Array<[number, number]>,
  features: Features,
  i: number,
  s: number,
  deformed: boolean,
): [number, number] {
  if (i === 0 || i === 2 || i === 4) return freeEdgePoint(R, verts, features, i, s, deformed);
  let free: number;
  let centerIdx: number;
  if (i === 5) { free = 0; centerIdx = 0; }
  else if (i === 1) { free = 2; centerIdx = 2; }
  else { free = 4; centerIdx = 4; } // i === 3
  const p = freeEdgePoint(R, verts, features, free, 1 - s, deformed);
  const c = verts[centerIdx];
  return rot(p[0], p[1], c[0], c[1], 120);
}

// Recompute the deformed (creature) ring for `features` into `out`
// (length vertexCount*2; out[0,1] = centroid). Cheap enough to call per frame.
export function deformRing(hexR: number, features: Features, out: Float32Array): void {
  const verts = hexVerts(hexR);
  out[0] = 0;
  out[1] = 0;
  let w = 2;
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < SAMPLES_PER_EDGE; k++) {
      const s = k / SAMPLES_PER_EDGE;
      const p = edgePoint(hexR, verts, features, i, s, true);
      out[w++] = p[0];
      out[w++] = p[1];
    }
  }
}

export function buildTile(hexR: number): TileGeometry {
  const R = hexR;
  const verts = hexVerts(R);
  const ringCount = 6 * SAMPLES_PER_EDGE;
  const vertexCount = ringCount + 1; // + centroid

  // straight hexagon ring (features unused when deformed = false)
  const triPositions = new Float32Array(vertexCount * 2);
  let w = 2; // vertex 0 = centroid (0,0)
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < SAMPLES_PER_EDGE; k++) {
      const p = edgePoint(R, verts, BASE_FEATURES, i, k / SAMPLES_PER_EDGE, false);
      triPositions[w++] = p[0];
      triPositions[w++] = p[1];
    }
  }

  const lizPositions = new Float32Array(vertexCount * 2);
  deformRing(R, BASE_FEATURES, lizPositions);

  const indices = new Uint16Array(ringCount * 3);
  for (let i = 0; i < ringCount; i++) {
    indices[i * 3 + 0] = 0;
    indices[i * 3 + 1] = 1 + i;
    indices[i * 3 + 2] = 1 + ((i + 1) % ringCount);
  }

  return {
    triPositions,
    lizPositions,
    indices,
    vertexCount,
    indexCount: indices.length,
    hexR: R,
    boundingRadius: R * 1.35,
  };
}

// p3 lattice: hexagon centres on a triangular lattice, each tile rotated by
// 120 deg * ((2i + j) mod 3) with colour = the same index -> three orientations,
// three colours, the Escher pinwheel.
export function buildInstances(
  tile: TileGeometry,
  viewWidth: number,
  viewHeight: number,
  margin: number,
): InstanceData {
  const R = tile.hexR;
  const ax = 1.5 * R;
  const ay = 0.8660254 * R;
  const bx = 0;
  const by = 1.7320508 * R;

  const halfW = viewWidth / 2 + margin;
  const halfH = viewHeight / 2 + margin;

  const det = ax * by - bx * ay;
  const invDet = 1 / det;
  const ijOf = (px: number, py: number): [number, number] => [
    (by * px - bx * py) * invDet,
    (-ay * px + ax * py) * invDet,
  ];
  let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
  for (const [px, py] of [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ] as const) {
    const [i, j] = ijOf(px, py);
    iMin = Math.min(iMin, i);
    iMax = Math.max(iMax, i);
    jMin = Math.min(jMin, j);
    jMax = Math.max(jMax, j);
  }
  iMin = Math.floor(iMin) - 1;
  iMax = Math.ceil(iMax) + 1;
  jMin = Math.floor(jMin) - 1;
  jMax = Math.ceil(jMax) + 1;

  const centers: number[] = [];
  const rotations: number[] = [];
  const colorIndices: number[] = [];

  for (let j = jMin; j <= jMax; j++) {
    for (let i = iMin; i <= iMax; i++) {
      const x = i * ax + j * bx;
      const y = i * ay + j * by;
      if (Math.abs(x) > halfW || Math.abs(y) > halfH) continue;
      const idx = (((2 * i + j) % 3) + 3) % 3;
      centers.push(x, y);
      rotations.push(idx * 120 * DEG);
      colorIndices.push(idx);
    }
  }

  return {
    centers: new Float32Array(centers),
    rotations: new Float32Array(rotations),
    colorIndices: new Float32Array(colorIndices),
    count: rotations.length,
  };
}
