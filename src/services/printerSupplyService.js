/**
 * PrinterSupplyService — reads DNP printer media/supply levels (sheets remaining, capacity,
 * media type, serial, firmware, lifetime) for the dashboard.
 *
 * Runs the actual FFI in an ISOLATED child process (dnpSupplyReader.js, via Electron-as-node)
 * so a native fault in the DNP DLL can never crash the kiosk. Caches the last good read.
 *
 * IMPORTANT: only call read() when the printer is IDLE — DNP warns against status queries
 * while printing. The caller (printJobService) gates this on status === 'ready'.
 *
 * Requires cspstat-x64.dll, currently shipped with DNP Hot Folder Print
 * (C:\DNP\HotFolderPrint\DLL). Falls back to a bundled copy under resources/dnp if present.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const HFP_DLL_DIR = 'C:\\DNP\\HotFolderPrint\\DLL';

class PrinterSupplyService {
  constructor() {
    this.last = null;        // last successful supplies object
    this.lastReadAt = 0;
    this.reading = false;
  }

  // Where cspstat-x64.dll lives: prefer a bundled copy, else the HFP install.
  resolveDllDir() {
    try {
      const bundled = path.join(process.resourcesPath || '', 'dnp');
      if (process.resourcesPath && fs.existsSync(path.join(bundled, 'cspstat-x64.dll'))) return bundled;
    } catch (_) { /* ignore */ }
    return HFP_DLL_DIR;
  }

  available() {
    try { return fs.existsSync(path.join(this.resolveDllDir(), 'cspstat-x64.dll')); }
    catch (_) { return false; }
  }

  // Spawn the isolated reader and return the parsed supplies (or the last good value).
  async read(timeoutMs = 8000) {
    if (this.reading) return this.last;          // don't overlap reads
    if (!this.available()) return this.last;     // DLL not present
    this.reading = true;

    // In a packaged app the script lives inside app.asar but is unpacked (asarUnpack);
    // run the real on-disk file so the spawned node process and its native koffi require
    // resolve without asar involvement.
    let readerPath = path.join(__dirname, 'dnpSupplyReader.js');
    if (readerPath.includes('app.asar') && !readerPath.includes('app.asar.unpacked')) {
      readerPath = readerPath.replace('app.asar', 'app.asar.unpacked');
    }
    const dllDir = this.resolveDllDir();

    return new Promise((resolve) => {
      let out = '';
      let settled = false;
      const finish = (val) => { if (settled) return; settled = true; this.reading = false; resolve(val); };

      let child;
      try {
        child = spawn(process.execPath, [readerPath, dllDir], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          windowsHide: true,
        });
      } catch (e) {
        console.error('[SUPPLY] spawn failed:', e.message);
        return finish(this.last);
      }

      const timer = setTimeout(() => {
        try { child.kill(); } catch (_) {}
        console.warn('[SUPPLY] reader timed out');
        finish(this.last);
      }, timeoutMs);

      // On a transient failure (couldn't run/parse the reader) we keep the last good
      // value to avoid flicker. But a definitive "no printer" answer from the reader must
      // NOT be masked by the cache — otherwise the kiosk/portal keep showing a printer
      // that's actually unplugged.
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', (e) => { clearTimeout(timer); console.error('[SUPPLY] reader error:', e.message); finish(this.last); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        try {
          const j = JSON.parse((out || '').trim() || '{}');
          if (j && j.ok) {
            this.last = j;
            this.lastReadAt = Date.now();
            console.log(`[SUPPLY] sheets_remaining=${j.sheets_remaining}/${j.media_capacity} media=${j.media} serial=${j.serial}`);
            return finish(j);
          }
          if (j && j.ok === false) {
            // Reader ran and reported no printer (or a hard error) → authoritative.
            this.last = null;
            console.log('[SUPPLY] no printer connected:', j.error || 'unknown');
            return finish(j); // {ok:false, ...}
          }
          console.warn('[SUPPLY] could not interpret reader output (exit', code + ')');
        } catch (e) {
          console.warn('[SUPPLY] could not parse reader output:', (out || '').slice(0, 160));
        }
        finish(this.last); // transient: keep last
      });
    });
  }
}

module.exports = PrinterSupplyService;
