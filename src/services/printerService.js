/**
 * Printer Service for DNP DP-QW410
 *
 * Handles print job management and printer status monitoring
 * Integrates with Windows printer via Electron's printing API
 */

const { BrowserWindow } = require('electron');
const sharp = require('sharp');
const PrinterSupplyService = require('./printerSupplyService');

// Paper size mapping: inch-based format to hundredths of inch (for System.Drawing.Printing)
// ACTUAL DNP DP-QW410 driver paper sizes available:
//   (4x3)=422x312, (4x4)=422x412, (4x4.5)=422x462, (4x6)=422x612
//   (4.5x3)=469x312, (4.5x4)=469x412, (4.5x4.5)=469x462, (4.5x6)=469x612, (4.5x8)=469x812
//
// Format names match backend API: "4x6", "4x4", "4x3", "2x6"
// Paper dimensions are in hundredths of inch (what gets sent to printer)
const PAPER_SIZES = {
  // Standard 4" wide formats (no rotation needed)
  '4x6': { width: 422, height: 612, name: '(4x6)', rotate: false },
  '4x4': { width: 422, height: 412, name: '(4x4)', rotate: false },
  '4x3': { width: 422, height: 312, name: '(4x3)', rotate: false },

  // Landscape variants (rotate 90° to fit on 4" wide paper)
  '6x4': { width: 422, height: 612, name: '(4x6)', rotate: true },
  '3x4': { width: 422, height: 312, name: '(4x3)', rotate: true },

  // Strip formats (2x6 duplicated side-by-side on 4x6 paper)
  '2x6': { width: 422, height: 612, name: '(4x6)', rotate: false, strip: true },
  '6x2': { width: 422, height: 612, name: '(4x6)', rotate: true, strip: true },
};

// How many consecutive heartbeats must report "no printer" AND find no present DNP USB
// device before we declare the printer offline. Guards against transient cspstat comms
// failures (mid-print / dye-sub cooling) that briefly return "no printer" while the
// device is still on the USB bus — those must NOT hide the hold-to-print button.
const OFFLINE_CONFIRM_READS = 2;

