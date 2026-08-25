// Curated launch inventory. Countries are ISO-3166-1 alpha-2, languages ISO-639-1.
// `price` is what the advertiser pays; `cost` is what we pay the publisher.

export type SeedSite = {
  domain: string;
  country: string;
  language: string;
  cats: string[];
  dr: number;
  traffic: number;
  refDomains: number;
  spam: number;
  price: number; // whole USD
  cost: number; // whole USD
  writing: number; // whole USD upcharge on top of price
  dofollow: boolean;
  days: number;
  ga: boolean;
  gsc: boolean;
  sens: string[];
  channel?: "WEBSITE" | "TELEGRAM" | "YOUTUBE" | "NEWSWIRE";
  topCountryShare?: number;
};

export const CATEGORIES: { slug: string; name: string }[] = [
  { slug: "agriculture", name: "Agriculture" },
  { slug: "automotive", name: "Automotive" },
  { slug: "beauty", name: "Beauty" },
  { slug: "business", name: "Business" },
  { slug: "crypto", name: "Crypto" },
  { slug: "education", name: "Education" },
  { slug: "energy", name: "Energy" },
  { slug: "entertainment", name: "Entertainment" },
  { slug: "fashion", name: "Fashion" },
  { slug: "finance", name: "Finance" },
  { slug: "food", name: "Food" },
  { slug: "gaming", name: "Gaming" },
  { slug: "health", name: "Health" },
  { slug: "home-garden", name: "Home & Garden" },
  { slug: "hr", name: "HR" },
  { slug: "legal", name: "Legal" },
  { slug: "lifestyle", name: "Lifestyle" },
  { slug: "marketing", name: "Marketing" },
  { slug: "parenting", name: "Parenting" },
  { slug: "pets", name: "Pets" },
  { slug: "real-estate", name: "Real Estate" },
  { slug: "science", name: "Science" },
  { slug: "software", name: "Software" },
  { slug: "sports", name: "Sports" },
  { slug: "technology", name: "Technology" },
  { slug: "travel", name: "Travel" },
];

export const SENSITIVE_TOPICS = ["casino", "crypto", "forex", "cbd", "adult", "dating"];

// Country -> the language most of its inventory publishes in.
export const COUNTRY_LANGUAGE: Record<string, string> = {
  US: "en", GB: "en", CA: "en", AU: "en", IE: "en", NZ: "en", ZA: "en",
  IN: "en", NG: "en", KE: "en", PH: "en", MY: "en", SG: "en", AE: "en",
  DE: "de", AT: "de", CH: "de", FR: "fr", BE: "fr", ES: "es", MX: "es",
  AR: "es", CO: "es", CL: "es", IT: "it", NL: "nl", SE: "sv", NO: "nb",
  DK: "da", FI: "fi", PL: "pl", CZ: "cs", RO: "ro", UA: "uk", TR: "tr",
  GR: "el", PT: "pt", BR: "pt", JP: "ja", KR: "ko", CN: "zh", TW: "zh",
  TH: "th", VN: "vi", ID: "id", EG: "ar", SA: "ar", IL: "he", RU: "ru",
};

