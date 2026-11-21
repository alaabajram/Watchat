// Display names for market countries in the admin ("ZZ" = every country without its own prices).

const NAMES: Record<string, string> = {
  AE: "UAE",
  SA: "Saudi Arabia",
  KW: "Kuwait",
  QA: "Qatar",
  BH: "Bahrain",
  OM: "Oman",
  EG: "Egypt",
  JO: "Jordan",
  LB: "Lebanon",
  IQ: "Iraq",
  MA: "Morocco",
  ZZ: "Rest of world",
};

export const countryName = (c: string) => NAMES[c] ?? c;
