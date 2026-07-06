/**
 * electron-builder afterPack hook — explicit ad-hoc codesign.
 *
 * We build without a Developer ID (CSC_IDENTITY_AUTO_DISCOVERY=false). Some
 * electron-builder versions then SKIP signing entirely instead of falling back
 * to ad-hoc — and an arm64 mach-o with no valid signature is killed by macOS
 * on launch ("Killed: 9"). Re-signing the whole bundle with the ad-hoc
 * identity ("-") is free, needs no account, and guarantees every binary in the
 * .app carries a valid signature. Gatekeeper's first-launch prompt (unsigned /
 * un-notarized) still applies — that part needs a paid account.
 */
const { execSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  console.log(`[afterPack] ad-hoc codesign: ${appPath}`);
  // --deep is deprecated but fine for ad-hoc: we just need every nested
  // mach-o (Electron helpers, bundled python, ffmpeg) to carry a signature.
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
};
