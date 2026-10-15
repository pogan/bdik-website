const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveLastmods } = require('../lib/sitemapLastmod');

test('resolveLastmods: data przesuwa się tylko przy zmianie sygnatury strony', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdik-lastmod-'));
  const statePath = path.join(dir, 'state.json');

  const first = resolveLastmods(
    [{ path: '/a', signature: 'A1' }, { path: '/b', signature: 'B1' }],
    { statePath, today: '2026-01-01' }
  );
  assert.equal(first.get('/a'), '2026-01-01');
  assert.equal(first.get('/b'), '2026-01-01');

  const second = resolveLastmods(
    [{ path: '/a', signature: 'A1' }, { path: '/b', signature: 'B2' }],
    { statePath, today: '2026-02-01' }
  );
  assert.equal(second.get('/a'), '2026-01-01', 'niezmieniona strona zachowuje datę');
  assert.equal(second.get('/b'), '2026-02-01', 'zmieniona strona dostaje nową datę');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveLastmods: brak możliwości zapisu stanu nie wywraca startu', () => {
  const out = resolveLastmods([{ path: '/a', signature: 'x' }], {
    statePath: path.join(os.tmpdir(), 'nie-ma-takiego-katalogu-bdik', 'state.json'),
    today: '2026-03-01',
  });
  assert.equal(out.get('/a'), '2026-03-01');
});
