import { t } from './translations/index.js';
import { claimScreenHardware, knobDirection, releaseScreenHardware, showScreen } from './screens.js';
import { fill } from './setup/text.js';
import { elements, state } from './state.js';

// =============================================================================
// Update Screen Logic
// =============================================================================

/**
 * Show update screen and wait for user decision
 * @returns {Promise<boolean>} true if user wants to install, false to skip
 */
export async function showUpdateScreen(currentVersion, newVersion) {
  return new Promise((resolve) => {
    // Update version info
    if (elements.updateVersionInfo) {
      elements.updateVersionInfo.textContent = `v${currentVersion} → v${newVersion}`;
    }

    // Texts in the active (setup) language
    applyUpdateText();

    // Reset selection to install
    state.updateSelectedOption = 'install';
    updateUpdateSelection();

    // Show update screen
    showScreen('update');

    // Knob: left = skip, right = install. Keyboard arrows/Enter (Pico in
    // production, mock in dev) arrive here too, as hardware events via main —
    // a direct keydown listener would handle every press twice.
    const handleKnobRotate = (data) => {
      if (state.screen !== 'update') return;
      state.updateSelectedOption = knobDirection(data) === 'left' ? 'skip' : 'install';
      console.log('[UPDATE] Selected:', state.updateSelectedOption);
      updateUpdateSelection();
    };

    const handleButtonPress = () => {
      if (state.screen !== 'update') return;
      releaseScreenHardware();
      console.log('[UPDATE] Confirmed:', state.updateSelectedOption);
      resolve(state.updateSelectedOption === 'install');
    };

    // Route knob/button to this screen while it is up (no listener leaks)
    claimScreenHardware(handleKnobRotate, handleButtonPress);
  });
}

/**
 * Apply the active language to the update screen texts
 */
export function applyUpdateText() {
  if (elements.updateTitle) elements.updateTitle.textContent = t('update.available');
  const skipLabel = document.getElementById('update-skip-label');
  const installLabel = document.getElementById('update-install-label');
  const hint = document.getElementById('update-hint');
  if (skipLabel) skipLabel.textContent = t('update.skip');
  if (installLabel) installLabel.textContent = t('update.install');
  if (hint) hint.textContent = t('update.hint');
  if (elements.updateProgressText) {
    elements.updateProgressText.textContent = fill(t('update.downloading'), { percent: 0 });
  }
}

/**
 * Update visual selection on update screen
 */
export function updateUpdateSelection() {
  if (elements.updateSkip && elements.updateInstall) {
    if (state.updateSelectedOption === 'skip') {
      elements.updateSkip.classList.add('selected');
      elements.updateInstall.classList.remove('selected');
    } else {
      elements.updateSkip.classList.remove('selected');
      elements.updateInstall.classList.add('selected');
    }
  }
}

/**
 * Handle update download and installation
 */
export async function handleUpdateInstall() {
  // Show progress UI
  if (elements.updateProgress) {
    elements.updateProgress.style.display = 'block';
  }

  // Hide options during download
  const updateOptions = document.querySelector('.update-options');
  const updateHint = document.querySelector('.update-hint');
  if (updateOptions) updateOptions.style.display = 'none';
  if (updateHint) updateHint.style.display = 'none';

  // Update title
  if (elements.updateTitle) {
    elements.updateTitle.textContent = t('update.updating');
  }

  // Listen for download progress (register once; retries must not stack listeners)
  if (!state.updateListenersAttached) {
  state.updateListenersAttached = true;
  window.electronAPI.onUpdateProgress((progress) => {
    console.log('[RENDERER] Update download progress:', progress + '%');
    if (elements.updateProgressFill) {
      elements.updateProgressFill.style.width = progress + '%';
    }
    if (elements.updateProgressText) {
      elements.updateProgressText.textContent = fill(t('update.downloading'), { percent: progress });
    }
  });

  // Listen for download complete
  window.electronAPI.onUpdateDownloaded((info) => {
    console.log('[RENDERER] Update downloaded, installing...');
    if (elements.updateProgressText) {
      elements.updateProgressText.textContent = t('update.installing');
    }

    // Small delay then install
    setTimeout(async () => {
      await window.electronAPI.updateInstall();
    }, 1000);
  });
  } // end once-only listener registration

  // Start download
  const downloadResult = await window.electronAPI.updateDownload();
  if (!downloadResult.success) {
    console.error('[RENDERER] Update download failed:', downloadResult.error);
    if (elements.updateProgressText) {
      elements.updateProgressText.textContent = `${t('update.downloadFailed')}: ${downloadResult.error}`;
    }

    // Show retry option after 3 seconds
    setTimeout(() => {
      // Reset and allow retry or skip
      if (updateOptions) updateOptions.style.display = 'flex';
      if (updateHint) updateHint.style.display = 'block';
      if (elements.updateTitle) elements.updateTitle.textContent = t('update.available');
      if (elements.updateProgress) elements.updateProgress.style.display = 'none';
    }, 3000);
  }
}
