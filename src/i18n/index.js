import fr from './fr/index.js';

// The app's text is written in English in the code and wrapped in t(); the
// French text comes from the dictionaries in ./fr, keyed by that English text.
// A string missing from the dictionary shows in English rather than not at
// all. Placeholders: t('{n} parcels', { n: 3 }).
//
// The language is chosen per phone in Settings; until one is chosen it follows
// the warehouse (French in France, English elsewhere). AppContext sets it
// before every render, so all screens pick a change up at once.
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
];

let current = 'en';

export function setLanguage(code) {
  current = code === 'fr' ? 'fr' : 'en';
}

export function getLanguage() {
  return current;
}

export function t(text, vars) {
  let s = current === 'fr' ? (fr[text] ?? text) : text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// Default when nobody has chosen: the warehouse's language, or the phone's
// before anyone is signed in.
export function defaultLanguage(country) {
  if (country) return country === 'FR' ? 'fr' : 'en';
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
