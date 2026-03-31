#!/usr/bin/env node
/**
 * GPIO Test Script - Monitor button and rotary encoder
 * Run this on the Raspberry Pi to test physical hardware
 *
 * Usage: node test-gpio.js
 * Press Ctrl+C to exit
 */

// GPIO pin configuration (matches hardwareService.js)
const BUTTON_PIN = 13;    // GP13
const ENCODER_PIN_A = 17; // GP17 (CLK)
const ENCODER_PIN_B = 18; // GP18 (DT)

console.log('=== GPIO Test Script ===');
console.log('Button: GPIO' + BUTTON_PIN);
console.log('Encoder CLK: GPIO' + ENCODER_PIN_A);
console.log('Encoder DT: GPIO' + ENCODER_PIN_B);
console.log('');

// Check if running on Raspberry Pi
const isRaspberryPi = process.platform === 'linux' && process.arch === 'arm';

if (!isRaspberryPi) {
  console.log('❌ Not running on Raspberry Pi');
  console.log('Platform:', process.platform);
  console.log('Architecture:', process.arch);
  console.log('');
  console.log('📋 To test GPIO on Raspberry Pi:');
  console.log('');
  console.log('1. Copy this script to your Raspberry Pi:');
  console.log('   scp test-gpio.js pi@<pi-ip-address>:~/');
  console.log('');
  console.log('2. SSH into the Pi:');
  console.log('   ssh pi@<pi-ip-address>');
  console.log('');
  console.log('3. Install dependencies (if needed):');
  console.log('   cd ~/poemboothkiosk/kiosk-app && npm install');
  console.log('');
  console.log('4. Run the test:');
  console.log('   node ~/test-gpio.js');
  console.log('');
  process.exit(0);
}

let encoderPosition = 0;
let lastEncoderA = 0;
let buttonPressTime = null;

console.log('✅ Running on Raspberry Pi');
console.log('\nMonitoring... (Press Ctrl+C to exit)\n');

try {
  const Gpio = require('onoff').Gpio;
  // Initialize GPIO pins
  const button = new Gpio(BUTTON_PIN, 'in', 'both', { debounceTimeout: 50 });
  const encoderA = new Gpio(ENCODER_PIN_A, 'in', 'both', { debounceTimeout: 10 });
  const encoderB = new Gpio(ENCODER_PIN_B, 'in', 'both', { debounceTimeout: 10 });

  // Read initial states
  console.log('Initial pin states:');
  console.log('  Button (GPIO' + BUTTON_PIN + '):', button.readSync());
  console.log('  Encoder CLK (GPIO' + ENCODER_PIN_A + '):', encoderA.readSync());
  console.log('  Encoder DT (GPIO' + ENCODER_PIN_B + '):', encoderB.readSync());
  console.log('');

  lastEncoderA = encoderA.readSync();

  // Monitor button
  button.watch((err, value) => {
    if (err) {
      console.error('Button error:', err);
      return;
    }

    const timestamp = new Date().toISOString();
    if (value === 0) {
      // Button pressed (pull-up resistor, so 0 = pressed)
      buttonPressTime = Date.now();
      console.log(`[${timestamp}] 🔘 BUTTON PRESSED`);
    } else {
      // Button released
      const duration = buttonPressTime ? Date.now() - buttonPressTime : 0;
      console.log(`[${timestamp}] 🔘 BUTTON RELEASED (held ${duration}ms)`);
    }
  });

  // Monitor rotary encoder
  encoderA.watch((err, value) => {
    if (err) {
      console.error('Encoder error:', err);
      return;
    }

    const clkValue = encoderA.readSync();
    const dtValue = encoderB.readSync();

    if (clkValue !== lastEncoderA) {
      const timestamp = new Date().toISOString();

      if (dtValue !== clkValue) {
        // Clockwise
        encoderPosition++;
        console.log(`[${timestamp}] 🔄 KNOB ROTATED CLOCKWISE → Position: ${encoderPosition}`);
      } else {
        // Counter-clockwise
        encoderPosition--;
        console.log(`[${timestamp}] 🔄 KNOB ROTATED COUNTER-CLOCKWISE → Position: ${encoderPosition}`);
      }
    }

    lastEncoderA = clkValue;
  });

  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\n\nCleaning up GPIO...');
    button.unexport();
    encoderA.unexport();
    encoderB.unexport();
    console.log('Done. Goodbye!');
    process.exit(0);
  });

} catch (error) {
  console.error('\n❌ ERROR: Failed to initialize GPIO');
  console.error('Error message:', error.message);
  console.error('\nPossible causes:');
  console.error('  1. Not running on Raspberry Pi');
  console.error('  2. onoff module not installed (run: npm install onoff)');
  console.error('  3. Incorrect permissions (try: sudo node test-gpio.js)');
  console.error('  4. GPIO pins already in use by another process');
  process.exit(1);
}
