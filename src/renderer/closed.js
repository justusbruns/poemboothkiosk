// =============================================================================
// Closed outside opening hours. A booth at a permanent operator location gets
// the location's opening hours with its config (config.location.opening_hours,
// per weekday a list of {open, close} in the location's timezone). Outside
// those hours the start screen shows a calm "closed" notice with today's or
// the next opening time, the LEDs go off and the button does nothing. Event
// booths (no location) are always open. Checked every 30 s and on every
// config refresh (changed hours arrive as a Realtime poke); the clock itself
// is checked on every whole minute, so the booth opens exactly on time.
// =============================================================================

import { t } from './translations/index.js';
import { state } from './state.js';
import { setLedPhase } from './leds.js';
import { stopIdleAttract, restartIdleAttract } from './booth/coverflow.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
let timer = null;

function localNow(timeZone) {
  // Weekday + minutes since midnight in the location's timezone
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date());
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const day = DAYS.indexOf(String(get('weekday') || '').toLowerCase().slice(0, 3));
    const minutes = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
    return { day: day < 0 ? new Date().getDay() : day, minutes };
  } catch (e) {
    const d = new Date();
    return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

function slotsFor(hours, dayIndex) {
  const list = hours && hours[DAYS[dayIndex]];
  return Array.isArray(list) ? list.filter((s) => toMin(s.open) !== null && toMin(s.close) !== null) : [];
}

// { closed: false } or { closed: true, next: { today: bool, dayIndex, open } | null }
export function closedState() {
  const loc = state.kioskConfig && state.kioskConfig.location;
  const hours = loc && loc.opening_hours;
  if (!hours || typeof hours !== 'object' || !Object.keys(hours).length) return { closed: false };
  const { day, minutes } = localNow(loc.timezone || 'Europe/Amsterdam');
  const today = slotsFor(hours, day);
  if (today.some((s) => minutes >= toMin(s.open) && minutes < toMin(s.close))) return { closed: false };
  // Later today?
  const later = today.filter((s) => toMin(s.open) > minutes).sort((a, b) => toMin(a.open) - toMin(b.open))[0];
  if (later) return { closed: true, next: { today: true, dayIndex: day, open: later.open } };
  // Next day with hours
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    const slots = slotsFor(hours, d).sort((a, b) => toMin(a.open) - toMin(b.open));
    if (slots.length) return { closed: true, next: { today: false, dayIndex: d, open: slots[0].open, tomorrow: i === 1 } };
  }
  return { closed: true, next: null }; // no hours at all this week
}

export function isClosedNow() {
  return !!state.closed;
}

function dayName(dayIndex) {
  const lang = (state.kioskConfig && state.kioskConfig.kiosk_language) || 'nl';
  const d = new Date();
  d.setDate(d.getDate() + ((dayIndex - d.getDay() + 7) % 7));
  try { return new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(d); } catch (e) { return DAYS[dayIndex]; }
}

export function updateClosed() {
  const el = document.getElementById('closed-screen');
  if (!el) return;
  const s = closedState();
  const was = !!state.closed;
  state.closed = s.closed;
  if (!s.closed) {
    el.style.display = 'none';
    if (was) {
      console.log('[CLOSED] Open again');
      if (state.screen === 'booth') { setLedPhase('idle'); restartIdleAttract(); }
    }
    return;
  }
  const title = document.getElementById('closed-title');
  const text = document.getElementById('closed-text');
  if (title) title.textContent = t('closed.title');
  let line = t('closed.noHours');
  if (s.next) {
    if (s.next.today) line = t('closed.todayAt').replace('{time}', s.next.open);
    else if (s.next.tomorrow) line = t('closed.tomorrowAt').replace('{time}', s.next.open);
    else line = t('closed.dayAt').replace('{day}', dayName(s.next.dayIndex)).replace('{time}', s.next.open);
  }
  if (text) text.textContent = line;
  el.style.display = 'flex';
  if (!was) {
    console.log('[CLOSED] Outside opening hours:', line);
    stopIdleAttract();
  }
  if (state.screen === 'booth') setLedPhase('off');
}

export function startClosedWatch() {
  if (timer) clearTimeout(timer);
  updateClosed();
  // Next check on the next whole minute (opening hours are whole minutes)
  const msToMinute = 60000 - (Date.now() % 60000) + 50;
  timer = setTimeout(startClosedWatch, msToMinute);
}
