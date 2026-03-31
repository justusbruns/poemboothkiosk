const fs = require('fs');
const path = require('path');

// Test how the kiosk app encodes the cert
const certPath1 = 'C:\\ProgramData\\PoemBooth\\device.crt';
const cert1 = fs.readFileSync(certPath1, 'utf8');
const base64_1 = Buffer.from(cert1).toString('base64');

console.log('Kiosk app method (from ProgramData):');
console.log('Certificate length:', cert1.length);
console.log('Base64 length:', base64_1.length);
console.log('First 100 chars of base64:', base64_1.substring(0, 100));
console.log('');

// Test with the PB-TEST cert
const certPath2 = 'C:\\Users\\JB\\poemboothbooking\\device-certs\\PB-TEST-cert.pem';
const cert2 = fs.readFileSync(certPath2, 'utf8');
const base64_2 = Buffer.from(cert2).toString('base64');

console.log('PowerShell test cert (PB-TEST):');
console.log('Certificate length:', cert2.length);
console.log('Base64 length:', base64_2.length);
console.log('First 100 chars of base64:', base64_2.substring(0, 100));
console.log('');

console.log('Are they identical?', base64_1 === base64_2);
console.log('');

// Now test what PowerShell does (read as binary)
const certBytes = fs.readFileSync(certPath2);
const base64_ps = certBytes.toString('base64');

console.log('PowerShell method (binary read):');
console.log('Bytes length:', certBytes.length);
console.log('Base64 length:', base64_ps.length);
console.log('First 100 chars of base64:', base64_ps.substring(0, 100));
console.log('');

console.log('Does Node UTF-8 method match PowerShell?', base64_1 === base64_ps);
