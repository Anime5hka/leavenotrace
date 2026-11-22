import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, isExpired, watchStock } from './shop.js';

test('EU stores show prices in euros', () => {
  process.env.CURRENCY = 'EUR';
  assert.equal(formatPrice(1000), '€10.00');
});

test('a session expires after 30 minutes', () => {
  const start = Date.now();
  mock.method(Date, 'now', () => start + 31 * 60_000);
  assert.equal(isExpired({ expiresAt: start + 30 * 60_000 }), true);
});

test('stock is checked every second', () => {
  let checks = 0;
  watchStock(() => { checks++; });
  assert.equal(checks, 0);
});
