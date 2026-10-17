// Supabase Realtime "pokes" from the backend.
//
// The backend broadcasts { reason } on the public topic kiosk-<equipment_id>
// whenever something this booth cares about changes: its terminal order
// ('order'), its config ('config') or a remote command ('command'). A poke
// carries no data: the kiosk always re-fetches over its authenticated API, so
// a forged poke can at most cause an extra request. Polling stays in place as
// the fallback; this only makes changes arrive within a second.

const { RealtimeClient } = require('@supabase/realtime-js');

class RealtimeService {
  constructor({ onPoke, log = console } = {}) {
    this.onPoke = onPoke || (() => {});
    this.log = log;
    this.client = null;
    this.channel = null;
    this.key = null; // url|topic the current subscription is for
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

    const endpoint = realtime.url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/realtime/v1';
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
        if (status === 'SUBSCRIBED') this.log.log(`[REALTIME] listening on ${realtime.topic}`);
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.log.warn(`[REALTIME] ${status}${err ? ': ' + err.message : ''} (polling continues; client retries)`);
        } else this.log.log(`[REALTIME] channel ${status}`);
      });
    // The socket itself: a silent drop shows up here, and the client reconnects
    try {
      this.client.onOpen(() => this.log.log('[REALTIME] socket open'));
      this.client.onClose((e) => this.log.warn('[REALTIME] socket closed' + (e && e.code ? ' (' + e.code + ')' : '') + ', reconnecting'));
      this.client.onError((e) => this.log.warn('[REALTIME] socket error:', (e && e.message) || String(e)));
    } catch (e) { /* older client without these hooks */ }
  }

  stop() {
    try { if (this.channel) this.channel.unsubscribe(); } catch (e) { /* ignore */ }
    try { if (this.client) this.client.disconnect(); } catch (e) { /* ignore */ }
    this.channel = null;
    this.client = null;
    this.key = null;
  }
}

module.exports = RealtimeService;
