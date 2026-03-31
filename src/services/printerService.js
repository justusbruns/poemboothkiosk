/**
 * Printer Service for DNP DP-QW410
 *
 * Handles print job management and printer status monitoring
 * Integrates with Windows printer via Electron's printing API
 */

const { BrowserWindow } = require('electron');
const sharp = require('sharp');

// Paper size mapping: inch-based format to hundredths of inch (for System.Drawing.Printing)
// ACTUAL DNP DP-QW410 driver paper sizes available:
//   (4x3)=422x312, (4x4)=422x412, (4x4.5)=422x462, (4x6)=422x612
//   (4.5x3)=469x312, (4.5x4)=469x412, (4.5x4.5)=469x462, (4.5x6)=469x612, (4.5x8)=469x812
//
// Format names match backend API: "4x6", "4x4", "4x3", "2x6"
// Paper dimensions are in hundredths of inch (what gets sent to printer)
const PAPER_SIZES = {
  // Standard 4" wide formats (no rotation needed)
  '4x6': { width: 422, height: 612, name: '(4x6)', rotate: false },
  '4x4': { width: 422, height: 412, name: '(4x4)', rotate: false },
  '4x3': { width: 422, height: 312, name: '(4x3)', rotate: false },

  // Landscape variants (rotate 90° to fit on 4" wide paper)
  '6x4': { width: 422, height: 612, name: '(4x6)', rotate: true },
  '3x4': { width: 422, height: 312, name: '(4x3)', rotate: true },

  // Strip formats (2x6 duplicated side-by-side on 4x6 paper)
  '2x6': { width: 422, height: 612, name: '(4x6)', rotate: false, strip: true },
  '6x2': { width: 422, height: 612, name: '(4x6)', rotate: true, strip: true },
};

class PrinterService {
  constructor() {
    this.printerName = 'DP-QW410';
    this.isAvailable = false;
    this.lastStatus = 'unknown';
    this.statusCallback = null;
  }

  /**
   * Initialize printer service and detect printer
   */
  async initialize() {
    console.log('[PRINTER] ===== INITIALIZING PRINTER SERVICE =====');
    console.log('[PRINTER] Looking for printer with name:', this.printerName);

    try {
      // Get list of available printers from Electron
      console.log('[PRINTER] Enumerating available printers...');
      const printers = await this.getAvailablePrinters();

      console.log('[PRINTER] Found', printers.length, 'printer(s):');
      printers.forEach((p, index) => {
        console.log(`[PRINTER]   ${index + 1}. "${p.name}"`);
        console.log(`[PRINTER]      - Status: ${p.status || 'unknown'}`);
        console.log(`[PRINTER]      - Is Default: ${p.isDefault || false}`);
        console.log(`[PRINTER]      - Description: ${p.description || 'N/A'}`);
        console.log(`[PRINTER]      - Driver Name: ${p.displayName || 'N/A'}`);
      });

      // Find DNP printer (case-sensitive match)
      console.log('[PRINTER] Searching for exact match:', this.printerName);
      const dnpPrinter = printers.find(p => p.name === this.printerName);

      if (dnpPrinter) {
        console.log('[PRINTER] ✅ Printer driver found in system');
        console.log('[PRINTER] Basic info:', {
          name: dnpPrinter.name,
          isDefault: dnpPrinter.isDefault
        });

        // Perform enhanced physical connection check via PowerShell
        const connectionStatus = await this.checkPrinterPhysicalConnection();

        if (connectionStatus.connected) {
          // Printer is physically connected and ready
          this.isAvailable = true;
          this.lastStatus = 'ready';
          console.log('[PRINTER] ✅ Printer is physically CONNECTED and ready');
          if (connectionStatus.deviceName) {
            console.log('[PRINTER] USB device:', connectionStatus.deviceName);
          }
        } else {
          // Printer driver exists but device is not connected
          this.isAvailable = false;
          this.lastStatus = 'offline';
          console.warn('[PRINTER] ⚠️ Printer driver exists but device NOT CONNECTED');
          console.warn('[PRINTER] Reason:', connectionStatus.reason);

          if (connectionStatus.reason === 'usb_not_detected') {
            console.warn('[PRINTER] Printer queue shows online but USB device not found');
          } else if (connectionStatus.reason === 'printer_offline') {
            console.warn('[PRINTER] Printer status:', connectionStatus.printerStatus);
            console.warn('[PRINTER] Work offline:', connectionStatus.workOffline);
          }

          console.warn('[PRINTER] Please check:');
          console.warn('[PRINTER]   1. Printer is powered on');
          console.warn('[PRINTER]   2. USB cable is securely connected');
          console.warn('[PRINTER]   3. Printer shows as "Ready" in Windows settings');
        }
      } else {
        this.isAvailable = false;
        this.lastStatus = 'offline';
        console.error('[PRINTER] ❌ Target printer NOT FOUND!');
        console.error('[PRINTER] Expected printer name:', this.printerName);
        console.error('[PRINTER] Available printer names:', printers.map(p => `"${p.name}"`).join(', '));
        console.error('[PRINTER] IMPORTANT: Printer name must match EXACTLY (case-sensitive)');

        // Check for similar names (case-insensitive)
        const similarPrinters = printers.filter(p =>
          p.name.toLowerCase().includes('qw410') ||
          p.name.toLowerCase().includes('dnp')
        );

        if (similarPrinters.length > 0) {
          console.warn('[PRINTER] ⚠️ Found similar printer(s) that might be a match:');
          similarPrinters.forEach(p => {
            console.warn(`[PRINTER]    - "${p.name}"`);
          });
          console.warn('[PRINTER] Please update printerName in printerService.js to match exactly');
        }
      }

      // Notify status change
      this.notifyStatusChange();

      console.log('[PRINTER] Initialization complete. Available:', this.isAvailable);
      return this.isAvailable;
    } catch (error) {
      console.error('[PRINTER] ❌ Initialization error:', error);
      console.error('[PRINTER] Error type:', error.name);
      console.error('[PRINTER] Error message:', error.message);
      this.isAvailable = false;
      this.lastStatus = 'error';
      this.notifyStatusChange();
      return false;
    }
  }

