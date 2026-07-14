const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupKey, mergeRecord, SOURCE_PRIORITY } = require('../etl/dedup');

test('dedupKey preferuje REGON, gdy dostępny', () => {
  const key = dedupKey({ regon: '000284888', name: 'X', postal_code: '00-000', building_no: '1' });
  assert.equal(key, 'regon:000284888');
});

test('dedupKey spada na fallback nazwa+kod+numer, gdy brak REGON', () => {
  const key = dedupKey({ regon: '', name: 'Dom Kultury', postal_code: '44-240', building_no: '1' });
  assert.equal(key, 'fallback:dom kultury|44-240|1');
});

test('mergeRecord: puste pole z przychodzącego rekordu nigdy nie kasuje istniejącej wartości', () => {
  const existing = { phone: '+48111111111', __source: 'seed' };
  const merged = mergeRecord(existing, { phone: '' }, 'gus');
  assert.equal(merged.phone, '+48111111111');
});

test('mergeRecord: wyższy priorytet nadpisuje niższy, gdy oba pola niepuste', () => {
  const existing = { name: 'STARA', __source: 'seed' };
  const merged = mergeRecord(existing, { name: 'NOWA' }, 'gus');
  assert.equal(merged.name, 'NOWA');
  assert.equal(merged.__source, 'gus');
});

test('mergeRecord: niższy priorytet NIE nadpisuje wyższego', () => {
  const existing = { name: 'Z GUS', __source: 'gus' };
  const merged = mergeRecord(existing, { name: 'PRÓBA Z KRS' }, 'krs');
  assert.equal(merged.name, 'Z GUS');
  assert.equal(merged.__source, 'gus');
});

test('mergeRecord: puste pole istniejące jest uzupełniane niezależnie od priorytetu', () => {
  const existing = { email: '', __source: 'gus' };
  const merged = mergeRecord(existing, { email: 'nowy@example.pl' }, 'ceidg');
  assert.equal(merged.email, 'nowy@example.pl');
});

test('SOURCE_PRIORITY: kolejność zgodna z planem (GUS > RIK > KRS > CEIDG > seed)', () => {
  assert.ok(SOURCE_PRIORITY.gus > SOURCE_PRIORITY.rik);
  assert.ok(SOURCE_PRIORITY.rik > SOURCE_PRIORITY.krs);
  assert.ok(SOURCE_PRIORITY.krs > SOURCE_PRIORITY.ceidg);
  assert.ok(SOURCE_PRIORITY.ceidg > SOURCE_PRIORITY.seed);
});
