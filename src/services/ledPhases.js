// What the booth's LEDs do in each step of the guest flow.
//
// Sent as plain WLED JSON state (https://kno.wled.ge/interfaces/json-api/),
// so any WLED controller works without presets on the device. `seg` without
// an id applies to every selected segment: the analog channels of the QuinLED
// An-Penta-Plus and, if connected, a digital strip.
//
// Colours are [R, G, B, W]. Effects that work on analog LEDs (one "pixel"):
// 0 Solid, 1 Blink, 2 Breathe, 12 Fade (colour 1 <-> colour 2).
// `transition` is in units of 100 ms. The second colour is always sent, so a
// colour of the previous step never lingers in an effect.

const WARM = [255, 150, 60, 120];
const WHITE = [255, 255, 255, 255];
const ORANGE = [247, 145, 31, 0]; // WOW accent
const PINK = [225, 0, 102, 0];
const GREEN = [0, 255, 70, 0];
const RED = [255, 0, 0, 0];
const OFF = [0, 0, 0, 0];

const solid = (col, bri, transition = 7) => ({ on: true, bri, transition, seg: { fx: 0, col: [col, OFF] } });

const LED_PHASES = {
  // Booth screen: slow breathing to draw people in
  idle: { on: true, bri: 150, transition: 10, seg: { fx: 2, sx: 20, col: [WARM, OFF] } },
  // Countdown: warm and bright, lights the face
  countdown: solid([255, 210, 160, 255], 230, 5),
  // The moment of the photo
  flash: solid(WHITE, 255, 0),
  // "Tap your card": pulsing accent
  paywall: { on: true, bri: 255, transition: 4, seg: { fx: 2, sx: 170, col: [ORANGE, OFF] } },
  // Payment approved
  paid: solid(GREEN, 255, 2),
  // Payment declined or cancelled (the paywall retries)
  payFailed: { on: true, bri: 255, transition: 0, seg: { fx: 1, sx: 200, col: [RED, OFF] } },
  // Portrait is being made: fade between the brand colours
  processing: { on: true, bri: 255, transition: 5, seg: { fx: 12, sx: 210, col: [ORANGE, PINK] } },
  // Portrait on screen
  reveal: solid([255, 190, 110, 220], 255, 10),
  // Printing
  printing: { on: true, bri: 220, transition: 5, seg: { fx: 2, sx: 120, col: [WHITE, OFF] } },
  // Error screen
  error: { on: true, bri: 200, transition: 0, seg: { fx: 1, sx: 120, col: [RED, OFF] } },
  // Setup screens (language, WiFi, pairing, update): calm and dim
  setup: solid(WARM, 40, 10),
};

// Colour at rest chosen in the dashboard (config.leds.idle_color, '#rrggbb'):
// same breathing as 'idle', in that colour. The part all three channels share
// goes to the white LEDs, so white is real white and not a mix of R+G+B.
function hexToRgbw(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  const w = Math.min(r, g, b);
  return [r - w, g - w, b - w, w];
}

function idleState(hex) {
  const col = hexToRgbw(hex);
  if (!col) return LED_PHASES.idle;
  return { ...LED_PHASES.idle, seg: { ...LED_PHASES.idle.seg, col: [col, OFF] } };
}

module.exports = { LED_PHASES, idleState, hexToRgbw };
