// WiFi Service - QR code scanning and WiFi connection
const wifi = require('node-wifi');
const { EventEmitter } = require('events');
const jsQR = require('jsqr'); // QR code decoder
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const execAsync = util.promisify(exec);

class WiFiService extends EventEmitter {
  constructor() {
    super();
    this.scanning = false;
    this.videoElement = null;
    this.canvas = null;
    this.scanInterval = null;

    // Initialize node-wifi
    wifi.init({
      iface: null // Use default network interface
    });
  }

  // Start scanning for WiFi QR code
  async startScanning(videoElement) {
    try {
      console.log('[WIFI] Starting QR scanner...');

      this.videoElement = videoElement;

      // Create offscreen canvas for QR detection
      this.canvas = document.createElement('canvas');

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment' // Back camera if available
        },
        audio: false
      });

      this.videoElement.srcObject = stream;

      // Wait for video to be ready
      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          resolve();
        };
      });

      // Start scanning loop
      this.scanning = true;
      this.scanForQRCode();

      console.log('[WIFI] QR scanner started');
    } catch (error) {
      console.error('[WIFI] Scanner initialization error:', error);
      throw error;
    }
  }

  // Scan for QR code in video stream
  scanForQRCode() {
    if (!this.scanning) return;

    try {
      // Set canvas size to match video
      this.canvas.width = this.videoElement.videoWidth;
      this.canvas.height = this.videoElement.videoHeight;

      const ctx = this.canvas.getContext('2d');
      ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);

      // Get image data
      const imageData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

      // Detect QR code
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });

      if (code) {
        // SECURITY: Never log QR data (contains WiFi password)
        console.log('[WIFI] QR code detected');

        // Parse WiFi config from QR code
        const wifiConfig = this.parseWiFiQR(code.data);

        if (wifiConfig) {
          this.stopScanning();
          console.log('[WIFI] WiFi config parsed (SSID: [REDACTED], password: [REDACTED])');
          this.emit('qr-detected', wifiConfig);
          return;
        }
      }
    } catch (error) {
      console.error('[WIFI] QR scan error:', error);
    }

    // Continue scanning
    this.scanInterval = setTimeout(() => this.scanForQRCode(), 100);
  }

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

  // Connect on Windows via a netsh WLAN profile.
  //
  // We deliberately avoid node-wifi here because its Windows implementation
  // first runs `netsh wlan show networks`, which requires Windows Location
  // services to be enabled (otherwise it fails with "Access denied" / error 5).
  // Adding a profile + connecting does NOT need Location services, so this
  // works on a locked-down kiosk regardless of that privacy setting.
  async connectWindows(wifiConfig) {
    const ssid = wifiConfig.ssid;
    const password = wifiConfig.password || '';
    const security = (wifiConfig.security || 'WPA2').toUpperCase();
    const isOpen = security === 'NOPASS' || security === 'NONE' || security === '' || password === '';

    const xml = isOpen
      ? this._buildOpenProfileXml(ssid)
      : this._buildWpa2ProfileXml(ssid, password);

    const tmpFile = path.join(os.tmpdir(), `wlan-${Date.now()}.xml`);

    try {
      fs.writeFileSync(tmpFile, xml, { encoding: 'utf8' });

      // Add (or overwrite) the network profile for all users
      await execAsync(`netsh wlan add profile filename="${tmpFile}" user=all`);

      // Connect to the network using the profile we just added
      await execAsync(`netsh wlan connect name="${ssid}" ssid="${ssid}"`);

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

    const ssid = wifiConfig.ssid;
    const password = wifiConfig.password || '';
    const isOpen = !password;
    const xml = isOpen
      ? this._buildOpenProfileXml(ssid)
      : this._buildWpa2ProfileXml(ssid, password);

    const tmpFile = path.join(os.tmpdir(), `wlan-profile-${Date.now()}.xml`);

    try {
      fs.writeFileSync(tmpFile, xml, { encoding: 'utf8' });
      await execAsync(`netsh wlan add profile filename="${tmpFile}" user=all`);
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

  // Connect on Linux
  async connectLinux(wifiConfig) {
    try {
      await wifi.connect({
        ssid: wifiConfig.ssid,
        password: wifiConfig.password
      });
    } catch (error) {
      console.error('[WIFI] Linux connection error:', error);
      throw error;
    }
  }

  // Connect on macOS
  async connectMacOS(wifiConfig) {
    try {
      await wifi.connect({
        ssid: wifiConfig.ssid,
        password: wifiConfig.password
      });
    } catch (error) {
      console.error('[WIFI] macOS connection error:', error);
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
          cache: 'no-cache'
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

  // Get current WiFi network
  async getCurrentNetwork() {
    try {
      const connections = await wifi.getCurrentConnections();
      if (connections.length > 0) {
        console.log('[WIFI] Current network:', connections[0].ssid);
        return connections[0];
      }
      return null;
    } catch (error) {
      console.error('[WIFI] Get current network error:', error);
      return null;
    }
  }

  // Scan for available networks
  async scanNetworks() {
    try {
      console.log('[WIFI] Scanning for networks...');
      const networks = await wifi.scan();
      console.log('[WIFI] Found', networks.length, 'networks');
      return networks;
    } catch (error) {
      console.error('[WIFI] Network scan error:', error);
      return [];
    }
  }

  // Stop QR scanning
  stopScanning() {
    console.log('[WIFI] Stopping QR scanner...');
    this.scanning = false;

    if (this.scanInterval) {
      clearTimeout(this.scanInterval);
      this.scanInterval = null;
    }

    if (this.videoElement && this.videoElement.srcObject) {
      this.videoElement.srcObject.getTracks().forEach(track => track.stop());
    }
  }

  // Cleanup
  destroy() {
    this.stopScanning();
    this.removeAllListeners();
  }
}

module.exports = WiFiService;
