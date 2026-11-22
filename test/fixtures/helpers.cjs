// Shared bits for the fixtures. Nothing here leaks on its own.
const http = require('node:http');

async function withServer(fn) {
  const server = http.createServer((req, res) => res.end(JSON.stringify({ path: req.url })));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

module.exports = { withServer };
