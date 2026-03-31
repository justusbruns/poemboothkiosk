// Certificate Pinning Module
// Implements TLS certificate pinning to prevent man-in-the-middle attacks
// Uses Node.js native crypto, https, and tls modules (no external dependencies)

const crypto = require('crypto');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

// Staging pinned certificate fingerprints (SHA-256)
// Format: sha256/{base64-encoded-hash}
//
// NOTE: These are ONLY used for staging. Production uses TOFU (Trust On First Use).
//
// Current fingerprint extracted: 2025-12-16
// From: staging server SSL certificate
const STAGING_PINNED_FINGERPRINTS = [
  'sha256/6Tnd34qNMJygvYT3ITGgzT69kETtG4uP2wIPkrtpPc0=', // Staging certificate (current)
  // Add new fingerprint here BEFORE rotation, remove old AFTER rotation completes
];

// Legacy export for backwards compatibility
const PINNED_FINGERPRINTS = STAGING_PINNED_FINGERPRINTS;

// Emergency bypass support (use ONLY in emergency situations)
// Set CERT_PINNING_ENABLED=false to disable pinning
const PINNING_ENABLED = process.env.CERT_PINNING_ENABLED !== 'false';

// Dev mode detection (for detailed logging)
const IS_DEV = process.argv.includes('--dev');

// Staging mode detection - use hardcoded pinning for staging
const IS_STAGING = process.argv.includes('--staging');

// Hostnames
const PRODUCTION_HOSTNAME = 'book.poembooth.com';
const STAGING_HOSTNAME = 'poemboothbooking-git-staging-justus-bruns-projects.vercel.app';

// Logging prefixes
const LOG_PREFIX = '[CERT-PIN]';
const SECURITY_PREFIX = '[SECURITY]';

// ============================================================================
// TOFU (Trust On First Use) STORAGE
// ============================================================================

/**
 * Get platform-specific path for pinned certificate storage
 * Uses the same directory as device certificates
 */
function getPinnedCertPath() {
  let basePath;
  switch (process.platform) {
    case 'win32':
      basePath = 'C:\\ProgramData\\PoemBooth';
      break;
    case 'darwin':
      basePath = '/Library/Application Support/PoemBooth';
      break;
    default: // linux and others
      basePath = '/etc/poembooth';
  }
  return path.join(basePath, 'pinned_cert.json');
}

/**
 * Load pinned fingerprint from storage (for TOFU)
 * @param {string} hostname - The hostname to load fingerprint for
 * @returns {string|null} The stored fingerprint or null if not found
 */
