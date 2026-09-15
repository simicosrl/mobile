// The aiming square, and the rule for what counts as being inside it.
//
// One definition, used both to draw the square and to judge hits, so what the
// operator sees is exactly what gets accepted. Previously the app used the
// plugin's ready-made scan() UI, which draws a frame but accepts any code
// anywhere in the camera's view — so a shelf full of labels behind the parcel
// could be picked up instead of the one being aimed at.

// Fraction of the shorter screen edge the square takes up. Big enough to aim
// without fighting it, small enough that a neighbouring label doesn't fall in.
const SIDE_FRACTION = 0.62;

export function scanSquare(viewportWidth, viewportHeight) {
  // Rounded to an even number so the square lands exactly centred rather than
  // half a pixel off — which would put the drawn frame and the accepted region
  // in slightly different places.
  const side = Math.round((Math.min(viewportWidth, viewportHeight) * SIDE_FRACTION) / 2) * 2;
  return {
    left: Math.round((viewportWidth - side) / 2),
    top: Math.round((viewportHeight - side) / 2),
    width: side,
    height: side,
  };
}

// cornerPoints come back from the plugin in physical device pixels: its Android
// side scales them to the display via DisplayMetrics.widthPixels/heightPixels
// (see normalizeCornerPoints in BarcodeScannerHelper.java). The square above is
// in CSS pixels, so divide by the device pixel ratio to compare like with like.
export function barcodeCenter(cornerPoints, devicePixelRatio = 1) {
  if (!Array.isArray(cornerPoints) || cornerPoints.length === 0) return null;
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  let sx = 0;
  let sy = 0;
  for (const p of cornerPoints) {
    const x = Array.isArray(p) ? p[0] : p?.x;
    const y = Array.isArray(p) ? p[1] : p?.y;
    if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) return null;
    sx += x;
    sy += y;
  }
  return { x: sx / cornerPoints.length / dpr, y: sy / cornerPoints.length / dpr };
}

export function isInsideSquare(square, point) {
  if (!square || !point) return false;
  return (
    point.x >= square.left &&
    point.x <= square.left + square.width &&
    point.y >= square.top &&
    point.y <= square.top + square.height
  );
}

// Pick the code the operator is actually aiming at: inside the square, and if
// several are, the one nearest its centre.
export function pickAimedBarcode(barcodes, square, devicePixelRatio = 1) {
  if (!Array.isArray(barcodes) || !square) return null;
  const cx = square.left + square.width / 2;
  const cy = square.top + square.height / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const barcode of barcodes) {
    const value = barcode?.rawValue || barcode?.displayValue;
    if (!value) continue;
    const center = barcodeCenter(barcode.cornerPoints, devicePixelRatio);
    // No corner points means no way to tell where it is. Refusing it is the
    // safer default: accepting would be the very behaviour being fixed.
    if (!center || !isInsideSquare(square, center)) continue;
    const distance = Math.hypot(center.x - cx, center.y - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = value;
    }
  }
  return best;
}
