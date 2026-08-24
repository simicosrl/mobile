// Full fallback list — used when an operator hasn't picked a country yet
// (Settings → Country), and as the base every country list extends.
export const CARRIERS = ['DHL', 'UPS', 'GLS', 'DPD', 'TNT', 'FEDEX', 'AMAZON', 'OTHER'];

// Countries this warehouse operates in, and the couriers actually seen
// there — each country has its own regional/national carriers on top of
// the pan-European ones (DHL, UPS, GLS, FedEx). Extend both lists here as
// new countries/carriers come up; no other file needs to change.
export const COUNTRIES = [
  { code: 'IT', name: 'Italy' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
];

export const CARRIERS_BY_COUNTRY = {
  IT: ['SDA', 'BRT', 'DHL', 'UPS', 'GLS', 'TNT', 'FEDEX', 'AMAZON', 'OTHER'],
  FR: ['COLISSIMO', 'CHRONOPOST', 'DHL', 'UPS', 'GLS', 'DPD', 'FEDEX', 'AMAZON', 'OTHER'],
  DE: ['DHL', 'HERMES', 'DPD', 'GLS', 'UPS', 'FEDEX', 'AMAZON', 'OTHER'],
};

export function carriersForCountry(countryCode) {
  return CARRIERS_BY_COUNTRY[countryCode] || CARRIERS;
}

export const DAMAGE_TYPES = ['Box damaged', 'Seal broken', 'Parcel opened'];
