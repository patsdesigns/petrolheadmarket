// Year, make and model choices for the sell wizard. A curated list of the
// makes and models enthusiasts actually list, not every car ever built:
// "Other" always lets a seller type anything the list does not have.
// Model names are written the way enthusiasts say them (911 Carrera, M3).
//
// Each model carries the model years it was built: "Name|1986-2001,2023-".
// A range with no end year is still in production. The years are there to
// filter the lists (a 1993 Porsche offers no Cayenne); they are a guide, not
// a rule, so nothing is refused on the server because of them.

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
  "Acura": ["Integra|1986-2001,2023-", "Integra Type R|1997-2001,2024-", "Legend|1986-1995", "NSX|1991-2005,2017-2022", "RSX|2002-2006", "RSX Type-S|2002-2006", "TL Type-S|2002-2003,2007-2008,2021-2023", "TSX|2004-2014"],
  "Alfa Romeo": ["4C|2015-2020", "8C Competizione|2008-2010", "Alfetta|1972-1987", "GTV|1974-1987,1995-2005", "GTV6|1981-1987", "Giulia|1962-1978,2017-", "Giulia Quadrifoglio|2017-", "Giulietta|1954-1965,1977-1985,2010-2020", "Montreal|1970-1977", "Spider|1966-2010", "Stelvio|2018-"],
  "Alpine": ["A110|1961-1977,2017-", "A310|1971-1984"],
  "AMC": ["AMX|1968-1970", "Gremlin|1970-1978", "Javelin|1968-1974", "Rebel|1967-1970"],
  "Aston Martin": ["DB5|1963-1965", "DB6|1965-1970", "DB7|1994-2004", "DB9|2004-2016", "DB11|2016-2023", "DBS|1967-1972,2008-2012,2018-", "Rapide|2010-2020", "V8 Vantage|1977-1989,2005-2017", "V12 Vantage|2009-2018,2022-2023", "Vanquish|2001-2007,2012-2018,2025-", "Vantage|1977-1989,1993-2000,2005-", "Virage|1989-1995,2011-2012"],
  "Audi": ["80 Quattro|1981-1991", "90 Quattro|1988-1995", "A4|1995-", "Quattro|1980-1991", "R8|2007-2023", "RS2|1994-1995", "RS3|2011-", "RS4|2000-", "RS5|2010-", "RS6|2002-", "RS7|2014-", "S2|1990-1995", "S4|1992-", "S5|2008-", "S6|1995-", "S8|1997-", "TT|1999-2023", "TT RS|2010-2023", "TTS|2009-2023", "Ur-Quattro|1980-1991"],
  "Austin-Healey": ["100|1953-1956", "3000|1959-1967", "Sprite|1958-1971"],
  "Bentley": ["Arnage|1998-2009", "Azure|1995-2009", "Continental GT|2003-", "Continental R|1991-2003", "Turbo R|1985-1997"],
  "BMW": ["1 Series M Coupe|2011-2012", "2002|1968-1976", "2002 Turbo|1973-1974", "3.0 CS|1971-1975", "3.0 CSL|1971-1975", "318i|1983-2005", "325i|1987-2006", "328i|1996-2016", "330i|2001-2006,2017-", "335i|2007-2015", "535i|1985-1993,2008-2016", "540i|1994-2003,2017-2023", "635CSi|1978-1989", "850i|1990-1997", "850CSi|1992-1996", "E9 Coupe|1968-1975", "i8|2014-2020", "M Coupe|1998-2002", "M Roadster|1998-2002,2006-2008", "M1|1978-1981", "M2|2016-", "M3|1986-", "M4|2015-", "M5|1985-", "M6|1983-1989,2006-2018", "M635CSi|1983-1989", "M8|2019-", "Z1|1989-1991", "Z3|1996-2002", "Z4|2003-", "Z4 M|2006-2008", "Z8|2000-2003"],
  "Buick": ["Grand National|1982-1987", "GNX|1987-1987", "GS|1965-1975", "Regal T-Type|1983-1987", "Riviera|1963-1999", "Skylark|1953-1998"],
  "Cadillac": ["ATS-V|2016-2019", "CT4-V|2020-", "CT5-V|2020-", "CTS-V|2004-2019", "Eldorado|1953-2002", "Escalade|1999-"],
  "Chevrolet": ["Bel Air|1950-1975", "Blazer|1969-", "C10|1960-1987", "Camaro|1967-2024", "Camaro SS|1967-1972,1996-2002,2010-2024", "Camaro Z28|1967-2002,2014-2015", "Chevelle|1964-1977", "Chevelle SS|1964-1973", "Corvair|1960-1969", "Corvette|1953-", "El Camino|1959-1960,1964-1987", "Impala|1958-1985,1994-1996,2000-2020", "Impala SS|1961-1969,1994-1996,2004-2005", "K5 Blazer|1969-1991", "Monte Carlo SS|1970-1971,1983-1988,2000-2007", "Nova|1962-1979,1985-1988", "S-10|1982-2004", "SSR|2003-2006", "Silverado|1999-"],
  "Chrysler": ["300|2005-2023", "300C SRT8|2005-2014", "Crossfire SRT-6|2005-2006"],
  "Datsun": ["240Z|1970-1973", "260Z|1974-1974", "280Z|1975-1978", "280ZX|1979-1983", "510|1968-1973", "1600 Roadster|1965-1970", "2000 Roadster|1967-1970"],
  "De Tomaso": ["Mangusta|1967-1971", "Pantera|1971-1992"],
  "DeLorean": ["DMC-12|1981-1983"],
  "Dodge": ["Challenger|1970-1974,1978-1983,2008-2023", "Challenger SRT Hellcat|2015-2023", "Charger|1966-1978,1982-1987,2006-", "Charger Daytona|1969-1969,2006-", "Coronet|1949-1976", "Dart|1960-1976,2013-2016", "Durango SRT|2018-", "Neon SRT-4|2003-2005", "Ram SRT-10|2004-2006", "Stealth|1991-1996", "Super Bee|1968-1971,2007-2009,2012-2014", "Viper|1992-2017"],
  "Ferrari": ["246 Dino|1969-1974", "308|1975-1985", "328|1985-1989", "348|1989-1995", "360|1999-2005", "458|2010-2015", "488|2015-2019", "512 TR|1991-1994", "550 Maranello|1996-2001", "575M|2002-2006", "599|2006-2012", "612 Scaglietti|2004-2011", "812|2017-", "California|2008-2017", "F355|1994-1999", "F40|1987-1992", "F430|2004-2009", "F50|1995-1997", "F8|2019-2023", "FF|2011-2016", "GTC4Lusso|2016-2020", "Mondial|1980-1993", "Portofino|2018-", "Roma|2020-", "Testarossa|1984-1991"],
  "Fiat": ["124 Spider|1966-1985,2017-2020", "500|1957-1975,2012-2019", "500 Abarth|2012-2019", "X1/9|1972-1989"],
  "Ford": ["Bronco|1966-1996,2021-", "Bronco Raptor|2022-", "Crown Victoria|1955-1956,1992-2012", "Escort Cosworth|1992-1996", "F-100|1953-1983", "F-150|1975-", "F-150 Lightning|1993-1995,1999-2004,2022-", "F-150 Raptor|2010-", "Fairlane|1955-1970", "Falcon|1960-1970", "Fiesta ST|2014-2019", "Focus RS|2002-2003,2009-2011,2016-2018", "Focus ST|2006-2018", "Ford GT|2005-2006,2017-2022", "GT40|1964-1969", "Mustang|1965-", "Mustang Boss 302|1969-1970,2012-2013", "Mustang GT|1982-", "Mustang Mach 1|1969-1978,2003-2004,2021-2023", "Mustang SVT Cobra|1993-2004", "Probe GT|1989-1997", "Ranchero|1957-1979", "Ranger|1983-2011,2019-", "Shelby GT350|1965-1970,2015-2020", "Shelby GT500|1967-1970,2007-2014,2020-2022", "Sierra Cosworth|1986-1992", "Thunderbird|1955-1997,2002-2005", "Torino|1968-1976"],
  "GMC": ["Jimmy|1970-2005", "Sierra|1988-", "Syclone|1991-1991", "Typhoon|1992-1993"],
  "Honda": ["Accord|1976-", "Civic|1973-", "Civic Si|1986-", "Civic Type R|1997-", "CR-X|1984-1991", "CRX Si|1985-1991", "Del Sol|1993-1997", "Integra|1985-2006", "NSX|1990-2005,2016-2022", "Prelude|1978-2001,2025-", "S2000|1999-2009", "S600|1964-1966", "S800|1966-1970"],
  "Hyundai": ["Elantra N|2022-", "Genesis Coupe|2010-2016", "Ioniq 5 N|2025-", "Veloster N|2019-2022"],
  "Infiniti": ["G35|2003-2008", "G37|2008-2013", "Q50 Red Sport|2016-2024", "Q60|2014-2022"],
  "International": ["Scout|1961-1971", "Scout II|1971-1980", "Travelall|1953-1975"],
  "Jaguar": ["E-Type|1961-1975", "F-Type|2014-2024", "XJ|1968-2019", "XJ220|1992-1994", "XJ-S|1975-1996", "XJR|1995-2019", "XK|1996-2014", "XK120|1948-1954", "XK140|1954-1957", "XK150|1957-1961", "XKR|1998-2014"],
  "Jeep": ["CJ-5|1954-1983", "CJ-7|1976-1986", "CJ-8 Scrambler|1981-1985", "Cherokee XJ|1984-2001", "Grand Cherokee|1993-", "Grand Cherokee SRT|2006-2010,2012-2021", "Grand Wagoneer|1984-1991,2022-", "Gladiator|1963-1988,2020-", "Wagoneer|1963-1991,2022-", "Wrangler|1987-"],
  "Lamborghini": ["Aventador|2011-2022", "Countach|1974-1990", "Diablo|1990-2001", "Espada|1968-1978", "Gallardo|2003-2013", "Huracan|2014-2024", "Jalpa|1981-1988", "Miura|1966-1973", "Murcielago|2001-2010", "Urus|2018-"],
  "Lancia": ["Delta Integrale|1987-1994", "Fulvia|1963-1976", "Stratos|1973-1978"],
  "Land Rover": ["Defender|1983-2016,2020-", "Discovery|1989-", "Range Rover|1970-", "Range Rover Classic|1970-1996", "Series II|1958-1971", "Series III|1971-1985"],
  "Lexus": ["GS|1993-2020", "IS 300|2001-2005,2016-", "IS F|2008-2014", "LC 500|2018-", "LFA|2010-2012", "RC F|2015-", "SC 300|1992-2000", "SC 400|1992-2000"],
  "Lincoln": ["Continental|1939-2002,2017-2020", "Mark VIII|1993-1998", "Town Car|1981-2011"],
  "Lotus": ["Elan|1962-1975,1989-1995", "Elise|1996-2021", "Emira|2022-", "Esprit|1976-2004", "Europa|1966-1975,2006-2010", "Evora|2009-2021", "Exige|2000-2021", "Seven|1957-1972"],
  "Maserati": ["3200 GT|1998-2002", "Bora|1971-1978", "Coupe|2002-2007", "Ghibli|1967-1973,1992-1997,2014-2023", "GranTurismo|2008-2019,2023-", "Khamsin|1974-1982", "MC20|2021-", "Merak|1972-1983", "Quattroporte|1963-", "Spyder|2001-2007"],
  "Mazda": ["Cosmo|1967-1995", "Mazdaspeed3|2007-2013", "Mazdaspeed Miata|2004-2005", "MX-5 Miata|1990-", "MX-6|1988-1997", "RX-2|1970-1978", "RX-3|1971-1978", "RX-7|1978-2002", "RX-8|2003-2012"],
  "McLaren": ["540C|2015-2021", "570S|2015-2021", "600LT|2018-2020", "650S|2014-2017", "675LT|2015-2017", "720S|2017-2023", "750S|2023-", "Artura|2022-", "F1|1992-1998", "GT|2019-", "MP4-12C|2011-2014", "P1|2013-2015"],
  "Mercedes-Benz": ["190E 2.3-16|1984-1988", "190E 2.5-16|1988-1993", "190SL|1955-1963", "230SL|1963-1967", "250SL|1966-1968", "280SL|1968-1971", "300SL|1954-1963", "450SL|1972-1980", "500E|1991-1994", "560SL|1986-1989", "AMG GT|2015-", "C63 AMG|2008-", "CLK63 AMG|2007-2009", "E55 AMG|1997-2006", "E63 AMG|2007-", "G-Class|1979-", "G55 AMG|1999-2012", "G63 AMG|2013-", "SL55 AMG|2003-2008,2022-", "SL500|1990-2012", "SLK|1996-2016", "SLR McLaren|2004-2010", "SLS AMG|2010-2014", "W123|1976-1986", "W124|1984-1997"],
  "Mercury": ["Cougar|1967-2002", "Cyclone|1964-1971", "Marauder|1963-1965,1969-1970,2003-2004"],
  "MG": ["MGA|1955-1962", "MGB|1962-1980", "MGB GT|1965-1980", "Midget|1961-1979", "TD|1950-1953", "TF|1953-1955"],
  "Mini": ["Cooper|2002-", "Cooper S|2002-", "John Cooper Works|2009-", "Mini (classic)|1959-2000"],
  "Mitsubishi": ["3000GT|1991-1999", "3000GT VR-4|1991-1999", "Eclipse|1990-2012", "Eclipse GSX|1990-1999", "Lancer Evolution|1992-2016", "Montero|1983-2006", "Starion|1982-1989"],
  "Nissan": ["240SX|1989-1998", "300ZX|1984-1996", "350Z|2003-2009", "370Z|2009-2020", "GT-R|2009-", "Pathfinder|1986-", "Patrol|1951-", "Pulsar|1978-2000", "Sentra SE-R|1991-1994,2002-2006", "Silvia|1965-2002", "Skyline GT-R|1969-1973,1989-2002", "Z|2023-"],
  "Oldsmobile": ["442|1964-1980,1985-1991", "Cutlass|1961-1999", "Cutlass Supreme|1966-1997", "Hurst/Olds|1968-1984", "Toronado|1966-1992"],
  "Plymouth": ["Barracuda|1964-1974", "Cuda|1968-1974", "Duster|1970-1976", "Fury|1956-1978", "GTX|1967-1971", "Prowler|1997-2002", "Road Runner|1968-1980", "Superbird|1970-1970"],
  "Pontiac": ["Fiero|1984-1988", "Firebird|1967-2002", "Firebird Trans Am|1969-2002", "G8|2008-2009", "GTO|1964-1974,2004-2006", "Grand Prix|1962-2008", "LeMans|1961-1981", "Solstice|2006-2009"],
  "Porsche": ["356|1948-1965", "550 Spyder|1953-1956", "911|1964-", "911 Carrera|1984-", "911 Carrera 4|1989-", "911 Carrera S|1997-", "911 GT2|1995-2012,2018-2020", "911 GT3|1999-", "911 GT3 RS|2003-", "911 SC|1978-1983", "911 Targa|1967-", "911 Turbo|1975-", "912|1965-1969,1976-1976", "914|1970-1976", "918 Spyder|2013-2015", "924|1976-1988", "928|1978-1995", "944|1982-1991", "944 Turbo|1986-1991", "959|1986-1993", "968|1992-1995", "Boxster|1997-", "Boxster S|2000-", "Boxster Spyder|2011-2012,2016-", "Carrera GT|2004-2007", "Cayenne|2003-", "Cayman|2006-", "Cayman GT4|2016-", "Cayman S|2006-", "Macan|2015-", "Panamera|2010-", "Taycan|2020-"],
  "Ram": ["1500 TRX|2021-2024", "2500|2010-", "SRT-10|2004-2006"],
  "Renault": ["5 Turbo|1980-1986", "Alpine GTA|1985-1991", "Clio V6|2001-2005"],
  "Rolls-Royce": ["Corniche|1971-1996,2000-2002", "Silver Shadow|1965-1980", "Silver Spur|1980-2000", "Wraith|1938-1939,2014-2023"],
  "Saab": ["900|1978-1998", "900 Turbo|1978-1993", "9-3 Viggen|1999-2002", "99 Turbo|1978-1980", "Sonett|1966-1974"],
  "Shelby": ["Cobra|1962-1967", "GT350|1965-1970", "GT500|1967-1970", "Series 1|1999-2005"],
  "Subaru": ["BRZ|2013-", "Impreza 2.5RS|1998-2007", "SVX|1992-1997", "WRX|2002-", "WRX STI|2004-2021", "XT|1985-1991"],
  "Suzuki": ["Cappuccino|1991-1998", "Samurai|1986-1995", "Swift GT|1989-1994"],
  "Toyota": ["2000GT|1967-1970", "4Runner|1984-", "86|2017-2020", "Celica|1970-2006", "Celica All-Trac|1988-1993", "Celica GT-Four|1986-1999", "Corolla AE86|1984-1987", "Cressida|1977-1992", "FJ Cruiser|2007-2014", "FJ40 Land Cruiser|1960-1984", "FJ60 Land Cruiser|1981-1987", "FJ80 Land Cruiser|1991-1997", "GR Corolla|2023-", "GR Supra|2020-", "GR86|2022-", "Hilux|1968-", "Land Cruiser|1951-", "MR2|1985-2007", "MR2 Turbo|1988-1995", "Pickup|1964-1995", "Supra|1979-2002", "Supra Turbo|1986-2002", "Tacoma|1995-", "Tundra|2000-"],
  "Triumph": ["GT6|1966-1973", "Spitfire|1962-1980", "Stag|1970-1977", "TR3|1955-1962", "TR4|1961-1967", "TR6|1968-1976", "TR7|1975-1981", "TR8|1978-1981"],
  "TVR": ["Cerbera|1996-2003", "Chimaera|1992-2003", "Griffith|1963-1967,1991-2002", "Tuscan|1967-1971,1999-2006"],
  "Volkswagen": ["Beetle|1945-2019", "Bus|1950-1979", "Corrado|1988-1995", "Corrado VR6|1992-1995", "Golf GTI|1983-", "Golf R|2012-", "Jetta GLI|1984-", "Karmann Ghia|1955-1974", "Scirocco|1974-1992,2008-2017", "Thing|1969-1983", "Vanagon|1980-1991", "Vanagon Syncro|1985-1991"],
  "Volvo": ["240|1975-1993", "242 Turbo|1981-1985", "740 Turbo|1985-1990", "850 R|1996-1997", "850 T-5R|1995-1995", "P1800|1961-1973", "V70 R|1998-2007"],
};

