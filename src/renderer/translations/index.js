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
export function t(key) {
  // Navigate nested keys like "loading.checkingCertificates"
  const keys = key.split('.');
  let value = currentTranslations;

  for (const k of keys) {
    if (value && typeof value === 'object') {
      value = value[k];
    } else {
      // Key not found, return the key itself as fallback
      console.warn(`[i18n] Translation key not found: ${key}`);
      return key;
    }
  }

  // If we got a string or array, return it; otherwise return the key
  if (typeof value === 'string' || Array.isArray(value)) {
    return value;
  } else {
    console.warn(`[i18n] Translation key "${key}" did not resolve to a string or array`);
    return key;
  }
}
