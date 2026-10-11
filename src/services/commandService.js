// Remote commands queued by the admin (restart app / reboot device / reload
// config). Fetched right after a Realtime 'command' poke and once a minute as a
// fallback. A command never interrupts a guest: the renderer is asked to
// confirm the booth is idle first (it answers as soon as nobody is mid-session),
// with a hard cap so a booth that never goes idle still restarts eventually.

const POLL_INTERVAL_MS = 60 * 1000;
const IDLE_WAIT_MAX_MS = 5 * 60 * 1000;

class CommandService {
  /**
   * @param {object} opts
   * @param {() => object} opts.getApiClient
   * @param {(cmd) => Promise<void>} opts.waitForIdle  resolves when no guest is mid-session
   * @param {object} opts.handlers  { restart_app, reboot_device, reload_config } → async () => string|void
   */
  constructor({ getApiClient, waitForIdle, handlers, log = console }) {
    this.getApiClient = getApiClient;
    this.waitForIdle = waitForIdle;
    this.handlers = handlers;
    this.log = log;
    this.timer = null;
    this.running = false;     // a fetch/execute cycle is in progress
    this.again = false;       // a poke arrived during a cycle
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.checkNow(), POLL_INTERVAL_MS);
    this.checkNow();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async checkNow() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do {
        this.again = false;
        const api = this.getApiClient();
        if (!api) return;
        let commands = [];
        try {
          commands = await api.getCommands();
        } catch (e) {
          this.log.warn('[COMMANDS] fetch failed:', e.message);
          return;
        }
        for (const cmd of commands) await this.execute(cmd);
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  async execute(cmd) {
    const api = this.getApiClient();
    const handler = this.handlers[cmd.type];
    this.log.log(`[COMMANDS] ${cmd.type} (${cmd.id}) requested at ${cmd.requested_at}`);
    if (!handler) {
      await api.reportCommand(cmd.id, 'failed', `unsupported command: ${cmd.type}`).catch(() => {});
      return;
    }

    if (cmd.type !== 'reload_config') {
      await Promise.race([
        this.waitForIdle(cmd),
        new Promise((resolve) => setTimeout(() => {
          this.log.warn(`[COMMANDS] booth not idle after ${IDLE_WAIT_MAX_MS / 60000} min - executing ${cmd.type} anyway`);
          resolve();
        }, IDLE_WAIT_MAX_MS))
      ]);
    }

    try {
      // Restart/reboot handlers report 'done' themselves right before the
      // process goes away; they receive the reporter for that.
      const report = (status, result) => api.reportCommand(cmd.id, status, result).catch((e) => {
        this.log.warn('[COMMANDS] report failed:', e.message);
      });
      const result = await handler(report);
      if (cmd.type === 'reload_config') await report('done', result || null);
    } catch (e) {
      this.log.error(`[COMMANDS] ${cmd.type} failed:`, e.message);
      await api.reportCommand(cmd.id, 'failed', e.message).catch(() => {});
    }
  }
}

module.exports = CommandService;
