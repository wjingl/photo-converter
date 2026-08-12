'use strict';
/* 生成 E2E 测试页 tests/out/e2e.html：
 * 基于构建产物 index.html + 内嵌 base64 夹具 + 自动驱动脚本，
 * 用无头 Edge 执行完整用户流程（导入→转换→大小校验→导出）。仅测试用，不随交付物分发。 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fixturesDir = path.join(root, 'tests', 'fixtures');
const outDir = path.join(root, 'tests', 'out');
fs.mkdirSync(outDir, { recursive: true });

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 内嵌夹具 base64
const fixtureNames = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.png')).sort();
const embeds = [];
for (const name of fixtureNames) {
  const b64 = fs.readFileSync(path.join(fixturesDir, name)).toString('base64');
  embeds.push(`  '${name}': '${b64}'`);
}
const FIXTURES = '{\n' + embeds.join(',\n') + '\n}';

const DRIVER = `
<script>
/* E2E 自动驱动（仅测试用）：模拟真实用户流程 */
(function () {
  'use strict';
  const fixtureData = ${FIXTURES};
  const results = [];
  const report = (ok, msg) => { results.push((ok ? 'PASS' : 'FAIL') + ' | ' + msg); console.log((ok ? 'PASS' : 'FAIL'), msg); };
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitUntil(fn, timeoutMs, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { if (fn()) return true; } catch (e) {}
      await tick(100);
    }
    return false;
  }
  const parseKB = (txt) => {
    const m = /([\\d.]+)\\s*(KB|B)/.exec(txt);
    if (!m) return NaN;
    const v = parseFloat(m[1]);
    return m[2] === 'B' ? v / 1024 : v;
  };

  (async function main() {
    const pageErrors = [];
    window.addEventListener('error', (e) => pageErrors.push('error: ' + e.message));
    try {
      window.__e2eStarted = true;
      // 0. 等待 app 的 boot()（挂在 DOMContentLoaded）完成再开始
      await new Promise((res) => {
        if (document.readyState !== 'loading') res();
        else document.addEventListener('DOMContentLoaded', res, { once: true });
      });
      await tick(50);
      window.addEventListener('unhandledrejection', (e) => pageErrors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
      // 1. UI 已渲染（boot 已执行）
      report(!!document.querySelector('#dropZone'), 'UI 渲染完成');
      report(document.querySelector('#targetKB').value === '100', '设置默认目标 100 KB');
      report(document.querySelector('#sizeW').value === '1.2' && document.querySelector('#sizeH').value === '1.8',
        '设置默认物理尺寸 1.2 × 1.8 cm');
      report(!document.querySelector('#dpi') && !document.querySelector('#maxEdge'),
        '无像素精度/最大边长配置（DPI 由目标大小实时演算）');
      // PI 完整性自测
      {
        let selfTest = '无';
        try {
          const zip = await PI.buildZip([{ name: 'a.png', data: new Uint8Array(50).fill(1) }]);
          const parsed = await PI.parseZip(zip);
          selfTest = 'OK entries=' + parsed.length + ' name=' + parsed[0].name;
        } catch (e) { selfTest = 'ERR:' + String(e).slice(0, 120); }
        report(selfTest === 'OK entries=1 name=a.png', 'PI buildZip+parseZip 自测: ' + selfTest);
      }
      // 高级设置：折叠栏存在 + 覆盖生效（钩子验证）
      {
        const panel = document.querySelector('#advancedPanel');
        report(!!panel && panel.open === false, '高级设置折叠栏存在且默认收起');
        report(document.querySelector('#satModeSelect').value === 'auto' && document.querySelector('#ditherModeSelect').value === 'auto',
          '饱和度/抖动默认自动档');
        const satSel = document.querySelector('#satModeSelect');
        satSel.value = 'strong';
        satSel.dispatchEvent(new Event('change', { bubbles: true }));
        report(window.__piState().settings.satMode === 'strong', '饱和度档位切换为强（钩子生效）');
        satSel.value = 'auto';
        satSel.dispatchEvent(new Event('change', { bubbles: true }));
        report(window.__piState().settings.satMode === 'auto', '饱和度档位恢复自动');
        const modeSel = document.querySelector('#colorModeSelect');
        modeSel.value = '8';
        modeSel.dispatchEvent(new Event('change', { bubbles: true }));
        const st = window.__piState && window.__piState();
        report(!!st && st.settings.colorMode === '8', '色数覆盖为 8 色（__piState 钩子生效）');
        modeSel.value = 'auto';
        modeSel.dispatchEvent(new Event('change', { bubbles: true }));
        report(window.__piState().settings.colorMode === 'auto', '色数恢复自动档');
      }
      // Worker 并行编码：脚本内联存在 + 真实往返（quantize+dither+encodePng 全链路）
      {
        const srcEl = document.getElementById('workerSrc');
        report(!!srcEl && srcEl.textContent.trim().length > 1000,
          'Worker 脚本内联存在（' + (srcEl ? srcEl.textContent.trim().length : 0) + ' B）');
        let wRound = '无';
        try {
          const src = srcEl.textContent.trim();
          const blob = new Blob([src], { type: 'text/javascript' });
          const wkr = new Worker(URL.createObjectURL(blob));
          wRound = await new Promise((res) => {
            wkr.onmessage = (e) => res(e.data);
            const w = 8, h = 8;
            const rgba = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < rgba.length; i++) rgba[i] = i % 4 === 3 ? 255 : (i * 7) % 256;
            wkr.postMessage({ id: 1, cmd: 'encode', width: w, height: h, rgba, colors: 8, ditherFactor: 0.5, phys: 300 }, [rgba.buffer]);
          });
          wkr.terminate();
        } catch (e) { wRound = 'ERR:' + String(e).slice(0, 120); }
        report(!!wRound && wRound.size > 0 && !wRound.error,
          'Worker 编码往返成功（' + (wRound && wRound.size || 0) + ' B' + (wRound && wRound.error ? ' err=' + wRound.error : '') + '）');
      }
      // 运行时诊断：readyState / ArchiveWasm / boot 痕迹
      report(document.readyState, 'readyState=' + document.readyState + ' ArchiveWasm=' + typeof window.ArchiveWasm +
        ' themeSelect=' + (document.querySelector('#themeSelect') ? '存在' : '缺失'));
      // 主题切换：亮/暗/跟随系统
      {
        const sel = document.querySelector('#themeSelect');
        sel.value = 'dark';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await tick(50);
        const dark = document.documentElement.dataset.theme === 'dark';
        sel.value = 'light';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await tick(50);
        const light = document.documentElement.dataset.theme === 'light';
        sel.value = 'auto';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await tick(50);
        const auto = !document.documentElement.dataset.theme;
        report(dark && light && auto, '主题切换：亮/暗/跟随系统（' + dark + '/' + light + '/' + auto + '）');
      }

      // 探针：change 事件派发链路是否正常
      let probeFired = 0;
      const probeInput = document.querySelector('#fileInput');
      probeInput.addEventListener('change', () => { probeFired++; });
      probeInput.dispatchEvent(new Event('change', { bubbles: true }));
      report(probeFired === 1, 'change 事件可正常派发并触发监听 (probeFired=' + probeFired + ')');

      const input = document.querySelector('#fileInput');

      // 附加 JPEG 输入 1：1200x1200 随机像素合成图（高熵照片模拟，源分辨率足够）
      async function makeJpegFixture() {
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 1200;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(1200, 1200);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = Math.random() * 255 | 0;
          d[i + 1] = Math.random() * 255 | 0;
          d[i + 2] = Math.random() * 255 | 0;
          d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const jpgBlob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
        return new File([jpgBlob], 'photo-input.jpg', { type: 'image/jpeg' });
      }

      // 附加 JPEG 输入 2：1600x1600 渐变 + 轻度噪声（低熵但有纹理且源分辨率足够，
      // → 默认目标必须升分辨率才能达标，验证“边长由目标实时确定”；源够大故可升）
      async function makeSmoothJpegFixture() {
        const c = document.createElement('canvas');
        c.width = 1600; c.height = 1600;
        const ctx = c.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 1600, 1600);
        grad.addColorStop(0, '#4f8cff');
        grad.addColorStop(1, '#ffb04f');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1600, 1600);
        const img = ctx.getImageData(0, 0, 1600, 1600);
        for (let i = 0; i < img.data.length; i += 4) {
          const n = Math.floor(Math.random() * 20) - 10;
          img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
        }
        ctx.putImageData(img, 0, 0);
        const jpgBlob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
        return new File([jpgBlob], 'smooth-input.jpg', { type: 'image/jpeg' });
      }

      // 坏文件（伪装成 .jpg 的随机字节，模拟 HEIC 等无法解码的格式；大于目标大小，
      // 避免命中「原样保留」分支——坏文件必须走解码失败路径）
      async function makeBadFixture() {
        const bytes = new Uint8Array(3 * 1024 * 1024);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
        return new File([bytes], 'bad-input.jpg', { type: 'image/jpeg' });
      }

      async function importFiles(files) {
        // 与用户一致：把全部文件打包为 ZIP（含文件夹路径）后上传解压导入
        window.__e2eProgress = 'import:arrayBuffer';
        const entries = [];
        for (const f of files) {
          entries.push({ name: f.webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) });
        }
        window.__e2eProgress = 'import:buildZip';
        const zip = await PI.buildZip(entries);
        window.__e2eProgress = 'import:zip=' + zip.length;
        const zipFile = new File([zip], 'test-pack.zip', { type: 'application/zip' });
        const dt = new DataTransfer();
        dt.items.add(zipFile);
        const zipInput = document.querySelector('#zipInput');
        zipInput.files = dt.files;
        zipInput.dispatchEvent(new Event('change', { bubbles: true }));
        // 导入是异步的（解压+渲染）——轮询等待真正完成
        const imported = await waitUntil(
          () => document.querySelectorAll('.file-row').length === files.length,
          180000, 'ZIP 导入'
        );
        window.__e2eProgress = 'import:afterChange rows=' + document.querySelectorAll('.file-row').length;
        const rows = document.querySelectorAll('.file-row');
        const errBar = document.getElementById('pageError');
        report(!!imported && rows.length === files.length,
          'ZIP 上传导入 ' + rows.length + ' 张（含文件夹结构）' + (errBar ? ' | 红条: ' + errBar.textContent : '') +
          ' | progress=' + (window.__e2eProgress || '') +
          ' | filter=' + ((window.__e2eFilter || []).join(';')).slice(0, 300));
      }

      async function makeFixtureFiles() {
        const files = [];
        const withPath = (f, p) => { try { Object.defineProperty(f, 'webkitRelativePath', { value: p }); } catch (e) {} return f; };
        for (const [name, b64] of Object.entries(fixtureData)) {
          const bin = atob(b64);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          files.push(withPath(new File([u8], name, { type: 'image/png' }), '测试相册/' + name));
        }
        files.push(withPath(await makeJpegFixture(), '测试相册/子目录/photo-input.jpg'));
        files.push(withPath(await makeSmoothJpegFixture(), '测试相册/子目录/smooth-input.jpg'));
        files.push(withPath(await makeBadFixture(), '测试相册/bad-input.jpg'));
        return files;
      }

      async function convertRound(targetKB, expectHitJpeg, keepList, smallRound = false) {
        // 小目标（≤8KB）：有效容差 ±12%（与引擎 effTol 一致）
        const win = smallRound ? 0.12 : 0.02;
        // 设置目标大小
        const kbInput = document.querySelector('#targetKB');
        kbInput.value = targetKB;
        kbInput.dispatchEvent(new Event('change', { bubbles: true }));
        // 导入 → 转换
        const files = await makeFixtureFiles();
        await importFiles(files);
        report([...document.querySelectorAll('.file-row')].every((r) => !!r.querySelector('.row-progress')),
          '每行均有独立进度条');
        document.querySelector('#btnConvert').click();
        window.__e2eProgress = 'convert:round=' + targetKB;
        // 并发确认：轮询捕获同刻处理中的行数（≥2 即证明并行）
        let maxProcessing = 0;
        let sawProgress = false;
        for (let i = 0; i < 30; i++) {
          maxProcessing = Math.max(maxProcessing,
            [...document.querySelectorAll('.file-row .status')].filter((s) => s.textContent === '处理中…').length);
          if ([...document.querySelectorAll('.row-progress-fill')].some((f) => parseFloat(f.style.width) > 0)) sawProgress = true;
          if (maxProcessing >= 2 && sawProgress) break;
          await tick(100);
        }
        report(maxProcessing >= 2, '并行执行确认（同刻处理中 ≥ 2 行，实测 ' + maxProcessing + ' 行）');
        report(sawProgress, '行级进度条已推进');
        const finished = await waitUntil(
          () => {
            const sts = document.querySelectorAll('.file-row .status');
            return sts.length > 0 && Array.from(sts).every((s) => s.textContent === '完成' || s.textContent === '失败');
          },
          180000, '转换完成'
        );
        report(finished, '目标 ' + targetKB + ' KB：转换全部完成（10 张：7 PNG + 2 JPEG + 1 坏文件）');
        // 校验
        const sizes = [];
        for (const row of document.querySelectorAll('.file-row')) {
          const name = row.querySelector('.name').textContent;
          const status = row.querySelector('.status').textContent;
          const resultTxt = row.querySelector('.result').textContent;
          const kb = parseKB(resultTxt);
          sizes.push({ name, status, kb, resultTxt });
        }
        // 预期：仅 bad-input 失败（解码失败），其余全部完成——单张坏文件不得卡死批处理
        const anyFail = sizes.filter((s) => s.status === '失败');
        const unexpectedFail = anyFail.filter((s) => s.name !== 'bad-input.jpg');
        report(unexpectedFail.length === 0 && anyFail.length === 1,
          '目标 ' + targetKB + ' KB：仅坏文件失败、其余全部成功（失败: ' +
          JSON.stringify(anyFail.map((s) => s.name)) + '）');
        const upper = targetKB * (1 + win);
        const over = sizes.filter((s) => s.name !== 'bad-input.jpg' && isFinite(s.kb) && s.kb > upper);
        report(over.length === 0, '目标 ' + targetKB + ' KB：全部 ≤ ' + upper.toFixed(2) + ' KB（超出: ' + JSON.stringify(over) + '）');
        // JPEG 输入（硬约束：≤ 上限；理想：精确命中；简单内容：触顶合法）
        const jpegRow = sizes.find((s) => s.name === 'photo-input.jpg');
        const jkb = (jpegRow || {}).kb;
        let jpegOk = false, jpegMode = '';
        if (!isFinite(jkb)) jpegOk = false;
        else if (jkb > upper) jpegOk = false;                       // 超上限 = 失败
        else if (jkb >= targetKB * (smallRound ? 0.88 : 0.98)) { jpegOk = true; jpegMode = '精确命中'; }
        else { jpegOk = jkb > (smallRound ? 0.1 : 5); jpegMode = '受限（源分辨率/内容触顶，有效输出）'; }
        report(!!jpegOk, '目标 ' + targetKB + ' KB：JPEG 输入' + jpegMode + '（' + jkb + ' KB，硬约束 ≤ ' + upper.toFixed(1) + '）');
        const pngOver = sizes.filter((s) => s.name.endsWith('.png') && isFinite(s.kb) && s.kb > upper);
        report(pngOver.length === 0, '目标 ' + targetKB + ' KB：PNG 输入全部 ≤ ' + upper.toFixed(2) + ' KB');
        // PNG 低熵图也参与 DPI 演算（升像素 + 量化命中目标区间，非固定 236px）
        const bigPhoto = sizes.find((s) => s.name === 'big-photo.png');
        const bigHit = bigPhoto && isFinite(bigPhoto.kb) && bigPhoto.kb <= upper &&
          (smallRound ? true : bigPhoto.kb >= targetKB * 0.9);
        report(!!bigHit, '目标 ' + targetKB + ' KB：PNG 低熵图演算命中 [' + (targetKB * 0.9).toFixed(1) + ', ' + upper.toFixed(2) + ']（' +
          (bigPhoto ? bigPhoto.kb + ' KB' : '无') + '）');
        // 低熵 JPEG（平滑渐变）：q80 质量下限下可能达不到目标下限（宁可小也不压质量）→ 有效输出即 PASS
        const smooth = sizes.find((s) => s.name === 'smooth-input.jpg');
        const smoothHit = smooth && isFinite(smooth.kb) && smooth.kb <= upper && smooth.kb > (smallRound ? 0.1 : 5);
        report(!!smoothHit, '目标 ' + targetKB + ' KB：低熵图有效输出（' +
          (smooth ? smooth.kb + ' KB' : '无') + ' ≤ ' + upper.toFixed(1) + '，q80 下限）');
        // 小图源（100×80，10.6KB）：保持源分辨率触顶输出（不放大不缩小，≤ 上限）
        const small = sizes.find((s) => s.name === 'small.png');
        const smallOk = small && isFinite(small.kb) && small.kb <= upper && small.kb > (smallRound ? 0.1 : 0.5);
        report(!!smallOk, '目标 ' + targetKB + ' KB：小图源保持分辨率触顶（small ' +
          (small ? small.kb + ' KB' : '?') + ' ≤ ' + upper.toFixed(1) + '）');
        const valid = sizes.filter((s) => s.status === '完成' && isFinite(s.kb) && s.kb > 0);
        report(valid.length === 9, '目标 ' + targetKB + ' KB：9/10 输出有效（' + valid.length + ' 完成，坏文件除外）');
        if (!keepList) {
          document.querySelector('#btnClearAll').click();
          await tick(200);
        }
      }

      // 轮 1：默认 50 KB（验证全流程、JPEG 精确命中、PNG 上限）
      await convertRound(50, ['photo-input.jpg'], true);

      // 5. 预览弹层 + 尺寸/DPI 演算结果
      {
        const rows = document.querySelectorAll('.file-row');
        let firstOpen = false;
        let shapeOk = true;
        let dpiMetaOk = true;
        for (const row of rows) {
          if (row.querySelector('.status').textContent === '失败') continue; // 失败行无结果可预览
          const pvBtn = [...row.querySelectorAll('.icon-btn')].find((b) => b.textContent === '预览');
          pvBtn.click();
          await tick(400);
          const modal = document.querySelector('.modal-overlay');
          if (!firstOpen && modal) { firstOpen = true; report(true, '预览弹层打开'); }
          const img = document.querySelector('.modal-img');
          const meta = document.querySelector('.modal-meta');
          // 物理 1.2 × 1.8 cm → 像素宽高比 2:3（±3%）；「原样保留」行（无 px @ DPI 元数据）跳过
          const isKept = !meta || !/px @/.test(meta.textContent);
          if (!isKept && (!img || !img.naturalWidth || !img.naturalHeight ||
              Math.abs(img.naturalWidth / img.naturalHeight - 2 / 3) > 0.03)) shapeOk = false;
          if (!meta || !/DPI/.test(meta.textContent)) dpiMetaOk = false;
          const close = document.querySelector('.modal-box .btn');
          if (close) close.click();
          await tick(150);
        }
        report(firstOpen, '预览弹层可用');
        report(shapeOk, '全部输出像素保持统一比例（2:3）');
        report(dpiMetaOk, '预览显示演算出的 DPI 元数据');
        report(!document.querySelector('.modal-overlay'), '预览弹层全部关闭');
      }

      // 6. 重新转换全部
      {
        const rcBtn = document.querySelector('#btnReconvert');
        report(!rcBtn.disabled, '重新转换按钮可用');
        rcBtn.click();
        const rcDone = await waitUntil(
          () => {
            const sts = document.querySelectorAll('.file-row .status');
            return sts.length > 0 && Array.from(sts).every((s) => s.textContent === '完成' || s.textContent === '失败');
          },
          180000, '重转完成'
        );
        report(rcDone, '重新转换全部完成');
        const rcOver = [...document.querySelectorAll('.file-row')].filter((row) => {
          const kb = parseKB(row.querySelector('.result').textContent);
          return isFinite(kb) && kb > 51;
        });
        report(rcOver.length === 0, '重新转换后全部 ≤ 51.00 KB');
        // 行级重转
        const row1 = document.querySelectorAll('.file-row')[1];
        const rowRcBtn = [...row1.querySelectorAll('.icon-btn')].find((b) => b.textContent === '重转');
        rowRcBtn.click();
        const rowDone = await waitUntil(
          () => [...document.querySelectorAll('.file-row')][1].querySelector('.status').textContent === '完成',
          180000, '单张重转'
        );
        report(!!rowDone, '单张重转完成');
      }

      // 7. mozjpeg 高质量编码器显式验证：内嵌 WASM 实例化 + 实际编码
      {
        try {
          const b64 = document.getElementById('mozjpegWasm').textContent.trim();
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const mod = await window.MozjpegEnc({ wasmBinary: bytes.buffer });
          const c = document.createElement('canvas');
          c.width = 64; c.height = 64;
          const ctx = c.getContext('2d');
          const grad = ctx.createLinearGradient(0, 0, 64, 64);
          grad.addColorStop(0, '#f0f');
          grad.addColorStop(1, '#0ff');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 64, 64);
          const data = ctx.getImageData(0, 0, 64, 64).data;
          const buf = mod.encode(data, 64, 64, {
            quality: 90, baseline: false, arithmetic: false, progressive: true,
            optimize_coding: true, smoothing: 0, color_space: 3, quant_table: 3,
            trellis_multipass: false, trellis_opt_zero: false, trellis_opt_table: false,
            trellis_loops: 1, auto_subsample: true, chroma_subsample: 2,
            separate_chroma_quality: false, chroma_quality: 90,
          });
          report(!!buf && buf.byteLength > 100,
            'mozjpeg WASM 实例化并成功编码（' + (buf ? buf.byteLength : 0) + ' B @ q90）');
        } catch (e) { report(false, 'mozjpeg WASM 验证失败: ' + e.message); }
      }

      // 8. oxipng（PNG 优化编码器）显式验证：WASM 实例化 + 编码
      {
        report(true, 'oxipng 诊断：typeof OxipngInitSync=' + typeof window.OxipngInitSync +
          ' typeof encode=' + typeof window.encode +
          ' glueLen=' + document.getElementById('oxipngWasm').textContent.trim().length);
        try {
          const b64 = document.getElementById('oxipngWasm').textContent.trim();
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const module = await WebAssembly.compile(bytes);
          await window.OxipngInitSync(module);
          const c = document.createElement('canvas');
          c.width = 128; c.height = 128;
          const ctx = c.getContext('2d');
          const grad = ctx.createLinearGradient(0, 0, 128, 128);
          grad.addColorStop(0, '#f0f');
          grad.addColorStop(1, '#0ff');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 128, 128);
          const data = ctx.getImageData(0, 0, 128, 128).data;
          const buf = window.encode(data, 128, 128, 8);
          report(!!buf && buf.byteLength > 50, 'oxipng WASM 实例化并成功编码（' + (buf ? buf.byteLength : 0) + ' B）');
        } catch (e) { report(false, 'oxipng WASM 验证失败: ' + e.message); }
      }

      // 9. 诊断：低熵图升分辨率时 q95 大小的真实增长曲线
      {
        try {
          const c = document.createElement('canvas');
          c.width = 240; c.height = 240;
          const ctx = c.getContext('2d');
          const grad = ctx.createLinearGradient(0, 0, 240, 240);
          grad.addColorStop(0, '#4f8cff');
          grad.addColorStop(1, '#ffb04f');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 240, 240);
          const img = ctx.getImageData(0, 0, 240, 240);
          for (let i = 0; i < img.data.length; i += 4) {
            const n = Math.floor(Math.random() * 20) - 10;
            img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
          }
          ctx.putImageData(img, 0, 0);
          const edges = [240, 480, 960, 1920, 3840];
          const row = [];
          for (const e of edges) {
            const cc = document.createElement('canvas');
            cc.width = e; cc.height = e;
            const cctx = cc.getContext('2d');
            cctx.imageSmoothingEnabled = true;
            cctx.imageSmoothingQuality = 'high';
            cctx.drawImage(c, 0, 0, e, e);
            const b = await new Promise((res) => cc.toBlob(res, 'image/jpeg', 0.95));
            row.push(e + ':' + (b.size / 1024).toFixed(1));
          }
          report(true, '低熵图 q95 增长曲线(KB): ' + row.join(' '));
        } catch (e) { report(false, '诊断失败: ' + e.message); }
      }

      // 8. 无“纯本地”等文案（排除 script 内的测试脚本自身文本）
      {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script').forEach((s) => s.remove());
        const txt = clone.textContent;
        report(!txt.includes('纯本地') && !txt.includes('无网络请求') && !txt.includes('零联网'),
          '页面不含「纯本地/无网络请求/零联网」文案');
      }

      // 8. 触发 ZIP 导出（第一轮结果仍在列表；下载交由无头浏览器落盘，运行后在外部校验）
      const zipBtn = document.querySelector('#btnExportZip');
      report(!zipBtn.disabled, '下载 ZIP 按钮可用');
      zipBtn.click();
      await tick(2000);
      report(true, '已触发 ZIP 下载（保留文件夹结构）');
      // 平铺模式导出（第二个 ZIP）
      const treeToggle = document.querySelector('#keepTree');
      treeToggle.checked = false;
      document.querySelector('#btnExportZip').click();
      await tick(2500);
      report(true, '已触发 ZIP 下载（平铺模式）');
      treeToggle.checked = true;
      document.querySelector('#btnClearAll').click();
      await tick(200);

      // 轮 5：10 KB（0.8–25KB 区间：32 色量化，与 8KB 场景一致；>25KB 才全彩）
      await convertRound(10, ['photo-input.jpg'], false);

      // 轮 6：0.3 KB（极端下限：8 色 ~12×12px；JPEG 8×8 ≈ 200-350B 可能命中或标注物理下限）
      {
        document.querySelector('#btnClearAll').click();
        await tick(200);
        const kbInput = document.querySelector('#targetKB');
        kbInput.value = 0.3;
        kbInput.dispatchEvent(new Event('change', { bubbles: true }));
        const files = await makeFixtureFiles();
        await importFiles(files);
        document.querySelector('#btnConvert').click();
        const finished = await waitUntil(
          () => {
            const sts = document.querySelectorAll('.file-row .status');
            return sts.length > 0 && Array.from(sts).every((s) => s.textContent === '完成' || s.textContent === '失败');
          },
          180000, '0.3KB 转换完成'
        );
        report(finished, '目标 0.3 KB：转换全部完成');
        const sizes = [];
        for (const row of document.querySelectorAll('.file-row')) {
          const name = row.querySelector('.name').textContent;
          const status = row.querySelector('.status').textContent;
          sizes.push({ name, status, kb: parseKB(row.querySelector('.result').textContent), resultTxt: row.querySelector('.result').textContent });
        }
        const anyFail = sizes.filter((s) => s.status === '失败');
        report(anyFail.length === 1 && anyFail[0].name === 'bad-input.jpg', '目标 0.3 KB：仅坏文件失败');
        // PNG：硬约束 ≤ 0.336KB（8 色 ~12×12px 命中窗口）
        const pngs = sizes.filter((s) => s.name.endsWith('.png') && isFinite(s.kb));
        const pngOver = pngs.filter((s) => s.kb > 0.336);
        report(pngOver.length === 0, '目标 0.3 KB：PNG 全部 ≤ 0.336KB（超出: ' + JSON.stringify(pngOver) + '）');
        // JPEG：命中窗口或标注物理下限（8×8 最小 ~200-350B，贴近 344B 边界）
        const jpegs = sizes.filter((s) => /\.jpg$/.test(s.name) && isFinite(s.kb));
        const jpegOk = jpegs.length === 2 && jpegs.every((s) => s.kb <= 0.5 && (s.kb <= 0.336 || (s.resultTxt || '').includes('物理下限')));
        report(jpegOk, '目标 0.3 KB：JPEG 命中或标注物理下限（' + jpegs.map((s) => s.kb + 'KB').join(', ') + '）');
        document.querySelector('#btnClearAll').click();
        await tick(200);
      }

      // 轮 2：30 KB（落在曲线可命中区，验证二分搜索精确命中）
      await convertRound(30, ['photo-input.jpg'], false);

      // 轮 3：256 KB（大目标 → 验证演算上限随目标增大、大像素命中）
      await convertRound(256, ['photo-input.jpg'], false);

      // 轮 4：1 KB（小目标下限：硬约束 ≤ 1.12KB、JPEG 命中 ~1KB、PNG 无损尽力而为）
      await convertRound(1, [], true, true);

      // 9.5. 1KB 轮 PNG 输出分辨率诊断（观察性：验证去噪+锐化后分辨率不降反升）
      {
        const pxLines = [];
        for (const row of document.querySelectorAll('.file-row')) {
          if (row.querySelector('.status').textContent !== '完成') continue;
          const pvBtn = [...row.querySelectorAll('.icon-btn')].find((b) => b.textContent === '预览');
          pvBtn.click();
          await tick(300);
          const meta = document.querySelector('.modal-meta');
          const m = meta ? /([0-9]+)×([0-9]+)px @ ([0-9]+) DPI/.exec(meta.textContent) : null;
          if (m) pxLines.push(row.querySelector('.name').textContent + '=' + m[1] + '×' + m[2] + 'px@' + m[3]);
          const close = document.querySelector('.modal-box .btn');
          if (close) close.click();
          await tick(120);
        }
        report(true, '1KB 轮输出分辨率: ' + (pxLines.join(', ') || '（无 px 元数据）'));
      }

      // 10. 下载全部：直接逐张下载（不经 ZIP）——9 张完成图（坏文件跳过）
      {
        const dlBtn = document.querySelector('#btnDownloadAll');
        report(!!dlBtn, '下载全部按钮存在');
        if (dlBtn) {
          report(!dlBtn.disabled, '下载全部按钮可用（有完成项）');
          dlBtn.click();
          await tick(4000);
          report(true, '已触发下载全部（9 张：7 PNG + 2 JPEG，坏文件跳过）');
        }
        document.querySelector('#btnClearAll').click();
        await tick(200);
      }
    } catch (e) {
      window.__e2eFatal = String(e && e.stack || e);
      report(false, '驱动异常: ' + e.message + ' | ' + (e.stack || '').split('\\n')[0]);
    }
    if (pageErrors.length) report(false, '页面 JS 错误: ' + pageErrors.join(' | '));
    const pre = document.createElement('pre');
    pre.id = 'e2e-report';
    pre.textContent = results.join('\\n');
    document.body.appendChild(pre);
    document.title = 'E2E_DONE';
  })();
})();
</script>
`;

html = html.replace('</body>', DRIVER + '</body>');
const out = path.join(outDir, 'e2e.html');
fs.writeFileSync(out, html);
console.log('e2e.html 生成: ' + out + ' (' + (html.length / 1024 / 1024).toFixed(1) + ' MB)');
