/**
 * Voidulator - Audio-Reactive Laser Room Visualization
 *
 * WebGL2-based laser beam simulation with reflections.
 * Audio reactivity: bass → glow intensity (minimal initial mapping)
 */

import { useEffect, useRef, useCallback } from 'react';
import type { AdaptiveAudioResult } from '../../shared';

interface VoidulatorProps {
  audio: AdaptiveAudioResult;
}

// Inline styles matching Blobulator's control panel
const styles = {
  container: {
    position: 'fixed' as const,
    inset: 0,
    overflow: 'hidden',
    background: '#0c0d10',
  },
  canvas: {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
  },
  hud: {
    position: 'absolute' as const,
    left: 16,
    top: 16,
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap' as const,
    zIndex: 10,
  },
  tag: {
    background: 'rgba(0,0,0,0.6)',
    padding: '6px 10px',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    color: '#cbd5e1',
    fontSize: 12,
    fontFamily: 'system-ui, sans-serif',
  },
};

// Math utilities
const norm = (v: { x: number; y: number }) => {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
};
const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.y - a.y * b.x;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

// Vertex shader
const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_pos;
in float a_t;
in vec3 a_col;
in float a_alpha;
in float a_gradPos;
uniform vec2 u_res;
out float v_t;
out vec3 v_col;
out float v_alpha;
out float v_gradPos;
void main(){
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_t = a_t; v_col = a_col; v_alpha = a_alpha; v_gradPos = a_gradPos;
}`;

// Fragment shader
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in float v_t;
in vec3 v_col;
in float v_alpha;
in float v_gradPos;
uniform float u_time, u_freqPx, u_speed, u_amp, u_shape, u_soft, u_pulseOn;
out vec4 outColor;
void main(){
  float a = v_alpha;
  if (u_pulseOn > 0.5) {
    float s = sin(6.2831853 * u_freqPx * (v_t - u_speed * u_time));
    float f = (u_shape < 0.5) ? (0.5 + 0.5 * s) : smoothstep(-u_soft, u_soft, s);
    a *= (1.0 - u_amp) + u_amp * f;
  }
  float gradient = 1.0 - abs(v_gradPos - 0.5) * 2.0;
  gradient = smoothstep(0.0, 1.0, gradient);
  a *= gradient;
  outColor = vec4(v_col, a);
}`;

interface VoidState {
  seed: number;
  isCircle: boolean;
  circle: { cx: number; cy: number; R: number };
  vertices: { x: number; y: number }[];
  reflectivity: number;
  maxBounces: number;
  beamWidth: number;
  beamCount: number;
  spreadDeg: number;
  angleDeg: number;
  rotationSpeed: number;
  speedMultiplier: number;
  emitters: { x: number; y: number }[];
  beamPalette: { h: number; s: number; l: number }[];
  perBeamSpeed: number[];
  perBeamPhase: number[];
  // Pulse
  pulseOn: boolean;
  pulseShape: 'sine' | 'square';
  pulseAmp: number;
  pulseFreqCP100: number;
  pulseSpeed: number;
  pulseSoft: number;
  // Glow
  glowLayers: number;
  glowIntensity: number;
  glowSpread: number;
  glowCore: number;
  glowBlend: 'normal' | 'add' | 'screen';
  // Audio-reactive overrides
  audioGlowBoost: number;
}

function createDefaultState(): VoidState {
  // "Spectacular glow" preset as default
  const beamCount = 8;
  return {
    seed: (Math.random() * 1e9) | 0,
    isCircle: true,
    circle: { cx: 0, cy: 0, R: 0 },
    vertices: [],
    reflectivity: 0.92,
    maxBounces: 12,
    beamWidth: 3,
    beamCount,
    spreadDeg: 25,
    angleDeg: 0,
    rotationSpeed: 0.5,
    speedMultiplier: 1,
    emitters: [{ x: 0, y: 0 }],
    beamPalette: Array.from({ length: beamCount }, (_, i) => ({ h: (i * 360) / beamCount, s: 80, l: 55 })),
    perBeamSpeed: [2, 3, 5, 7, 11, 13, 17, 19],
    perBeamPhase: new Array(beamCount).fill(0),
    pulseOn: true,
    pulseShape: 'sine',
    pulseAmp: 0.8,
    pulseFreqCP100: 2,
    pulseSpeed: 180,
    pulseSoft: 0.15,
    glowLayers: 3,
    glowIntensity: 2.5,
    glowSpread: 4,
    glowCore: 1.8,
    glowBlend: 'add',
    audioGlowBoost: 0,
  };
}

