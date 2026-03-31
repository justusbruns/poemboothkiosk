const fs = require('fs');
const fetch = require('node-fetch');

async function testConfig() {
  const certPath = 'C:\\ProgramData\\PoemBooth\\device.crt';
  const cert = fs.readFileSync(certPath, 'utf8');
  const certBase64 = Buffer.from(cert).toString('base64');

  console.log('Testing /api/kiosk/config with node-fetch...');
  console.log('Certificate length:', cert.length);
  console.log('Base64 length:', certBase64.length);
  console.log('');

  const headers = {
    'Authorization': `Bearer ${certBase64}`,
    'Content-Type': 'application/json',
    'User-Agent': 'PoemBooth-Kiosk/1.0.0'
  };

  console.log('Headers:');
  console.log(JSON.stringify(headers, null, 2));
  console.log('');

  try {
    const response = await fetch('https://book.poembooth.com/api/kiosk/config', {
      method: 'GET',
      headers
    });

    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    console.log('');

    const text = await response.text();
    console.log('Response:');
    console.log(text);

    if (response.ok) {
      console.log('');
      console.log('✅ SUCCESS!');
    } else {
      console.log('');
      console.log('❌ FAILED');
    }
  } catch (error) {
    console.error('❌ Request error:', error.message);
  }
}

testConfig();
