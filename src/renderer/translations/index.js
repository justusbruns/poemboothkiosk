// Translation system - loads and manages UI language
import { en } from './en.js';
import { nl } from './nl.js';
import { de } from './de.js';
import { fr } from './fr.js';
import { es } from './es.js';
import { it } from './it.js';

// Available translations
const translations = {
  en,
  nl,
  de,
  fr,
  es,
  it
};

// Current active translations (default to English)
let currentTranslations = en;
let currentLanguage = 'en';

/**
 * Load translations for a specific language
 * @param {string} language - Language code (nl, en, de, fr, es, it)
 */
export function loadTranslations(language) {
  console.log(`[i18n] Loading translations for language: ${language}`);

  // Fallback to English if language not found
  if (translations[language]) {
    currentTranslations = translations[language];
    currentLanguage = language;
    console.log(`[i18n] ✅ Loaded ${language} translations`);
  } else {
    console.warn(`[i18n] ⚠️  Language "${language}" not found, falling back to English`);
    currentTranslations = en;
    currentLanguage = 'en';
  }
}

/**
 * Get current language code
 * @returns {string} Current language code
 */
export function getCurrentLanguage() {
  return currentLanguage;
}

/**
 * Translate a key to the current language
 * @param {string} key - Translation key (e.g., "loading.checkingCertificates")
 * @returns {string} Translated text or the key itself if not found
 */
function resolve(table, key) {
  let value = table;
  for (const k of key.split('.')) {
    if (value && typeof value === 'object') {
      value = value[k];
    } else {
      return undefined;
    }
  }
  return (typeof value === 'string' || Array.isArray(value)) ? value : undefined;
}

export function t(key) {
  // Navigate nested keys like "loading.checkingCertificates"; fall back to
  // English, then to the key itself, so a missing translation never shows
  // up as a blank or a crash on the kiosk.
  const value = resolve(currentTranslations, key);
  if (value !== undefined) return value;

  const fallback = resolve(en, key);
  if (fallback !== undefined) {
    if (currentTranslations !== en) {
      console.warn(`[i18n] Missing "${key}" in ${currentLanguage}, using English`);
    }
    return fallback;
  }

  console.warn(`[i18n] Translation key not found: ${key}`);
  return key;
}
