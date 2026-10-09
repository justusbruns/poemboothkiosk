import { t, loadTranslations } from '../translations/index.js';
import { claimScreenHardware, knobDirection, releaseScreenHardware, showScreen } from '../screens.js';
import { elements, state } from '../state.js';

// Knob turns move the highlight, the button (or a click in dev) confirms.
// Keyboard arrows/Enter reach this screen as hardware events via main, so
// there is deliberately no keydown listener here. Resolves with 'nl' | 'en'.
export function showLanguageScreen() {
  return new Promise((resolve) => {
    const options = elements.languageOptions.map(el => el.dataset.lang);
    if (options.length === 0) return resolve('en');
    let index = 0;
    let settled = false;

    const render = () => {
      elements.languageOptions.forEach((el, i) => el.classList.toggle('selected', i === index));
      // Preview the hint in the highlighted language
      loadTranslations(options[index]);
      if (elements.languageTitle) elements.languageTitle.textContent = t('setup.chooseLanguage');
      if (elements.languageHint) elements.languageHint.textContent = t('setup.languageHint');
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      releaseScreenHardware();
      elements.languageOptions.forEach(el => el.onclick = null);
      console.log('[SETUP] Language chosen:', options[index]);
      resolve(options[index]);
    };

    const move = (dir) => {
      index = (index + (dir === 'left' ? -1 : 1) + options.length) % options.length;
      console.log('[SETUP] Language highlight:', options[index]);
      render();
    };

    claimScreenHardware(
      (data) => {
        if (state.screen !== 'language' || settled) return;
        move(knobDirection(data));
      },
      () => {
        if (state.screen !== 'language' || settled) return;
        finish();
      }
    );
    elements.languageOptions.forEach((el, i) => {
      el.onclick = () => { if (state.screen !== 'language' || settled) return; index = i; render(); finish(); };
    });

    render();
    showScreen('language');
  });
}
