// ═══════════════════════════════════════════════════════════════════════
// VERIS GROUND TRUTH DATABASE
// 
// This is NOT Groq extraction. This is hardcoded facts.
// Applied BEFORE scoring to ensure known entities are never misclassified.
//
// Two purposes:
//   1. Known good entities — prevent underscoring (MakerDAO = High Risk bug)
//   2. Known bad entities — ensure incidents surface (Terra collapse bug)
// ═══════════════════════════════════════════════════════════════════════

export const ENTITY_GROUND_TRUTH_DB = {

  // ─── TIER 1 NETWORKS ──────────────────────────────────────────────
  'bitcoin': {
    canonicalName: 'Bitcoin',
    tier: 'tier1_network',
    legitimacyFloor: 82,
    maturityFloor: 82,
    founded: 2009,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, multiple_contributors: true,
      live_product: true, clear_use_case: true, whitepaper: true,
      technical_docs: true, verifiable_history: true, no_confirmed_fraud: true,
      no_confirmed_hack: true,
    },
    ecosystemLevel: 'dominant',
    adoptionLevel: 'global',
  },
  'ethereum': {
    canonicalName: 'Ethereum',
    tier: 'tier1_network',
    legitimacyFloor: 82,
    maturityFloor: 82,
    founded: 2015,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, multiple_contributors: true,
      live_product: true, clear_use_case: true, whitepaper: true,
      technical_docs: true, founders_named: true, verifiable_history: true,
      no_confirmed_fraud: true, no_confirmed_hack: true,
    },
    ecosystemLevel: 'dominant',
    adoptionLevel: 'global',
  },
  'solana': {
    canonicalName: 'Solana',
    tier: 'tier1_network',
    legitimacyFloor: 70,
    maturityFloor: 65,
    founded: 2020,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, multiple_contributors: true,
      live_product: true, clear_use_case: true, technical_docs: true,
    },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },

  // ─── MAJOR DEFI ───────────────────────────────────────────────────
  'uniswap': {
    canonicalName: 'Uniswap',
    tier: 'major_defi',
    legitimacyFloor: 68,
    maturityFloor: 62,
    founded: 2018,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, live_product: true,
      clear_use_case: true, technical_docs: true, audit_found: true,
      no_confirmed_fraud: true,
    },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },
  'aave': {
    canonicalName: 'Aave',
    tier: 'major_defi',
    legitimacyFloor: 68,
    maturityFloor: 62,
    founded: 2017,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, live_product: true,
      audit_found: true, technical_docs: true, no_confirmed_fraud: true,
    },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },
  'makerdao': {
    canonicalName: 'MakerDAO',
    tier: 'major_dao',
    legitimacyFloor: 68,
    maturityFloor: 65,
    founded: 2014,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, live_product: true,
      on_chain_governance: true, whitepaper: true, technical_docs: true,
      audit_found: true, no_confirmed_fraud: true, verifiable_history: true,
    },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },
  'maker': {
    canonicalName: 'MakerDAO',
    tier: 'major_dao',
    legitimacyFloor: 68,
    maturityFloor: 65,
    founded: 2014,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, live_product: true,
      on_chain_governance: true, whitepaper: true, technical_docs: true,
    },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },
  'compound': {
    canonicalName: 'Compound',
    tier: 'major_defi',
    legitimacyFloor: 62,
    maturityFloor: 58,
    founded: 2018,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, live_product: true,
      audit_found: true, technical_docs: true,
    },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },
  'curve': {
    canonicalName: 'Curve Finance',
    tier: 'major_defi',
    legitimacyFloor: 60,
    maturityFloor: 55,
    founded: 2020,
    incidents: [
      {
        type: 'hack',
        severity: 'high',
        year: 2023,
        title: 'Curve Finance Exploit (2023)',
        description: 'Reentrancy vulnerability in Vyper compiler exploited. Approximately $70M drained across multiple pools.',
        sources: ['https://twitter.com/CurveFinance/status/1685925429041917952'],
      },
    ],
    knownSignals: { open_source: true, active_github: true, live_product: true },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },
  'chainlink': {
    canonicalName: 'Chainlink',
    tier: 'major_tooling',
    legitimacyFloor: 68,
    maturityFloor: 62,
    founded: 2017,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, live_product: true,
      clear_use_case: true, technical_docs: true, no_confirmed_fraud: true,
    },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },

  // ─── GROWING PLATFORMS ────────────────────────────────────────────
  'hyperliquid': {
    canonicalName: 'Hyperliquid',
    tier: 'growing_platform',
    legitimacyFloor: 50,
    maturityFloor: 45,
    founded: 2022,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, live_product: true,
    },
    ecosystemLevel: 'growing',
    adoptionLevel: 'medium',
  },
  'xrpl': {
    canonicalName: 'XRPL',
    tier: 'infrastructure',
    legitimacyFloor: 65,
    maturityFloor: 60,
    founded: 2012,
    incidents: [],
    knownSignals: {
      open_source: true, active_github: true, live_product: true,
      clear_use_case: true, technical_docs: true,
    },
    ecosystemLevel: 'major',
    adoptionLevel: 'large',
  },

  // ─── KNOWN FAILURES — CRITICAL ────────────────────────────────────
  'terra': {
    canonicalName: 'Terra / Luna',
    tier: 'known_failure',
    legitimacyCeiling: 25,
    maturityCeiling: 25,
    forceRiskLevel: 'CRITICAL',
    founded: 2018,
    incidents: [
      {
        type: 'collapse',
        severity: 'catastrophic',
        year: 2022,
        title: 'Terra / UST Ecosystem Collapse (May 2022)',
        description: 'UST stablecoin lost its dollar peg. LUNA token collapsed from ~$80 to near zero within days. Estimated $40B+ in value destroyed. Triggered cascading failures across crypto ecosystem including Three Arrows Capital and Celsius.',
        sources: ['https://coindesk.com/markets/2022/05/11/the-luna-ust-collapse-explained/'],
      },
      {
        type: 'legal',
        severity: 'high',
        year: 2023,
        title: 'Do Kwon Arrested (2023)',
        description: 'Terra co-founder Do Kwon arrested in Montenegro. Faces fraud charges in the US and South Korea.',
        sources: ['https://www.reuters.com/technology/terraform-labs-founder-do-kwon-arrested-montenegro-2023-03-23/'],
      },
    ],
    knownSignals: {
      confirmed_fraud: true,
      confirmed_scam: false,
    },
  },
  'luna': {
    canonicalName: 'Terra / Luna',
    tier: 'known_failure',
    legitimacyCeiling: 25,
    maturityCeiling: 25,
    forceRiskLevel: 'CRITICAL',
    founded: 2018,
    incidents: [
      {
        type: 'collapse',
        severity: 'catastrophic',
        year: 2022,
        title: 'Terra / UST Ecosystem Collapse (May 2022)',
        description: 'UST stablecoin lost its dollar peg causing total ecosystem collapse. $40B+ value destroyed.',
        sources: ['https://coindesk.com'],
      },
    ],
    knownSignals: {},
  },
  'ftx': {
    canonicalName: 'FTX',
    tier: 'known_failure',
    legitimacyCeiling: 20,
    maturityCeiling: 20,
    forceRiskLevel: 'CRITICAL',
    founded: 2019,
    incidents: [
      {
        type: 'fraud',
        severity: 'catastrophic',
        year: 2022,
        title: 'FTX Bankruptcy and Fraud (November 2022)',
        description: 'FTX collapsed after CoinDesk revealed Alameda Research balance sheet irregularities. Sam Bankman-Fried convicted on 7 counts of fraud and conspiracy. Estimated $8B in customer funds misappropriated.',
        sources: ['https://www.reuters.com/technology/ftx-founder-bankman-fried-convicted-fraud-2023-11-02/'],
      },
    ],
    knownSignals: { confirmed_fraud: true },
  },
  'celsius': {
    canonicalName: 'Celsius Network',
    tier: 'known_failure',
    legitimacyCeiling: 20,
    maturityCeiling: 20,
    forceRiskLevel: 'CRITICAL',
    founded: 2017,
    incidents: [
      {
        type: 'fraud',
        severity: 'catastrophic',
        year: 2022,
        title: 'Celsius Bankruptcy and Fraud (2022)',
        description: 'Celsius froze customer withdrawals in June 2022 and filed for bankruptcy. CEO Alex Mashinsky arrested on fraud charges in 2023. Customers lost access to approximately $4.7B in assets.',
        sources: ['https://www.reuters.com/technology/celsius-network-files-bankruptcy-2022-07-14/'],
      },
    ],
    knownSignals: { confirmed_fraud: true },
  },
  'safemoon': {
    canonicalName: 'SafeMoon',
    tier: 'known_scam',
    legitimacyCeiling: 15,
    maturityCeiling: 15,
    forceRiskLevel: 'CRITICAL',
    founded: 2021,
    incidents: [
      {
        type: 'fraud',
        severity: 'high',
        year: 2023,
        title: 'SafeMoon SEC Charges and Arrests (2023)',
        description: 'SEC charged SafeMoon and its executives with fraud and unregistered securities offering. Founders arrested. Executives allegedly misappropriated $200M+ from investors.',
        sources: ['https://www.bloomberg.com/news/articles/2023-10-01/safemoon-sec-charges'],
      },
    ],
    knownSignals: { confirmed_fraud: true, confirmed_scam: true },
  },
  'bitconnect': {
    canonicalName: 'BitConnect',
    tier: 'known_scam',
    legitimacyCeiling: 5,
    maturityCeiling: 5,
    forceRiskLevel: 'CRITICAL',
    founded: 2016,
    incidents: [
      {
        type: 'scam',
        severity: 'catastrophic',
        year: 2018,
        title: 'BitConnect Ponzi Scheme Collapse (2018)',
        description: 'BitConnect shut down its lending platform amid allegations it was a Ponzi scheme. Investors lost approximately $1B. Promoters charged with fraud in multiple jurisdictions.',
        sources: ['https://www.sec.gov/litigation/litreleases/2021/lr25199.htm'],
      },
    ],
    knownSignals: { confirmed_fraud: true, confirmed_scam: true },
  },
  'three arrows': {
    canonicalName: 'Three Arrows Capital',
    tier: 'known_failure',
    legitimacyCeiling: 15,
    maturityCeiling: 15,
    forceRiskLevel: 'CRITICAL',
    founded: 2012,
    incidents: [
      {
        type: 'collapse',
        severity: 'catastrophic',
        year: 2022,
        title: '3AC Bankruptcy (2022)',
        description: 'Three Arrows Capital filed for bankruptcy after failing to meet margin calls following Terra collapse. Estimated $3.5B owed to creditors. Co-founders fled and were ordered arrested.',
        sources: ['https://www.reuters.com/technology/crypto-hedge-fund-three-arrows-capital-files-bankruptcy-2022-07-01/'],
      },
    ],
    knownSignals: {},
  },
  '3ac': {
    canonicalName: 'Three Arrows Capital',
    tier: 'known_failure',
    legitimacyCeiling: 15,
    maturityCeiling: 15,
    forceRiskLevel: 'CRITICAL',
    founded: 2012,
    incidents: [
      {
        type: 'collapse',
        severity: 'catastrophic',
        year: 2022,
        title: '3AC Bankruptcy (2022)',
        description: 'Three Arrows Capital collapsed after Terra crash. $3.5B owed to creditors.',
        sources: ['https://www.reuters.com'],
      },
    ],
    knownSignals: {},
  },
  'mt gox': {
    canonicalName: 'Mt. Gox',
    tier: 'known_failure',
    legitimacyCeiling: 10,
    maturityCeiling: 10,
    forceRiskLevel: 'CRITICAL',
    founded: 2010,
    incidents: [
      {
        type: 'hack',
        severity: 'catastrophic',
        year: 2014,
        title: 'Mt. Gox Exchange Hack (2014)',
        description: 'Mt. Gox, then the world\'s largest Bitcoin exchange, filed for bankruptcy after losing approximately 850,000 Bitcoin (worth ~$450M at the time) to hackers. Customers waited years for partial repayment.',
        sources: ['https://www.wired.com/2014/03/bitcoin-exchange/'],
      },
    ],
    knownSignals: { confirmed_hack: true },
  },
};

