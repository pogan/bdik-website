const test = require('node:test');
const assert = require('node:assert/strict');
const {
  padRegon,
  isValidRegon,
  normalizePhone,
  normalizeWebsite,
  normalizeEmail,
  normalizeDate,
  normalizeEmploymentBand,
  splitPkd,
  normalizedKey,
} = require('../etl/normalize');

test('padRegon dopełnia obcięte przez Excel wiodące zera', () => {
  assert.equal(padRegon('284888'), '000284888');
  assert.equal(padRegon('120802867'), '120802867');
  assert.equal(padRegon(''), '');
});

test('isValidRegon weryfikuje sumę kontrolną dla REGON 9- i 14-cyfrowego', () => {
  assert.equal(isValidRegon('000284888'), true);
  assert.equal(isValidRegon('120802867'), true);
  assert.equal(isValidRegon('123456789'), false);
  assert.equal(isValidRegon('abc'), false);
});

test('normalizePhone dodaje prefiks +48', () => {
  assert.equal(normalizePhone('324346031'), '+48324346031');
  assert.equal(normalizePhone('48324346031'), '+48324346031');
  assert.equal(normalizePhone(''), '');
});

test('normalizeWebsite dodaje schemat i usuwa końcowy slash', () => {
  assert.equal(normalizeWebsite('www.example.pl/'), 'https://www.example.pl');
  assert.equal(normalizeWebsite('https://example.pl'), 'https://example.pl');
  assert.equal(normalizeWebsite(''), '');
});

test('normalizeEmail przycina i lowercase-uje', () => {
  assert.equal(normalizeEmail(' Test@Example.PL '), 'test@example.pl');
});

test('normalizeDate konwertuje M/D/YYYY na ISO', () => {
  assert.equal(normalizeDate('6/27/2008'), '2008-06-27');
  assert.equal(normalizeDate('12/1/2021'), '2021-12-01');
  assert.equal(normalizeDate('zle dane'), '');
});

test('normalizeEmploymentBand usuwa wiodący apostrof z Excela', () => {
  assert.equal(normalizeEmploymentBand("'1-9"), '1-9');
});

test('splitPkd rozdziela kod i opis', () => {
  assert.deepEqual(splitPkd('90.04.Z - DZIAŁALNOŚĆ OBIEKTÓW KULTURALNYCH'), {
    code: '90.04.Z',
    desc: 'DZIAŁALNOŚĆ OBIEKTÓW KULTURALNYCH',
  });
});

test('normalizedKey usuwa diakrytyki i normalizuje białe znaki', () => {
  assert.equal(normalizedKey('Żory - Świetlica "Rebus"'), 'zory swietlica rebus');
});
