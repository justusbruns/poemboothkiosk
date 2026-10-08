// WiFi Service - WiFi connection (QR scanning lives in the renderer)
//
// Windows is the production platform and is driven entirely through `netsh`
// (argument arrays, never shell strings). Linux uses `nmcli`, macOS
// `networksetup`; both are best-effort for development machines only.
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const execFileAsync = util.promisify(execFile);

// SECURITY: SSIDs come straight from a camera-scanned QR code. They are only
// ever passed to netsh/nmcli as discrete arguments (never through a shell
// string), and must look like a real SSID: 1-32 bytes, no control characters.
function validateSsid(ssid) {
  if (typeof ssid !== 'string' || ssid.length === 0) {
    throw new Error('Invalid WiFi SSID');
  }
  if (Buffer.byteLength(ssid, 'utf8') > 32) {
    throw new Error('WiFi SSID too long');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(ssid)) {
    throw new Error('WiFi SSID contains control characters');
  }
  return ssid;
}

function validatePassword(password) {
  if (password == null) return '';
  const p = String(password);
  if (p.length > 63) throw new Error('WiFi password too long');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(p)) throw new Error('WiFi password contains control characters');
  return p;
}

// Run a command with an argument array (no shell), hidden window, short timeout.
function run(cmd, args, timeout = 20000) {
  return execFileAsync(cmd, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
}
const netsh = (args) => run('netsh', args);

class WiFiService extends EventEmitter {
  // Parse WiFi QR code. Field order is NOT fixed (Android emits S;T;P, iOS
  // emits T;S;P), and values may contain backslash-escaped \\ \; \, \: \" —
  // so we parse order-independently and unescape rather than using a fixed regex.
  parseWiFiQR(qrData) {
    try {
      if (!qrData) return null;
      const data = qrData.trim();

      if (/^WIFI:/i.test(data)) {
        const body = data.substring(5); // strip "WIFI:"
        const fields = {};
        let key = null;
        let buf = '';
        let parsingKey = true;

        for (let i = 0; i < body.length; i++) {
          const ch = body[i];
          if (ch === '\\' && i + 1 < body.length) { buf += body[i + 1]; i++; continue; }
          if (parsingKey && ch === ':') { key = buf.toUpperCase(); buf = ''; parsingKey = false; continue; }
          if (ch === ';') { if (key !== null) fields[key] = buf; key = null; buf = ''; parsingKey = true; continue; }
          buf += ch;
        }
        if (key !== null && !parsingKey) fields[key] = buf;

        if (fields.S) {
          return {
            security: (fields.T || 'WPA2').toUpperCase(),
            ssid: fields.S,
            password: fields.P || '',
            hidden: /^true$/i.test(fields.H || '')
          };
        }
      }

      // Alternative: JSON format
      try {
        const json = JSON.parse(data);
        if (json.ssid) {
          return {
            security: json.security || 'WPA2',
            ssid: json.ssid,
            password: json.password || ''
          };
        }
      } catch (e) {
        // Not JSON
      }

      console.log('[WIFI] Invalid WiFi QR format');
      return null;
    } catch (error) {
      console.error('[WIFI] QR parse error:', error);
      return null;
    }
  }

  // Connect to WiFi network
  async connect(wifiConfig) {
    try {
      // SECURITY: Redact SSID and password from logs
      console.log('[WIFI] Connecting to WiFi...');

      // Platform-specific connection
      if (process.platform === 'win32') {
        await this.connectWindows(wifiConfig);
      } else if (process.platform === 'linux') {
        await this.connectLinux(wifiConfig);
      } else if (process.platform === 'darwin') {
        await this.connectMacOS(wifiConfig);
      } else {
        throw new Error(`Unsupported platform: ${process.platform}`);
      }

      console.log('[WIFI] Connected successfully');

      // SECURITY: Clear password from memory immediately after connection
      if (wifiConfig.password) {
        wifiConfig.password = null;
        delete wifiConfig.password;
      }

      // Wait for network to be ready
      await this.waitForInternet();

      return true;
    } catch (error) {
      console.error('[WIFI] Connection error:', error);
      // SECURITY: Clear password even on error
      if (wifiConfig && wifiConfig.password) {
        wifiConfig.password = null;
        delete wifiConfig.password;
      }
      throw error;
    }
  }

  // Connect on Windows via a netsh WLAN profile. Adding a profile + connecting
  // does not need Windows Location services (unlike `netsh wlan show networks`),
  // so this works on a locked-down kiosk regardless of that privacy setting.
  async connectWindows(wifiConfig) {
    const ssid = validateSsid(wifiConfig.ssid);
    const password = validatePassword(wifiConfig.password);
    const security = String(wifiConfig.security || 'WPA2').toUpperCase();
    const isOpen = security === 'NOPASS' || security === 'NONE' || security === '' || password === '';

    const xml = isOpen
      ? this._buildOpenProfileXml(ssid)
      : this._buildWpa2ProfileXml(ssid, password);

    const tmpFile = path.join(os.tmpdir(), `wlan-${Date.now()}.xml`);

    try {
      fs.writeFileSync(tmpFile, xml, { encoding: 'utf8' });

      // Add (or overwrite) the network profile for all users
      await netsh(['wlan', 'add', 'profile', `filename=${tmpFile}`, 'user=all']);

      // Connect to the network using the profile we just added
      await netsh(['wlan', 'connect', `name=${ssid}`, `ssid=${ssid}`]);

      console.log('[WIFI] netsh connect issued for SSID: [REDACTED]');
    } catch (error) {
      console.error('[WIFI] Windows connection error:', error.message);
      throw error;
    } finally {
      // SECURITY: the temp profile file contains the WiFi password — delete it
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
    }
  }

  // Install a WiFi network as a saved Windows profile WITHOUT connecting.
  // Used to pre-load the active booking's venue WiFi (from the backend kiosk
  // config) so Windows can auto-connect to it later when in range. This does
  // NOT switch the currently active connection.
  async installProfile(wifiConfig) {
    if (process.platform !== 'win32') {
      console.log('[WIFI] installProfile is only implemented on Windows; skipping');
      return false;
    }
    if (!wifiConfig || !wifiConfig.ssid) {
      return false;
    }

    let ssid, password;
    try {
      ssid = validateSsid(wifiConfig.ssid);
      password = validatePassword(wifiConfig.password);
    } catch (error) {
      console.warn('[WIFI] Not installing profile:', error.message);
      return false;
    }
    const isOpen = !password;
    const xml = isOpen
      ? this._buildOpenProfileXml(ssid)
      : this._buildWpa2ProfileXml(ssid, password);

    const tmpFile = path.join(os.tmpdir(), `wlan-profile-${Date.now()}.xml`);

    try {
      fs.writeFileSync(tmpFile, xml, { encoding: 'utf8' });
      await netsh(['wlan', 'add', 'profile', `filename=${tmpFile}`, 'user=all']);
      console.log('[WIFI] Booking WiFi profile installed (SSID: [REDACTED])');
      return true;
    } catch (error) {
      console.error('[WIFI] Failed to install WiFi profile:', error.message);
      return false;
    } finally {
      // SECURITY: the temp profile file contains the WiFi password — delete it
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
    }
  }

  // Escape a value for safe inclusion in the WLAN profile XML
  _escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // WPA/WPA2-PSK (AES) profile — covers virtually all modern home/office WiFi
  _buildWpa2ProfileXml(ssid, password) {
    const s = this._escapeXml(ssid);
    const p = this._escapeXml(password);
    return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${s}</name>
  <SSIDConfig><SSID><name>${s}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM><security>
    <authEncryption>
      <authentication>WPA2PSK</authentication>
      <encryption>AES</encryption>
      <useOneX>false</useOneX>
    </authEncryption>
    <sharedKey>
      <keyType>passPhrase</keyType>
      <protected>false</protected>
      <keyMaterial>${p}</keyMaterial>
    </sharedKey>
  </security></MSM>
</WLANProfile>`;
  }

  // Open network (no password)
  _buildOpenProfileXml(ssid) {
    const s = this._escapeXml(ssid);
    return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${s}</name>
  <SSIDConfig><SSID><name>${s}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM><security>
    <authEncryption>
      <authentication>open</authentication>
      <encryption>none</encryption>
      <useOneX>false</useOneX>
    </authEncryption>
  </security></MSM>
</WLANProfile>`;
  }

  // Connect on Linux (NetworkManager). Best-effort for dev / Pi.
  async connectLinux(wifiConfig) {
    const ssid = validateSsid(wifiConfig.ssid);
    const password = validatePassword(wifiConfig.password);
    const args = ['dev', 'wifi', 'connect', ssid];
    if (password) args.push('password', password);
    try {
      await run('nmcli', args, 45000);
    } catch (error) {
      console.error('[WIFI] Linux connection error (nmcli):', error.message);
      throw error;
    }
  }

  // Connect on macOS (networksetup). Best-effort for dev machines.
  async connectMacOS(wifiConfig) {
    const ssid = validateSsid(wifiConfig.ssid);
    const password = validatePassword(wifiConfig.password);
    try {
      await run('networksetup', ['-setairportnetwork', 'en0', ssid, password], 45000);
    } catch (error) {
      console.error('[WIFI] macOS connection error (networksetup):', error.message);
      throw error;
    }
  }

  // Wait for internet connectivity
  async waitForInternet(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch('https://www.google.com', {
          method: 'HEAD',
          cache: 'no-cache',
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          console.log('[WIFI] Internet connection verified');
          return true;
        }
      } catch (error) {
        // Not connected yet
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Internet connection timeout');
  }

  // Current WiFi network: { ssid, signal } or null. Windows parses
  // `netsh wlan show interfaces`; Linux asks nmcli; macOS is not supported.
  async getCurrentNetwork() {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await netsh(['wlan', 'show', 'interfaces']);
        const ssid = (stdout.match(/^\s*SSID\s*:\s*(.+)$/m) || [])[1];
        const signal = (stdout.match(/^\s*Signal\s*:\s*(\d+)%/m) || [])[1];
        const state = (stdout.match(/^\s*State\s*:\s*(.+)$/m) || [])[1];
        if (!ssid || !/connected/i.test(state || '')) return null;
        return { ssid: ssid.trim(), signal: signal ? Number(signal) : null };
      }
      if (process.platform === 'linux') {
        const { stdout } = await run('nmcli', ['-t', '-f', 'active,ssid,signal', 'dev', 'wifi']);
        const line = stdout.split('\n').find(l => l.startsWith('yes:'));
        if (!line) return null;
        const [, ssid, signal] = line.split(':');
        return { ssid, signal: signal ? Number(signal) : null };
      }
      console.log('[WIFI] getCurrentNetwork not supported on', process.platform);
      return null;
    } catch (error) {
      console.error('[WIFI] Get current network error:', error.message);
      return null;
    }
  }

  // Scan for networks: [{ ssid, signal }]. Note: on Windows this needs
  // Location services enabled, which kiosks usually have off — expect [].
  async scanNetworks() {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await netsh(['wlan', 'show', 'networks', 'mode=bssid']);
        const networks = [];
        let current = null;
        for (const line of stdout.split('\n')) {
          const ssid = line.match(/^\s*SSID\s+\d+\s*:\s*(.*)$/);
          if (ssid) { current = { ssid: ssid[1].trim(), signal: null }; networks.push(current); continue; }
          const signal = line.match(/^\s*Signal\s*:\s*(\d+)%/);
          if (signal && current && current.signal === null) current.signal = Number(signal[1]);
        }
        console.log('[WIFI] Found', networks.length, 'networks');
        return networks;
      }
      if (process.platform === 'linux') {
        const { stdout } = await run('nmcli', ['-t', '-f', 'ssid,signal', 'dev', 'wifi']);
        return stdout.split('\n').filter(Boolean).map(l => {
          const [ssid, signal] = l.split(':');
          return { ssid, signal: signal ? Number(signal) : null };
        });
      }
      console.log('[WIFI] scanNetworks not supported on', process.platform);
      return [];
    } catch (error) {
      console.error('[WIFI] Network scan error:', error.message);
      return [];
    }
  }

  // Cleanup
  destroy() {
    this.removeAllListeners();
  }
}

module.exports = WiFiService;
