/**
 * Device Setup Script for Zero-Touch Provisioning
 *
 * This script is run in the workshop/factory before devices are shipped.
 * It generates X.509 certificates with embedded equipment assignments and
 * pre-registers devices in the database.
 *
 * Usage:
 *   npm run setup-device -- --asset-tag PB-005 --hub-id <uuid> [--serial SN-123]
 *
 * Prerequisites:
 *   - OpenSSL installed
 *   - Supabase service role key in .env.local
 *   - Root CA certificate (generated automatically if missing)
 */

import { config } from 'dotenv'
import crypto from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// Load environment variables from .env.local
config({ path: '.env.local' })

const execAsync = promisify(exec)

interface DeviceSetupOptions {
  assetTag: string
  hubId: string
  serial?: string
  equipmentType?: string
}

interface CertificateInfo {
  deviceId: string
  equipmentId: number
  fingerprint: string
  certificatePath: string
  privateKeyPath: string
}

const CA_DIR = path.join(process.cwd(), 'ca')
const CERTS_DIR = path.join(process.cwd(), 'device-certs')
const CA_CERT_PATH = path.join(CA_DIR, 'ca-cert.pem')
const CA_KEY_PATH = path.join(CA_DIR, 'ca-key.pem')

// Initialize Supabase admin client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

async function main() {
  console.log('🏭 Device Setup Script - Zero-Touch Provisioning\n')

  // Parse command line arguments
  const options = parseArguments()

  // Validate prerequisites
  await validatePrerequisites()

  // Ensure CA exists
  await ensureCAExists()

  // Create device certificate
  const certInfo = await createDeviceCertificate(options)

  // Pre-register in database
  await preRegisterDevice(options, certInfo)

  // Print summary
  printSummary(options, certInfo)
}

function parseArguments(): DeviceSetupOptions {
  const args = process.argv.slice(2)

  const assetTag = args.find(a => a.startsWith('--asset-tag='))?.split('=')[1]
  const hubId = args.find(a => a.startsWith('--hub-id='))?.split('=')[1]
  const serial = args.find(a => a.startsWith('--serial='))?.split('=')[1]
  const equipmentType = args.find(a => a.startsWith('--type='))?.split('=')[1]

  if (!assetTag || !hubId) {
    console.error('❌ Missing required arguments\n')
    console.log('Usage:')
    console.log('  npm run setup-device -- --asset-tag=PB-005 --hub-id=<uuid> [--serial=SN-123] [--type=poem_booth]\n')
    console.log('Example:')
    console.log('  npm run setup-device -- --asset-tag=PB-005 --hub-id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 --serial=SN-2025-005\n')
    process.exit(1)
  }

  return { assetTag, hubId, serial, equipmentType }
}

async function validatePrerequisites() {
  // Check OpenSSL
  try {
    await execAsync('openssl version')
  } catch (error) {
    console.error('❌ OpenSSL not found. Please install OpenSSL.')
    process.exit(1)
  }

  // Check Supabase credentials
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing Supabase credentials in .env.local')
    process.exit(1)
  }

  // Create directories
  await fs.mkdir(CA_DIR, { recursive: true })
  await fs.mkdir(CERTS_DIR, { recursive: true })

  console.log('✅ Prerequisites validated\n')
}

async function ensureCAExists() {
  try {
    await fs.access(CA_CERT_PATH)
    console.log('✅ Root CA found\n')
  } catch {
    console.log('🔐 Generating Root CA...')

    // Generate CA private key (4096-bit RSA, AES-256 encrypted)
    const caPassword = crypto.randomBytes(32).toString('hex')

    await execAsync(`openssl genrsa -out ${CA_KEY_PATH} -aes256 -passout pass:${caPassword} 4096`)

    // Generate CA certificate (valid 10 years)
    await execAsync(`openssl req -new -x509 -days 3650 \
      -key ${CA_KEY_PATH} \
      -out ${CA_CERT_PATH} \
      -passin pass:${caPassword} \
      -subj "/C=NL/ST=Noord-Holland/L=Amsterdam/O=Poem Booth/CN=Poem Booth Root CA"`)

    // Save CA password securely
    await fs.writeFile(
      path.join(CA_DIR, 'ca-password.txt'),
      caPassword,
      { mode: 0o600 }
    )

    console.log('✅ Root CA generated')
    console.log(`   Certificate: ${CA_CERT_PATH}`)
    console.log(`   Private key: ${CA_KEY_PATH}`)
    console.log(`   Password: ${path.join(CA_DIR, 'ca-password.txt')}`)
    console.log('⚠️  IMPORTANT: Backup CA files securely!\n')

    // Upload CA to database
    await uploadCAToDatabase()
  }
}

