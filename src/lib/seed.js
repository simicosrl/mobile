// Editable via the Settings screen — these are just the out-of-the-box
// defaults (matching the original design spec's placeholder company block,
// which explicitly called out replacing them with the client's real details).
export const DEFAULT_ORG_SETTINGS = {
  warehouseLocation: 'Casazza (BG)',
  warehouseDock: 'Dock 2',
  companyName: 'SIMICO SRL',
  companyAddress: "Via dell'Industria 12, 24060 Casazza (BG), Italy",
  companyVat: 'P.IVA IT04512340167',
  companyEmail: 'warehouse@simico.srl',
};

// Badges known out of the box (badge id -> operator name), merged into the
// on-device badgeNames map on first load. Scanning one of these logs in
// immediately instead of asking for a name the first time.
export const DEFAULT_BADGE_NAMES = {
  'BADGE-IONUT': 'Staicu Ionut',
};
