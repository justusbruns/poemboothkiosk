// Hardware Service - Raspberry Pi GPIO Control
// Handles physical button and rotary encoder for style selection

const EventEmitter = require('events');

class HardwareService extends EventEmitter {
  constructor(config = {}) {
    super();

    // GPIO pin configuration
    this.buttonPin = config.buttonPin || 13; // GP13 for button
    this.encoderPinA = config.encoderPinA || 17; // GP17 for encoder CLK
    this.encoderPinB = config.encoderPinB || 18; // GP18 for encoder DT

    // State
    this.buttonPressed = false;
    this.buttonPressTime = null;
    this.longPressThreshold = 2000; // 2 seconds for print
    this.longPressTriggered = false;
    this.encoderPosition = 0;
    this.lastEncoderA = 0;

    // GPIO instances
    this.button = null;
    this.encoderA = null;
    this.encoderB = null;

    // Platform check
    this.isRaspberryPi = process.platform === 'linux' && process.arch === 'arm';

    console.log('[HARDWARE] Initializing hardware service...');
    console.log('[HARDWARE] Platform:', process.platform, process.arch);
    console.log('[HARDWARE] Raspberry Pi detected:', this.isRaspberryPi);
  }

  // Initialize GPIO pins
  async initialize() {
    if (!this.isRaspberryPi) {
      console.log('[HARDWARE] Not on Raspberry Pi - hardware disabled');
      return false;
    }

    try {
      const { Gpio } = require('onoff');

      // Initialize button (input with pull-up)
      this.button = new Gpio(this.buttonPin, 'in', 'both', { debounceTimeout: 50 });
      console.log(`[HARDWARE] Button initialized on GPIO${this.buttonPin}`);

      // Initialize rotary encoder
      this.encoderA = new Gpio(this.encoderPinA, 'in', 'both', { debounceTimeout: 10 });
      this.encoderB = new Gpio(this.encoderPinB, 'in', 'both', { debounceTimeout: 10 });
      console.log(`[HARDWARE] Encoder initialized on GPIO${this.encoderPinA}/GPIO${this.encoderPinB}`);

      // Watch for button changes
      this.button.watch((err, value) => {
        if (err) {
          console.error('[HARDWARE] Button error:', err);
          return;
        }
        this.handleButtonChange(value);
      });

      // Watch for encoder changes
      this.encoderA.watch((err, value) => {
        if (err) {
          console.error('[HARDWARE] Encoder A error:', err);
          return;
        }
        this.handleEncoderChange();
      });

      console.log('[HARDWARE] GPIO initialized successfully');
      return true;
    } catch (error) {
      console.error('[HARDWARE] Failed to initialize GPIO:', error.message);
      return false;
    }
  }

  // Handle button press/release
  handleButtonChange(value) {
    // value: 0 = pressed (pull-up), 1 = released
    const isPressed = value === 0;

    if (isPressed && !this.buttonPressed) {
      // Button just pressed
      this.buttonPressed = true;
      this.buttonPressTime = Date.now();
      this.longPressTriggered = false;

      console.log('[HARDWARE] Button pressed');
      this.emit('buttonPress');

      // Start long-press timer
      this.longPressTimer = setTimeout(() => {
        if (this.buttonPressed && !this.longPressTriggered) {
          this.longPressTriggered = true;
          console.log('[HARDWARE] Long press detected');
          this.emit('longPress');
        }
      }, this.longPressThreshold);

    } else if (!isPressed && this.buttonPressed) {
      // Button just released
      this.buttonPressed = false;
      const pressDuration = Date.now() - this.buttonPressTime;

      console.log('[HARDWARE] Button released (duration:', pressDuration, 'ms)');

      // Clear long-press timer
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }

      // Emit release event if not long-press
      if (!this.longPressTriggered) {
        this.emit('buttonRelease', { duration: pressDuration });
      }
    }
  }

  // Handle rotary encoder rotation
  handleEncoderChange() {
    const clkValue = this.encoderA.readSync();
    const dtValue = this.encoderB.readSync();

    // Detect rotation direction using Gray code
    if (clkValue !== this.lastEncoderA) {
      if (dtValue !== clkValue) {
        // Clockwise rotation
        this.encoderPosition++;
        console.log('[HARDWARE] Knob rotated clockwise, position:', this.encoderPosition);
        this.emit('knobRotate', { direction: 'clockwise', position: this.encoderPosition });
      } else {
        // Counter-clockwise rotation
        this.encoderPosition--;
        console.log('[HARDWARE] Knob rotated counter-clockwise, position:', this.encoderPosition);
        this.emit('knobRotate', { direction: 'counterclockwise', position: this.encoderPosition });
      }
    }

    this.lastEncoderA = clkValue;
  }

  // Get current encoder position
  getEncoderPosition() {
    return this.encoderPosition;
  }

  // Reset encoder position
  resetEncoderPosition() {
    this.encoderPosition = 0;
  }

  // Cleanup GPIO resources
  async destroy() {
    console.log('[HARDWARE] Cleaning up GPIO resources...');

    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
    }

    try {
      if (this.button) {
        this.button.unexport();
      }
      if (this.encoderA) {
        this.encoderA.unexport();
      }
      if (this.encoderB) {
        this.encoderB.unexport();
      }
      console.log('[HARDWARE] GPIO cleanup complete');
    } catch (error) {
      console.error('[HARDWARE] Error during cleanup:', error);
    }
  }
}

module.exports = HardwareService;
