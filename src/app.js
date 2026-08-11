'use strict';
/* 浏览器端：UI 与处理管线。依赖 window.PI（logic.js） */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  const state = {
    items: [],
    settings: { targetKB: 100, sizeW: 1.2, sizeH: 1.8, format: 'png', enhance: true, tolerance: 2, qualityMode: 'high' },
    converting: false,
    cancel: false,
    nextId: 1,
  };
  const SETTINGS_KEY = 'pi-settings-v2'; // v2：默认输出尺寸改为 1.2×1.8cm，旧缓存(v1)失效
  const IMAGE_RE = /\.(jpe?g|png|webp|bmp|gif|avif|svg)$/i;
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));
  const BASE_DPI = 400; // 像素精度的演算起点（1.5cm → 236px）

  // ---------- 设置 ----------
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (s) Object.assign(state.settings, s);
    } catch (e) { /* 忽略 */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* 忽略 */ }
  }
  // 物理尺寸(cm) × 基准 DPI → 起始像素
  function cmToPx(cm, dpi) {
    return Math.max(8, Math.round((cm / 2.54) * dpi));
  }
  // 起始像素随目标大小预判（像素 ∝ √目标大小）：目标大 → 起点高，减少演算爬升；非固定值
  function startPx(basePx, targetKB) {
    return Math.max(48, Math.round(basePx * Math.sqrt(targetKB / 50)));
  }
  // 像素边长 + 物理最长边(cm) → 演算出的像素精度（DPI）
  function dpiFromPx(px, cm) {
    return Math.round(px / (cm / 2.54));
  }
  // 演算上限：目标驱动（×2×√(目标/50)），保证低熵内容也能通过放大贴近目标大小；
  // 硬顶 2048px 防过度（30KB→×2，100KB→×2.8，256KB→×4.5，2MB→2048 封顶）
  function calcUpper(base, targetKB) {
    return Math.min(2048, Math.round(base * 2 * Math.max(1, Math.sqrt(targetKB / 50))));
  }
  function currentSettings() {
    const s = state.settings;
    return {
      targetKB: s.targetKB,
      targetBytes: Math.max(1, Math.round(s.targetKB * 1024)),
      baseW: cmToPx(s.sizeW, BASE_DPI), // 基准像素（仅定比例与演算起点）
      baseH: cmToPx(s.sizeH, BASE_DPI),
      sizeW: s.sizeW, // 物理尺寸（统一约束）
      sizeH: s.sizeH,
      format: s.format,
      enhance: !!s.enhance,
      tolerance: Math.max(0.5, Math.min(15, s.tolerance)) / 100,
      minQ: s.qualityMode === 'res' ? 45 : 85, // 高质量 q85 / 高分辨率实验 q45
    };
  }

  // ---------- 导入 ----------
  function isImageFile(f) { return IMAGE_RE.test(f.name); }

  function pushItem(file, relPath) {
    const name = relPath.split('/').pop();
    state.items.push({
      id: state.nextId++,
      file, relPath, name,
      origSize: file.size,
      status: 'waiting', error: '', note: '',
      resultBlob: null, resultSize: 0, outName: '',
      thumbUrl: '',
    });
  }

  function addFiles(files, baseRel = '') {
    for (const f of files) {
      if (!isImageFile(f)) continue;
      pushItem(f, baseRel ? baseRel + f.name : f.name);
    }
    refresh();
  }

  function readAllEntries(dir) {
    return new Promise((resolve) => {
      const reader = dir.createReader();
      const all = [];
      (function readBatch() {
        reader.readEntries((entries) => {
          if (entries.length === 0) return resolve(all);
          all.push(...entries);
          readBatch();
        }, () => resolve(all));
      })();
    });
  }

  async function addDirectoryEntries(entries, baseRel = '') {
    for (const entry of entries) {
      if (entry.isFile) {
        const f = await new Promise((res) => entry.file(res, () => res(null)));
        if (f && isImageFile(f)) pushItem(f, baseRel + f.name);
      } else if (entry.isDirectory) {
        const children = await readAllEntries(entry);
        await addDirectoryEntries(children, baseRel + entry.name + '/');
      }
    }
  }

  function bindImport() {
    $('#btnPickFiles').addEventListener('click', () => $('#fileInput').click());
    $('#btnPickFolder').addEventListener('click', () => $('#folderInput').click());
    const dz = $('#dropZone');
    // 点击拖放区等同「选择图片」（按钮点击不触发）
    dz.addEventListener('click', (e) => { if (e.target.closest('button')) return; $('#fileInput').click(); });
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
    $('#fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    // 文件夹输入：每个文件自带 webkitRelativePath（如 相册/a.jpg）
    $('#folderInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files).filter(isImageFile);
      for (const f of files) pushItem(f, f.webkitRelativePath || f.name);
      refresh();
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', async (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
      const entries = [];
      for (const it of e.dataTransfer.items) {
        if (it.webkitGetAsEntry) { const en = it.webkitGetAsEntry(); if (en) entries.push(en); }
      }
      if (entries.length) await addDirectoryEntries(entries);
      else addFiles(e.dataTransfer.files);
      refresh();
    });
  }

  // ---------- 列表渲染 ----------
  function refresh() {
    renderList();
    updateStats();
    updateButtons();
  }

  function renderList() {
    const list = $('#fileList');
    list.textContent = '';
    $('#listEmpty').hidden = state.items.length > 0;
    for (const item of state.items) list.appendChild(renderRow(item));
  }

  function renderRow(item) {
    const li = document.createElement('li');
    li.className = 'file-row';
    li.dataset.id = item.id;

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.alt = '';
    if (!item.thumbUrl) item.thumbUrl = URL.createObjectURL(item.file);
    thumb.src = item.thumbUrl;

    const info = document.createElement('div');
    info.className = 'info';
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = item.name;
    nameEl.title = item.relPath;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = fmtSize(item.origSize);
    info.append(nameEl, meta);

    const result = document.createElement('div');
    result.className = 'result';
    if (item.status === 'done') {
      result.textContent = '→ ' + fmtSize(item.resultSize);
      result.title = item.note || '';
      if (item.note) result.textContent += ' (' + item.note + ')';
    } else if (item.status === 'error') {
      result.textContent = '失败：' + item.error;
      result.style.color = 'var(--danger)';
    }

    const status = document.createElement('div');
    status.className = 'status ' + item.status;
    status.textContent = statusText(item.status);

    // 行级进度条（处理中显示，完成/失败重建行后隐藏）
    const progressWrap = document.createElement('div');
    progressWrap.className = 'row-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'row-progress-fill';
    progressWrap.appendChild(progressFill);

    const rowActions = document.createElement('div');
    rowActions.className = 'row-actions';
    const pv = document.createElement('button');
    pv.type = 'button';
    pv.className = 'icon-btn';
    pv.textContent = '预览';
    pv.disabled = item.status !== 'done';
    pv.addEventListener('click', () => openPreview(item));
    const rc = document.createElement('button');
    rc.type = 'button';
    rc.className = 'icon-btn';
    rc.textContent = '重转';
    rc.disabled = state.converting;
    rc.addEventListener('click', () => reconvertOne(item));
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'icon-btn';
    dl.textContent = '下载';
    dl.disabled = item.status !== 'done';
    dl.addEventListener('click', () => downloadBlob(item.resultBlob, item.outName));
    rowActions.append(pv, rc, dl);

    li.append(thumb, info, result, status, rowActions, progressWrap);
    return li;
  }

  function updateRow(item) {
    const old = $('#fileList').querySelector('li[data-id="' + item.id + '"]');
    if (old) old.replaceWith(renderRow(item));
  }

  // 行级进度条：仅就地更新 DOM，不重建行（保持并发各行进度互不干扰）
  function updateRowProgress(item, pct) {
    const row = $('#fileList').querySelector('li[data-id="' + item.id + '"]');
    if (!row) return;
    const fill = row.querySelector('.row-progress-fill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function statusText(s) {
    return { waiting: '等待', processing: '处理中…', done: '完成', error: '失败' }[s] || s;
  }

  function fmtSize(n) {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  function updateStats() {
    const done = state.items.filter((i) => i.status === 'done').length;
    const failed = state.items.filter((i) => i.status === 'error').length;
    $('#statsBar').textContent = `${state.items.length} 张 · 完成 ${done} · 失败 ${failed}`;
    const total = state.items.length;
    $('#progressFill').style.width = (total ? (done + failed) / total * 100 : 0) + '%';
  }

  function updateButtons() {
    const has = state.items.length > 0;
    const hasDone = state.items.some((i) => i.status === 'done');
    const hasResult = state.items.some((i) => i.status === 'done' || i.status === 'error');
    $('#btnConvert').disabled = state.converting || !has;
    $('#btnCancel').disabled = !state.converting;
    $('#btnReconvert').disabled = state.converting || !hasResult;
    $('#btnExportZip').disabled = !hasDone || state.converting;
    $('#btnClearDone').disabled = !hasDone;
    $('#btnClearAll').disabled = !has;
  }

  function removeItems(pred) {
    for (const item of state.items) if (pred(item)) revokeItem(item);
    state.items = state.items.filter((i) => !pred(i));
    refresh();
  }
  function revokeItem(item) {
    if (item.thumbUrl) { URL.revokeObjectURL(item.thumbUrl); item.thumbUrl = ''; }
    item.resultBlob = null;
  }

  // ---------- 预览 ----------
  let previewModal = null;
  function openPreview(item) {
    closePreview();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    const img = document.createElement('img');
    img.className = 'modal-img';
    if (item.resultBlob) img.src = URL.createObjectURL(item.resultBlob);
    else img.src = item.thumbUrl;
    img.alt = item.name;
    const meta = document.createElement('div');
    meta.className = 'modal-meta';
    let metaTxt = (item.outName || item.name) + ' · ' + fmtSize(item.resultSize || item.origSize);
    if (item.outDpi) metaTxt += ' · ' + item.outPxW + '×' + item.outPxH + 'px @ ' + item.outDpi + ' DPI';
    meta.textContent = metaTxt;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn';
    close.textContent = '关闭';
    close.addEventListener('click', closePreview);
    box.append(img, meta, close);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });
    document.body.appendChild(overlay);
    previewModal = overlay;
  }
  function closePreview() {
    if (previewModal) { previewModal.remove(); previewModal = null; }
  }

  // ---------- 设置 UI ----------
  function renderSettings() {
    const s = state.settings;
    $('#targetKB').value = s.targetKB;
    $('#sizeW').value = s.sizeW;
    $('#sizeH').value = s.sizeH;
    $('#formatSelect').value = s.format;
    $('#tolerance').value = s.tolerance;
    $('#enhanceToggle').checked = s.enhance;
    updatePxHint();
  }
  function bindSettings() {
    const set = (key, val) => { state.settings[key] = val; saveSettings(); };
    $('#targetKB').addEventListener('change', (e) => { set('targetKB', clampNum(e.target.value, 30, 2048, 100)); updatePxHint(); });
    $('#sizeW').addEventListener('change', (e) => { set('sizeW', clampNum(e.target.value, 0.2, 50, 1.5)); updatePxHint(); });
    $('#sizeH').addEventListener('change', (e) => { set('sizeH', clampNum(e.target.value, 0.2, 50, 1.5)); updatePxHint(); });
    $('#formatSelect').addEventListener('change', (e) => set('format', e.target.value));
    $('#tolerance').addEventListener('change', (e) => set('tolerance', clampNum(e.target.value, 1, 10, 2)));
    $('#enhanceToggle').addEventListener('change', (e) => set('enhance', e.target.checked));
  }
  function updatePxHint() {
    const s = state.settings;
    const kb = clampNum(s.targetKB, 30, 2048, 100);
    const f = Math.sqrt(kb / 50);
    const w = Math.max(48, Math.round(cmToPx(s.sizeW, BASE_DPI) * f));
    const h = Math.max(48, Math.round(cmToPx(s.sizeH, BASE_DPI) * f));
    $('#pxHint').textContent = '起始约 ' + w + ' × ' + h + ' 像素（随目标大小与内容自动演算，非固定）';
  }
  function clampNum(v, min, max, fallback) {
    const n = parseFloat(v);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // ---------- 下载 ----------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------- 解码 ----------
  // 带超时保护：HEIC 等无法解码的格式可能挂起（promise 永不 resolve），
  // 超时即判失败并继续处理后续文件，绝不让单张坏文件卡死整个批处理。
  async function loadBitmap(file, timeoutMs = 15000) {
    const withTimeout = (p, label) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('解码超时(' + label + ')')), timeoutMs)),
    ]);
    try {
      return await withTimeout(createImageBitmap(file, { imageOrientation: 'from-image' }), 'createImageBitmap');
    } catch (e) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        await withTimeout(new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }), 'Image');
        return img;
      } catch (e2) {
        throw new Error('无法解码此格式（HEIC 等请先转换为 JPEG/PNG）');
      } finally { URL.revokeObjectURL(url); }
    }
  }
  function srcDims(src) {
    const w = src.naturalWidth || src.width;
    const h = src.naturalHeight || src.height;
    return { w, h };
  }

  // 比例归一：过宽居中裁左右；过高按 3:7 裁上下（上 30% / 下 70%）
  // （逻辑在 logic.js 的 PI.computeCrop，此处仅为调用）

  function drawCanvas(src, sx, sy, sw, sh, dw, dh) {
    // 先按源分辨率裁剪（保留最大信息）
    const crop = document.createElement('canvas');
    crop.width = sw; crop.height = sh;
    const cctx = crop.getContext('2d');
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    // 分步降采样：每次最多缩小 2 倍，避免大步长采样失真（画质关键）
    if (sw / dw > 2 || sh / dh > 2) {
      let cw = sw, ch = sh, tmp = crop;
      while (cw / dw > 2 || ch / dh > 2) {
        cw = Math.max(dw, Math.round(cw / 2));
        ch = Math.max(dh, Math.round(ch / 2));
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tmp, 0, 0, cw, ch);
        tmp = c;
      }
      const out = document.createElement('canvas');
      out.width = dw; out.height = dh;
      const octx = out.getContext('2d', { willReadFrequently: true });
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(tmp, 0, 0, dw, dh);
      return out;
    }
    const canvas = document.createElement('canvas');
    canvas.width = dw; canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop, 0, 0, dw, dh);
    return canvas;
  }

  function enhanceCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height);
    PI.unsharpMask(img.data, width, height, 1, 0.4); // 温和锐化，避免噪点放大
    PI.autoContrast(img.data, width, height, 0.01, 0.99); // 保守对比度拉伸
    ctx.putImageData(img, 0, 0);
  }

  // 按最长边等比缩放 canvas（保持宽高比）
  function scaleCanvasByEdge(canvas, edge) {
    const w = canvas.width, h = canvas.height;
    let dw, dh;
    if (w >= h) { dw = edge; dh = Math.max(1, Math.round(edge * h / w)); }
    else { dh = edge; dw = Math.max(1, Math.round(edge * w / h)); }
    if (dw === w && dh === h) return canvas;
    return drawCanvas(canvas, 0, 0, w, h, dw, dh);
  }

  // 轻度锐化（提高像素精度路径专用）：插值放大后恢复边缘锐利
  function lightSharpen(canvas, amount) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    PI.unsharpMask(img.data, canvas.width, canvas.height, 1, amount);
    ctx.putImageData(img, 0, 0);
  }

  // ---------- 编码到目标大小 ----------
  function toBlobJpeg(canvas, q) {
    return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', q / 100));
  }

  // ---------- oxipng（Squoosh 同款 PNG 优化编码器，内嵌离线）----------
  // 行滤波（Paeth/Sub/Up/Average）选择 + 高级压缩 → 同等内容下文件更小 → 目标大小内可承载更高分辨率
  let oxipngModule = null;
  function initOxipng() {
    if (oxipngModule) return oxipngModule;
    oxipngModule = (async () => {
      try {
        const b64 = document.getElementById('oxipngWasm').textContent.trim();
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const module = await WebAssembly.compile(bytes);
        await window.OxipngInitSync(module);
        return { encode: window.encode };
      } catch (e) {
        return null; // 失败 → 回退自写 PNG 编码器
      }
    })();
    return oxipngModule;
  }
  async function encodePngOxipng(data, w, h) {
    const m = await initOxipng();
    if (!m) return null;
    const buf = m.encode(data, w, h, 8);
    return new Uint8Array(buf);
  }
  // oxipng 输出不含 pHYs：在 IHDR 后插入（标准 PNG chunk，带 CRC）
  function insertPngPhys(png, dpi) {
    if (png.length < 33 || png[0] !== 0x89 || png[1] !== 0x50) return png;
    const ppm = Math.round(dpi * 100 / 2.54);
    const data = new Uint8Array(9);
    const dv = new DataView(data.buffer);
    dv.setUint32(0, ppm);
    dv.setUint32(4, ppm);
    data[8] = 1; // 单位：米
    const type = [0x70, 0x48, 0x59, 0x73]; // 'pHYs'
    const crcBuf = new Uint8Array(4 + 9);
    crcBuf.set(type, 0);
    crcBuf.set(data, 4);
    const crc = PI.crc32(crcBuf);
    const chunk = new Uint8Array(12 + 9);
    new DataView(chunk.buffer).setUint32(0, 9);
    chunk.set(type, 4);
    chunk.set(data, 8);
    new DataView(chunk.buffer).setUint32(8 + 9, crc);
    const insertAt = 8 + 25; // 签名 + IHDR chunk
    const out = new Uint8Array(png.length + chunk.length);
    out.set(png.subarray(0, insertAt), 0);
    out.set(chunk, insertAt);
    out.set(png.subarray(insertAt), insertAt + chunk.length);
    return out;
  }

  // ---------- mozjpeg 高质量编码（开源 WASM，内嵌离线；质量显著优于浏览器原生/libjpeg）----------
  let mozjpegPromise = null;
  function initMozjpeg() {
    if (mozjpegPromise) return mozjpegPromise;
    mozjpegPromise = (async () => {
      try {
        const b64 = document.getElementById('mozjpegWasm').textContent.trim();
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return await window.MozjpegEnc({ wasmBinary: bytes.buffer });
      } catch (e) {
        return null; // 加载失败 → 回退浏览器原生编码
      }
    })();
    return mozjpegPromise;
  }
  async function encodeJpegMoz(data, w, h, quality) {
    const mod = await initMozjpeg();
    if (!mod) return null;
    // mozjpeg wasm 要求完整 options（缺字段即抛 Missing field）
    const opt = {
      quality, baseline: false, arithmetic: false, progressive: true,
      optimize_coding: true, smoothing: 0, color_space: 3, quant_table: 3,
      trellis_multipass: false, trellis_opt_zero: false, trellis_opt_table: false,
      trellis_loops: 1, auto_subsample: true, chroma_subsample: 2,
      separate_chroma_quality: false, chroma_quality: 75,
    };
    const buf = mod.encode(data, w, h, opt);
    return new Uint8Array(buf);
  }
  // 最终高质量编码：用 mozjpeg 在搜索到的 (分辨率, 质量) 处重编码并校验命中目标窗口
  // （mozjpeg 同参数下比浏览器原生省 10-20% 大小 → 同大小下质量高一个档次）
  async function encodeJpegMozBest(canvas, q0, targetBytes, tolerance, minQ) {
    const mod = await initMozjpeg();
    if (!mod) return null;
    const low = Math.max(targetBytes * (1 - tolerance), targetBytes - 5000);
    const high = Math.min(targetBytes * (1 + tolerance), targetBytes + 5000);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const MIN_Q = minQ; // 与搜索侧一致：mozjpeg 微调也不低于此
    let q = Math.min(95, Math.max(MIN_Q, q0 + 6)); // 预补偿 mozjpeg 的省空间优势
    let bestFit = null; // ≤ 上限的最佳结果（硬约束：绝不返回超限值）
    for (let i = 0; i < 5; i++) {
      const bytes = await encodeJpegMoz(data, canvas.width, canvas.height, q);
      if (!bytes) return null;
      if (bytes.length >= low && bytes.length <= high) return bytes; // 精确命中
      if (bytes.length <= high) bestFit = bytes; // 触顶/内容限制（合法）
      if (bytes.length < low) q = Math.min(95, q + 3);
      else q = Math.max(MIN_Q, q - 3);
    }
    return bestFit; // null → 回退原生（原生搜索结果已命中窗口）
  }

  // JPEG（源分辨率优先）：画布 = 源裁剪尺寸（绝不无故缩小源）。
  //   1) 源分辨率下 q95 ≤ 上限 → 直接输出（触顶或命中，保持源全部细节）
  //   2) 源分辨率下二分质量 [72,95] → 命中窗口即输出（小图只需降质量，保持源分辨率）
  //   3) q72 仍超限 → 二分分辨率找「q72 ≤ 上限的最大分辨率」→ 该分辨率二分质量命中
  //   有效容差 = min(百分比, 5KB/目标)：最终大小与目标误差 ≤ 5KB（硬要求）
  async function jpegToTarget(canvas, targetBytes, tolerance, targetKB, srcMaxEdge, minQ, onEnc) {
    const MAX_ABS_ERR = 5000;
    const low = Math.max(targetBytes * (1 - tolerance), targetBytes - MAX_ABS_ERR);
    const high = Math.min(targetBytes * (1 + tolerance), targetBytes + MAX_ABS_ERR);
    const MIN_Q = minQ; // 质量下限（high: q85 观感无瑕 / res: q45 高分辨率实验）
    const base = Math.max(canvas.width, canvas.height);
    const upper = Math.min(calcUpper(base, targetKB), srcMaxEdge); // 绝不插值放大超过源
    const encJpeg = (c, q) => { onEnc(); return toBlobJpeg(c, q); };
    const scaleTo = (e) => (e === base ? canvas : scaleCanvasByEdge(canvas, e));
    // 指定分辨率下二分质量：命中窗口返回 {blob,q}；q95 ≤ 上限直接返回；否则返回 ≤ 上限的最佳或 null
    const searchQuality = async (c) => {
      const q95 = await encJpeg(c, 95);
      if (q95.size <= high) return { blob: q95, q: 95 }; // 触顶或命中
      let lo = MIN_Q, hi = 95;
      let found = null;
      for (let i = 0; i < 8; i++) {
        const q = Math.round((lo + hi) / 2);
        const blob = await encJpeg(c, q);
        if (blob.size >= low && blob.size <= high) return { blob, q };
        if (blob.size <= high) { found = { blob, q }; lo = q + 1; }
        else hi = q - 1;
        if (hi < lo) break;
      }
      return found; // null → q72 超限
    };
    // 1) 源分辨率尝试（保持源全部细节）
    const r1 = await searchQuality(canvas);
    if (r1) return { blob: r1.blob, q: r1.q, edge: base };
    // 2) 二分分辨率：找「q72 ≤ 上限」的最大分辨率（q72 为画质下限，绝不低于它压）
    let lo = 48, hi = base, foundRes = 48;
    while (lo < hi) {
      const mid = Math.round((lo + hi + 1) / 2);
      const c = scaleTo(mid);
      const b = await encJpeg(c, MIN_Q);
      if (b.size <= high) { foundRes = mid; lo = mid; }
      else hi = mid - 1;
    }
    // 3) 在该分辨率二分质量命中
    const r2 = await searchQuality(scaleTo(foundRes));
    if (r2) return { blob: r2.blob, q: r2.q, edge: foundRes };
    const fb = await encJpeg(scaleTo(foundRes), MIN_Q);
    return { blob: fb, q: MIN_Q, edge: foundRes }; // 兜底
  }

  // PNG（无损，DPI 演算）：直通文件大小随像素单调递增 →
  //   在 [48px, 演算上限] 上二分像素，求「直通 ≤ 上限」的最大像素：
  //   · 命中 [下限, 上限] → 无损直通输出（无任何量化损失）
  //   · 上限像素直通仍低于下限 → 内容限制，返回最大可达
  // 硬约束：结果 ≤ target*(1+tol)
  async function pngToTarget(canvas, targetBytes, tolerance, physMaxCm, targetKB, srcMaxEdge, onEnc) {
    // 有效容差 = min(用户百分比, 5KB/目标)：保证最终大小与目标误差 ≤ 5KB（用户硬要求）
    const MAX_ABS_ERR = 5000;
    const low = Math.max(targetBytes * (1 - tolerance), targetBytes - MAX_ABS_ERR);
    const limit = Math.min(targetBytes * (1 + tolerance), targetBytes + MAX_ABS_ERR);
    const base = Math.max(canvas.width, canvas.height);
    const upper = Math.min(calcUpper(base, targetKB), srcMaxEdge); // 绝不插值放大超过源图分辨率
    const getData = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    const encode = async (c) => {
      if (onEnc) onEnc();
      const data = getData(c);
      let hasAlpha = false;
      for (let i = 3; i < data.data.length; i += 4) {
        if (data.data[i] !== 255) { hasAlpha = true; break; }
      }
      const phys = dpiFromPx(Math.max(c.width, c.height), physMaxCm);
      const bytes = await PI.encodePng({
        width: data.width, height: data.height,
        rgba: data.data, mode: hasAlpha ? 'rgba' : 'rgb', phys,
      });
      return { bytes, phys };
    };
    // 边界：演算上限像素下直通仍低于下限 → 内容限制
    const up = await encode(scaleCanvasByEdge(canvas, upper));
    if (up.bytes.length < low) {
      return { blob: new Blob([up.bytes], { type: 'image/png' }), edge: upper };
    }
    // 二分像素 [48, upper]：直通 ≤ 上限的最大像素
    let lo = 48, hi = upper;
    while (lo < hi) {
      const mid = Math.round((lo + hi + 1) / 2);
      const r = await encode(scaleCanvasByEdge(canvas, mid));
      if (r.bytes.length <= limit) lo = mid;
      else hi = mid - 1;
    }
    const fin = await encode(scaleCanvasByEdge(canvas, lo));
    if (fin.bytes.length >= low) {
      return { blob: new Blob([fin.bytes], { type: 'image/png' }), edge: lo };
    }
    // 直通曲线在目标窗口处跳跃（内容不足以恰在窗口内）→ 输出 ≤ 上限的最接近值
    return { blob: new Blob([fin.bytes], { type: 'image/png' }), edge: lo };
  }

  // ---------- 转换主流程 ----------
  function extFor(settings, srcName) {
    if (settings.format === 'png') return 'png';
    if (settings.format === 'jpg') return 'jpg';
    if (settings.format === 'jpeg') return 'jpeg';
    return /\.png$/i.test(srcName) ? 'png' : 'jpg'; // auto：png 保留，其余转 jpg
  }

  // 单张转换（带行级进度回调）：解码 5→20% → 缩放 30% → 增强 40% → 编码 40→95% → 100%
  async function convertOne(item, onProgress) {
    const s = currentSettings();
    const progress = (p) => { if (onProgress) onProgress(p); };
    progress(5);
    const src = await loadBitmap(item.file);
    progress(20);
    const { w: sw, h: sh } = srcDims(src);
    const crop = PI.computeCrop(sw, sh, [s.baseW, s.baseH]);
    // 画布 = 源裁剪尺寸：绝不无故缩小源（缩小 = 丢细节）；分辨率取舍交给编码器
    let canvas = drawCanvas(src, crop.x, crop.y, crop.w, crop.h, crop.w, crop.h);
    progress(30);
    // 低清上采样增强：仅在源显著小于目标尺寸时（用户勾选增强时）
    const needEnhance = s.enhance && Math.max(crop.w, crop.h) < Math.max(s.baseW, s.baseH) * 0.8;
    if (needEnhance) enhanceCanvas(canvas);
    progress(40);
    const ext = extFor(s, item.name);
    // 物理最长边（cm）—— 统一约束；DPI = 像素边长 / 物理边长
    const physMaxCm = Math.max(s.sizeW, s.sizeH);
    const cw = canvas.width, ch = canvas.height;
    const baseEdge = Math.max(cw, ch);
    // 编码阶段进度：每次编码 +8%，封顶 95%
    let encCount = 0;
    const onEnc = () => { encCount++; progress(Math.min(95, 40 + encCount * 8)); };
    const srcMaxEdge = Math.max(crop.w, crop.h); // 源信息上限：绝不插值放大超过它
    if (ext === 'png') {
      const r = await pngToTarget(canvas, s.targetBytes, s.tolerance, physMaxCm, s.targetKB, srcMaxEdge, onEnc);
      // 最终编码：oxipng（行滤波 + 高级压缩，公认做法）重编码 → 同等像素更小文件
      const finalCanvas = r.edge === Math.max(cw, ch) ? canvas : scaleCanvasByEdge(canvas, r.edge);
      const oxiData = finalCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, finalCanvas.width, finalCanvas.height);
      const oxiBytes = await encodePngOxipng(oxiData.data, finalCanvas.width, finalCanvas.height);
      const high = Math.min(s.targetBytes * (1 + s.tolerance), s.targetBytes + 5000);
      const physDpi = dpiFromPx(r.edge, physMaxCm);
      if (oxiBytes && oxiBytes.length <= high && oxiBytes.length <= r.blob.size) {
        item.resultBlob = new Blob([insertPngPhys(oxiBytes, physDpi)], { type: 'image/png' });
      } else {
        item.resultBlob = r.blob; // oxipng 不可用/超限/压缩更差 → 回退自写编码（已含 pHYs）
      }
      item.outPxW = cw >= ch ? r.edge : Math.round(r.edge * cw / ch);
      item.outPxH = cw >= ch ? Math.round(r.edge * ch / cw) : r.edge;
      item.outDpi = physDpi;
      if (item.resultBlob.size < s.targetBytes * (1 - s.tolerance)) {
        item.note = '原图分辨率有限（' + item.outPxW + '×' + item.outPxH + 'px），已按源分辨率输出最大质量';
      } else if (r.edge > baseEdge) {
        item.note = 'DPI 升至 ' + item.outDpi + '（' + item.outPxW + '×' + item.outPxH + 'px）以达目标';
      }
    } else {
      const r = await jpegToTarget(canvas, s.targetBytes, s.tolerance, s.targetKB, srcMaxEdge, s.minQ, onEnc);
      // 演算的像素精度：物理尺寸不变，只调整像素
      const dpi = dpiFromPx(r.edge, physMaxCm);
      const pxW = cw >= ch ? r.edge : Math.round(r.edge * cw / ch);
      const pxH = cw >= ch ? Math.round(r.edge * ch / cw) : r.edge;
      // 高质量最终编码：mozjpeg（开源 WASM）在搜索到的分辨率/质量处重编码并校验命中
      const finalCanvas = r.edge === Math.max(cw, ch) ? canvas : scaleCanvasByEdge(canvas, r.edge);
      if (r.edge < Math.max(cw, ch)) {
        // 缩小后锐化（缩小才发生）：恢复边缘，抵消缩放软化
        const ratio = Math.max(cw, ch) / r.edge;
        lightSharpen(finalCanvas, ratio > 4 ? 0.5 : ratio > 2 ? 0.45 : 0.4);
      } else if (s.enhance) {
        // 源分辨率路径（无缩放）：重压缩补偿锐化——恢复感知锐度，抵消二次压缩软化
        lightSharpen(finalCanvas, 0.3);
      }
      let outBytes = await encodeJpegMozBest(finalCanvas, r.q, s.targetBytes, s.tolerance, s.minQ);
      if (!outBytes) outBytes = new Uint8Array(await r.blob.arrayBuffer()); // 回退原生
      // 写入演算出的 DPI 元数据（不改变文件大小）
      const withDpi = PI.setJpegDensity(outBytes, dpi);
      item.resultBlob = new Blob([withDpi], { type: 'image/jpeg' });
      item.outPxW = pxW;
      item.outPxH = pxH;
      item.outDpi = dpi;
      if (r.edge > baseEdge) item.note = 'DPI 升至 ' + dpi + '（' + pxW + '×' + pxH + 'px）以达目标';
      else if (r.edge < baseEdge) item.note = 'DPI 降至 ' + dpi + ' 以保画质';
      else if (r.blob.size < s.targetBytes * (1 - s.tolerance)) {
        item.note = '原图分辨率有限（' + pxW + '×' + pxH + 'px），已按源分辨率输出最大质量';
      }
    }
    item.resultSize = item.resultBlob.size;
    item.outName = item.name.replace(/\.[^.]+$/, '') + '.' + ext;
    item.status = 'done';
    progress(100);
  }

  function friendlyError(err) {
    const m = String(err && err.message || err);
    if (/decode|load|image/i.test(m)) return '无法解码（HEIC 等格式请先转换为 JPEG/PNG）';
    return m.slice(0, 120);
  }

  // 并行转换：并发池 2-4 路。解码(createImageBitmap)与压缩(CompressionStream)
  // 运行在浏览器内部线程，与主线程的 canvas 编码交错推进，显著缩短批量总时长。
  async function convertAll() {
    if (state.converting) return;
    state.converting = true;
    state.cancel = false;
    const pending = state.items.filter((i) => i.status === 'waiting' || i.status === 'error');
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const CONCURRENCY = Math.max(1, Math.min(4, cores - 1));
    let idx = 0;
    const processOne = async () => {
      while (idx < pending.length && !state.cancel) {
        const item = pending[idx++];
        item.status = 'processing';
        item.error = '';
        item.note = '';
        updateRow(item);
        await yieldUI();
        try {
          await convertOne(item, (p) => updateRowProgress(item, p));
        } catch (err) {
          item.status = 'error';
          item.error = friendlyError(err);
        }
        updateRow(item);
        updateStats();
        updateButtons();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => processOne()));
    state.converting = false;
    updateStats();
    updateButtons();
  }

  // ---------- 重新转换 ----------
  async function reconvertAll() {
    if (state.converting) return;
    for (const item of state.items) {
      item.status = 'waiting';
      item.error = '';
      item.note = '';
      item.resultBlob = null;
      item.resultSize = 0;
      item.outName = '';
    }
    refresh();
    await convertAll();
  }

  async function reconvertOne(item) {
    if (state.converting) return;
    item.status = 'waiting';
    item.error = '';
    item.note = '';
    item.resultBlob = null;
    item.resultSize = 0;
    item.outName = '';
    updateRow(item);
    await convertAll(); // 只处理 waiting/error 项
  }

  // ---------- 动作绑定 ----------
  function bindActions() {
    $('#btnConvert').addEventListener('click', () => convertAll());
    $('#btnCancel').addEventListener('click', () => { state.cancel = true; });
    $('#btnReconvert').addEventListener('click', () => reconvertAll());
    $('#btnClearDone').addEventListener('click', () => removeItems((i) => i.status === 'done'));
    $('#btnClearAll').addEventListener('click', () => removeItems(() => true));
    $('#btnExportZip').addEventListener('click', () => exportZip());
  }

  // ---------- 导出 ZIP ----------
  // zip-slip 防护：去除盘符、前导斜杠、. 与 .. 片段
  function sanitizeZipName(name) {
    let n = String(name).replace(/\\/g, '/');
    n = n.replace(/^[a-zA-Z]:\//, '').replace(/^\/+/, '');
    n = n.split('/').filter((seg) => seg !== '..' && seg !== '.' && seg !== '').join('/');
    return n || 'unnamed';
  }

  async function exportZip() {
    const done = state.items.filter((i) => i.status === 'done');
    if (!done.length) return;
    const entries = [];
    const used = new Set();
    for (const item of done) {
      let name = sanitizeZipName(item.relPath);
      let uniq = name;
      let k = 1;
      while (used.has(uniq)) {
        const dot = name.lastIndexOf('.');
        uniq = dot > 0 ? name.slice(0, dot) + '_' + k + name.slice(dot) : name + '_' + k;
        k++;
      }
      used.add(uniq);
      entries.push({ name: uniq, data: new Uint8Array(await item.resultBlob.arrayBuffer()) });
    }
    const zip = await PI.buildZip(entries);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([zip], { type: 'application/zip' }), 'converted_' + stamp + '.zip');
  }

  // ---------- 启动：UI 立即可交互，引擎首帧后预热 ----------
  function warmup() {
    try {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 4;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.getImageData(0, 0, 4, 4);
    } catch (e) { /* 非致命 */ }
    initMozjpeg(); // 后台加载 mozjpeg WASM（转换前就绪）
    if (typeof CompressionStream === 'undefined') {
      $('#btnExportZip').title = '当前浏览器不支持压缩流，ZIP 导出不可用';
    }
  }

  function boot() {
    loadSettings();
    renderSettings();
    bindImport();
    bindSettings();
    bindActions();
    refresh();
    requestAnimationFrame(() => setTimeout(warmup, 0));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
