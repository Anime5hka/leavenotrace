import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, createSession, isExpired } from './shop.js';

// These pass on their own, and fail after catalog.test.js has run in the same process.
test('the cart total is shown in dollars', () => {
  assert.equal(formatPrice(1250), '$12.50');
});

test('a fresh session is still valid', () => {
  assert.equal(isExpired(createSession()), false);
});
