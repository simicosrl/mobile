// Turns a parcel barcode into the tracking number people know, when the two
// differ.
//
// Colissimo: the big barcode is a 28-character sorting code, not the tracking.
//   0035350116A0811698449801250W
//   └ 9: "00" + destination postcode + 2 ┘ │ └ service "801" + 4
//                        "6A0811698449" ──┘
// The tracking (Num colis) is those 12 characters plus a check digit that is
// not in the barcode: weights 3,1,3,1… from the right over the 10 digits,
// mod 10 (checked against real labels: 6G6204737773 → 6, 6A0811698449 → 8).
// On the label the barcode is printed without its first character: the
// scanner reads a leading "%" (e.g. "%0035350116G62047377738032506"), so
// leading symbols are dropped before matching. The tail after the tracking is
// allowed some slack, as scanners differ in what they pass on.
const COLISSIMO_SORTING = /^\d{9}(\d[A-Z])(\d{10})\d{3}[0-9A-Z]{0,6}$/;

// Chronopost: the same kind of sorting code, 7 characters ("00" + postcode)
// before the tracking.
//   0035350NX010231293336866901P
//   └ 7 ┘└── NX + 12 digits ─┘└ service "866" + rest
// The label prints the tracking with a final check letter
// ("NX01 0231 2933 36 N") that is not in the barcode and whose rule isn't
// known, so the tracking is taken without it: NX010231293336.
const CHRONOPOST_SORTING = /^\d{7}([A-Z]{2}\d{12})\d{3}[0-9A-Z]{0,6}$/;

function colissimoCheckDigit(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const d = Number(digits[digits.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function trackingFromBarcode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  const compact = code.replace(/[\s\x00-\x1f]+/g, '').replace(/^[^0-9A-Z]+/, '');
  if (compact.length < 24 || compact.length > 31) return code;
  const m = COLISSIMO_SORTING.exec(compact);
  if (m) return `${m[1]}${m[2]}${colissimoCheckDigit(m[2])}`;
  const c = CHRONOPOST_SORTING.exec(compact);
  if (c) return c[1];
  return code;
}
