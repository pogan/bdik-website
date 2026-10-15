const test = require('node:test');
const assert = require('node:assert/strict');
const { displayCase } = require('../lib/textCase');

test('displayCase: nazwy z rejestru WIELKIMI LITERAMI -> czytelna pisownia', () => {
  assert.equal(
    displayCase('GMINNY OŚRODEK KULTURY I SPORTU W KRZYŻANOWIE'),
    'Gminny Ośrodek Kultury i Sportu w Krzyżanowie'
  );
  assert.equal(
    displayCase('MIEJSKO-GMINNE CENTRUM KULTURY IM.ALICJI I FRANCISZKA BRYŁÓW'),
    'Miejsko-Gminne Centrum Kultury im. Alicji i Franciszka Bryłów'
  );
  assert.equal(displayCase('MŁODZIEŻOWY DOM KULTURY "DOM HARCERZA"'), 'Młodzieżowy Dom Kultury "Dom Harcerza"');
  assert.equal(displayCase('OŚRODEK KULTURY M.ST.WARSZAWY'), 'Ośrodek Kultury m.st. Warszawy');
  assert.equal(displayCase('MDK IM. JANA PAWŁA II'), 'MDK im. Jana Pawła II');
});

test('displayCase: adresy i miejscowości', () => {
  assert.equal(displayCase('UL. GEN. JULIANA FILIPOWICZA'), 'ul. gen. Juliana Filipowicza');
  assert.equal(displayCase('RONDO KONSTYTUCJI 3-GO MAJA'), 'Rondo Konstytucji 3-go Maja');
  assert.equal(displayCase('BIELSKO-BIAŁA'), 'Bielsko-Biała');
});

test('displayCase: tekst mieszanymi literami i puste wartości zostają bez zmian', () => {
  assert.equal(displayCase('Centrum Kultury w Lublinie'), 'Centrum Kultury w Lublinie');
  assert.equal(displayCase(null), null);
  assert.equal(displayCase(''), '');
});
