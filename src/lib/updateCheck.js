import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

// Points at the version manifest the GitHub Actions workflow writes
// alongside the compiled APK on every build (see .github/workflows/build-apk.yml).
// Only reachable without a login because simicosrl/mobile is a public repo —
// raw.githubusercontent.com never serves private-repo content.
const VERSION_URL = 'https://raw.githubusercontent.com/simicosrl/mobile/main/version.json';

/**
 * Compares the installed app's versionCode against the latest one published
 * on GitHub. Returns { available: true, versionName, apkUrl } if a newer
 * build exists, otherwise { available: false }. Native-only — there is
 * nothing meaningful to check in the browser dev preview.
 */
export async function checkForUpdate() {
  if (!Capacitor.isNativePlatform()) return { available: false };
  try {
    const info = await CapacitorApp.getInfo();
    const currentCode = parseInt(info.build, 10) || 0;
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return { available: false };
    const latest = await res.json();
    if (typeof latest.versionCode !== 'number') return { available: false };
    if (latest.versionCode > currentCode) {
      return { available: true, versionName: latest.versionName, apkUrl: latest.apkUrl };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

/** Opens the APK download URL in the system browser (not the app's own WebView, which can't handle a binary download). */
export async function openDownload(url) {
  try {
    await Browser.open({ url });
  } catch {
    window.open(url, '_blank');
  }
}
