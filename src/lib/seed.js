// First-run demo history so History/Session screens aren't empty out of
// the box. Real sessions confirmed in the app are appended alongside these.
export const SEED_DOCUMENTS = [
  {
    doc: 'SM-OUT-000240', direction: 'out', carrier: 'UPS', courierCompany: 'UPS Italia',
    driverName: 'Andrei Rusu', plate: 'BG 214 RT', operator: 'Marco Pellegrini', operatorBadge: 'BADGE-4471',
    date: '22/08/2026 · 16:38', docTime: '22/08/2026 · 16:38', closedAtIso: '2026-08-22T16:38:00+02:00', signed: true,
    signatureDataUrl: null,
    parcels: [
      { code: '1Z999AA10123456784', boxes: 2, time: '16:12', damage: null, expected: null },
      { code: '1Z999AA10123456799', boxes: 1, time: '16:19', damage: null, expected: null },
      { code: '1Z999AA10123457012', boxes: 2, time: '16:27', damage: null, expected: null },
    ],
    syncStatus: 'ok',
  },
  {
    doc: 'SM-IN-000239', direction: 'in', carrier: 'DHL', courierCompany: 'DHL Express Italy s.r.l.',
    driverName: 'Luca Ferri', plate: 'MI 552 KZ', operator: 'Marco Pellegrini', operatorBadge: 'BADGE-4471',
    date: '22/08/2026 · 09:41', docTime: '22/08/2026 · 09:41', closedAtIso: '2026-08-22T09:41:00+02:00', signed: true,
    signatureDataUrl: null,
    parcels: [
      { code: 'JJD014600011234567890', boxes: 1, time: '09:18', damage: null, expected: true },
      { code: 'JJD014600011234568114', boxes: 1, time: '09:25', damage: 'Seal broken', expected: true },
      { code: 'JJD014600011234568220', boxes: 1, time: '09:33', damage: null, expected: false },
    ],
    syncStatus: 'ok',
  },
  {
    doc: 'SM-IN-000238', direction: 'in', carrier: 'GLS', courierCompany: 'GLS Italy',
    driverName: 'Ionut Barbu', plate: 'BG 771 GH', operator: 'Elena Rossi', operatorBadge: 'BADGE-2290',
    date: '21/08/2026 · 14:05', docTime: '21/08/2026 · 14:05', closedAtIso: '2026-08-21T14:05:00+02:00', signed: true,
    signatureDataUrl: null,
    parcels: [
      { code: 'GLS83920174455', boxes: 3, time: '13:47', damage: null, expected: true },
      { code: 'GLS83920174902', boxes: 1, time: '13:56', damage: 'Box damaged', expected: true },
    ],
    syncStatus: 'failed',
  },
  {
    doc: 'SM-OUT-000237', direction: 'out', carrier: 'AMAZON', courierCompany: 'Amazon Logistics',
    driverName: 'Stefan D.', plate: '', operator: 'Elena Rossi', operatorBadge: 'BADGE-2290',
    date: '21/08/2026 · 11:20', docTime: '21/08/2026 · 11:20', closedAtIso: '2026-08-21T11:20:00+02:00', signed: false,
    signatureDataUrl: null,
    parcels: [
      { code: 'FBA15KQ8N7X2001', boxes: 1, time: '11:02', damage: null, expected: null },
      { code: 'FBA15KQ8N7X2002', boxes: 1, time: '11:09', damage: null, expected: null },
    ],
    syncStatus: 'pending',
  },
];

// Badges known out of the box (badge id -> operator name), merged into the
// on-device badgeNames map on first load. Scanning one of these logs in
// immediately instead of asking for a name the first time.
export const DEFAULT_BADGE_NAMES = {
  'BADGE-IONUT': 'Staicu Ionut',
};

// Tracking IDs a fresh demo manifest pull returns before an ERP is wired up.
export const DEMO_MANIFEST = SEED_DOCUMENTS.flatMap((d) => d.parcels.map((p) => p.code)).concat([
  'FBA15KQ8N7X2003', 'JJD014600011234569001', 'GLS83920175330', '1Z999AA10123457099',
]);
