// API Client with Certificate-Based Authentication
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const certificatePinning = require('../lib/certificatePinning');

// Certificate paths (platform-specific)
const CERT_PATHS = {
  win32: 'C:\\ProgramData\\PoemBooth',
  linux: '/etc/poembooth',
  darwin: '/Library/Application Support/PoemBooth'
};

class ApiClient {
  constructor() {
    // Check for staging mode via command line argument
    const IS_STAGING = process.argv.includes('--staging');

    this.baseUrl = IS_STAGING
      ? 'https://poemboothbooking-git-staging-justus-bruns-projects.vercel.app'
      : 'https://book.poembooth.com';

    console.log('[API] Backend URL:', this.baseUrl);
    console.log('[API] Staging mode:', IS_STAGING);

    this.certificate = null;
    this.certificateBase64 = null;
    this.deviceToken = null;
    this.deviceInfo = null;
    this.requestCounter = 0; // Track sequential request numbers
    this.pinnedAgent = null; // HTTPS agent with certificate pinning
  }

  // SECURITY: Redact sensitive data from logs
  redactCert(cert) {
    if (!cert) return 'NULL';
    return cert.substring(0, 20) + '...[REDACTED]';
  }

  redactPayload(data) {
    if (!data) return 'NULL';
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return `[${str.length} bytes - REDACTED FOR SECURITY]`;
  }

  redactSensitiveFields(obj) {
    if (!obj) return obj;
    const copy = typeof obj === 'string' ? JSON.parse(obj) : { ...obj };

    // Redact certificate fields
    if (copy.certificate) copy.certificate = '[REDACTED]';
    if (copy.image_data) copy.image_data = `[${copy.image_data.length} bytes]`;
    if (copy.photo) copy.photo = '[REDACTED]';
    if (copy.poem) copy.poem = '[REDACTED - see metadata]';
    if (copy.caption) copy.caption = '[REDACTED]';

    return copy;
  }

  // Initialize: Load certificates and prepare auth
  async initialize() {
    try {
      console.log('[API] Initializing API client...');

      // Get platform-specific certificate paths
      const basePath = CERT_PATHS[process.platform];
      const certPath = path.join(basePath, 'device.crt');
      const keyPath = path.join(basePath, 'device.key');
      const caPath = path.join(basePath, 'ca.crt');

      // Read device certificate from filesystem
      this.certificate = fs.readFileSync(certPath, 'utf8');
      const certKey = fs.readFileSync(keyPath, 'utf8');
      const certCa = fs.readFileSync(caPath, 'utf8');

      // Convert certificate to base64 for Authorization header
      this.certificateBase64 = Buffer.from(this.certificate).toString('base64');

      // Get system info for device registration
      this.deviceInfo = this.getSystemInfo();

      console.log('[API] API client initialized');
      console.log('[API] Platform:', this.deviceInfo.platform);
      console.log('[API] Machine ID:', this.deviceInfo.machineId);

      // Create pinned HTTPS agent for secure connections
      const url = new URL(this.baseUrl);
      this.pinnedAgent = certificatePinning.createPinnedAgent(
        url.hostname,
        certificatePinning.PINNED_FINGERPRINTS
      );
      console.log('[API] Certificate pinning enabled for:', url.hostname);

      return true;
    } catch (error) {
      console.error('[API] Initialization error:', error);
      throw new Error(`Failed to initialize API client: ${error.message}`);
    }
  }

  // Check network connectivity
  async checkConnectivity() {
    try {
      // In dev/testing, assume we're online if we have certificates
      return true; // Backend will return proper errors if offline
    } catch (error) {
      console.log('[API] Connectivity check failed:', error.message);
      return true;
    }
  }

