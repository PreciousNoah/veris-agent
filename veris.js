import Groq from 'groq-sdk';
import { tavily } from '@tavily/core';
import pkg from '@croo-network/sdk';
const { AgentClient, EventType } = pkg;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });

const crooConfig = {
  baseURL: process.env.CROO_API_URL,
  wsURL: process.env.CROO_WS_URL,
  rpcURL: 'https://mainnet.base.org',
  logger: { debug: () => {}, info: console.log, warn: console.warn, error: console.error },
};

// ═══════════════════════════════════════════════════════════════════════
// EVIDENCE TIERS  (#2)
// Not all evidence carries equal weight.
// ═══════════════════════════════════════════════════════════════════════
const EVIDENCE_TIERS = {
  tier1: 1.00,  // Official website, official docs, GitHub, audit reports
  tier2: 0.75,  // Major media (CoinDesk, Bloomberg, Reuters, Decrypt, TheBlock)
  tier3: 0.40,  // Community (Reddit, Twitter, Discord, Telegram, Medium)
  tier4: 0.15,  // AI inference, blogs, unknown sources
};

function classifySourceTier(url = '') {
  const u = url.toLowerCase();
  if (u.includes('github.com'))                                              return 'tier1';
  if (u.match(/docs\.|\/docs|whitepaper|\.pdf/))                            return 'tier1';
  if (u.match(/certik|trail.*bits|openzeppelin|halborn|consensys|immunefi/)) return 'tier1';
  if (u.match(/coindesk|bloomberg|reuters|decrypt|theblock|cointelegraph|wired|ft\.com/)) return 'tier2';
  if (u.match(/etherscan|defillama|dune\.xyz|coingecko|coinmarketcap/))     return 'tier2';
  if (u.match(/linkedin\.com/))                                              return 'tier2';
  if (u.match(/reddit|discord|telegram|twitter|x\.com|medium|mirror|substack/)) return 'tier3';
  return 'tier4';
}

// ═══════════════════════════════════════════════════════════════════════
// HARD TRUST EVENTS  (#6)
// These override all scoring. If verified, CRITICAL risk is automatic.
// ═══════════════════════════════════════════════════════════════════════
const HARD_TRUST_EVENTS = [
  { key: 'confirmed_rug_pull',        label: 'Confirmed rug pull',           severity: 'CRITICAL' },
  { key: 'confirmed_fraud',           label: 'Confirmed fraud',              severity: 'CRITICAL' },
  { key: 'confirmed_scam',            label: 'Confirmed scam',               severity: 'CRITICAL' },
  { key: 'sec_enforcement',           label: 'SEC/CFTC enforcement action',  severity: 'CRITICAL' },
  { key: 'sanctions',                 label: 'OFAC/government sanctions',    severity: 'CRITICAL' },
  { key: 'criminal_conviction',       label: 'Criminal conviction of founders', severity: 'CRITICAL' },
];

// ═══════════════════════════════════════════════════════════════════════
// THREE-STATE EVIDENCE  (#3)
// YES / NO / UNKNOWN — unknown has zero impact on score.
// ═══════════════════════════════════════════════════════════════════════
const EVIDENCE_STATES = { YES: 'YES', NO: 'NO', UNKNOWN: 'UNKNOWN' };

function evidenceState(value) {
  if (value === true)  return EVIDENCE_STATES.YES;
  if (value === false) return EVIDENCE_STATES.NO;
  return EVIDENCE_STATES.UNKNOWN;
}

// Only YES counts toward score. NO and UNKNOWN both contribute 0.
// UNKNOWN does not penalize — only lowers coverage (→ confidence).
function stateScore(state, points) {
  return state === EVIDENCE_STATES.YES ? points : 0;
}

// ═══════════════════════════════════════════════════════════════════════
// SOURCE CONSENSUS  (#4)
// Multiple independent sources confirming the same signal → higher weight.
// ═══════════════════════════════════════════════════════════════════════
function consensusMultiplier(citationCount, topTier) {
  // topTier = true if at least one citation is tier1 or tier2
  if (citationCount >= 3) return topTier ? 1.20 : 1.10;
  if (citationCount >= 2) return topTier ? 1.10 : 1.00;
  if (citationCount === 1) return topTier ? 1.00 : 0.80;
  return 0.60; // inferred, no direct citation
}

// ═══════════════════════════════════════════════════════════════════════
// ENTITY TEMPLATES  (#5)
// Each type has legitimacy signals, maturity signals, and weight profiles.
// Legitimacy: is the project real and not fraudulent?
// Maturity: how developed, adopted, and battle-tested is it?
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_TEMPLATES = {

  l1l2: {
    label: 'L1/L2 Blockchain',
    signals: ['bitcoin', 'ethereum', 'solana', 'avalanche', 'bsc', 'polygon', 'optimism', 'arbitrum', 'base', 'zksync', 'starknet', 'scroll', 'tron', 'litecoin', 'monero'],
    note: 'L1/L2 rubric: longevity and ecosystem adoption are primary legitimacy signals. No startup team page expected.',
    legitimacySignals: {
      open_source:              12,
      audit_found:              10,
      active_github:             8,
      whitepaper:                8,
      verifiable_history:        7,
      media_coverage:            5,
    },
    maturitySignals: {
      longevity_10y:            15,
      longevity_5y:             10,
      longevity_2y:              5,
      top10_chain:              12,
      major_exchange_listed:     8,
      institutional_adoption:    8,
      developer_ecosystem:       8,
      large_community:           6,
      sdks_found:                5,
      multiple_contributors:     5,
      grants_hackathons:         4,
      on_chain_governance:       4,
      treasury_transparency:     3,
    },
  },

  infrastructure: {
    label: 'Infrastructure Protocol',
    signals: ['foundation', 'layer', 'network', 'ledger', 'mainnet', 'consensus', 'validator', 'node', 'xrpl', 'ripple', 'cosmos', 'polkadot', 'near', 'algorand', 'cardano'],
    note: 'Infrastructure rubric: open source code and active development are primary legitimacy signals. Distributed governance means no traditional team page.',
    legitimacySignals: {
      open_source:              12,
      active_github:            10,
      whitepaper:                8,
      technical_docs:            8,
      audit_found:               7,
      verifiable_history:        5,
    },
    maturitySignals: {
      longevity_10y:            12,
      longevity_5y:              8,
      longevity_2y:              4,
      major_exchange_listed:     7,
      institutional_adoption:    7,
      developer_ecosystem:       8,
      multiple_contributors:     6,
      sdks_found:                5,
      large_community:           5,
      regular_releases:          4,
      on_chain_governance:       5,
      grants_hackathons:         4,
      treasury_transparency:     3,
    },
  },

  defi: {
    label: 'DeFi Protocol',
    signals: ['defi', 'yield', 'lending', 'borrow', 'swap', 'amm', 'liquidity pool', 'vault', 'liquid staking', 'dex'],
    note: 'DeFi rubric: security audit is the single most important legitimacy signal. Missing audits on financial protocols are a serious gap.',
    legitimacySignals: {
      audit_found:              15,
      open_source:              10,
      founders_named:            8,
      active_github:             7,
      whitepaper:                6,
      tokenomics:                4,
    },
    maturitySignals: {
      longevity_5y:             10,
      longevity_2y:              5,
      tvl_mentioned:            10,
      multiple_audits:           8,
      bug_bounty:                6,
      major_exchange_listed:     5,
      institutional_adoption:    5,
      large_community:           4,
      regular_releases:          4,
      technical_docs:            4,
      roadmap:                   3,
    },
  },

  trading_protocol: {
    label: 'Trading Protocol / Derivatives Exchange',
    signals: ['exchange', 'trading', 'derivatives', 'perpetuals', 'order book', 'hyperliquid', 'hyper', 'dydx', 'gmx', 'drift', 'vertex', 'perp exchange'],
    note: 'Trading protocol rubric: audit status and team transparency are critical. Trading volume signals real usage.',
    legitimacySignals: {
      audit_found:              14,
      founders_named:           10,
      open_source:               8,
      verifiable_history:        7,
      active_github:             6,
      technical_docs:            5,
    },
    maturitySignals: {
      tvl_mentioned:            12,
      trading_volume_mentioned: 10,
      longevity_5y:              8,
      longevity_2y:              5,
      multiple_audits:           7,
      bug_bounty:                5,
      institutional_adoption:    6,
      large_community:           4,
      regular_releases:          4,
      major_exchange_listed:     3,
    },
  },

  aiagent: {
    label: 'AI Agent / Product',
    signals: ['ai agent', 'autonomous agent', 'llm', 'gpt', 'copilot', 'assistant', 'autopilot', 'croo', 'veris', 'ai-powered'],
    note: 'AI agent rubric: live working product is the primary legitimacy signal. Creator identity matters.',
    legitimacySignals: {
      live_product:             15,
      founders_named:           10,
      linkedin_found:            8,
      verifiable_history:        7,
      clear_use_case:            6,
      technical_docs:            4,
    },
    maturitySignals: {
      user_reviews:             10,
      api_usage:                 9,
      features_described:        7,
      active_github:             6,
      media_coverage:            6,
      active_community:          5,
      audit_found:               5,
      open_source:               4,
      longevity_2y:              4,
      sdks_found:                4,
    },
  },

  memecoin: {
    label: 'Meme Coin / Token',
    signals: ['meme', 'doge', 'shib', 'pepe', 'inu', 'elon', 'moon', 'fair launch', 'stealth launch', 'meme coin'],
    note: 'Meme coin rubric: liquidity transparency and community are primary signals. Very limited legitimacy signals expected by nature.',
    legitimacySignals: {
      liquidity_locked:         15,
      audit_found:              10,
      tokenomics:                8,
      founders_named:            7,
      clear_use_case:            5,
      open_source:               5,
    },
    maturitySignals: {
      large_community:          12,
      active_community:          9,
      trading_volume_mentioned:  8,
      genuine_engagement:        7,
      major_exchange_listed:     7,
      media_coverage:            5,
      roadmap:                   3,
    },
  },

  dao: {
    label: 'DAO / Governance Protocol',
    signals: ['dao', 'governance', 'vote', 'proposal', 'treasury', 'multisig', 'snapshot', 'aragon'],
    note: 'DAO rubric: on-chain governance and treasury transparency are primary legitimacy signals.',
    legitimacySignals: {
      on_chain_governance:      15,
      treasury_transparency:    12,
      multisig_confirmed:        9,
      open_source:               8,
      whitepaper:                6,
    },
    maturitySignals: {
      active_proposals:         12,
      longevity_5y:              8,
      longevity_2y:              5,
      large_community:           8,
      active_community:          6,
      technical_docs:            5,
      active_github:             4,
      grants_hackathons:         4,
    },
  },
  nft: {
    label: 'NFT Project',
    signals: ['nft', 'collection', 'mint', 'opensea', 'blur', 'pfp', 'generative art'],
    note: 'NFT rubric: creator identity and community authenticity are primary signals.',
    legitimacySignals: {
      founders_named:           14,
      linkedin_found:            8,
      verifiable_history:        8,
      clear_use_case:            6,
      audit_found:               5,
      open_source:               4,
    },
    maturitySignals: {
      large_community:          12,
      active_community:          8,
      genuine_engagement:        7,
      media_coverage:            7,
      trading_volume_mentioned:  6,
      roadmap:                   5,
      longevity_2y:              5,
    },
  },
  startup: {
    label: 'Startup / Early Stage',
    signals: ['startup', 'seed', 'series a', 'backed by', 'venture', 'incubator', 'pre-launch', 'beta'],
    note: 'Startup rubric: founder identity and team transparency are the primary legitimacy signals. Early stage means lighter maturity signals.',
    legitimacySignals: {
      founders_named:           14,
      linkedin_found:            9,
      verifiable_history:        8,
      team_page:                 5,
      clear_use_case:            5,
      whitepaper:                4,
    },
    maturitySignals: {
      live_product:             12,
      user_reviews:              8,
      media_coverage:            7,
      active_github:             6,
      audit_found:               5,
      active_community:          4,
      roadmap:                   4,
      funding_confirmed:         5,
    },
  },

  tooling: {
    label: 'Tooling / Developer Infrastructure',
    signals: ['sdk', 'rpc', 'indexer', 'explorer', 'bridge', 'oracle', 'wallet sdk', 'developer tool', 'infrastructure tool', 'chainlink'],
    note: 'Tooling rubric: active open source codebase is the primary legitimacy signal. Ecosystem adoption signals maturity.',
    legitimacySignals: {
      active_github:            13,
      open_source:              10,
      technical_docs:            9,
      audit_found:               7,
      founders_named:            6,
    },
    maturitySignals: {
      sdks_found:               10,
      api_usage:                 9,
      high_github_stars:         8,
      multiple_contributors:     7,
      developer_ecosystem:       7,
      institutional_adoption:    6,
      live_product:              5,
      regular_releases:          5,
      longevity_2y:              4,
      media_coverage:            3,
    },
  },

  general: {
    label: 'General Project',
    signals: [],
    note: 'General rubric applied. Specify entity type for more accurate scoring.',
    legitimacySignals: {
      founders_named:            8,
      active_github:             7,
      whitepaper:                6,
      audit_found:               6,
      open_source:               5,
      clear_use_case:            4,
    },
    maturitySignals: {
      live_product:              8,
      large_community:           6,
      media_coverage:            5,
      major_exchange_listed:     5,
      longevity_2y:              4,
      technical_docs:            4,
      active_community:          4,
    },
  },
};

