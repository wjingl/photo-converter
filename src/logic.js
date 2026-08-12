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
    // median cut 切分完成 → 箱体平均色作初始格心
    let centers = boxes.map((box) => {
      let r = 0, g = 0, bl = 0;
      for (const i of box.pix) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; bl += rgba[i * 4 + 2]; }
      const k = Math.max(1, box.pix.length);
      return [Math.round(r / k), Math.round(g / k), Math.round(bl / k)];
    });
    // k-means 细化：格心收敛到簇均值——鲜艳色像素群获得自己的格心（箱体平均会冲淡它们）
    if (centers.length > 1 && opaque.length > 0) {
      const assign = new Uint16Array(n);
      for (let it = 0; it < 8; it++) {
        for (const i of opaque) {
          let best = 0, bestD = Infinity;
          for (let c = 0; c < centers.length; c++) {
            const dr = rgba[i * 4] - centers[c][0], dg = rgba[i * 4 + 1] - centers[c][1], db = rgba[i * 4 + 2] - centers[c][2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bestD) { bestD = d; best = c; }
          }
          assign[i] = best;
        }
        const sums = centers.map(() => [0, 0, 0, 0]);
        for (const i of opaque) {
          const c = assign[i];
          sums[c][0] += rgba[i * 4]; sums[c][1] += rgba[i * 4 + 1]; sums[c][2] += rgba[i * 4 + 2]; sums[c][3]++;
        }
        for (let c = 0; c < centers.length; c++) {
          if (sums[c][3] > 0) {
            centers[c] = [Math.round(sums[c][0] / sums[c][3]), Math.round(sums[c][1] / sums[c][3]), Math.round(sums[c][2] / sums[c][3])];
          }
        }
      }
    }
    // 合并近重复格心（切分出的多个 box 可能收敛到同色——浪费色数）
    if (centers.length > 1) {
      const keep = centers.map(() => true);
      for (let a = 0; a < centers.length; a++) {
        if (!keep[a]) continue;
        for (let b = a + 1; b < centers.length; b++) {
          if (!keep[b]) continue;
          const dr = centers[a][0] - centers[b][0], dg = centers[a][1] - centers[b][1], db = centers[a][2] - centers[b][2];
          if (dr * dr + dg * dg + db * db < 144) keep[b] = false; // RGB 距离 < 12
        }
      }
      centers = centers.filter((_, c) => keep[c]);
    }
    // 最终调色板 + 索引（最近格心；透明像素单独索引）
    const palette = centers.map((c) => [c[0], c[1], c[2], 255]);
    const indices = new Uint8Array(n);
    for (const i of opaque) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const dr = rgba[i * 4] - palette[c][0], dg = rgba[i * 4 + 1] - palette[c][1], db = rgba[i * 4 + 2] - palette[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      indices[i] = best;
    }
    if (hasAlpha) {
      const tIdx = palette.length;
      palette.push([0, 0, 0, 0]);
      for (const i of transparent) indices[i] = tIdx;
    }
    return { palette, indices };
  }

  // ---------- 盒式模糊内核（3×3 低通：横+纵两半遍 = 一次完整模糊）----------
  // 结果写入 Float32Array out（unsharpMask 需不减精度中间值；boxBlur 包装写回 Uint8）
  function blurInto(rgba, w, h, out) {
    const n = w * h;
    const tmp = new Float32Array(n * 3);
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
          out[i * 3 + c] = s / 3;
        }
      }
    }
    return out;
  }

  // ---------- 盒式模糊（低通滤波/去噪）----------
  // 写回 RGB、保留 alpha；passes 为完整模糊遍数（更多遍更平滑）
  function boxBlur(rgba, w, h, passes = 1) {
    const n = w * h;
    const blur = new Float32Array(n * 3);
    for (let p = 0; p < passes; p++) {
      blurInto(rgba, w, h, blur);
      for (let i = 0; i < n * 4; i += 4) {
        const k = (i / 4) * 3;
        rgba[i] = Math.round(blur[k]);
        rgba[i + 1] = Math.round(blur[k + 1]);
        rgba[i + 2] = Math.round(blur[k + 2]);
      }
    }
    return rgba;
  }

  // ---------- Bayer 有序抖动 ----------
  // 8×8 Bayer 阈值矩阵（0-63）逐像素扰动：量化前给 RGB **每通道独立**加
  // (bayer/64 - 0.5) × 255/色数 的确定性扰动。R/G/B 用三个矩阵变体（行平移/列镜像），
  // 构成三维扰动——单通道对角线扰动在颜色轨迹上的有效分量只有 ~44%，打散力不足。
  // 空间上相邻像素阈值不同 → 整片同色区域被打散成棋盘状交织（打破色带 banding）。
  // 确定性算法（无随机），输入 rgba 不被修改。
  const BAYER_R = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
  ];
  // G：行平移 4（周期 8）；B：列镜像——与 R 正交化，三维扰动
  const BAYER_G = (() => {
    const a = new Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) a[y * 8 + x] = BAYER_R[((y + 4) & 7) * 8 + x];
    return a;
  })();
  const BAYER_B = (() => {
    const a = new Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) a[y * 8 + x] = BAYER_R[y * 8 + (7 - x)];
    return a;
  })();
  function ditherIndices(rgba, palette, w, h, strengthFactor = 0.5) {
    const n = w * h;
    const strength = 255 / Math.max(2, palette.length) * strengthFactor; // 随色数缩小；×0.5 颗粒温和（色带仍有效打破）
    const indices = new Uint8Array(n);
    const nearest = (r, g, b) => {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < palette.length; k++) {
        const dr = r - palette[k][0], dg = g - palette[k][1], db = b - palette[k][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = k; }
      }
      return best;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const ty = y & 7, tx = x & 7;
        const k = strength / 64;
        const r = rgba[i * 4] + (BAYER_R[ty * 8 + tx] - 32) * k;
        const g = rgba[i * 4 + 1] + (BAYER_G[ty * 8 + tx] - 32) * k;
        const b = rgba[i * 4 + 2] + (BAYER_B[ty * 8 + tx] - 32) * k;
        indices[i] = nearest(r, g, b);
      }
    }
    return indices;
  }

  // ---------- 饱和增强 ----------
  // RGB 向亮度拉伸：l=(r+g+b)/3，c' = clamp(l + (c-l)×(1+amount))。
  // 灰度（r=g=b）与纯黑/纯白不变；彩色像素饱和度提升——补偿压缩（去噪/量化/
  // JPEG 色度下采样）造成的发灰。确定性，原地修改。
  function boostSaturation(rgba, w, h, amount) {
    const k = 1 + amount;
    for (let i = 0; i < w * h * 4; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const l = (r + g + b) / 3;
      const nr = Math.round(l + (r - l) * k);
      const ng = Math.round(l + (g - l) * k);
      const nb = Math.round(l + (b - l) * k);
      rgba[i] = nr < 0 ? 0 : nr > 255 ? 255 : nr;
      rgba[i + 1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
      rgba[i + 2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
    }
    return rgba;
  }

  // ---------- 反锐化掩模（盒式模糊近似高斯 + 增强）----------
  function unsharpMask(rgba, w, h, radius = 1, amount = 0.6) {
    const n = w * h;
    const blur = new Float32Array(n * 3);
    blurInto(rgba, w, h, blur);
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

  // ---------- 压缩包格式识别（magic bytes）----------
  function detectArchiveFormat(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B &&
        (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return 'ZIP';
    if (bytes.length >= 7 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return 'RAR';
    if (bytes.length >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7A && bytes[2] === 0xBC && bytes[3] === 0xAF) return '7z';
    if (bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B) return 'GZIP';
    if (bytes.length >= 262 && bytes[257] === 0x75 && bytes[258] === 0x73 && bytes[259] === 0x74 && bytes[260] === 0x61 && bytes[261] === 0x72) return 'TAR';
    return null;
  }

  // ---------- ZIP 解析（与 buildZip 对称；原生 DecompressionStream 解压）----------
  // 单条目上限 512MB（防压缩炸弹）；onProgress(已解析/总数) 供上传进度条
  async function parseZip(bytes, onProgress) {
    const MAX_ENTRY = 512 * 1024 * 1024;
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
      if (dv.getUint32(off + 24, true) > MAX_ENTRY) throw new Error('压缩包条目超过 512MB 上限');
      if (onProgress) onProgress(e, count);
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
      // 4) 解压（method 8 deflate / 0 store；60s 超时防挂起）
      let raw;
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(comp);
        writer.close();
        const reader = ds.readable.getReader();
        const parts = [];
        const readAll = (async () => {
          for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); }
          const total = parts.reduce((n, p) => n + p.length, 0);
          const out = new Uint8Array(total);
          let o = 0;
          for (const p of parts) { out.set(p, o); o += p.length; }
          return out;
        })();
        raw = await Promise.race([
          readAll,
          new Promise((_, rej) => setTimeout(() => rej(new Error('解压超时（60s）: ' + name)), 60000)),
        ]);
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
    if (onProgress) onProgress(count, count); // 完成回调 → 进度 100%
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

  return { crc32, encodePng, quantize, ditherIndices, boostSaturation, unsharpMask, boxBlur, autoContrast, buildZip, parseZip, detectArchiveFormat, computeCrop, setJpegDensity, zlibDeflate, rawDeflate };
});
