'use strict';
/* 把 src/ 内联为单文件 index.html（零外部请求，双击即用） */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('src/index.template.html');
html = html.replace('<!--STYLE-->', '<style>\n' + read('src/style.css') + '\n</style>');
// mozjpeg Emscripten glue：ESM → 全局；import.meta.url 在内联 script 非法 → 安全替换
let glue = read('vendor/mozjpeg_enc.js');
glue = glue.replace('import.meta.url="https://localhost"', 'void 0');
// new URL(..., import.meta.url) 在初始化时无条件执行：替换为常量（wasm 经 wasmBinary 注入）
glue = glue.replace('new URL("mozjpeg_enc.wasm",import.meta.url).href', '"mozjpeg_enc.wasm"');
glue = glue.replace(/import\.meta\.url/g, '""');
glue = glue.replace('export default Module;', 'window.MozjpegEnc = Module;');
// Emscripten 的 wasm 备用加载路径（fetch/XMLHttpRequest）：wasmBinary 注入时永不执行；
// 分支条件置 false + 调用点静态清零，确保离线（运行时绝无网络请求）
glue = glue.replace('typeof fetch=="function"', 'false');
glue = glue.replace(/fetch\(/g, 'null(');
glue = glue.replace(/new XMLHttpRequest/g, 'null');
html = html.replace('<!--MOZJPEG_GLUE-->', glue);
// mozjpeg 编码器 WASM（248KB）以 base64 内嵌，保持单文件零联网
html = html.replace('<!--MOZJPEG_WASM-->', fs.readFileSync(path.join(root, 'vendor', 'mozjpeg_enc.wasm')).toString('base64'));
// oxipng（Squoosh 同款 PNG 优化编码器）glue：wasm-bindgen ESM → 全局
let oxi = read('vendor/oxipng_enc.js');
oxi = oxi.replace('import.meta.url === undefined', 'false');
oxi = oxi.replace("import.meta.url = 'https://localhost'", 'void 0');
oxi = oxi.replace('new URL(\'squoosh_png_bg.wasm\', import.meta.url)', '\'oxipng_enc.wasm\'');
// wasm 备用加载路径（fetch）：initSync(module) 注入时不执行；静态清零确保离线
oxi = oxi.replace('input = fetch(input);', 'input = null;');
oxi = oxi.replace(/import\.meta\.url/g, '""');
oxi = oxi.replace(/export function /g, 'function ');
oxi = oxi.replace(/export class /g, 'class ');
oxi = oxi.replace('export { initSync }', 'window.OxipngInitSync = initSync;');
oxi = oxi.replace('export default __wbg_init;', '');
html = html.replace('<!--OXIPNG_GLUE-->', oxi);
html = html.replace('<!--OXIPNG_WASM-->', fs.readFileSync(path.join(root, 'vendor', 'oxipng_enc.wasm')).toString('base64'));
// Worker 并行编码脚本：logic.js（UMD）+ 入口（quantize/dither/encodePng，供 #workerSrc）
const WORKER_ENTRY = `
;(function () {
  'use strict';
  self.onmessage = async (e) => {
    const { id, cmd, width, height, rgba, colors, ditherFactor, phys } = e.data || {};
    try {
      if (cmd !== 'encode') throw new Error('unknown cmd: ' + cmd);
      const data = new Uint8ClampedArray(rgba);
      let bytes;
      if (colors > 0) {
        const q = self.PI.quantize(data, colors);
        const indices = ditherFactor > 0 ? self.PI.ditherIndices(data, q.palette, width, height, ditherFactor) : q.indices;
        bytes = await self.PI.encodePng({ width, height, rgba: data, indices, palette: q.palette, mode: 'palette', phys });
      } else {
        let hasAlpha = false;
        for (let i = 3; i < data.length; i += 4) { if (data[i] !== 255) { hasAlpha = true; break; } }
        bytes = await self.PI.encodePng({ width, height, rgba: data, mode: hasAlpha ? 'rgba' : 'rgb', phys });
      }
      self.postMessage({ id, bytes: bytes.buffer, size: bytes.length }, [bytes.buffer]);
    } catch (err) {
      self.postMessage({ id, error: String(err && err.message || err) });
    }
  };
})();
`;
html = html.replace('/*WORKER_SRC*/', read('src/logic.js') + '\n' + WORKER_ENTRY);
html = html.replace('<!--LOGIC-->', read('src/logic.js'));
html = html.replace('<!--APP-->', read('src/app.js'));

// 安全自检：交付物中不得出现网络引用、动态代码执行或 innerHTML 注入
const forbidden = [
  /\bhttps?:\/\//g, /\bfetch\s*\(/g, /\bXMLHttpRequest\b/g, /new\s+WebSocket\b/g, /<link\b/g,
  /\beval\s*\(/g, /new\s+Function\b/g, /\.innerHTML\s*=/g,
];
for (const re of forbidden) {
  if (re.test(html)) throw new Error('build 失败：交付物含安全违禁引用: ' + re);
}

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('build ok -> index.html (' + (html.length / 1024).toFixed(1) + ' KB)');
