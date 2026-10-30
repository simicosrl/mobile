import { Capacitor, registerPlugin } from '@capacitor/core';

// Laser scans that the PDA's scan service sends as a broadcast instead of
// typing them (Arrvel, Urovo, iData…; see HardwareScannerPlugin.java). Only
// the most recently opened scan field receives a scan, so a sheet on top of a
// screen takes it, not the screen underneath.
const HardwareScanner = registerPlugin('HardwareScanner');

const handlers = [];
const listeners = new Set();
let last = null; // { code, action, keys, at }
let lastDelivered = { code: null, at: 0 };

// A scanner set to both type and broadcast would deliver every code twice.
const norm = (code) => String(code || '').trim().toUpperCase();
export function deliveredRecently(code) {
  return lastDelivered.code === norm(code) && Date.now() - lastDelivered.at < 800;
}
export function markDelivered(code) {
  lastDelivered = { code: norm(code), at: Date.now() };
}

if (Capacitor.isNativePlatform()) {
  HardwareScanner.addListener('scan', (ev) => {
    last = { code: ev.code || null, action: ev.action, keys: ev.keys, at: Date.now() };
    listeners.forEach((fn) => fn(last));
    const code = String(ev.code || '').trim();
    if (!code || deliveredRecently(code)) return;
    const top = handlers[handlers.length - 1];
    if (top) { markDelivered(code); top(code); }
  }).catch(() => {});
}

export function subscribeScan(handler) {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

// For the Settings check: what the last broadcast looked like.
export function lastBroadcast() { return last; }
export function onBroadcast(fn) { listeners.add(fn); return () => listeners.delete(fn); }