  /**
   * Check if printer is physically connected using PowerShell
   * Performs two-tier verification:
   * 1. Check printer queue status (Get-Printer)
   * 2. Verify USB device presence (Get-PnpDevice)
   *
   * @returns {Promise<Object>} Connection status with details
   */
  /**
   * Run a PowerShell script using -EncodedCommand to avoid shell expansion issues.
   * Electron's exec() can inherit bash as shell on Windows (via Git Bash),
   * which strips $variable references from both inline commands and script files.
   */
  async runPowerShell(script) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    // Encode the script as UTF-16LE base64 for PowerShell's -EncodedCommand
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -EncodedCommand ${encoded}`,
      { timeout: 10000 }
    );
    return stdout;
  }

  async checkPrinterPhysicalConnection() {
    try {
      console.log('[PRINTER] Checking physical connection via PowerShell...');

      // Step 1: Check printer queue status
      const printerOutput = await this.runPowerShell(
        `$printer = Get-Printer -Name '${this.printerName}' -ErrorAction SilentlyContinue\n` +
        `if ($printer) {\n` +
        `  [PSCustomObject]@{\n` +
        `    Name = $printer.Name\n` +
        `    PrinterStatus = [int]$printer.PrinterStatus\n` +
        `    WorkOffline = $printer.WorkOffline\n` +
        `    Type = $printer.Type\n` +
        `  } | ConvertTo-Json\n` +
        `} else {\n` +
        `  '{"Error":"NotFound"}'\n` +
        `}`
      );
      const printerInfo = JSON.parse(printerOutput.trim());

      if (printerInfo.Error === 'NotFound') {
        console.log('[PRINTER] ❌ Printer driver not found via Get-Printer');
        return { connected: false, reason: 'driver_not_found' };
      }

      console.log('[PRINTER] Printer queue info:', {
        status: printerInfo.PrinterStatus,
        offline: printerInfo.WorkOffline,
        type: printerInfo.Type
      });

      // PrinterStatus values vary by driver:
      //   - Microsoft standard: 3 = Idle/Normal
      //   - Some OEM drivers (like DNP DP-QW410): 0 = Normal/Ready
      // WorkOffline: null or false means NOT in offline mode
      const isNotOffline = printerInfo.WorkOffline === false || printerInfo.WorkOffline === null;
      const hasValidStatus = printerInfo.PrinterStatus === 0 || printerInfo.PrinterStatus === 3;

      if (hasValidStatus && isNotOffline) {
        console.log('[PRINTER] ✅ Printer queue status: Normal and Online');

        // Step 2: Verify USB device is physically present
        const usbOutput = await this.runPowerShell(
          `$devices = @(Get-PnpDevice -FriendlyName '*QW410*' -Status OK -ErrorAction SilentlyContinue)\n` +
          `Write-Output $devices.Count`
        );
        const deviceCount = parseInt(usbOutput.trim(), 10);

        if (deviceCount > 0) {
          console.log('[PRINTER] ✅ USB device physically connected (found', deviceCount, 'OK devices)');
          return {
            connected: true,
            printerStatus: printerInfo.PrinterStatus,
            usbPresent: true,
            deviceCount: deviceCount
          };
        } else {
          console.log('[PRINTER] ⚠️ Printer queue exists but USB device not detected');
          return {
            connected: false,
            reason: 'usb_not_detected',
            printerStatus: printerInfo.PrinterStatus
          };
        }
      } else {
        console.log('[PRINTER] ⚠️ Printer offline or error state');
        return {
          connected: false,
          reason: 'printer_offline',
          printerStatus: printerInfo.PrinterStatus,
          workOffline: printerInfo.WorkOffline
        };
      }

    } catch (error) {
      console.error('[PRINTER] ❌ Error checking physical connection:', error.message);
      return { connected: false, reason: 'check_failed', error: error.message };
    }
  }

  /**
   * Get list of available printers
   */
  async getAvailablePrinters() {
    try {
      // Get main window to access webContents
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 0) {
        throw new Error('No browser windows available');
      }

      const mainWindow = windows[0];

      // Use getPrintersAsync() which is the correct Electron API
      return new Promise((resolve, reject) => {
        mainWindow.webContents.getPrintersAsync().then((printers) => {
          resolve(printers);
        }).catch((error) => {
          console.error('[PRINTER] getPrintersAsync error:', error);
          // Fallback: assume printer exists if we can't enumerate
          // Check with PowerShell or just return empty array
          resolve([]);
        });
      });
    } catch (error) {
      console.error('[PRINTER] Error getting printers:', error);
      return [];
    }
  }

  /**
   * Print image buffer to DNP printer
   *
   * @param {Buffer} imageBuffer - High-resolution image buffer (PNG or JPEG)
   * @param {Object} options - Print options
   * @param {string} options.printFormat - Paper size (e.g., '10x15cm', '10x10cm')
   * @param {string} options.printOrientation - 'portrait' or 'landscape'
   * @returns {Promise<boolean>} - Success status
   */
  async print(imageBuffer, options = {}) {
    const printFormat = options.printFormat || '4x6';
    const printOrientation = options.printOrientation || 'portrait';

    console.log('[PRINTER] ===== PRINT JOB STARTING =====');
    console.log('[PRINTER] Image buffer size:', imageBuffer.length, 'bytes');
    console.log('[PRINTER] Print format:', printFormat);
    console.log('[PRINTER] Print orientation:', printOrientation);
    console.log('[PRINTER] Printer available:', this.isAvailable);
    console.log('[PRINTER] Printer status:', this.lastStatus);
    console.log('[PRINTER] Printer name:', this.printerName);

    // Get paper dimensions from mapping
    const paperSize = PAPER_SIZES[printFormat] || PAPER_SIZES['4x6'];
    console.log('[PRINTER] Paper dimensions:', paperSize);

    if (!this.isAvailable) {
      console.error('[PRINTER] ❌ Printer not available - aborting print');
      this.lastStatus = 'offline';
      this.notifyStatusChange();
      throw new Error('Printer not available');
    }

    try {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Get image dimensions to determine orientation for smart rotation
      const metadata = await sharp(imageBuffer).metadata();
      const imageWidth = metadata.width;
      const imageHeight = metadata.height;
      const isImagePortrait = imageHeight > imageWidth;
      console.log(`[PRINTER] Image dimensions: ${imageWidth}x${imageHeight} (${isImagePortrait ? 'portrait' : 'landscape'})`);

      // Determine paper orientation from PAPER_SIZES dimensions
      const isPaperPortrait = paperSize.height > paperSize.width;
      console.log(`[PRINTER] Paper orientation: ${isPaperPortrait ? 'portrait' : 'landscape'}`);

      // Rotation logic:
      // 1. If printOrientation is 'landscape', always rotate 90° (content designed for landscape viewing)
      // 2. Otherwise, use smart rotation based on image vs paper shape mismatch
      const landscapeRequested = printOrientation === 'landscape';
      const shapeMismatch = isImagePortrait !== isPaperPortrait;
      const needsRotation = landscapeRequested || shapeMismatch;
      console.log(`[PRINTER] Landscape requested: ${landscapeRequested}`);
      console.log(`[PRINTER] Shape mismatch: ${shapeMismatch} (image ${isImagePortrait ? 'portrait' : 'landscape'} vs paper ${isPaperPortrait ? 'portrait' : 'landscape'})`);
      console.log(`[PRINTER] Rotation needed: ${needsRotation}`);

      // Handle 2x6 strip duplication (creates 4x6 layout with two strips side-by-side)
      let printBuffer = imageBuffer;
      if (paperSize.strip) {
        console.log('[PRINTER] Strip format detected - creating 2x6 duplicate layout');
        printBuffer = await this.createStripLayout(imageBuffer, needsRotation);
      }

      // Save image to temporary file
      const tempDir = os.tmpdir();
      const tempFileName = `poembooth-print-${Date.now()}.jpg`;
      const tempFilePath = path.join(tempDir, tempFileName);

      console.log('[PRINTER] Saving image to temp file:', tempFilePath);
      fs.writeFileSync(tempFilePath, printBuffer);
      console.log('[PRINTER] ✓ Image saved to temp file');

      // Update status
      this.lastStatus = 'printing';
      this.notifyStatusChange();
      console.log('[PRINTER] Status set to "printing"');

      // Print using PowerShell - save script to file to avoid escaping issues
      const printerNameEscaped = this.printerName.replace(/'/g, "''");
      const tempFilePathEscaped = tempFilePath.replace(/'/g, "''");
      const isLandscape = printOrientation === 'landscape';
      const targetWidth = paperSize.width;
      const targetHeight = paperSize.height;
      // needsRotation is now computed above via smart auto-detection (line 328)

      // PowerShell script to print with dynamic paper size and aspect-ratio cropping
      const psScript =
`try {
  Add-Type -AssemblyName System.Drawing
  Write-Host "Assemblies loaded"

  \$img = [System.Drawing.Image]::FromFile('${tempFilePathEscaped}')
  Write-Host "Image loaded: \$(\$img.Width)x\$(\$img.Height)"

  # Auto-rotate logic based on smart orientation detection
  # Compares actual image orientation (portrait vs landscape) to paper orientation
  # Only rotates when orientations don't match, regardless of format name

  \$needsRotation = \$${needsRotation}  # Determined by smart auto-detection (image vs paper orientation)

  Write-Host "Print format: ${printFormat}"
  Write-Host "Target paper: ${targetWidth}x${targetHeight} hundredths (${paperSize.name})"
  Write-Host "Image dimensions: \$(\$img.Width)x\$(\$img.Height)"
  Write-Host "Needs rotation: \$needsRotation"

  if (\$needsRotation) {
    \$img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
    Write-Host "AUTO-ROTATED 90 degrees to match paper orientation"
    Write-Host "New dimensions: \$(\$img.Width)x\$(\$img.Height)"
  } else {
    Write-Host "No rotation needed - image orientation matches paper"
  }

  \$pd = New-Object System.Drawing.Printing.PrintDocument
  \$pd.PrinterSettings.PrinterName = '${printerNameEscaped}'
  Write-Host "Printer set: ${printerNameEscaped}"

  # Target paper size: ${printFormat} (${targetWidth}x${targetHeight} hundredths of inch)
  \$targetPaperWidth = ${targetWidth}
  \$targetPaperHeight = ${targetHeight}
  Write-Host "Target paper size: \$targetPaperWidth x \$targetPaperHeight hundredths"

  # List available paper sizes and find best match
  Write-Host "Available paper sizes:"
  \$bestMatch = \$null
  \$bestDiff = [int]::MaxValue
  foreach (\$size in \$pd.PrinterSettings.PaperSizes) {
    Write-Host "  - \$(\$size.PaperName): \$(\$size.Width)x\$(\$size.Height)"
    # Calculate difference from target
    \$diff = [Math]::Abs(\$size.Width - \$targetPaperWidth) + [Math]::Abs(\$size.Height - \$targetPaperHeight)
    if (\$diff -lt \$bestDiff) {
      \$bestDiff = \$diff
      \$bestMatch = \$size
    }
  }

  if (\$bestMatch -and \$bestDiff -lt 50) {
    \$pd.DefaultPageSettings.PaperSize = \$bestMatch
    Write-Host "MATCHED paper: \$(\$bestMatch.PaperName) (\$(\$bestMatch.Width)x\$(\$bestMatch.Height)) diff=\$bestDiff"
  } else {
    Write-Host "No close paper match found (best diff=\$bestDiff) - using printer default"
  }

  # Set orientation
  \$pd.DefaultPageSettings.Landscape = \$${isLandscape ? 'true' : 'false'}
  Write-Host "Orientation: ${printOrientation}"

  # Zero margins for full bleed
  \$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)

