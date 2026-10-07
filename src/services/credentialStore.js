// Persistent storage for the device credentials obtained through pairing.
//
// The kiosk receives a Supabase session (access + refresh token) for its own
// device user when an operator approves it on the dashboard's /pair page. The
// refresh token is the long-lived secret: it lives in userData, encrypted with
// Electron's safeStorage (DPAPI on Windows) when available.
//
// One file per backend environment so a staging pairing never leaks into
// production and vice versa.

const fs = require('fs');
const path = require('path');

class CredentialStore {
  /**
   * @param {object} options
   * @param {string} options.envName   'staging' | 'production'
   * @param {string} [options.dir]     override storage directory (defaults to userData)
   */
  constructor({ envName, dir } = {}) {
    const { app, safeStorage } = require('electron');
    this.safeStorage = safeStorage;
    this.dir = dir || app.getPath('userData');
    this.file = path.join(this.dir, `device-credentials.${envName || 'production'}.json`);
  }

  _canEncrypt() {
    try {
      return Boolean(this.safeStorage && this.safeStorage.isEncryptionAvailable());
    } catch (e) {
      return false;
    }
  }

  exists() {
    try {
      return fs.existsSync(this.file);
    } catch (e) {
      return false;
    }
  }

  /** @returns {object|null} stored credentials, or null when absent/unreadable */
  load() {
    try {
      if (!fs.existsSync(this.file)) return null;
      const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      let json;
      if (envelope.encrypted) {
        if (!this._canEncrypt()) {
          console.warn('[CREDENTIALS] Stored credentials are encrypted but safeStorage is unavailable');
          return null;
        }
        json = this.safeStorage.decryptString(Buffer.from(envelope.data, 'base64'));
      } else {
        json = envelope.data;
      }
      const creds = JSON.parse(json);
      if (!creds || typeof creds.refresh_token !== 'string') return null;
      return creds;
    } catch (error) {
      console.error('[CREDENTIALS] Failed to load credentials:', error.message);
      return null;
    }
  }

  save(credentials) {
    const json = JSON.stringify(credentials);
    let envelope;
    if (this._canEncrypt()) {
      envelope = {
        version: 1,
        encrypted: true,
        data: this.safeStorage.encryptString(json).toString('base64')
      };
    } else {
      console.warn('[CREDENTIALS] safeStorage unavailable - storing credentials unencrypted');
      envelope = { version: 1, encrypted: false, data: json };
    }
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    console.log('[CREDENTIALS] Saved device credentials to', this.file, envelope.encrypted ? '(encrypted)' : '(plain)');
  }

  clear() {
    try {
      if (fs.existsSync(this.file)) {
        fs.unlinkSync(this.file);
        console.log('[CREDENTIALS] Cleared device credentials');
      }
    } catch (error) {
      console.error('[CREDENTIALS] Failed to clear credentials:', error.message);
    }
  }
}

module.exports = CredentialStore;
