const test = require('node:test');
const assert = require('node:assert/strict');
const { PUBLIC_FIELDS, FULL_FIELDS, isAuthorized, fieldsForRequest } = require('../lib/projection');

test('isAuthorized: false gdy brak req.user', () => {
  assert.equal(isAuthorized({}), false);
});

test('isAuthorized: false gdy konto nieaktywne', () => {
  assert.equal(isAuthorized({ user: { is_active: 0 } }), false);
});

test('isAuthorized: true gdy user aktywny', () => {
  assert.equal(isAuthorized({ user: { is_active: 1 } }), true);
});

test('fieldsForRequest: anonim dostaje wyłącznie pola publiczne', () => {
  const fields = fieldsForRequest({});
  assert.deepEqual(fields, PUBLIC_FIELDS);
  assert.equal(fields.includes('email'), false);
  assert.equal(fields.includes('phone'), false);
  assert.equal(fields.includes('regon'), false);
});

test('fieldsForRequest: zalogowany dostaje pełny zestaw', () => {
  const fields = fieldsForRequest({ user: { is_active: 1 } });
  assert.deepEqual(fields, FULL_FIELDS);
  assert.ok(fields.includes('email'));
  assert.ok(fields.includes('phone'));
});
