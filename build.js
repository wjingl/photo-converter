'use strict';
/* 把 src/ 内联为单文件 index.html（零外部请求，双击即用） */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('src/index.template.html');
html = html.replace('<!--STYLE-->', '<style>\n' + read('src/style.css') + '\n</style>');
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
