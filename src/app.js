'use strict';
/* 浏览器端：UI 与处理管线。依赖 window.PI（logic.js） */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);

  const state = {
    items: [],
    settings: { targetKB: 50, maxEdge: 240, aspect: '1:1', customAspect: '5:4', format: 'auto', enhance: true, tolerance: 2 },
    converting: false,
    cancel: false,
    nextId: 1,
  };
  const SETTINGS_KEY = 'pi-settings-v1';
  const IMAGE_RE = /\.(jpe?g|png|webp|bmp|gif|avif|svg)$/i;
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

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
  function aspectRatio() {
    const s = state.settings;
    if (s.aspect === 'custom') {
      const m = /^(\d+)\s*:\s*(\d+)$/.exec(s.customAspect);
      if (!m) return [1, 1];
      return [parseInt(m[1], 10), parseInt(m[2], 10)];
    }
    const [w, h] = s.aspect.split(':').map(Number);
    return [w || 1, h || 1];
  }
  function currentSettings() {
    const s = state.settings;
    return {
      targetBytes: Math.max(1, Math.round(s.targetKB * 1024)),
      maxEdge: Math.max(32, Math.min(2048, Math.round(s.maxEdge))),
      aspect: aspectRatio(),
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
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'icon-btn';
    dl.textContent = '下载';
    dl.disabled = item.status !== 'done';
    dl.addEventListener('click', () => downloadBlob(item.resultBlob, item.outName));
    rowActions.appendChild(dl);

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
    $('#btnConvert').disabled = state.converting || !has;
    $('#btnCancel').disabled = !state.converting;
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

  // ---------- 设置 UI ----------
  function renderSettings() {
    const s = state.settings;
    $('#targetKB').value = s.targetKB;
    $('#maxEdge').value = s.maxEdge;
    $('#aspectSelect').value = s.aspect;
    $('#customAspect').value = s.customAspect;
    $('#customAspectWrap').hidden = s.aspect !== 'custom';
    $('#formatSelect').value = s.format;
    $('#tolerance').value = s.tolerance;
    $('#enhanceToggle').checked = s.enhance;
  }
  function bindSettings() {
    const set = (key, val) => { state.settings[key] = val; saveSettings(); };
    $('#targetKB').addEventListener('change', (e) => set('targetKB', clampNum(e.target.value, 5, 5120, 50)));
    $('#maxEdge').addEventListener('change', (e) => set('maxEdge', clampNum(e.target.value, 32, 2048, 240)));
    $('#aspectSelect').addEventListener('change', (e) => {
      set('aspect', e.target.value);
      $('#customAspectWrap').hidden = e.target.value !== 'custom';
    });
    $('#customAspect').addEventListener('change', (e) => set('customAspect', e.target.value.trim()));
    $('#formatSelect').addEventListener('change', (e) => set('format', e.target.value));
    $('#tolerance').addEventListener('change', (e) => set('tolerance', clampNum(e.target.value, 1, 10, 2)));
    $('#enhanceToggle').addEventListener('change', (e) => set('enhance', e.target.checked));
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
  function computeCrop(srcW, srcH, [aW, aH]) {
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

  function outputDims(maxEdge, [aW, aH]) {
    if (aW >= aH) return { w: maxEdge, h: Math.round(maxEdge * aH / aW) };
    return { w: Math.round(maxEdge * aW / aH), h: maxEdge };
  }

  function drawCanvas(src, sx, sy, sw, sh, dw, dh) {
    const canvas = document.createElement('canvas');
    canvas.width = dw; canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
    return canvas;
  }

  function scaleCanvasByEdge(canvas, edge) {
    const w = canvas.width, h = canvas.height;
    let dw, dh;
    if (w >= h) { dw = edge; dh = Math.max(1, Math.round(edge * h / w)); }
    else { dh = edge; dw = Math.max(1, Math.round(edge * w / h)); }
    if (dw === w && dh === h) return canvas;
    return drawCanvas(canvas, 0, 0, w, h, dw, dh);
  }

  function enhanceCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height);
    PI.unsharpMask(img.data, width, height, 1, 0.6);
    PI.autoContrast(img.data, width, height, 0.02, 0.98);
    ctx.putImageData(img, 0, 0);
  }

  // ---------- 编码到目标大小 ----------
  function toBlobJpeg(canvas, q) {
    return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', q / 100));
  }

  // JPEG：质量二分命中 [target*(1-tol), target*(1+tol)]；q=30 仍大则降分辨率（-12%/轮，下限 64）
  async function jpegToTarget(canvas, targetBytes, tolerance, maxEdge) {
    let cur = canvas;
    let edge = maxEdge;
    let best = null;
    let bestDiff = Infinity;
    for (;;) {
      let lo = 30, hi = 95;
      for (let i = 0; i < 10; i++) {
        const q = Math.round((lo + hi) / 2);
        const blob = await toBlobJpeg(cur, q);
        const diff = Math.abs(blob.size - targetBytes);
        if (diff < bestDiff) { bestDiff = diff; best = { blob, q, edge }; }
        const low = targetBytes * (1 - tolerance);
        const high = targetBytes * (1 + tolerance);
        if (blob.size < low) lo = q + 1;
        else if (blob.size > high) hi = q - 1;
        else return { blob, q, edge };
      }
      if (edge <= 64) break;
      edge = Math.round(edge * 0.88);
      cur = scaleCanvasByEdge(canvas, edge);
    }
    return best;
  }

  // PNG：直通 RGB/RGBA → 调色板量化（256→128→64→32→16→8→4）→ 降分辨率；无损，≤ target*(1+tol)
  async function pngToTarget(canvas, targetBytes, tolerance, maxEdge) {
    const limit = targetBytes * (1 + tolerance);
    const colorSteps = [256, 128, 64, 32, 16, 8, 4];
    const getData = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    let data = getData(canvas);
    let hasAlpha = false;
    for (let i = 3; i < data.data.length; i += 4) {
      if (data.data[i] !== 255) { hasAlpha = true; break; }
    }
    const direct = await PI.encodePng({ width: data.width, height: data.height, rgba: data.data, mode: hasAlpha ? 'rgba' : 'rgb' });
    if (direct.length <= limit) return new Blob([direct], { type: 'image/png' });
    let lastBytes = direct;
    for (const colors of colorSteps) {
      const q = PI.quantize(data.data, colors);
      lastBytes = await PI.encodePng({ width: data.width, height: data.height, indices: q.indices, palette: q.palette, mode: 'palette' });
      if (lastBytes.length <= limit) return new Blob([lastBytes], { type: 'image/png' });
    }
    let edge = Math.min(data.width, data.height, maxEdge);
    while (edge > 48) {
      edge = Math.round(edge * 0.8);
      const scaled = scaleCanvasByEdge(canvas, edge);
      data = getData(scaled);
      for (const colors of colorSteps) {
        const q = PI.quantize(data.data, colors);
        lastBytes = await PI.encodePng({ width: data.width, height: data.height, indices: q.indices, palette: q.palette, mode: 'palette' });
        if (lastBytes.length <= limit) return new Blob([lastBytes], { type: 'image/png' });
      }
    }
    return new Blob([lastBytes], { type: 'image/png' });
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
    const crop = computeCrop(sw, sh, s.aspect);
    const out = outputDims(s.maxEdge, s.aspect);
    let canvas = drawCanvas(src, crop.x, crop.y, crop.w, crop.h, out.w, out.h);
    const needEnhance = s.enhance && Math.max(crop.w, crop.h) < s.maxEdge;
    if (needEnhance) enhanceCanvas(canvas);
    const ext = extFor(s, item.name);
    if (ext === 'png') {
      item.resultBlob = await pngToTarget(canvas, s.targetBytes, s.tolerance, s.maxEdge);
    } else {
      const r = await jpegToTarget(canvas, s.targetBytes, s.tolerance, s.maxEdge);
      item.resultBlob = r.blob;
      if (r.edge < s.maxEdge) item.note = '分辨率降至 ' + r.edge + 'px 以达目标';
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

  // ---------- 动作绑定 ----------
  function bindActions() {
    $('#btnConvert').addEventListener('click', () => convertAll());
    $('#btnCancel').addEventListener('click', () => { state.cancel = true; });
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
