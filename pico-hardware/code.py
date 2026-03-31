"""
PoemBooth Kiosk Hardware Controller
Raspberry Pi Pico CircuitPython Code

Hardware:
- Button: GP13 (with pull-up resistor)
- Rotary Encoder: GP17 (CLK), GP18 (DT)

USB HID Output:
- Button press: Spacebar press
- Button release (short): Spacebar release
- Button hold 2s: Sends long press (holds Spacebar for 2s)
- Encoder CW: Right Arrow
- Encoder CCW: Left Arrow
"""

import board
import digitalio
import rotaryio
import time
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode

# Initialize USB HID keyboard
kbd = Keyboard(usb_hid.devices)

# Initialize button on GP13 (with internal pull-up)
button = digitalio.DigitalInOut(board.GP13)
button.direction = digitalio.Direction.INPUT
button.pull = digitalio.Pull.UP  # Pull-up: pressed = LOW (False)

# Initialize rotary encoder on GP17 (CLK) and GP18 (DT)
encoder = rotaryio.IncrementalEncoder(board.GP17, board.GP18)
last_position = encoder.position

# Button state tracking
button_pressed = False
button_press_time = 0
LONG_PRESS_THRESHOLD = 2.0  # 2 seconds for long press
long_press_triggered = False

print("PoemBooth Hardware Controller Initialized")
print("Button: GP13")
print("Encoder: GP17 (CLK), GP18 (DT)")
print("Ready!")

while True:
    # === BUTTON HANDLING ===
    button_state = button.value  # False = pressed (pull-up), True = released

    # Button press detected
    if not button_state and not button_pressed:
        button_pressed = True
        button_press_time = time.monotonic()
        long_press_triggered = False

        # Send spacebar press
        kbd.press(Keycode.SPACE)
        print("Button pressed (Spacebar pressed)")

    # Button held - check for long press
    elif not button_state and button_pressed and not long_press_triggered:
        hold_duration = time.monotonic() - button_press_time
        if hold_duration >= LONG_PRESS_THRESHOLD:
            long_press_triggered = True
            print(f"Long press detected ({hold_duration:.1f}s)")
            # Long press is just holding spacebar - no additional action needed
            # The kiosk app detects long spacebar hold

    # Button released
    elif button_state and button_pressed:
        hold_duration = time.monotonic() - button_press_time
        button_pressed = False

        # Release spacebar
        kbd.release(Keycode.SPACE)
        print(f"Button released (duration: {hold_duration:.1f}s)")

        if long_press_triggered:
            print("  -> Was long press (print triggered)")
        else:
            print("  -> Was short press")

    # === ROTARY ENCODER HANDLING ===
    current_position = encoder.position
    if current_position != last_position:
        direction = "CW" if current_position > last_position else "CCW"

        if current_position > last_position:
            # Clockwise - send Right Arrow
            kbd.press(Keycode.RIGHT_ARROW)
            kbd.release(Keycode.RIGHT_ARROW)
            print(f"Encoder: Clockwise (Right Arrow) - position: {current_position}")
        else:
            # Counter-clockwise - send Left Arrow
            kbd.press(Keycode.LEFT_ARROW)
            kbd.release(Keycode.LEFT_ARROW)
            print(f"Encoder: Counter-clockwise (Left Arrow) - position: {current_position}")

        last_position = current_position

    time.sleep(0.01)  # 10ms loop delay
