// Binary model pack (".bin") produced by tools/build-levels.mjs.
//
//   0  'FPSM' magic
//   4  u32 version
//   8  u32 header byte length (JSON, UTF-8, padded to 4 bytes)
//  12  header JSON
//   …  data section: interleaved vertices, u32 indices, extra blobs
//
// Vertex layout (20 bytes): float32x3 position, snorm8x4 normal,
// unorm8x4 color (alpha = 1 marks the vertex as tintable per instance).
// All byte offsets in the header are relative to the start of the data section.

export const MAGIC = 0x4d535046; // 'FPSM' little-endian
export const VERSION = 1;
export const VERTEX_STRIDE = 20;

export function parseModelPack(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not a model pack');
  const version = dv.getUint32(4, true);
  if (version !== VERSION) throw new Error(`Unsupported model pack version ${version}`);
  const headerLen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headerLen)).replace(/\s+$/, ''));
  const base = 12 + headerLen;
  const vertexBytes = new Uint8Array(buffer, base + header.vertexByteOffset, header.vertexCount * VERTEX_STRIDE);
  const indices = new Uint32Array(buffer, base + header.indexByteOffset, header.indexCount);
  const blobs = {};
  for (const [name, b] of Object.entries(header.blobs || {})) {
    blobs[name] = new Float32Array(buffer, base + b.byteOffset, b.count);
  }
  return { header, models: header.models, vertexBytes, indices, blobs };
}