// ─── LOOKUP FUNCTION ─────────────────────────────────────────────────

export function lookupGroundTruth(name = '') {
  const key = name.toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^a-z0-9 ]/g, '');

  // Direct match
  if (ENTITY_GROUND_TRUTH_DB[key]) return ENTITY_GROUND_TRUTH_DB[key];

  // Partial match — find any key that the name contains or that contains the name
  for (const [dbKey, value] of Object.entries(ENTITY_GROUND_TRUTH_DB)) {
    if (key.includes(dbKey) || dbKey.includes(key)) return value;
  }

  return null;
}

// ─── APPLY GROUND TRUTH TO SCORING ───────────────────────────────────
// Call this AFTER normal scoring, BEFORE generating the report.
// It overrides scores for known entities and surfaces incidents.

export function applyGroundTruthOverrides(projectName, legitimacyScore, maturityScore, evidence) {
  const gt = lookupGroundTruth(projectName);
  if (!gt) return { legitimacyScore, maturityScore, incidents: [], overridden: false };

  let finalLegitimacy = legitimacyScore;
  let finalMaturity   = maturityScore;
  let overridden = false;

  // Apply floor for known good entities (prevents MakerDAO = High Risk bug)
  if (gt.legitimacyFloor && legitimacyScore < gt.legitimacyFloor) {
    console.log(`  📚 Ground truth floor applied: ${projectName} legitimacy ${legitimacyScore} → ${gt.legitimacyFloor}`);
    finalLegitimacy = gt.legitimacyFloor;
    overridden = true;
  }
  if (gt.maturityFloor && maturityScore < gt.maturityFloor) {
    console.log(`  📚 Ground truth floor applied: ${projectName} maturity ${maturityScore} → ${gt.maturityFloor}`);
    finalMaturity = gt.maturityFloor;
    overridden = true;
  }

  // Apply ceiling for known bad entities (prevents Terra = Low Risk bug)
  if (gt.legitimacyCeiling !== undefined && legitimacyScore > gt.legitimacyCeiling) {
    console.log(`  ⚠ Ground truth ceiling applied: ${projectName} legitimacy ${legitimacyScore} → ${gt.legitimacyCeiling}`);
    finalLegitimacy = gt.legitimacyCeiling;
    overridden = true;
  }
  if (gt.maturityCeiling !== undefined && maturityScore > gt.maturityCeiling) {
    console.log(`  ⚠ Ground truth ceiling applied: ${projectName} maturity ${maturityScore} → ${gt.maturityCeiling}`);
    finalMaturity = gt.maturityCeiling;
    overridden = true;
  }

  // Apply known signals to evidence (ensures confirmed_fraud surfaces for SafeMoon/FTX)
  if (gt.knownSignals) {
    for (const [signal, value] of Object.entries(gt.knownSignals)) {
      if (value === true && evidence[signal] !== 'YES') {
        evidence[signal] = 'YES';
      }
    }
  }

  return {
    legitimacyScore: finalLegitimacy,
    maturityScore: finalMaturity,
    incidents: gt.incidents || [],
    tier: gt.tier,
    overridden,
    forceRiskLevel: gt.forceRiskLevel || null,
  };
}

// ─── FORMAT INCIDENTS BLOCK ───────────────────────────────────────────
// Returns a formatted string block for the report

export function formatIncidentsBlock(incidents) {
  if (!incidents || incidents.length === 0) return '';

  const severityIcon = { catastrophic: '🔴', high: '🟠', medium: '🟡', low: '🟢' };

  const lines = incidents.map(inc =>
    `  ${severityIcon[inc.severity] || '⚠'} ${inc.title}\n` +
    `     ${inc.description}\n` +
    (inc.sources?.[0] ? `     Source: ${inc.sources[0]}` : '')
  ).join('\n\n');

  return `\nMAJOR HISTORICAL INCIDENTS  (ground truth — not extracted by AI)\n${'─'.repeat(50)}\n${lines}\n${'─'.repeat(50)}`;
}
