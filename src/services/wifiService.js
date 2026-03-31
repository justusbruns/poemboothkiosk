// WiFi Service - QR code scanning and WiFi connection
const wifi = require('node-wifi');
const { EventEmitter } = require('events');
const jsQR = require('jsqr'); // QR code decoder

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

  // Parse WiFi QR code
  parseWiFiQR(qrData) {
    try {
      // WiFi QR format: WIFI:T:WPA;S:SSID;P:password;H:false;;
      const wifiRegex = /WIFI:T:([^;]+);S:([^;]+);P:([^;]+);/;
      const match = qrData.match(wifiRegex);

      if (match) {
        return {
          security: match[1], // WPA, WPA2, WEP, nopass
          ssid: match[2],
          password: match[3]
        };
      }

      // Alternative: JSON format
      try {
        const json = JSON.parse(qrData);
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

  // Connect on Windows
  async connectWindows(wifiConfig) {
    try {
      await wifi.connect({
        ssid: wifiConfig.ssid,
        password: wifiConfig.password
      });
    } catch (error) {
      console.error('[WIFI] Windows connection error:', error);
      throw error;
    }
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