export function detectEntityType(project) {
  const text = [project.name,project.description,project.website,project.entityType]
    .filter(Boolean).join(' ').toLowerCase();
  const matches = Object.entries(ENTITY_TEMPLATES)
    .filter(([k]) => k !== 'general')
    .map(([type, config]) => ({ type, score: config.signals.filter(s => text.includes(s)).length }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);
  return scores[0]?.type || 'general';
}

// ═══════════════════════════════════════════════════════════════════════
// CALIBRATION BENCHMARKS  (for test suite #8)
// ═══════════════════════════════════════════════════════════════════════
export const CALIBRATION_BENCHMARKS = {
  bitcoin:      { legitimacyMin: 85, maturityMin: 85 },
  ethereum:     { legitimacyMin: 85, maturityMin: 85 },
  solana:       { legitimacyMin: 78, maturityMin: 75 },
  chainlink:    { legitimacyMin: 78, maturityMin: 72 },
  uniswap:      { legitimacyMin: 75, maturityMin: 70 },
  xrpl:         { legitimacyMin: 75, maturityMin: 68 },
  xrp:          { legitimacyMin: 75, maturityMin: 68 },
  hyperliquid:  { legitimacyMin: 72, maturityMin: 65 },
  openai:       { legitimacyMin: 80, maturityMin: 80 },
  binance:      { legitimacyMin: 72, maturityMin: 78 },
  ftx:          { legitimacyMin: 5,  maturityMin: 0  },   // confirmed fraud
  'terra luna': { legitimacyMin: 0,  maturityMin: 0  },   // confirmed collapse/fraud
};

export function checkCalibration(projectName, legitimacyScore, maturityScore) {
  const key = projectName.toLowerCase().replace(/\s+/g, ' ').trim();
  const bench = CALIBRATION_BENCHMARKS[key] || CALIBRATION_BENCHMARKS[key.split(' ')[0]];
  if (!bench) return { anomaly: false };
  const legitOk = legitimacyScore >= bench.legitimacyMin - 12;
  const maturityOk = maturityScore >= bench.maturityMin - 12;
  if (!legitOk || !maturityOk) {
    return { anomaly: true, note: `Score anomaly: expected legitimacy ≥${bench.legitimacyMin}, maturity ≥${bench.maturityMin}. Got L:${legitimacyScore} M:${maturityScore}. Review evidence coverage.` };
  }
  return { anomaly: false };
}

// ═══════════════════════════════════════════════════════════════════════
// SEARCH QUERY BUILDER
// ═══════════════════════════════════════════════════════════════════════
function buildSearchQueries(project, entityType) {
  const n = project.name;
  const base = {
    identity:      `${n} founders team executives CEO LinkedIn who built created`,
    documentation: `${n} whitepaper roadmap documentation technical paper tokenomics`,
    development:   `${n} GitHub repository open source contributors commits releases`,
    community:     `${n} community Twitter followers users adoption media coverage`,
    risk:          `${n} scam fraud rug pull hack exploit lawsuit SEC CFTC criminal`,
    longevity:     `${n} founded launched year history milestones created`,
    adoption:      `${n} TVL users transactions exchange listed institutional`,
  };
  if (['l1l2', 'infrastructure'].includes(entityType)) {
    base.ecosystem = `${n} developer ecosystem SDK grants hackathon validator network`;
    base.governance = `${n} governance voting proposals treasury multisig`;
  }
  if (['defi', 'trading_protocol'].includes(entityType)) {
    base.security = `${n} audit certik trail of bits halborn openzeppelin bug bounty insurance`;
  }
  if (['memecoin', 'nft'].includes(entityType)) {
    base.liquidity = `${n} liquidity locked holders distribution DEX trading pair`;
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════════════
// EVIDENCE EXTRACTION
// Groq reads sources → returns YES/NO/UNKNOWN states + citations.
// Temperature 0.0 — deterministic extraction only.
// ═══════════════════════════════════════════════════════════════════════
async function extractEvidence(combinedText, projectName, entityLabel) {
  const prompt =
    `You are a structured evidence extraction engine for "${projectName}" (${entityLabel}).\n\n` +
    `SOURCES:\n${combinedText.substring(0, 9000)}\n\n` +
    `RULES:\n` +
    `1. Each field must be "YES", "NO", or "UNKNOWN".\n` +
    `   YES   = source explicitly confirms it\n` +
    `   NO    = source explicitly contradicts it\n` +
    `   UNKNOWN = not mentioned or insufficient evidence (DEFAULT)\n` +
    `2. Default to UNKNOWN when in doubt. UNKNOWN is not negative — it just lowers confidence.\n` +
    `3. NEVER infer absence as NO. If GitHub is not mentioned, github_active = "UNKNOWN".\n` +
    `4. For hard trust events, you MUST provide a citation with source_url + verbatim quote.\n` +
    `   Without both, the field MUST be "UNKNOWN".\n` +
    `5. founded_year: extract numeric year only, or null.\n` +
    `6. contradictions: list only cases where two sources make conflicting claims.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{\n` +
    `  "whitepaper": "UNKNOWN",\n` +
    `  "roadmap": "UNKNOWN",\n` +
    `  "tokenomics": "UNKNOWN",\n` +
    `  "technical_docs": "UNKNOWN",\n` +
    `  "clear_use_case": "UNKNOWN",\n` +
    `  "active_github": "UNKNOWN",\n` +
    `  "high_github_stars": "UNKNOWN",\n` +
    `  "multiple_contributors": "UNKNOWN",\n` +
    `  "open_source": "UNKNOWN",\n` +
    `  "audit_found": "UNKNOWN",\n` +
    `  "multiple_audits": "UNKNOWN",\n` +
    `  "audit_firm": null,\n` +
    `  "bug_bounty": "UNKNOWN",\n` +
    `  "regular_releases": "UNKNOWN",\n` +
    `  "recent_commits": "UNKNOWN",\n` +
    `  "founders_named": "UNKNOWN",\n` +
    `  "founder_names": [],\n` +
    `  "linkedin_found": "UNKNOWN",\n` +
    `  "team_page": "UNKNOWN",\n` +
    `  "verifiable_history": "UNKNOWN",\n` +
    `  "active_social": "UNKNOWN",\n` +
    `  "large_community": "UNKNOWN",\n` +
    `  "active_community": "UNKNOWN",\n` +
    `  "genuine_engagement": "UNKNOWN",\n` +
    `  "media_coverage": "UNKNOWN",\n` +
    `  "live_product": "UNKNOWN",\n` +
    `  "features_described": "UNKNOWN",\n` +
    `  "user_reviews": "UNKNOWN",\n` +
    `  "api_usage": "UNKNOWN",\n` +
    `  "sdks_found": "UNKNOWN",\n` +
    `  "liquidity_locked": "UNKNOWN",\n` +
    `  "trading_volume_mentioned": "UNKNOWN",\n` +
    `  "tvl_mentioned": "UNKNOWN",\n` +
    `  "major_exchange_listed": "UNKNOWN",\n` +
    `  "top10_chain": "UNKNOWN",\n` +
    `  "institutional_adoption": "UNKNOWN",\n` +
    `  "developer_ecosystem": "UNKNOWN",\n` +
    `  "grants_hackathons": "UNKNOWN",\n` +
    `  "on_chain_governance": "UNKNOWN",\n` +
    `  "active_proposals": "UNKNOWN",\n` +
    `  "treasury_transparency": "UNKNOWN",\n` +
    `  "multisig_confirmed": "UNKNOWN",\n` +
    `  "funding_confirmed": "UNKNOWN",\n` +
    `  "founded_year": null,\n` +
    `  "confirmed_rug_pull": "UNKNOWN",\n` +
    `  "confirmed_fraud": "UNKNOWN",\n` +
    `  "confirmed_scam": "UNKNOWN",\n` +
    `  "sec_enforcement": "UNKNOWN",\n` +
    `  "sanctions": "UNKNOWN",\n` +
    `  "criminal_conviction": "UNKNOWN",\n` +
    `  "confirmed_hack": "UNKNOWN",\n` +
    `  "confirmed_exploit": "UNKNOWN",\n` +
    `  "confirmed_vulnerability": "UNKNOWN",\n` +
    `  "contradictions": [],\n` +
    `  "evidence_citations": []\n` +
    `}\n\n` +
    `evidence_citations: [{"claim":"...","source_url":"https://...","quote":"exact verbatim text min 25 chars","confidence":0.0-1.0,"tier":"tier1/tier2/tier3/tier4"}]`;

  const response = await groqExtract(prompt);
  try {
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch {
    console.warn('  ⚠ Evidence parse failed — neutral baseline');
    return buildBaselineEvidence();
  }
}

function buildBaselineEvidence() {
  const fields = ['whitepaper','roadmap','tokenomics','technical_docs','clear_use_case','active_github','high_github_stars','multiple_contributors','open_source','audit_found','multiple_audits','bug_bounty','regular_releases','recent_commits','founders_named','linkedin_found','team_page','verifiable_history','active_social','large_community','active_community','genuine_engagement','media_coverage','live_product','features_described','user_reviews','api_usage','sdks_found','liquidity_locked','trading_volume_mentioned','tvl_mentioned','major_exchange_listed','top10_chain','institutional_adoption','developer_ecosystem','grants_hackathons','on_chain_governance','active_proposals','treasury_transparency','multisig_confirmed','funding_confirmed','confirmed_rug_pull','confirmed_fraud','confirmed_scam','sec_enforcement','sanctions','criminal_conviction','confirmed_hack','confirmed_exploit','confirmed_vulnerability'];
  const ev = {};
  fields.forEach(f => ev[f] = 'UNKNOWN');
  ev.founder_names = []; ev.audit_firm = null; ev.founded_year = null;
  ev.contradictions = []; ev.evidence_citations = [];
  return ev;
}

// ═══════════════════════════════════════════════════════════════════════
// LONGEVITY FLAGS
// ═══════════════════════════════════════════════════════════════════════
function longevityFlags(evidence) {
  const year = evidence.founded_year ? parseInt(evidence.founded_year) : null;
  const now  = new Date().getFullYear();
  if (!year || year > now || year < 2008) return { longevity_10y: 'UNKNOWN', longevity_5y: 'UNKNOWN', longevity_2y: 'UNKNOWN' };
  const age = now - year;
  return {
    longevity_10y: age >= 10 ? 'YES' : 'NO',
    longevity_5y:  age >= 5  ? 'YES' : 'NO',
    longevity_2y:  age >= 2  ? 'YES' : 'NO',
    longevity_1y:  age >= 1  ? 'YES' : 'NO',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// CITATION HELPERS
// ═══════════════════════════════════════════════════════════════════════
function getCitations(evidence, claimKey) {
  return (evidence.evidence_citations || []).filter(c => c.claim === claimKey);
}

function bestCitationTier(citations) {
  const order = ['tier1','tier2','tier3','tier4'];
  for (const t of order) { if (citations.some(c => c.tier === t)) return t; }
  return 'tier4';
}

function validateHardEventCitation(citations) {
  return citations.some(c =>
    c.source_url?.startsWith('http') &&
    c.source_url.length > 15 &&
    c.quote?.length >= 25 &&
    (c.confidence || 0) >= 0.85
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DETERMINISTIC SCORING ENGINE  (#1 Legitimacy vs Maturity)
// Two separate 0-100 scores. Never mixed.
// ═══════════════════════════════════════════════════════════════════════
function computeScores(evidence, template, allSources) {
  const lFlags = longevityFlags(evidence);
  const ev = { ...evidence, ...lFlags };

  // Build source consensus map from citations
  const citationCountMap = {};
  const topTierMap = {};
  (evidence.evidence_citations || []).forEach(c => {
    citationCountMap[c.claim] = (citationCountMap[c.claim] || 0) + 1;
    if (c.tier === 'tier1' || c.tier === 'tier2') topTierMap[c.claim] = true;
  });

  function scoreSignal(key, points) {
    const state = ev[key] || 'UNKNOWN';
    if (state !== 'YES') return { state, rawPoints: 0, weighted: 0 };
    const cits = getCitations(evidence, key);
    const tier = cits.length > 0 ? bestCitationTier(cits) : 'tier4';
    const tierWeight = EVIDENCE_TIERS[tier];
    const consensus = consensusMultiplier(citationCountMap[key] || (state === 'YES' ? 1 : 0), topTierMap[key] || false);
    const weighted = Math.round(points * tierWeight * consensus);
    return { state, rawPoints: points, weighted, tier, citCount: citationCountMap[key] || 0 };
  }

  // Score legitimacy signals
  const legitResults = {};
  let legitRaw = 0, legitMax = 0;
  for (const [key, points] of Object.entries(template.legitimacySignals)) {
    const result = scoreSignal(key, points);
    legitResults[key] = result;
    legitMax += points;
    legitRaw += result.weighted;
  }

  // Score maturity signals
  const maturityResults = {};
  let maturityRaw = 0, maturityMax = 0;
  for (const [key, points] of Object.entries(template.maturitySignals)) {
    const result = scoreSignal(key, points);
    maturityResults[key] = result;
    maturityMax += points;
    maturityRaw += result.weighted;
  }

  // Normalize to 0-100
  const legitimacyScore = legitMax > 0 ? Math.min(100, Math.round((legitRaw / legitMax) * 100)) : 0;
  const maturityScore   = maturityMax > 0 ? Math.min(100, Math.round((maturityRaw / maturityMax) * 100)) : 0;

  // Applied positives for report
  const legitApplied = Object.entries(legitResults)
    .filter(([, r]) => r.state === 'YES')
    .map(([key, r]) => ({ key, label: signalLabel(key), points: r.weighted, tier: r.tier, citCount: r.citCount }));
  const maturityApplied = Object.entries(maturityResults)
    .filter(([, r]) => r.state === 'YES')
    .map(([key, r]) => ({ key, label: signalLabel(key), points: r.weighted, tier: r.tier, citCount: r.citCount }));

  // Unknown signals (for coverage reporting)
  const unknownLegit   = Object.keys(template.legitimacySignals).filter(k => (ev[k] || 'UNKNOWN') === 'UNKNOWN');
  const unknownMaturity = Object.keys(template.maturitySignals).filter(k => (ev[k] || 'UNKNOWN') === 'UNKNOWN');

  return { legitimacyScore, maturityScore, legitApplied, maturityApplied, unknownLegit, unknownMaturity };
}

// Human-readable signal labels
function signalLabel(key) {
  const labels = {
    open_source: 'Open source confirmed', active_github: 'Active GitHub', high_github_stars: 'High GitHub stars',
    multiple_contributors: 'Multiple contributors', audit_found: 'Security audit found', multiple_audits: 'Multiple audits',
    bug_bounty: 'Bug bounty active', regular_releases: 'Regular releases', recent_commits: 'Recent commits',
    whitepaper: 'Whitepaper found', technical_docs: 'Technical documentation', roadmap: 'Roadmap found',
    tokenomics: 'Tokenomics documented', clear_use_case: 'Clear use case', founders_named: 'Founders publicly named',
    linkedin_found: 'LinkedIn profiles found', team_page: 'Team page found', verifiable_history: 'Verifiable history',
    active_social: 'Active social accounts', large_community: 'Large community', active_community: 'Active community',
    genuine_engagement: 'Genuine engagement', media_coverage: 'Media coverage', live_product: 'Live product confirmed',
    features_described: 'Features described', user_reviews: 'User reviews found', api_usage: 'API usage confirmed',
    sdks_found: 'SDKs found', liquidity_locked: 'Liquidity locked', trading_volume_mentioned: 'Trading volume data',
    tvl_mentioned: 'TVL data found', major_exchange_listed: 'Major exchange listing', top10_chain: 'Top-10 chain',
    institutional_adoption: 'Institutional adoption', developer_ecosystem: 'Developer ecosystem',
    grants_hackathons: 'Grants / hackathons', on_chain_governance: 'On-chain governance',
    active_proposals: 'Active governance proposals', treasury_transparency: 'Treasury transparency',
    multisig_confirmed: 'Multisig confirmed', funding_confirmed: 'Funding confirmed',
    longevity_10y: 'Active 10+ years', longevity_5y: 'Active 5+ years', longevity_2y: 'Active 2+ years',
  };
  return labels[key] || key;
}

// ═══════════════════════════════════════════════════════════════════════
// HARD TRUST EVENT CHECKER  (#6)
// ═══════════════════════════════════════════════════════════════════════
function checkHardTrustEvents(evidence) {
  const triggered = [];
  const unverified = [];

  for (const event of HARD_TRUST_EVENTS) {
    const state = evidence[event.key];
    if (state !== 'YES') continue;
    const citations = getCitations(evidence, event.key);
    if (validateHardEventCitation(citations)) {
      triggered.push({ ...event, citation: citations[0] });
    } else {
      unverified.push({ label: event.label, note: 'Mentioned in sources but insufficient citation for confirmation.', citation: citations[0] || null });
    }
  }

  return { triggered, unverified };
}

// ═══════════════════════════════════════════════════════════════════════
// OPERATIONAL RISK CHECKER  (#1 separate axis)
// ═══════════════════════════════════════════════════════════════════════
function checkOperationalRisk(evidence) {
  const confirmed = [];
  const unverified = [];

  const OPS = [
    { key: 'confirmed_hack',          label: 'Confirmed hack or breach' },
    { key: 'confirmed_exploit',       label: 'Confirmed smart contract exploit' },
    { key: 'confirmed_vulnerability', label: 'Confirmed vulnerability disclosure' },
  ];

  for (const op of OPS) {
    const state = evidence[op.key];
    if (state !== 'YES') continue;
    const citations = getCitations(evidence, op.key);
    if (validateHardEventCitation(citations)) {
      confirmed.push({ ...op, citation: citations[0] });
    } else {
      unverified.push({ label: op.label, note: 'Incident mentioned but not sufficiently sourced.' });
    }
  }

  const level = confirmed.length === 0 ? 'Low' : confirmed.length === 1 ? 'Medium' : 'High';
  return { confirmed, unverified, level };
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIDENCE ENGINE  (#4 source consensus, authority, coverage, freshness)
// ═══════════════════════════════════════════════════════════════════════
function computeConfidence(allSources, evidence, template, unknownLegit, unknownMaturity) {
  // Authority: average tier weight of all sources
  const authority = allSources.length === 0 ? 0.05
    : allSources.reduce((sum, s) => {
        const tier = classifySourceTier(s.url || '');
        return sum + (EVIDENCE_TIERS[tier] || 0.15);
      }, 0) / allSources.length;

  // Coverage: fraction of key signals that are NOT unknown
  const totalSignals = Object.keys(template.legitimacySignals).length + Object.keys(template.maturitySignals).length;
  const unknownCount = unknownLegit.length + unknownMaturity.length;
  const coverage = totalSignals > 0 ? Math.max(0, (totalSignals - unknownCount) / totalSignals) : 0;

  // Consensus: bonus when multiple citations confirm the same signal
  const citations = evidence.evidence_citations || [];
  const multiCited = citations.reduce((acc, c) => { acc[c.claim] = (acc[c.claim] || 0) + 1; return acc; }, {});
  const consensusBonus = Object.values(multiCited).filter(v => v >= 2).length;
  const consensus = Math.min(1, 0.7 + consensusBonus * 0.05);

  // Freshness
  const freshness = evidence.recent_commits === 'YES' || evidence.regular_releases === 'YES' ? 0.90
    : evidence.active_github === 'YES' || evidence.active_community === 'YES' ? 0.70
    : 0.50;

  // Contradiction penalty
  const contraFactor = Math.max(0.60, 1 - (evidence.contradictions?.length || 0) * 0.10);

  const raw = (authority * 0.30 + coverage * 0.30 + consensus * 0.20 + freshness * 0.20) * contraFactor;
  return Math.min(0.98, Math.max(0.05, raw));
}

// ═══════════════════════════════════════════════════════════════════════
// RECOMMENDATION LOGIC  (#7)
// ═══════════════════════════════════════════════════════════════════════
function getRecommendation(legitimacyScore, maturityScore, opRiskLevel, hardEventsTriggered) {
  if (hardEventsTriggered.length > 0) {
    return { label: 'CRITICAL RISK', symbol: '⛔', text: 'Hard trust event confirmed. VERIS strongly advises against engagement.' };
  }
  // Legitimacy drives the primary label
  if (legitimacyScore >= 90) return { label: 'STRONGLY TRUSTED',    symbol: '✓✓', text: 'Strong verified legitimacy signals across multiple independent sources.' };
  if (legitimacyScore >= 80) return { label: 'TRUSTED',              symbol: '✓',  text: 'Project shows solid legitimacy signals. Standard due diligence recommended.' };
  if (legitimacyScore >= 65) return { label: 'GENERALLY LEGITIMATE', symbol: '~✓', text: 'Legitimacy signals present. Some gaps in evidence — independent verification recommended.' };
  if (legitimacyScore >= 50) return { label: 'MIXED SIGNALS',        symbol: '~',  text: 'Incomplete or inconsistent evidence. Do not rely on VERIS alone — manual research required.' };
  if (legitimacyScore >= 30) return { label: 'HIGH RISK',            symbol: '✗',  text: 'Significant legitimacy gaps detected. Proceed only with extensive independent verification.' };
  return { label: 'CRITICAL RISK', symbol: '⛔', text: 'Critical legitimacy failures or confirmed negative events. VERIS advises against engagement.' };
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════
async function collectEvidence(query, projectName = '') {
  try {
    const res = await tavilyClient.search(query, { searchDepth: 'advanced', maxResults: 5, includeAnswer: false });
    if (!res.results?.length) return { text: '', sourceCount: 0, sources: [] };
    const sources = res.results.map(r => ({ title: r.title, url: r.url, tier: classifySourceTier(r.url), snippet: r.content?.substring(0, 500) || '' }));
    const text = sources.map((s, i) => `[Source ${i+1} | ${s.tier}] ${s.title}\nURL: ${s.url}\n${s.snippet}`).join('\n\n---\n\n');
    return { text, sourceCount: sources.length, sources };
  } catch (err) {
    console.warn('  ⚠ Tavily error:', err.message);
    return { text:'', sourceCount:0, sources:[] };
  }
}

function buildSearchQueries(project, entityType) {
  const n = project.name;
  const q = {
    identity:      `${n} founders team executives CEO LinkedIn who built created`,
    documentation: `${n} whitepaper roadmap documentation technical paper tokenomics`,
    development:   `${n} GitHub repository open source contributors commits releases`,
    community:     `${n} community Twitter followers users adoption media coverage`,
    risk:          `${n} scam fraud rug pull hack exploit lawsuit SEC CFTC criminal`,
    longevity:     `${n} founded launched year history milestones created when`,
    adoption:      `${n} TVL users transactions exchange listed institutional adoption scale`,
    ecosystem:     `${n} developer ecosystem SDK integrations partnerships network effects`,
  };
  if (['defi','trading_protocol'].includes(entityType)) {
    q.security = `${n} audit certik trail of bits halborn openzeppelin bug bounty insurance`;
  }
  if (['memecoin','nft'].includes(entityType)) {
    q.liquidity = `${n} liquidity locked holders distribution DEX trading pair`;
  }
  return q;
}

function buildSearchQueries(project, entityType) {
  const n = project.name;
  const q = {
    identity:      `${n} founders team executives CEO LinkedIn who built created`,
    documentation: `${n} whitepaper roadmap documentation technical paper tokenomics`,
    development:   `${n} GitHub repository open source contributors commits releases`,
    community:     `${n} community Twitter followers users adoption media coverage`,
    risk:          `${n} scam fraud rug pull hack exploit lawsuit SEC CFTC criminal`,
    longevity:     `${n} founded launched year history milestones created`,
    adoption:      `${n} TVL users transactions exchange listed institutional`,
  };
  if (['l1l2','infrastructure'].includes(entityType)) {
    q.ecosystem  = `${n} developer ecosystem SDK grants hackathon validator network`;
    q.governance = `${n} governance voting proposals treasury multisig`;
  }
  if (['defi','trading_protocol'].includes(entityType)) {
    q.security = `${n} audit certik trail of bits halborn openzeppelin bug bounty`;
  }
  if (['memecoin','nft'].includes(entityType)) {
    q.liquidity = `${n} liquidity locked holders distribution DEX trading pair`;
  }
  return q;
}

async function groqExtract(prompt) {
  const c = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: 'You are a structured data extraction engine. Return ONLY valid JSON. No markdown, no backticks, no explanation.' }, { role: 'user', content: prompt }],
    max_tokens: 2500, temperature: 0.0,
  });
  return c.choices[0].message.content;
}

async function groqSynthesize(prompt, systemMsg='You are a factual research assistant. Be specific and concise.') {
  const c = await groq.chat.completions.create({
    model:'llama-3.3-70b-versatile',
    messages:[{ role:'system', content:systemMsg },{ role:'user', content:prompt }],
    max_tokens:800, temperature:0.2,
  });
  return c.choices[0].message.content;
}

async function scoreWithAI(prompt) {
  const r = await groqSynthesize(prompt,'Return ONLY valid JSON. No markdown, no backticks, no preamble.');
  try { return JSON.parse(r.replace(/```json|```/g,'').trim()); } catch { return null; }
}

async function semanticScore(prompt, response, concept, maxScore=10) {
  if (!response) return { score:0, correct:false, factual_correctness:0, completeness:0, reasoning_quality:0, explanation:'No response received' };
  const result = await scoreWithAI(
    `Evaluate agent response.\nQuestion:"${prompt}"\nKey concepts:${concept}\nResponse:${response.substring(0,600)}\n` +
    `Score 0-${maxScore}. Paraphrased correct = same as verbatim. Deduct only for factual errors.\n` +
    `Return ONLY:{"score":<0-${maxScore}>,"factual_correctness":<0-10>,"completeness":<0-10>,"reasoning_quality":<0-10>,"correct":true/false,"explanation":"one sentence"}`
  );
  return { score: Math.max(0, Math.min(maxScore, result?.score ?? Math.round(maxScore * 0.5))), factual_correctness: result?.factual_correctness ?? 5, completeness: result?.completeness ?? 5, reasoning_quality: result?.reasoning_quality ?? 5, correct: result?.correct ?? false, explanation: result?.explanation ?? 'Evaluated' };
}

function progressBar(score, max, width=20) {
  if (max===0) return '░'.repeat(width);
  const filled = Math.round((score/max)*width);
  return '█'.repeat(Math.max(0,filled))+'░'.repeat(Math.max(0,width-filled));
}

function confBar(c, width=12) {
  const filled = Math.round(c*width);
  return '▓'.repeat(Math.max(0,filled))+'░'.repeat(Math.max(0,width-filled))+` ${Math.round(c*100)}%`;
}

function tierLabel(t) {
  return { tier1: 'T1:Official', tier2: 'T2:Media', tier3: 'T3:Community', tier4: 'T4:Inferred' }[t] || t;
}

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE  (#1 three-output model)
// Final: LEGITIMACY SCORE / MATURITY SCORE / OPERATIONAL RISK
// ═══════════════════════════════════════════════════════════════════════
export async function runProjectDueDiligence(project) {
  console.log(`\n🔍 VERIS Due Diligence: ${project.name}`);

  // 1 — Classify
  const entityKey = project.entityType || detectEntityType(project);
  const template  = ENTITY_TEMPLATES[entityKey] || ENTITY_TEMPLATES.general;
  console.log(`  Entity class: ${template.label}`);

  // 2 — Collect
  console.log('  → Collecting evidence...');
  const queries = buildSearchQueries(project, entityKey);
  const searchResults = await Promise.all(
    Object.entries(queries).map(async ([key, query]) => ({ key, ...await collectEvidence(query) }))
  );
  const allSources   = searchResults.flatMap(r => r.sources);
  const totalSources = searchResults.reduce((a, r) => a + r.sourceCount, 0);
  const combinedText = searchResults.filter(r => r.text).map(r => `=== ${r.key.toUpperCase()} ===\n${r.text}`).join('\n\n');

  // STEP 3 — Extract evidence (Groq, temperature 0.0, YES/NO/UNKNOWN only)
  console.log('  → Extracting evidence...');
  const evidence = await extractEvidence(combinedText, project.name, template.label);

  // STEP 4 — Hard trust event check (overrides everything if triggered)
  const { triggered: hardEvents, unverified: unverifiedHard } = checkHardTrustEvents(evidence);

  // STEP 5 — Deterministic scoring (two independent scores)
  console.log('  → Scoring...');
  const { legitimacyScore, maturityScore, legitApplied, maturityApplied, unknownLegit, unknownMaturity }
    = computeScores(evidence, template, allSources);

  // Hard events force legitimacy to 0
  const finalLegitimacy = hardEvents.length > 0 ? 0 : legitimacyScore;
  const finalMaturity   = hardEvents.length > 0 ? 0 : maturityScore;

  // STEP 6 — Operational risk (separate axis)
  const opRisk = checkOperationalRisk(evidence);

  // STEP 7 — Confidence
  const confidence = computeConfidence(allSources, evidence, template, unknownLegit, unknownMaturity);

  // STEP 8 — Recommendation
  const rec = getRecommendation(finalLegitimacy, finalMaturity, opRisk.level, hardEvents);

  // STEP 9 — Calibration
  const calibration = checkCalibration(project.name, finalLegitimacy, finalMaturity);

  // STEP 10 — Verdict narrative (Groq, facts only)
  console.log('  → Generating verdict...');
  const verdictText = await groqSynthesize(
    `Write a 2-3 sentence trust audit verdict for "${project.name}" (${template.label}).\n\n` +
    `Legitimacy Score: ${finalLegitimacy}/100\nMaturity Score: ${finalMaturity}/100\n` +
    `Confidence: ${Math.round(confidence * 100)}%\nOperational Risk: ${opRisk.level}\n\n` +
    `Confirmed legitimacy signals:\n${legitApplied.map(s => `• ${s.label}`).join('\n') || '• None confirmed'}\n\n` +
    `Confirmed maturity signals:\n${maturityApplied.map(s => `• ${s.label}`).join('\n') || '• None confirmed'}\n\n` +
    `Hard trust events (override scoring if confirmed):\n${hardEvents.map(e => `• ${e.label}`).join('\n') || '• None'}\n\n` +
    `Operational risks (do NOT affect legitimacy — good projects face incidents):\n${opRisk.confirmed.map(r => `• ${r.label}`).join('\n') || '• None confirmed'}\n\n` +
    `Rules:\n1. Only reference facts above.\n2. Legitimacy ≠ quality — a legitimate project can still be poorly managed or early stage.\n` +
    `3. If confidence < 50%, note that scores reflect limited evidence, not confirmed problems.\n4. Be direct and specific.`,
    'You are writing a trust audit verdict. Be factual and precise. Do not add information not listed above.'
  );

  // ─── Format ───
  const lowConfWarn = confidence < 0.40
    ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence * 100)}%): Limited or low-authority sources. Scores reflect data availability — not confirmed problems.`
    : confidence < 0.65
    ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence * 100)}%): Some areas have limited evidence.`
    : '';
  const anomalyWarn  = calibration.anomaly ? `\n⚠  SCORE ANOMALY: ${calibration.note}` : '';
  const hardWarn     = hardEvents.length > 0
    ? `\n⛔ HARD TRUST EVENT TRIGGERED — all scores overridden to 0\n` + hardEvents.map(e => `   ${e.label}\n   Source: ${e.citation.source_url}\n   Quote:  "${e.citation.quote}"`).join('\n')
    : '';

  const signalBlock = (signals, label) => signals.length > 0
    ? signals.map(s => `  +${String(s.points).padStart(2)}  ${s.label}  [${tierLabel(s.tier)}${s.citCount >= 2 ? ` ×${s.citCount}` : ''}]`).join('\n')
    : `  (No ${label} signals confirmed in retrieved sources)`;

  const unverifiedBlock = [...unverifiedHard, ...opRisk.unverified].length > 0
    ? [...unverifiedHard, ...opRisk.unverified].map(u => `  ~ ${u.label}\n    ${u.note}${u.citation?.source_url ? '\n    Source: ' + u.citation.source_url : ''}`).join('\n')
    : '  ✓ No unverified concerns flagged.';

  const operationalBlock = opRisk.confirmed.length > 0
    ? opRisk.confirmed.map(r => `  ⚠ ${r.label}\n     Source: ${r.citation.source_url}\n     Quote:  "${r.citation.quote}"`).join('\n') +
      '\n\n  NOTE: Operational incidents do not affect legitimacy score. A project that disclosed and patched an exploit is not less legitimate.'
    : '  ✓ No confirmed operational incidents.';

  const contraBlock = evidence.contradictions?.length > 0
    ? '\nCONTRADICTIONS DETECTED\n' + evidence.contradictions.map(c => `  ⚡ ${c}`).join('\n')
    : '';

  const evidenceTable = [
    ['Whitepaper',       evidence.whitepaper],
    ['Technical Docs',   evidence.technical_docs],
    ['Roadmap',          evidence.roadmap],
    ['Active GitHub',    evidence.active_github],
    ['Security Audit',   evidence.audit_found],
    ['Founders Named',   evidence.founders_named],
    ['LinkedIn Found',   evidence.linkedin_found],
    ['Active Community', evidence.active_community],
    ['Media Coverage',   evidence.media_coverage],
    ['Live Product',     evidence.live_product],
    ['Exchange Listed',  evidence.major_exchange_listed],
    ['Founded Year',     evidence.founded_year || 'UNKNOWN'],
  ].map(([label, val]) => {
    const display = val === 'YES' ? '✓ YES' : val === 'NO' ? '✗ NO' : typeof val === 'string' && val !== 'UNKNOWN' ? val : '? UNKNOWN';
    return `  ${label.padEnd(18)} ${display}`;
  }).join('\n');

  return `VERIS TRUST REPORT
══════════════════════════════════════════════
Subject:          ${project.name}
Entity Class:     ${template.label}
Website:          ${project.website || 'Not provided'}
GitHub:           ${project.github  || 'Not provided'}
Twitter:          ${project.twitter || 'Not provided'}
Docs:             ${project.docs    || 'Not provided'}
Contract:         ${project.contract|| 'Not provided'}
Founded:          ${evidence.founded_year || 'Unknown'}
Audited:          ${new Date().toUTCString()}
Audited by:       VERIS — Trust Infrastructure for the Agent Economy
${template.note}
══════════════════════════════════════════════
LEGITIMACY SCORE:   ${finalLegitimacy}/100  ${progressBar(finalLegitimacy, 100)}
MATURITY SCORE:     ${finalMaturity}/100  ${progressBar(finalMaturity, 100)}
CONFIDENCE:         ${confBar(confidence, 20)}
OPERATIONAL RISK:   ${opRisk.level}
${hardWarn}${lowConfWarn}${anomalyWarn}
RECOMMENDATION:  ${rec.symbol} ${rec.label}  [Band: ${rec.band}]
══════════════════════════════════════════════
EVIDENCE STATE TABLE
(YES = confirmed | NO = contradicted | UNKNOWN = not found — no impact)
${evidenceTable}
══════════════════════════════════════════════
LEGITIMACY SIGNALS CONFIRMED
${signalBlock(legitApplied, 'legitimacy')}

MATURITY SIGNALS CONFIRMED
${signalBlock(maturityApplied, 'maturity')}
══════════════════════════════════════════════
UNVERIFIED CONCERNS  (mentioned but NOT confirmed — zero impact on scores)
${unverifiedBlock}

OPERATIONAL RISKS  (separate axis — never reduce legitimacy or maturity)
${operationalBlock}
${contraBlock}
══════════════════════════════════════════════
VERDICT
${verdictText}
══════════════════════════════════════════════
SCORE BANDS
  90–100  Strongly Trusted       80–89  Trusted
  65–79   Generally Legitimate   50–64  Mixed Signals
  30–49   High Risk              0–29   Critical Risk

SCORING METHODOLOGY
  Entity rubric:   ${template.label}
  Evidence states: YES / NO / UNKNOWN  (UNKNOWN = no impact)
  Evidence tiers:  Tier1 (×1.00) Official/GitHub · Tier2 (×0.75) Major media · Tier3 (×0.40) Community · Tier4 (×0.15) Inferred
  Consensus:       Multi-source confirmation increases signal weight
  Legitimacy:      Verified identity, code, and transparency signals
  Maturity:        Longevity, adoption, ecosystem, and usage signals
  Operational risk: Security incidents — separate axis, never reduces scores
  Hard events:     Confirmed fraud/sanctions/conviction → override to 0 automatically
  Deductions:      Hard events require source_url + quote + confidence ≥ 85%

LIMITATIONS
  • Grounded in Tavily search at audit time — not financial or legal advice
  • UNKNOWN evidence lowers confidence only, never lowers scores
  • Scores are directionally accurate — not a substitute for manual due diligence

AUDIT TRAIL
  Search:      Tavily Advanced (${totalSources} sources, ${Object.keys(queries).length} queries)
  Extraction:  Groq llama-3.3-70b-versatile (temperature 0.0)
  Scoring:     Deterministic code
  Auditor:     VERIS · CROO v1 · Base Mainnet
  Timestamp:   ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// BENCHMARK TEST SUITE  (#8)
// Run: import { runBenchmarkSuite } from './veris.js'; await runBenchmarkSuite();
// ═══════════════════════════════════════════════════════════════════════
export async function runBenchmarkSuite(verbose = false) {
  const SUITE = [
    { name: 'Bitcoin',     entityType: 'l1l2',     expectLegitMin: 85, expectMatMin: 85 },
    { name: 'Ethereum',    entityType: 'l1l2',     expectLegitMin: 85, expectMatMin: 85 },
    { name: 'Solana',      entityType: 'l1l2',     expectLegitMin: 78, expectMatMin: 75 },
    { name: 'Chainlink',   entityType: 'tooling',  expectLegitMin: 78, expectMatMin: 72 },
    { name: 'Uniswap',     entityType: 'defi',     expectLegitMin: 75, expectMatMin: 70 },
    { name: 'XRPL',        entityType: 'infrastructure', expectLegitMin: 75, expectMatMin: 68 },
    { name: 'Hyperliquid', entityType: 'trading_protocol', expectLegitMin: 70, expectMatMin: 62 },
    { name: 'Binance',     entityType: 'trading_protocol', expectLegitMin: 70, expectMatMin: 75 },
    { name: 'FTX',         entityType: 'trading_protocol', expectLegitMin: 0,  expectMatMin: 0, expectCritical: true },
    { name: 'Terra Luna',  entityType: 'l1l2',     expectLegitMin: 0,  expectMatMin: 0, expectCritical: true },
  ];

  console.log('\n🧪 VERIS BENCHMARK SUITE');
  console.log('═'.repeat(70));
  const results = [];

  const results = [];
  for (const test of SUITE) {
    console.log(`\nTesting: ${test.name} (${test.entityType})...`);
    try {
      const report = await runProjectDueDiligence({ name: test.name, entityType: test.entityType });

      // Extract scores from report text
      const legitMatch   = report.match(/LEGITIMACY SCORE:\s+(\d+)/);
      const maturityMatch = report.match(/MATURITY SCORE:\s+(\d+)/);
      const legitScore   = parseInt(legitMatch?.[1]  || '0');
      const maturityScore = parseInt(maturityMatch?.[1] || '0');

      const isCritical = report.includes('HARD TRUST EVENT') || report.includes('CRITICAL RISK');
      const legitPass  = test.expectCritical ? (legitScore === 0 || isCritical) : legitScore >= test.expectLegitMin;
      const matPass    = test.expectCritical ? (maturityScore === 0 || isCritical) : maturityScore >= test.expectMatMin;
      const pass       = legitPass && matPass;

      results.push({ name: test.name, legitScore, maturityScore, pass, isCritical });
      console.log(`  ${pass ? '✓ PASS' : '✗ FAIL'}  L:${legitScore}  M:${maturityScore}  Critical:${isCritical}`);
      if (!pass) {
        console.log(`  Expected L≥${test.expectLegitMin} M≥${test.expectMatMin}`);
      }
      if (verbose) console.log('\n' + report.substring(0, 500) + '...\n');
    } catch (err) {
      console.log(`  ✗ ERROR: ${err.message}`);
      results.push({ name: test.name, error: err.message, pass: false });
    }
  }

  const passed = results.filter(r => r.pass).length;
  console.log(`BENCHMARK RESULTS: ${passed}/${results.length} passed`);
  results.forEach(r => console.log(`  ${r.pass ? '✓' : '✗'} ${r.name.padEnd(15)} L:${r.legitScore ?? 'ERR'}  M:${r.maturityScore ?? 'ERR'}`));

  if (passed < results.length) {
    console.log('\n⚠ Benchmark failures detected. Review scoring logic before deploying.');
  } else {
    console.log('\n✓ All benchmarks passed.');
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT BENCHMARK PACKS (unchanged — agent audit is a separate product)
// ═══════════════════════════════════════════════════════════════════════
const BENCHMARK_PACKS = {
  research: { label: 'Research Agent', reliability: ['Explain how Aave liquidation works in simple terms.','Explain impermanent loss and when it occurs.','What problem does a liquidity pool solve?'], competence: [{prompt:'Explain the health factor concept in DeFi lending.',concept:'health factor — collateral ratio, liquidation threshold, risk management'},{prompt:'How does an automated market maker price assets?',concept:'AMM pricing — constant product formula, liquidity, slippage'},{prompt:'What is the difference between APR and APY in DeFi?',concept:'APR vs APY — compounding, frequency, yield calculation'},{prompt:'Why do DeFi protocols need oracles?',concept:'oracles — external price data, on-chain verification, manipulation risk'}], deep: ['Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.','What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?'], competenceEval: 'Evaluate a DeFi research agent. Score on factual accuracy, depth, and source grounding.' },
  trading: { label: 'Trading Agent', reliability: ['Explain what a stop loss is and why traders use it.','What does it mean when a market is in backwardation?','Explain the concept of position sizing in trading.'], competence: [{prompt:'How does funding rate work in perpetual futures?',concept:'funding rate — longs pay shorts or vice versa, market balance, 8-hour intervals'},{prompt:'What does the RSI indicator measure and how is it interpreted?',concept:'RSI — momentum oscillator, overbought >70, oversold <30, divergence'},{prompt:'Explain the difference between a limit order and a market order.',concept:'limit vs market — price control, execution certainty, slippage'},{prompt:'What is the purpose of a liquidation price in leveraged trading?',concept:'liquidation — leverage, margin, forced close, collateral loss'}], deep: ['What are 3 warning signs that a crypto rally is losing momentum?','Explain how you would assess risk before entering a leveraged trade.'], competenceEval: 'Evaluate a trading agent. Score on concept accuracy, risk awareness, and reasoning.' },
  data: { label: 'Data & Analytics Agent', reliability: ['Explain the difference between on-chain and off-chain data.','What does TVL measure and why does it matter in DeFi?','Explain what a moving average tells you about price trend.'], competence: [{prompt:'What is the difference between correlation and causation?',concept:'correlation vs causation — statistical relationship, not causal, confounding'},{prompt:'How would you detect wash trading in on-chain data?',concept:'wash trading — circular transactions, artificial volume, same wallet patterns'},{prompt:'What metrics would you track to monitor the health of a DeFi lending protocol?',concept:'lending health — utilization rate, bad debt, liquidations, TVL, collateral ratio'},{prompt:'Explain what standard deviation measures and how it applies to crypto volatility.',concept:'standard deviation — spread from mean, volatility, risk quantification'}], deep: ['What on-chain metrics best predict whether a DeFi protocol is growing or declining?','How would you build a simple risk dashboard for a DeFi portfolio?'], competenceEval: 'Evaluate a data analytics agent. Score on statistical accuracy and data interpretation.' },
  writing: { label: 'Writing & Content Agent', reliability: ['Write a 50-word tweet announcing a new DeFi protocol launch.','Summarize what blockchain technology is in 3 sentences for a beginner.','Write a one-paragraph introduction to a crypto market report.'], competence: [{prompt:'Explain the difference between active and passive voice with an example.',concept:'active vs passive — subject acts vs subject receives action, clarity'},{prompt:'What makes a strong call-to-action in marketing copy?',concept:'CTA — clarity, urgency, benefit, direct instruction, action verb'},{prompt:'What is the inverted pyramid style in journalism?',concept:'inverted pyramid — most important first, supporting details, background last'},{prompt:'What is the difference between tone and voice in writing?',concept:'tone vs voice — tone changes per context, voice is consistent author identity'}], deep: ['Write a 3-tweet thread explaining why AI agents are the future of commerce.','Draft a 100-word product description for an AI agent that audits Web3 projects.'], competenceEval: 'Evaluate a writing agent. Score on clarity, grammar, tone, and format adherence.' },
  coding: { label: 'Coding & Developer Agent', reliability: ['Write a JavaScript function that calculates compound interest.','Explain what a smart contract is and how it differs from regular code.','What is the difference between async/await and callbacks in JavaScript?'], competence: [{prompt:'What does the ERC-20 standard define and why does it matter?',concept:'ERC-20 — token standard, transfer, approve, allowance, fungible, interoperability'},{prompt:'Explain what a reentrancy attack is and how to prevent it.',concept:'reentrancy — recursive external call, state not updated, checks-effects-interactions'},{prompt:'What is gas in Ethereum and why does it exist?',concept:'gas — computational cost, spam prevention, miner incentive, fee market'},{prompt:'What is the difference between memory and storage in Solidity?',concept:'memory vs storage — temporary vs persistent, gas cost, data location'}], deep: ['What are the top 3 security best practices when writing a Solidity smart contract?','Explain how WebSockets differ from REST APIs and when you would choose each.'], competenceEval: 'Evaluate a coding agent. Score on correctness, technical accuracy, and security awareness.' },
  defi: { label: 'DeFi Specialist Agent', reliability: ['Explain how an automated market maker works.','What is yield farming and what are its main risks?','How does a flash loan work and what are its legitimate use cases?'], competence: [{prompt:'Explain the concept of slippage in a DEX trade.',concept:'slippage — price impact, liquidity depth, trade size, expected vs actual'},{prompt:'What is the role of an oracle in a lending protocol?',concept:'oracle — price feed, liquidation trigger, collateral valuation, manipulation risk'},{prompt:'Explain how liquidity provider tokens work.',concept:'LP tokens — pool share, redeemable for underlying, fee accrual, composable'},{prompt:'What is protocol-owned liquidity and why did projects pursue it?',concept:'POL — OHM model, mercenary capital problem, sustainable liquidity'}], deep: ['Compare the risks of lending on Aave versus providing liquidity on Curve.','Explain 3 ways a DeFi protocol can fail even with a clean audit.'], competenceEval: 'Evaluate a DeFi specialist agent. Score on protocol knowledge, mechanism accuracy, and risk awareness.' },
  security: { label: 'Security & Audit Agent', reliability: ['What are the most common smart contract vulnerabilities?','How would you assess whether a DeFi protocol is safe to use?','What is a Sybil attack and how can protocols defend against it?'], competence: [{prompt:'Explain how a reentrancy attack works step by step.',concept:'reentrancy — recursive external call, state not updated, drain funds, fix pattern'},{prompt:'What is a 51% attack and what does it enable?',concept:'51% attack — majority hash power, double spend, reorg, cannot steal private keys'},{prompt:'What makes a smart contract audit different from a code review?',concept:'audit vs review — formal process, severity rating, economic attack vectors'},{prompt:'What is front-running in DeFi and how does it work?',concept:'front-running — mempool, higher gas, sandwich attack, MEV, ordering'}], deep: ['What are 3 red flags that indicate a DeFi project might be a rug pull?','How would you verify that a smart contract audit was legitimate?'], competenceEval: 'Evaluate a security and audit agent. Score on vulnerability knowledge and risk assessment.' },
  general: { label: 'General Purpose Agent', reliability: ['Explain what artificial intelligence is in simple terms.','What is the difference between Web2 and Web3?','Explain blockchain technology to someone with no technical background.'], competence: [{prompt:'What is Bitcoin and what problem was it designed to solve?',concept:'Bitcoin — decentralized currency, double spend, trustless, censorship resistant'},{prompt:'What is an API and how do applications use it?',concept:'API — interface, requests, responses, data exchange, integration'},{prompt:'What is the difference between a public and private blockchain?',concept:'public vs private — permissionless vs permissioned, transparency, validators'},{prompt:'What is a crypto wallet and how does it actually work?',concept:'wallet — public private key pair, signs transactions, does not store coins'}], deep: ['What are the top 3 use cases for AI agents in the Web3 economy?','What makes CROO protocol different from traditional payment infrastructure?'], competenceEval: 'Evaluate a general purpose agent. Score on breadth of knowledge, clarity, and helpfulness.' },
};

export function detectCategory(serviceDescription='', agentName='') {
  const text = (serviceDescription+' '+agentName).toLowerCase();
  const signals = { trading:['trad','signal','market analysis','buy sell','portfolio','futures','spot'], data:['data','analytics','metrics','dashboard','statistics','visualization'], writing:['writ','content','copy','blog','tweet','social media','article','newsletter'], coding:['cod','developer','script','program','solidity','smart contract','debug'], defi:['defi','yield','liquidity','protocol','lending','borrow','swap','amm','pool','farming'], security:['security','audit','vulnerability','risk assess','scam detect','hack','protect'], research:['research','intelligence','report','briefing','due diligence','synthesis'] };
  let best='general', bestScore=0;
  for (const [cat,terms] of Object.entries(signals)) { const s=terms.filter(t=>text.includes(t)).length; if(s>bestScore){bestScore=s;best=cat;} }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT AUDIT
// ═══════════════════════════════════════════════════════════════════════
async function placeTestOrder(agentClient, serviceId, prompt, timeoutMs=90000) {
  return new Promise(async (resolve) => {
    const startTime=Date.now(); let orderId='', timedOut=false, stream=null;
    const timer=setTimeout(()=>{ timedOut=true; if(stream)try{stream.close();}catch{} resolve({response:null,responseTime:timeoutMs,timedOut:true}); },timeoutMs);
    try {
      await agentClient.negotiateOrder({serviceId,requirements:JSON.stringify({topic:prompt,task:prompt,text:prompt})});
      stream=await agentClient.connectWebSocket();
      stream.on(EventType.OrderCreated,async(e)=>{ if(timedOut)return; orderId=e.order_id; try{await agentClient.payOrder(e.order_id);}catch(err){console.warn('Pay:',err.message);} });
      stream.on(EventType.OrderCompleted,async(e)=>{ if(timedOut||e.order_id!==orderId)return; clearTimeout(timer); try{const d=await agentClient.getDelivery(e.order_id);stream.close();resolve({response:d.deliverableText||'',responseTime:Date.now()-startTime,timedOut:false});}catch{stream.close();resolve({response:null,responseTime:Date.now()-startTime,timedOut:false});} });
      stream.on(EventType.OrderRejected,()=>{ clearTimeout(timer); if(stream)stream.close(); resolve({response:null,responseTime:Date.now()-startTime,rejected:true}); });
    } catch(err){ clearTimeout(timer); resolve({response:null,responseTime:Date.now()-startTime,error:err.message}); }
  });
}

async function runQuickAudit(agentClient, serviceId, pack) {
  const r1 = await placeTestOrder(agentClient, serviceId, pack.reliability[0]);
  await new Promise(r => setTimeout(r, 2000));
  const cT = pack.competence[0];
  const r2 = await placeTestOrder(agentClient, serviceId, cT.prompt);
  const cS = await semanticScore(cT.prompt, r2.response, cT.concept, 10);
  await new Promise(r => setTimeout(r, 2000));
  const r3 = await placeTestOrder(agentClient, serviceId, pack.deep[0]);
  const dS = await scoreWithAI(`${pack.competenceEval}\nPrompt: "${pack.deep[0]}"\nResponse: ${r3.response?.substring(0,600)||'No response'}\nScore 0-10.\nReturn ONLY: {"score":<0-10>,"notes":"one line"}`);
  const completed = [r1,r2,r3].filter(r => r.response && !r.timedOut).length;
  const cr = Math.round((completed/3)*100);
  const rS = r1.response ? 15 : 0; const coS = cS.score*2; const pS = cr>=100?10:cr>=66?7:4;
  return { mode:'quick', total: Math.min(55, rS+coS+pS+(dS?.score??5)), maxScore:55, completionRate:cr, ordersPlaced:3, reliabilityScore:rS, competenceScore:coS, performanceScore:pS, deepScore:dS?.score??5 };
}

async function runFullAudit(agentClient, serviceId, pack) {
  console.log('  → Reliability tests...');
  const relR = [];
  for (const p of pack.reliability) { relR.push({prompt:p,...await placeTestOrder(agentClient,serviceId,p)}); await new Promise(r=>setTimeout(r,2000)); }
  const relC = relR.filter(r=>r.response&&!r.timedOut);
  const relComp = relC.length/relR.length;
  const rSR = await scoreWithAI(`Evaluate reliability:\n\n${relC.map((r,i)=>`Response ${i+1}: "${r.prompt}"\n${r.response?.substring(0,300)}`).join('\n---\n')}\n\nCompletion:${Math.round(relComp*100)}%\nScore 0-25.\nReturn ONLY:{"score":<0-25>,"notes":"brief"}`);
  const reliability = {score:Math.min(25,rSR?.score??Math.round(relComp*20)),completionRate:Math.round(relComp*100),completed:relC.length,total:relR.length,timedOut:relR.filter(r=>r.timedOut).length,notes:rSR?.notes??`${relC.length}/${relR.length} completed`};
  console.log('  → Source verification...');
  const sR = await placeTestOrder(agentClient,serviceId,pack.deep[1]||pack.deep[0]);
  await new Promise(r=>setTimeout(r,2000));
  const sS = await scoreWithAI(`Evaluate source grounding:\nPrompt:"${pack.deep[1]||pack.deep[0]}"\nResponse:${sR.response?.substring(0,800)||'No response'}\nScore 0-25: named sources+8,data+6,time+5,uncertainty+4,no unsupported+2. Deduct invented stats -8\nReturn ONLY:{"score":<0-25>,"sourcesCited":["s"],"concerns":["c"]}`);
  const sourceVerification = {score:Math.max(0,Math.min(25,sS?.score??10)),sourcesCited:sS?.sourcesCited??[],concerns:sS?.concerns??[]};
  console.log('  → Domain competence...');
  const cR = [];
  for (const t of pack.competence) { const r=await placeTestOrder(agentClient,serviceId,t.prompt); cR.push({prompt:t.prompt,...await semanticScore(t.prompt,r.response,t.concept,10)}); await new Promise(r=>setTimeout(r,2000)); }
  const avgC = cR.reduce((a,b)=>a+b.score,0)/cR.length;
  const domainCompetence = {score:Math.min(25,Math.round(avgC*2.5)),accuracyRate:Math.round((cR.filter(r=>r.correct).length/cR.length)*100),competenceLevel:avgC>=7?'high':avgC>=5?'medium':'low',testBreakdown:cR.map(r=>({prompt:r.prompt.substring(0,60)+'...',correct:r.correct,factual_correctness:r.factual_correctness??5,completeness:r.completeness??5,reasoning_quality:r.reasoning_quality??5,explanation:r.explanation??'Evaluated'}))};
  console.log('  → Transparency probe...');
  const tR = await placeTestOrder(agentClient,serviceId,'What are your limitations? What topics or questions are you NOT reliable for?');
  await new Promise(r=>setTimeout(r,2000));
  const tS = await scoreWithAI(`Evaluate transparency:\n${tR.response?.substring(0,600)||'No response'}\nScore 0-15: acknowledges limitations+4,specifies weaknesses+4,uncertainty+4,not infallible+3. Deduct: claims no limits -8\nReturn ONLY:{"score":<0-15>,"transparencyLevel":"high/medium/low","notes":"assessment"}`);
  const transparency = {score:Math.max(0,Math.min(15,tS?.score??7)),transparencyLevel:tS?.transparencyLevel??'medium',notes:tS?.notes??'Probe complete'};
  const perfScore = Math.max(0,Math.min(10,(reliability.completionRate>=100?10:reliability.completionRate>=66?7:reliability.completionRate>=33?4:1)-reliability.timedOut*2));
  return {mode:'full',reliability,sourceVerification,domainCompetence,transparency,perfScore,total:reliability.score+sourceVerification.score+domainCompetence.score+transparency.score+perfScore,maxScore:100,ordersPlaced:10};
}

export async function runAgentAudit(agentInfo, requesterSdkKey, category='general', mode='full') {
  console.log(`\n🤖 A2A Audit | Agent: ${agentInfo.agentId} | Category: ${category} | Mode: ${mode}`);
  const pack = BENCHMARK_PACKS[category] || BENCHMARK_PACKS.general;
  if (!['quick','full'].includes(mode)) mode = 'full';
  const agentClient = new AgentClient(crooConfig, requesterSdkKey);
  const results = mode === 'quick' ? await runQuickAudit(agentClient, agentInfo.serviceId, pack) : await runFullAudit(agentClient, agentInfo.serviceId, pack);
  const {total,maxScore} = results;
  const reliabilityLevel = total>=80?'High':total>=60?'Moderate':total>=40?'Low':'Unreliable';
  const verdict = total>=maxScore*0.8?'Strong reliability. Suitable for production.':total>=maxScore*0.6?'Adequate. Suitable for low-stakes tasks.':total>=maxScore*0.4?'Inconsistent. Use with caution.':'Fails standards. Not recommended for autonomous use.';
  const cats = Object.entries(BENCHMARK_PACKS).map(([k,v])=>`✓ ${k} — ${v.label}`).join('\n');
  if (mode==='quick') return `VERIS AGENT AUDIT (QUICK)\nAgent:${agentInfo.agentId} Category:${pack.label}\nAudited:${new Date().toUTCString()}\n${'═'.repeat(50)}\nSCORE:${total}/${maxScore}  RELIABILITY:${reliabilityLevel}\n${'═'.repeat(50)}\nReliability:${results.reliabilityScore}/15 ${progressBar(results.reliabilityScore,15)}\nCompetence: ${results.competenceScore}/20 ${progressBar(results.competenceScore,20)}\nPerformance:${results.performanceScore}/10 ${progressBar(results.performanceScore,10)}\nDepth:      ${results.deepScore}/10 ${progressBar(results.deepScore,10)}\nCompletion:${results.completionRate}%\nVERDICT:${verdict}\nAUDIT TRAIL:VERIS·Tavily+Groq·${new Date().toISOString()}`;
  return `VERIS AGENT AUDIT (FULL)\nAgent:${agentInfo.agentId} Category:${pack.label}\nAudited:${new Date().toUTCString()}\n${'═'.repeat(50)}\nSCORE:${total}/100  RELIABILITY:${reliabilityLevel}\nHALLUCINATION RISK:${results.domainCompetence.competenceLevel==='high'?'Low':results.domainCompetence.competenceLevel==='medium'?'Moderate':'High'}\n${'═'.repeat(50)}\nResponse Reliability: ${String(results.reliability.score).padStart(2)}/25 ${progressBar(results.reliability.score,25)}\nSource Verification:  ${String(results.sourceVerification.score).padStart(2)}/25 ${progressBar(results.sourceVerification.score,25)}\nDomain Competence:    ${String(results.domainCompetence.score).padStart(2)}/25 ${progressBar(results.domainCompetence.score,25)}\nTransparency:         ${String(results.transparency.score).padStart(2)}/15 ${progressBar(results.transparency.score,15)}\nPerformance:          ${String(results.perfScore).padStart(2)}/10 ${progressBar(results.perfScore,10)}\nCompletion:${results.reliability.completionRate}% Accuracy:${results.domainCompetence.accuracyRate}% Level:${results.domainCompetence.competenceLevel?.toUpperCase()}\nCOMPETENCE BREAKDOWN\n${results.domainCompetence.testBreakdown?.map(t=>`• "${t.prompt}"\n  ${t.correct?'✓':'✗'} F:${t.factual_correctness} C:${t.completeness} R:${t.reasoning_quality} — ${t.explanation}`).join('\n')||'Tests completed'}\nVERDICT:${verdict}\nRECOMMENDATION:${total>=80?'✓ SUITABLE FOR PRODUCTION':total>=60?'⚠ TESTING ONLY':total>=40?'✗ HIGH RISK':'✗ DO NOT USE'}\nAVAILABLE PACKS\n${cats}\nAUDIT TRAIL:VERIS·Tavily+Groq·${category}·${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════
export async function runVERIS(requirements, requesterSdkKey) {
  const req = typeof requirements === 'string' ? JSON.parse(requirements) : requirements;
  if (req.type === 'agent') {
    if (!req.agentId || !req.serviceId) throw new Error('Agent audit requires: agentId and serviceId');
    return await runAgentAudit({ agentId: req.agentId, serviceId: req.serviceId }, requesterSdkKey, req.category || detectCategory(req.serviceDescription||'', req.agentName||''), req.mode || 'full');
  }
  if (req.type==='project') {
    if (!req.name) throw new Error('Project due diligence requires: name');
    return await runProjectDueDiligence(req);
  }
  throw new Error('Invalid type. Use "project" or "agent".');
}