export const CURATED: SeedSite[] = [
  { domain: "healthlineforward.com", country: "US", language: "en", cats: ["health", "science"], dr: 75, traffic: 890000, refDomains: 14200, spam: 1, price: 760, cost: 445, writing: 80, dofollow: true, days: 10, ga: true, gsc: true, sens: [] },
  { domain: "techradarpulse.com", country: "US", language: "en", cats: ["technology", "software"], dr: 72, traffic: 410000, refDomains: 9800, spam: 2, price: 420, cost: 240, writing: 60, dofollow: true, days: 5, ga: true, gsc: true, sens: [] },
  { domain: "cryptoledgerdaily.com", country: "US", language: "en", cats: ["crypto", "finance"], dr: 70, traffic: 520000, refDomains: 8100, spam: 4, price: 690, cost: 400, writing: 80, dofollow: true, days: 6, ga: true, gsc: true, sens: ["crypto", "forex", "casino"] },
  { domain: "fintechledger.co.uk", country: "GB", language: "en", cats: ["finance", "business"], dr: 68, traffic: 205000, refDomains: 6400, spam: 3, price: 510, cost: 300, writing: 65, dofollow: true, days: 7, ga: true, gsc: false, sens: ["forex", "crypto"] },
  { domain: "gulfventurenews.ae", country: "AE", language: "en", cats: ["business", "real-estate"], dr: 66, traffic: 98000, refDomains: 3100, spam: 5, price: 620, cost: 370, writing: 80, dofollow: true, days: 9, ga: false, gsc: true, sens: ["crypto", "forex"] },
  { domain: "sgwealthbrief.sg", country: "SG", language: "en", cats: ["finance"], dr: 65, traffic: 76000, refDomains: 2700, spam: 3, price: 580, cost: 340, writing: 70, dofollow: true, days: 8, ga: true, gsc: true, sens: ["crypto", "forex"] },
  { domain: "derwirtschaftsblick.de", country: "DE", language: "de", cats: ["business", "finance"], dr: 64, traffic: 132000, refDomains: 4300, spam: 2, price: 390, cost: 225, writing: 60, dofollow: true, days: 6, ga: true, gsc: true, sens: [] },
  { domain: "aussiepropertywire.com.au", country: "AU", language: "en", cats: ["real-estate", "finance"], dr: 63, traffic: 121000, refDomains: 3900, spam: 3, price: 445, cost: 260, writing: 65, dofollow: true, days: 6, ga: true, gsc: true, sens: [] },
  { domain: "thegamerscroll.co.uk", country: "GB", language: "en", cats: ["gaming", "entertainment"], dr: 62, traffic: 340000, refDomains: 5600, spam: 3, price: 380, cost: 220, writing: 60, dofollow: true, days: 5, ga: true, gsc: false, sens: ["casino"] },
  { domain: "lejournaldelauto.fr", country: "FR", language: "fr", cats: ["automotive"], dr: 61, traffic: 178000, refDomains: 4100, spam: 2, price: 330, cost: 190, writing: 60, dofollow: true, days: 8, ga: true, gsc: true, sens: [] },
  { domain: "seoulstartupwire.kr", country: "KR", language: "ko", cats: ["technology", "business"], dr: 60, traffic: 87000, refDomains: 2400, spam: 3, price: 340, cost: 200, writing: 60, dofollow: true, days: 8, ga: true, gsc: true, sens: [] },
  { domain: "maplehealthdaily.ca", country: "CA", language: "en", cats: ["health"], dr: 59, traffic: 167000, refDomains: 3800, spam: 4, price: 310, cost: 180, writing: 60, dofollow: true, days: 5, ga: true, gsc: true, sens: ["cbd"] },
  { domain: "saudecotidiana.com.br", country: "BR", language: "pt", cats: ["health", "lifestyle"], dr: 58, traffic: 260000, refDomains: 4600, spam: 5, price: 180, cost: 100, writing: 40, dofollow: true, days: 5, ga: false, gsc: true, sens: ["cbd"] },
  { domain: "modaitaliana.it", country: "IT", language: "it", cats: ["fashion", "beauty"], dr: 57, traffic: 189000, refDomains: 3400, spam: 2, price: 285, cost: 165, writing: 55, dofollow: true, days: 7, ga: true, gsc: true, sens: [] },
  { domain: "nordiskteknik.se", country: "SE", language: "sv", cats: ["technology", "energy"], dr: 56, traffic: 41000, refDomains: 1600, spam: 2, price: 300, cost: 175, writing: 55, dofollow: true, days: 7, ga: true, gsc: true, sens: [] },
  { domain: "tokyogadgetlab.jp", country: "JP", language: "ja", cats: ["technology", "gaming"], dr: 55, traffic: 143000, refDomains: 2900, spam: 6, price: 295, cost: 175, writing: 65, dofollow: false, days: 7, ga: false, gsc: false, sens: [] },
  { domain: "dineromexico.mx", country: "MX", language: "es", cats: ["finance", "crypto"], dr: 53, traffic: 130000, refDomains: 2200, spam: 5, price: 165, cost: 95, writing: 35, dofollow: true, days: 6, ga: true, gsc: true, sens: ["crypto", "forex"] },
  { domain: "groenwonen.nl", country: "NL", language: "nl", cats: ["home-garden", "energy"], dr: 52, traffic: 64000, refDomains: 1900, spam: 2, price: 240, cost: 140, writing: 50, dofollow: true, days: 6, ga: true, gsc: true, sens: [] },
  { domain: "yatraroutes.in", country: "IN", language: "en", cats: ["travel", "lifestyle"], dr: 51, traffic: 88000, refDomains: 1700, spam: 4, price: 120, cost: 65, writing: 30, dofollow: true, days: 4, ga: true, gsc: true, sens: [] },
  { domain: "sporhaberi.com.tr", country: "TR", language: "tr", cats: ["sports"], dr: 50, traffic: 310000, refDomains: 3300, spam: 9, price: 130, cost: 70, writing: 35, dofollow: false, days: 4, ga: false, gsc: false, sens: ["casino"] },
  { domain: "polskatechnologia.pl", country: "PL", language: "pl", cats: ["technology"], dr: 49, traffic: 74000, refDomains: 1500, spam: 3, price: 110, cost: 60, writing: 30, dofollow: true, days: 5, ga: true, gsc: false, sens: [] },
  { domain: "elinversorar.com.ar", country: "AR", language: "es", cats: ["finance", "crypto"], dr: 48, traffic: 68000, refDomains: 1300, spam: 6, price: 115, cost: 62, writing: 30, dofollow: true, days: 5, ga: true, gsc: false, sens: ["crypto", "forex"] },
  { domain: "ceskyhrac.cz", country: "CZ", language: "cs", cats: ["gaming", "entertainment"], dr: 47, traffic: 128000, refDomains: 1800, spam: 6, price: 125, cost: 68, writing: 30, dofollow: true, days: 5, ga: true, gsc: true, sens: ["casino"] },
  { domain: "cocinaespanola.es", country: "ES", language: "es", cats: ["food", "lifestyle"], dr: 47, traffic: 95000, refDomains: 1600, spam: 3, price: 140, cost: 78, writing: 35, dofollow: true, days: 6, ga: true, gsc: false, sens: [] },
  { domain: "kabarteknologi.id", country: "ID", language: "id", cats: ["technology"], dr: 46, traffic: 220000, refDomains: 2100, spam: 7, price: 105, cost: 55, writing: 30, dofollow: true, days: 4, ga: true, gsc: false, sens: ["casino"] },
  { domain: "capetownliving.co.za", country: "ZA", language: "en", cats: ["lifestyle", "travel"], dr: 45, traffic: 52000, refDomains: 1100, spam: 4, price: 135, cost: 75, writing: 35, dofollow: true, days: 5, ga: true, gsc: true, sens: [] },
  { domain: "kyivmarketpost.ua", country: "UA", language: "uk", cats: ["business", "marketing"], dr: 44, traffic: 39000, refDomains: 900, spam: 4, price: 85, cost: 45, writing: 25, dofollow: true, days: 4, ga: true, gsc: true, sens: [] },
  { domain: "bogotalegal.co", country: "CO", language: "es", cats: ["legal", "business"], dr: 44, traffic: 33000, refDomains: 800, spam: 4, price: 105, cost: 58, writing: 30, dofollow: true, days: 6, ga: true, gsc: false, sens: [] },
  { domain: "vietnamtravelgo.vn", country: "VN", language: "vi", cats: ["travel"], dr: 43, traffic: 112000, refDomains: 1400, spam: 6, price: 75, cost: 38, writing: 25, dofollow: true, days: 3, ga: false, gsc: false, sens: [] },
  { domain: "manilacareerhub.ph", country: "PH", language: "en", cats: ["education", "hr"], dr: 42, traffic: 97000, refDomains: 1200, spam: 5, price: 70, cost: 36, writing: 25, dofollow: true, days: 4, ga: false, gsc: false, sens: [] },
  { domain: "naijabusinesspulse.ng", country: "NG", language: "en", cats: ["business", "finance"], dr: 41, traffic: 156000, refDomains: 1500, spam: 8, price: 95, cost: 50, writing: 30, dofollow: true, days: 3, ga: false, gsc: false, sens: ["crypto", "forex", "casino"] },
  { domain: "masralyoumtech.eg", country: "EG", language: "ar", cats: ["technology", "science"], dr: 40, traffic: 145000, refDomains: 1300, spam: 9, price: 80, cost: 42, writing: 25, dofollow: true, days: 3, ga: false, gsc: false, sens: ["casino", "forex"] },
  { domain: "bangkokparenting.th", country: "TH", language: "th", cats: ["parenting", "health"], dr: 39, traffic: 58000, refDomains: 900, spam: 4, price: 72, cost: 38, writing: 25, dofollow: true, days: 5, ga: true, gsc: false, sens: [] },
  { domain: "mypetkl.my", country: "MY", language: "en", cats: ["pets", "lifestyle"], dr: 38, traffic: 46000, refDomains: 700, spam: 5, price: 65, cost: 34, writing: 25, dofollow: true, days: 4, ga: false, gsc: false, sens: [] },
  { domain: "nairobiagritoday.ke", country: "KE", language: "en", cats: ["agriculture", "science"], dr: 37, traffic: 44000, refDomains: 650, spam: 6, price: 60, cost: 30, writing: 22, dofollow: true, days: 4, ga: false, gsc: false, sens: [] },

  // Additional launch inventory beyond the prototype's list.
  { domain: "atlanticpolicyreview.com", country: "US", language: "en", cats: ["business", "legal"], dr: 74, traffic: 620000, refDomains: 11200, spam: 1, price: 890, cost: 520, writing: 95, dofollow: true, days: 12, ga: true, gsc: true, sens: [] },
  { domain: "siliconmeadow.io", country: "US", language: "en", cats: ["software", "technology"], dr: 69, traffic: 295000, refDomains: 7300, spam: 2, price: 540, cost: 315, writing: 70, dofollow: true, days: 6, ga: true, gsc: true, sens: [] },
  { domain: "citywirebulletin.co.uk", country: "GB", language: "en", cats: ["finance", "business"], dr: 71, traffic: 380000, refDomains: 8700, spam: 2, price: 640, cost: 375, writing: 80, dofollow: true, days: 8, ga: true, gsc: true, sens: ["forex"] },
  { domain: "britishmotoring.co.uk", country: "GB", language: "en", cats: ["automotive", "lifestyle"], dr: 58, traffic: 155000, refDomains: 3200, spam: 3, price: 320, cost: 185, writing: 55, dofollow: true, days: 6, ga: true, gsc: true, sens: [] },
  { domain: "dublintechbeat.ie", country: "IE", language: "en", cats: ["technology", "business"], dr: 54, traffic: 62000, refDomains: 1800, spam: 3, price: 290, cost: 170, writing: 55, dofollow: true, days: 7, ga: true, gsc: false, sens: [] },
  { domain: "kiwihomesteader.co.nz", country: "NZ", language: "en", cats: ["home-garden", "agriculture"], dr: 46, traffic: 38000, refDomains: 850, spam: 3, price: 155, cost: 88, writing: 40, dofollow: true, days: 6, ga: true, gsc: true, sens: [] },
  { domain: "torontofinancetoday.ca", country: "CA", language: "en", cats: ["finance", "crypto"], dr: 61, traffic: 143000, refDomains: 3600, spam: 4, price: 425, cost: 250, writing: 65, dofollow: true, days: 7, ga: true, gsc: true, sens: ["crypto", "forex"] },
  { domain: "berlinerkulturpost.de", country: "DE", language: "de", cats: ["entertainment", "lifestyle"], dr: 59, traffic: 210000, refDomains: 4400, spam: 2, price: 355, cost: 205, writing: 60, dofollow: true, days: 7, ga: true, gsc: true, sens: [] },
  { domain: "energiewendeheute.de", country: "DE", language: "de", cats: ["energy", "science"], dr: 53, traffic: 71000, refDomains: 2100, spam: 2, price: 275, cost: 160, writing: 55, dofollow: true, days: 8, ga: true, gsc: false, sens: [] },
  { domain: "wienerimmobilien.at", country: "AT", language: "de", cats: ["real-estate"], dr: 48, traffic: 34000, refDomains: 1000, spam: 3, price: 210, cost: 120, writing: 45, dofollow: true, days: 7, ga: true, gsc: true, sens: [] },
  { domain: "helvetiafinanz.ch", country: "CH", language: "de", cats: ["finance"], dr: 57, traffic: 48000, refDomains: 1900, spam: 2, price: 620, cost: 370, writing: 85, dofollow: true, days: 9, ga: true, gsc: true, sens: ["crypto"] },
  { domain: "parismodemag.fr", country: "FR", language: "fr", cats: ["fashion", "beauty"], dr: 62, traffic: 240000, refDomains: 5100, spam: 3, price: 370, cost: 215, writing: 60, dofollow: true, days: 7, ga: true, gsc: true, sens: [] },
  { domain: "gastronomiebelge.be", country: "BE", language: "fr", cats: ["food", "travel"], dr: 44, traffic: 29000, refDomains: 760, spam: 3, price: 165, cost: 92, writing: 40, dofollow: true, days: 6, ga: true, gsc: false, sens: [] },
  { domain: "madridsalud.es", country: "ES", language: "es", cats: ["health", "science"], dr: 51, traffic: 118000, refDomains: 2000, spam: 3, price: 175, cost: 98, writing: 40, dofollow: true, days: 6, ga: true, gsc: true, sens: ["cbd"] },
  { domain: "milanofinanza24.it", country: "IT", language: "it", cats: ["finance", "business"], dr: 60, traffic: 196000, refDomains: 4200, spam: 4, price: 330, cost: 190, writing: 60, dofollow: true, days: 7, ga: true, gsc: false, sens: ["crypto", "forex"] },
  { domain: "amsterdamstartups.nl", country: "NL", language: "nl", cats: ["business", "technology"], dr: 55, traffic: 58000, refDomains: 1750, spam: 2, price: 265, cost: 152, writing: 50, dofollow: true, days: 6, ga: true, gsc: true, sens: [] },
  { domain: "osloenergirapport.no", country: "NO", language: "nb", cats: ["energy", "business"], dr: 50, traffic: 27000, refDomains: 1100, spam: 2, price: 290, cost: 168, writing: 55, dofollow: true, days: 8, ga: true, gsc: true, sens: [] },
  { domain: "kobenhavnlivsstil.dk", country: "DK", language: "da", cats: ["lifestyle", "food"], dr: 45, traffic: 31000, refDomains: 890, spam: 3, price: 225, cost: 130, writing: 48, dofollow: true, days: 7, ga: true, gsc: false, sens: [] },
  { domain: "suomipeliuutiset.fi", country: "FI", language: "fi", cats: ["gaming"], dr: 43, traffic: 55000, refDomains: 940, spam: 5, price: 195, cost: 110, writing: 45, dofollow: true, days: 5, ga: true, gsc: false, sens: ["casino"] },
  { domain: "bucurestibusiness.ro", country: "RO", language: "ro", cats: ["business", "marketing"], dr: 41, traffic: 47000, refDomains: 820, spam: 5, price: 95, cost: 50, writing: 28, dofollow: true, days: 5, ga: true, gsc: false, sens: ["casino", "forex"] },
  { domain: "athensvoyager.gr", country: "GR", language: "el", cats: ["travel", "food"], dr: 42, traffic: 61000, refDomains: 880, spam: 4, price: 105, cost: 56, writing: 30, dofollow: true, days: 5, ga: false, gsc: true, sens: [] },
  { domain: "lisboatecnologia.pt", country: "PT", language: "pt", cats: ["technology", "software"], dr: 47, traffic: 42000, refDomains: 1050, spam: 3, price: 145, cost: 82, writing: 38, dofollow: true, days: 6, ga: true, gsc: true, sens: [] },
  { domain: "osakawellness.jp", country: "JP", language: "ja", cats: ["health", "beauty"], dr: 52, traffic: 89000, refDomains: 1850, spam: 4, price: 275, cost: 160, writing: 62, dofollow: true, days: 8, ga: true, gsc: false, sens: [] },
  { domain: "taipeichipwatch.tw", country: "TW", language: "zh", cats: ["technology", "science"], dr: 56, traffic: 76000, refDomains: 2050, spam: 3, price: 310, cost: 180, writing: 60, dofollow: true, days: 7, ga: true, gsc: true, sens: [] },
  { domain: "mumbaimarketmint.in", country: "IN", language: "en", cats: ["finance", "crypto"], dr: 49, traffic: 205000, refDomains: 2300, spam: 6, price: 135, cost: 72, writing: 32, dofollow: true, days: 4, ga: true, gsc: false, sens: ["crypto", "forex", "casino"] },
  { domain: "delhiedudesk.in", country: "IN", language: "en", cats: ["education", "hr"], dr: 45, traffic: 132000, refDomains: 1600, spam: 5, price: 88, cost: 46, writing: 26, dofollow: true, days: 4, ga: true, gsc: true, sens: [] },
  { domain: "riyadhbusinessgate.sa", country: "SA", language: "ar", cats: ["business", "real-estate"], dr: 54, traffic: 66000, refDomains: 1700, spam: 5, price: 480, cost: 285, writing: 75, dofollow: true, days: 9, ga: false, gsc: true, sens: ["crypto"] },
  { domain: "telavivstartupfeed.il", country: "IL", language: "he", cats: ["technology", "business"], dr: 58, traffic: 51000, refDomains: 1950, spam: 3, price: 395, cost: 230, writing: 68, dofollow: true, days: 7, ga: true, gsc: true, sens: ["crypto"] },
  { domain: "santiagoinmuebles.cl", country: "CL", language: "es", cats: ["real-estate", "finance"], dr: 40, traffic: 36000, refDomains: 700, spam: 4, price: 92, cost: 48, writing: 28, dofollow: true, days: 6, ga: true, gsc: false, sens: [] },
  { domain: "cryptowirepr.com", country: "US", language: "en", cats: ["crypto", "finance"], dr: 64, traffic: 88000, refDomains: 5400, spam: 7, price: 950, cost: 590, writing: 0, dofollow: false, days: 2, ga: false, gsc: false, sens: ["crypto", "forex", "casino"], channel: "NEWSWIRE" },
  { domain: "t.me/defisignalroom", country: "AE", language: "en", cats: ["crypto"], dr: 0, traffic: 0, refDomains: 0, spam: 0, price: 340, cost: 200, writing: 45, dofollow: false, days: 2, ga: false, gsc: false, sens: ["crypto", "forex"], channel: "TELEGRAM" },
  { domain: "youtube.com/@gadgetbench", country: "GB", language: "en", cats: ["technology", "gaming"], dr: 0, traffic: 0, refDomains: 0, spam: 0, price: 720, cost: 430, writing: 0, dofollow: false, days: 14, ga: false, gsc: false, sens: [], channel: "YOUTUBE" },
];
