/* 纯逻辑引擎：UMD —— 浏览器挂 window.PI，Node 挂 module.exports */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- CRC32（查表法，IEEE 802.3）----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, start = 0, end = bytes.length) {
    let c = 0xFFFFFFFF;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------- 工具 ----------
  function u32be(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, false); return b; } // PNG 大端
  function u16le(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
  const encoder = new TextEncoder();

  // CompressionStream('deflate') = zlib 格式（PNG 用）；'deflate-raw' = 裸 deflate（ZIP 用）
  async function deflate(bytes, format) {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = cs.readable.getReader();
    const parts = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const zlibDeflate = (bytes) => deflate(bytes, 'deflate');
  const rawDeflate = (bytes) => deflate(bytes, 'deflate-raw');

  // ---------- PNG 编码器 ----------
  function pngChunk(type, data) {
    const len = u32be(data.length); // PNG 规范：长度与 CRC 均为大端序
    const typeBytes = encoder.encode(type);
    const crcBuf = new Uint8Array(typeBytes.length + data.length);
    crcBuf.set(typeBytes, 0); crcBuf.set(data, typeBytes.length);
    const crc = u32be(crc32(crcBuf));
    const out = new Uint8Array(12 + data.length);
    out.set(len, 0); out.set(typeBytes, 4); out.set(data, 8); out.set(crc, 8 + data.length);
    return out;
  }

  async function encodePng({ width, height, rgba, indices, palette, mode, phys }) {
    if (!width || !height) throw new Error('PNG 尺寸无效');
    const channels = mode === 'rgba' ? 4 : mode === 'palette' ? 1 : 3;
    const raw = new Uint8Array(height * (1 + width * channels));
    let p = 0;
    for (let y = 0; y < height; y++) {
      raw[p++] = 0; // filter: None
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (mode === 'palette') {
          raw[p++] = indices[i / 4];
        } else if (mode === 'rgba') {
          raw[p++] = rgba[i]; raw[p++] = rgba[i + 1]; raw[p++] = rgba[i + 2]; raw[p++] = rgba[i + 3];
        } else { // rgb：alpha 与白色混合
          const a = rgba[i + 3] / 255;
          raw[p++] = Math.round(rgba[i] * a + 255 * (1 - a));
          raw[p++] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
          raw[p++] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
        }
      }
    }
    const idat = await zlibDeflate(raw);
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width); dv.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = mode === 'rgba' ? 6 : mode === 'palette' ? 3 : 2;
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const chunks = [pngChunk('IHDR', ihdr)];
    // 物理像素精度（DPI → 像素/米，unit=1）
    if (phys && phys > 0) {
      const ppm = Math.round(phys * 100 / 2.54);
      const pdata = new Uint8Array(9);
      const pdv = new DataView(pdata.buffer);
      pdv.setUint32(0, ppm);
      pdv.setUint32(4, ppm);
      pdata[8] = 1; // 单位：米
      chunks.push(pngChunk('pHYs', pdata));
    }
    if (mode === 'palette') {
      const plte = new Uint8Array(palette.length * 3);
      const trns = new Uint8Array(palette.length);
      let hasTrns = false;
      for (let i = 0; i < palette.length; i++) {
        plte[i * 3] = palette[i][0]; plte[i * 3 + 1] = palette[i][1]; plte[i * 3 + 2] = palette[i][2];
        trns[i] = palette[i][3];
        if (palette[i][3] !== 255) hasTrns = true;
      }
      chunks.push(pngChunk('PLTE', plte));
      if (hasTrns) chunks.push(pngChunk('tRNS', trns));
    }
    chunks.push(pngChunk('IDAT', idat));
    chunks.push(pngChunk('IEND', new Uint8Array(0)));
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const total = sig.length + chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    out.set(sig, 0);
    let o = sig.length;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // ---------- 比例归一裁剪 ----------
  // 过宽：居中裁左右；过高：裁上下，上方 30% / 下方 70%（3:7）
  function computeCrop(srcW, srcH, ratio) {
    const [aW, aH] = ratio;
    let w = srcW, h = srcH, x = 0, y = 0;
    const srcRatio = srcW / srcH;
    const targetRatio = aW / aH;
    if (srcRatio > targetRatio) {
      w = Math.round(srcH * targetRatio);
      x = Math.round((srcW - w) / 2);
    } else if (srcRatio < targetRatio) {
      h = Math.round(srcW / targetRatio);
      y = Math.round((srcH - h) * 0.3);
    }
    return { x, y, w, h };
  }

  // ---------- 中位切分量化 ----------
  function boxScore(pix, rgba) {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const i of pix) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (b < bmin) bmin = b; if (b > bmax) bmax = b;
    }
    return (rmax - rmin) + (gmax - gmin) + (bmax - bmin);
  }

  function dominantChannel(pix, rgba) {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const i of pix) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (g < gmin) gmin = g; if (g > gmax) gmax = g;
      if (b < bmin) bmin = b; if (b > bmax) bmax = b;
    }
    const r = rmax - rmin, g = gmax - gmin, b = bmax - bmin;
    return r >= g && r >= b ? 0 : g >= b ? 1 : 2;
  }

  function quantize(rgba, maxColors) {
    const n = rgba.length / 4;
    const transparent = [];
    const opaque = [];
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] < 128) transparent.push(i);
      else opaque.push(i);
    }
    const hasAlpha = transparent.length > 0;
    const usable = hasAlpha ? Math.max(1, maxColors - 1) : maxColors;
    const boxes = opaque.length ? [{ pix: opaque }] : [];
    while (boxes.length < usable) {
      let bestIdx = -1, bestScore = 0;
      for (let b = 0; b < boxes.length; b++) {
        if (boxes[b].pix.length < 2) continue;
        const s = boxScore(boxes[b].pix, rgba);
        if (s > bestScore) { bestScore = s; bestIdx = b; }
      }
      if (bestIdx === -1) break; // 无可再分（色差为 0）
      const box = boxes[bestIdx];
      const chan = dominantChannel(box.pix, rgba);
      box.pix.sort((a, b) => rgba[a * 4 + chan] - rgba[b * 4 + chan]);
      const mid = Math.floor(box.pix.length / 2);
      boxes[bestIdx] = { pix: box.pix.slice(0, mid) };
      boxes.push({ pix: box.pix.slice(mid) });
    }
    const palette = [];
    const indices = new Uint8Array(n);
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      let r = 0, g = 0, bl = 0;
      for (const i of box.pix) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; bl += rgba[i * 4 + 2]; }
      const k = Math.max(1, box.pix.length);
      palette.push([Math.round(r / k), Math.round(g / k), Math.round(bl / k), 255]);
      for (const i of box.pix) indices[i] = b;
    }
    if (hasAlpha) {
      const tIdx = palette.length;
      palette.push([0, 0, 0, 0]);
      for (const i of transparent) indices[i] = tIdx;
    }
    return { palette, indices };
  }

  // ---------- 反锐化掩模（两遍盒式模糊近似高斯 + 增强）----------
  function unsharpMask(rgba, w, h, radius = 1, amount = 0.6) {
    const n = w * h;
    const tmp = new Float32Array(n * 3);
    const blur = new Float32Array(n * 3);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
          for (let c = 0; c < 3; c++) {
            const s = rgba[(y * w + x0) * 4 + c] + rgba[i * 4 + c] + rgba[(y * w + x1) * 4 + c];
            tmp[i * 3 + c] = s / 3;
          }
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
          for (let c = 0; c < 3; c++) {
            const s = tmp[(y0 * w + x) * 3 + c] + tmp[i * 3 + c] + tmp[(y1 * w + x) * 3 + c];
            blur[i * 3 + c] = s / 3;
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const v = rgba[i * 4 + c] + amount * (rgba[i * 4 + c] - blur[i * 3 + c]);
        rgba[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
    }
    return rgba;
  }

  // ---------- 自动对比度（亮度直方图百分位拉伸）----------
  function autoContrast(rgba, w, h, lowPct = 0.02, highPct = 0.98) {
    const n = w * h;
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      hist[((r * 299 + g * 587 + b * 114) / 1000) | 0]++;
    }
    const total = n;
    let lo = 0, acc = 0;
    const lowTarget = total * lowPct;
    for (; lo < 256; lo++) { acc += hist[lo]; if (acc >= lowTarget) break; }
    let hi = 255; acc = 0;
    const highTarget = total * (1 - highPct);
    for (; hi > 0; hi--) { acc += hist[hi]; if (acc >= highTarget) break; }
    if (hi - lo < 16) return rgba;
    const scale = 255 / (hi - lo);
    for (let i = 0; i < n * 4; i += 4) {
      rgba[i] = Math.max(0, Math.min(255, Math.round((rgba[i] - lo) * scale)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round((rgba[i + 1] - lo) * scale)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round((rgba[i + 2] - lo) * scale)));
    }
    return rgba;
  }

  // ---------- ZIP 解析（与 buildZip 对称；原生 DecompressionStream 解压）----------
  async function parseZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 1) 从尾部找 EOCD（签名 0x06054b50）
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
    const count = dv.getUint16(eocd + 10, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    // 2) 中央目录
    const entries = [];
    let off = cdOff;
    for (let e = 0; e < count; e++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
      const flags = dv.getUint16(off + 8, true);
      if (flags & 0x0001) throw new Error('压缩包含密码保护，暂不支持（请先解压去除密码后再上传）');
      const method = dv.getUint16(off + 10, true);
      const crc = dv.getUint32(off + 16, true);
      const csize = dv.getUint32(off + 20, true);
      const usize = dv.getUint32(off + 24, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
      // 3) 本地头定位数据
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = bytes.subarray(dataStart, dataStart + csize);
      // 4) 解压（method 8 deflate / 0 store）
      let raw;
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(comp);
        writer.close();
        const reader = ds.readable.getReader();
        const parts = [];
        for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); }
        const total = parts.reduce((n, p) => n + p.length, 0);
        raw = new Uint8Array(total);
        let o = 0;
        for (const p of parts) { raw.set(p, o); o += p.length; }
      } else if (method === 0) {
        raw = comp;
      } else {
        throw new Error('不支持的压缩方式: ' + method);
      }
      if (raw.length !== usize) throw new Error('ZIP 解压大小不符: ' + name);
      if (crc32(raw) !== crc) throw new Error('ZIP CRC 校验失败: ' + name);
      entries.push({ name, data: raw });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  // ---------- JPEG 像素密度写入（JFIF APP0，units=1 dots/inch）----------
  // 已含 JFIF APP0 则改写 density；否则在 SOI 后插入标准 APP0 段。
  // 不改变像素数据 → 文件大小不变。
  function setJpegDensity(jpeg, dpi) {
    if (jpeg.length < 4 || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) return jpeg;
    // 扫描 SOI 之后的段，找 JFIF APP0
    let off = 2;
    let found = -1;
    while (off + 4 <= jpeg.length && jpeg[off] === 0xFF) {
      const m = jpeg[off + 1];
      if (m === 0xE0) {
        const len = (jpeg[off + 2] << 8) | jpeg[off + 3];
        if (len >= 14 && jpeg[off + 4] === 0x4A) { found = off; break; } // "JF..."
        off += 2 + len;
      } else if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7)) {
        off += 2;
      } else {
        const len = (jpeg[off + 2] << 8) | jpeg[off + 3];
        if (len < 2) break;
        off += 2 + len;
      }
    }
    const copy = jpeg.slice();
    if (found >= 0) {
      const base = found + 4; // "JFIF\0" 起点
      copy[base + 7] = 1; // units = dots/inch
      copy[base + 8] = dpi >> 8; copy[base + 9] = dpi & 0xFF;
      copy[base + 10] = dpi >> 8; copy[base + 11] = dpi & 0xFF;
      return copy;
    }
    // 插入 APP0（len=16）
    const app0 = new Uint8Array([
      0xFF, 0xE0, 0x00, 0x10,
      0x4A, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
      0x01, 0x02, 0x01,             // version 1.2, units=DPI
      dpi >> 8, dpi & 0xFF,
      dpi >> 8, dpi & 0xFF,
      0x00, 0x00,                   // 无缩略图
    ]);
    const out = new Uint8Array(jpeg.length + app0.length);
    out.set(jpeg.subarray(0, 2), 0);
    out.set(app0, 2);
    out.set(jpeg.subarray(2), 2 + app0.length);
    return out;
  }

  // ---------- ZIP 生成器（local header + raw deflate + central dir + EOCD）----------
  async function buildZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const e of entries) {
      const nameBytes = encoder.encode(e.name);
      const compressed = await rawDeflate(e.data);
      const useStore = compressed.length >= e.data.length;
      const dataBytes = useStore ? e.data : compressed;
      const method = useStore ? 0 : 8;
      const crc = crc32(e.data);
      const size = e.data.length, csize = dataBytes.length;
      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8 文件名
      dv.setUint16(8, method, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, csize, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      const body = new Uint8Array(30 + nameBytes.length + dataBytes.length);
      body.set(lh, 0); body.set(dataBytes, 30 + nameBytes.length);
      localParts.push(body);
      const ch = new Uint8Array(46 + nameBytes.length);
      const dv2 = new DataView(ch.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true);
      dv2.setUint16(10, method, true);
      dv2.setUint16(12, 0, true);
      dv2.setUint16(14, 0, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, csize, true);
      dv2.setUint32(24, size, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint16(30, 0, true);
      dv2.setUint16(32, 0, true);
      dv2.setUint16(34, 0, true);
      dv2.setUint16(36, 0, true);
      dv2.setUint32(38, 0, true);
      dv2.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      centralParts.push(ch);
      offset += body.length;
    }
    const centralSize = centralParts.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const dv3 = new DataView(eocd.buffer);
    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(4, 0, true);
    dv3.setUint16(6, 0, true);
    dv3.setUint16(8, entries.length, true);
    dv3.setUint16(10, entries.length, true);
    dv3.setUint32(12, centralSize, true);
    dv3.setUint32(16, offset, true);
    dv3.setUint16(20, 0, true);
    const total = offset + centralSize + 22;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of localParts) { out.set(p, o); o += p.length; }
    for (const p of centralParts) { out.set(p, o); o += p.length; }
    out.set(eocd, o);
    return out;
  }

  return { crc32, encodePng, quantize, unsharpMask, autoContrast, buildZip, parseZip, computeCrop, setJpegDensity, zlibDeflate, rawDeflate };
});