export function Voidulator({ audio }: VoidulatorProps) {
  const { features } = audio;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<VoidState>(createDefaultState());
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const bufRef = useRef<WebGLBuffer | null>(null);
  const locationsRef = useRef<{
    a_pos: number; a_t: number; a_col: number; a_alpha: number; a_gradPos: number;
    u_res: WebGLUniformLocation | null; u_time: WebGLUniformLocation | null;
    u_freqPx: WebGLUniformLocation | null; u_speed: WebGLUniformLocation | null;
    u_amp: WebGLUniformLocation | null; u_shape: WebGLUniformLocation | null;
    u_soft: WebGLUniformLocation | null; u_pulseOn: WebGLUniformLocation | null;
  } | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const segmentsRef = useRef<number>(0);

  // Update audio-reactive parameters
  useEffect(() => {
    // Bass drives glow intensity boost (up to +50%)
    stateRef.current.audioGlowBoost = features.bass * 0.5;
  }, [features.bass]);

  // Ray-circle intersection
  const firstHitCircle = useCallback((o: { x: number; y: number }, d: { x: number; y: number }, c: { cx: number; cy: number; R: number }) => {
    const ox = o.x - c.cx, oy = o.y - c.cy;
    const b = ox * d.x + oy * d.y;
    const c0 = ox * ox + oy * oy - c.R * c.R;
    const disc = b * b - c0;
    if (disc < 1e-9) return null;
    const s = Math.sqrt(disc);
    const t1 = -b - s, t2 = -b + s;
    let t: number | null = null;
    if (t1 > 1e-4) t = t1;
    else if (t2 > 1e-4) t = t2;
    if (t === null) return null;
    return { point: { x: o.x + d.x * t, y: o.y + d.y * t }, t };
  }, []);

  // Ray-segment intersection
  const raySegIntersection = useCallback((o: { x: number; y: number }, d: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const v = sub(b, a), w = sub(a, o);
    const denom = cross(d, v);
    if (Math.abs(denom) < 1e-9) return null;
    const t = (w.x * v.y - w.y * v.x) / denom;
    const u = (w.x * d.y - w.y * d.x) / denom;
    if (t > 1e-4 && u >= 0 && u <= 1) return { point: { x: o.x + d.x * t, y: o.y + d.y * t }, t, a, b };
    return null;
  }, []);

  // First hit polygon
  const firstHitPoly = useCallback((o: { x: number; y: number }, d: { x: number; y: number }, verts: { x: number; y: number }[]) => {
    let best: ReturnType<typeof raySegIntersection> = null;
    let bestT = 1e20;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const h = raySegIntersection(o, d, a, b);
      if (h && h.t < bestT) { best = h; bestT = h.t; }
    }
    return best;
  }, [raySegIntersection]);

  // Reflect vector by normal
  const reflectByNormal = useCallback((d: { x: number; y: number }, n: { x: number; y: number }) => {
    const dot = d.x * n.x + d.y * n.y;
    return norm({ x: d.x - n.x * 2 * dot, y: d.y - n.y * 2 * dot });
  }, []);

  // Compute laser path
  const computePath = useCallback((origin: { x: number; y: number }, dir: { x: number; y: number }) => {
    const S = stateRef.current;
    let o = { ...origin };
    let d = norm(dir);
    let pathIntensity = 1;
    const segs: { from: { x: number; y: number }; to: { x: number; y: number }; len: number; cum: number; intensity: number }[] = [];
    let cum = 0;

    for (let i = 0; i < S.maxBounces && pathIntensity > 0.01; i++) {
      const hit = S.isCircle ? firstHitCircle(o, d, S.circle) : firstHitPoly(o, d, S.vertices);
      if (!hit) break;

      const to = hit.point;
      const len = Math.hypot(to.x - o.x, to.y - o.y);
      segs.push({ from: o, to, len, cum, intensity: pathIntensity });
      cum += len;

      if (S.isCircle) {
        const n = norm({ x: to.x - S.circle.cx, y: to.y - S.circle.cy });
        d = reflectByNormal(d, n);
      } else if ('a' in hit && 'b' in hit && hit.a && hit.b) {
        const e = sub(hit.b as { x: number; y: number }, hit.a as { x: number; y: number });
        const n = norm({ x: -e.y, y: e.x });
        d = reflectByNormal(d, n);
      }

      pathIntensity *= S.reflectivity;
      o = { x: to.x + d.x * 0.02, y: to.y + d.y * 0.02 };
    }

    return segs;
  }, [firstHitCircle, firstHitPoly, reflectByNormal]);

  // Build room shape
  const buildShape = useCallback((width: number, height: number) => {
    const S = stateRef.current;
    const cx = width / 2, cy = height / 2, margin = 16;
    S.isCircle = true;
    S.circle = { cx, cy, R: Math.min(width, height) / 2 - margin };
    S.vertices = [];
    // Center emitter
    S.emitters = [{ x: cx, y: cy }];
  }, []);

  // Push quad to vertex array
  const pushQuad = useCallback((arr: number[], x0: number, y0: number, x1: number, y1: number, halfW: number, t0: number, t1: number, rgb: [number, number, number], alpha: number) => {
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;

    const lx0 = x0 + nx * halfW, ly0 = y0 + ny * halfW;
    const rx0 = x0 - nx * halfW, ry0 = y0 - ny * halfW;
    const lx1 = x1 + nx * halfW, ly1 = y1 + ny * halfW;
    const rx1 = x1 - nx * halfW, ry1 = y1 - ny * halfW;

    const pushV = (x: number, y: number, t: number, gradPos: number) => {
      arr.push(x, y, t, rgb[0], rgb[1], rgb[2], alpha, gradPos);
    };

    pushV(lx0, ly0, t0, 0.0); pushV(lx1, ly1, t1, 0.0); pushV(rx0, ry0, t0, 1.0);
    pushV(rx0, ry0, t0, 1.0); pushV(lx1, ly1, t1, 0.0); pushV(rx1, ry1, t1, 1.0);
  }, []);

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) {
      console.error('WebGL2 not available');
      return;
    }
    glRef.current = gl;

    // Compile shaders
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERTEX_SHADER);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FRAGMENT_SHADER);
    gl.compileShader(fs);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    progRef.current = prog;

    // Get locations
    locationsRef.current = {
      a_pos: gl.getAttribLocation(prog, 'a_pos'),
      a_t: gl.getAttribLocation(prog, 'a_t'),
      a_col: gl.getAttribLocation(prog, 'a_col'),
      a_alpha: gl.getAttribLocation(prog, 'a_alpha'),
      a_gradPos: gl.getAttribLocation(prog, 'a_gradPos'),
      u_res: gl.getUniformLocation(prog, 'u_res'),
      u_time: gl.getUniformLocation(prog, 'u_time'),
      u_freqPx: gl.getUniformLocation(prog, 'u_freqPx'),
      u_speed: gl.getUniformLocation(prog, 'u_speed'),
      u_amp: gl.getUniformLocation(prog, 'u_amp'),
      u_shape: gl.getUniformLocation(prog, 'u_shape'),
      u_soft: gl.getUniformLocation(prog, 'u_soft'),
      u_pulseOn: gl.getUniformLocation(prog, 'u_pulseOn'),
    };

    bufRef.current = gl.createBuffer();
    gl.enable(gl.BLEND);

    // Initial resize
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      buildShape(rect.width, rect.height);
    };

    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [buildShape]);

  // Animation loop
  useEffect(() => {
    const gl = glRef.current;
    const prog = progRef.current;
    const buf = bufRef.current;
    const locs = locationsRef.current;
    const canvas = canvasRef.current;

    if (!gl || !prog || !buf || !locs || !canvas) return;

    const animate = (timestamp: number) => {
      const S = stateRef.current;
      const dt = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      // Update rotation
      if (S.rotationSpeed > 0) {
        S.angleDeg = (S.angleDeg + S.rotationSpeed * dt / 1000) % 360;
      }
      for (let i = 0; i < S.perBeamPhase.length; i++) {
        S.perBeamPhase[i] = (S.perBeamPhase[i] + (S.perBeamSpeed[i] || 0) * S.speedMultiplier * dt / 1000) % 360;
      }

      // Render
      gl.useProgram(prog);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewW = canvas.width / dpr;
      const viewH = canvas.height / dpr;

      gl.uniform2f(locs.u_res, viewW, viewH);
      gl.uniform1f(locs.u_time, timestamp / 1000);
      gl.uniform1f(locs.u_pulseOn, S.pulseOn ? 1 : 0);
      gl.uniform1f(locs.u_freqPx, S.pulseFreqCP100 / 100);
      gl.uniform1f(locs.u_speed, S.pulseSpeed);
      gl.uniform1f(locs.u_amp, S.pulseAmp);
      gl.uniform1f(locs.u_shape, S.pulseShape === 'square' ? 1 : 0);
      gl.uniform1f(locs.u_soft, S.pulseSoft);

      // Blend mode
      if (S.glowBlend === 'add') {
        gl.blendFunc(gl.ONE, gl.ONE);
      } else if (S.glowBlend === 'screen') {
        gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
      } else {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }

      gl.clearColor(0.047, 0.051, 0.063, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const base = S.angleDeg * Math.PI / 180;
      const spread = S.spreadDeg * Math.PI / 180;
      const n = S.beamCount;
      let totalSegs = 0;

      // Audio-reactive glow intensity
      const effectiveGlowIntensity = S.glowIntensity * (1 + S.audioGlowBoost);
      const effectiveGlowCore = S.glowCore * (1 + S.audioGlowBoost * 0.5);

      const layers = Math.max(1, S.glowLayers);
      for (let layer = layers; layer > 0; layer--) {
        const verts: number[] = [];
        const layerIntensity = layer === 1 ? effectiveGlowCore : effectiveGlowIntensity / layer;
        const layerWidth = S.beamWidth * (layer === 1 ? 0.5 : S.glowSpread * layer * 0.5);
        const half = layerWidth / 2;

        for (const E of S.emitters) {
          for (let i = 0; i < n; i++) {
            const off = n === 1 ? 0 : (i / (n - 1) - 0.5);
            const ang = base + off * spread + (S.perBeamPhase[i] || 0) * Math.PI / 180;
            const dir = { x: Math.cos(ang), y: Math.sin(ang) };
            const segs = computePath(E, dir);
            if (layer === layers) totalSegs += segs.length;

            const palette = S.beamPalette[i % S.beamPalette.length];
            const rgb = hslToRgb(palette.h, palette.s, palette.l);

            for (const s of segs) {
              const alpha = s.intensity * layerIntensity * (layer === 1 ? 1 : 0.3);
              pushQuad(verts, s.from.x, s.from.y, s.to.x, s.to.y, half, s.cum, s.cum + s.len, rgb, alpha);
            }
          }
        }

        if (verts.length > 0) {
          const data = new Float32Array(verts);
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

          const stride = 8 * 4;
          gl.enableVertexAttribArray(locs.a_pos);
          gl.vertexAttribPointer(locs.a_pos, 2, gl.FLOAT, false, stride, 0);
          gl.enableVertexAttribArray(locs.a_t);
          gl.vertexAttribPointer(locs.a_t, 1, gl.FLOAT, false, stride, 2 * 4);
          gl.enableVertexAttribArray(locs.a_col);
          gl.vertexAttribPointer(locs.a_col, 3, gl.FLOAT, false, stride, 3 * 4);
          gl.enableVertexAttribArray(locs.a_alpha);
          gl.vertexAttribPointer(locs.a_alpha, 1, gl.FLOAT, false, stride, 6 * 4);
          gl.enableVertexAttribArray(locs.a_gradPos);
          gl.vertexAttribPointer(locs.a_gradPos, 1, gl.FLOAT, false, stride, 7 * 4);

          gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
        }
      }

      segmentsRef.current = totalSegs;
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [computePath, pushQuad]);

  return (
    <div style={styles.container}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <div style={styles.hud}>
        <div style={styles.tag}>Bounces: {segmentsRef.current}</div>
        <div style={styles.tag}>Bass: {(features.bass * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}
