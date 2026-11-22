export function formatPrice(cents) {
  const currency = process.env.CURRENCY ?? 'USD';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function createSession() {
  return { expiresAt: new Date().getTime() + 30 * 60_000 };
}

export function isExpired(session) {
  return Date.now() > session.expiresAt;
}

export function watchStock(check, ms = 1000) {
  const timer = setInterval(check, ms);
  return () => clearInterval(timer);
}
