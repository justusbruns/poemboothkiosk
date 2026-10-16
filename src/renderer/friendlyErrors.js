// =============================================================================
// Friendly errors: what the booth shows when something is wrong. No raw
// technical text on screen (that stays in the log and, in dev, under
// "Technical details"): a calm title, what is going on in plain words, what
// to do, and an automatic retry where waiting helps.
// =============================================================================

// kind → seconds until the booth tries again by itself (0 = only on the button)
const RETRY_S = {
  connection: 20,
  server: 30,
  notLinked: 60,
  noStyles: 60,
  camera: 20,
  generic: 30
};

export function classifyError(error) {
  const msg = String((error && (error.message || error)) || '');
  if (/no poem styles configured|no styles/i.test(msg)) return 'noStyles';
  if (/equipment not found|register this device|not registered/i.test(msg)) return 'notLinked';
  if (/getusermedia|camera|NotAllowedError|NotFoundError|NotReadableError|OverconstrainedError|video/i.test(msg)) return 'camera';
  if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|offline|timed? ?out|socket/i.test(msg)) return 'connection';
  if (/HTTP 5\d\d/.test(msg)) return 'server';
  return 'generic';
}

export function retrySeconds(kind) {
  return RETRY_S[kind] ?? 30;
}
