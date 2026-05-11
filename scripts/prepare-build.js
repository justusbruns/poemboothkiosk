/**
 * Pre-build step: copy Playwright's Chromium into the project so electron-builder
 * can bundle it as an extraResource. Without this, fresh kiosk installs crash with
 * "Executable doesn't exist" because Playwright's Chromium lives outside node_modules
 * and the .exe installer doesn't include it by default.
 */

const fs = require('fs');
const path = require('path');

const PLAYWRIGHT_CACHE = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const PROJECT_BROWSERS = path.join(__dirname, '..', 'playwright-browsers');

function findChromiumFolder(cacheDir) {
  if (!fs.existsSync(cacheDir)) return null;
  return fs.readdirSync(cacheDir).find(name => name.startsWith('chromium_headless_shell-'));
}

const folderName = findChromiumFolder(PLAYWRIGHT_CACHE);
if (!folderName) {
  console.error('[prepare-build] Playwright Chromium not found at', PLAYWRIGHT_CACHE);
  console.error('[prepare-build] Run: npx playwright install chromium');
  process.exit(1);
}

const source = path.join(PLAYWRIGHT_CACHE, folderName);
const target = path.join(PROJECT_BROWSERS, folderName);

// Clean any previous copy (Playwright version may have bumped)
if (fs.existsSync(PROJECT_BROWSERS)) {
  fs.rmSync(PROJECT_BROWSERS, { recursive: true, force: true });
}

fs.mkdirSync(PROJECT_BROWSERS, { recursive: true });
console.log(`[prepare-build] Copying ${folderName} (${getSizeMB(source)} MB) into the build...`);
fs.cpSync(source, target, { recursive: true });
console.log('[prepare-build] Done →', target);

function getSizeMB(dir) {
  let total = 0;
  function walk(p) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) fs.readdirSync(p).forEach(f => walk(path.join(p, f)));
    else total += stat.size;
  }
  walk(dir);
  return Math.round(total / 1024 / 1024);
}
