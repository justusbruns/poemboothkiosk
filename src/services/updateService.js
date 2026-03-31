/**
 * Update Service
 * Handles automatic updates via GitHub Releases
 *
 * Flow:
 * 1. Check for updates on app start
 * 2. If update available, show update screen with choice
 * 3. User can skip (for events) or install
 * 4. Download in background, then restart to install
 */

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

class UpdateService {
  constructor() {
    this.updateAvailable = false;
    this.updateInfo = null;
    this.downloadProgress = 0;
    this.updateDownloaded = false;
    this.mainWindow = null;
    this.onUpdateAvailable = null;
    this.onDownloadProgress = null;
    this.onUpdateDownloaded = null;
    this.onError = null;

    // Configure auto-updater
    autoUpdater.autoDownload = false; // We control when to download
    autoUpdater.autoInstallOnAppQuit = false; // We control when to install

    this._setupEventHandlers();
  }

  _setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      console.log('[UPDATE] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[UPDATE] Update available:', info.version);
      this.updateAvailable = true;
      this.updateInfo = info;
      if (this.onUpdateAvailable) {
        this.onUpdateAvailable(info);
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[UPDATE] No update available. Current version:', app.getVersion());
      this.updateAvailable = false;
    });

    autoUpdater.on('download-progress', (progress) => {
      this.downloadProgress = Math.round(progress.percent);
      console.log(`[UPDATE] Download progress: ${this.downloadProgress}%`);
      if (this.onDownloadProgress) {
        this.onDownloadProgress(this.downloadProgress);
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[UPDATE] Update downloaded:', info.version);
      this.updateDownloaded = true;
      if (this.onUpdateDownloaded) {
        this.onUpdateDownloaded(info);
      }
    });

    autoUpdater.on('error', (error) => {
      console.error('[UPDATE] Error:', error.message);
      if (this.onError) {
        this.onError(error);
      }
    });
  }

  /**
   * Check for updates
   * @returns {Promise<{available: boolean, info: object|null}>}
   */
  async checkForUpdates() {
    try {
      console.log('[UPDATE] Initiating update check...');
      console.log('[UPDATE] Current version:', app.getVersion());

      const result = await autoUpdater.checkForUpdates();

      return {
        available: this.updateAvailable,
        info: this.updateInfo,
        currentVersion: app.getVersion()
      };
    } catch (error) {
      console.error('[UPDATE] Check failed:', error.message);
      return {
        available: false,
        info: null,
        currentVersion: app.getVersion(),
        error: error.message
      };
    }
  }

  /**
   * Start downloading the update
   */
  async downloadUpdate() {
    if (!this.updateAvailable) {
      console.log('[UPDATE] No update available to download');
      return false;
    }

    try {
      console.log('[UPDATE] Starting download...');
      await autoUpdater.downloadUpdate();
      return true;
    } catch (error) {
      console.error('[UPDATE] Download failed:', error.message);
      return false;
    }
  }

  /**
   * Install the downloaded update and restart
   */
  installUpdate() {
    if (!this.updateDownloaded) {
      console.log('[UPDATE] No update downloaded to install');
      return false;
    }

    console.log('[UPDATE] Installing update and restarting...');
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  /**
   * Get current update status
   */
  getStatus() {
    return {
      currentVersion: app.getVersion(),
      updateAvailable: this.updateAvailable,
      updateInfo: this.updateInfo,
      downloadProgress: this.downloadProgress,
      updateDownloaded: this.updateDownloaded
    };
  }

  /**
   * Skip this update (user chose to continue without updating)
   */
  skipUpdate() {
    console.log('[UPDATE] User chose to skip update');
    this.updateAvailable = false;
  }
}

module.exports = UpdateService;
