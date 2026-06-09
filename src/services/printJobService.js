/**
 * PrintJobService — bridges the web portal's "Print" button to the local printer.
 *
 * Runs entirely in the main process. Two responsibilities:
 *  1. Report printer connectivity/status to the backend so the portal can
 *     show/hide its print button (POST /api/kiosk/printer-status).
 *  2. Poll for portal-requested print jobs, fetch the rendered image, print it,
 *     and report completion (GET/PATCH /api/kiosk/print-jobs).
 *
 * The kiosk is the only party with the printer, so all printing happens here.
 * Guests trigger a job from their phone; this service picks it up and prints.
 */
class PrintJobService {
  /**
   * @param {object} deps
   * @param {object} deps.apiClient - initialized ApiClient
   * @param {function} deps.getPrinterService - returns the current printerService (or null)
   */
  constructor({ apiClient, getPrinterService }) {
    this.apiClient = apiClient;
    this.getPrinterService = getPrinterService;

    this.statusTimer = null;
    this.pollTimer = null;
    this.polling = false;
    this.processing = new Set(); // job ids currently in flight (avoid double-print)

    // How often to report printer status and poll for jobs
    this.STATUS_INTERVAL_MS = 60 * 1000; // 60s heartbeat (portal freshness check ~3min)
    this.POLL_INTERVAL_MS = 5 * 1000;    // 5s — snappy enough for a guest waiting at the booth
  }

  start() {
    if (this.statusTimer || this.pollTimer) return;
    console.log('[PRINTJOB] Starting printer-status reporting + print-job polling');
    // Report status immediately so the portal button reflects reality fast
    this.reportStatus();
    this.statusTimer = setInterval(() => this.reportStatus(), this.STATUS_INTERVAL_MS);
    this.pollTimer = setInterval(() => this.poll(), this.POLL_INTERVAL_MS);
  }

  stop() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.statusTimer = null;
    this.pollTimer = null;
  }

  async currentStatus() {
    const printer = this.getPrinterService();
    if (!printer) return { connected: false, status: 'offline' };
    try {
      const s = await printer.getStatus();
      return { connected: !!s.available, status: s.status || 'unknown' };
    } catch (e) {
      return { connected: false, status: 'error' };
    }
  }

  async reportStatus() {
    const { connected, status } = await this.currentStatus();
    await this.apiClient.reportPrinterStatus(connected, status);
  }

  // Called from the printer's onStatusChange callback for an immediate update
  async onPrinterStatusChange() {
    await this.reportStatus();
  }

  async poll() {
    if (this.polling) return; // avoid overlapping polls
    this.polling = true;
    try {
      const jobs = await this.apiClient.getPrintJobs();
      for (const job of jobs) {
        if (!job || !job.id || this.processing.has(job.id)) continue;
        this.processing.add(job.id);
        // Fire-and-forget; each job cleans up its own processing flag
        this.handleJob(job).finally(() => this.processing.delete(job.id));
      }
    } catch (e) {
      console.error('[PRINTJOB] poll error:', e.message);
    } finally {
      this.polling = false;
    }
  }

  async handleJob(job) {
    const printer = this.getPrinterService();
    console.log(`[PRINTJOB] Handling job ${job.id} (session ${job.session_id}, ${job.print_format}/${job.print_orientation})`);

    if (!printer) {
      console.warn('[PRINTJOB] No printer available — marking job failed');
      await this.apiClient.updatePrintJob(job.id, 'failed');
      return;
    }
    if (!job.rendered_image_url) {
      console.warn('[PRINTJOB] Job has no rendered_image_url — marking failed');
      await this.apiClient.updatePrintJob(job.id, 'failed');
      return;
    }

    try {
      // Claim the job so other polls (and other kiosks) skip it
      await this.apiClient.updatePrintJob(job.id, 'printing');

      const buffer = await this.apiClient.downloadImage(job.rendered_image_url);
      console.log(`[PRINTJOB] Downloaded image for job ${job.id}: ${buffer.length} bytes`);

      const ok = await printer.print(buffer, {
        printFormat: job.print_format || '4x6',
        printOrientation: job.print_orientation || 'portrait'
      });

      await this.apiClient.updatePrintJob(job.id, ok ? 'completed' : 'failed');
      console.log(`[PRINTJOB] Job ${job.id} ${ok ? 'completed ✅' : 'failed ❌'}`);
    } catch (e) {
      console.error(`[PRINTJOB] Job ${job.id} error:`, e.message);
      try { await this.apiClient.updatePrintJob(job.id, 'failed'); } catch (_) {}
    }
  }
}

module.exports = PrintJobService;
