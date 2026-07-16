const test = require('node:test');
const assert = require('node:assert/strict');
const { PUBLIC_FIELDS, ADMIN_FIELDS, isAuthorized, fieldsForRequest } = require('../lib/projection');

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

test('fieldsForRequest: zwykły zalogowany (nie-admin) nie widzi danych płatnych', () => {
  const fields = fieldsForRequest({ user: { is_active: 1, role: 'user', email: 'ktos@gmail.com' } });
  assert.deepEqual(fields, PUBLIC_FIELDS);
  assert.equal(fields.includes('email'), false);
  assert.equal(fields.includes('phone'), false);
  assert.equal(fields.includes('regon'), false);
});

test('fieldsForRequest: administrator dostaje wszystkie kolumny tabeli', () => {
  const byRole = fieldsForRequest({ user: { is_active: 1, role: 'admin' } });
  assert.deepEqual(byRole, ADMIN_FIELDS);
  assert.ok(byRole.includes('email'));
  assert.ok(byRole.includes('phone'));

  const byEmail = fieldsForRequest({ user: { is_active: 1, role: 'user', email: 'karol.konop@gmail.com' } });
  assert.deepEqual(byEmail, ADMIN_FIELDS);
});
