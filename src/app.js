'use strict';
/* 浏览器端：UI 与处理管线。依赖 window.PI（logic.js） */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  const state = {
    items: [],
    settings: { targetKB: 50, sizeW: 1.5, sizeH: 1.5, format: 'auto', enhance: true, tolerance: 2 },
    converting: false,
    cancel: false,
    nextId: 1,
  };
  const SETTINGS_KEY = 'pi-settings-v1';
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
  // 演算上限：随目标大小增长但不过度（30KB–2MB 目标 → 上限 2×基准 ~ 1493px，硬顶 2048px）
  function calcUpper(base, targetKB) {
    return Math.min(2048, Math.max(base * 2, Math.round(base * Math.sqrt(targetKB / 50))));
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

    li.append(thumb, info, result, status, rowActions);
    return li;
  }

  function updateRow(item) {
    const old = $('#fileList').querySelector('li[data-id="' + item.id + '"]');
    if (old) old.replaceWith(renderRow(item));
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
    $('#targetKB').addEventListener('change', (e) => { set('targetKB', clampNum(e.target.value, 30, 2048, 50)); updatePxHint(); });
    $('#sizeW').addEventListener('change', (e) => { set('sizeW', clampNum(e.target.value, 0.2, 50, 1.5)); updatePxHint(); });
    $('#sizeH').addEventListener('change', (e) => { set('sizeH', clampNum(e.target.value, 0.2, 50, 1.5)); updatePxHint(); });
    $('#formatSelect').addEventListener('change', (e) => set('format', e.target.value));
    $('#tolerance').addEventListener('change', (e) => set('tolerance', clampNum(e.target.value, 1, 10, 2)));
    $('#enhanceToggle').addEventListener('change', (e) => set('enhance', e.target.checked));
  }
  function updatePxHint() {
    const s = state.settings;
    const kb = clampNum(s.targetKB, 5, 5120, 50);
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
  async function loadBitmap(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        return img;
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

  // JPEG（DPI 演算）：物理尺寸固定，像素精度由目标大小实时演算——逐图独立。
  //   · 当前像素下 q95 < 目标下限 → 提高像素精度（边长 ×1.2，上限由目标大小决定，不过度），
  //     放大后轻度锐化；直至最高质量可达目标
  //   · q95 ≥ 下限 → 二分 [60,95] 找 ≤ 上限的最大质量
  //   · 质量下限 60：宁可降低像素精度也不低于此画质
  //   · 硬约束：结果 ≤ 目标×(1+容差)；内容过简时返回最大可达并提示
  async function jpegToTarget(canvas, targetBytes, tolerance, targetKB) {
    const low = targetBytes * (1 - tolerance);
    const high = targetBytes * (1 + tolerance);
    const base = Math.max(canvas.width, canvas.height);
    const upper = calcUpper(base, targetKB);
    let edge = base;
    let cur = canvas;
    let best = null;
    let bestDiff = Infinity;
    const track = (blob, q) => {
      const diff = Math.abs(blob.size - targetBytes);
      if (diff < bestDiff) { bestDiff = diff; best = { blob, q, edge }; }
    };
    const upscale = () => {
      edge = Math.round(edge * 1.2);
      cur = scaleCanvasByEdge(canvas, edge);
      lightSharpen(cur, 0.35); // 提高像素精度（插值放大）后锐化，避免虚化
    };
    for (;;) {
      // 1) 触顶：当前像素精度下最高质量仍低于目标下限 → 提高像素精度（DPI 上调）
      const q95 = await toBlobJpeg(cur, 95);
      track(q95, 95);
      if (q95.size < low) {
        if (edge >= upper) return best; // 已达上限：内容不足以达标，返回最大可达
        upscale();
        continue;
      }
      // 2) 二分 [60,95] 找 ≤ 上限的最大质量
      let lo = 60, hi = 95;
      let found = null;
      for (let i = 0; i < 12; i++) {
        const q = Math.round((lo + hi) / 2);
        const blob = await toBlobJpeg(cur, q);
        track(blob, q);
        if (blob.size <= high) { found = { blob, q }; lo = q + 1; }
        else hi = q - 1;
      }
      if (found) {
        if (found.blob.size >= low) return { blob: found.blob, q: found.q, edge }; // 命中目标窗口
        // 质量档粒度跳过窗口 → 提高像素精度细化档位
        if (edge >= upper) return { blob: found.blob, q: found.q, edge };
        upscale();
        continue;
      }
      // 3) q60 超限 → 降低像素精度（画质下限保护）
      if (edge <= 48) return best;
      edge = Math.round(edge * 0.8);
      cur = scaleCanvasByEdge(canvas, edge);
    }
  }

  // PNG（无损，DPI 演算）：直通文件大小随像素单调递增 →
  //   在 [48px, 演算上限] 上二分像素，求「直通 ≤ 上限」的最大像素：
  //   · 命中 [下限, 上限] → 无损直通输出（无任何量化损失）
  //   · 上限像素直通仍低于下限 → 内容限制，返回最大可达
  // 硬约束：结果 ≤ target*(1+tol)
  async function pngToTarget(canvas, targetBytes, tolerance, physMaxCm, targetKB) {
    const low = targetBytes * (1 - tolerance);
    const limit = targetBytes * (1 + tolerance);
    const base = Math.max(canvas.width, canvas.height);
    const upper = calcUpper(base, targetKB);
    const getData = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    const encode = async (c) => {
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

  async function convertOne(item) {
    const s = currentSettings();
    const src = await loadBitmap(item.file);
    const { w: sw, h: sh } = srcDims(src);
    const crop = PI.computeCrop(sw, sh, [s.baseW, s.baseH]);
    // 起始像素随目标大小预判（√ 关系）——非固定值，演算中可继续升降
    const startW = startPx(s.baseW, s.targetKB);
    const startH = startPx(s.baseH, s.targetKB);
    let canvas = drawCanvas(src, crop.x, crop.y, crop.w, crop.h, startW, startH);
    const needEnhance = s.enhance && Math.max(crop.w, crop.h) < Math.max(startW, startH);
    if (needEnhance) enhanceCanvas(canvas);
    const ext = extFor(s, item.name);
    // 物理最长边（cm）—— 统一约束；DPI = 像素边长 / 物理边长
    const physMaxCm = Math.max(s.sizeW, s.sizeH);
    const cw = canvas.width, ch = canvas.height;
    const baseEdge = Math.max(cw, ch);
    if (ext === 'png') {
      const r = await pngToTarget(canvas, s.targetBytes, s.tolerance, physMaxCm, s.targetKB);
      item.resultBlob = r.blob;
      item.outPxW = cw >= ch ? r.edge : Math.round(r.edge * cw / ch);
      item.outPxH = cw >= ch ? Math.round(r.edge * ch / cw) : r.edge;
      item.outDpi = dpiFromPx(r.edge, physMaxCm);
      if (item.resultBlob.size < s.targetBytes * (1 - s.tolerance)) item.note = 'PNG 无损输出，内容限制已达该尺寸下最大大小';
      else if (r.edge > baseEdge) item.note = 'DPI 升至 ' + item.outDpi + '（' + item.outPxW + '×' + item.outPxH + 'px）以达目标';
    } else {
      const r = await jpegToTarget(canvas, s.targetBytes, s.tolerance, s.targetKB);
      // 演算的像素精度：物理尺寸不变，只调整像素
      const dpi = dpiFromPx(r.edge, physMaxCm);
      const cw = canvas.width, ch = canvas.height;
      const pxW = cw >= ch ? r.edge : Math.round(r.edge * cw / ch);
      const pxH = cw >= ch ? Math.round(r.edge * ch / cw) : r.edge;
      // 写入演算出的 DPI 元数据（不改变文件大小）
      const arr = new Uint8Array(await r.blob.arrayBuffer());
      const withDpi = PI.setJpegDensity(arr, dpi);
      item.resultBlob = new Blob([withDpi], { type: 'image/jpeg' });
      item.outPxW = pxW;
      item.outPxH = pxH;
      item.outDpi = dpi;
      if (r.edge > baseEdge) item.note = 'DPI 升至 ' + dpi + '（' + pxW + '×' + pxH + 'px）以达目标';
      else if (r.edge < baseEdge) item.note = 'DPI 降至 ' + dpi + ' 以保画质';
      else if (r.blob.size < s.targetBytes * (1 - s.tolerance)) item.note = '内容简单或尺寸不足，已达该尺寸下最大大小';
    }
    item.resultSize = item.resultBlob.size;
    item.outName = item.name.replace(/\.[^.]+$/, '') + '.' + ext;
    item.status = 'done';
  }

  function friendlyError(err) {
    const m = String(err && err.message || err);
    if (/decode|load|image/i.test(m)) return '无法解码（HEIC 等格式请先转换为 JPEG/PNG）';
    return m.slice(0, 120);
  }

  async function convertAll() {
    if (state.converting) return;
    state.converting = true;
    state.cancel = false;
    const pending = state.items.filter((i) => i.status === 'waiting' || i.status === 'error');
    for (const item of pending) {
      if (state.cancel) break;
      item.status = 'processing';
      item.error = '';
      item.note = '';
      updateRow(item);
      await yieldUI();
      try {
        await convertOne(item);
      } catch (err) {
        item.status = 'error';
        item.error = friendlyError(err);
      }
      updateRow(item);
      updateStats();
      updateButtons();
    }
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
