import { useEffect, useRef } from 'react';
import { BASE_FEATURES, buildInstances, buildTile, deformRing, type Features } from './geometry';
import { FRAGMENT_SRC, VERTEX_SRC } from './shaders';

// World-space tuning (px).
const HEX_R = 100; // hexagon circumradius (= edge length)
const MORPH_INNER = 95; // within this distance of the pointer: pure triangles
const MORPH_OUTER = 440; // beyond this: pure lizards
const GLOBAL_MORPH_BASE = 0.9; // floor of the breathing wave (solid lizards at rest)
const CURV_BOOST = 1.1; // near the cursor, multiply curvature by up to 1 + this
const RADIAL_AMP = 5; // px amplitude of the subtle field-wide radial ripple
const MAX_DPR = 2;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  // shaders can be flagged for deletion once linked
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link failed: ${log}`);
  }
  return prog;
}

// Smooth, bounded, non-repeating wander in ~[-1, 1] (sum of incommensurate
// sines). This is the low-entropy, rhythmic base of the metamorphosis.
function walk(t: number, seed: number): number {
  return (
    0.6 * Math.sin(0.22 * t + seed) +
    0.3 * Math.sin(0.34 * t + seed * 1.7 + 1.3) +
    0.1 * Math.sin(0.46 * t + seed * 2.3 + 2.1)
  );
}

// One step of a damped, noise-driven oscillator: smooth but genuinely
// stochastic (high-entropy) wander. state = [value, velocity], mutated in place,
// value clamped so it can't run away. This is the entropy source layered on top
// of the rhythmic walk above.
function ou(state: [number, number], dt: number) {
  const a = -0.7 * state[0] - 0.9 * state[1] + 2.4 * (Math.random() * 2 - 1);
  state[1] += a * dt;
  state[0] = Math.max(-2, Math.min(2, state[0] + state[1] * dt));
}

export default function LizardField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    const glCtx = canvasEl.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!glCtx) {
      // Leave a readable signal; a static CSS fallback covers the visual.
      console.warn('WebGL2 unavailable — lizard field disabled.');
      canvasEl.classList.add('lizard-unsupported');
      return;
    }
    // Non-null bindings so closures below keep the narrowed types.
    const canvas = canvasEl;
    const gl = glCtx;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let program: WebGLProgram;
    try {
      program = link(gl, VERTEX_SRC, FRAGMENT_SRC);
    } catch (e) {
      console.error('Lizard field shader setup failed; using static fallback.', e);
      canvas.classList.add('lizard-unsupported');
      return;
    }
    const u = {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      mouseWorld: gl.getUniformLocation(program, 'uMouseWorld'),
      time: gl.getUniformLocation(program, 'uTime'),
      viewScale: gl.getUniformLocation(program, 'uViewScale'),
      viewOffset: gl.getUniformLocation(program, 'uViewOffset'),
      morphInner: gl.getUniformLocation(program, 'uMorphInner'),
      morphOuter: gl.getUniformLocation(program, 'uMorphOuter'),
      globalMorphBase: gl.getUniformLocation(program, 'uGlobalMorphBase'),
      mouseActive: gl.getUniformLocation(program, 'uMouseActive'),
      curvBoost: gl.getUniformLocation(program, 'uCurvBoost'),
      radialAmp: gl.getUniformLocation(program, 'uRadialAmp'),
      hexR: gl.getUniformLocation(program, 'uHexR'),
    };

    // --- static tile geometry (uploaded once) ---
    const tile = buildTile(HEX_R);
    const instanceMargin = tile.boundingRadius * 1.5;
    // mutable copy of the base features, perturbed each frame by the random walk
    const walkFeatures: Features = { 0: [], 2: [], 4: [] };
    for (const e of [0, 2, 4] as const) {
      walkFeatures[e] = BASE_FEATURES[e].map((f) => ({ ...f }));
    }
    const lizScratch = new Float32Array(tile.vertexCount * 2);
    // stochastic ("entropy") drive state per free-edge feature/channel
    const noise: Record<number, Array<{ an: [number, number]; at: [number, number]; p: [number, number] }>> = {
      0: [],
      2: [],
      4: [],
    };
    for (const e of [0, 2, 4] as const) {
      noise[e] = BASE_FEATURES[e].map(() => ({ an: [0, 0], at: [0, 0], p: [0, 0] }));
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const triBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tile.triPositions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const lizBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, lizBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tile.lizPositions, gl.DYNAMIC_DRAW); // re-uploaded per frame
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tile.indices, gl.STATIC_DRAW);

    // --- per-instance buffers (rebuilt on resize) ---
    const centerBuf = gl.createBuffer()!;
    const rotBuf = gl.createBuffer()!;
    const colorBuf = gl.createBuffer()!;
    let instanceCount = 0;

    gl.bindBuffer(gl.ARRAY_BUFFER, centerBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(3, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1);

    gl.bindVertexArray(null);

    let bufferW = 0;
    let bufferH = 0;

    function rebuildInstances() {
      const inst = buildInstances(tile, bufferW, bufferH, instanceMargin);
      instanceCount = inst.count;
      gl.bindBuffer(gl.ARRAY_BUFFER, centerBuf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.centers, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, rotBuf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.rotations, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.colorIndices, gl.DYNAMIC_DRAW);
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (w === bufferW && h === bufferH) return;
      bufferW = w;
      bufferH = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      rebuildInstances();
    }

    // --- pointer state (CSS px relative to canvas; scaled to buffer px later) ---
    const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);
    // target & smoothed pointer, in buffer px
    let targetX = -1e6;
    let targetY = -1e6;
    let smoothX = -1e6;
    let smoothY = -1e6;
    let targetActive = 0;
    let smoothActive = 0;

    function onPointerMove(e: PointerEvent) {
      const rect = canvas.getBoundingClientRect();
      targetX = (e.clientX - rect.left) * dpr();
      targetY = (e.clientY - rect.top) * dpr();
      targetActive = 1;
    }
    function onPointerLeave() {
      targetActive = 0;
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    gl.clearColor(0.039, 0.039, 0.047, 1.0); // #0a0a0c
    gl.useProgram(program);
    gl.uniform1f(u.morphInner, MORPH_INNER);
    gl.uniform1f(u.morphOuter, MORPH_OUTER);
    gl.uniform1f(u.globalMorphBase, GLOBAL_MORPH_BASE);
    gl.uniform1f(u.curvBoost, CURV_BOOST);
    gl.uniform1f(u.radialAmp, RADIAL_AMP);
    gl.uniform1f(u.hexR, tile.hexR);

    let raf = 0;
    let prevNow = 0;
    let startTime = performance.now();

    function frame(now: number) {
      const t = (now - startTime) / 1000;

      // smooth pointer (trailing) + activation ramp
      if (smoothX < -1e5) {
        smoothX = targetX;
        smoothY = targetY;
      }
      smoothX += (targetX - smoothX) * 0.18;
      smoothY += (targetY - smoothY) * 0.18;
      smoothActive += (targetActive - smoothActive) * 0.08;

      // camera: gentle breathing zoom + slow drift (the "fractal" layer).
      const scale = reduceMotion ? 1 : 1 + 0.05 * Math.sin(t * 0.12);
      const panX = reduceMotion ? 0 : 26 * Math.sin(t * 0.05);
      const panY = reduceMotion ? 0 : 22 * Math.cos(t * 0.041);
      const offX = bufferW / 2 + panX;
      const offY = bufferH / 2 + panY;

      // pointer in world space: world = (screen - offset) / scale
      const mouseWorldX = (smoothX - offX) / scale;
      const mouseWorldY = (smoothY - offY) / scale;

      // --- random walk: drift the creature's outline through shape space so the
      // whole field continuously metamorphoses (gap-free at every step) ---
      const wt = reduceMotion ? 0 : t;
      const dt = prevNow ? Math.min(0.05, (now - prevNow) / 1000) : 0.016;
      prevNow = now;
      // entropy weight grows over time: starts ~0 (pure rhythmic wander) and
      // ramps up so the stochastic disorder accumulates the longer it runs.
      const g = reduceMotion ? 0 : Math.min(1.0, (1 - Math.exp(-t / 55)) + 0.0008 * t);
      for (const e of [0, 2, 4] as const) {
        const base = BASE_FEATURES[e];
        const cur = walkFeatures[e];
        const ns = noise[e];
        for (let fi = 0; fi < base.length; fi++) {
          const seed = e * 13.7 + fi * 4.3;
          if (!reduceMotion) {
            ou(ns[fi].an, dt);
            ou(ns[fi].at, dt);
            ou(ns[fi].p, dt);
          }
          cur[fi].an = base[fi].an + 0.2 * walk(wt, seed) + g * 0.17 * ns[fi].an[0];
          cur[fi].at = base[fi].at + 0.1 * walk(wt, seed + 1.7) + g * 0.09 * ns[fi].at[0];
          cur[fi].p = Math.min(
            0.94,
            Math.max(0.06, base[fi].p + 0.06 * walk(wt, seed + 3.1) + g * 0.05 * ns[fi].p[0]),
          );
        }
      }
      deformRing(HEX_R, walkFeatures, lizScratch);
      gl.bindBuffer(gl.ARRAY_BUFFER, lizBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lizScratch);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(u.resolution, bufferW, bufferH);
      gl.uniform2f(u.mouseWorld, mouseWorldX, mouseWorldY);
      gl.uniform1f(u.time, reduceMotion ? 0 : t);
      gl.uniform1f(u.viewScale, scale);
      gl.uniform2f(u.viewOffset, offX, offY);
      gl.uniform1f(u.mouseActive, smoothActive);

      gl.drawElementsInstanced(
        gl.TRIANGLES,
        tile.indexCount,
        gl.UNSIGNED_SHORT,
        0,
        instanceCount,
      );

      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (!raf) {
        startTime = performance.now() - 0;
        raf = requestAnimationFrame(frame);
      }
    }
    function stop() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }
    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      ro.disconnect();
      gl.deleteBuffer(triBuf);
      gl.deleteBuffer(lizBuf);
      gl.deleteBuffer(idxBuf);
      gl.deleteBuffer(centerBuf);
      gl.deleteBuffer(rotBuf);
      gl.deleteBuffer(colorBuf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className="lizard-canvas" aria-hidden="true" />;
}
