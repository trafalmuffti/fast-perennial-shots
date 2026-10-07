// WebGPU forward renderer: sky, sun shadow map, vertex-coloured lit meshes,
// emissive effects, and a separate depth-cleared pass for the first-person weapon.
import { mat4 } from './math.js';
import { VERTEX_STRIDE } from './modelpack.js';

const MAX_INSTANCES = 8192;
const INSTANCE_FLOATS = 20; // mat4 + tint vec4
const SHADOW_SIZE = 2048;

// Instance tint.w modes.
export const MODE_LIT = 0;
export const MODE_EMISSIVE = 1;
export const MODE_WAVE = 2;

const SHADER = /* wgsl */ `
struct Globals {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  lightViewProj: mat4x4f,
  camPos: vec4f,
  sunDir: vec4f,      // xyz towards the sun, w = time
  sunColor: vec4f,    // rgb * intensity
  skyTop: vec4f,
  skyHorizon: vec4f,  // also fog colour, w = fog density
  groundAmb: vec4f,   // w = ambient strength
  flash: vec4f,       // full-screen tint (rgb, w = amount)
};
struct Inst { model: mat4x4f, tint: vec4f };

@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var<storage, read> insts: array<Inst>;
@group(1) @binding(0) var shadowMap: texture_depth_2d;
@group(1) @binding(1) var shadowSamp: sampler_comparison;

fn toLinear(c: vec3f) -> vec3f { return pow(max(c, vec3f(1e-5)), vec3f(2.2)); }
fn toneMap(c: vec3f) -> vec3f {
  // ACES fitted approximation, then gamma.
  let a = c * (2.51 * c + 0.03);
  let b = c * (2.43 * c + 0.59) + 0.14;
  return pow(clamp(a / b, vec3f(1e-5), vec3f(1.0)), vec3f(1.0 / 2.2));
}

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec4f,
  @location(2) col: vec4f,
  @builtin(instance_index) ii: u32,
};
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
  @location(3) @interpolate(flat) mode: f32,
};

fn displaced(v: VIn, mode: f32) -> vec3f {
  var p = v.pos;
  if (mode > 1.5 && mode < 2.5) {
    let t = G.sunDir.w;
    let amp = 0.16 * p.x;
    p.z += sin(p.x * 2.4 - t * 5.5 + p.y * 0.9) * amp + sin(p.x * 5.1 - t * 8.0) * 0.03 * p.x;
  }
  return p;
}

@vertex fn vs(v: VIn) -> VOut {
  let inst = insts[v.ii];
  let mode = inst.tint.w;
  let wp = inst.model * vec4f(displaced(v, mode), 1.0);
  var o: VOut;
  o.clip = G.viewProj * wp;
  o.wpos = wp.xyz;
  o.nrm = (inst.model * vec4f(v.nrm.xyz, 0.0)).xyz;
  let c = v.col.rgb;
  o.col = mix(c, c * inst.tint.rgb, v.col.a);
  o.mode = mode;
  return o;
}

fn shadowFactor(wpos: vec3f, n: vec3f) -> f32 {
  let lp = G.lightViewProj * vec4f(wpos + n * 0.06, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + vec2f(0.5);
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0 || lp.z >= 1.0) { return 1.0; }
  let texel = 1.0 / ${SHADOW_SIZE}.0;
  var s = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      s += textureSampleCompareLevel(shadowMap, shadowSamp, uv + vec2f(f32(x), f32(y)) * texel, lp.z - 0.0012);
    }
  }
  return s / 9.0;
}

@fragment fn fs(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let base = toLinear(i.col);
  var col: vec3f;
  if (i.mode > 0.5 && i.mode < 1.5) {
    col = base * 3.0;
  } else {
    var n = normalize(i.nrm);
    if (!ff) { n = -n; }
    let L = normalize(G.sunDir.xyz);
    let ndl = max(dot(n, L), 0.0);
    let sh = shadowFactor(i.wpos, n);
    let hemi = mix(toLinear(G.groundAmb.rgb), toLinear(G.skyTop.rgb) * 0.8 + toLinear(G.skyHorizon.rgb) * 0.2, n.y * 0.5 + 0.5);
    col = base * (hemi * G.groundAmb.w + G.sunColor.rgb * ndl * sh);
  }
  let d = distance(i.wpos, G.camPos.xyz);
  let f = 1.0 - exp(-d * G.skyHorizon.w);
  col = mix(col, toLinear(G.skyHorizon.rgb) * 1.1, clamp(f, 0.0, 1.0));
  col = mix(col, G.flash.rgb, G.flash.w);
  return vec4f(toneMap(col), 1.0);
}

// ---- shadow pass (depth only)
@vertex fn vsShadow(v: VIn) -> @builtin(position) vec4f {
  let inst = insts[v.ii];
  return G.lightViewProj * inst.model * vec4f(displaced(v, inst.tint.w), 1.0);
}

// ---- sky (fullscreen triangle)
struct SkyOut { @builtin(position) clip: vec4f, @location(0) ndc: vec2f };
@vertex fn vsSky(@builtin(vertex_index) vi: u32) -> SkyOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: SkyOut;
  o.clip = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}
@fragment fn fsSky(i: SkyOut) -> @location(0) vec4f {
  let far = G.invViewProj * vec4f(i.ndc, 1.0, 1.0);
  let near = G.invViewProj * vec4f(i.ndc, 0.0, 1.0);
  let dir = normalize(far.xyz / far.w - near.xyz / near.w);
  let L = normalize(G.sunDir.xyz);
  let h = max(dir.y, 0.0);
  var col = mix(toLinear(G.skyHorizon.rgb) * 1.1, toLinear(G.skyTop.rgb), pow(h, 0.55));
  let sd = max(dot(dir, L), 0.0);
  col += G.sunColor.rgb * (pow(sd, 900.0) * 6.0 + pow(sd, 12.0) * 0.12);
  // Soft cloud bands.
  let cloud = sin(dir.x * 9.0 / (h + 0.15) + G.sunDir.w * 0.02) * sin(dir.z * 7.0 / (h + 0.15)) * 0.5 + 0.5;
  col = mix(col, vec3f(0.95), smoothstep(0.65, 0.95, cloud) * smoothstep(0.02, 0.25, h) * 0.35);
  if (dir.y < 0.0) { col = toLinear(G.skyHorizon.rgb) * 1.1; }
  col = mix(col, G.flash.rgb, G.flash.w);
  return vec4f(toneMap(col), 1.0);
}
`;

