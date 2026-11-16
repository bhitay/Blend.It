// Runs after `expo export -p web`: makes dist/index.html installable to the home screen
// (manifest, iOS standalone meta tags, Hebrew RTL).
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../dist/index.html', import.meta.url);
let html = readFileSync(file, 'utf8');

const head = `
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/icon-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="BlendIt" />
    <meta name="theme-color" content="#F4F5F7" />`;

html = html
  .replace(/<html[^>]*>/, '<html lang="he" dir="rtl">')
  .replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />')
  .replace('</head>', `${head}\n  </head>`);

writeFileSync(file, html);
console.log('pwa: patched dist/index.html');
