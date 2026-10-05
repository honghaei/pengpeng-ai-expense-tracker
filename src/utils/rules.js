// src/utils/rules.js
import { getData, saveData } from './storage';

const KEY = 'category_rules_v1';

const DEFAULT_RULES = [
  { id: 'r_transport',
    pattern:
      '\\bGrab\\b|\\bAngkas\\b|\\bLRT\\b|\\bMRT\\b|\\bJeep\\b|\\bTaxi\\b|\\bgrab\\b|\\bangkas\\b|\\blrt\\b|\\bmrt\\b|\\bjeep\\b|\\btaxi\\b',
    category: 'Transport'
  },
  { id: 'r_transport_fuel',
    pattern:
      '\\bPetron\\b|\\bShell\\b|\\bCaltex\\b|\\bPhoenix\\b|\\bpetron\\b|\\bshell\\b|\\bcaltex\\b|\\bphoenix\\b',
    category: 'Transport'
  },
  { id: 'r_food_fastfood',
    pattern:
      "\\bJollibee\\b|\\bMcDonald'?s\\b|\\bKFC\\b|\\bChowking\\b|\\bMang Inasal\\b|\\bjollibee\\b|\\bmcdonald'?s\\b|\\bkfc\\b|\\bchowking\\b|\\bmang inasal\\b",
    category: 'Food & Drink'
  },
  { id: 'r_food_coffee',
    pattern:
      "\\bStarbucks\\b|\\bCoffee Bean\\b|\\bBo'?s Coffee\\b|\\bstarbucks\\b|\\bcoffee bean\\b|\\bbo'?s coffee\\b",
    category: 'Food & Drink'
  },
  { id: 'r_food_misc',
    pattern:
      "\\bMilk Tea\\b|\\bChatime\\b|\\bSerenitea\\b|\\bFoodpanda\\b|\\bGrabFood\\b|\\bmilk tea\\b|\\bchatime\\b|\\bserenitea\\b|\\bfoodpanda\\b|\\bgrabfood\\b",
    category: 'Food & Drink'
  },
  { id: 'r_groceries_main',
    pattern:
      '\\bPuregold\\b|\\bRobinsons Supermarket\\b|\\bSM Hypermarket\\b|\\bSavemore\\b|\\bWalterMart\\b|\\bpuregold\\b|\\brobinsons supermarket\\b|\\bsm hypermarket\\b|\\bsavemore\\b|\\bwaltermart\\b',
    category: 'Groceries'
  },
  { id: 'r_groceries_members',
    pattern:
      '\\bS&R\\b|\\bLanders\\b|\\bShopwise\\b|\\bThe Marketplace\\b|\\bs&r\\b|\\blanders\\b|\\bshopwise\\b|\\bthe marketplace\\b',
    category: 'Groceries'
  },
  { id: 'r_shop_online',
    pattern:
      '\\bShopee\\b|\\bLazada\\b|\\bSHEIN\\b|\\bTemu\\b|\\bshopee\\b|\\blazada\\b|\\bshein\\b|\\btemu\\b',
    category: 'Shopping'
  },
  { id: 'r_shop_mall',
    pattern:
      '\\bSM Store\\b|\\bUniqlo\\b|\\bH&M\\b|\\bAyala Malls\\b|\\bsm store\\b|\\buniqlo\\b|\\bh&m\\b|\\bayala malls\\b',
    category: 'Shopping'
  },
  { id: 'r_bills_telco',
    pattern:
      '\\bGlobe\\b|\\bSmart\\b|\\bPLDT\\b|\\bDITO\\b|\\bglobe\\b|\\bsmart\\b|\\bpldt\\b|\\bdito\\b',
    category: 'Bills & Utilities'
  },
  { id: 'r_bills_power',
    pattern:
      '\\bMeralco\\b|\\bVECO\\b|\\bmeralco\\b|\\bveco\\b',
    category: 'Bills & Utilities'
  },
  { id: 'r_bills_water',
    pattern:
      '\\bMaynilad\\b|\\bManila Water\\b|\\bmaynilad\\b|\\bmanila water\\b',
    category: 'Bills & Utilities'
  },
  { id: 'r_bills_internet',
    pattern:
      '\\bConverge\\b|\\bSky\\b|\\bCignal\\b|\\bconverge\\b|\\bsky\\b|\\bcignal\\b',
    category: 'Bills & Utilities'
  },
  { id: 'r_ent_stream',
    pattern:
      '\\bNetflix\\b|\\bDisney\\+\\b|\\bPrime Video\\b|\\bYouTube Premium\\b|\\bnetflix\\b|\\bdisney\\+\\b|\\bprime video\\b|\\byoutube premium\\b',
    category: 'Entertainment'
  },
  { id: 'r_ent_music',
    pattern:
      '\\bSpotify\\b|\\bApple Music\\b|\\bYouTube Music\\b|\\bspotify\\b|\\bapple music\\b|\\byoutube music\\b',
    category: 'Entertainment'
  },
  { id: 'r_ent_games',
    pattern:
      '\\bSteam\\b|\\bPlayStation Network\\b|\\bXbox\\b|\\bsteam\\b|\\bplaystation network\\b|\\bxbox\\b',
    category: 'Entertainment'
  },
  { id: 'r_health',
    pattern:
      '\\bWatsons\\b|\\bMercury Drug\\b|\\bSouth Star Drug\\b|\\bRose Pharmacy\\b|\\bwatsons\\b|\\bmercury drug\\b|\\bsouth star drug\\b|\\brose pharmacy\\b',
    category: 'Health'
  },
  { id: 'r_edu',
    pattern:
      '\\bUdemy\\b|\\bCoursera\\b|\\bSkillshare\\b|\\budemy\\b|\\bcoursera\\b|\\bskillshare\\b',
    category: 'Education'
  },
];

export async function getCategoryRules() {
  const raw = await getData(KEY);
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_RULES;
  return raw;
}

export async function setCategoryRules(rules = []) {
  await saveData(KEY, rules);
}

function buildRegex(pattern) {
  try { return new RegExp(pattern); } catch { return null; }
}

/** Returns matched category, or "Others" if none. */
export async function autoCategory({ description = '', notes = '' }) {
  const text = `${description} ${notes}`.trim();
  if (!text) return 'Others';
  const rules = await getCategoryRules();
  for (const r of rules) {
    const rx = buildRegex(r.pattern);
    if (rx && rx.test(text)) return r.category;
  }
  return 'Others';
}