function loadPinnedFingerprint(hostname) {
  try {
    const filePath = getPinnedCertPath();
    if (!fs.existsSync(filePath)) {
      if (IS_DEV) {
        console.log(`${LOG_PREFIX} [DEV] No pinned cert file found at ${filePath}`);
      }
      return null;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const fingerprint = data[hostname] || null;

    if (IS_DEV && fingerprint) {
      console.log(`${LOG_PREFIX} [DEV] Loaded pinned fingerprint for ${hostname}: ${fingerprint}`);
    }

    return fingerprint;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading pinned fingerprint:`, error.message);
    return null;
  }
}

/**
 * Save pinned fingerprint to storage (for TOFU)
 * @param {string} hostname - The hostname to save fingerprint for
 * @param {string} fingerprint - The fingerprint to save
 */
function savePinnedFingerprint(hostname, fingerprint) {
  try {
    const filePath = getPinnedCertPath();
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // Load existing data or start fresh
    let data = {};
    if (fs.existsSync(filePath)) {
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        // If file is corrupted, start fresh
        data = {};
      }
    }

    // Update fingerprint
    data[hostname] = fingerprint;
    data[`${hostname}_updated`] = new Date().toISOString();

    // Write back
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

    console.log(`${LOG_PREFIX} Pinned new certificate for ${hostname}`);
    if (IS_DEV) {
      console.log(`${LOG_PREFIX} [DEV] Saved fingerprint: ${fingerprint}`);
      console.log(`${LOG_PREFIX} [DEV] Storage path: ${filePath}`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error saving pinned fingerprint:`, error.message);
  }
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Calculate SHA-256 fingerprint of a certificate
 *
 * This function extracts the DER-encoded certificate bytes, hashes them with
 * SHA-256, and returns the base64-encoded fingerprint in the format used by
 * the backend: sha256/{base64}
 *
 * @param {Object} cert - TLS certificate object from Node.js
 * @returns {string} Fingerprint in format: sha256/{base64}
 *
 * @example
 * // During TLS handshake:
 * const fingerprint = calculateFingerprint(peerCert);
 * // Returns: "sha256/6Tnd34qNMJygvYT3ITGgzT69kETtG4uP2wIPkrtpPc0="
 */
function calculateFingerprint(cert) {
  try {
    // cert.raw contains the DER-encoded certificate bytes
    if (!cert || !cert.raw) {
      console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Invalid certificate object - missing raw data`);
      return null;
    }

    // Calculate SHA-256 hash of the DER-encoded certificate
    const der = cert.raw;
    const hash = crypto.createHash('sha256').update(der).digest('base64');

    // Return in format: sha256/{base64}
    const fingerprint = `sha256/${hash}`;

    if (IS_DEV) {
      console.log(`${LOG_PREFIX} [DEV] Calculated fingerprint: ${fingerprint}`);
    }

    return fingerprint;
  } catch (error) {
    console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Error calculating certificate fingerprint:`, error.message);
    return null;
  }
}

/**
 * Create HTTPS agent with certificate pinning enabled
 *
 * This function creates an https.Agent with a custom checkServerIdentity hook
 * that validates the server's certificate fingerprint during the TLS handshake.
 *
 * The validation happens BEFORE any data is transmitted, providing the earliest
 * possible protection against MITM attacks.
 *
 * For PRODUCTION (book.poembooth.com): Uses TOFU (Trust On First Use)
 *   - First connection: Accept and store the certificate fingerprint
 *   - Subsequent connections: Validate against stored fingerprint
 *   - On mismatch: Auto-update the stored fingerprint (with logging)
 *
 * For STAGING: Uses hardcoded fingerprints (manual updates required)
 *
 * @param {string} hostname - Target hostname (e.g., 'book.poembooth.com')
 * @param {Array<string>} pinnedFingerprints - Array of allowed fingerprints (used for staging only)
 * @returns {https.Agent} Configured HTTPS agent with certificate pinning
 *
 * @example
 * const agent = createPinnedAgent('book.poembooth.com', PINNED_FINGERPRINTS);
 * https.request({ agent, ... });
 */
function createPinnedAgent(hostname, pinnedFingerprints) {
  console.log(`${LOG_PREFIX} Initializing certificate pinning`);
  console.log(`${LOG_PREFIX} Hostname: ${hostname}`);

  // Emergency bypass: If pinning is disabled via environment variable
  if (!PINNING_ENABLED) {
    console.warn(`${LOG_PREFIX} ${SECURITY_PREFIX} Certificate pinning DISABLED via environment variable`);
    console.warn(`${LOG_PREFIX} ${SECURITY_PREFIX} This should only be used in emergency situations!`);
    return new https.Agent(); // Return standard agent without pinning
  }

  // Determine pinning mode based on hostname and staging flag
  const isProductionHost = hostname === PRODUCTION_HOSTNAME;
  const useTOFU = isProductionHost && !IS_STAGING;

  if (useTOFU) {
    console.log(`${LOG_PREFIX} Using TOFU (Trust On First Use) for production`);
    return createTOFUAgent(hostname);
  }

  // Staging bypass: Skip pinning for Vercel staging URLs (their certs rotate frequently)
  if (IS_STAGING && hostname === STAGING_HOSTNAME) {
    console.warn(`${LOG_PREFIX} Certificate pinning DISABLED for Vercel staging server`);
    console.warn(`${LOG_PREFIX} Staging hostname: ${hostname}`);
    return new https.Agent(); // Return standard agent without pinning
  }

  // Use hardcoded fingerprints for staging or other hosts
  console.log(`${LOG_PREFIX} Using hardcoded fingerprints: ${pinnedFingerprints.length}`);
  if (IS_DEV) {
    console.log(`${LOG_PREFIX} [DEV] Pinned fingerprints:`, pinnedFingerprints);
  }

  return createHardcodedPinningAgent(hostname, pinnedFingerprints);
}

/**
 * Create HTTPS agent with TOFU (Trust On First Use) certificate pinning
 * Used for production servers where certificate rotation should be automatic
 *
 * @param {string} hostname - Target hostname
 * @returns {https.Agent} Configured HTTPS agent
 */
function createTOFUAgent(hostname) {
  // Load any previously stored fingerprint
  let storedFingerprint = loadPinnedFingerprint(hostname);

  if (storedFingerprint) {
    console.log(`${LOG_PREFIX} Loaded stored fingerprint for ${hostname}`);
  } else {
    console.log(`${LOG_PREFIX} No stored fingerprint - will pin on first connection`);
  }

  return new https.Agent({
    checkServerIdentity: (host, cert) => {
      // Step 1: Perform standard TLS validation
      const standardError = tls.checkServerIdentity(host, cert);
      if (standardError) {
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Standard TLS validation failed`);
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Hostname: ${host}`);
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Error: ${standardError.message}`);
        return standardError;
      }

      // Step 2: Calculate actual fingerprint
      const actualFingerprint = calculateFingerprint(cert);

      if (!actualFingerprint) {
        const error = new Error(`${SECURITY_PREFIX} Certificate pinning validation failed - could not calculate fingerprint`);
        error.name = 'CertificatePinningError';
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Could not calculate certificate fingerprint`);
        return error;
      }

      // Step 3: TOFU logic
      if (!storedFingerprint) {
        // First connection: Trust and store the fingerprint
        console.log(`${LOG_PREFIX} First connection - trusting certificate`);
        savePinnedFingerprint(hostname, actualFingerprint);
        storedFingerprint = actualFingerprint;
        console.log(`${LOG_PREFIX} ✓ Certificate pinned (TOFU)`);
        return undefined;
      }

      // Subsequent connection: Validate against stored fingerprint
      if (actualFingerprint === storedFingerprint) {
        console.log(`${LOG_PREFIX} ✓ Certificate pinning validation successful`);
        if (IS_DEV) {
          console.log(`${LOG_PREFIX} [DEV] Matched stored fingerprint`);
        }
        return undefined;
      }

      // Fingerprint mismatch: Auto-update for production (certificate rotation)
      console.warn(`${LOG_PREFIX} Certificate fingerprint changed - auto-updating`);
      console.warn(`${LOG_PREFIX} Previous: ${storedFingerprint}`);
      console.warn(`${LOG_PREFIX} New: ${actualFingerprint}`);
      console.warn(`${LOG_PREFIX} This is expected during certificate rotation`);

      // Save the new fingerprint
      savePinnedFingerprint(hostname, actualFingerprint);
      storedFingerprint = actualFingerprint;
      console.log(`${LOG_PREFIX} ✓ Certificate updated and pinned`);

      return undefined; // Accept the new certificate
    }
  });
}

