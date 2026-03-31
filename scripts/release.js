/**
 * Release script - builds, commits, and publishes a new version
 *
 * Usage:
 *   npm run release          # patch bump (1.0.0 -> 1.0.1)
 *   npm run release:patch    # patch bump
 *   npm run release:minor    # minor bump (1.0.0 -> 1.1.0)
 *   npm run release:major    # major bump (1.0.0 -> 2.0.0)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (cmd, opts = {}) => {
  console.log(`\n> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', encoding: 'utf8', ...opts });
};

const runQuiet = (cmd) => {
  return execSync(cmd, { encoding: 'utf8' }).trim();
};

async function release() {
  const bumpType = process.argv[2] || 'patch';

  if (!['patch', 'minor', 'major'].includes(bumpType)) {
    console.error(`Invalid bump type: "${bumpType}". Use patch, minor, or major.`);
    process.exit(1);
  }

  // 1. Check for uncommitted changes
  const status = runQuiet('git status --porcelain');
  if (status) {
    console.error('\nUncommitted changes detected. Commit or stash first:\n');
    console.error(status);
    process.exit(1);
  }

  // 2. Bump version
  console.log(`\n=== Bumping ${bumpType} version ===`);
  run(`npm version ${bumpType} --no-git-tag-version`);

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;
  console.log(`New version: ${tag}`);

  // 3. Build
  console.log('\n=== Building Windows installer ===');
  run('npm run build:win');

  // 4. Verify build artifacts
  const exe = `dist/poembooth-kiosk-${version}-win.exe`;
  const blockmap = `${exe}.blockmap`;
  const yml = 'dist/latest.yml';

  for (const file of [exe, blockmap, yml]) {
    if (!fs.existsSync(file)) {
      console.error(`Build artifact missing: ${file}`);
      process.exit(1);
    }
  }

  // 5. Commit and push
  console.log('\n=== Committing and pushing ===');
  run('git add package.json package-lock.json');
  run(`git commit -m "release: ${tag}"`);
  run('git push origin main');

  // 6. Create GitHub Release
  console.log('\n=== Creating GitHub Release ===');
  run(`gh release create ${tag} "${exe}" "${blockmap}" "${yml}" --title "${tag}" --generate-notes`);

  console.log(`\n=== Release ${tag} complete! ===`);
  console.log('Kiosks will see the update on next startup.');
}

release().catch((err) => {
  console.error('\nRelease failed:', err.message);
  process.exit(1);
});
