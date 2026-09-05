import { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { AppProvider, useApp } from './state/AppContext';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import Toast from './components/Toast';
import DuplicateSheet from './components/DuplicateSheet';
import DamageSheet from './components/DamageSheet';
import NoCodeSheet from './components/NoCodeSheet';
import PhotoViewer from './components/PhotoViewer';
import BadgeLogin from './screens/BadgeLogin';
import Home from './screens/Home';
import SessionSetup from './screens/SessionSetup';
import Scan from './screens/Scan';
import Signature from './screens/Signature';
import Confirmation from './screens/Confirmation';
import DocumentScreen from './screens/DocumentScreen';
import History from './screens/History';
import SessionDetail from './screens/SessionDetail';
import ApiScreen from './screens/ApiScreen';
import Settings from './screens/Settings';

const SCREENS = {
  home: Home,
  setup: SessionSetup,
  scan: Scan,
  sign: Signature,
  confirm: Confirmation,
  doc: DocumentScreen,
  history: History,
  session: SessionDetail,
  api: ApiScreen,
  settings: Settings,
};

// Measured on the device this was reported from (Settings > Diagnostics,
// keyboard open): window height 648, "window shrank by 0", visual viewport
// 648, "shrank by 0" — the window does not resize for the keyboard at all,
// so android:windowSoftInputMode="adjustResize" had no effect. That is
// expected here: Capacitor 8 runs the activity edge-to-edge, and Android
// does not resize an edge-to-edge window for the IME — the app is supposed
// to consume the keyboard inset itself.
//
// Which is why every previous attempt failed. They all keyed off the window
// or visualViewport shrinking, and on this device neither ever does. The
// same readout shows what does work: Android reports the keyboard's height
// (303) through the Keyboard plugin, already divided by display density, so
// it is in the same units as window.innerHeight. So take that number and
// shorten the app by it ourselves.
//
// Returns both the inset to apply and whether the keyboard is up at all —
// on a device where the window *does* resize, the inset is correctly 0 while
// the keyboard is still open, and the tab bar must still be hidden.
function useKeyboard() {
  const [state, setState] = useState({ open: false, inset: 0 });
  useEffect(() => {
    const handles = [];
    let cancelled = false;
    let tallest = window.innerHeight;
    let keyboardH = 0;
    let open = false;
    const apply = () => {
      if (window.innerHeight > tallest) tallest = window.innerHeight;
      // Subtract only the part of the keyboard the window has not already
      // given up by resizing, so this stays correct on both kinds of device.
      const windowGaveUp = Math.max(0, tallest - window.innerHeight);
      setState({ open, inset: Math.max(0, Math.round(keyboardH - windowGaveUp)) });
    };
    const track = (p) => p.then((h) => { if (cancelled) h.remove(); else handles.push(h); }).catch(() => {});
    if (Capacitor.isNativePlatform()) {
      const shown = (info) => { keyboardH = info?.keyboardHeight || 0; open = true; apply(); };
      const hidden = () => { keyboardH = 0; open = false; apply(); };
      track(Keyboard.addListener('keyboardWillShow', shown));
      track(Keyboard.addListener('keyboardDidShow', shown));
      track(Keyboard.addListener('keyboardWillHide', hidden));
      track(Keyboard.addListener('keyboardDidHide', hidden));
    }
    // Fallback, and the only path in the browser preview: a visible area that
    // just lost a big chunk of height lost it to the keyboard.
    const vv = window.visualViewport;
    const onResize = () => {
      const h = vv ? vv.height : window.innerHeight;
      if (h > tallest) tallest = h;
      if (!Capacitor.isNativePlatform()) open = h < tallest - 120;
      apply();
    };
    vv?.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      handles.forEach((h) => h.remove());
      vv?.removeEventListener('resize', onResize);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return state;
}

function Shell() {
  const { ready, screen, goBack, goHome, canGoBack } = useApp();
  const scrollRef = useRef(null);
  const { open: keyboardOpen, inset: keyboardInset } = useKeyboard();

  useEffect(() => {
    let handle;
    CapacitorApp.addListener('backButton', () => {
      if (canGoBack) goBack();
      else if (screen !== 'home' && screen !== 'login') goHome();
      else CapacitorApp.exitApp();
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [canGoBack, goBack, goHome, screen]);

  // Every screen should open scrolled to its top — without this, whatever
  // scroll position was left on the previous screen (e.g. scrolled down a
  // long parcel list on Scan) carries straight over, so "Close session &
  // sign" could land on Signature already scrolled past the driver-name
  // field instead of showing it first.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [screen]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0F172A] text-white">
        <div className="text-sm font-bold tracking-wide">WMS App</div>
      </div>
    );
  }

  if (screen === 'login') return <BadgeLogin />;

  const Screen = SCREENS[screen] || Home;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-page"
      // Android won't shorten the window for the keyboard here, so do it
      // ourselves — this is what gives the scroll area real slack and puts
      // the bottom sheets' content directly above the keyboard.
      style={keyboardInset ? { height: `calc(100% - ${keyboardInset}px)` } : undefined}
    >
      <Header />
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <Screen />
      </div>
      {!keyboardOpen && <BottomNav />}
      <DuplicateSheet />
      <DamageSheet />
      <NoCodeSheet />
      <PhotoViewer />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
