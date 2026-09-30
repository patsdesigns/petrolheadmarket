// Year, make and model choices for the sell wizard. A curated list of the
// makes and models enthusiasts actually list, not every car ever built:
// "Other" always lets a seller type anything the list does not have.
// Model names are written the way enthusiasts say them (911 Carrera, M3).

export const OTHER = "__other";

/** The oldest year in the year list. Older cars pick "Other" and type it. */
export const FIRST_LISTED_YEAR = 1920;

/** Years from next model year down to FIRST_LISTED_YEAR. Computed per call (never at module scope, see CLAUDE.md). */
export function yearOptions(): string[] {
  const top = new Date().getUTCFullYear() + 1;
  const years: string[] = [];
  for (let y = top; y >= FIRST_LISTED_YEAR; y--) years.push(String(y));
  return years;
}

export const MAKES: Record<string, readonly string[]> = {
  "Acura": ["Integra", "Integra Type R", "Legend", "NSX", "RSX", "RSX Type-S", "TL Type-S", "TSX"],
  "Alfa Romeo": ["4C", "8C Competizione", "Alfetta", "GTV", "GTV6", "Giulia", "Giulia Quadrifoglio", "Giulietta", "Montreal", "Spider", "Stelvio"],
  "Alpine": ["A110", "A310"],
  "AMC": ["AMX", "Gremlin", "Javelin", "Rebel"],
  "Aston Martin": ["DB5", "DB6", "DB7", "DB9", "DB11", "DBS", "Rapide", "V8 Vantage", "V12 Vantage", "Vanquish", "Vantage", "Virage"],
  "Audi": ["80 Quattro", "90 Quattro", "A4", "Quattro", "R8", "RS2", "RS3", "RS4", "RS5", "RS6", "RS7", "S2", "S4", "S5", "S6", "S8", "TT", "TT RS", "TTS", "Ur-Quattro"],
  "Austin-Healey": ["100", "3000", "Sprite"],
  "Bentley": ["Arnage", "Azure", "Continental GT", "Continental R", "Turbo R"],
  "BMW": ["1 Series M Coupe", "2002", "2002 Turbo", "3.0 CS", "3.0 CSL", "318i", "325i", "328i", "330i", "335i", "535i", "540i", "635CSi", "850i", "850CSi", "E9 Coupe", "i8", "M Coupe", "M Roadster", "M1", "M2", "M3", "M4", "M5", "M6", "M635CSi", "M8", "Z1", "Z3", "Z4", "Z4 M", "Z8"],
  "Buick": ["Grand National", "GNX", "GS", "Regal T-Type", "Riviera", "Skylark"],
  "Cadillac": ["ATS-V", "CT4-V", "CT5-V", "CTS-V", "Eldorado", "Escalade"],
  "Chevrolet": ["Bel Air", "Blazer", "C10", "Camaro", "Camaro SS", "Camaro Z28", "Chevelle", "Chevelle SS", "Corvair", "Corvette", "El Camino", "Impala", "Impala SS", "K5 Blazer", "Monte Carlo SS", "Nova", "S-10", "SSR", "Silverado"],
  "Chrysler": ["300", "300C SRT8", "Crossfire SRT-6"],
  "Datsun": ["240Z", "260Z", "280Z", "280ZX", "510", "1600 Roadster", "2000 Roadster"],
  "De Tomaso": ["Mangusta", "Pantera"],
  "DeLorean": ["DMC-12"],
  "Dodge": ["Challenger", "Challenger SRT Hellcat", "Charger", "Charger Daytona", "Coronet", "Dart", "Durango SRT", "Neon SRT-4", "Ram SRT-10", "Stealth", "Super Bee", "Viper"],
  "Ferrari": ["246 Dino", "308", "328", "348", "360", "430", "458", "488", "512 TR", "550 Maranello", "575M", "599", "612 Scaglietti", "812", "California", "F355", "F40", "F430", "F50", "F8", "FF", "GTC4Lusso", "Mondial", "Portofino", "Roma", "Testarossa"],
  "Fiat": ["124 Spider", "500", "500 Abarth", "X1/9"],
  "Ford": ["Bronco", "Bronco Raptor", "Crown Victoria", "Escort Cosworth", "F-100", "F-150", "F-150 Lightning", "F-150 Raptor", "Fairlane", "Falcon", "Fiesta ST", "Focus RS", "Focus ST", "Ford GT", "GT40", "Mustang", "Mustang Boss 302", "Mustang GT", "Mustang Mach 1", "Mustang SVT Cobra", "Probe GT", "Ranchero", "Ranger", "Shelby GT350", "Shelby GT500", "Sierra Cosworth", "Thunderbird", "Torino"],
  "GMC": ["Cyclone", "Jimmy", "Sierra", "Syclone", "Typhoon"],
  "Honda": ["Accord", "Civic", "Civic Si", "Civic Type R", "CR-X", "CRX Si", "Del Sol", "Integra", "NSX", "Prelude", "S2000", "S600", "S800"],
  "Hyundai": ["Elantra N", "Genesis Coupe", "Ioniq 5 N", "Veloster N"],
  "Infiniti": ["G35", "G37", "Q50 Red Sport", "Q60"],
  "International": ["Scout", "Scout II", "Travelall"],
  "Jaguar": ["E-Type", "F-Type", "XJ", "XJ220", "XJ-S", "XJR", "XK", "XK120", "XK140", "XK150", "XKR"],
  "Jeep": ["CJ-5", "CJ-7", "CJ-8 Scrambler", "Cherokee XJ", "Grand Cherokee", "Grand Cherokee SRT", "Grand Wagoneer", "Gladiator", "Wagoneer", "Wrangler"],
  "Lamborghini": ["Aventador", "Countach", "Diablo", "Espada", "Gallardo", "Huracan", "Jalpa", "Miura", "Murcielago", "Urus"],
  "Lancia": ["Delta Integrale", "Fulvia", "Stratos"],
  "Land Rover": ["Defender", "Discovery", "Range Rover", "Range Rover Classic", "Series II", "Series III"],
  "Lexus": ["GS", "IS 300", "IS F", "LC 500", "LFA", "RC F", "SC 300", "SC 400"],
  "Lincoln": ["Continental", "Mark VIII", "Town Car"],
  "Lotus": ["Elan", "Elise", "Emira", "Esprit", "Europa", "Evora", "Exige", "Seven"],
  "Maserati": ["3200 GT", "Bora", "Coupe", "Ghibli", "GranTurismo", "Khamsin", "MC20", "Merak", "Quattroporte", "Spyder"],
  "Mazda": ["Cosmo", "Mazdaspeed3", "Mazdaspeed Miata", "MX-5 Miata", "MX-6", "RX-2", "RX-3", "RX-7", "RX-8"],
  "McLaren": ["540C", "570S", "600LT", "650S", "675LT", "720S", "750S", "Artura", "F1", "GT", "MP4-12C", "P1"],
  "Mercedes-Benz": ["190E 2.3-16", "190E 2.5-16", "190SL", "230SL", "250SL", "280SL", "300SL", "450SL", "500E", "560SL", "C63 AMG", "CLK63 AMG", "E55 AMG", "E63 AMG", "G-Class", "G55 AMG", "G63 AMG", "SL55 AMG", "SL500", "SLK", "SLR McLaren", "SLS AMG", "AMG GT", "W123", "W124"],
  "Mercury": ["Cougar", "Cyclone", "Marauder"],
  "MG": ["MGA", "MGB", "MGB GT", "Midget", "TD", "TF"],
  "Mini": ["Cooper", "Cooper S", "John Cooper Works", "Mini (classic)"],
  "Mitsubishi": ["3000GT", "3000GT VR-4", "Eclipse", "Eclipse GSX", "Lancer Evolution", "Montero", "Starion"],
  "Nissan": ["240SX", "300ZX", "350Z", "370Z", "GT-R", "Pathfinder", "Patrol", "Pulsar", "Sentra SE-R", "Silvia", "Skyline GT-R", "Z"],
  "Oldsmobile": ["442", "Cutlass", "Cutlass Supreme", "Hurst/Olds", "Toronado"],
  "Plymouth": ["Barracuda", "Cuda", "Duster", "Fury", "GTX", "Prowler", "Road Runner", "Superbird"],
  "Pontiac": ["Fiero", "Firebird", "Firebird Trans Am", "G8", "GTO", "Grand Prix", "LeMans", "Solstice"],
  "Porsche": ["356", "550 Spyder", "911", "911 Carrera", "911 Carrera 4", "911 Carrera S", "911 GT2", "911 GT3", "911 GT3 RS", "911 SC", "911 Targa", "911 Turbo", "912", "914", "918 Spyder", "924", "928", "944", "944 Turbo", "959", "968", "Boxster", "Boxster S", "Boxster Spyder", "Carrera GT", "Cayenne", "Cayman", "Cayman GT4", "Cayman S", "Macan", "Panamera", "Taycan"],
  "Ram": ["1500 TRX", "2500", "SRT-10"],
  "Renault": ["5 Turbo", "Alpine GTA", "Clio V6"],
  "Rolls-Royce": ["Corniche", "Silver Shadow", "Silver Spur", "Wraith"],
  "Saab": ["900", "900 Turbo", "9-3 Viggen", "99 Turbo", "Sonett"],
  "Shelby": ["Cobra", "GT350", "GT500", "Series 1"],
  "Subaru": ["BRZ", "Impreza 2.5RS", "SVX", "WRX", "WRX STI", "XT"],
  "Suzuki": ["Cappuccino", "Samurai", "Swift GT"],
  "Toyota": ["2000GT", "4Runner", "86", "Celica", "Celica All-Trac", "Celica GT-Four", "Corolla AE86", "Cressida", "FJ Cruiser", "FJ40 Land Cruiser", "FJ60 Land Cruiser", "FJ80 Land Cruiser", "GR Corolla", "GR Supra", "GR86", "Hilux", "Land Cruiser", "MR2", "MR2 Turbo", "Pickup", "Supra", "Supra Turbo", "Tacoma", "Tundra"],
  "Triumph": ["GT6", "Spitfire", "Stag", "TR3", "TR4", "TR6", "TR7", "TR8"],
  "TVR": ["Cerbera", "Chimaera", "Griffith", "Tuscan"],
  "Volkswagen": ["Beetle", "Bus", "Corrado", "Corrado VR6", "Golf GTI", "Golf R", "Jetta GLI", "Karmann Ghia", "Scirocco", "Thing", "Vanagon", "Vanagon Syncro"],
  "Volvo": ["240", "242 Turbo", "740 Turbo", "850 R", "850 T-5R", "P1800", "V70 R"],
};

export const MAKE_NAMES = Object.keys(MAKES);

export function modelsFor(make: string): readonly string[] {
  return MAKES[make] ?? [];
}

/**
 * The wizard posts make and model from a dropdown, with "Other" plus a text
 * box for anything the list does not have. Turn that back into the plain
 * make and model fields the listing rules expect (in place).
 */
export function resolveCarPicks(posted: Record<string, string>): void {
  for (const field of ["year", "make", "model"] as const) {
    if (posted[field] === OTHER) posted[field] = (posted[`${field}_other`] ?? "").trim();
  }
}