async function uploadCAToDatabase() {
  console.log('📤 Uploading CA certificate to database...')

  const caCertContent = await fs.readFile(CA_CERT_PATH, 'utf-8')
  const fingerprint = crypto.createHash('sha256').update(caCertContent).digest('hex')

  // Parse certificate for validity dates
  const { stdout: certInfo } = await execAsync(`openssl x509 -in ${CA_CERT_PATH} -noout -dates`)
  const notBefore = certInfo.match(/notBefore=(.+)/)?.[1]
  const notAfter = certInfo.match(/notAfter=(.+)/)?.[1]

  const { error } = await supabase
    .from('trusted_device_cas')
    .insert({
      name: 'Poem Booth Root CA',
      certificate: caCertContent,
      fingerprint,
      valid_from: new Date(notBefore!).toISOString(),
      valid_until: new Date(notAfter!).toISOString(),
      is_active: true
    })

  if (error && error.code !== '23505') { // Ignore duplicate error
    console.error('❌ Failed to upload CA:', error.message)
    process.exit(1)
  }

  console.log('✅ CA uploaded to database\n')
}

async function createDeviceCertificate(options: DeviceSetupOptions): Promise<CertificateInfo> {
  console.log(`🔑 Generating device certificate for ${options.assetTag}...`)

  // Generate unique device ID
  const deviceId = crypto.randomUUID()

  // Find or create equipment record
  const equipmentId = await ensureEquipmentExists(options, deviceId)

  // Certificate file paths
  const privateKeyPath = path.join(CERTS_DIR, `${options.assetTag}-key.pem`)
  const certPath = path.join(CERTS_DIR, `${options.assetTag}-cert.pem`)
  const csrPath = path.join(CERTS_DIR, `${options.assetTag}.csr`)
  const configPath = path.join(CERTS_DIR, `${options.assetTag}-openssl.cnf`)

  // Create OpenSSL config with Subject Alternative Names
  const opensslConfig = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = NL
ST = Noord-Holland
L = Amsterdam
O = Poem Booth
CN = ${deviceId}

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectAltName = @alt_names

[alt_names]
URI.1 = urn:device:${deviceId}
URI.2 = urn:equipment:${equipmentId}
URI.3 = urn:hub:${options.hubId}
DNS.1 = ${options.assetTag}.booth.internal
`

  await fs.writeFile(configPath, opensslConfig.trim())

  // Generate device private key (2048-bit RSA, no password for embedded use)
  await execAsync(`openssl genrsa -out ${privateKeyPath} 2048`)

  // Generate Certificate Signing Request
  await execAsync(`openssl req -new -key ${privateKeyPath} -out ${csrPath} -config ${configPath}`)

  // Sign certificate with CA (valid 10 years)
  const caPassword = await fs.readFile(path.join(CA_DIR, 'ca-password.txt'), 'utf-8')
  await execAsync(`openssl x509 -req -in ${csrPath} \
    -CA ${CA_CERT_PATH} \
    -CAkey ${CA_KEY_PATH} \
    -CAcreateserial \
    -out ${certPath} \
    -days 3650 \
    -sha256 \
    -extensions v3_req \
    -extfile ${configPath} \
    -passin pass:${caPassword.trim()}`)

  // Calculate certificate fingerprint
  const certContent = await fs.readFile(certPath, 'utf-8')
  const fingerprint = crypto.createHash('sha256').update(certContent).digest('hex')

  // Cleanup temporary files
  await fs.unlink(csrPath)
  await fs.unlink(configPath)

  console.log(`✅ Device certificate generated`)
  console.log(`   Device ID: ${deviceId}`)
  console.log(`   Equipment ID: ${equipmentId}`)
  console.log(`   Fingerprint: ${fingerprint.substring(0, 32)}...`)
  console.log(`   Certificate: ${certPath}`)
  console.log(`   Private key: ${privateKeyPath}\n`)

  return { deviceId, equipmentId, fingerprint, certificatePath: certPath, privateKeyPath }
}

async function ensureEquipmentExists(options: DeviceSetupOptions, deviceId: string): Promise<number> {
  // Check if equipment already exists
  const { data: existing } = await supabase
    .from('equipment_inventory')
    .select('id, asset_tag, hub_id')
    .eq('asset_tag', options.assetTag)
    .eq('hub_id', options.hubId)
    .single()

  if (existing) {
    console.log(`   Found existing equipment: ${existing.asset_tag} (ID: ${existing.id})`)
    return existing.id
  }

  // Create new equipment record
  const { data: created, error } = await supabase
    .from('equipment_inventory')
    .insert({
      asset_tag: options.assetTag,
      hub_id: options.hubId,
      equipment_type: options.equipmentType || 'poem_booth',
      device_serial: options.serial,
      status: 'pending_activation'
    })
    .select('id')
    .single()

  if (error) {
    console.error('❌ Failed to create equipment:', error.message)
    process.exit(1)
  }

  console.log(`   Created equipment record: ${options.assetTag} (ID: ${created.id})`)
  return created.id
}

async function preRegisterDevice(options: DeviceSetupOptions, certInfo: CertificateInfo) {
  console.log('📝 Pre-registering device in database...')

  const certificateContent = await fs.readFile(certInfo.certificatePath, 'utf-8')

  // Insert into registered_devices
  const { error: deviceError } = await supabase
    .from('registered_devices')
    .insert({
      device_id: certInfo.deviceId,
      equipment_id: certInfo.equipmentId,
      certificate: certificateContent,
      fingerprint: certInfo.fingerprint,
      serial_number: options.serial,
      status: 'ready_to_deploy'
    })

  if (deviceError) {
    console.error('❌ Failed to register device:', deviceError.message)
    process.exit(1)
  }

  // Update equipment with device references
  const { error: equipmentError } = await supabase
    .from('equipment_inventory')
    .update({
      device_id: certInfo.deviceId,
      device_certificate_fingerprint: certInfo.fingerprint
    })
    .eq('id', certInfo.equipmentId)

  if (equipmentError) {
    console.error('❌ Failed to update equipment:', equipmentError.message)
    process.exit(1)
  }

  console.log('✅ Device pre-registered\n')
}

function printSummary(options: DeviceSetupOptions, certInfo: CertificateInfo) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ DEVICE SETUP COMPLETE')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`\n📋 Device Details:`)
  console.log(`   Asset Tag:    ${options.assetTag}`)
  console.log(`   Device ID:    ${certInfo.deviceId}`)
  console.log(`   Equipment ID: ${certInfo.equipmentId}`)
  console.log(`   Hub ID:       ${options.hubId}`)
  console.log(`   Serial:       ${options.serial || 'N/A'}`)
  console.log(`   Status:       ready_to_deploy`)
  console.log(`\n📁 Certificate Files:`)
  console.log(`   Certificate:  ${certInfo.certificatePath}`)
  console.log(`   Private Key:  ${certInfo.privateKeyPath}`)
  console.log(`\n📦 Next Steps:`)
  console.log(`   1. Copy certificate files to Electron app:`)
  console.log(`      cp ${certInfo.certificatePath} ../electron-app/credentials/device-cert.pem`)
  console.log(`      cp ${certInfo.privateKeyPath} ../electron-app/credentials/device-key.pem`)
  console.log(`   2. Build Electron app with embedded credentials`)
  console.log(`   3. Ship device to hub`)
  console.log(`   4. Hub manager powers on and scans WiFi QR code`)
  console.log(`   5. Device auto-registers and starts operating`)
  console.log(`\n⚠️  SECURITY REMINDER:`)
  console.log(`   - Keep private key secure (treat like a password)`)
  console.log(`   - Do NOT commit certificates to git`)
  console.log(`   - Backup CA files in secure vault`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Setup failed:', error.message)
  process.exit(1)
})
