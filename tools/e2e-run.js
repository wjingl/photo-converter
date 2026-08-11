'use strict';
/* E2E 运行器：无头浏览器 + CDP（真实时间，跨平台）。
 * 用法：node tools/e2e-run.js [浏览器路径]（默认 Edge；Linux 可传 chromium/chrome） */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 9222;
const CANDIDATES = process.argv[2]
  ? [process.argv[2]]
  : [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '/usr/bin/chromium', '/usr/bin/google-chrome', '/snap/bin/chromium',
    ];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BROWSER = CANDIDATES.find((p) => fs.existsSync(p));

async function main() {
  if (!BROWSER) throw new Error('未找到浏览器，请显式传入：node tools/e2e-run.js <浏览器路径>');
  const root = path.join(__dirname, '..');
  const pageUrl = 'file:///' + path.join(root, 'tests', 'out', 'e2e.html').replace(/\\/g, '/');
  const profileDir = path.join(root, 'tests', 'out', 'edge-profile');
  const dlDir = path.join(root, 'tests', 'out', 'downloads');
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.rmSync(dlDir, { recursive: true, force: true });
  fs.mkdirSync(dlDir, { recursive: true });

  const browser = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--enable-features=msDownloads',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
    `--download-dir=${dlDir}`, '--window-size=390,844', pageUrl,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', (d) => process.env.E2E_DEBUG && console.error('[edge]', String(d).slice(0, 500)));

  let ws;
  try {
    let page = null;
    for (let i = 0; i < 60 && !page; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        page = targets.find((t) => t.type === 'page' && t.url.includes('e2e.html'));
      } catch (e) { /* 服务未就绪 */ }
      if (!page) await sleep(500);
    }
    if (!page) throw new Error('CDP 连接超时');

    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    const sendCmd = (method, params) => new Promise((res) => {
      const id = ++msgId;
      pending.set(id, (msg) => res(msg.result));
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    // 规范化的下载行为：允许 + 指定落盘目录（headless 下载必需）
    await sendCmd('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    // userGesture: true —— 使 a.download 下载被视为用户手势
    const evaluate = (expr) => new Promise((res) => {
      const id = ++msgId;
      pending.set(id, (msg) => res(msg.result && msg.result.result && msg.result.result.value));
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, userGesture: true } }));
    });

    // 轮询直到驱动完成（真实时间，最多 300s）
    let done = false;
    for (let i = 0; i < 600 && !done; i++) {
      try { done = (await evaluate('document.title')) === 'E2E_DONE'; } catch (e) { /* 忽略 */ }
      if (!done) await sleep(500);
    }
    if (!done) throw new Error('E2E 超时（300s）未完成');

    const report = await evaluate(`(() => { const el = document.querySelector('#e2e-report'); return el ? el.textContent : '无报告'; })()`);
    console.log(report);
    // 等待下载落盘（最多 15s）
    for (let i = 0; i < 30; i++) {
      if (fs.readdirSync(dlDir).some((f) => f.endsWith('.zip'))) break;
      await sleep(500);
    }
  } finally {
    if (ws) { try { ws.close(); } catch (e) {} }
    browser.kill();
    await sleep(500);
    const files = fs.readdirSync(dlDir);
    console.log('=== 下载目录 ===');
    console.log(files.length ? files.join(', ') : '(空)');
    const zips = files.filter((f) => f.endsWith('.zip'));
    if (zips.length) {
      const { spawnSync } = require('node:child_process');
      const zp = path.join(dlDir, zips[0]);
      const py = spawnSync('python', ['-c',
        'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; names=z.namelist(); print("ZIP_OK entries=%d" % len(names)); [print("  ", n, z.getinfo(n).file_size, "B") for n in names]',
        zp], { encoding: 'utf8' });
      console.log('=== ZIP 校验（Python zipfile）===');
      console.log(py.status === 0 ? (py.stdout || 'ZIP_OK') : ('ZIP_FAIL: ' + py.stderr));
    }
  }
}

main().catch((e) => { console.error('E2E 运行失败:', e.message); process.exit(1); });
