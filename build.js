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
