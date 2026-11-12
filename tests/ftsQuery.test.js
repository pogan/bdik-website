// Zapytania z wyszukiwarki nie mogą wywołać błędu składni FTS5 (dawniej restart procesu).
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { sanitizeFtsQuery } = require('../lib/query');

const db = new Database(':memory:');
db.exec("CREATE VIRTUAL TABLE t USING fts5(name, locality)");
db.prepare('INSERT INTO t(name, locality) VALUES (?, ?)').run('Miejski Ośrodek Kultury', 'Kraków');
db.prepare('INSERT INTO t(name, locality) VALUES (?, ?)').run('Gminna Biblioteka Publiczna', 'Gdańsk');
const search = (q) => {
  const fts = sanitizeFtsQuery(q);
  return fts ? db.prepare('SELECT rowid FROM t WHERE t MATCH ?').all(fts).length : null;
};

test('znaki specjalne i słowa kluczowe FTS5 nie powodują błędu', () => {
  for (const q of ['Kraków, Gdańsk', 'kultura (miejska)', 'nazwa: biblioteka', 'AND', 'OR biblioteka',
    'NOT', 'a-b', 'x^y', '+kultura', 'NEAR(a b)', 'biblioteka;', '"cudzysłów', 'gwiazdka*', '{a}', "o'reilly"]) {
    assert.doesNotThrow(() => search(q), `zapytanie: ${q}`);
  }
});

test('sama interpunkcja daje puste zapytanie zamiast błędu', () => {
  assert.equal(sanitizeFtsQuery(', ; : ( )'), '');
  assert.equal(sanitizeFtsQuery('   '), '');
});

test('fragment słowa nadal trafia (prefix-match), także z przecinkiem', () => {
  assert.equal(search('Krak'), 1);
  assert.equal(search('Bibliot,'), 1);
  assert.equal(search('kultur gdańsk'), 0);
  assert.equal(search('Miejski Krak'), 1);
});
