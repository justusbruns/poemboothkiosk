// Supabase Realtime "pokes" from the backend.
//
// The backend broadcasts { reason } on the public topic kiosk-<equipment_id>
// whenever something this booth cares about changes: its terminal order
// ('order'), its config ('config') or a remote command ('command'). A poke
// carries no data: the kiosk always re-fetches over its authenticated API, so
// a forged poke can at most cause an extra request. Polling stays in place as
// the fallback; this only makes changes arrive within a second.
//
// A join can fail (transport error at connect, a dropped socket that the
// library does not recover from): a watchdog rebuilds the client from scratch
// while the channel is not joined, so the booth always gets back to listening.

const { RealtimeClient } = require('@supabase/realtime-js');

const WATCHDOG_MS = 15000;      // how often the join state is checked
const REJOIN_AFTER_MS = 30000;  // not joined for this long → rebuild the client

class RealtimeService {
  constructor({ onPoke, log = console } = {}) {
    this.onPoke = onPoke || (() => {});
    this.log = log;
    this.client = null;
    this.channel = null;
    this.key = null;       // url|topic the current subscription is for
    this.realtime = null;  // last realtime block, for the watchdog's rebuild
    this.joined = false;
    this.attemptAt = 0;
    this.watchdog = null;
  }

  // (Re)subscribe from the realtime block of /api/kiosk/config:
  // { url, anon_key, topic }. No-op when nothing changed.
  configure(realtime) {
    if (!realtime || !realtime.url || !realtime.anon_key || !realtime.topic) {
      if (this.client) this.stop();
      return;
    }
    const key = `${realtime.url}|${realtime.topic}`;
    if (key === this.key && this.client) return;
    this.stop();
    this.key = key;
    this.realtime = realtime;
    this.connect();
    this.watchdog = setInterval(() => this.check(), WATCHDOG_MS);
  }

  connect() {
    const realtime = this.realtime;
    const endpoint = realtime.url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/realtime/v1';
    this.joined = false;
    this.attemptAt = Date.now();
    this.client = new RealtimeClient(endpoint, {
      params: { apikey: realtime.anon_key },
      heartbeatIntervalMs: 25000,
      reconnectAfterMs: (tries) => Math.min(30000, 1000 * Math.pow(2, Math.min(tries, 5)))
    });
    this.channel = this.client.channel(realtime.topic, { config: { broadcast: { self: false } } });
    this.channel
      .on('broadcast', { event: 'poke' }, (msg) => {
        const reason = (msg && msg.payload && msg.payload.reason) || 'unknown';
        this.log.log(`[REALTIME] poke: ${reason}`);
        try { this.onPoke(reason); } catch (e) { this.log.warn('[REALTIME] poke handler error:', e.message); }
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          this.joined = true;
          this.log.log(`[REALTIME] listening on ${realtime.topic}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.joined = false;
          this.log.warn(`[REALTIME] ${status}${err ? ': ' + err.message + describeCause(err.cause) : ''} (polling continues; rejoin follows)`);
        } else this.log.log(`[REALTIME] channel ${status}`);
      });
  }

  // Not joined for a while: throw the client away and start again
  check() {
    if (!this.realtime || this.joined) return;
    if (Date.now() - this.attemptAt < REJOIN_AFTER_MS) return;
    this.log.warn('[REALTIME] not listening, rebuilding the connection');
    this.teardown();
    this.connect();
  }

  teardown() {
    try { if (this.channel) this.channel.unsubscribe(); } catch (e) { /* ignore */ }
    try { if (this.client) this.client.disconnect(); } catch (e) { /* ignore */ }
    this.channel = null;
    this.client = null;
    this.joined = false;
  }

  stop() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    this.teardown();
    this.key = null;
    this.realtime = null;
  }
}

// What the transport actually said (a CloseEvent, an error event, ...), for the log
function describeCause(cause) {
  if (!cause || typeof cause !== 'object') return '';
  const bits = [];
  for (const k of ['type', 'code', 'reason', 'message']) if (cause[k] !== undefined && cause[k] !== '') bits.push(`${k}=${cause[k]}`);
  const inner = cause.error || cause.cause;
  if (inner && inner.message) bits.push(`error=${inner.message}`);
  if (inner && inner.code) bits.push(`errcode=${inner.code}`);
  return bits.length ? ` [${bits.join(', ')}]` : '';
}

module.exports = RealtimeService;