export class Renderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No suitable GPU adapter found.');
    const device = await adapter.requestDevice();
    const r = new Renderer(canvas, device);
    r.adapter = adapter; // keep the adapter (and its instance) alive alongside the device
    return r;
  }

  constructor(canvas, device) {
    this.canvas = canvas;
    this.device = device;
    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.models = {};
    this.list = [];
    this.viewList = [];
    this.instanceData = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);
    this.globals = new Float32Array(16 * 3 + 4 * 7);
    this.time = 0;
    this.renderScale = Math.min(window.devicePixelRatio || 1, 1.5);
    device.lost.then((info) => console.error('WebGPU device lost:', info.message));
    device.addEventListener?.('uncapturederror', (e) => console.error('WebGPU error:', e.error.message));
    this.#createPipelines();
  }

  #createPipelines() {
    const d = this.device;
    const module = d.createShaderModule({ code: SHADER });
    this.globalBuf = d.createBuffer({ size: this.globals.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.instBuf = d.createBuffer({ size: this.instanceData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    const g0Layout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const g1Layout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    this.group0 = d.createBindGroup({
      layout: g0Layout,
      entries: [
        { binding: 0, resource: { buffer: this.globalBuf } },
        { binding: 1, resource: { buffer: this.instBuf } },
      ],
    });
    this.shadowTex = d.createTexture({ size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.group1 = d.createBindGroup({
      layout: g1Layout,
      entries: [
        { binding: 0, resource: this.shadowTex.createView() },
        { binding: 1, resource: d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' }) },
      ],
    });

    const vertexBuffers = [{
      arrayStride: VERTEX_STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
        { shaderLocation: 2, offset: 16, format: 'unorm8x4' },
      ],
    }];
    const mainLayout = d.createPipelineLayout({ bindGroupLayouts: [g0Layout, g1Layout] });
    this.mainPipeline = d.createRenderPipeline({
      layout: mainLayout,
      vertex: { module, entryPoint: 'vs', buffers: vertexBuffers },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.skyPipeline = d.createRenderPipeline({
      layout: mainLayout,
      vertex: { module, entryPoint: 'vsSky' },
      fragment: { module, entryPoint: 'fsSky', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
    });
    this.shadowPipeline = d.createRenderPipeline({
      layout: d.createPipelineLayout({ bindGroupLayouts: [g0Layout] }),
      vertex: { module, entryPoint: 'vsShadow', buffers: vertexBuffers },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0 },
    });
  }

  // Upload a parsed model pack (see modelpack.js).
  loadModelPack(pack) {
    const d = this.device;
    this.vertexBuf?.destroy();
    this.indexBuf?.destroy();
    this.vertexBuf = d.createBuffer({ size: align4(pack.vertexBytes.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.vertexBuf, 0, pack.vertexBytes);
    this.indexBuf = d.createBuffer({ size: align4(pack.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.indexBuf, 0, pack.indices);
    this.models = {};
    let i = 0;
    for (const [name, m] of Object.entries(pack.models)) this.models[name] = { ...m, id: i++ };
  }

  setEnvironment(env) {
    this.env = env;
    const c = env.shadowCenter, r = env.shadowRadius;
    const L = normalize3(env.sunDir);
    const eye = [c[0] + L[0] * 150, c[1] + L[1] * 150, c[2] + L[2] * 150];
    this.lightViewProj = mat4.multiply(mat4.ortho(-r, r, -r, r, 10, 320), mat4.lookAt(eye, c, [0, 1, 0]));
  }

  // Queue a draw for this frame. `view` = draw in the first-person weapon pass.
  draw(model, matrix, tint = WHITE_LIT, view = false) {
    const m = this.models[model];
    if (!m) return;
    (view ? this.viewList : this.list).push({ m, matrix, tint });
  }

  resize() {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * this.renderScale));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * this.renderScale));
    if (this.canvas.width !== w || this.canvas.height !== h || !this.depthTex) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.depthTex?.destroy();
      this.depthTex = this.device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    return w / h;
  }

  // camera: { view, proj, pos }, flash: [r,g,b,a]
  render(camera, flash = [0, 0, 0, 0]) {
    const d = this.device, env = this.env;
    this.resize();
    const viewProj = mat4.multiply(camera.proj, camera.view);
    const g = this.globals;
    g.set(viewProj, 0);
    g.set(mat4.invert(viewProj), 16);
    g.set(this.lightViewProj, 32);
    let o = 48;
    const put = (a, w = 0) => { g[o++] = a[0]; g[o++] = a[1]; g[o++] = a[2]; g[o++] = w; };
    put(camera.pos, 1);
    put(normalize3(env.sunDir), this.time);
    put(env.sunColor.map((x) => x * env.sunIntensity));
    put(env.skyTop);
    put(env.skyHorizon, env.fogDensity);
    put(env.groundAmbient, env.ambient);
    put(flash, flash[3]);
    d.queue.writeBuffer(this.globalBuf, 0, g);

    // Sort by model so identical meshes become one instanced draw.
    const world = this.list.sort((a, b) => a.m.id - b.m.id);
    const view = this.viewList;
    const count = Math.min(world.length + view.length, MAX_INSTANCES);
    const data = this.instanceData;
    const all = world.concat(view);
    for (let i = 0; i < count; i++) {
      data.set(all[i].matrix, i * INSTANCE_FLOATS);
      data.set(all[i].tint, i * INSTANCE_FLOATS + 16);
    }
    d.queue.writeBuffer(this.instBuf, 0, data, 0, count * INSTANCE_FLOATS);

    const batches = (list, offset, filter) => {
      const out = [];
      for (let i = 0; i < list.length && i + offset < count; i++) {
        if (filter && !filter(list[i])) continue;
        const last = out[out.length - 1];
        if (last && last.m === list[i].m && last.first + last.n === i + offset) last.n++;
        else out.push({ m: list[i].m, first: i + offset, n: 1 });
      }
      return out;
    };
    const drawBatches = (pass, bs) => {
      for (const b of bs) pass.drawIndexed(b.m.indexCount, b.n, b.m.firstIndex, b.m.baseVertex, b.first);
    };

    const enc = d.createCommandEncoder();
    // Shadow pass: lit world geometry only.
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(this.shadowPipeline);
      pass.setBindGroup(0, this.group0);
      pass.setVertexBuffer(0, this.vertexBuf);
      pass.setIndexBuffer(this.indexBuf, 'uint32');
      drawBatches(pass, batches(world, 0, (e) => e.tint[3] !== MODE_EMISSIVE && !e.m.noShadow));
      pass.end();
    }
    const colorView = this.ctx.getCurrentTexture().createView();
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: colorView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.group0);
      pass.setBindGroup(1, this.group1);
      pass.setPipeline(this.skyPipeline);
      pass.draw(3);
      pass.setPipeline(this.mainPipeline);
      pass.setVertexBuffer(0, this.vertexBuf);
      pass.setIndexBuffer(this.indexBuf, 'uint32');
      drawBatches(pass, batches(world, 0));
      pass.end();
    }
    if (view.length) {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: colorView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setBindGroup(0, this.group0);
      pass.setBindGroup(1, this.group1);
      pass.setPipeline(this.mainPipeline);
      pass.setVertexBuffer(0, this.vertexBuf);
      pass.setIndexBuffer(this.indexBuf, 'uint32');
      drawBatches(pass, batches(view, world.length));
      pass.end();
    }
    d.queue.submit([enc.finish()]);
    this.list = [];
    this.viewList = [];
  }
}

export const WHITE_LIT = new Float32Array([1, 1, 1, MODE_LIT]);
const align4 = (n) => Math.ceil(n / 4) * 4;
function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
