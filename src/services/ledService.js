// Booth LEDs through a WLED controller on USB (QuinLED An-Penta-Plus).
//
// The controller may sit on any USB port: every serial port is asked "v"
// and the one that answers "WLED ..." is used. While nothing is found the
// ports are scanned again every few seconds, so plugging it in (or moving it
// to another port) is picked up without a restart. The port is opened once
// and kept open: opening it resets the ESP32.
//
// The renderer reports the step of the guest flow (setPhase); the matching
// WLED state from ledPhases.js is written as one JSON line. No controller →
// everything is a no-op.

const { SerialPort } = require('serialport');
const { LED_PHASES } = require('./ledPhases');

const BAUD = 115200;
const BOOT_MS = 2500;   // ESP32 restarts when the port opens
const PROBE_MS = 1500;  // wait for the "WLED <version>" answer
const RESCAN_MS = 5000;
const RETRY_OTHER_MS = 60000; // a port that is not WLED is asked again after a minute
// USB-serial chips found on ESP32 boards: WCH CH340/CH9102, Silicon Labs
// CP210x, FTDI, Espressif native USB. Other ports are tried last.
const LIKELY_VENDORS = ['1a86', '10c4', '0403', '303a'];

class LedService {
  constructor({ log = console, portPath = null } = {}) {
    this.log = log;
    this.portPath = portPath; // fixed port (--led-port=COM7), else auto-detect
    this.port = null;
    this.version = null;
    this.phase = null;
    this.timer = null;
    this.scanning = false;
    this.stopped = false;
    this.rejected = new Map(); // path -> when it answered as something else
  }

  start() {
    this.stopped = false;
    this.scan();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.port && this.port.isOpen) this.port.close(() => {});
    this.port = null;
  }

  status() {
    return { connected: !!(this.port && this.port.isOpen), path: this.port ? this.port.path : null, version: this.version, phase: this.phase };
  }

  setPhase(phase) {
    if (!LED_PHASES[phase]) return;
    if (phase === this.phase) return;
    this.phase = phase;
    this.write(LED_PHASES[phase]);
  }

  write(state) {
    if (!this.port || !this.port.isOpen) return;
    this.port.write(JSON.stringify(state) + '\n', (err) => {
      if (err) this.log.warn('[LED] write failed:', err.message);
    });
  }

  schedule() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.scan(), RESCAN_MS);
  }

  async scan() {
    if (this.stopped || this.scanning || (this.port && this.port.isOpen)) return;
    this.scanning = true;
    try {
      let paths;
      if (this.portPath) {
        paths = [this.portPath];
      } else {
        const ports = await SerialPort.list();
        const usb = ports.filter((p) => p.vendorId);
        usb.sort((a, b) => Number(!LIKELY_VENDORS.includes(String(a.vendorId).toLowerCase()))
          - Number(!LIKELY_VENDORS.includes(String(b.vendorId).toLowerCase())));
        const now = Date.now();
        paths = usb.map((p) => p.path).filter((path) => !(now - (this.rejected.get(path) || 0) < RETRY_OTHER_MS));
      }
      for (const path of paths) {
        if (this.stopped) break;
        const found = await this.probe(path);
        if (found) {
          this.rejected.delete(path);
          this.attach(found.port, found.version);
          break;
        }
        this.rejected.set(path, Date.now());
      }
    } catch (e) {
      this.log.warn('[LED] scan failed:', e.message);
    } finally {
      this.scanning = false;
      if (!(this.port && this.port.isOpen)) this.schedule();
    }
  }

  // Open the port, let the controller boot, ask "v"; keep it open when it is WLED
  probe(path) {
    return new Promise((resolve) => {
      const port = new SerialPort({ path, baudRate: BAUD, autoOpen: false });
      let answer = '';
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        port.removeAllListeners('data');
        if (!result && port.isOpen) port.close(() => {});
        resolve(result);
      };
      port.on('error', () => finish(null));
      port.open((err) => {
        if (err) return finish(null);
        // Do not hold the ESP32 in reset / boot mode
        port.set({ dtr: false, rts: false }, () => {});
        setTimeout(() => {
          if (done) return;
          port.on('data', (d) => {
            answer += d.toString('latin1');
            const m = answer.match(/WLED\s+(\d+)/);
            if (m) finish({ port, version: m[1] });
          });
          port.flush(() => port.write('v'));
          setTimeout(() => finish(null), PROBE_MS);
        }, BOOT_MS);
      });
    });
  }

  attach(port, version) {
    this.port = port;
    this.version = version;
    this.log.log(`[LED] WLED ${version} on ${port.path}`);
    port.on('data', () => {}); // keep the stream flowing; answers are not needed
    port.on('close', () => {
      this.log.log(`[LED] ${port.path} closed (unplugged?), looking again`);
      if (this.port === port) this.port = null;
      this.schedule();
    });
    port.on('error', (e) => this.log.warn('[LED] port error:', e.message));
    // Show the current step right away
    const phase = this.phase || 'idle';
    this.phase = null;
    this.setPhase(phase);
  }
}

module.exports = LedService;
