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
const COLISSIMO_SORTING = /^\d{9}(\d[A-Z])(\d{10})\d{3}[0-9A-Z]{4}$/;

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
  const m = COLISSIMO_SORTING.exec(code.replace(/\s+/g, ''));
  if (m) return `${m[1]}${m[2]}${colissimoCheckDigit(m[2])}`;
  return code;
}