  \$pd.Add_PrintPage({
    param(\$sender, \$ev)
    \$bounds = \$ev.MarginBounds
    Write-Host "Print bounds: \$(\$bounds.Width)x\$(\$bounds.Height)"

    # Calculate target aspect ratio from paper
    \$targetRatio = \$bounds.Width / \$bounds.Height
    Write-Host "Target aspect ratio: \$targetRatio"

    # Calculate source aspect ratio
    \$sourceRatio = \$img.Width / \$img.Height
    Write-Host "Source aspect ratio: \$sourceRatio"

    # Calculate crop rectangle to match target aspect ratio (center crop)
    if (\$sourceRatio -gt \$targetRatio) {
      # Source is wider than target - crop horizontally
      \$newWidth = [int](\$img.Height * \$targetRatio)
      \$cropX = [int]((\$img.Width - \$newWidth) / 2)
      \$srcRect = New-Object System.Drawing.Rectangle(\$cropX, 0, \$newWidth, \$img.Height)
      Write-Host "Cropping horizontally: x=\$cropX, width=\$newWidth"
    } else {
      # Source is taller than target - crop vertically
      \$newHeight = [int](\$img.Width / \$targetRatio)
      \$cropY = [int]((\$img.Height - \$newHeight) / 2)
      \$srcRect = New-Object System.Drawing.Rectangle(0, \$cropY, \$img.Width, \$newHeight)
      Write-Host "Cropping vertically: y=\$cropY, height=\$newHeight"
    }

    # Destination rectangle fills the print area
    \$destRect = New-Object System.Drawing.Rectangle(0, 0, \$bounds.Width, \$bounds.Height)

    # Draw cropped image to fill paper (maintains aspect ratio, no stretching)
    \$ev.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    \$ev.Graphics.DrawImage(\$img, \$destRect, \$srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    Write-Host "Image drawn with crop-to-fit"

    \$ev.HasMorePages = \$false
  })

  Write-Host "Calling Print()..."
  \$pd.Print()
  Write-Host "Print() completed"

  \$img.Dispose()
  Write-Host "Success"
} catch {
  Write-Host "ERROR: \$_"
  exit 1
}`;

      // Save PowerShell script to temp file
      const psScriptPath = path.join(tempDir, `poembooth-print-${Date.now()}.ps1`);
      fs.writeFileSync(psScriptPath, psScript, 'utf8');
      console.log('[PRINTER] PowerShell script saved to:', psScriptPath);

      const printCommand = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`;