export interface CatalogModel {
  name: string;
  /** [first, last] model years; last is null while still built. */
  ranges: [number, number | null][];
}

function parseModel(entry: string): CatalogModel {
  const [name, years = ""] = entry.split("|");
  const ranges = years
    .split(",")
    .filter(Boolean)
    .map((r) => {
      const [a, b] = r.split("-");
      return [Number(a), b ? Number(b) : null] as [number, number | null];
    });
  return { name, ranges };
}

const PARSED: Record<string, CatalogModel[]> = Object.fromEntries(
  Object.entries(MAKES).map(([make, models]) => [make, models.map(parseModel)]),
);

export const MAKE_NAMES = Object.keys(MAKES);

/** Built in this model year? No year (or one outside the list) means no filter. */
export function builtIn(model: CatalogModel, year: number | null): boolean {
  if (!year) return true;
  return model.ranges.some(([a, b]) => year >= a && year <= (b ?? 9999));
}

function listedYear(year: string | number | null | undefined): number | null {
  const y = Number(year);
  return Number.isInteger(y) && y >= FIRST_LISTED_YEAR ? y : null;
}

/** Makes that built at least one listed model in this year (all makes when no year). */
export function makesFor(year?: string | number | null): string[] {
  const y = listedYear(year);
  return MAKE_NAMES.filter((m) => PARSED[m].some((model) => builtIn(model, y)));
}

/** A make's models built in this year (all of them when no year). */
export function modelsFor(make: string, year?: string | number | null): string[] {
  const y = listedYear(year);
  return (PARSED[make] ?? []).filter((model) => builtIn(model, y)).map((model) => model.name);
}

/** The catalog for the wizard's script: { make: [[name, [[from, to|null], ...]], ...] }. */
export function catalogForClient(): Record<string, [string, [number, number | null][]][]> {
  return Object.fromEntries(Object.entries(PARSED).map(([make, models]) => [make, models.map((m) => [m.name, m.ranges])]));
}

/**
 * The wizard posts year, make and model from dropdowns, with "Other" plus a
 * text box for anything the list does not have. Turn that back into the plain
 * year, make and model fields the listing rules expect (in place).
 */
export function resolveCarPicks(posted: Record<string, string>): void {
  for (const field of ["year", "make", "model"] as const) {
    if (posted[field] === OTHER) posted[field] = (posted[`${field}_other`] ?? "").trim();
  }
}
