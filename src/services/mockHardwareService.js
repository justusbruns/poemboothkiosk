// Mock Hardware Service - Development Mode with Keyboard Shortcuts
// Simulates physical button and rotary encoder using keyboard
// Spacebar = button press, Left/Right arrows = knob rotation

const EventEmitter = require('events');

class MockHardwareService extends EventEmitter {
  constructor(config = {}) {
    super();

    // State
    this.buttonPressed = false;
    this.buttonPressTime = null;
    this.longPressThreshold = 2000; // 2 seconds for print
    this.longPressTriggered = false;
    this.longPressHandled = false; // Prevent multiple long press actions
    this.encoderPosition = 0;

    console.log('[MOCK HARDWARE] Mock hardware service initialized');
    console.log('[MOCK HARDWARE] Keyboard shortcuts:');
    console.log('[MOCK HARDWARE]   Spacebar = Button press');
    console.log('[MOCK HARDWARE]   ArrowLeft = Rotate knob left');
    console.log('[MOCK HARDWARE]   ArrowRight = Rotate knob right');
    console.log('[MOCK HARDWARE]   Hold Spacebar 2s = Long press (print)');
  }

  // Initialize (no actual GPIO needed)
  async initialize() {
    console.log('[MOCK HARDWARE] Mock hardware ready - use keyboard shortcuts');
    return true;
  }

  // Simulate button press (called from main process keyboard handler)
  simulateButtonPress() {
    if (this.buttonPressed) {
      console.log('[MOCK HARDWARE] Button already pressed, ignoring duplicate');
      return; // Already pressed
    }

    this.buttonPressed = true;
    this.buttonPressTime = Date.now();
    this.longPressTriggered = false;

    // ALWAYS start auto-release timer FIRST (even during cooldown)
    // This ensures buttonPressed is reset if no keyup is received from Pico
    this.autoReleaseTimer = setTimeout(() => {
      if (this.buttonPressed) {
        console.log('[MOCK HARDWARE] Auto-releasing button (no keyup detected)');
        this.simulateButtonRelease();
      }
    }, 3000);

    // During cooldown, skip long press detection but still allow buttonPress event
    if (this.longPressHandled) {
      console.log('[MOCK HARDWARE] Button pressed (in cooldown - short press only)');
      this.longPressTriggered = true; // Prevent buttonRelease from being emitted on auto-release
      this.emit('buttonPress'); // Still emit for booth screen capture
      return;
    }

    console.log('[MOCK HARDWARE] Button pressed');
    this.emit('buttonPress');

    // Start long-press timer (only outside cooldown)
    this.longPressTimer = setTimeout(() => {
      if (this.buttonPressed && !this.longPressTriggered) {
        this.longPressTriggered = true;
        this.longPressHandled = true; // Mark as handled
        console.log('[MOCK HARDWARE] Long press detected (held 2s)');
        this.emit('longPress');

        // Reset longPressHandled after 5 seconds to allow new long presses
        setTimeout(() => {
          this.longPressHandled = false;
          console.log('[MOCK HARDWARE] Long press cooldown expired - ready for new long press');
        }, 5000);
      }
    }, this.longPressThreshold);
  }

  // Simulate button release
  simulateButtonRelease() {
    if (!this.buttonPressed) {
      return; // Not pressed
    }

    this.buttonPressed = false;
    const pressDuration = Date.now() - this.buttonPressTime;

    console.log('[MOCK HARDWARE] Button released (duration:', pressDuration, 'ms)');

    // Clear timers
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    if (this.autoReleaseTimer) {
      clearTimeout(this.autoReleaseTimer);
      this.autoReleaseTimer = null;
    }

    // Emit release event if not long-press
    if (!this.longPressTriggered) {
      this.emit('buttonRelease', { duration: pressDuration });
    }
  }

  // Simulate knob rotation (called from main process keyboard handler)
  simulateKnobRotate(direction) {
    if (direction === 'left' || direction === 'counterclockwise') {
      this.encoderPosition--;
      console.log('[MOCK HARDWARE] Knob rotated left (ArrowLeft), position:', this.encoderPosition);
      this.emit('knobRotate', { direction: 'counterclockwise', position: this.encoderPosition });
    } else if (direction === 'right' || direction === 'clockwise') {
      this.encoderPosition++;
      console.log('[MOCK HARDWARE] Knob rotated right (ArrowRight), position:', this.encoderPosition);
      this.emit('knobRotate', { direction: 'clockwise', position: this.encoderPosition });
    }
  }

  // Get current encoder position
  getEncoderPosition() {
    return this.encoderPosition;
  }

  // Reset encoder position
  resetEncoderPosition() {
    this.encoderPosition = 0;
  }

  // Cleanup (nothing to do for mock)
  async destroy() {
    console.log('[MOCK HARDWARE] Mock hardware cleanup');
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
    }
  }
}

module.exports = MockHardwareService;
