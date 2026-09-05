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

// The app now resizes for the on-screen keyboard (adjustResize in
// AndroidManifest.xml + the interactive-widget viewport hint in index.html) —
// which is what finally makes a focused field reachable instead of buried
// under the keyboard. But with the layout that much shorter, the bottom tab
// bar would squeeze up and sit directly above the keyboard, stealing 59px
// from the field you're actually typing in. So: while the keyboard is up, the
// tab bar goes away. You can't tap it anyway with the keyboard covering it.
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handles = [];
    let cancelled = false;
    const track = (p) => p.then((h) => { if (cancelled) h.remove(); else handles.push(h); }).catch(() => {});
    if (Capacitor.isNativePlatform()) {
      track(Keyboard.addListener('keyboardWillShow', () => setOpen(true)));
      track(Keyboard.addListener('keyboardWillHide', () => setOpen(false)));
    }
    // Fallback, and the only path in the browser preview build: a visible area
    // that just lost a big chunk of height lost it to the keyboard. Tracking
    // the tallest height seen keeps this correct across rotation.
    const vv = window.visualViewport;
    let tallest = vv ? vv.height : window.innerHeight;
    const onResize = () => {
      const h = vv ? vv.height : window.innerHeight;
      if (h > tallest) tallest = h;
      setOpen(h < tallest - 120);
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
  return open;
}

function Shell() {
  const { ready, screen, goBack, goHome, canGoBack } = useApp();
  const scrollRef = useRef(null);
  const keyboardOpen = useKeyboardOpen();

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
    <div className="relative flex h-full flex-col overflow-hidden bg-page">
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
