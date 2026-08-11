'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const PI = require('../src/logic.js');

// ---------- CRC32 ----------
test('crc32: 已知向量', () => {
  assert.strictEqual(PI.crc32(new Uint8Array(0)), 0x00000000);
  assert.strictEqual(PI.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.strictEqual(PI.crc32(new TextEncoder().encode('abc')), 0x352441C2);
});

test('crc32: 与 node:zlib 交叉验证（随机数据）', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  for (let t = 0; t < 20; t++) {
    const len = rnd() % 5000;
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) buf[i] = rnd() & 0xff;
    assert.strictEqual(PI.crc32(buf), zlib.crc32(buf), `len=${len}`);
  }
});

// ---------- PNG 解析辅助 ----------
function parsePng(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.strictEqual(bytes[0], 0x89); assert.strictEqual(bytes[1], 0x50); // PNG 签名
  const chunks = [];
  let off = 8;
  while (off < bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const data = bytes.slice(off + 8, off + 8 + len);
    const crc = dv.getUint32(off + 8 + len);
    const calc = PI.crc32(bytes.slice(off + 4, off + 8 + len));
    assert.strictEqual(crc, calc, `chunk ${type} CRC`);
    chunks.push({ type, data });
    off += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const w = new DataView(ihdr.buffer).getUint32(0);
  const h = new DataView(ihdr.buffer).getUint32(4);
  const colorType = ihdr[9];
  const idat = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
  const total = idat.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let o = 0; for (const c of idat) { merged.set(c, o); o += c.length; }
  const raw = zlib.inflateSync(merged);
  return { w, h, colorType, raw, chunks };
}

function unfilter(raw, w, h, channels) {
  const out = new Uint8Array(w * h * channels);
  const stride = 1 + w * channels;
  for (let y = 0; y < h; y++) {
    const rowStart = y * stride;
    assert.strictEqual(raw[rowStart], 0, 'filter 应为 None');
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < channels; c++) {
        out[(y * w + x) * channels + c] = raw[rowStart + 1 + x * channels + c];
      }
    }
  }
  return out;
}

// ---------- PNG 编码器 ----------
test('encodePng rgb: 往返一致', async () => {
  const w = 3, h = 2;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = i * 40; rgba[i * 4 + 1] = i * 20 + 10; rgba[i * 4 + 2] = 255 - i * 30; rgba[i * 4 + 3] = 255; }
  const bytes = await PI.encodePng({ width: w, height: h, rgba, mode: 'rgb' });
  const png = parsePng(bytes);
  assert.strictEqual(png.w, w); assert.strictEqual(png.h, h); assert.strictEqual(png.colorType, 2);
  const px = unfilter(png.raw, w, h, 3);
  for (let i = 0; i < w * h; i++) {
    assert.strictEqual(px[i * 3], rgba[i * 4]);
    assert.strictEqual(px[i * 3 + 1], rgba[i * 4 + 1]);
    assert.strictEqual(px[i * 3 + 2], rgba[i * 4 + 2]);
  }
});

test('encodePng rgb: 半透明像素按公式与白色混合', async () => {
  const rgba = new Uint8ClampedArray([100, 150, 200, 128]);
  const bytes = await PI.encodePng({ width: 1, height: 1, rgba, mode: 'rgb' });
  const png = parsePng(bytes);
  const px = unfilter(png.raw, 1, 1, 3);
  const expect = (v) => Math.round(v * 128 / 255 + 255 * (1 - 128 / 255));
  assert.strictEqual(px[0], expect(100));
  assert.strictEqual(px[1], expect(150));
  assert.strictEqual(px[2], expect(200));
});

test('encodePng rgba: 保留 alpha 通道', async () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]);
  const bytes = await PI.encodePng({ width: 2, height: 1, rgba, mode: 'rgba' });
  const png = parsePng(bytes);
  assert.strictEqual(png.colorType, 6);
  const px = unfilter(png.raw, 2, 1, 4);
  assert.deepStrictEqual(Array.from(px), Array.from(rgba));
});

test('encodePng palette: PLTE/tRNS/索引正确', async () => {
  const w = 2, h = 1;
  const palette = [[255, 0, 0, 255], [0, 255, 0, 128]];
  const indices = new Uint8Array([0, 1]);
  const bytes = await PI.encodePng({ width: w, height: h, indices, palette, mode: 'palette' });
  const png = parsePng(bytes);
  assert.strictEqual(png.colorType, 3);
  const plte = png.chunks.find((c) => c.type === 'PLTE').data;
  assert.strictEqual(plte.length, 6);
  assert.deepStrictEqual(Array.from(plte), [255, 0, 0, 0, 255, 0]);
  const trns = png.chunks.find((c) => c.type === 'tRNS').data;
  assert.strictEqual(trns.length, 2);
  assert.deepStrictEqual(Array.from(trns), [255, 128]);
  const px = unfilter(png.raw, w, h, 1);
  assert.deepStrictEqual(Array.from(px), Array.from(indices));
});

// ---------- 中位切分量化 ----------
test('quantize: 颜色数不超过上限', () => {
  const w = 64, h = 64;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = (x * 4) % 256; rgba[i + 1] = (y * 4) % 256; rgba[i + 2] = (x * y) % 256; rgba[i + 3] = 255;
  }
  const { palette, indices } = PI.quantize(rgba, 16);
  assert.ok(palette.length <= 16);
  for (const v of indices) assert.ok(v < palette.length);
});

test('quantize: 全透明图 → 单透明表项', () => {
  const rgba = new Uint8ClampedArray(16 * 16 * 4).fill(0);
  const { palette, indices } = PI.quantize(rgba, 4);
  assert.strictEqual(palette.length, 1);
  assert.strictEqual(palette[0][3], 0);
  assert.ok(indices.every((v) => v === 0));
});

