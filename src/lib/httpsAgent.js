// HTTPS agent for all backend calls.
//
// The kiosk relies on standard TLS: the system certificate store validates
// book.poembooth.com / the Vercel staging host like any browser would. The
// previous "pinning" layer was a trust-on-first-use scheme that accepted and
// stored any new fingerprint, so it added nothing over TLS; it was removed.
//
// keepAlive matters here: the kiosk talks to the backend every few seconds
// (print-job polling, config polling), and a persistent connection saves a
// full TLS handshake per request.
const https = require('https');

let agent = null;

function createHttpsAgent() {
  if (!agent) {
    agent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 15000,
      maxSockets: 4,
      timeout: 60000
    });
  }
  return agent;
}

module.exports = { createHttpsAgent };
