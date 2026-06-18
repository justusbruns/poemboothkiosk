/**
 * DNP supply reader — standalone child process.
 *
 * Run as an ISOLATED process (Electron-as-node) so any native fault in the DNP DLL
 * can never take down the kiosk. Reads the DNP printer's media/supply levels via
 * cspstat-x64.dll (koffi FFI) and prints a single JSON line to stdout, then exits.
 *
 * For a dye-sub printer (e.g. DP-QW410) the ribbon and paper deplete together, so the
 * single meaningful metric is "sheets remaining" on the current media roll.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 <electron|node> dnpSupplyReader.js <dllDir>
 *
 * cspstat API (signatures verified against PrinterInfo.exe's P/Invoke metadata + live):
 *   int  GetPrinterPortNum(byte* pArray, int arraysize)  // enumerate, returns printer count
 *   uint GetStatus(int idx)            // status bitfield   (idx = 0..count-1, NOT the raw port)
 *   int  GetMediaCounter(int idx)      // sheets remaining (counts down from capacity)
 *   int  GetInitialMediaCount(int idx) // roll capacity
 *   int  GetCounterL(int idx)          // lifetime prints
 *   int  GetMedia(int idx, byte* out)  // media code string
 *   int  GetSerialNo(int idx, byte* out)
 *   int  GetFirmwVersion(int idx, byte* out)
 */
const path = require('path');
const fs = require('fs');

function emit(obj) { process.stdout.write(JSON.stringify(obj)); }

// Decode the raw GetStatus() value into a readable state + an error flag.
// Values verified against DNP PrinterInfo's Cx_Native status constants.
function decodeStatus(raw) {
  raw = raw >>> 0;
  const MAP = {
    0x10001: 'idle',       0x10002: 'printing',   0x10004: 'standstill',
    0x10008: 'paper_out',  0x10010: 'ribbon_out', 0x10020: 'cooling',     0x10040: 'cooling',
    0x20001: 'cover_open', 0x20002: 'paper_jam',  0x20004: 'ribbon_err',
    0x20008: 'paper_err',  0x20010: 'data_err',   0x20020: 'scrapbox_err',
    0x80001: 'system_err',
  };
  let state = MAP[raw];
  if (!state) {
    if (raw === 0x80000000) state = 'offline';
    else {
      const g = raw & 0xFFFF0000;
      if (g === 0x00040000) state = 'hardware_err';
      else if (g === 0x00200000) state = 'paper_jam';      // UNIT_ERROR_* mechanical/jam detail
      else if (g === 0x00100000) state = 'firmware_update';
      else if (g === 0x00020000) state = 'setting_err';
      else if (g === 0x00010000) state = 'busy';
      else state = 'unknown';
    }
  }
  // idle/printing/standstill/cooling are healthy; everything else needs attention.
  const ok = state === 'idle' || state === 'printing' || state === 'standstill' || state === 'cooling';
  return { state, error: !ok };
}

function main() {
  const dllDir = process.argv[2] || process.env.DNP_DLL_DIR || 'C:\\DNP\\HotFolderPrint\\DLL';
  const dllPath = path.join(dllDir, 'cspstat-x64.dll');

  if (!fs.existsSync(dllPath)) { emit({ ok: false, error: 'dll_not_found', dllPath }); return; }

  // Help Windows resolve any sibling dependency DLLs next to cspstat.
  if (!String(process.env.PATH || '').includes(dllDir)) {
    process.env.PATH = dllDir + ';' + (process.env.PATH || '');
  }

  const koffi = require('koffi');
  const lib = koffi.load(dllPath);

  const GetPrinterPortNum    = lib.func('int GetPrinterPortNum(uint8_t *pArray, int arraysize)');
  const GetStatus            = lib.func('uint GetStatus(int idx)');
  const GetMediaCounter      = lib.func('int GetMediaCounter(int idx)');
  const GetInitialMediaCount = lib.func('int GetInitialMediaCount(int idx)');
  const GetCounterL          = lib.func('int GetCounterL(int idx)');
  const GetMedia             = lib.func('int GetMedia(int idx, _Out_ uint8_t *out)');
  const GetSerialNo          = lib.func('int GetSerialNo(int idx, _Out_ uint8_t *out)');
  const GetFirmwVersion      = lib.func('int GetFirmwVersion(int idx, _Out_ uint8_t *out)');

  // Enumerate connected DNP printers (fills a byte matrix; returns the count).
  const arr = Buffer.alloc(4096);
  const count = GetPrinterPortNum(arr, 16);
  if (!count || count < 1) { emit({ ok: false, error: 'no_printer' }); return; }

  const i = 0; // first printer
  const readStr = (fn) => { const b = Buffer.alloc(256); fn(i, b); return b.toString('latin1').split(/[\0\r\n]/)[0].trim(); };

  const statusRaw = GetStatus(i) >>> 0;
  const dec = decodeStatus(statusRaw);

  emit({
    ok: true,
    printers: count,
    sheets_remaining: GetMediaCounter(i),
    media_capacity: GetInitialMediaCount(i),
    media: readStr(GetMedia),
    serial: readStr(GetSerialNo),
    firmware: readStr(GetFirmwVersion),
    lifetime_prints: GetCounterL(i),
    status_raw: statusRaw,
    state: dec.state,     // readable: idle | printing | paper_out | ribbon_out | paper_jam | cover_open | ...
    error: dec.error,     // true when the state needs attention (jam, out of media, cover open, hw/system err, offline)
  });
}

try { main(); } catch (e) { emit({ ok: false, error: String((e && e.message) || e) }); }