  // Register device with backend
  async registerDevice() {
    try {
      console.log('[API] Registering device...');

      // Get network info
      const os = require('os');
      const networkInterfaces = os.networkInterfaces();
      let macAddress = 'unknown';
      let ipAddress = 'unknown';

      // Extract MAC and IP from network interfaces
      for (const interfaceName in networkInterfaces) {
        const iface = networkInterfaces[interfaceName];
        for (const addr of iface) {
          if (!addr.internal && addr.family === 'IPv4') {
            macAddress = addr.mac;
            ipAddress = addr.address;
            break;
          }
        }
        if (macAddress !== 'unknown') break;
      }

      const payload = {
        certificate: this.certificate, // Backend expects certificate in body
        device_info: {
          mac: macAddress,
          ip_address: ipAddress,
          platform: this.deviceInfo.platform,
          hostname: this.deviceInfo.hostname,
          app_version: this.deviceInfo.appVersion || '1.0.0',
          wifi_ssid: 'Unknown' // TODO: Get actual SSID
        }
      };

      const response = await this.request('POST', '/api/devices/register', payload);

      // SECURITY: Redacted logging (no sensitive data)
      console.log('[API] Registration successful');
      console.log('[API] Device ID:', response.device_id ? '[PRESENT]' : '[MISSING]');
      console.log('[API] Equipment:', response.equipment?.asset_tag || '[UNKNOWN]');

      if (!response.success) {
        throw new Error(response.error || 'Device registration failed');
      }

      if (!response.equipment) {
        throw new Error('Invalid response: missing equipment data');
      }

      console.log('[API] Device registered:', response.device_id);
      console.log('[API] Equipment:', response.equipment.asset_tag);
      console.log('[API] Hub:', response.equipment.hub.name);

      // Store device token if provided
      if (response.device_token) {
        this.deviceToken = response.device_token;
      }

      // Transform response to match expected format for compatibility
      const transformedResponse = {
        success: true,
        device: {
          device_id: response.device_id,
          equipment_id: response.equipment.id,
          equipment_name: response.equipment.asset_tag,
          equipment_type_id: response.equipment.equipment_type_id,
          status: response.equipment.status,
          hub_id: response.equipment.hub.id,
          hub_name: response.equipment.hub.name,
          hub_region: response.equipment.hub.region_code,
          first_activation: response.first_activation
        },
        equipment: response.equipment
      };

      return transformedResponse;
    } catch (error) {
      console.error('[API] Registration error:', error);
      throw error;
    }
  }

  // Get kiosk configuration (AI settings, branding, etc.)
  async getKioskConfig() {
    try {
      console.log('[API] Fetching kiosk configuration...');
      console.log('[API] Device token:', this.deviceToken ? 'Set' : 'NOT SET');
      console.log('[API] Certificate base64 length:', this.certificateBase64?.length || 0);

      // Add cache-busting timestamp to force fresh data
      const timestamp = Date.now();
      const endpoint = `/api/kiosk/config?_t=${timestamp}`;
      console.log('[API] Cache-busting timestamp:', timestamp);

      const response = await this.request('GET', endpoint);

      console.log('[API] Config received:');
      console.log('[API] - Equipment:', response.equipment_name);
      console.log('[API] - Styles:', response.style_configs?.length || 0);

      return response;
    } catch (error) {
      console.error('[API] Config fetch error:', error);
      throw error;
    }
  }