test('quantize: 双色图收敛到 2 色', () => {
  const w = 4, h = 4;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = i % 2 === 0 ? 255 : 0;
    rgba[i * 4 + 1] = i % 2 === 0 ? 0 : 255;
    rgba[i * 4 + 2] = 0; rgba[i * 4 + 3] = 255;
  }
  const { palette, indices } = PI.quantize(rgba, 8);
  assert.strictEqual(palette.length, 2);
  assert.strictEqual(indices[0], indices[2]); // 偶数像素同色
  assert.notStrictEqual(indices[0], indices[1]);
});

// ---------- 增强 ----------
test('unsharpMask: 平坦图保持不变', () => {
  const rgba = new Uint8ClampedArray(8 * 8 * 4).fill(255);
  const before = Array.from(rgba);
  PI.unsharpMask(rgba, 8, 8, 1, 0.6);
  assert.deepStrictEqual(Array.from(rgba), before);
});

test('unsharpMask: 模糊图经处理后更锐利（方差增大）', () => {
  const w = 16, h = 16;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = x < 8 ? 40 : 200;
    rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255;
  }
  const tmp = new Uint8ClampedArray(rgba);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) { s += tmp[(yy * w + xx) * 4]; n++; }
    }
    rgba[(y * w + x) * 4] = Math.round(s / n);
    rgba[(y * w + x) * 4 + 1] = Math.round(s / n);
    rgba[(y * w + x) * 4 + 2] = Math.round(s / n);
  }
  const variance = (arr) => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length; };
  const beforeVar = variance(Array.from(rgba).filter((_, i) => i % 4 === 0));
  PI.unsharpMask(rgba, w, h, 1, 0.6);
  const afterVar = variance(Array.from(rgba).filter((_, i) => i % 4 === 0));
  assert.ok(afterVar > beforeVar, `方差应增大: ${beforeVar} -> ${afterVar}`);
});

test('autoContrast: 压缩直方图被拉伸', () => {
  const w = 16, h = 16;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = 80 + (i % 70); rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; }
  PI.autoContrast(rgba, w, h, 0.02, 0.98);
  let min = 255, max = 0;
  for (let i = 0; i < w * h * 4; i += 4) { min = Math.min(min, rgba[i]); max = Math.max(max, rgba[i]); }
  assert.ok(min <= 20, `min=${min}`);
  assert.ok(max >= 235, `max=${max}`);
});

test('autoContrast: 反差已足够时不变', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
  const before = Array.from(rgba);
  PI.autoContrast(rgba, 2, 1, 0.02, 0.98);
  assert.deepStrictEqual(Array.from(rgba), before);
});

// ---------- ZIP 解析辅助 ----------
function parseZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'EOCD 存在');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const entries = [];
  let off = cdOff;
  for (let e = 0; e < count; e++) {
    assert.strictEqual(dv.getUint32(off, true), 0x02014b50, 'central header 签名');
    const flags = dv.getUint16(off + 8, true);
    const method = dv.getUint16(off + 10, true);
    const crc = dv.getUint32(off + 16, true);
    const csize = dv.getUint32(off + 20, true);
    const usize = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.slice(off + 46, off + 46 + nameLen));
    assert.strictEqual(dv.getUint32(localOff, true), 0x04034b50, 'local header 签名');
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.slice(dataStart, dataStart + csize);
    const raw = method === 8 ? zlib.inflateRawSync(comp) : comp;
    assert.strictEqual(raw.length, usize);
    assert.strictEqual(PI.crc32(raw), crc);
    entries.push({ name, method, raw, flags });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- ZIP 生成器 ----------
test('buildZip: 多文件含中文名，往返一致', async () => {
  const data1 = new Uint8Array(1000).map((_, i) => (i * 7) % 256);
  const data2 = new TextEncoder().encode('中文文件名测试 - hello zip');
  const bytes = await PI.buildZip([
    { name: '照片/风景 001.jpg', data: data1 },
    { name: '测试文本.txt', data: data2 },
  ]);
  const entries = parseZip(bytes);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].name, '照片/风景 001.jpg');
  assert.ok(entries[0].flags & 0x0800, 'UTF-8 标志');
  assert.deepStrictEqual(Array.from(entries[0].raw), Array.from(data1));
  assert.deepStrictEqual(Array.from(entries[1].raw), Array.from(data2));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  assert.strictEqual(dv.getUint32(eocd, true), 0x06054b50);
  assert.strictEqual(dv.getUint32(eocd + 12, true) + dv.getUint32(eocd + 16, true) + 22, bytes.length);
});

test('buildZip: 不可压缩数据退化为 store', async () => {
  const data = new Uint8Array(2048).map((_, i) => i % 251);
  const bytes = await PI.buildZip([{ name: 'rand.bin', data }]);
  const entries = parseZip(bytes);
  assert.strictEqual(entries.length, 1);
  assert.deepStrictEqual(Array.from(entries[0].raw), Array.from(data));
});

test('buildZip: 用系统 Python 交叉验证', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const out = new TextEncoder().encode('python 验证内容');
  return (async () => {
    const zip = await PI.buildZip([{ name: 'py/验证.txt', data: out }]);
    fs.mkdirSync('tests/out', { recursive: true });
    fs.writeFileSync('tests/out/cross.zip', zip);
    const py = spawnSync('python', ['-c',
      'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.read("py/验证.txt").decode()=="python 验证内容"; print("PYZIP_OK")',
      'tests/out/cross.zip'], { encoding: 'utf8' });
    assert.strictEqual(py.status, 0, `python 输出: ${py.stdout}${py.stderr}`);
    assert.match(py.stdout, /PYZIP_OK/);
  })();
});
