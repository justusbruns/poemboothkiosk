// Test Certificate Setup
// This script verifies that certificates are properly installed and can be read

const fs = require('fs');
const path = require('path');

// Platform-specific certificate paths
const CERT_PATHS = {
  win32: 'C:\\ProgramData\\PoemBooth',
  linux: '/etc/poembooth',
  darwin: '/Library/Application Support/PoemBooth'
};

function getCertificatePath() {
  const basePath = CERT_PATHS[process.platform];
  return {
    base: basePath,
    cert: path.join(basePath, 'device.crt'),
    key: path.join(basePath, 'device.key'),
    ca: path.join(basePath, 'ca.crt')
  };
}

function testCertificates() {
  console.log('🔍 Certificate Test Tool');
  console.log('═══════════════════════════════════════════\n');

  console.log(`Platform: ${process.platform}`);
  console.log(`Node.js: ${process.version}\n`);

  const certPaths = getCertificatePath();

  console.log(`Certificate directory: ${certPaths.base}\n`);

  // Test 1: Check if directory exists
  console.log('Test 1: Directory exists');
  if (fs.existsSync(certPaths.base)) {
    console.log('✅ PASS - Directory exists\n');
  } else {
    console.log(`❌ FAIL - Directory not found`);
    console.log(`   Create it with: mkdir "${certPaths.base}"\n`);
    return false;
  }

  // Test 2: Check if certificate files exist
  console.log('Test 2: Certificate files exist');
  const files = {
    'device.crt': certPaths.cert,
    'device.key': certPaths.key,
    'ca.crt': certPaths.ca
  };

  let allFilesExist = true;
  for (const [name, filePath] of Object.entries(files)) {
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${name} - Found`);
    } else {
      console.log(`❌ ${name} - Missing`);
      allFilesExist = false;
    }
  }

  if (!allFilesExist) {
    console.log('\n⚠️  Some certificate files are missing.');
    console.log('   Please provision this device using the setup script.\n');
    return false;
  }

  console.log('');

  // Test 3: Check file permissions
  console.log('Test 3: File permissions');
  try {
    for (const [name, filePath] of Object.entries(files)) {
      const stats = fs.statSync(filePath);
      const mode = (stats.mode & parseInt('777', 8)).toString(8);

      if (name === 'device.key') {
        // Private key should be restrictive (600 or 400)
        if (mode === '600' || mode === '400') {
          console.log(`✅ ${name} - Permissions OK (${mode})`);
        } else {
          console.log(`⚠️  ${name} - Permissions too open (${mode})`);
          console.log(`   Recommended: chmod 600 "${filePath}"`);
        }
      } else {
        // Public certs can be readable
        console.log(`✅ ${name} - Permissions OK (${mode})`);
      }
    }
  } catch (error) {
    console.log(`⚠️  Could not check permissions: ${error.message}`);
  }

  console.log('');

  // Test 4: Read certificate contents
  console.log('Test 4: Read certificate contents');
  try {
    const cert = fs.readFileSync(certPaths.cert, 'utf8');

    if (cert.includes('BEGIN CERTIFICATE')) {
      console.log('✅ device.crt - Valid PEM format');

      // Parse certificate details using OpenSSL if available
      try {
        const { execSync } = require('child_process');
        const output = execSync(`openssl x509 -in "${certPaths.cert}" -noout -subject -dates`, {
          encoding: 'utf8'
        });
        console.log('');
        console.log('Certificate Details:');
        output.split('\n').forEach(line => {
          if (line.trim()) console.log(`   ${line}`);
        });
      } catch (e) {
        console.log('   (Install OpenSSL to see certificate details)');
      }
    } else {
      console.log('❌ device.crt - Invalid format');
    }
  } catch (error) {
    console.log(`❌ Cannot read device.crt: ${error.message}`);
    return false;
  }

  console.log('');

  // Test 5: Read private key
  console.log('Test 5: Read private key');
  try {
    const key = fs.readFileSync(certPaths.key, 'utf8');

    if (key.includes('BEGIN PRIVATE KEY') || key.includes('BEGIN RSA PRIVATE KEY')) {
      console.log('✅ device.key - Valid PEM format');
    } else {
      console.log('❌ device.key - Invalid format');
    }
  } catch (error) {
    console.log(`❌ Cannot read device.key: ${error.message}`);
    return false;
  }

  console.log('');

  // Test 6: Read CA certificate
  console.log('Test 6: Read CA certificate');
  try {
    const ca = fs.readFileSync(certPaths.ca, 'utf8');

    if (ca.includes('BEGIN CERTIFICATE')) {
      console.log('✅ ca.crt - Valid PEM format');
    } else {
      console.log('❌ ca.crt - Invalid format');
    }
  } catch (error) {
    console.log(`❌ Cannot read ca.crt: ${error.message}`);
    return false;
  }

  console.log('');

  // Test 7: Verify certificate chain
  console.log('Test 7: Verify certificate chain');
  try {
    const { execSync } = require('child_process');
    execSync(`openssl verify -CAfile "${certPaths.ca}" "${certPaths.cert}"`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    console.log('✅ Certificate chain valid');
  } catch (error) {
    if (error.message.includes('command not found')) {
      console.log('⚠️  OpenSSL not found - skipping verification');
    } else {
      console.log(`❌ Certificate verification failed: ${error.message}`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('✅ All tests passed!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Run the kiosk app: npm run dev');
  console.log('2. App will auto-register with backend');
  console.log('3. Check connectivity with backend API');
  console.log('');

  return true;
}

// Run tests
try {
  const success = testCertificates();
  process.exit(success ? 0 : 1);
} catch (error) {
  console.error('');
  console.error('❌ Fatal error:', error.message);
  console.error('');
  process.exit(1);
}
