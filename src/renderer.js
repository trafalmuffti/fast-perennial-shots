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
export const MODE_GRASS = 3;

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
  terrain: vec4f,     // half size, cell size, resolution, unused
};
struct Inst { model: mat4x4f, tint: vec4f };

@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var<storage, read> insts: array<Inst>;
@group(1) @binding(0) var shadowMap: texture_depth_2d;
@group(1) @binding(1) var shadowSamp: sampler_comparison;
@group(1) @binding(2) var heightMap: texture_2d<f32>;

fn toLinear(c: vec3f) -> vec3f { return pow(max(c, vec3f(1e-5)), vec3f(2.2)); }
fn toneMap(c: vec3f) -> vec3f {
  // ACES fitted approximation, then gamma.
  let a = c * (2.51 * c + 0.03);
  let b = c * (2.43 * c + 0.59) + 0.14;
  return pow(clamp(a / b, vec3f(1e-5), vec3f(1.0)), vec3f(1.0 / 2.2));
}

// ---- procedural noise (integer hash, stable at large world coordinates)
fn hash3(p: vec3i) -> f32 {
  var h = (bitcast<u32>(p.x) * 0x8da6b343u) ^ (bitcast<u32>(p.y) * 0xd8163841u) ^ (bitcast<u32>(p.z) * 0xcb1ab31fu);
  h = h ^ (h >> 13u);
  h = h * 0x5bd1e995u;
  h = h ^ (h >> 15u);
  return f32(h & 0xffffffu) / 16777216.0;
}
fn vnoise(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(hash3(i), hash3(i + vec3i(1, 0, 0)), u.x);
  let b = mix(hash3(i + vec3i(0, 1, 0)), hash3(i + vec3i(1, 1, 0)), u.x);
  let c = mix(hash3(i + vec3i(0, 0, 1)), hash3(i + vec3i(1, 0, 1)), u.x);
  let d = mix(hash3(i + vec3i(0, 1, 1)), hash3(i + vec3i(1, 1, 1)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
fn fbm(p: vec3f) -> f32 {
  return vnoise(p) * 0.5 + vnoise(p * 2.07 + 11.0) * 0.25 + vnoise(p * 4.3 + 23.0) * 0.125 + vnoise(p * 8.9 + 37.0) * 0.0625;
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
  @location(4) @interpolate(flat) mat: u32,
};

fn displaced(v: VIn, inst: Inst) -> vec3f {
  var p = v.pos;
  let mode = inst.tint.w;
  let t = G.sunDir.w;
  if (mode > 1.5 && mode < 2.5) {
    // Flag cloth: travelling waves growing towards the fly end.
    let amp = 0.16 * p.x;
    p.z += sin(p.x * 2.4 - t * 5.5 + p.y * 0.9) * amp + sin(p.x * 5.1 - t * 8.0) * 0.03 * p.x;
    p.y += sin(p.x * 1.7 - t * 3.1) * 0.04 * p.x;
  } else if (mode > 2.5 && mode < 3.5) {
    // Grass: bend the blade tips with a slow gust field.
    let o = inst.model[3].xz;
    let gust = sin(t * 1.3 + o.x * 0.35 + o.y * 0.21) * 0.6 + sin(t * 2.9 + o.x * 1.1) * 0.25;
    p.x += gust * p.y * 0.35;
    p.z += cos(t * 1.1 + o.y * 0.4) * p.y * 0.12;
  }
  return p;
}

@vertex fn vs(v: VIn) -> VOut {
  let inst = insts[v.ii];
  let wp = inst.model * vec4f(displaced(v, inst), 1.0);
  var o: VOut;
  o.clip = G.viewProj * wp;
  o.wpos = wp.xyz;
  o.nrm = (inst.model * vec4f(v.nrm.xyz, 0.0)).xyz;
  let c = v.col.rgb;
  o.col = mix(c, c * inst.tint.rgb, v.col.a);
  o.mode = inst.tint.w;
  o.mat = u32(round(v.nrm.w * 127.0));
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

// Bilinear terrain height from the heightfield texture.
fn terrainHeight(x: f32, z: f32) -> f32 {
  let res = i32(G.terrain.z);
  let fx = (x + G.terrain.x) / G.terrain.y;
  let fz = (z + G.terrain.x) / G.terrain.y;
  let ix = clamp(i32(floor(fx)), 0, res - 2);
  let iz = clamp(i32(floor(fz)), 0, res - 2);
  let tx = clamp(fx - f32(ix), 0.0, 1.0);
  let tz = clamp(fz - f32(iz), 0.0, 1.0);
  let h00 = textureLoad(heightMap, vec2i(ix, iz), 0).r;
  let h10 = textureLoad(heightMap, vec2i(ix + 1, iz), 0).r;
  let h01 = textureLoad(heightMap, vec2i(ix, iz + 1), 0).r;
  let h11 = textureLoad(heightMap, vec2i(ix + 1, iz + 1), 0).r;
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), tz);
}

struct Surf { albedo: vec3f, spec: f32, gloss: f32, wrap: f32 };

// Per-material procedural detail layered over the vertex colour.
fn surface(mat: u32, p: vec3f, n: vec3f, base: vec3f) -> Surf {
  var s: Surf;
  s.albedo = base;
  s.spec = 0.04;
  s.gloss = 12.0;
  s.wrap = 0.0;
  switch (mat) {
    case 1u: { // sawn planks: horizontal grain, seams every 0.3 m
      var t = normalize(cross(n, vec3f(0.0, 1.0, 0.0)));
      if (abs(n.y) > 0.9) { t = vec3f(1.0, 0.0, 0.0); }
      let along = dot(p, t);
      let across = select(p.y, dot(p, cross(n, t)), abs(n.y) > 0.9);
      let g = fbm(vec3f(along * 0.8, across * 14.0, dot(p, n) * 3.0));
      let ring = sin(across * 40.0 + g * 6.0) * 0.5 + 0.5;
      let seam = 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.08, abs(fract(across / 0.3) - 0.5) * 0.3));
      s.albedo = base * (0.72 + 0.42 * g + 0.12 * ring) * seam;
      s.spec = 0.08;
      s.gloss = 18.0;
    }
    case 2u: { // round logs: grain along the length (vertical for posts)
      let g = fbm(vec3f(p.x * 7.0, p.y * 0.7, p.z * 7.0));
      let fine = vnoise(vec3f(p.x * 30.0, p.y * 2.0, p.z * 30.0));
      let knot = smoothstep(0.62, 0.7, vnoise(p * 2.3)) * 0.35;
      s.albedo = base * (0.7 + 0.5 * g + 0.12 * fine - knot);
      s.spec = 0.05;
      s.gloss = 10.0;
    }
    case 3u: { // bark: deep vertical fissures
      let g = fbm(vec3f(p.x * 5.0, p.y * 1.3, p.z * 5.0));
      let crack = smoothstep(0.3, 0.55, g);
      s.albedo = base * (0.5 + 0.7 * crack) * (0.85 + 0.3 * vnoise(p * 25.0));
      s.spec = 0.02;
    }
    case 4u: { // foliage: speckled, slightly translucent
      let g = vnoise(p * 7.0) * 0.6 + vnoise(p * 23.0) * 0.4;
      s.albedo = base * (0.65 + 0.7 * g);
      s.spec = 0.06;
      s.gloss = 8.0;
      s.wrap = 0.45;
    }
    case 5u: { // terrain: large patches + fine grass speckle
      let blotch = fbm(vec3f(p.x * 0.18, 0.0, p.z * 0.18));
      let fine = vnoise(vec3f(p.x * 6.0, 0.0, p.z * 6.0)) * 0.5 + vnoise(vec3f(p.x * 21.0, 0.0, p.z * 21.0)) * 0.5;
      s.albedo = base * (0.78 + 0.45 * blotch) * (0.8 + 0.4 * fine);
      s.spec = 0.0;
    }
    case 6u: { // metal: fine scratches, bright highlights
      let sc = vnoise(vec3f(p.x * 55.0, p.y * 4.0, p.z * 55.0)) * 0.5 + vnoise(vec3f(p.x * 4.0, p.y * 55.0, p.z * 4.0)) * 0.5;
      s.albedo = base * (0.8 + 0.4 * sc);
      s.spec = 0.6;
      s.gloss = 46.0;
    }
    case 7u: { // cloth: tight weave + soft creases
      let weave = vnoise(p * 90.0) * 0.5 + vnoise(p * 180.0) * 0.5;
      let crease = fbm(p * 3.5);
      s.albedo = base * (0.8 + 0.25 * weave) * (0.85 + 0.3 * crease);
      s.spec = 0.03;
      s.gloss = 6.0;
      s.wrap = 0.15;
    }
    case 8u: { // skin
      s.albedo = base * (0.94 + 0.12 * vnoise(p * 40.0));
      s.spec = 0.18;
      s.gloss = 22.0;
      s.wrap = 0.3;
    }
    case 9u: { // stone: pitted, with lichen-coloured patches
      let g = fbm(p * 1.6);
      let pits = smoothstep(0.55, 0.75, vnoise(p * 14.0));
      s.albedo = base * (0.7 + 0.5 * g - 0.25 * pits);
      s.spec = 0.1;
      s.gloss = 10.0;
    }
    case 10u: { // canvas / burlap: coarse weave
      let weave = vnoise(p * 45.0) * 0.6 + vnoise(p * 120.0) * 0.4;
      s.albedo = base * (0.75 + 0.4 * weave) * (0.9 + 0.2 * fbm(p * 2.0));
      s.spec = 0.03;
      s.wrap = 0.1;
    }
    case 11u: { // grass blades
      s.albedo = base * (0.9 + 0.2 * vnoise(p * 9.0));
      s.spec = 0.12;
      s.gloss = 14.0;
      s.wrap = 0.5;
    }
    case 12u: { // paint: slight wear
      let wear = smoothstep(0.6, 0.8, vnoise(p * 18.0)) * 0.15;
      s.albedo = base * (1.0 - wear) * (0.95 + 0.1 * vnoise(p * 60.0));
      s.spec = 0.25;
      s.gloss = 30.0;
    }
    case 13u: { // leather
      s.albedo = base * (0.85 + 0.3 * vnoise(p * 70.0));
      s.spec = 0.2;
      s.gloss = 14.0;
    }
    default: {}
  }
  return s;
}

