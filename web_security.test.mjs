import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(name, import.meta.url), 'utf8');

test('page is self-contained and denies outbound connections', async () => {
  const [html, app, core] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('serial_core.js'),
  ]);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(app, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(core, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  assert.doesNotMatch(core, /localStorage|sessionStorage|indexedDB/);
});

test('secret and CSV are supplied by the visitor, never embedded', async () => {
  const html = await read('index.html');
  assert.match(html, /id="product-key"[^>]*type="password"/);
  assert.match(html, /id="csv-file"[^>]*type="file"/);
  assert.doesNotMatch(html, /0001020304050607/);
  assert.doesNotMatch(html, /Paipop_TEST_DEVICE/);
});
