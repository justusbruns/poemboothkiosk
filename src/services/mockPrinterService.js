/**
 * Mock Printer Service for Testing
 *
 * Simulates a printer for development and testing without wasting paper.
 * Implements the same interface as PrinterService.
 *
 * Usage:
 *   - npm run dev           → Uses mock printer by default in dev mode
 *   - npm run dev:mock-printer  → Explicitly uses mock printer
 *   - npm run dev:real-printer  → Uses real printer in dev mode
 */

const EventEmitter = require('events');

class MockPrinterService extends EventEmitter {
  constructor() {
    super();
    this.printerName = 'Mock Printer (Testing)';
    this.isAvailable = true;
    this.lastStatus = 'ready';
    this.statusCallback = null;
    this.printDelay = 3000; // Simulated print time in ms (configurable)
  }

  /**
   * Initialize mock printer service
   * @returns {Promise<boolean>} Always returns true (mock is always available)
   */
  async initialize() {
    console.log('[MOCK PRINTER] ===== INITIALIZING MOCK PRINTER SERVICE =====');
    console.log('[MOCK PRINTER] This is a simulated printer for testing');
    console.log('[MOCK PRINTER] No paper will be used - print jobs will be logged to console');

    this.isAvailable = true;
    this.lastStatus = 'ready';
    this.notifyStatusChange();

    console.log('[MOCK PRINTER] Mock printer initialized and ready');
    return true;
  }

  /**
   * Set callback for status changes
   * @param {Function} callback - Status change callback
   */
  onStatusChange(callback) {
    this.statusCallback = callback;
  }

  /**
   * Notify status change to callback
   */
  notifyStatusChange() {
    if (this.statusCallback) {
      this.statusCallback({
        available: this.isAvailable,
        status: this.lastStatus,
        printerName: this.printerName
      });
    }
  }

  /**
   * Get current printer status
   * @returns {Object} Printer status object
   */
  async getStatus() {
    return {
      available: this.isAvailable,
      status: this.lastStatus,
      printerName: this.printerName
    };
  }

  /**
   * Check if printer is ready to print
   * @returns {boolean} Ready status
   */
  isReady() {
    return this.isAvailable && (this.lastStatus === 'ready' || this.lastStatus === 'printing');
  }

  /**
   * Simulate printing an image
   *
   * @param {Buffer} imageBuffer - Image buffer to "print"
   * @param {Object} options - Print options
   * @param {string} options.printFormat - Paper size (e.g., '4x6', '4x3')
   * @param {string} options.printOrientation - 'portrait' or 'landscape'
   * @returns {Promise<boolean>} Always returns true after simulated delay
   */
  async print(imageBuffer, options = {}) {
    const printFormat = options.printFormat || '4x6';
    const printOrientation = options.printOrientation || 'portrait';

    console.log('[MOCK PRINTER] ===== SIMULATED PRINT JOB STARTED =====');
    console.log('[MOCK PRINTER] Image buffer size:', imageBuffer?.length || 0, 'bytes');
    console.log('[MOCK PRINTER] Print format:', printFormat);
    console.log('[MOCK PRINTER] Print orientation:', printOrientation);
    console.log('[MOCK PRINTER] Simulated print delay:', this.printDelay, 'ms');

    // Set status to printing
    this.lastStatus = 'printing';
    this.notifyStatusChange();
    console.log('[MOCK PRINTER] Status: printing');

    // Simulate print delay
    await new Promise(resolve => setTimeout(resolve, this.printDelay));

    console.log('[MOCK PRINTER] ===== SIMULATED PRINT JOB COMPLETED =====');
    console.log('[MOCK PRINTER] (No paper was harmed in the making of this print job)');

    // Return to ready after short delay
    setTimeout(() => {
      this.lastStatus = 'ready';
      this.notifyStatusChange();
      console.log('[MOCK PRINTER] Status: ready');
    }, 1000);

    return true;
  }

  /**
   * Set simulated print delay (for testing different scenarios)
   * @param {number} delayMs - Delay in milliseconds
   */
  setPrintDelay(delayMs) {
    this.printDelay = delayMs;
    console.log('[MOCK PRINTER] Print delay set to:', delayMs, 'ms');
  }

  /**
   * Simulate printer going offline (for error testing)
   */
  simulateOffline() {
    console.log('[MOCK PRINTER] Simulating printer offline');
    this.isAvailable = false;
    this.lastStatus = 'offline';
    this.notifyStatusChange();
  }

  /**
   * Simulate printer coming back online (for error recovery testing)
   */
  simulateOnline() {
    console.log('[MOCK PRINTER] Simulating printer back online');
    this.isAvailable = true;
    this.lastStatus = 'ready';
    this.notifyStatusChange();
  }

  /**
   * Simulate printer error (for error handling testing)
   * @param {string} errorMessage - Error message to simulate
   */
  simulateError(errorMessage = 'Simulated printer error') {
    console.log('[MOCK PRINTER] Simulating printer error:', errorMessage);
    this.lastStatus = 'error';
    this.notifyStatusChange();
  }

  /**
   * Cleanup
   */
  destroy() {
    console.log('[MOCK PRINTER] Cleaning up mock printer service...');
    this.statusCallback = null;
  }
}

module.exports = MockPrinterService;
