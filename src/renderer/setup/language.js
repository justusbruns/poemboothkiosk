import { t, loadTranslations } from '../translations/index.js';
import { claimScreenHardware, releaseScreenHardware, showScreen } from '../screens.js';
import { elements, state } from '../state.js';

// Enter/Space, or a click in dev) confirms. Resolves with 'nl' | 'en'.
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
      document.removeEventListener('keydown', keyHandler);
      elements.languageOptions.forEach(el => el.onclick = null);
      console.log('[SETUP] Language chosen:', options[index]);
      resolve(options[index]);
    };

    const move = (dir) => {
      index = (index + (dir === 'left' ? -1 : 1) + options.length) % options.length;
      render();
    };

    const keyHandler = (e) => {
      if (state.screen !== 'language' || settled) return;
      if (e.code === 'ArrowLeft') move('left');
      else if (e.code === 'ArrowRight') move('right');
      else if (e.code === 'Enter' || e.code === 'Space') finish();
    };

    claimScreenHardware(
      (data) => {
        if (state.screen !== 'language' || settled) return;
        move(data && data.direction === 'left' ? 'left' : 'right');
      },
      () => {
        if (state.screen !== 'language' || settled) return;
        finish();
      }
    );
    document.addEventListener('keydown', keyHandler);
    elements.languageOptions.forEach((el, i) => {
      el.onclick = () => { if (state.screen !== 'language' || settled) return; index = i; render(); finish(); };
    });

    render();
    showScreen('language');
  });
}