@fragment fn fs(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let base = toLinear(i.col);
  var col: vec3f;
  if (i.mode > 0.5 && i.mode < 1.5) {
    col = base * 3.0;
  } else {
    var n = normalize(i.nrm);
    if (!ff) { n = -n; }
    let surf = surface(i.mat, i.wpos, n, base);
    let L = normalize(G.sunDir.xyz);
    let V = normalize(G.camPos.xyz - i.wpos);
    let ndl = clamp((dot(n, L) + surf.wrap) / (1.0 + surf.wrap), 0.0, 1.0);
    let sh = shadowFactor(i.wpos, n);
    // Contact darkening where things meet the ground.
    var ao = 1.0;
    if (i.mat != 5u) {
      let hgt = i.wpos.y - terrainHeight(i.wpos.x, i.wpos.z);
      ao = mix(0.45, 1.0, smoothstep(-0.2, 1.6, hgt));
    }
    // Slight cavity darkening on downward-facing surfaces.
    ao *= mix(0.75, 1.0, n.y * 0.5 + 0.5);
    let hemi = mix(toLinear(G.groundAmb.rgb), toLinear(G.skyTop.rgb) * 0.8 + toLinear(G.skyHorizon.rgb) * 0.2, n.y * 0.5 + 0.5);
    let sun = G.sunColor.rgb * ndl * sh;
    let H = normalize(L + V);
    let spec = pow(max(dot(n, H), 0.0), surf.gloss) * surf.spec * sh * (0.2 + 0.8 * ndl);
    let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * surf.spec * 0.6;
    col = surf.albedo * (hemi * G.groundAmb.w * ao + sun * (0.7 + 0.3 * ao)) + G.sunColor.rgb * spec + hemi * fres;
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
  return G.lightViewProj * inst.model * vec4f(displaced(v, inst), 1.0);
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
  // Cumulus layer: project the view ray onto a plane and shade noise by density.
  let planar = dir.xz / (h + 0.12) * 1.4 + vec2f(G.sunDir.w * 0.012, 0.0);
  let cloud = fbm(vec3f(planar.x, planar.y, 3.0)) + fbm(vec3f(planar.x * 3.0, planar.y * 3.0, 9.0)) * 0.25;
  let dens = smoothstep(0.52, 0.72, cloud);
  let lit = mix(vec3f(0.55, 0.6, 0.7), vec3f(1.05), smoothstep(0.55, 0.85, cloud)) * (0.9 + 0.3 * sd);
  col = mix(col, lit, dens * smoothstep(0.0, 0.18, h) * 0.9);
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
    this.globals = new Float32Array(16 * 3 + 4 * 8);
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
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    this.g1Layout = g1Layout;
    this.shadowSampler = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.group0 = d.createBindGroup({
      layout: g0Layout,
      entries: [
        { binding: 0, resource: { buffer: this.globalBuf } },
        { binding: 1, resource: { buffer: this.instBuf } },
      ],
    });
    this.shadowTex = d.createTexture({ size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.setTerrain(new Float32Array(4), 2, 1); // placeholder until a level loads

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

  // Heightfield used for ground-contact shading. heights: Float32Array(res*res).
  setTerrain(heights, res, size) {
    const d = this.device;
    this.heightTex?.destroy();
    this.heightTex = d.createTexture({ size: [res, res], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    d.queue.writeTexture({ texture: this.heightTex }, heights, { bytesPerRow: res * 4 }, [res, res]);
    this.terrainParams = [size / 2, size / (res - 1), res, 0];
    this.group1 = d.createBindGroup({
      layout: this.g1Layout,
      entries: [
        { binding: 0, resource: this.shadowTex.createView() },
        { binding: 1, resource: this.shadowSampler },
        { binding: 2, resource: this.heightTex.createView() },
      ],
    });
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
    put(this.terrainParams, 0);
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
      drawBatches(pass, batches(world, 0, (e) => e.tint[3] !== MODE_EMISSIVE && e.tint[3] !== MODE_GRASS));
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
