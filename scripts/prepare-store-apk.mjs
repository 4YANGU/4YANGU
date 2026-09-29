import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const slug = String(process.env.STORE_SLUG || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 42);
const storeId = String(process.env.STORE_ID || '').replace(/[^0-9]/g, '');
const appId = `com.stoyangu.store.s_${storeId}`;
const root = path.resolve('android/app/src/main');
const live = String(process.env.STOYANGU_LIVE_URL || '').replace(/\/$/, '');
const logoInput = String(process.env.STORE_LOGO_URL || '');
if (!storeId || !slug || !/^https:\/\//.test(live) || !logoInput) throw new Error('Store ID, slug, HTTPS live URL and store logo are required.');
const source = logoInput.startsWith('/') ? `${live}${logoInput}` : logoInput;
if (!source.startsWith('https://')) throw new Error('Store logo must be hosted at HTTPS.');
const response = await fetch(source, { signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error(`Store logo could not be downloaded (${response.status}).`);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length > 8 * 1024 * 1024) throw new Error('Store logo must be smaller than 8 MB.');
await sharp(bytes).metadata();
const res = path.join(root, 'res');
// Round-mask helper: composites a circle-shaped alpha mask onto a square icon so the app
// icon actually looks like the circular logo crop shown on the store details page, instead
// of showing the full square photo with its own background peeking out around the edges.
const circleMask = (size) => Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const dir = path.join(res, `mipmap-${density}`); await fs.mkdir(dir, { recursive: true });
  const squareIcon = await sharp(bytes).resize(size, size, { fit: 'cover' }).png().toBuffer();
  const roundIcon = await sharp(squareIcon).composite([{ input: circleMask(size), blend: 'dest-in' }]).png().toBuffer();
  await fs.writeFile(path.join(dir, 'ic_launcher.png'), roundIcon);
  await fs.writeFile(path.join(dir, 'ic_launcher_round.png'), roundIcon);
  // Foreground for Android's modern "adaptive icon" system (what almost every phone made
  // since ~2018, including the Samsung S22 Plus, actually shows). This used to be shrunk to
  // 68% with a solid-color margin, which looked small and washed-out next to the full-bleed
  // circular photo on the Manage Store page. Filling edge-to-edge (same cover-crop as the
  // legacy icon above) matches that look closely; Android applies its own circle/squircle
  // mask on top, same as it does for every other app's photo-style icon.
  const foreground = await sharp(bytes).resize(size, size, { fit: 'cover' }).png().toBuffer();
  await fs.writeFile(path.join(dir, 'ic_launcher_foreground.png'), foreground);
}
const splash = await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#101f30' } }).composite([{ input: await sharp(bytes).resize(500, 500, { fit: 'contain' }).png().toBuffer(), left: 290, top: 710 }]).png().toBuffer();
const drawable = path.join(res, 'drawable'); await fs.mkdir(drawable, { recursive: true });
await fs.writeFile(path.join(drawable, 'splash.png'), splash);
const landscape = await sharp({ create: { width: 1920, height: 1080, channels: 4, background: '#101f30' } }).composite([{ input: await sharp(bytes).resize(400, 400, { fit: 'contain' }).png().toBuffer(), left: 760, top: 340 }]).png().toBuffer();
for (const entry of await fs.readdir(res, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('drawable-')) {
    const file = path.join(res, entry.name, 'splash.png');
    if (await fs.stat(file).catch(() => null)) await fs.writeFile(file, entry.name.includes('land') ? landscape : splash);
  }
}
// Capacitor already declares FileProvider. Add the share cache path to its existing provider instead of declaring a duplicate.
const filePaths = path.join(res, 'xml', 'file_paths.xml');
let paths = await fs.readFile(filePaths, 'utf8');
if (!paths.includes('shared_videos')) paths = paths.replace('</paths>', '    <cache-path name="shared_videos" path="share/" />\n</paths>');
await fs.writeFile(filePaths, paths);
const stylesPath = path.join(res, 'values', 'styles.xml');
let styles = await fs.readFile(stylesPath, 'utf8');
if (!styles.includes('windowSplashScreenAnimatedIcon')) styles = styles.replace('<item name="android:background">@drawable/splash</item>', '<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>\n        <item name="windowSplashScreenBackground">#101f30</item>');
await fs.writeFile(stylesPath, styles);
const javaDir = path.join(root, 'java', ...appId.split('.')); await fs.mkdir(javaDir, { recursive: true });
const template = await fs.readFile('android-native/StoYanguWhatsAppPlugin.java.template', 'utf8');
await fs.writeFile(path.join(javaDir, 'StoYanguWhatsAppPlugin.java'), template.replaceAll('__PACKAGE__', appId));
await fs.writeFile(path.join(javaDir, 'MainActivity.java'), `package ${appId};\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity {\n  @Override public void onCreate(Bundle state) { registerPlugin(StoYanguWhatsAppPlugin.class); super.onCreate(state); }\n}\n`);
const gradlePath = 'android/app/build.gradle'; let gradle = await fs.readFile(gradlePath, 'utf8');
const buildNumber = Number(process.env.GITHUB_RUN_NUMBER || '1');
if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) throw new Error('Invalid APK version.');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${buildNumber}`).replace(/versionName\s+"[^"]+"/, `versionName "1.0.${buildNumber}"`);
// Insert the signing config into the EXISTING android {} block instead of appending a second
// top-level android {} block — appending a second block breaks some Capacitor/AGP combinations
// with "Cannot invoke method buildTypes() on null object".
const signingConfigsBlock = `    signingConfigs {
        stoyanguRelease {
            storeFile file(System.getenv('STOYANGU_KEYSTORE_PATH'))
            storePassword System.getenv('APK_KEYSTORE_PASSWORD')
            keyAlias System.getenv('APK_KEY_ALIAS')
            keyPassword System.getenv('APK_KEY_PASSWORD')
        }
    }
`;
if (!/android\s*\{/.test(gradle)) throw new Error('Could not find the android {} block in build.gradle.');
gradle = gradle.replace(/(android\s*\{)/, `$1\n${signingConfigsBlock}`);
if (/buildTypes\s*\{[\s\S]*?release\s*\{/.test(gradle)) {
  // A release {} block already exists inside buildTypes {} — add signingConfig to it.
  gradle = gradle.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{)/, `$1\n            signingConfig signingConfigs.stoyanguRelease`);
} else if (/buildTypes\s*\{/.test(gradle)) {
  // buildTypes {} exists but has no release {} block — add one.
  gradle = gradle.replace(/(buildTypes\s*\{)/, `$1\n        release {\n            signingConfig signingConfigs.stoyanguRelease\n        }`);
} else {
  throw new Error('Could not find a buildTypes {} block in build.gradle.');
}
await fs.writeFile(gradlePath, gradle);
// The remote site is the app. Keep only an offline message, not a bundled copy of the React app.
const publicDir = path.join(root, 'assets', 'public'); await fs.rm(publicDir, { recursive: true, force: true }); await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#101f30;color:white;font-family:sans-serif;text-align:center;padding:4rem 1rem">Connect to the internet to open StoYangu.</body></html>');
console.log(`Prepared StoYangu Android wrapper for store ${process.env.STORE_ID} (build ${buildNumber}).`);