// Persistent PowerShell print worker. Spawning a fresh powershell.exe per print costs
// 20-30s+ on the kiosk NUCs (cold start + Add-Type System.Drawing JIT + DNP driver
// paper-size enumeration) — long enough that real prints hit the old 30s exec timeout
// and were killed mid-spool ("Print job failed" with nothing printed). This worker is
// spawned once (warmed during boot), keeps System.Drawing loaded, and prints each
// request it receives as a JSON line on stdin, answering with a sentinel line.
const PRINT_WORKER_PS1 = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
[Console]::Out.WriteLine('__WORKER_READY__')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $script:img = $null
  try {
    $req = $line | ConvertFrom-Json
    $script:img = [System.Drawing.Image]::FromFile($req.imagePath)
    if ($req.rotate) { $script:img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
    $pd = New-Object System.Drawing.Printing.PrintDocument
    $pd.PrinterSettings.PrinterName = $req.printer
    $bestMatch = $null
    $bestDiff = [int]::MaxValue
    foreach ($size in $pd.PrinterSettings.PaperSizes) {
      $diff = [Math]::Abs($size.Width - $req.paperWidth) + [Math]::Abs($size.Height - $req.paperHeight)
      if ($diff -lt $bestDiff) { $bestDiff = $diff; $bestMatch = $size }
    }
    if ($bestMatch -and $bestDiff -lt 50) {
      $pd.DefaultPageSettings.PaperSize = $bestMatch
      [Console]::Out.WriteLine('# matched paper ' + $bestMatch.PaperName + ' (' + $bestMatch.Width + 'x' + $bestMatch.Height + ') diff=' + $bestDiff)
    } else {
      [Console]::Out.WriteLine('# no close paper match (best diff=' + $bestDiff + ') - using printer default')
    }
    $pd.DefaultPageSettings.Landscape = [bool]$req.landscape
    $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
    $pd.add_PrintPage({
      param($sender, $ev)
      $bounds = $ev.MarginBounds
      $targetRatio = $bounds.Width / $bounds.Height
      $sourceRatio = $script:img.Width / $script:img.Height
      if ($sourceRatio -gt $targetRatio) {
        $newWidth = [int]($script:img.Height * $targetRatio)
        $cropX = [int](($script:img.Width - $newWidth) / 2)
        $srcRect = New-Object System.Drawing.Rectangle($cropX, 0, $newWidth, $script:img.Height)
      } else {
        $newHeight = [int]($script:img.Width / $targetRatio)
        $cropY = [int](($script:img.Height - $newHeight) / 2)
        $srcRect = New-Object System.Drawing.Rectangle(0, $cropY, $script:img.Width, $newHeight)
      }
      $destRect = New-Object System.Drawing.Rectangle(0, 0, $bounds.Width, $bounds.Height)
      $ev.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $ev.Graphics.DrawImage($script:img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
      $ev.HasMorePages = $false
    })
    $pd.Print()
    $pd.Dispose()
    [Console]::Out.WriteLine('__PRINT_OK__')
  } catch {
    [Console]::Out.WriteLine('__PRINT_ERR__ ' + ($_.ToString() -replace '[\\r\\n]+', ' '))
  } finally {
    if ($script:img) { $script:img.Dispose(); $script:img = $null }
  }
}
`;

class PrinterService {
  constructor() {
    // printerName = the live Windows print queue, resolved by detect() (no longer a
    // hardcoded name). currentSerial = the printer (by serial) we resolved it for.
    this.printerName = null;
    this.currentSerial = null;
    this.isAvailable = false;
    this.lastStatus = 'unknown';
    this.statusCallback = null;
    this.supply = new PrinterSupplyService(); // cspstat reader: which DNP printer + health
    this._wasAvailable = false;               // for "printer went missing" diagnostics
    this._offlineMisses = 0;                  // consecutive corroborated "no printer" reads
    this._lastDetectAt = 0;                   // when detect() last ran fully (skip pre-print re-detect when fresh)
    this._printInFlight = false;              // true from the very first ms of print() — gates cspstat reads
    this.printWorker = null;                  // persistent PowerShell print worker (see PRINT_WORKER_PS1)
    this._workerStarting = null;              // in-flight worker spawn promise
    this._printQueue = Promise.resolve();     // serializes prints through the single worker
    this.deviceWatcher = null;                // PowerShell WMI watcher: USB arrival/removal → immediate detect()
    this._deviceChangeTimer = null;           // debounce for bursts of device-change events
    this._deviceFollowUpTimer = null;         // second detect after an arrival (queue comes up later than the device)
    this._watcherRestarts = 0;
    this._destroyed = false;
  }

  /**
   * Initialize printer service and detect the connected DNP printer.
   */
  async initialize() {
    console.log('[PRINTER] ===== INITIALIZING PRINTER SERVICE =====');
    try {
      await this.detect();
      // Warm the persistent print worker during boot so the first guest print doesn't
      // pay PowerShell cold-start (measured 20-30s on kiosk NUCs).
      this.ensurePrintWorker().catch(e => console.warn('[PRINTER] print worker warm-up failed:', e.message));
      // React to USB plug/unplug within seconds instead of waiting for the 25 s heartbeat.
      this.startDeviceWatcher();
      console.log('[PRINTER] Initialization complete. Available:', this.isAvailable, 'queue:', this.printerName);
      return this.isAvailable;
    } catch (error) {
      console.error('[PRINTER] ❌ Initialization error:', error);
      this.isAvailable = false;
      this.lastStatus = 'error';
      this.notifyStatusChange();
      return false;
    }
  }

  /**
   * Detect the connected DNP printer and the Windows queue to print to.
   *
   * Primary: cspstat (the DNP SDK) reports the physically-connected printer — its
   * serial + health — independent of Windows queue names. We map that serial to the
   * live Windows print queue via the USB device, so duplicate "(Copy)/(Kopie)" queues
   * never cause us to pick a disconnected printer.
   *
   * Fallback (no cspstat / HFP not installed): pick a DNP-model queue whose USB device
   * is present and that isn't marked offline.
   *
   * @param {object} [supplies] - a cspstat read already done by the caller (avoids a
   *   second USB query on the status heartbeat). Omit to read here.
   */
  async detect(supplies) {
    if (this.lastStatus === 'printing') return this.isAvailable; // never probe mid-print

    if (supplies === undefined) {
      supplies = this.supply.available() ? await this.supply.read() : null;
    }

    if (supplies && supplies.ok) {
      // cspstat sees a connected DNP printer → resolve its live queue by serial.
      if (supplies.serial && supplies.serial !== this.currentSerial) {
        const q = await this.resolveQueueBySerial(supplies.serial);
        if (q) {
          this.printerName = q;
          this.currentSerial = supplies.serial;
        } else {
          // A different printer is connected but its Windows queue isn't ready yet.
          // Drop the old queue so we never print to a disconnected printer; the safety
          // net below (present-USB-port match) or a retry will catch the new one.
          this.printerName = null;
        }
        console.log(`[PRINTER] cspstat serial ${supplies.serial} → queue ${q || '(not ready yet)'}`);
      }
      if (!this.printerName) this.printerName = await this.findDnpQueue(); // present-port fallback
      this.isAvailable = !supplies.error && !!this.printerName;
      this.lastStatus = this.mapState(supplies.state);
      if (this.isAvailable) this._offlineMisses = 0; // healthy read clears the miss streak
    } else if (supplies) {
      // cspstat ran but reports no printer. Under USB contention (mid-print / dye-sub
      // cooling) the DNP status tool transiently returns "no printer" while the device is
      // still on the bus — the logs show exactly this (a `reader timed out` → `no_printer`,
      // yet the [DIAG] dump has the device Present=True). Treating that as offline hid the
      // hold-to-print button.
      //
      // So make the decision presence-authoritative via the OS. probeDnpPresence()
      // distinguishes three cases so we never show a phantom button AND never hide a
      // present one on a transient cspstat glitch:
      //   present USB queue → transient cspstat comms failure → stay online
      //   confirmed absent  → really unplugged → offline NOW (no phantom button)
      //   probe failed      → unknown → debounce (hold previous state up to N reads)
      const probe = await this.probeDnpPresence();
      if (probe.queue) {
        this.printerName = probe.queue;
        this.isAvailable = true;
        this.lastStatus = 'ready';
        this._offlineMisses = 0;
        console.log(`[PRINTER] cspstat saw no printer, but USB queue "${probe.queue}" is present → transient comms failure, staying online`);
      } else if (probe.queried) {
        // OS confirms no present DNP USB device → genuinely disconnected. Go offline
        // immediately so the button is never shown while unplugged.
        this.printerName = null;
        this.currentSerial = null;
        this.isAvailable = false;
        this.lastStatus = 'offline';
        this._offlineMisses = 0;
        console.log('[PRINTER] cspstat + OS both report no printer present → offline');
      } else {
        // The USB presence query itself failed — ambiguous. Debounce: hold the previous
        // state for a few reads rather than flip on a double query failure.
        this._offlineMisses += 1;
        if (this._offlineMisses >= OFFLINE_CONFIRM_READS) {
          this.printerName = null;
          this.currentSerial = null;
          this.isAvailable = false;
          this.lastStatus = 'offline';
          console.log(`[PRINTER] cspstat no printer + USB probe failed ${this._offlineMisses}x → offline`);
        } else {
          console.log(`[PRINTER] cspstat no printer + USB probe failed — miss ${this._offlineMisses}/${OFFLINE_CONFIRM_READS}, holding previous state (available=${this.isAvailable})`);
        }
      }
    } else {
      // No cspstat available (DLL not installed) — fall back to Windows enumeration
      // (model pattern + present USB device). Returns null if nothing is connected.
      const q = await this.findDnpQueue();
      this.printerName = q;
      this.currentSerial = null;
      this.isAvailable = !!q;
      this.lastStatus = q ? 'ready' : 'offline';
      if (this.isAvailable) this._offlineMisses = 0;
      console.log(`[PRINTER] Windows fallback → queue ${q || '(none found)'}`);
    }

    // When the printer JUST went missing, capture the USB/queue state so the cause of
    // the next disappearance is in the log (USB drop vs printer asleep vs driver fault).
    if (this._wasAvailable && !this.isAvailable) {
      this.logUsbDiagnostics().catch(() => {});
    }
    this._wasAvailable = this.isAvailable;
    this._lastDetectAt = Date.now();

    this.notifyStatusChange();
    return this.isAvailable;
  }

  /**
   * Log the current USB device + printer-queue state. Called when the printer goes
   * missing so the next occurrence reveals WHY:
   *  - device Present=false  → USB/port dropped (e.g. selective suspend, cable)
   *  - device Present=true but cspstat saw no printer → printer asleep / not responding
   *  - error Status          → driver/USB fault
   */
  async logUsbDiagnostics() {
    try {
      const out = await this.runPowerShell(
        `Write-Output 'USB DNP devices:'\n` +
        `Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match 'VID_1452|QW410|Dai.?Nippon|DNP' } | ForEach-Object { '  Present=' + $_.Present + ' Status=' + $_.Status + ' Class=' + $_.Class + ' Id=' + $_.InstanceId }\n` +
        `Write-Output 'Printer queues:'\n` +
        `Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'QW410|DNP' } | ForEach-Object { '  Name=' + $_.Name + ' Port=' + $_.PortName + ' Offline=' + $_.WorkOffline + ' Status=' + $_.PrinterStatus }`
      );
      console.log('[PRINTER][DIAG] printer went missing — USB/queue state:\n' + (out || '').trim());
    } catch (e) {
      console.warn('[PRINTER][DIAG] diagnostics failed:', e.message);
    }
  }

  /**
   * Re-run detection from a cspstat read the caller already has (status heartbeat).
   * Picks up a hot-swapped printer without a restart, with no extra USB query.
   */
  async refreshFromSupplies(supplies) {
    return this.detect(supplies);
  }

  // Map a cspstat hardware state to the kiosk's coarse printer status.
  mapState(state) {
    if (state === 'printing') return 'printing';
    if (state === 'idle' || state === 'standstill' || state === 'cooling' || state === 'busy') return 'ready';
    return 'offline'; // paper_out, ribbon_out, paper_jam, cover_open, errors, offline, unknown
  }

  /**
   * Map a printer serial (from cspstat) to its live Windows print queue:
   * present USB printer device whose parent USB serial matches → its port → the queue.
   * Returns the queue name, or null if it can't be resolved.
   */
  async resolveQueueBySerial(serial) {
    const s = String(serial || '').replace(/[^A-Za-z0-9]/g, '');
    if (!s) return null;
    try {
      const out = await this.runPowerShell(
        `$serial = '${s}'\n` +
        `$queues = Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue\n` +
        `$found = $null\n` +
        `foreach ($up in (Get-PnpDevice -PresentOnly -Class Printer -ErrorAction SilentlyContinue)) {\n` +
        `  $pm = [regex]::Match($up.InstanceId, 'USB\\d+')\n` +
        `  if (-not $pm.Success) { continue }\n` +
        `  $port = $pm.Value\n` +
        `  $parent = (Get-PnpDeviceProperty -InstanceId $up.InstanceId -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue).Data\n` +
        `  if ($parent -and $parent -match [regex]::Escape($serial)) {\n` +
        `    $q = $queues | Where-Object { $_.PortName -eq $port } | Select-Object -First 1\n` +
        `    if ($q) { $found = $q.Name }\n` +
        `  }\n` +
        `}\n` +
        `Write-Output $found`
      );
      const name = (out || '').trim();
      return name || null;
    } catch (e) {
      console.error('[PRINTER] resolveQueueBySerial error:', e.message);
      return null;
    }
  }

  /**
   * Fallback (only used when cspstat/HFP isn't installed): find a DNP-model Windows
   * queue whose USB device is actually PRESENT. Returns null if nothing is connected,
   * so we never show a phantom printer for a stale/offline queue.
   */
  async findDnpQueue() {
    try {
      const out = await this.runPowerShell(
        `$pats = 'QW410|DS-?RX1|DS-?40|DS-?80|DS-?620|DS-?820|DS80DX|DNP|Dai.?Nippon'\n` +
        `$cands = @(Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $pats -or $_.DriverName -match $pats })\n` +
        `$ports = @()\n` +
        `foreach ($d in (Get-PnpDevice -PresentOnly -Class Printer -ErrorAction SilentlyContinue)) { $m = [regex]::Match($d.InstanceId, 'USB\\d+'); if ($m.Success) { $ports += $m.Value } }\n` +
        `# Only a queue whose USB device is present counts as connected.\n` +
        `$pick = $cands | Where-Object { $ports -contains $_.PortName -and -not $_.WorkOffline } | Select-Object -First 1\n` +
        `if (-not $pick) { $pick = $cands | Where-Object { $ports -contains $_.PortName } | Select-Object -First 1 }\n` +
        `if ($pick) { Write-Output $pick.Name }`
      );
      const name = (out || '').trim();
      return name || null;
    } catch (e) {
      console.error('[PRINTER] findDnpQueue error:', e.message);
      return null;
    }
  }

  /**
   * Like findDnpQueue(), but distinguishes "queried successfully, no present printer"
   * from "the query itself failed". Lets detect() flip offline immediately when the USB
   * device is CONFIRMED absent (no phantom button), while only debouncing when the
   * PnP/WMI query couldn't run. Returns one of:
   *   { queue: '<name>', queried: true } → a present DNP USB queue exists (printer there)
   *   { queue: null,     queried: true } → query ran, no present DNP device (really absent)
   *   { queue: null,     queried: false} → query failed (unknown — caller should debounce)
   */
  async probeDnpPresence() {
    try {
      const out = await this.runPowerShell(
        `$pats = 'QW410|DS-?RX1|DS-?40|DS-?80|DS-?620|DS-?820|DS80DX|DNP|Dai.?Nippon'\n` +
        `$cands = @(Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $pats -or $_.DriverName -match $pats })\n` +
        `$ports = @()\n` +
        `foreach ($d in (Get-PnpDevice -PresentOnly -Class Printer -ErrorAction SilentlyContinue)) { $m = [regex]::Match($d.InstanceId, 'USB\\d+'); if ($m.Success) { $ports += $m.Value } }\n` +
        `$pick = $cands | Where-Object { $ports -contains $_.PortName -and -not $_.WorkOffline } | Select-Object -First 1\n` +
        `if (-not $pick) { $pick = $cands | Where-Object { $ports -contains $_.PortName } | Select-Object -First 1 }\n` +
        `if ($pick) { Write-Output $pick.Name }\n` +
        `Write-Output '__PROBE_DONE__'`
      );
      const lines = (out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.includes('__PROBE_DONE__')) return { queue: null, queried: false };
      const name = lines.find(l => l !== '__PROBE_DONE__') || null;
      return { queue: name, queried: true };
    } catch (e) {
      console.error('[PRINTER] probeDnpPresence error:', e.message);
      return { queue: null, queried: false };
    }
  }

  /**
   * Check if printer is physically connected using PowerShell
   * Performs two-tier verification:
   * 1. Check printer queue status (Get-Printer)
   * 2. Verify USB device presence (Get-PnpDevice)
   *
   * @returns {Promise<Object>} Connection status with details
   */
  /**
   * Run a PowerShell script using -EncodedCommand to avoid shell expansion issues.
   * Electron's exec() can inherit bash as shell on Windows (via Git Bash),
   * which strips $variable references from both inline commands and script files.
   */
  async runPowerShell(script, timeoutMs = 30000) {
    const { execFile } = require('child_process');

    // Encode the script as UTF-16LE base64 for PowerShell's -EncodedCommand
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    // -WindowStyle Hidden + windowsHide:true prevent a PowerShell console window from
    // flashing in front of the fullscreen kiosk on every status/detect call (25s heartbeat).
    // Get-CimInstance Win32_Printer + Get-PnpDevice take 4-5 s idle on the kiosk NUCs and
    // well over 10 s while the machine is busy (4K camera, a print, an update download);
    // the old 10 s timeout made the USB probe "fail" and flip the printer offline under load.
    return new Promise((resolve, reject) => {
      execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            const why = error.killed || error.signal === 'SIGTERM'
              ? `timed out after ${timeoutMs}ms`
              : `exit ${error.code}${stderr && !String(stderr).startsWith('#< CLIXML') ? `: ${String(stderr).trim().slice(0, 300)}` : ''}`;
            reject(new Error(`PowerShell ${why}`));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }

  /**
   * Ensure the persistent print worker is running and READY. Reuses the live worker,
   * joins an in-flight spawn, or starts a new one. Resolves to the worker handle.
   */
  ensurePrintWorker() {
    if (this.printWorker && this.printWorker.ready) return Promise.resolve(this.printWorker);
    if (this._workerStarting) return this._workerStarting;
    this._workerStarting = this.spawnPrintWorker();
    this._workerStarting.finally(() => { this._workerStarting = null; }).catch(() => {});
    return this._workerStarting;
  }

  /**
   * Spawn the persistent PowerShell print worker and wait for its READY handshake.
   * The worker script is (re)written to temp on every spawn; it contains no guest data.
   */
  spawnPrintWorker() {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const { spawn } = require('child_process');

    return new Promise((resolve, reject) => {
      const workerPath = path.join(os.tmpdir(), 'poembooth-print-worker.ps1');
      try {
        fs.writeFileSync(workerPath, PRINT_WORKER_PS1, 'utf8');
      } catch (e) {
        return reject(new Error('cannot write print worker script: ' + e.message));
      }

      console.log('[PRINTER] Spawning persistent print worker...');
      let child;
      try {
        child = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', workerPath], { windowsHide: true });
      } catch (e) {
        return reject(new Error('cannot spawn print worker: ' + e.message));
      }

      const worker = { child, ready: false, pending: null, buf: '' };
      // Cold start can be very slow on kiosk NUCs (Defender + module prep) — be generous.
      const readyTimer = setTimeout(() => {
        try { child.kill(); } catch (_) {}
        reject(new Error('print worker did not become ready within 60s'));
      }, 60000);

      const onLine = (line) => {
        if (line === '__WORKER_READY__') {
          worker.ready = true;
          this.printWorker = worker;
          clearTimeout(readyTimer);
          console.log('[PRINTER] ✅ Print worker ready (System.Drawing pre-loaded)');
          resolve(worker);
        } else if (line.startsWith('__PRINT_OK__') || line.startsWith('__PRINT_ERR__')) {
          if (worker.pending) worker.pending(line);
        } else if (line) {
          console.log('[PRINTER][WORKER]', line);
        }
      };

      child.stdout.on('data', (d) => {
        worker.buf += d.toString();
        let idx;
        while ((idx = worker.buf.indexOf('\n')) !== -1) {
          const line = worker.buf.slice(0, idx).replace(/\r$/, '').trim();
          worker.buf = worker.buf.slice(idx + 1);
          onLine(line);
        }
      });
      child.stderr.on('data', (d) => {
        const t = d.toString().trim();
        if (t) console.warn('[PRINTER][WORKER][stderr]', t.slice(0, 500));
      });
      child.on('error', (err) => {
        clearTimeout(readyTimer);
        if (this.printWorker === worker) this.printWorker = null;
        if (worker.pending) worker.pending('__PRINT_ERR__ worker process error: ' + err.message);
        if (!worker.ready) reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(readyTimer);
        if (this.printWorker === worker) this.printWorker = null;
        if (worker.pending) worker.pending('__PRINT_ERR__ worker exited (code ' + code + ')');
        if (!worker.ready) reject(new Error('print worker exited before ready (code ' + code + ')'));
        else console.warn('[PRINTER] Print worker exited (code ' + code + ') — will respawn on next print');
      });
    });
  }

  /**
   * Print one request through the persistent worker. Serialized (one print at a time),
   * with a hard timeout as safety net. Throws on failure so the caller can fall back.
   */
  printViaWorker(request, timeoutMs = 90000) {
    const run = async () => {
      const worker = await this.ensurePrintWorker();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.pending = null;
          // A stuck worker can't be trusted for the next job — kill it; it respawns lazily.
          try { worker.child.kill(); } catch (_) {}
          reject(new Error(`print worker timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        worker.pending = (line) => {
          clearTimeout(timer);
          worker.pending = null;
          if (line.startsWith('__PRINT_OK__')) resolve(true);
          else reject(new Error(line.replace('__PRINT_ERR__', '').trim() || 'print failed'));
        };
        worker.child.stdin.write(JSON.stringify(request) + '\n', (err) => {
          if (err) {
            clearTimeout(timer);
            worker.pending = null;
            reject(err);
          }
        });
      });
    };
    const p = this._printQueue.then(run, run);
    this._printQueue = p.catch(() => {});
    return p;
  }

  async checkPrinterPhysicalConnection() {
    try {
      console.log('[PRINTER] Checking physical connection via PowerShell...');

      // Step 1: Check printer queue status
      const printerOutput = await this.runPowerShell(
        `$printer = Get-Printer -Name '${this.printerName}' -ErrorAction SilentlyContinue\n` +
        `if ($printer) {\n` +
        `  [PSCustomObject]@{\n` +
        `    Name = $printer.Name\n` +
        `    PrinterStatus = [int]$printer.PrinterStatus\n` +
        `    WorkOffline = $printer.WorkOffline\n` +
        `    Type = $printer.Type\n` +
        `  } | ConvertTo-Json\n` +
        `} else {\n` +
        `  '{"Error":"NotFound"}'\n` +
        `}`
      );
      const printerInfo = JSON.parse(printerOutput.trim());

      if (printerInfo.Error === 'NotFound') {
        console.log('[PRINTER] ❌ Printer driver not found via Get-Printer');
        return { connected: false, reason: 'driver_not_found' };
      }

      console.log('[PRINTER] Printer queue info:', {
        status: printerInfo.PrinterStatus,
        offline: printerInfo.WorkOffline,
        type: printerInfo.Type
      });

      // PrinterStatus values vary by driver:
      //   - Microsoft standard: 3 = Idle/Normal
      //   - Some OEM drivers (like DNP DP-QW410): 0 = Normal/Ready
      // WorkOffline: null or false means NOT in offline mode
      const isNotOffline = printerInfo.WorkOffline === false || printerInfo.WorkOffline === null;
      const hasValidStatus = printerInfo.PrinterStatus === 0 || printerInfo.PrinterStatus === 3;

      if (hasValidStatus && isNotOffline) {
        console.log('[PRINTER] ✅ Printer queue status: Normal and Online');

        // Step 2: Verify USB device is physically present
        const usbOutput = await this.runPowerShell(
          `$devices = @(Get-PnpDevice -FriendlyName '*QW410*' -Status OK -ErrorAction SilentlyContinue)\n` +
          `Write-Output $devices.Count`
        );
        const deviceCount = parseInt(usbOutput.trim(), 10);

        if (deviceCount > 0) {
          console.log('[PRINTER] ✅ USB device physically connected (found', deviceCount, 'OK devices)');
          return {
            connected: true,
            printerStatus: printerInfo.PrinterStatus,
            usbPresent: true,
            deviceCount: deviceCount
          };
        } else {
          console.log('[PRINTER] ⚠️ Printer queue exists but USB device not detected');
          return {
            connected: false,
            reason: 'usb_not_detected',
            printerStatus: printerInfo.PrinterStatus
          };
        }
      } else {
        console.log('[PRINTER] ⚠️ Printer offline or error state');
        return {
          connected: false,
          reason: 'printer_offline',
          printerStatus: printerInfo.PrinterStatus,
          workOffline: printerInfo.WorkOffline
        };
      }

    } catch (error) {
      console.error('[PRINTER] ❌ Error checking physical connection:', error.message);
      return { connected: false, reason: 'check_failed', error: error.message };
    }
  }

  /**
   * Get list of available printers
   */
  async getAvailablePrinters() {
    try {
      // Get main window to access webContents
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 0) {
        throw new Error('No browser windows available');
      }

      const mainWindow = windows[0];

      // Use getPrintersAsync() which is the correct Electron API
      return new Promise((resolve, reject) => {
        mainWindow.webContents.getPrintersAsync().then((printers) => {
          resolve(printers);
        }).catch((error) => {
          console.error('[PRINTER] getPrintersAsync error:', error);
          // Fallback: assume printer exists if we can't enumerate
          // Check with PowerShell or just return empty array
          resolve([]);
        });
      });
    } catch (error) {
      console.error('[PRINTER] Error getting printers:', error);
      return [];
    }
  }

  /**
   * Print image buffer to DNP printer
   *
   * @param {Buffer} imageBuffer - High-resolution image buffer (PNG or JPEG)
   * @param {Object} options - Print options
   * @param {string} options.printFormat - Paper size (e.g., '10x15cm', '10x10cm')
   * @param {string} options.printOrientation - 'portrait' or 'landscape'
   * @returns {Promise<boolean>} - Success status
   */
  async print(imageBuffer, options = {}) {
    this._printInFlight = true;
    // Stop any in-flight cspstat read NOW: the DNP status tool and the print job
    // contend for the printer's USB channel — a concurrent read stalls the print
    // (observed: paper-size enumeration taking 19s and the reader timing out).
    try { this.supply.abort(); } catch (_) {}
    try {
      return await this.doPrint(imageBuffer, options);
    } finally {
      this._printInFlight = false;
    }
  }

  /** True while a print() call is executing (from its first ms, not only once the
   *  status flips to "printing"). Used to gate cspstat/supply reads. */
  isPrinting() {
    return this._printInFlight || this.lastStatus === 'printing';
  }

  async doPrint(imageBuffer, options = {}) {
    const printFormat = options.printFormat || '4x6';
    const printOrientation = options.printOrientation || 'portrait';

    // Re-bind to the currently-connected printer right before printing, so a printer
    // swapped mid-session is picked up immediately (not only on the heartbeat).
    // After a physical swap the OS needs a few seconds to enumerate the new printer and
    // create its queue, so retry briefly — a quick reprint then waits for the new printer
    // instead of going to the old (disconnected) one.
    //
    // But only pay for this when needed: detect() costs a cspstat read + PowerShell
    // round-trips (~7s measured), and the 25s status heartbeat already keeps the state
    // fresh. When we have a usable printer and a recent detect, print immediately.
    const detectAge = Date.now() - this._lastDetectAt;
    if (!this.isAvailable || !this.printerName || detectAge > 60000) {
      try {
        await this.detect();
        for (let tries = 0; !this.isAvailable && tries < 4; tries++) {
          console.log('[PRINTER] printer not ready yet — waiting for it to settle...');
          await new Promise(r => setTimeout(r, 1500));
          await this.detect();
        }
      } catch (e) { console.warn('[PRINTER] pre-print detect failed:', e.message); }
    }

    console.log('[PRINTER] ===== PRINT JOB STARTING =====');
    console.log('[PRINTER] Image buffer size:', imageBuffer.length, 'bytes');
    console.log('[PRINTER] Print format:', printFormat);
    console.log('[PRINTER] Print orientation:', printOrientation);
    console.log('[PRINTER] Printer available:', this.isAvailable);
    console.log('[PRINTER] Printer status:', this.lastStatus);
    console.log('[PRINTER] Printer name:', this.printerName);

    // Get paper dimensions from mapping
    const paperSize = PAPER_SIZES[printFormat] || PAPER_SIZES['4x6'];
    console.log('[PRINTER] Paper dimensions:', paperSize);

    if (!this.isAvailable) {
      console.error('[PRINTER] ❌ Printer not available - aborting print');
      this.lastStatus = 'offline';
      this.notifyStatusChange();
      throw new Error('Printer not available');
    }

    try {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Get image dimensions to determine orientation for smart rotation
      const metadata = await sharp(imageBuffer).metadata();
      const imageWidth = metadata.width;
      const imageHeight = metadata.height;
      const isImagePortrait = imageHeight > imageWidth;
      console.log(`[PRINTER] Image dimensions: ${imageWidth}x${imageHeight} (${isImagePortrait ? 'portrait' : 'landscape'})`);

      // Determine paper orientation from PAPER_SIZES dimensions
      const isPaperPortrait = paperSize.height > paperSize.width;
      console.log(`[PRINTER] Paper orientation: ${isPaperPortrait ? 'portrait' : 'landscape'}`);

      // Rotation logic:
      // 1. If printOrientation is 'landscape', always rotate 90° (content designed for landscape viewing)
      // 2. Otherwise, use smart rotation based on image vs paper shape mismatch
      const landscapeRequested = printOrientation === 'landscape';
      const shapeMismatch = isImagePortrait !== isPaperPortrait;
      const needsRotation = landscapeRequested || shapeMismatch;
      console.log(`[PRINTER] Landscape requested: ${landscapeRequested}`);
      console.log(`[PRINTER] Shape mismatch: ${shapeMismatch} (image ${isImagePortrait ? 'portrait' : 'landscape'} vs paper ${isPaperPortrait ? 'portrait' : 'landscape'})`);
      console.log(`[PRINTER] Rotation needed: ${needsRotation}`);

      // Handle 2x6 strip duplication (creates 4x6 layout with two strips side-by-side)
      let printBuffer = imageBuffer;
      if (paperSize.strip) {
        console.log('[PRINTER] Strip format detected - creating 2x6 duplicate layout');
        printBuffer = await this.createStripLayout(imageBuffer, needsRotation);
      }

      // Save image to temporary file
      const tempDir = os.tmpdir();
      const tempFileName = `poembooth-print-${Date.now()}.jpg`;
      const tempFilePath = path.join(tempDir, tempFileName);

      console.log('[PRINTER] Saving image to temp file:', tempFilePath);
      fs.writeFileSync(tempFilePath, printBuffer);
      console.log('[PRINTER] ✓ Image saved to temp file');

      // Update status
      this.lastStatus = 'printing';
      this.notifyStatusChange();
      console.log('[PRINTER] Status set to "printing"');

      // Print using PowerShell - save script to file to avoid escaping issues
      const printerNameEscaped = this.printerName.replace(/'/g, "''");
      const tempFilePathEscaped = tempFilePath.replace(/'/g, "''");
      const isLandscape = printOrientation === 'landscape';
      const targetWidth = paperSize.width;
      const targetHeight = paperSize.height;
      // needsRotation is now computed above via smart auto-detection (line 328)

      // PowerShell script to print with dynamic paper size and aspect-ratio cropping
      const psScript =
`try {
  Add-Type -AssemblyName System.Drawing
  Write-Host "Assemblies loaded"

  \$img = [System.Drawing.Image]::FromFile('${tempFilePathEscaped}')
  Write-Host "Image loaded: \$(\$img.Width)x\$(\$img.Height)"

  # Auto-rotate logic based on smart orientation detection
  # Compares actual image orientation (portrait vs landscape) to paper orientation
  # Only rotates when orientations don't match, regardless of format name

  \$needsRotation = \$${needsRotation}  # Determined by smart auto-detection (image vs paper orientation)

  Write-Host "Print format: ${printFormat}"
  Write-Host "Target paper: ${targetWidth}x${targetHeight} hundredths (${paperSize.name})"
  Write-Host "Image dimensions: \$(\$img.Width)x\$(\$img.Height)"
  Write-Host "Needs rotation: \$needsRotation"

  if (\$needsRotation) {
    \$img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
    Write-Host "AUTO-ROTATED 90 degrees to match paper orientation"
    Write-Host "New dimensions: \$(\$img.Width)x\$(\$img.Height)"
  } else {
    Write-Host "No rotation needed - image orientation matches paper"
  }

  \$pd = New-Object System.Drawing.Printing.PrintDocument
  \$pd.PrinterSettings.PrinterName = '${printerNameEscaped}'
  Write-Host "Printer set: ${printerNameEscaped}"

  # Target paper size: ${printFormat} (${targetWidth}x${targetHeight} hundredths of inch)
  \$targetPaperWidth = ${targetWidth}
  \$targetPaperHeight = ${targetHeight}
  Write-Host "Target paper size: \$targetPaperWidth x \$targetPaperHeight hundredths"

  # List available paper sizes and find best match
  Write-Host "Available paper sizes:"
  \$bestMatch = \$null
  \$bestDiff = [int]::MaxValue
  foreach (\$size in \$pd.PrinterSettings.PaperSizes) {
    Write-Host "  - \$(\$size.PaperName): \$(\$size.Width)x\$(\$size.Height)"
    # Calculate difference from target
    \$diff = [Math]::Abs(\$size.Width - \$targetPaperWidth) + [Math]::Abs(\$size.Height - \$targetPaperHeight)
    if (\$diff -lt \$bestDiff) {
      \$bestDiff = \$diff
      \$bestMatch = \$size
    }
  }

  if (\$bestMatch -and \$bestDiff -lt 50) {
    \$pd.DefaultPageSettings.PaperSize = \$bestMatch
    Write-Host "MATCHED paper: \$(\$bestMatch.PaperName) (\$(\$bestMatch.Width)x\$(\$bestMatch.Height)) diff=\$bestDiff"
  } else {
    Write-Host "No close paper match found (best diff=\$bestDiff) - using printer default"
  }

  # Set orientation
  \$pd.DefaultPageSettings.Landscape = \$${isLandscape ? 'true' : 'false'}
  Write-Host "Orientation: ${printOrientation}"

  # Zero margins for full bleed
  \$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)

  \$pd.Add_PrintPage({
    param(\$sender, \$ev)
    \$bounds = \$ev.MarginBounds
    Write-Host "Print bounds: \$(\$bounds.Width)x\$(\$bounds.Height)"

    # Calculate target aspect ratio from paper
    \$targetRatio = \$bounds.Width / \$bounds.Height
    Write-Host "Target aspect ratio: \$targetRatio"

    # Calculate source aspect ratio
    \$sourceRatio = \$img.Width / \$img.Height
    Write-Host "Source aspect ratio: \$sourceRatio"

    # Calculate crop rectangle to match target aspect ratio (center crop)
    if (\$sourceRatio -gt \$targetRatio) {
      # Source is wider than target - crop horizontally
      \$newWidth = [int](\$img.Height * \$targetRatio)
      \$cropX = [int]((\$img.Width - \$newWidth) / 2)
      \$srcRect = New-Object System.Drawing.Rectangle(\$cropX, 0, \$newWidth, \$img.Height)
      Write-Host "Cropping horizontally: x=\$cropX, width=\$newWidth"
    } else {
      # Source is taller than target - crop vertically
      \$newHeight = [int](\$img.Width / \$targetRatio)
      \$cropY = [int]((\$img.Height - \$newHeight) / 2)
      \$srcRect = New-Object System.Drawing.Rectangle(0, \$cropY, \$img.Width, \$newHeight)
      Write-Host "Cropping vertically: y=\$cropY, height=\$newHeight"
    }

    # Destination rectangle fills the print area
    \$destRect = New-Object System.Drawing.Rectangle(0, 0, \$bounds.Width, \$bounds.Height)

    # Draw cropped image to fill paper (maintains aspect ratio, no stretching)
    \$ev.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    \$ev.Graphics.DrawImage(\$img, \$destRect, \$srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    Write-Host "Image drawn with crop-to-fit"

    \$ev.HasMorePages = \$false
  })

  Write-Host "Calling Print()..."
  \$pd.Print()
  Write-Host "Print() completed"

  \$img.Dispose()
  Write-Host "Success"
} catch {
  Write-Host "ERROR: \$_"
  exit 1
}`;

      // Fast path: persistent worker (System.Drawing already loaded). A fresh
      // powershell.exe per print took 20-30s+ on this hardware and hit the old 30s
      // kill timeout, failing real prints mid-spool.
      let printed = false;
      try {
        console.log('[PRINTER] Printing via persistent worker...');
        await this.printViaWorker({
          imagePath: tempFilePath,
          printer: this.printerName,
          paperWidth: targetWidth,
          paperHeight: targetHeight,
          landscape: isLandscape,
          rotate: needsRotation,
        }, 90000);
        printed = true;
        console.log('[PRINTER] ✅ Print command executed successfully (worker)');
      } catch (workerError) {
        console.warn('[PRINTER] Worker print failed:', workerError.message, '— falling back to one-shot PowerShell');
      }

      if (!printed) {
        // Fallback: one-shot script file (slow, but independent of the worker).
        const psScriptPath = path.join(tempDir, `poembooth-print-${Date.now()}.ps1`);
        try {
          fs.writeFileSync(psScriptPath, psScript, 'utf8');
          console.log('[PRINTER] PowerShell script saved to:', psScriptPath);
          const printCommand = `powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${psScriptPath}"`;
          console.log('[PRINTER] Executing PowerShell script file');
          const { stdout, stderr } = await execAsync(printCommand, { timeout: 90000, windowsHide: true });
          console.log('[PRINTER] PowerShell stdout:', stdout);
          if (stderr) console.log('[PRINTER] PowerShell stderr:', stderr);
          printed = true;
          console.log('[PRINTER] ✅ Print command executed successfully');
        } catch (cmdError) {
          console.error('[PRINTER] ❌ Print command failed:', cmdError.message);
        } finally {
          // SECURITY: the script contains no guest data, but clean it up regardless
          try {
            if (fs.existsSync(psScriptPath)) fs.unlinkSync(psScriptPath);
            console.log('[PRINTER] ✓ PowerShell script deleted');
          } catch (e) {
            console.warn('[PRINTER] Failed to delete PS script:', e.message);
          }
        }
      }

      // SECURITY: Delete the temp image IMMEDIATELY, success or not (guest data)
      try {
        fs.unlinkSync(tempFilePath);
        console.log('[PRINTER] ✓ Temp image deleted immediately');
      } catch (cleanupError) {
        console.warn('[PRINTER] Failed to delete temp file:', cleanupError.message);
      }

      if (printed) {
        // Reset status after print completes
        console.log('[PRINTER] Scheduling status reset to "ready" in 20 seconds...');
        setTimeout(() => {
          this.lastStatus = 'ready';
          this.notifyStatusChange();
          console.log('[PRINTER] Status reset to "ready"');
        }, 20000);
        return true;
      }

      this.lastStatus = 'error';
      this.notifyStatusChange();
      return false;

    } catch (error) {
      console.error('[PRINTER] ❌ Print exception:', error);
      console.error('[PRINTER] Exception type:', error.name);
      console.error('[PRINTER] Exception message:', error.message);
      console.error('[PRINTER] Exception stack:', error.stack);
      this.lastStatus = 'error';
      this.notifyStatusChange();
      throw error;
    }
  }

  /**
   * Detect MIME type from buffer header
   */
  detectMimeType(buffer) {
    // Check PNG signature
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }
    // Check JPEG signature
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    // Default to JPEG
    return 'image/jpeg';
  }

  /**
   * Get current printer status
   * Returns cached status from last initialization - does not re-detect
   */
  async getStatus() {
    // Return cached status instead of re-initializing
    // The printer status is set during initialize() and updated via notifyStatusChange()
    // Re-detection is expensive and can fail intermittently during busy processing
    return {
      available: this.isAvailable,
      status: this.lastStatus,
      printerName: this.printerName || 'Unknown'
    };
  }

  /**
   * Set callback for status changes
   */
  onStatusChange(callback) {
    this.statusCallback = callback;
  }

  /**
   * Notify status change to callback
   */
  notifyStatusChange() {
    // De-dupe: only fire the callback when something actually changed. detect() runs on
    // every status heartbeat, and the callback re-triggers a status report — without this
    // guard that would be a feedback loop.
    const snap = `${this.isAvailable}|${this.lastStatus}|${this.printerName}`;
    if (snap === this._lastSnap) return;
    this._lastSnap = snap;

    if (this.statusCallback) {
      this.statusCallback({
        available: this.isAvailable,
        status: this.lastStatus,
        printerName: this.printerName || 'Unknown'
      });
    }
  }

  /**
   * Check if printer is ready to print
   */
  isReady() {
    return this.isAvailable && (this.lastStatus === 'ready' || this.lastStatus === 'printing');
  }

  /**
   * Create 2x6 strip layout by duplicating image side-by-side on 4x6 paper
   * The printer will cut vertically producing two 2x6 strips
   *
   * @param {Buffer} imageBuffer - Original 2x6 image buffer
   * @param {boolean} rotate - Whether the source image needs 90 degree rotation
   * @returns {Promise<Buffer>} - 4x6 layout with two 2x6 strips side by side
   */
  async createStripLayout(imageBuffer, rotate) {
    // Target: 4x6 at 300 DPI = 1200x1800 pixels
    const layoutWidth = 1200;
    const layoutHeight = 1800;
    const stripWidth = 600;  // Each strip is 2" = 600px at 300 DPI

    let stripImage = sharp(imageBuffer);

    // If source needs rotation, apply it
    if (rotate) {
      stripImage = stripImage.rotate(90);
    }

    // Resize to strip dimensions (2x6 = 600x1800 at 300 DPI)
    const resizedStrip = await stripImage
      .resize(stripWidth, layoutHeight, {
        fit: 'cover',
        position: 'center'
      })
      .toBuffer();

    // Create 4x6 canvas with two strips side by side
    const layout = await sharp({
      create: {
        width: layoutWidth,
        height: layoutHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .composite([
        { input: resizedStrip, left: 0, top: 0 },           // Left strip
        { input: resizedStrip, left: stripWidth, top: 0 }   // Right strip
      ])
      .jpeg({ quality: 95 })
      .toBuffer();

    console.log('[PRINTER] Created 2x6 strip layout:', layout.length, 'bytes');
    return layout;
  }

  /**
   * Cleanup
   */
  /**
   * Watch Windows device-change events (USB arrival/removal) and re-run detect()
   * right away. Without this the kiosk only noticed an unplugged or reconnected
   * printer on the next 25 s status heartbeat, so the hold-to-print button stayed
   * (or stayed hidden) for up to half a minute.
   */
  startDeviceWatcher() {
    if (process.platform !== 'win32' || this.deviceWatcher || this._destroyed) return;
    const { spawn } = require('child_process');

    const script =
      `$ErrorActionPreference = 'SilentlyContinue'\n` +
      `Register-WmiEvent -Class Win32_DeviceChangeEvent -SourceIdentifier pbdev | Out-Null\n` +
      `[Console]::Out.WriteLine('__WATCHER_READY__')\n` +
      `while ($true) {\n` +
      `  $e = Wait-Event -SourceIdentifier pbdev\n` +
      `  if ($e) {\n` +
      `    Remove-Event -EventIdentifier $e.EventIdentifier\n` +
      `    [Console]::Out.WriteLine('DEVICECHANGE ' + $e.SourceEventArgs.NewEvent.EventType)\n` +
      `  }\n` +
      `}`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true });
    } catch (e) {
      console.warn('[PRINTER] device watcher failed to start:', e.message);
      return;
    }
    this.deviceWatcher = child;

    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line === '__WATCHER_READY__') {
          console.log('[PRINTER] USB device watcher ready');
        } else if (line.startsWith('DEVICECHANGE')) {
          this.onDeviceChange(line.split(' ')[1]);
        }
      }
    });
    child.stderr.on('data', () => { /* ignore CLIXML noise */ });
    child.on('exit', (code) => {
      if (this.deviceWatcher === child) this.deviceWatcher = null;
      if (this._destroyed) return;
      this._watcherRestarts += 1;
      const delay = Math.min(60000, 5000 * this._watcherRestarts);
      console.warn(`[PRINTER] USB device watcher exited (code ${code}); restarting in ${delay / 1000}s`);
      setTimeout(() => this.startDeviceWatcher(), delay);
    });
  }

  // EventType: 1 = config changed, 2 = device arrival, 3 = device removal, 4 = docking
  onDeviceChange(eventType) {
    if (this._destroyed) return;
    console.log(`[PRINTER] USB device change (type ${eventType}) → re-detecting`);
    clearTimeout(this._deviceChangeTimer);
    clearTimeout(this._deviceFollowUpTimer);
    const run = () => {
      if (this.lastStatus === 'printing') return; // detect() skips mid-print anyway
      this.detect().catch(e => console.warn('[PRINTER] detect after device change failed:', e.message));
    };
    // Devices enumerate in bursts; settle for 2 s, then look. A DNP printer answers
    // cspstat only once its own firmware is up and the Windows queue can come up
    // several seconds after the USB device (measured: online ~12 s after plug-in
    // with a single 10 s follow-up), so look again at 5 s and 10 s.
    this._deviceChangeTimer = setTimeout(run, 2000);
    if (String(eventType) === '2') {
      this._deviceFollowUpTimer = setTimeout(() => {
        run();
        this._deviceFollowUpTimer = setTimeout(run, 5000);
      }, 5000);
    }
  }

  destroy() {
    console.log('[PRINTER] Cleaning up printer service...');
    this._destroyed = true;
    this.statusCallback = null;
    clearTimeout(this._deviceChangeTimer);
    clearTimeout(this._deviceFollowUpTimer);
    if (this.deviceWatcher) {
      try { this.deviceWatcher.kill(); } catch (_) {}
      this.deviceWatcher = null;
    }
    if (this.printWorker) {
      try { this.printWorker.child.kill(); } catch (_) {}
      this.printWorker = null;
    }
  }
}

module.exports = PrinterService;
