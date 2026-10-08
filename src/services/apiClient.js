// API Client
//
// Two ways a kiosk can authenticate against the backend:
//   1. device_token  - a Supabase session for the booth's own device user,
//                      obtained through the Smart-TV style pairing flow
//                      (/api/device-auth/*) and persisted via CredentialStore.
//   2. certificate   - legacy pre-provisioned X.509 certificate files in
//                      C:\ProgramData\PoemBooth (sent base64 as Bearer).
// Stored device credentials win; the certificate is only a fallback for
// booths that were provisioned the old way.
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const certificatePinning = require('../lib/certificatePinning');
const CredentialStore = require('./credentialStore');

// Certificate paths (platform-specific)
const CERT_PATHS = {
  win32: 'C:\\ProgramData\\PoemBooth',
  linux: '/etc/poembooth',
  darwin: '/Library/Application Support/PoemBooth'
};

// Refresh the access token this long before it expires
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

class ApiClient {
  /**
   * @param {object} [options]
   * @param {string} [options.appVersion]        reported in User-Agent / device_info
   * @param {object} [options.credentialStore]   injectable for tests
   * @param {function} [options.onAuthInvalid]   called when stored credentials stop working
   */
  constructor(options = {}) {
    // Check for staging mode via command line argument
    const IS_STAGING = process.argv.includes('--staging');
    this.envName = IS_STAGING ? 'staging' : 'production';

    this.baseUrl = IS_STAGING
      ? 'https://poemboothbooking-git-staging-justus-bruns-projects.vercel.app'
      : 'https://book.poembooth.com';

    console.log('[API] Backend URL:', this.baseUrl);
    console.log('[API] Staging mode:', IS_STAGING);

    this.appVersion = options.appVersion || '1.0.0';
    this.onAuthInvalid = typeof options.onAuthInvalid === 'function' ? options.onAuthInvalid : null;
    this.credentialStore = options.credentialStore || new CredentialStore({ envName: this.envName });

    // 'none' | 'device_token' | 'certificate'
    this.authMode = 'none';
    this.credentials = null;     // { access_token, refresh_token, expires_at, equipment_id, hub_id, ... }
    this.pairing = null;         // in-flight pairing: { device_code, user_code, ... }
    this.refreshPromise = null;  // de-duplicates concurrent refreshes

    this.certificate = null;
    this.certificateBase64 = null;
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

  // Initialize: load whatever credentials this device has and prepare the
  // HTTPS agent. Never throws just because the device is not provisioned yet —
  // the renderer asks getAuthStatus() and routes to the pairing screen.
  async initialize() {
    try {
      console.log('[API] Initializing API client...');

      // Get system info for device registration / pairing
      this.deviceInfo = this.getSystemInfo();
      console.log('[API] Platform:', this.deviceInfo.platform);
      console.log('[API] Machine ID:', this.deviceInfo.machineId);

      // Create pinned HTTPS agent for secure connections
      const url = new URL(this.baseUrl);
      this.pinnedAgent = certificatePinning.createPinnedAgent(
        url.hostname,
        certificatePinning.PINNED_FINGERPRINTS
      );
      console.log('[API] Certificate pinning enabled for:', url.hostname);

      // 1. Stored device credentials from a previous pairing
      const stored = this.credentialStore.load();
      if (stored) {
        this.credentials = stored;
        this.authMode = 'device_token';
        console.log('[API] Auth mode: device_token (equipment', stored.equipment_id, ', hub', stored.hub_id, ')');
        return true;
      }

      // 2. Legacy certificate files
      try {
        const basePath = CERT_PATHS[process.platform];
        const certPath = path.join(basePath, 'device.crt');
        const keyPath = path.join(basePath, 'device.key');
        const caPath = path.join(basePath, 'ca.crt');

        this.certificate = fs.readFileSync(certPath, 'utf8');
        fs.readFileSync(keyPath, 'utf8');
        fs.readFileSync(caPath, 'utf8');
        this.certificateBase64 = Buffer.from(this.certificate).toString('base64');
        this.authMode = 'certificate';
        console.log('[API] Auth mode: certificate (legacy provisioning)');
        return true;
      } catch (certError) {
        console.log('[API] No usable certificate files:', certError.code || certError.message);
      }

      this.authMode = 'none';
      console.log('[API] Auth mode: none - device needs pairing');
      return true;
    } catch (error) {
      console.error('[API] Initialization error:', error);
      throw new Error(`Failed to initialize API client: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Auth state
  // ---------------------------------------------------------------------------

  getAuthStatus() {
    const c = this.credentials || {};
    return {
      mode: this.authMode,
      paired: this.authMode !== 'none',
      environment: this.envName,
      equipment_id: c.equipment_id ?? null,
      equipment_name: c.equipment_name ?? null,
      hub_id: c.hub_id ?? null,
      hub_name: c.hub_name ?? null,
      device_id: c.device_id ?? null,
      paired_at: c.paired_at ?? null
    };
  }

  authorizationHeader() {
    if (this.authMode === 'device_token' && this.credentials?.access_token) {
      return `Bearer ${this.credentials.access_token}`;
    }
    if (this.authMode === 'certificate' && this.certificateBase64) {
      return `Bearer ${this.certificateBase64}`;
    }
    return null;
  }

  authHeaderDescription() {
    if (this.authMode === 'device_token') return 'device token';
    if (this.authMode === 'certificate') return 'certificate';
    return 'NONE';
  }

  // Refresh the device session before the access token expires
  async ensureFreshToken() {
    if (this.authMode !== 'device_token' || !this.credentials) return;
    const expiresAtMs = (Number(this.credentials.expires_at) || 0) * 1000;
    if (expiresAtMs - Date.now() > TOKEN_REFRESH_MARGIN_MS) return;
    await this.refreshSession();
  }

  async refreshSession() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const refreshToken = this.credentials?.refresh_token;
      if (!refreshToken) throw new Error('No refresh token available');

      console.log('[API] Refreshing device session...');
      const { statusCode, json } = await this.rawRequest('POST', '/api/device-auth/refresh', {
        refresh_token: refreshToken
      }, { auth: false });

      if (statusCode === 401 || !json?.access_token || !json?.refresh_token) {
        console.error('[API] Device session refresh rejected (HTTP', statusCode, ')');
        this.handleCredentialsInvalid('refresh_rejected');
        throw new Error('Device credentials invalid - re-pairing required');
      }
      if (statusCode < 200 || statusCode >= 300) {
        // Transient (5xx / network) - keep the old credentials and let the caller retry later
        throw new Error(`Session refresh failed: HTTP ${statusCode}`);
      }

      this.credentials = {
        ...this.credentials,
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: json.expires_at,
        device_id: json.device_id || this.credentials.device_id
      };
      this.credentialStore.save(this.credentials);
      console.log('[API] Device session refreshed, expires at', new Date(json.expires_at * 1000).toISOString());
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  handleCredentialsInvalid(reason) {
    console.error('[API] Stored device credentials are no longer valid:', reason);
    this.credentialStore.clear();
    this.credentials = null;
    this.authMode = 'none';
    if (this.onAuthInvalid) {
      try { this.onAuthInvalid(reason); } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Pairing (Smart-TV style device authorization)
  // ---------------------------------------------------------------------------

  // Ask the backend for a fresh pairing code. Returns what the renderer may
  // show; the secret device_code stays in the main process.
  async startPairing(options = {}) {
    const info = this.deviceInfo || this.getSystemInfo();
    const { statusCode, json } = await this.rawRequest('POST', '/api/device-auth/start', {
      device_info: {
        hostname: info.hostname,
        platform: info.platform,
        app_version: this.appVersion,
        mac: this.getPrimaryMac(),
        serial: typeof info.machineId === 'string' ? info.machineId : undefined,
        // setup language chosen on the booth; seeds equipment.operator_language
        language: options.language || undefined
      }
    }, { auth: false });

    if (statusCode < 200 || statusCode >= 300 || !json?.device_code || !json?.user_code) {
      throw new Error(`Failed to start pairing: HTTP ${statusCode} ${json?.error || ''}`.trim());
    }

    this.pairing = {
      device_code: json.device_code,
      user_code: json.user_code,
      verification_url: json.verification_url,
      verification_url_complete: json.verification_url_complete,
      interval: Math.max(2, Number(json.interval) || 5),
      expires_in: Number(json.expires_in) || 600,
      started_at: Date.now()
    };
    console.log('[API] Pairing started, user code', json.user_code);

    return {
      user_code: this.pairing.user_code,
      verification_url: this.pairing.verification_url,
      verification_url_complete: this.pairing.verification_url_complete,
      interval: this.pairing.interval,
      expires_in: this.pairing.expires_in
    };
  }

  // Poll once. Returns { status } or, once approved, { status: 'approved', device }.
  async pollPairing() {
    if (!this.pairing) {
      return { status: 'not_started' };
    }
    const { statusCode, json } = await this.rawRequest('POST', '/api/device-auth/poll', {
      device_code: this.pairing.device_code
    }, { auth: false });

    if (statusCode === 429) return { status: 'pending', slow_down: true };
    if (statusCode < 200 || statusCode >= 300) {
      return { status: 'error', error: json?.error || `HTTP ${statusCode}` };
    }

    const status = json?.status || 'error';
    if (status !== 'approved') {
      return { status, error: json?.error };
    }

    const eq = json.equipment || {};
    this.credentials = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: json.expires_at,
      device_id: json.device_id,
      equipment_id: eq.id,
      equipment_name: eq.asset_tag,
      hub_id: eq.hub_id || eq.hub?.id,
      hub_name: eq.hub?.name,
      hub_region: eq.hub?.region_code,
      paired_at: new Date().toISOString()
    };
    this.credentialStore.save(this.credentials);
    this.authMode = 'device_token';
    this.pairing = null;
    console.log('[API] Pairing approved - equipment', eq.asset_tag, 'in hub', eq.hub?.name);

    return { status: 'approved', device: this.deviceFromCredentials() };
  }

  // Forget stored credentials (e.g. operator wants to re-pair the booth)
  resetPairing() {
    this.credentialStore.clear();
    this.credentials = null;
    this.pairing = null;
    this.authMode = this.certificateBase64 ? 'certificate' : 'none';
  }

  deviceFromCredentials() {
    const c = this.credentials || {};
    return {
      device_id: c.device_id,
      equipment_id: c.equipment_id,
      equipment_name: c.equipment_name,
      hub_id: c.hub_id,
      hub_name: c.hub_name,
      hub_region: c.hub_region,
      first_activation: c.paired_at
    };
  }

  getPrimaryMac() {
    try {
      const ifaces = os.networkInterfaces();
      for (const name in ifaces) {
        for (const addr of ifaces[name]) {
          if (!addr.internal && addr.family === 'IPv4' && addr.mac && addr.mac !== '00:00:00:00:00:00') {
            return addr.mac;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return undefined;
  }

  // Check network connectivity by attempting a TCP connection to the backend.
  // Returns true only if the backend host is actually reachable (DNS resolves
  // AND the TCP handshake on :443 completes). No internet / no WiFi → false,
  // which routes the app to the WiFi QR setup screen instead of the error screen.
  async checkConnectivity() {
    const net = require('net');
    const url = new URL(this.baseUrl);
    const host = url.hostname;
    const port = parseInt(url.port, 10) || 443;
    const TIMEOUT_MS = 5000;

    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (isOnline, reason) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        console.log(`[API] Connectivity check: ${isOnline ? 'ONLINE' : 'OFFLINE'} (${reason})`);
        resolve(isOnline);
      };

      socket.setTimeout(TIMEOUT_MS);
      socket.once('connect', () => finish(true, `reachable ${host}:${port}`));
      socket.once('timeout', () => finish(false, 'timeout'));
      socket.once('error', (err) => finish(false, err.code || err.message));

      socket.connect(port, host);
    });
  }

  // Register device with backend
  async registerDevice() {
    // Paired devices are already known to the backend; the device user *is*
    // the registration. /api/kiosk/config (called right after) is the
    // authoritative check that the credentials still work.
    if (this.authMode === 'device_token') {
      console.log('[API] Device paired via device token - skipping certificate registration');
      await this.ensureFreshToken();
      return { success: true, device: this.deviceFromCredentials(), equipment: null };
    }
    if (this.authMode !== 'certificate') {
      throw new Error('Device is not paired. Please pair this booth first.');
    }

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
      console.log('[API] Auth mode:', this.authMode);

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

  // Generate content for a photo. Streams NDJSON events from the backend
  // (poem text token by token, then the backend-rendered image) and forwards
  // each one to onEvent(evt). Falls back to the classic JSON response (older
  // backend) by synthesising the same events. Resolves with the collected
  // result once the stream is done.
  //
  // Events: start | poem_delta | poem_done | image_result | render |
  //         render_error | error | done   (see CLAUDE.md "Generate stream")
  async generateContent(photoBlob, metadata, onEvent = null) {
    const emit = (evt) => {
      if (!onEvent) return;
      try { onEvent(evt); } catch (e) { console.warn('[API] onEvent handler error:', e.message); }
    };

    console.log('[API] Generating content (streaming)...');

    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('photo', photoBlob, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    formData.append('equipment_id', String(metadata.equipment_id));
    formData.append('hub_id', String(metadata.hub_id));
    formData.append('stream', '1');
    if (metadata.style) {
      formData.append('style_id', String(metadata.style));
      console.log('[API] Including selected style:', metadata.style);
    }

    const result = { events: [], poem: '', caption: null, session_id: null, generation_type: null, render: null, image: null, error: null };
    let isNdjson = null;   // decided from the response content-type
    let buffered = '';     // partial NDJSON line
    const startedAt = Date.now();

    const handleEvent = (evt) => {
      if (!evt || typeof evt !== 'object') return;
      result.events.push(evt.type);
      switch (evt.type) {
        case 'start':
          result.session_id = evt.session_id || null;
          result.booking_id = evt.booking_id || null;
          result.generation_type = evt.generation_type || 'poem';
          result.caption = evt.caption || null;
          console.log(`[API] stream start: session ${result.session_id}, type ${result.generation_type}, +${Date.now() - startedAt}ms`);
          break;
        case 'poem_delta':
          result.poem += evt.text || '';
          if (!result.firstDeltaMs) {
            result.firstDeltaMs = Date.now() - startedAt;
            console.log(`[API] first poem token after ${result.firstDeltaMs}ms`);
          }
          break;
        case 'poem_done':
          if (typeof evt.poem === 'string' && evt.poem.length) result.poem = evt.poem;
          result.metadata = evt.metadata || null;
          console.log(`[API] poem done: ${result.poem.length} chars, +${Date.now() - startedAt}ms`);
          break;
        case 'image_result':
          result.generation_type = 'image';
          result.image = evt;
          console.log(`[API] image result received, +${Date.now() - startedAt}ms`);
          break;
        case 'render':
          result.render = evt;
          console.log(`[API] render ready (${evt.width}x${evt.height}), +${Date.now() - startedAt}ms`);
          break;
        case 'render_error':
          result.render_error = evt.error || 'render failed';
          console.error('[API] backend render failed:', result.render_error);
          break;
        case 'error':
          result.error = evt.error || 'generation failed';
          result.error_code = evt.code || null;
          console.error('[API] generation error from backend:', result.error);
          break;
        case 'done':
          break;
        default:
          console.log('[API] unknown stream event:', evt.type);
      }
      emit(evt);
    };

    const onChunk = (chunk, res) => {
      if (isNdjson === null) {
        const ct = String(res.headers['content-type'] || '');
        isNdjson = ct.includes('application/x-ndjson') || ct.includes('application/jsonl');
      }
      if (!isNdjson) return; // plain JSON: parsed at the end
      buffered += chunk;
      let nl;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        try { handleEvent(JSON.parse(line)); } catch (e) { console.warn('[API] bad NDJSON line:', e.message); }
      }
    };

    const { statusCode, data } = await this.requestMultipart('POST', '/api/kiosk/generate', formData, {
      timeoutMs: 90000,
      accept: 'application/x-ndjson, application/json',
      onChunk
    });

    if (isNdjson) {
      if (buffered.trim()) {
        try { handleEvent(JSON.parse(buffered.trim())); } catch (e) { /* ignore trailing junk */ }
      }
      if (statusCode < 200 || statusCode >= 300) {
        const err = new Error(result.error || `HTTP ${statusCode}`);
        err.code = result.error_code;
        throw err;
      }
      if (result.error) {
        const err = new Error(result.error);
        err.code = result.error_code;
        throw err;
      }
      if (!result.events.includes('done')) {
        console.warn('[API] stream ended without done event');
        emit({ type: 'done', incomplete: true });
      }
      return result;
    }

    // ---- Fallback: classic single JSON response (older backend) ----
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`HTTP ${statusCode}: ${data}`);
    }
    let response;
    try {
      response = JSON.parse(data);
    } catch (e) {
      throw new Error(`Failed to parse response: ${e.message}`);
    }
    if (!response.success) {
      throw new Error(response.error || 'Content generation failed');
    }
    console.log('[API] Content generated (non-streaming backend), type:', response.generation_type || 'poem');
    const sessionId = response.session_id || (response.session && response.session.id) || null;
    handleEvent({
      type: 'start', session_id: sessionId, booking_id: response.booking_id || null,
      generation_type: response.generation_type || 'poem', caption: response.caption || null
    });
    if (response.generation_type === 'image') {
      handleEvent({ ...response, type: 'image_result' });
    } else {
      const poem = (response.poem && response.poem.text) || response.poem || '';
      handleEvent({ type: 'poem_delta', text: poem });
      handleEvent({ type: 'poem_done', poem, metadata: response.metadata || null });
      const tpl = (response.branding_config && response.branding_config.template) || {};
      if (response.public_view_url && (response.print_image_url || response.rendered_image_url)) {
        handleEvent({
          type: 'render',
          session_id: sessionId,
          public_view_url: response.public_view_url,
          rendered_image_url: response.rendered_image_url || null,
          print_image_url: response.print_image_url || response.rendered_image_url || null,
          print_format: response.print_format || tpl.print_format || null,
          print_orientation: response.print_orientation || tpl.print_orientation || null
        });
      } else {
        handleEvent({ type: 'render_error', error: 'Backend did not render the image (no streaming support)' });
      }
    }
    handleEvent({ type: 'done' });
    return result;
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

  // Register a kiosk (hold-to-print) print. The backend writes the print_jobs row and
  // enforces the per-photo max, replying { logged: true } when the print is allowed or
  // { logged: false } when the max has been reached.
  async logPrint(sessionId) {
    try {
      console.log('[API] Registering kiosk print...');

      const response = await this.request('POST', '/api/kiosk/print-jobs', {
        session_id: sessionId
      });

      return response; // { logged: boolean, ... }
    } catch (error) {
      console.error('[API] Print logging error:', error);
      // Don't throw - printing should still work if the call fails (e.g. offline)
      return { success: false };
    }
  }

  // Report printer connectivity/status so the portal can show/hide its print button,
  // plus optional DNP supply levels (sheets remaining, capacity, media, serial, ...) for
  // the dashboard. Backend: POST /api/kiosk/printer-status { connected, status, ...supplies }
  async reportPrinterStatus(connected, status, supplies = null) {
    try {
      const body = {
        connected: !!connected,
        status: status || 'unknown'
      };
      // Only include supply fields when we have a fresh, valid reading.
      if (supplies && supplies.ok) {
        body.sheets_remaining = supplies.sheets_remaining;
        body.media_capacity = supplies.media_capacity;
        body.media = supplies.media;
        body.serial = supplies.serial;
        body.firmware = supplies.firmware;
        body.lifetime_prints = supplies.lifetime_prints;
        body.printer_status_raw = supplies.status_raw;
        body.printer_state = supplies.state;   // readable hardware state (idle, paper_jam, ribbon_out, ...)
        body.printer_error = supplies.error;   // true when it needs attention
      }
      return await this.request('POST', '/api/kiosk/printer-status', body);
    } catch (error) {
      console.error('[API] reportPrinterStatus error:', error.message);
      return { success: false };
    }
  }

  // Poll for portal-requested print jobs for this device
  // Backend: GET /api/kiosk/print-jobs -> { jobs: [{ id, session_id, print_format, print_orientation, rendered_image_url }] }
  async getPrintJobs() {
    try {
      const res = await this.request('GET', '/api/kiosk/print-jobs');
      return Array.isArray(res?.jobs) ? res.jobs : [];
    } catch (error) {
      console.error('[API] getPrintJobs error:', error.message);
      return [];
    }
  }

  // Update a print job's status (printing | completed | failed)
  // Backend: PATCH /api/kiosk/print-jobs { job_id, status }
  async updatePrintJob(jobId, status) {
    try {
      return await this.request('PATCH', '/api/kiosk/print-jobs', { job_id: jobId, status });
    } catch (error) {
      console.error('[API] updatePrintJob error:', error.message);
      return { success: false };
    }
  }

  // Download an image from a public URL (e.g. Supabase storage) into a Buffer.
  // NOTE: this is NOT our backend — no auth header, no certificate pinning.
  async downloadImage(imageUrl, _redirects = 0) {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(imageUrl);
        const mod = url.protocol === 'http:' ? require('http') : require('https');
        const req = mod.get(url, (res) => {
          // Follow up to 3 redirects (storage URLs sometimes redirect)
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (_redirects >= 3) { reject(new Error('Too many redirects')); return; }
            this.downloadImage(res.headers.location, _redirects + 1).then(resolve, reject);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Image download HTTP ${res.statusCode}`));
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(20000, () => req.destroy(new Error('Image download timeout')));
      } catch (e) {
        reject(e);
      }
    });
  }

  // Authenticated JSON request. Refreshes the device session when needed and
  // retries once after a 401; a second 401 means the credentials are dead.
  async request(method, endpoint, body = null, _retry = false) {
    if (this.authMode === 'none') {
      throw new Error('Device is not paired - cannot call backend');
    }
    await this.ensureFreshToken().catch(err => {
      console.warn('[API] Pre-request token refresh failed:', err.message);
    });

    const { statusCode, data } = await this.rawRequest(method, endpoint, body, { auth: true, parse: false });

    if (statusCode === 401 && this.authMode === 'device_token') {
      if (!_retry) {
        console.warn('[API] 401 with device token - refreshing and retrying once');
        await this.refreshSession(); // throws (and clears creds) if rejected
        return this.request(method, endpoint, body, true);
      }
      this.handleCredentialsInvalid('401_after_refresh');
      throw new Error(`HTTP 401: ${data}`);
    }

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`HTTP ${statusCode}: ${data}`);
    }

    try {
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Failed to parse response: ${error.message}`);
    }
  }

  // Low-level HTTPS JSON request. Resolves with { statusCode, data, json }
  // for any HTTP status; rejects only on network / pinning errors.
  //   options.auth   attach the Authorization header (default true)
  //   options.parse  try to JSON.parse the body into .json (default true)
  async rawRequest(method, endpoint, body = null, options = {}) {
    const withAuth = options.auth !== false;
    const parse = options.parse !== false;

    return new Promise((resolve, reject) => {
      this.requestCounter++;
      const requestId = this.requestCounter;

      const url = new URL(`${this.baseUrl}${endpoint}`);

      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': `PoemBooth-Kiosk/${this.appVersion}`
      };
      const authHeader = withAuth ? this.authorizationHeader() : null;
      if (authHeader) headers['Authorization'] = authHeader;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        agent: this.pinnedAgent // Certificate pinning enabled
      };

      const bodyData = body ? JSON.stringify(body) : null;
      if (bodyData) {
        headers['Content-Length'] = Buffer.byteLength(bodyData);
      }

      // One line per request; bodies are never logged (tokens, images, poems).
      const startedAt = Date.now();
      const quiet = /\/api\/kiosk\/(print-jobs|printer-status)/.test(endpoint); // 5 s pollers
      if (!quiet) console.log(`[API] #${requestId} ${method} ${endpoint} (auth: ${authHeader ? this.authHeaderDescription() : 'none'})`);

      const req = https.request(reqOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const ms = Date.now() - startedAt;
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) {
            console.error(`[API] #${requestId} ❌ ${method} ${endpoint} HTTP ${res.statusCode} in ${ms}ms (${data.length} chars)`);
          } else if (!quiet) {
            console.log(`[API] #${requestId} ✅ HTTP ${res.statusCode} in ${ms}ms (${data.length} chars)`);
          }

          // Validate response header fingerprint (defense-in-depth)
          if (this.pinnedAgent) {
            certificatePinning.validateResponseHeader(
              certificatePinning.PINNED_FINGERPRINTS[0],
              res.headers
            );
          }

          let json = null;
          if (parse && data) {
            try { json = JSON.parse(data); } catch (e) { json = null; }
          }
          resolve({ statusCode: res.statusCode, data, json, headers: res.headers });
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

      req.on('error', () => { /* handled above */ });
      req.setTimeout(30000, () => req.destroy(new Error('Request timeout')));

      if (bodyData) {
        req.write(bodyData);
      }

      req.end();
    }).then(result => {
      if (result.statusCode === 401 && withAuth && this.authMode === 'device_token' && options.parse !== false) {
        // Callers using rawRequest directly get the raw 401; request() handles retry.
      }
      return result;
    });
  }

  // Multipart form data request (using built-in https module)
  //   options.timeoutMs  socket inactivity timeout (default 60 s)
  //   options.accept     Accept header (e.g. 'application/x-ndjson')
  //   options.onChunk    (chunkString) => void  - called for every body chunk
  //                      as it arrives (used by the NDJSON streaming client)
  // Resolves with { statusCode, headers, data } for any HTTP status; rejects
  // on network / pinning / timeout errors.
  async requestMultipart(method, endpoint, formData, options = {}) {
    if (this.authMode === 'none') {
      throw new Error('Device is not paired - cannot call backend');
    }
    // Multipart bodies are streamed and cannot be replayed, so make sure the
    // token is fresh *before* sending instead of retrying after a 401.
    await this.ensureFreshToken().catch(err => {
      console.warn('[API] Pre-request token refresh failed:', err.message);
    });

    const timeoutMs = options.timeoutMs || 60000;

    return new Promise((resolve, reject) => {
      this.requestCounter++;
      const requestId = this.requestCounter;
      const startedAt = Date.now();

      const url = new URL(`${this.baseUrl}${endpoint}`);

      const headers = {
        'Authorization': this.authorizationHeader(),
        'User-Agent': `PoemBooth-Kiosk/${this.appVersion}`,
        ...formData.getHeaders()
      };
      if (options.accept) headers['Accept'] = options.accept;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        agent: this.pinnedAgent // Certificate pinning enabled
      };

      console.log(`[API] #${requestId} ${method} ${endpoint} (multipart, auth: ${this.authHeaderDescription()})`);

      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          data += chunk;
          if (options.onChunk) {
            try { options.onChunk(chunk, res); } catch (e) { console.warn('[API] onChunk handler error:', e.message); }
          }
        });

        res.on('aborted', () => fail(new Error('Response aborted')));

        res.on('end', () => {
          if (settled) return;
          settled = true;
          const ms = Date.now() - startedAt;
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          // SECURITY: never log the body - it contains the caption/poem about the guest and image data
          (ok ? console.log : console.error)(`[API] #${requestId} ${ok ? '✅' : '❌'} HTTP ${res.statusCode} in ${ms}ms (${data.length} chars)`);

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

          if (res.statusCode === 401 && this.authMode === 'device_token') {
            // Token was fresh a moment ago, so a 401 here means the device
            // user is gone (revoked / re-paired elsewhere).
            this.handleCredentialsInvalid('401_multipart');
          }

          resolve({ statusCode: res.statusCode, headers: res.headers, data });
        });
      });

      req.setTimeout(timeoutMs, () => {
        console.error(`[API] #${requestId} ❌ timeout after ${timeoutMs}ms [${method} ${endpoint}]`);
        req.destroy(new Error(`Request timeout after ${Math.round(timeoutMs / 1000)}s`));
      });

      req.on('error', (error) => {
        // Check if this is a certificate pinning error
        if (error.message && error.message.includes('Certificate pinning')) {
          console.error(`[API] ❌ [SECURITY] MULTIPART REQUEST #${requestId} CERT PINNING FAILED [${method} ${endpoint}]`);
          console.error(`[API] [SECURITY] Hostname: ${reqOptions.hostname}`);
          console.error(`[API] [SECURITY] Error: ${error.message}`);
          // DO NOT retry - this indicates MITM attack
          fail(new Error('Connection security verification failed. Please contact support.'));
        } else {
          console.error(`[API] #${requestId} ❌ NETWORK ERROR [${method} ${endpoint}]:`, error.message);
          fail(error);
        }
      });

      // Pipe formData to request
      formData.on('error', fail);
      formData.pipe(req);
    });
  }

  // JSON convenience wrapper around requestMultipart (non-streaming callers)
  async requestMultipartJson(method, endpoint, formData, options = {}) {
    const { statusCode, data } = await this.requestMultipart(method, endpoint, formData, options);
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`HTTP ${statusCode}: ${data}`);
    }
    try {
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Failed to parse response: ${error.message}`);
    }
  }

  // Get system information
  getSystemInfo() {
    try {
      // Try to get machine ID (sync variant - the async one returns a Promise)
      let machineid = 'unknown';
      try {
        const { machineIdSync } = require('node-machine-id');
        machineid = machineIdSync();
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
        appVersion: this.appVersion
      };
    } catch (error) {
      console.error('[API] Error getting system info:', error);
      return {
        platform: process.platform,
        hostname: os.hostname(),
        machineId: 'unknown',
        appVersion: this.appVersion
      };
    }
  }
}

module.exports = ApiClient;
