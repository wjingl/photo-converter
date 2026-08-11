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
      // 0. 等待 app 的 boot()（挂在 DOMContentLoaded）完成再开始
      await new Promise((res) => {
        if (document.readyState !== 'loading') res();
        else document.addEventListener('DOMContentLoaded', res, { once: true });
      });
      await tick(50);
      window.addEventListener('unhandledrejection', (e) => pageErrors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
      // 1. UI 已渲染（boot 已执行）
      report(!!document.querySelector('#dropZone'), 'UI 渲染完成');
      report(document.querySelector('#targetKB').value === '50', '设置默认目标 50 KB');
      report(document.querySelector('#sizeW').value === '1.5' && document.querySelector('#sizeH').value === '1.5',
        '设置默认物理尺寸 1.5 × 1.5 cm');
      report(!document.querySelector('#dpi') && !document.querySelector('#maxEdge'),
        '无像素精度/最大边长配置（DPI 由目标大小实时演算）');
      // 探针：change 事件派发链路是否正常
      let probeFired = 0;
      const probeInput = document.querySelector('#fileInput');
      probeInput.addEventListener('change', () => { probeFired++; });
      probeInput.dispatchEvent(new Event('change', { bubbles: true }));
      report(probeFired === 1, 'change 事件可正常派发并触发监听 (probeFired=' + probeFired + ')');

      const input = document.querySelector('#fileInput');

      // 附加 JPEG 输入 1：240x240 随机像素合成图（真实照片级熵，q95≈58KB，与照片曲线同构）
      async function makeJpegFixture() {
        const c = document.createElement('canvas');
        c.width = 240; c.height = 240;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(240, 240);
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

      // 附加 JPEG 输入 2：240x240 渐变 + 轻度噪声（低熵但有纹理，240px 下 q95≈23KB
      // → 默认 50KB 目标必须升分辨率才能达标，验证“边长由目标实时确定”）
      async function makeSmoothJpegFixture() {
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
        const jpgBlob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
        return new File([jpgBlob], 'smooth-input.jpg', { type: 'image/jpeg' });
      }

      async function importFiles(files) {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        let importErr = '';
        try { input.files = dt.files; } catch (e) { importErr = e.message; }
        report(input.files.length === files.length,
          'DataTransfer 注入 ' + input.files.length + ' 个文件 (err: ' + importErr + ')');
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await tick(300);
        const rows = document.querySelectorAll('.file-row');
        report(rows.length === files.length, '导入图片 ' + rows.length + ' 张');
      }

      async function makeFixtureFiles() {
        const files = [];
        for (const [name, b64] of Object.entries(fixtureData)) {
          const bin = atob(b64);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          files.push(new File([u8], name, { type: 'image/png' }));
        }
        files.push(await makeJpegFixture());
        files.push(await makeSmoothJpegFixture());
        return files;
      }

      async function convertRound(targetKB, expectHitJpeg, keepList) {
        // 设置目标大小
        const kbInput = document.querySelector('#targetKB');
        kbInput.value = targetKB;
        kbInput.dispatchEvent(new Event('change', { bubbles: true }));
        // 导入 → 转换
        const files = await makeFixtureFiles();
        await importFiles(files);
        document.querySelector('#btnConvert').click();
        const finished = await waitUntil(
          () => {
            const sts = document.querySelectorAll('.file-row .status');
            return sts.length > 0 && Array.from(sts).every((s) => s.textContent === '完成' || s.textContent === '失败');
          },
          180000, '转换完成'
        );
        report(finished, '目标 ' + targetKB + ' KB：转换全部完成（9 张：7 PNG + 2 JPEG）');
        // 校验
        const sizes = [];
        for (const row of document.querySelectorAll('.file-row')) {
          const name = row.querySelector('.name').textContent;
          const status = row.querySelector('.status').textContent;
          const resultTxt = row.querySelector('.result').textContent;
          const kb = parseKB(resultTxt);
          sizes.push({ name, status, kb, resultTxt });
        }
        const anyFail = sizes.filter((s) => s.status === '失败');
        report(anyFail.length === 0, '目标 ' + targetKB + ' KB：无失败项（' +
          JSON.stringify(anyFail.map((s) => s.name + ': ' + s.resultTxt)) + '）');
        const upper = targetKB * 1.02;
        const over = sizes.filter((s) => isFinite(s.kb) && s.kb > upper);
        report(over.length === 0, '目标 ' + targetKB + ' KB：全部 ≤ ' + upper.toFixed(2) + ' KB（超出: ' + JSON.stringify(over) + '）');
        // JPEG 输入（硬约束：≤ 上限；理想：精确命中；简单内容：触顶合法）
        const jpegRow = sizes.find((s) => s.name === 'photo-input.jpg');
        const jkb = (jpegRow || {}).kb;
        let jpegOk = false, jpegMode = '';
        if (!isFinite(jkb)) jpegOk = false;
        else if (jkb > upper) jpegOk = false;                       // 超上限 = 失败
        else if (jkb >= targetKB * 0.98) { jpegOk = true; jpegMode = '精确命中'; }
        else { jpegOk = jkb > 5 && jkb > upper * 0.5; jpegMode = '内容受限（触顶/粒度）'; }
        report(!!jpegOk, '目标 ' + targetKB + ' KB：JPEG 输入' + jpegMode + '（' + jkb + ' KB，硬约束 ≤ ' + upper.toFixed(1) + '）');
        const pngOver = sizes.filter((s) => s.name.endsWith('.png') && isFinite(s.kb) && s.kb > upper);
        report(pngOver.length === 0, '目标 ' + targetKB + ' KB：PNG 输入全部 ≤ ' + upper.toFixed(2) + ' KB');
        // PNG 低熵图也参与 DPI 演算（升像素 + 量化命中目标区间，非固定 236px）
        const bigPhoto = sizes.find((s) => s.name === 'big-photo.png');
        const bigHit = bigPhoto && isFinite(bigPhoto.kb) && bigPhoto.kb >= targetKB * 0.9 && bigPhoto.kb <= upper;
        report(!!bigHit, '目标 ' + targetKB + ' KB：PNG 低熵图演算命中 [' + (targetKB * 0.9).toFixed(1) + ', ' + upper.toFixed(2) + ']（' +
          (bigPhoto ? bigPhoto.kb + ' KB' : '无') + '）');
        // 低熵 JPEG（平滑渐变）：必须通过升分辨率实时确定边长才能达标（核心验证）
        const smooth = sizes.find((s) => s.name === 'smooth-input.jpg');
        const smoothHit = smooth && isFinite(smooth.kb) && smooth.kb >= targetKB * 0.9 && smooth.kb <= upper;
        report(!!smoothHit, '目标 ' + targetKB + ' KB：低熵图升分辨率命中 [' + (targetKB * 0.9).toFixed(1) + ', ' + upper.toFixed(2) + ']（' +
          (smooth ? smooth.kb + ' KB' : '无') + '）');
        const valid = sizes.filter((s) => s.status === '完成' && isFinite(s.kb) && s.kb > 0);
        report(valid.length === 9, '目标 ' + targetKB + ' KB：全部输出有效（' + valid.length + '/9）');
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
          const pvBtn = [...row.querySelectorAll('.icon-btn')].find((b) => b.textContent === '预览');
          pvBtn.click();
          await tick(400);
          const modal = document.querySelector('.modal-overlay');
          if (!firstOpen && modal) { firstOpen = true; report(true, '预览弹层打开'); }
          const img = document.querySelector('.modal-img');
          const meta = document.querySelector('.modal-meta');
          if (!img || img.naturalWidth !== img.naturalHeight) shapeOk = false; // 物理 1:1 → 像素正方形
          if (!meta || !/DPI/.test(meta.textContent)) dpiMetaOk = false;
          const close = document.querySelector('.modal-box .btn');
          close.click();
          await tick(150);
        }
        report(firstOpen, '预览弹层可用');
        report(shapeOk, '全部输出像素保持统一比例（正方形）');
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

      // 7. 诊断：低熵图升分辨率时 q95 大小的真实增长曲线
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
      report(true, '已触发 ZIP 下载');
      document.querySelector('#btnClearAll').click();
      await tick(200);

      // 轮 2：30 KB（落在曲线可命中区，验证二分搜索精确命中）
      await convertRound(30, ['photo-input.jpg'], false);

      // 轮 3：256 KB（大目标 → 验证演算上限随目标增大、大像素命中）
      await convertRound(256, ['photo-input.jpg'], false);
    } catch (e) {
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
