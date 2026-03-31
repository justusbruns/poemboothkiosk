const fs = require('fs');
const https = require('https');

function testConfig() {
  const certPath = 'C:\\ProgramData\\PoemBooth\\device.crt';
  const cert = fs.readFileSync(certPath, 'utf8');
  const certBase64 = Buffer.from(cert).toString('base64');

  console.log('Testing /api/kiosk/config with https module...');
  console.log('Certificate length:', cert.length);
  console.log('Base64 length:', certBase64.length);
  console.log('');

  const options = {
    hostname: 'book.poembooth.com',
    port: 443,
    path: '/api/kiosk/config',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${certBase64}`,
      'Content-Type': 'application/json',
      'User-Agent': 'PoemBooth-Kiosk/1.0.0'
    }
  };

  console.log('Making request...');

  const req = https.request(options, (res) => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', JSON.stringify(res.headers, null, 2));
    console.log('');

    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      console.log('Response:');
      console.log(data);
      console.log('');

      if (res.statusCode === 200) {
        console.log('✅ SUCCESS!');
      } else {
        console.log('❌ FAILED with status:', res.statusCode);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Request error:', error.message);
  });

  req.end();
}

testConfig();
