// WebGPU noise-cloud renderer for the appearance background (OPNMMO-0048).
//
// One full-screen triangle, a WGSL fragment shader that builds clouds from
// fractal Brownian motion (stacked octaves of value noise) with a domain warp
// so the clouds curl and evolve instead of looking like flat static. Colors
// come from the resolved sky (horizon / zenith / cloud tint), so the backdrop
// reads in both themes.
//
// The renderer owns its own requestAnimationFrame loop OUTSIDE React. The host
// component mounts it once and pushes new params via setParams(); changing a
// slider is a cheap uniform write, not a teardown.
//
// Graceful fallback is mandatory (CLAUDE.md): start() resolves to false when
// WebGPU is missing or init fails, and never leaves a broken/visible canvas —
// the host then paints a static sky instead.

import type { Sky } from './skyPalette';

export interface CloudParams {
  speed: number; // 0..1 — how fast the field drifts and evolves
  fullness: number; // 0..1 — cloud coverage (lower = more open sky)
  intensity: number; // 0..1 — cloud contrast / opacity
  size: number; // 0..1 — noise scale (higher = bigger, softer clouds)
  sky: Sky;
  paused: boolean; // freeze on one evolved frame (reduced motion)
}

const WGSL = /* wgsl */ `
struct Uniforms {
  resolution : vec2<f32>,
  time : f32,
  speed : f32,
  fullness : f32,
  intensity : f32,
  size : f32,
  _pad : f32,
  skyBottom : vec4<f32>,
  skyTop : vec4<f32>,
  cloudColor : vec4<f32>,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

// Full-screen triangle — three verts, no vertex buffer.
@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(p[i], 0.0, 1.0);
}

fn hash(p : vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

// Smooth value noise.
fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash(i + vec2<f32>(0.0, 0.0));
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian motion — the "noise group": 5 octaves at doubling frequency,
// halving amplitude. This is what gives the clouds their soft, billowy look.
fn fbm(p : vec2<f32>) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var freq = p;
  for (var o = 0; o < 5; o = o + 1) {
    v = v + amp * vnoise(freq);
    freq = freq * 2.02;
    amp = amp * 0.5;
  }
  return v;
}

@fragment
fn fs(@builtin(position) frag : vec4<f32>) -> @location(0) vec4<f32> {
  let aspect = u.resolution.x / max(u.resolution.y, 1.0);
  var uv = frag.xy / u.resolution;
  // vertical gradient axis kept in 0..1; horizontal scaled by aspect for round clouds.
  let scale = mix(1.6, 5.5, u.size);
  var p = vec2<f32>(uv.x * aspect, uv.y) * scale;

  let t = u.time * mix(0.01, 0.12, u.speed);

  // Domain warp — offset the sample coords by a low-octave fbm so clouds curl.
  let warp = vec2<f32>(
    fbm(p + vec2<f32>(t, 0.0)),
    fbm(p + vec2<f32>(0.0, t) + 5.2)
  );
  let density = fbm(p + warp * 1.8 + vec2<f32>(t * 0.6, t * 0.3));

  // Coverage threshold (fullness) + contrast (intensity).
  let cover = mix(0.62, 0.18, u.fullness);
  let edge = mix(0.30, 0.06, u.intensity);
  let cloud = smoothstep(cover, cover + edge, density);

  // Sky gradient horizon -> zenith, then blend the cloud tint on top.
  let sky = mix(u.skyBottom.rgb, u.skyTop.rgb, uv.y);
  let col = mix(sky, u.cloudColor.rgb, cloud * mix(0.5, 1.0, u.intensity));
  return vec4<f32>(col, 1.0);
}
`;

export class CloudRenderer {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice | null = null;
  private ctx: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuf: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private raf = 0;
  private start0 = 0;
  private destroyed = false;
  private params: CloudParams;

  constructor(canvas: HTMLCanvasElement, params: CloudParams) {
    this.canvas = canvas;
    this.params = params;
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  setParams(p: CloudParams) {
    this.params = p;
  }

  // Returns true once the pipeline is live and the loop is running; false (and
  // tears itself down) on any failure, so the host can fall back to a static sky.
  async start(): Promise<boolean> {
    if (!CloudRenderer.supported()) return false;
    try {
      const adapter = await navigator.gpu!.requestAdapter();
      if (!adapter || this.destroyed) return false;
      const device = await adapter.requestDevice();
      if (this.destroyed) {
        device.destroy?.();
        return false;
      }
      this.device = device;
      const ctx = this.canvas.getContext('webgpu');
      if (!ctx) return false;
      this.ctx = ctx;
      this.format = navigator.gpu!.getPreferredCanvasFormat();
      ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

      const module = device.createShaderModule({ code: WGSL });
      this.pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      });

      // 16 floats: resolution(2) time speed fullness intensity size _pad,
      // then skyBottom(4) skyTop(4) cloudColor(4) = 8 + 12 = 20 -> round to 24 (96 bytes).
      this.uniformBuf = device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.bindGroup = device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }],
      });

      device.lost.then(() => {
        // Device loss (driver reset, tab backgrounded too long): stop cleanly.
        if (!this.destroyed) this.stop();
      });

      this.start0 = performance.now();
      this.resize();
      this.loop();
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private loop = () => {
    if (this.destroyed || !this.device || !this.ctx || !this.pipeline || !this.uniformBuf || !this.bindGroup)
      return;
    this.resize();
    const elapsed = this.params.paused ? 8.0 : (performance.now() - this.start0) / 1000;
    const { speed, fullness, intensity, size, sky } = this.params;
    const data = new Float32Array(24);
    data[0] = this.canvas.width;
    data[1] = this.canvas.height;
    data[2] = elapsed;
    data[3] = speed;
    data[4] = fullness;
    data[5] = intensity;
    data[6] = size;
    data[7] = 0;
    data.set([...sky.bottom, 1], 8);
    data.set([...sky.top, 1], 12);
    data.set([...sky.cloud, 1], 16);
    this.device.queue.writeBuffer(this.uniformBuf, 0, data);

    const encoder = this.device.createCommandEncoder();
    const view = this.ctx.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // When paused (reduced motion) render a single frame and idle.
    if (!this.params.paused) this.raf = requestAnimationFrame(this.loop);
  };

  // Call when params change while paused, to repaint the one frozen frame.
  repaintOnce() {
    if (this.params.paused && !this.destroyed) this.loop();
  }

  stop() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    try {
      this.device?.destroy?.();
    } catch {
      /* ignore */
    }
    this.device = null;
    this.ctx = null;
    this.pipeline = null;
    this.uniformBuf = null;
    this.bindGroup = null;
  }
}
