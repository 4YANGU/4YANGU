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

// Circular mask with smooth anti-aliased edge
const circleMask = (size) => Buffer.from(
  `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
);

// Modern Android adaptive icon specs (108dp canvas with 72dp inner safe zone)
// Legacy icons use 48dp canvas (48, 72, 96, 144, 192 px)
const ICON_SPECS = {
  mdpi: { legacy: 48, adaptiveCanvas: 108, adaptiveLogo: 72 },
  hdpi: { legacy: 72, adaptiveCanvas: 162, adaptiveLogo: 108 },
  xhdpi: { legacy: 96, adaptiveCanvas: 216, adaptiveLogo: 144 },
  xxhdpi: { legacy: 144, adaptiveCanvas: 324, adaptiveLogo: 216 },
  xxxhdpi: { legacy: 192, adaptiveCanvas: 432, adaptiveLogo: 288 },
};

for (const [density, spec] of Object.entries(ICON_SPECS)) {
  const dir = path.join(res, `mipmap-${density}`);
  await fs.mkdir(dir, { recursive: true });

  // 1. High-clarity circular legacy icons (ic_launcher.png & ic_launcher_round.png)
  const squareIcon = await sharp(bytes)
    .resize(spec.legacy, spec.legacy, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const roundIcon = await sharp(squareIcon)
    .composite([{ input: circleMask(spec.legacy), blend: 'dest-in' }])
    .png()
    .toBuffer();
  await fs.writeFile(path.join(dir, 'ic_launcher.png'), roundIcon);
  await fs.writeFile(path.join(dir, 'ic_launcher_round.png'), roundIcon);

  // 2. High-clarity adaptive icon foreground (ic_launcher_foreground.png)
  // Generates at full 108dp canvas resolution (up to 432px for xxxhdpi)
  // centering the circular logo within the Android launcher safe zone.
  const adaptiveLogo = await sharp(bytes)
    .resize(spec.adaptiveLogo, spec.adaptiveLogo, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .composite([{ input: circleMask(spec.adaptiveLogo), blend: 'dest-in' }])
    .png()
    .toBuffer();

  const pad = Math.round((spec.adaptiveCanvas - spec.adaptiveLogo) / 2);
  const adaptiveForeground = await sharp({
    create: {
      width: spec.adaptiveCanvas,
      height: spec.adaptiveCanvas,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .composite([{ input: adaptiveLogo, left: pad, top: pad }])
    .png()
    .toBuffer();

  await fs.writeFile(path.join(dir, 'ic_launcher_foreground.png'), adaptiveForeground);
}

// Set adaptive icon background color to pure clean white (#ffffff)
const valuesDir = path.join(res, 'values');
await fs.mkdir(valuesDir, { recursive: true });
const colorsPath = path.join(valuesDir, 'colors.xml');
let colors = (await fs.readFile(colorsPath, 'utf8').catch(() => null)) || '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>';
if (colors.includes('ic_launcher_background')) {
  colors = colors.replace(/<color name="ic_launcher_background">[^<]+<\/color>/, '<color name="ic_launcher_background">#ffffff</color>');
} else {
  colors = colors.replace('</resources>', '    <color name="ic_launcher_background">#ffffff</color>\n</resources>');
}
await fs.writeFile(colorsPath, colors);

const bgPath = path.join(valuesDir, 'ic_launcher_background.xml');
if (await fs.stat(bgPath).catch(() => null)) {
  let bg = await fs.readFile(bgPath, 'utf8');
  bg = bg.replace(/<color[^>]*>[^<]+<\/color>/, '<color name="ic_launcher_background">#ffffff</color>');
  await fs.writeFile(bgPath, bg);
}

// 3. Splash screen and opening animation
// Clean white background (#ffffff) eliminates dark/black border bars.
// Centered high-resolution store logo with lanczos3 resampling for high clarity.
const splashLogoPortrait = await sharp(bytes)
  .resize(460, 460, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 }, kernel: sharp.kernel.lanczos3 })
  .png()
  .toBuffer();

const splash = await sharp({
  create: { width: 1080, height: 1920, channels: 4, background: '#ffffff' },
})
  .composite([{ input: splashLogoPortrait, left: Math.round((1080 - 460) / 2), top: Math.round((1920 - 460) / 2) }])
  .png()
  .toBuffer();

const drawable = path.join(res, 'drawable');
await fs.mkdir(drawable, { recursive: true });
await fs.writeFile(path.join(drawable, 'splash.png'), splash);

// High-clarity circular store icon for Android 12+ system splash animation
const splashIconCircle = await sharp(bytes)
  .resize(480, 480, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .composite([{ input: circleMask(480), blend: 'dest-in' }])
  .png()
  .toBuffer();
await fs.writeFile(path.join(drawable, 'splash_icon.png'), splashIconCircle);

const splashLogoLandscape = await sharp(bytes)
  .resize(420, 420, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 }, kernel: sharp.kernel.lanczos3 })
  .png()
  .toBuffer();

const landscape = await sharp({
  create: { width: 1920, height: 1080, channels: 4, background: '#ffffff' },
})
  .composite([{ input: splashLogoLandscape, left: Math.round((1920 - 420) / 2), top: Math.round((1080 - 420) / 2) }])
  .png()
  .toBuffer();

for (const entry of await fs.readdir(res, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('drawable-')) {
    const file = path.join(res, entry.name, 'splash.png');
    if (await fs.stat(file).catch(() => null)) {
      await fs.writeFile(file, entry.name.includes('land') ? landscape : splash);
    }
  }
}

// Capacitor FileProvider configuration
const filePaths = path.join(res, 'xml', 'file_paths.xml');
let paths = await fs.readFile(filePaths, 'utf8');
if (!paths.includes('shared_videos')) paths = paths.replace('</paths>', '    <cache-path name="shared_videos" path="share/" />\n</paths>');
await fs.writeFile(filePaths, paths);

// Splash theme configuration in styles.xml with clean white background and crisp icon
const stylesPath = path.join(res, 'values', 'styles.xml');
let styles = await fs.readFile(stylesPath, 'utf8');
styles = styles.replace(/<item name="windowSplashScreenBackground">[^<]+<\/item>/g, '');
styles = styles.replace(/<item name="windowSplashScreenAnimatedIcon">[^<]+<\/item>/g, '');
styles = styles.replace(
  '<item name="android:background">@drawable/splash</item>',
  '<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>\n        <item name="windowSplashScreenBackground">#ffffff</item>'
);
await fs.writeFile(stylesPath, styles);

// 4. AndroidManifest.xml: ensure notifications and vibration permissions are present
const manifestPath = path.join(root, 'AndroidManifest.xml');
if (await fs.stat(manifestPath).catch(() => null)) {
  let manifest = await fs.readFile(manifestPath, 'utf8');
  let permissionsToAdd = '';
  if (!manifest.includes('android.permission.POST_NOTIFICATIONS')) {
    permissionsToAdd += '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n';
  }
  if (!manifest.includes('android.permission.VIBRATE')) {
    permissionsToAdd += '    <uses-permission android:name="android.permission.VIBRATE" />\n';
  }
  if (permissionsToAdd) {
    manifest = manifest.replace('<application', `${permissionsToAdd}    <application`);
    await fs.writeFile(manifestPath, manifest);
  }
}

// 5. Native Java sources: MainActivity with runtime notification requests and back-button dispatcher
const javaDir = path.join(root, 'java', ...appId.split('.'));
await fs.mkdir(javaDir, { recursive: true });
const template = await fs.readFile('android-native/StoYanguWhatsAppPlugin.java.template', 'utf8');
await fs.writeFile(path.join(javaDir, 'StoYanguWhatsAppPlugin.java'), template.replaceAll('__PACKAGE__', appId));

const mainActivityJava = `package ${appId};

import android.os.Build;
import android.os.Bundle;
import android.content.pm.PackageManager;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle state) {
    registerPlugin(StoYanguWhatsAppPlugin.class);
    super.onCreate(state);

    // Request runtime POST_NOTIFICATIONS permission on Android 13+ (API 33+)
    if (Build.VERSION.SDK_INT >= 33) {
      if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 101);
      }
    }

    // Hardware/gesture back button handling:
    // First, let web app handle modals, inbox, composer, or tabs via window.__stoyanguHandleBack().
    // If not handled, fall back to browser history or standard finish.
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        if (bridge != null && bridge.getWebView() != null) {
          bridge.getWebView().evaluateJavascript(
            "(window.__stoyanguHandleBack && window.__stoyanguHandleBack()) ? 'handled' : 'unhandled';",
            value -> {
              if (value != null && value.contains("handled")) {
                // Consumed by web UI (e.g. closed modal, returned to previous post step, or left inbox)
              } else if (bridge.getWebView().canGoBack()) {
                bridge.getWebView().goBack();
              } else {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
              }
            }
          );
        } else {
          setEnabled(false);
          getOnBackPressedDispatcher().onBackPressed();
          setEnabled(true);
        }
      }
    });
  }
}
`;
await fs.writeFile(path.join(javaDir, 'MainActivity.java'), mainActivityJava);

// Gradle configuration
const gradlePath = 'android/app/build.gradle';
let gradle = await fs.readFile(gradlePath, 'utf8');
const buildNumber = Number(process.env.GITHUB_RUN_NUMBER || '1');
if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) throw new Error('Invalid APK version.');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${buildNumber}`).replace(/versionName\s+"[^"]+"/, `versionName "1.0.${buildNumber}"`);

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
  gradle = gradle.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{)/, `$1\n            signingConfig signingConfigs.stoyanguRelease`);
} else if (/buildTypes\s*\{/.test(gradle)) {
  gradle = gradle.replace(/(buildTypes\s*\{)/, `$1\n        release {\n            signingConfig signingConfigs.stoyanguRelease\n        }`);
} else {
  throw new Error('Could not find a buildTypes {} block in build.gradle.');
}
await fs.writeFile(gradlePath, gradle);

// The remote site is the app. Clean white background for offline placeholder.
const publicDir = path.join(root, 'assets', 'public');
await fs.rm(publicDir, { recursive: true, force: true });
await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(
  path.join(publicDir, 'index.html'),
  '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#ffffff;color:#0f172a;font-family:sans-serif;text-align:center;padding:4rem 1rem">Connect to the internet to open StoYangu.</body></html>'
);

console.log(`Prepared StoYangu Android wrapper for store ${process.env.STORE_ID} (build ${buildNumber}).`);
