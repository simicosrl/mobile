export const pad6 = (n) => String(n).padStart(6, '0');

export const hhmm = (d = new Date()) =>
  String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

export const ddmmyyyy = (d = new Date()) => d.toLocaleDateString('en-GB');

export const stamp = (d = new Date()) => `${ddmmyyyy(d)} · ${hhmm(d)}`;

export const elapsedLabel = (startedAt) => {
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

export const docNumber = (direction, seq) => (direction === 'out' ? 'WH-OUT-' : 'WH-IN-') + pad6(seq);