  // Generate content (unified method for both poem and image generation)
  async generateContent(photoBlob, metadata) {
    try {
      console.log('[API] Generating content...');

      // Create form data
      const FormData = require('form-data');
      const formData = new FormData();

      formData.append('photo', photoBlob, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg'
      });

      formData.append('equipment_id', metadata.equipment_id);
      formData.append('hub_id', metadata.hub_id);

      // Include style if selected by user (knob rotation)
      if (metadata.style) {
        formData.append('style_id', metadata.style);
        console.log('[API] Including selected style:', metadata.style);
      }

      // Send request with form data
      const response = await this.requestMultipart('POST', '/api/kiosk/generate', formData);

      if (!response.success) {
        throw new Error(response.error || 'Content generation failed');
      }

      console.log('[API] Content generated successfully');
      console.log('[API] Generation type:', response.generation_type || 'unknown');
      console.log('[API] Session ID:', response.session_id);
      console.log('[API] Metadata:', JSON.stringify(response.metadata || {}, null, 2));

      // Log type-specific info
      if (response.generation_type === 'poem') {
        // SECURITY: Poem and caption redacted from logs
        if (response.session?.id) {
          console.log('[API] Session ID:', response.session.id);
        }
        if (response.poem?.text) {
          console.log('[API] Poem length:', response.poem.text.length, 'chars');
        }
      } else if (response.generation_type === 'image') {
        if (response.generated_image) {
          console.log('[API] Generated image size:', response.generated_image.length, 'chars (base64)');
        }
      }

      return response;
    } catch (error) {
      console.error('[API] Content generation error:', error);
      throw error;
    }
  }

  // DEPRECATED: Use generateContent() instead
  // Kept for backward compatibility
  async generatePoem(photoBlob, metadata) {
    console.warn('[API] DEPRECATED: generatePoem() - use generateContent() instead');
    return this.generateContent(photoBlob, metadata);
  }

  // Upload rendered image
  async uploadRenderedImage(imageBuffer, sessionId, quality = 'standard') {
    try {
      console.log('[API] Uploading rendered image...');
      console.log('[API] Session ID:', sessionId);
      console.log('[API] Quality:', quality);

      // Convert Buffer to base64 string
      const imageBase64 = imageBuffer.toString('base64');

      // Prepare JSON payload
      const payload = {
        session_id: sessionId,
        image_data: imageBase64,
        image_format: 'png',
        quality: quality
      };

      // Send JSON request (not multipart)
      const response = await this.request('POST', '/api/kiosk/upload-session', payload);

      if (!response.success) {
        throw new Error(response.error || 'Image upload failed');
      }

      console.log('[API] Image uploaded successfully');
      console.log('[API] Rendered Image URL:', response.rendered_image_url);
      console.log('[API] Public View URL:', response.public_view_url);
      console.log('[API] Expires at:', response.expires_at);

      return response;
    } catch (error) {
      console.error('[API] Upload error:', error);
      throw error;
    }
  }

  // Log print action
  async logPrint(sessionId) {
    try {
      console.log('[API] Logging print action...');

      const response = await this.request('POST', '/api/kiosk/log-print', {
        session_id: sessionId
      });

      return response;
    } catch (error) {
      console.error('[API] Print logging error:', error);
      // Don't throw - printing should work even if logging fails
      return { success: false };
    }
  }

  // Generic request method (using built-in https module)
  async request(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
      this.requestCounter++;
      const requestId = this.requestCounter;

      const url = new URL(`${this.baseUrl}${endpoint}`);

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.certificateBase64}`,
          'User-Agent': `PoemBooth-Kiosk/${this.deviceInfo?.appVersion || '1.0.0'}`
        },
        agent: this.pinnedAgent // Certificate pinning enabled
      };

      // Add device token if available (for subsequent requests after registration)
      if (this.deviceToken) {
        options.headers['X-Device-Token'] = this.deviceToken;
      }

      const bodyData = body ? JSON.stringify(body) : null;
      if (bodyData) {
        options.headers['Content-Length'] = Buffer.byteLength(bodyData);
      }

      // === SECURITY-HARDENED REQUEST LOGGING ===
      console.log(`[API] ========== REQUEST #${requestId} START ==========`);
      console.log(`[API] Method: ${method}`);
      console.log(`[API] Endpoint: ${endpoint}`);
      console.log(`[API] Certificate in Authorization header: ${this.certificateBase64 ? 'YES' : 'NO'}`);
      console.log(`[API] Device token present: ${this.deviceToken ? 'YES' : 'NO'}`);
      // SECURITY: Request body completely redacted (may contain certificate, images, poems)
      if (bodyData) {
        console.log(`[API] Request body: ${this.redactPayload(bodyData)}`);
      }
      console.log(`[API] ========== REQUEST #${requestId} SENT ==========`);

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          // === SECURITY-HARDENED RESPONSE LOGGING ===
          console.log(`[API] ========== RESPONSE #${requestId} RECEIVED ==========`);
          console.log(`[API] Status Code: ${res.statusCode}`);
          console.log(`[API] Response Body Length: ${data.length} chars`);
          // SECURITY: Response body completely redacted (may contain guest data, poems, images)
          console.log(`[API] Response: ${this.redactPayload(data)}`);
          console.log(`[API] ========== RESPONSE #${requestId} END ==========`);

          // Validate response header fingerprint (defense-in-depth)
          if (this.pinnedAgent) {
            const headerValid = certificatePinning.validateResponseHeader(
              certificatePinning.PINNED_FINGERPRINTS[0],
              res.headers
            );
            if (!headerValid) {
              console.warn('[API] [SECURITY] Response header fingerprint validation failed');
            }
          }

          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              console.error(`[API] ❌ REQUEST #${requestId} FAILED - HTTP ${res.statusCode}`);
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }

            const jsonData = JSON.parse(data);
            console.log(`[API] ✅ REQUEST #${requestId} SUCCESS`);
            resolve(jsonData);
          } catch (error) {
            console.error(`[API] ❌ REQUEST #${requestId} PARSE ERROR:`, error.message);
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        // Check if this is a certificate pinning error
        if (error.message && error.message.includes('Certificate pinning')) {
          console.error(`[API] ❌ [SECURITY] REQUEST #${requestId} CERT PINNING FAILED [${method} ${endpoint}]`);
          console.error(`[API] [SECURITY] Hostname: ${options.hostname}`);
          console.error(`[API] [SECURITY] Error: ${error.message}`);
          // DO NOT retry - this indicates MITM attack
          reject(new Error('Connection security verification failed. Please contact support.'));
        } else {
          // Existing error handling
          console.error(`[API] ❌ REQUEST #${requestId} NETWORK ERROR [${method} ${endpoint}]:`, error);
          reject(error);
        }
      });

      if (bodyData) {
        req.write(bodyData);
      }

      req.end();
    });
  }

  // Multipart form data request (using built-in https module)
  async requestMultipart(method, endpoint, formData) {
    return new Promise((resolve, reject) => {
      this.requestCounter++;
      const requestId = this.requestCounter;

      const url = new URL(`${this.baseUrl}${endpoint}`);

      const headers = {
        'Authorization': `Bearer ${this.certificateBase64}`,
        'User-Agent': `PoemBooth-Kiosk/${this.deviceInfo?.appVersion || '1.0.0'}`,
        ...formData.getHeaders()
      };

      if (this.deviceToken) {
        headers['X-Device-Token'] = this.deviceToken;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        agent: this.pinnedAgent // Certificate pinning enabled
      };

      // === DETAILED MULTIPART REQUEST LOGGING ===
      console.log(`[API] ========== MULTIPART REQUEST #${requestId} START ==========`);
      console.log(`[API] Method: ${method}`);
      console.log(`[API] Endpoint: ${endpoint}`);
      console.log(`[API] Full URL: ${this.baseUrl}${endpoint}`);
      console.log(`[API] Certificate in Authorization header: ${this.certificateBase64 ? 'YES' : 'NO'}`);
      console.log(`[API] Certificate length: ${this.certificateBase64?.length || 0} chars`);
      console.log(`[API] Device token present: ${this.deviceToken ? 'YES' : 'NO'}`);
      console.log(`[API] Headers:`, JSON.stringify({
        'Authorization': this.certificateBase64 ? `Bearer ${this.certificateBase64.substring(0, 20)}...` : 'MISSING',
        'User-Agent': headers['User-Agent'],
        'X-Device-Token': this.deviceToken ? 'SET' : 'NOT SET',
        'Content-Type': headers['content-type'] || 'multipart/form-data'
      }, null, 2));
      console.log(`[API] ========== MULTIPART REQUEST #${requestId} SENT ==========`);

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          // === DETAILED RESPONSE LOGGING ===
          console.log(`[API] ========== MULTIPART RESPONSE #${requestId} RECEIVED ==========`);
          console.log(`[API] Status Code: ${res.statusCode}`);
          console.log(`[API] Response Body Length: ${data.length} chars`);
          const responsePreview = data.length > 500 ? data.substring(0, 500) + '...' : data;
          console.log(`[API] Response Preview:`, responsePreview);
          console.log(`[API] ========== MULTIPART RESPONSE #${requestId} END ==========`);

          // Validate response header fingerprint (defense-in-depth)
          if (this.pinnedAgent) {
            const headerValid = certificatePinning.validateResponseHeader(
              certificatePinning.PINNED_FINGERPRINTS[0],
              res.headers
            );
            if (!headerValid) {
              console.warn('[API] [SECURITY] Response header fingerprint validation failed');
            }
          }

          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              console.error(`[API] ❌ MULTIPART REQUEST #${requestId} FAILED - HTTP ${res.statusCode}`);
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }

            const jsonData = JSON.parse(data);
            console.log(`[API] ✅ MULTIPART REQUEST #${requestId} SUCCESS`);
            resolve(jsonData);
          } catch (error) {
            console.error(`[API] ❌ MULTIPART REQUEST #${requestId} PARSE ERROR:`, error.message);
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        // Check if this is a certificate pinning error
        if (error.message && error.message.includes('Certificate pinning')) {
          console.error(`[API] ❌ [SECURITY] MULTIPART REQUEST #${requestId} CERT PINNING FAILED [${method} ${endpoint}]`);
          console.error(`[API] [SECURITY] Hostname: ${options.hostname}`);
          console.error(`[API] [SECURITY] Error: ${error.message}`);
          // DO NOT retry - this indicates MITM attack
          reject(new Error('Connection security verification failed. Please contact support.'));
        } else {
          // Existing error handling
          console.error(`[API] ❌ MULTIPART REQUEST #${requestId} NETWORK ERROR [${method} ${endpoint}]:`, error);
          reject(error);
        }
      });

      // Pipe formData to request
      formData.pipe(req);
    });
  }

  // Get system information
  getSystemInfo() {
    try {
      // Try to get machine ID
      let machineid = 'unknown';
      try {
        const { machineId } = require('node-machine-id');
        machineid = machineId();
      } catch (e) {
        console.log('[API] node-machine-id not available, using hostname');
        machineid = os.hostname();
      }

      return {
        platform: process.platform,
        hostname: os.hostname(),
        machineId: machineid,
        cpuCount: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        appVersion: '1.0.0'
      };
    } catch (error) {
      console.error('[API] Error getting system info:', error);
      return {
        platform: process.platform,
        hostname: os.hostname(),
        machineId: 'unknown',
        appVersion: '1.0.0'
      };
    }
  }
}

module.exports = ApiClient;