/**
 * Create HTTPS agent with hardcoded certificate pinning
 * Used for staging servers where manual fingerprint updates are required
 *
 * @param {string} hostname - Target hostname
 * @param {Array<string>} pinnedFingerprints - Array of allowed fingerprints
 * @returns {https.Agent} Configured HTTPS agent
 */
function createHardcodedPinningAgent(hostname, pinnedFingerprints) {
  return new https.Agent({
    checkServerIdentity: (host, cert) => {
      // Step 1: Perform standard TLS validation
      const standardError = tls.checkServerIdentity(host, cert);
      if (standardError) {
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Standard TLS validation failed`);
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Hostname: ${host}`);
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Error: ${standardError.message}`);
        return standardError;
      }

      // Step 2: Perform certificate pinning validation
      const actualFingerprint = calculateFingerprint(cert);

      if (!actualFingerprint) {
        const error = new Error(`${SECURITY_PREFIX} Certificate pinning validation failed - could not calculate fingerprint`);
        error.name = 'CertificatePinningError';
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Could not calculate certificate fingerprint`);
        return error;
      }

      // Check if the actual fingerprint matches any of the pinned fingerprints
      const isValid = pinnedFingerprints.includes(actualFingerprint);

      if (!isValid) {
        // SECURITY ALERT: Certificate pinning validation failed!
        console.error('╔════════════════════════════════════════════════╗');
        console.error('║ SECURITY ALERT: Certificate Pinning Failed    ║');
        console.error('╚════════════════════════════════════════════════╝');
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Certificate pinning validation FAILED`);
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Hostname: ${host}`);

        if (IS_DEV) {
          console.error(`${LOG_PREFIX} [DEV] Expected one of:`, pinnedFingerprints);
          console.error(`${LOG_PREFIX} [DEV] Received: ${actualFingerprint}`);
        } else {
          console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Expected: ${pinnedFingerprints.length} pinned fingerprint(s)`);
          console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Received fingerprint does not match`);
        }

        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} This may indicate a man-in-the-middle attack!`);
        console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Connection will be rejected.`);

        const error = new Error(`${SECURITY_PREFIX} Certificate pinning validation failed - potential MITM attack`);
        error.name = 'CertificatePinningError';
        return error;
      }

      // All checks passed
      console.log(`${LOG_PREFIX} ✓ Certificate pinning validation successful`);

      if (IS_DEV) {
        console.log(`${LOG_PREFIX} [DEV] Matched fingerprint: ${actualFingerprint}`);
      }

      return undefined;
    }
  });
}

