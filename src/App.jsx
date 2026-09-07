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

// What the keyboard actually does on the reported device, from the frozen
// Diagnostics readout taken while it was open:
//
//   keyboard height 303 | window height 90 (was 648) | scroll area 53..90
//
// So the window does resize for the keyboard — it just resized twice, once
// for android:windowSoftInputMode="adjustResize" and again for the
// interactive-widget viewport hint, both of which this file's history added
// together: 648 - 279 - 279 = 90. That left the whole app as a 37px strip,
// which is the sliver of a field the operator was seeing. Both are gone now;
// the native default that v1.0.65 shipped with resizes correctly on its own.
//
// (An earlier reading of this same panel said "shrank by 0" and concluded the
// window never resizes. That reading was taken live, after the keyboard had
// already closed and everything had snapped back — it was measuring nothing.
// Hence the frozen block.)
//
// What stays is a safety net for a device whose window does NOT resize: take
// the keyboard height Android reports (already divided by display density in
// the plugin, so it is in the same units as window.innerHeight) and shorten
// the app by whatever part of it the window hasn't already given up.
//
// Returns the inset to apply and whether the keyboard is up at all — the tab
// bar has to be hidden either way, or it squeezes in above the keyboard and
// takes 59px from the field being typed in.
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
      // If the window has already given up most of the keyboard's height, it
      // is handling this itself and must be left alone — subtracting the
      // remainder is how the double-shrink to 90px happened. The two numbers
      // never match exactly (the device reported a 303 keyboard against a 279
      // window shrink), so this compares loosely rather than exactly.
      const windowHandledIt = keyboardH > 0 && windowGaveUp >= keyboardH * 0.6;
      const inset = windowHandledIt ? 0 : Math.max(0, Math.round(keyboardH - windowGaveUp));
      // The focus-scroll correction in main.jsx is a plain global listener
      // with no access to this hook, and on this device it cannot work out
      // the keyboard's height for itself — visualViewport never changes.
      // Hand it the number.
      window.__keyboardInset = inset;
      setState({ open, inset });
      if (window.__rescrollFocused) window.__rescrollFocused();
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
      window.__keyboardInset = 0;
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
      // While the keyboard is up, pin the app to exactly the area above it
      // rather than trusting a percentage height. height:100% only lands in
      // the right place if every ancestor's height is already right, and this
      // is precisely where that kept going wrong — once by not shrinking at
      // all, once by shrinking twice down to a 37px strip. Fixed positioning
      // states the box outright: top of the screen to the top of the keyboard.
      // The inset is 0 on a device whose window already resized, in which case
      // bottom:0 is the top of the keyboard anyway.
      style={
        keyboardOpen
          ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: keyboardInset, height: 'auto' }
          : undefined
      }
    >
      <Header />
      {/* Bottom padding only matters on that same non-resizing device: there
          the page keeps its full height with the keyboard over it and has no
          slack at all (scrollHeight === clientHeight), so nothing has anywhere
          to scroll the field to. Where the window does resize, the slack comes
          for free and the inset is 0. */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
      >
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