      console.log('[PRINTER] Executing PowerShell script file');
      console.log('[PRINTER] This will list all available paper sizes from DNP');

      try {
        const { stdout, stderr } = await execAsync(printCommand, { timeout: 30000 });
        console.log('[PRINTER] PowerShell stdout:', stdout);
        if (stderr) console.log('[PRINTER] PowerShell stderr:', stderr);
        console.log('[PRINTER] ✅ Print command executed successfully');

        // SECURITY: Delete temp files IMMEDIATELY after print (guest data)
        try {
          fs.unlinkSync(psScriptPath);
          console.log('[PRINTER] ✓ PowerShell script deleted');
        } catch (e) {
          console.warn('[PRINTER] Failed to delete PS script:', e.message);
        }

        try {
          fs.unlinkSync(tempFilePath);
          console.log('[PRINTER] ✓ Temp image deleted immediately');
        } catch (cleanupError) {
          console.warn('[PRINTER] Failed to delete temp file:', cleanupError.message);
        }

        // Reset status after print completes
        console.log('[PRINTER] Scheduling status reset to "ready" in 20 seconds...');
        setTimeout(() => {
          this.lastStatus = 'ready';
          this.notifyStatusChange();
          console.log('[PRINTER] Status reset to "ready"');
        }, 20000);

        return true;

      } catch (cmdError) {
        console.error('[PRINTER] ❌ Print command failed:', cmdError.message);

        // SECURITY: Clean up temp files immediately even on error
        try {
          if (fs.existsSync(psScriptPath)) fs.unlinkSync(psScriptPath);
          if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
          console.log('[PRINTER] ✓ Temp files deleted after error');
        } catch (cleanupError) {
          console.warn('[PRINTER] Cleanup error:', cleanupError.message);
        }

        this.lastStatus = 'error';
        this.notifyStatusChange();
        return false;
      }

    } catch (error) {
      console.error('[PRINTER] ❌ Print exception:', error);
      console.error('[PRINTER] Exception type:', error.name);
      console.error('[PRINTER] Exception message:', error.message);
      console.error('[PRINTER] Exception stack:', error.stack);
      this.lastStatus = 'error';
      this.notifyStatusChange();
      throw error;
    }
  }

  /**
   * Detect MIME type from buffer header
   */
  detectMimeType(buffer) {
    // Check PNG signature
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }
    // Check JPEG signature
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    // Default to JPEG
    return 'image/jpeg';
  }

  /**
   * Get current printer status
   * Returns cached status from last initialization - does not re-detect
   */
  async getStatus() {
    // Return cached status instead of re-initializing
    // The printer status is set during initialize() and updated via notifyStatusChange()
    // Re-detection is expensive and can fail intermittently during busy processing
    return {
      available: this.isAvailable,
      status: this.lastStatus,
      printerName: this.printerName
    };
  }

  /**
   * Set callback for status changes
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
   * Check if printer is ready to print
   */
  isReady() {
    return this.isAvailable && (this.lastStatus === 'ready' || this.lastStatus === 'printing');
  }

  /**
   * Create 2x6 strip layout by duplicating image side-by-side on 4x6 paper
   * The printer will cut vertically producing two 2x6 strips
   *
   * @param {Buffer} imageBuffer - Original 2x6 image buffer
   * @param {boolean} rotate - Whether the source image needs 90 degree rotation
   * @returns {Promise<Buffer>} - 4x6 layout with two 2x6 strips side by side
   */
  async createStripLayout(imageBuffer, rotate) {
    // Target: 4x6 at 300 DPI = 1200x1800 pixels
    const layoutWidth = 1200;
    const layoutHeight = 1800;
    const stripWidth = 600;  // Each strip is 2" = 600px at 300 DPI

    let stripImage = sharp(imageBuffer);

    // If source needs rotation, apply it
    if (rotate) {
      stripImage = stripImage.rotate(90);
    }

    // Resize to strip dimensions (2x6 = 600x1800 at 300 DPI)
    const resizedStrip = await stripImage
      .resize(stripWidth, layoutHeight, {
        fit: 'cover',
        position: 'center'
      })
      .toBuffer();

    // Create 4x6 canvas with two strips side by side
    const layout = await sharp({
      create: {
        width: layoutWidth,
        height: layoutHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .composite([
        { input: resizedStrip, left: 0, top: 0 },           // Left strip
        { input: resizedStrip, left: stripWidth, top: 0 }   // Right strip
      ])
      .jpeg({ quality: 95 })
      .toBuffer();

    console.log('[PRINTER] Created 2x6 strip layout:', layout.length, 'bytes');
    return layout;
  }

  /**
   * Cleanup
   */
  destroy() {
    console.log('[PRINTER] Cleaning up printer service...');
    this.statusCallback = null;
  }
}

module.exports = PrinterService;