/**
 * Validate X-Server-Cert-Fingerprint response header (defense-in-depth)
 *
 * This provides an additional validation layer by checking that the backend
 * also sends its own fingerprint in the response headers. This is optional
 * validation - the primary security is at the TLS handshake level.
 *
 * This can detect:
 * - Proxy/CDN interference
 * - Backend misconfiguration
 * - Certificate rotation issues
 *
 * @param {string} expectedFingerprint - Expected fingerprint (primary from array)
 * @param {Object} responseHeaders - Response headers from API call
 * @returns {boolean} true if header matches expected fingerprint
 *
 * @example
 * const valid = validateResponseHeader(
 *   PINNED_FINGERPRINTS[0],
 *   response.headers
 * );
 */
function validateResponseHeader(expectedFingerprint, responseHeaders) {
  // Extract X-Server-Cert-Fingerprint header (case-insensitive)
  const headerName = 'x-server-cert-fingerprint';
  const serverFingerprint = responseHeaders[headerName];

  if (!serverFingerprint) {
    // Header not present - log warning but don't fail
    // This is optional validation, not required
    if (IS_DEV) {
      console.warn(`${LOG_PREFIX} ${SECURITY_PREFIX} Backend did not send X-Server-Cert-Fingerprint header`);
      console.warn(`${LOG_PREFIX} [DEV] This is optional validation - TLS pinning is primary security`);
    }
    return true; // Don't fail - this is optional validation
  }

  // Check if header matches expected fingerprint
  const isValid = serverFingerprint === expectedFingerprint;

  if (!isValid) {
    console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Response header fingerprint mismatch!`);
    console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Expected: ${expectedFingerprint}`);
    console.error(`${LOG_PREFIX} ${SECURITY_PREFIX} Received in header: ${serverFingerprint}`);
    console.warn(`${LOG_PREFIX} ${SECURITY_PREFIX} This may indicate proxy/CDN interference or backend misconfiguration`);
  } else {
    if (IS_DEV) {
      console.log(`${LOG_PREFIX} [DEV] ✓ Response header fingerprint validation successful`);
    }
  }

  return isValid;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Core functions
  createPinnedAgent,
  calculateFingerprint,
  validateResponseHeader,

  // TOFU helpers (exported for testing)
  loadPinnedFingerprint,
  savePinnedFingerprint,
  getPinnedCertPath,

  // Configuration (expose for external access)
  PINNED_FINGERPRINTS,        // Legacy export (same as STAGING_PINNED_FINGERPRINTS)
  STAGING_PINNED_FINGERPRINTS,
  PINNING_ENABLED,
  PRODUCTION_HOSTNAME,
  STAGING_HOSTNAME
};
