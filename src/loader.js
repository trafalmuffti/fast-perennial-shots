// Streams level files while reporting downloaded bytes.

async function fetchBytes(url, onChunk) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url} (${res.status})`);
  if (!res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    onChunk(buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onChunk(received);
  }
  const out = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out.buffer;
}

export async function loadManifest(url = 'levels/manifest.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load level manifest (${res.status})`);
  return res.json();
}

// entry: manifest level entry { id, files: [{ path, bytes }] }
// onProgress(loadedBytes, totalBytes, currentPath)
export async function loadLevelFiles(entry, onProgress) {
  const expected = entry.files.reduce((s, f) => s + f.bytes, 0);
  const got = new Map();
  const report = (path) => {
    let loaded = 0;
    for (const v of got.values()) loaded += v;
    onProgress(loaded, Math.max(expected, loaded), path);
  };
  const buffers = await Promise.all(
    entry.files.map((f) =>
      fetchBytes(f.path, (n) => {
        got.set(f.path, n);
        report(f.path);
      }),
    ),
  );
  const files = {};
  entry.files.forEach((f, i) => (files[f.path.split('/').pop()] = buffers[i]));
  return files;
}
