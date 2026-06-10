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
// TIER CLASSIFIER  (#2)
// Pattern-based. No AI. Runs on every source URL before scoring.
// ═══════════════════════════════════════════════════════════════════════

// Known official domains per project name → Tier 1
const OFFICIAL_DOMAINS = {
  bitcoin:      ['bitcoin.org', 'bitcoincore.org', 'github.com/bitcoin'],
  ethereum:     ['ethereum.org', 'ethresear.ch', 'eips.ethereum.org', 'github.com/ethereum'],
  solana:       ['solana.com', 'docs.solana.com', 'github.com/solana-labs'],
  chainlink:    ['chain.link', 'docs.chain.link', 'github.com/smartcontractkit'],
  uniswap:      ['uniswap.org', 'docs.uniswap.org', 'github.com/uniswap'],
  xrpl:         ['xrpl.org', 'ripple.com', 'github.com/xrplf', 'github.com/ripple'],
  xrp:          ['xrpl.org', 'ripple.com', 'github.com/xrplf'],
  hyperliquid:  ['hyperliquid.xyz', 'app.hyperliquid.xyz', 'github.com/hyperliquid-dex'],
  aave:         ['aave.com', 'docs.aave.com', 'github.com/aave'],
  cosmos:       ['cosmos.network', 'docs.cosmos.network', 'github.com/cosmos'],
  polkadot:     ['polkadot.network', 'wiki.polkadot.network', 'github.com/paritytech'],
  avalanche:    ['avax.network', 'docs.avax.network', 'github.com/ava-labs'],
};

const TIER2_PATTERNS = [
  'coindesk.com', 'theblock.co', 'messari.io', 'cointelegraph.com',
  'decrypt.co', 'bloomberg.com', 'reuters.com', 'ft.com', 'wsj.com',
  'forbes.com', 'techcrunch.com', 'wired.com', 'defillama.com',
  'coingecko.com', 'coinmarketcap.com', 'etherscan.io', 'bscscan.com',
  'dune.com', 'dune.xyz', 'nansen.ai', 'glassnode.com',
  'certik.com', 'trailofbits.com', 'openzeppelin.com', 'halborn.com',
  'consensys.io', 'immunefi.com', 'linkedin.com',
];

const TIER3_PATTERNS = [
  'reddit.com', 'discord.com', 'discord.gg', 't.me', 'telegram.org',
  'twitter.com', 'x.com', 'medium.com', 'mirror.xyz', 'substack.com',
  'bitcointalk.org', 'gov.uniswap.org', 'forum.',
];

/**
 * Classify a source URL into a tier.
 * @param {string} url
 * @param {string} projectName  - used to check official domains
 * @returns {'tier1'|'tier2'|'tier3'|'tier4'}
 */
function classifySourceTier(url = '', projectName = '') {
  if (!url) return 'tier4';
  const u = url.toLowerCase();

  // Always Tier 1: GitHub repositories, official docs patterns
  if (u.includes('github.com')) return 'tier1';
  if (u.match(/\/docs\.|\/whitepaper|\.pdf$|\/wiki\b/)) return 'tier1';
  if (u.match(/certik\.com|trailofbits|openzeppelin\.com|halborn\.com|immunefi\.com/)) return 'tier1';

  // Project-specific official domains → Tier 1
  const key = projectName.toLowerCase().split(' ')[0];
  const officialList = OFFICIAL_DOMAINS[key] || [];
  if (officialList.some(domain => u.includes(domain))) return 'tier1';

  // Generic official signals: docs subdomain, project name in domain
  if (u.match(/^https?:\/\/docs\./)) return 'tier1';
  if (u.match(/^https?:\/\/[a-z-]+\.org\//) && !u.includes('reddit') && !u.includes('forum')) return 'tier1';

  // Tier 2: major media, explorers, analytics, audit firms
  if (TIER2_PATTERNS.some(p => u.includes(p))) return 'tier2';

  // Tier 3: community, social, blogs
  if (TIER3_PATTERNS.some(p => u.includes(p))) return 'tier3';

  // Default: unknown = Tier 4
  return 'tier4';
}

const TIER_WEIGHTS = { tier1: 1.00, tier2: 0.75, tier3: 0.40, tier4: 0.15 };

// ═══════════════════════════════════════════════════════════════════════
// ENTITY TEMPLATES  (#3 #5)
// Fixed-point rubrics — no normalization.
// Legitimacy max = 50, Maturity max = 50, total cap = 100.
// Points are assigned directly. No division afterward.
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_TEMPLATES = {

  l1l2: {
    label: 'L1/L2 Blockchain',
    signals: ['bitcoin', 'ethereum', 'solana', 'avalanche', 'bsc', 'polygon', 'optimism',
              'arbitrum', 'base network', 'zksync', 'starknet', 'tron', 'litecoin', 'monero'],
    note: 'L1/L2 rubric: open source codebase and ecosystem adoption are primary legitimacy signals. No startup team page expected.',
    // Legitimacy signals — max 50 pts
    legitimacy: {
      open_source:          10,
      active_github:         8,
      whitepaper:            8,
      audit_found:           8,
      verifiable_history:    8,
      technical_docs:        5,
      media_coverage:        3,
    },
    // Maturity signals — max 50 pts
    maturity: {
      longevity_10y:        15,
      longevity_5y:          0,  // exclusive with 10y — code picks one
      longevity_2y:          0,  // exclusive with 5y
      top10_chain:          10,
      major_exchange_listed: 7,
      institutional_adoption:7,
      developer_ecosystem:   6,
      large_community:       5,
    },
  },

  infrastructure: {
    label: 'Infrastructure Protocol',
    signals: ['foundation', 'layer', 'network', 'ledger', 'mainnet', 'consensus',
              'validator', 'node', 'xrpl', 'ripple', 'cosmos', 'polkadot', 'near', 'cardano'],
    note: 'Infrastructure rubric: active open source development is the primary legitimacy signal. Distributed governance means no startup team page.',
    legitimacy: {
      open_source:          10,
      active_github:        10,
      whitepaper:            8,
      technical_docs:        8,
      audit_found:           6,
      verifiable_history:    5,
      media_coverage:        3,
    },
    maturity: {
      longevity_10y:        12,
      longevity_5y:          0,
      longevity_2y:          0,
      developer_ecosystem:  10,
      major_exchange_listed: 8,
      institutional_adoption:8,
      multiple_contributors: 6,
      sdks_found:            4,
      large_community:       4,
      on_chain_governance:   4,
      grants_hackathons:     4,
    },
  },

  defi: {
    label: 'DeFi Protocol',
    signals: ['defi', 'yield', 'lending', 'borrow', 'swap', 'amm', 'liquidity pool',
              'vault', 'liquid staking', 'dex'],
    note: 'DeFi rubric: security audit is the single most critical legitimacy signal. Missing audits on financial protocols are a serious gap.',
    legitimacy: {
      audit_found:          15,
      open_source:          10,
      founders_named:        8,
      active_github:         7,
      whitepaper:            6,
      tokenomics:            4,
    },
    maturity: {
      longevity_5y:         10,
      longevity_2y:          0,
      tvl_mentioned:        12,
      multiple_audits:       8,
      bug_bounty:            6,
      major_exchange_listed: 5,
      institutional_adoption:5,
      large_community:       4,
    },
  },

  trading_protocol: {
    label: 'Trading Protocol / Exchange',
    signals: ['exchange', 'trading', 'derivatives', 'perpetuals', 'order book',
              'hyperliquid', 'hyper', 'dydx', 'gmx', 'drift', 'vertex', 'perp exchange'],
    note: 'Trading protocol rubric: audit status and team transparency are critical. Trading volume signals real usage.',
    legitimacy: {
      audit_found:          14,
      founders_named:       10,
      open_source:           8,
      verifiable_history:    7,
      active_github:         6,
      technical_docs:        5,
    },
    maturity: {
      tvl_mentioned:        12,
      trading_volume_mentioned: 10,
      longevity_5y:          8,
      longevity_2y:          0,
      multiple_audits:       7,
      bug_bounty:            5,
      institutional_adoption:6,
      large_community:       4,
    },
  },

  aiagent: {
    label: 'AI Agent / Product',
    signals: ['ai agent', 'autonomous agent', 'llm', 'gpt', 'copilot', 'assistant',
              'autopilot', 'croo', 'veris', 'ai-powered'],
    note: 'AI agent rubric: live working product is the primary legitimacy signal. Creator identity matters.',
    legitimacy: {
      live_product:         15,
      founders_named:       10,
      linkedin_found:        8,
      verifiable_history:    7,
      clear_use_case:        6,
      technical_docs:        4,
    },
    maturity: {
      user_reviews:         10,
      api_usage:             9,
      features_described:    7,
      active_github:         6,
      media_coverage:        6,
      active_community:      5,
      audit_found:           5,
      longevity_2y:          4,
    },
  },

  memecoin: {
    label: 'Meme Coin / Token',
    signals: ['meme', 'doge', 'shib', 'pepe', 'inu', 'elon', 'moon',
              'fair launch', 'stealth launch', 'meme coin'],
    note: 'Meme coin rubric: liquidity transparency and audit are primary legitimacy signals. Very limited legitimacy signals expected by nature.',
    legitimacy: {
      liquidity_locked:     15,
      audit_found:          12,
      tokenomics:            8,
      founders_named:        8,
      open_source:           4,
      clear_use_case:        3,
    },
    maturity: {
      large_community:      14,
      active_community:      9,
      trading_volume_mentioned: 9,
      genuine_engagement:    8,
      major_exchange_listed: 8,
      media_coverage:        4,
    },
  },

  dao: {
    label: 'DAO / Governance Protocol',
    signals: ['dao', 'governance', 'vote', 'proposal', 'treasury', 'multisig', 'snapshot'],
    note: 'DAO rubric: on-chain governance and treasury transparency are primary legitimacy signals.',
    legitimacy: {
      on_chain_governance:  16,
      treasury_transparency:12,
      multisig_confirmed:    9,
      open_source:           8,
      whitepaper:            5,
    },
    maturity: {
      active_proposals:     14,
      longevity_5y:          8,
      longevity_2y:          0,
      large_community:       8,
      active_community:      6,
      technical_docs:        5,
      active_github:         4,
      grants_hackathons:     5,
    },
  },

  startup: {
    label: 'Startup / Early Stage',
    signals: ['startup', 'seed', 'series a', 'backed by', 'venture', 'incubator', 'beta'],
    note: 'Startup rubric: founder identity and team transparency are the primary legitimacy signals.',
    legitimacy: {
      founders_named:       14,
      linkedin_found:        9,
      verifiable_history:    8,
      team_page:             5,
      clear_use_case:        5,
      whitepaper:            4,
      live_product:          5,
    },
    maturity: {
      user_reviews:         10,
      media_coverage:        8,
      active_github:         7,
      audit_found:           6,
      active_community:      5,
      roadmap:               5,
      funding_confirmed:     6,
      longevity_2y:          4,
    },
  },

  tooling: {
    label: 'Tooling / Developer Infrastructure',
    signals: ['sdk', 'rpc', 'indexer', 'explorer', 'bridge', 'oracle',
              'developer tool', 'infrastructure tool', 'chainlink', 'wallet sdk'],
    note: 'Tooling rubric: active open source codebase is the primary legitimacy signal.',
    legitimacy: {
      active_github:        13,
      open_source:          10,
      technical_docs:        9,
      audit_found:           8,
      founders_named:        6,
      clear_use_case:        4,
    },
    maturity: {
      sdks_found:           10,
      api_usage:             9,
      high_github_stars:     8,
      multiple_contributors: 7,
      developer_ecosystem:   7,
      institutional_adoption:6,
      live_product:          5,
      regular_releases:      5,
      longevity_2y:          4,
      media_coverage:        3,
    },
  },

  general: {
    label: 'General Project',
    signals: [],
    note: 'General rubric. Specify entity type for more accurate scoring.',
    legitimacy: {
      founders_named:        8,
      active_github:         7,
      whitepaper:            7,
      audit_found:           7,
      open_source:           6,
      clear_use_case:        5,
      technical_docs:        5,
      live_product:          5,
    },
    maturity: {
      large_community:       8,
      media_coverage:        6,
      major_exchange_listed: 6,
      longevity_2y:          5,
      active_community:      5,
      institutional_adoption:5,
      trading_volume_mentioned: 5,
      user_reviews:          5,
    },
  },
};

export function detectEntityType(project) {
  const text = [project.name, project.description, project.website, project.entityType]
    .filter(Boolean).join(' ').toLowerCase();
  const matches = Object.entries(ENTITY_TEMPLATES)
    .filter(([k]) => k !== 'general')
    .map(([type, cfg]) => ({ type, score: cfg.signals.filter(s => text.includes(s)).length }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);
  return matches[0]?.type || 'general';
}

// ═══════════════════════════════════════════════════════════════════════
// HARD TRUST EVENTS  — override everything if verified
// ═══════════════════════════════════════════════════════════════════════
const HARD_TRUST_EVENTS = [
  { key: 'confirmed_rug_pull',     label: 'Confirmed rug pull' },
  { key: 'confirmed_fraud',        label: 'Confirmed fraud' },
  { key: 'confirmed_scam',         label: 'Confirmed scam' },
  { key: 'sec_enforcement',        label: 'SEC/CFTC enforcement action' },
  { key: 'sanctions',              label: 'Government sanctions (OFAC)' },
  { key: 'criminal_conviction',    label: 'Criminal conviction of founders' },
];

// ═══════════════════════════════════════════════════════════════════════
// EVIDENCE EXTRACTION
// Groq reads sources → returns YES / NO / UNKNOWN per signal.
// Also returns source_urls per signal for citation display (#8).
// Temperature 0.0 — no creativity, no inference.
// ═══════════════════════════════════════════════════════════════════════
async function extractEvidence(combinedText, projectName, entityLabel) {
  const prompt =
    `You are a structured fact extraction engine for "${projectName}" (${entityLabel}).\n\n` +
    `SOURCES:\n${combinedText.substring(0, 9000)}\n\n` +
    `RULES — READ CAREFULLY:\n` +
    `1. Each field = "YES", "NO", or "UNKNOWN". Default is UNKNOWN.\n` +
    `   YES   = a source explicitly states this is true\n` +
    `   NO    = a source explicitly states this is false or absent\n` +
    `   UNKNOWN = not mentioned, ambiguous, or insufficient evidence\n` +
    `2. NEVER set YES because something is implied or likely.\n` +
    `3. NEVER set NO because something wasn't mentioned. Absence = UNKNOWN.\n` +
    `4. For source_urls fields: list exact URLs from sources that support the YES/NO claim.\n` +
    `   If the signal is UNKNOWN, source_urls must be [].\n` +
    `5. Hard trust events (fraud, scam, rug pull, sec_enforcement, sanctions, criminal_conviction):\n` +
    `   must have at least one source_url with a direct quote in evidence_citations.\n` +
    `   Without that, set the field to UNKNOWN.\n` +
    `6. confidence_per_signal: estimate 0-100 how confident you are, based on source quality and clarity.\n\n` +
    `Return ONLY valid JSON — no markdown, no backticks:\n` +
    `{\n` +
    `  "whitepaper": "UNKNOWN", "whitepaper_urls": [],\n` +
    `  "roadmap": "UNKNOWN", "roadmap_urls": [],\n` +
    `  "tokenomics": "UNKNOWN", "tokenomics_urls": [],\n` +
    `  "technical_docs": "UNKNOWN", "technical_docs_urls": [],\n` +
    `  "clear_use_case": "UNKNOWN", "clear_use_case_urls": [],\n` +
    `  "active_github": "UNKNOWN", "active_github_urls": [],\n` +
    `  "high_github_stars": "UNKNOWN", "high_github_stars_urls": [],\n` +
    `  "multiple_contributors": "UNKNOWN", "multiple_contributors_urls": [],\n` +
    `  "open_source": "UNKNOWN", "open_source_urls": [],\n` +
    `  "audit_found": "UNKNOWN", "audit_found_urls": [],\n` +
    `  "multiple_audits": "UNKNOWN", "multiple_audits_urls": [],\n` +
    `  "audit_firm": null,\n` +
    `  "bug_bounty": "UNKNOWN", "bug_bounty_urls": [],\n` +
    `  "regular_releases": "UNKNOWN", "regular_releases_urls": [],\n` +
    `  "recent_commits": "UNKNOWN", "recent_commits_urls": [],\n` +
    `  "founders_named": "UNKNOWN", "founders_named_urls": [],\n` +
    `  "founder_names": [],\n` +
    `  "linkedin_found": "UNKNOWN", "linkedin_found_urls": [],\n` +
    `  "team_page": "UNKNOWN", "team_page_urls": [],\n` +
    `  "verifiable_history": "UNKNOWN", "verifiable_history_urls": [],\n` +
    `  "active_social": "UNKNOWN", "active_social_urls": [],\n` +
    `  "large_community": "UNKNOWN", "large_community_urls": [],\n` +
    `  "active_community": "UNKNOWN", "active_community_urls": [],\n` +
    `  "genuine_engagement": "UNKNOWN", "genuine_engagement_urls": [],\n` +
    `  "media_coverage": "UNKNOWN", "media_coverage_urls": [],\n` +
    `  "live_product": "UNKNOWN", "live_product_urls": [],\n` +
    `  "features_described": "UNKNOWN", "features_described_urls": [],\n` +
    `  "user_reviews": "UNKNOWN", "user_reviews_urls": [],\n` +
    `  "api_usage": "UNKNOWN", "api_usage_urls": [],\n` +
    `  "sdks_found": "UNKNOWN", "sdks_found_urls": [],\n` +
    `  "liquidity_locked": "UNKNOWN", "liquidity_locked_urls": [],\n` +
    `  "trading_volume_mentioned": "UNKNOWN", "trading_volume_mentioned_urls": [],\n` +
    `  "tvl_mentioned": "UNKNOWN", "tvl_mentioned_urls": [],\n` +
    `  "major_exchange_listed": "UNKNOWN", "major_exchange_listed_urls": [],\n` +
    `  "top10_chain": "UNKNOWN", "top10_chain_urls": [],\n` +
    `  "institutional_adoption": "UNKNOWN", "institutional_adoption_urls": [],\n` +
    `  "developer_ecosystem": "UNKNOWN", "developer_ecosystem_urls": [],\n` +
    `  "grants_hackathons": "UNKNOWN", "grants_hackathons_urls": [],\n` +
    `  "on_chain_governance": "UNKNOWN", "on_chain_governance_urls": [],\n` +
    `  "active_proposals": "UNKNOWN", "active_proposals_urls": [],\n` +
    `  "treasury_transparency": "UNKNOWN", "treasury_transparency_urls": [],\n` +
    `  "multisig_confirmed": "UNKNOWN", "multisig_confirmed_urls": [],\n` +
    `  "funding_confirmed": "UNKNOWN", "funding_confirmed_urls": [],\n` +
    `  "sdks_found": "UNKNOWN", "sdks_found_urls": [],\n` +
    `  "founded_year": null,\n` +
    `  "confirmed_rug_pull": "UNKNOWN", "confirmed_fraud": "UNKNOWN",\n` +
    `  "confirmed_scam": "UNKNOWN", "sec_enforcement": "UNKNOWN",\n` +
    `  "sanctions": "UNKNOWN", "criminal_conviction": "UNKNOWN",\n` +
    `  "confirmed_hack": "UNKNOWN", "confirmed_exploit": "UNKNOWN",\n` +
    `  "confirmed_vulnerability": "UNKNOWN",\n` +
    `  "contradictions": [],\n` +
    `  "confidence_per_signal": {},\n` +
    `  "evidence_citations": []\n` +
    `}\n\n` +
    `evidence_citations schema (required for any hard trust event marked YES):\n` +
    `[{"claim":"field_name","source_url":"https://...","quote":"exact verbatim text","confidence":0.0-1.0}]`;

  const response = await groqExtract(prompt);
  try {
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch {
    console.warn('  ⚠ Evidence parse failed — neutral baseline');
    return buildBaselineEvidence();
  }
}

function buildBaselineEvidence() {
  const bools = ['whitepaper','roadmap','tokenomics','technical_docs','clear_use_case','active_github','high_github_stars','multiple_contributors','open_source','audit_found','multiple_audits','bug_bounty','regular_releases','recent_commits','founders_named','linkedin_found','team_page','verifiable_history','active_social','large_community','active_community','genuine_engagement','media_coverage','live_product','features_described','user_reviews','api_usage','sdks_found','liquidity_locked','trading_volume_mentioned','tvl_mentioned','major_exchange_listed','top10_chain','institutional_adoption','developer_ecosystem','grants_hackathons','on_chain_governance','active_proposals','treasury_transparency','multisig_confirmed','funding_confirmed','confirmed_rug_pull','confirmed_fraud','confirmed_scam','sec_enforcement','sanctions','criminal_conviction','confirmed_hack','confirmed_exploit','confirmed_vulnerability'];
  const ev = {};
  bools.forEach(k => { ev[k] = 'UNKNOWN'; ev[`${k}_urls`] = []; });
  ev.founder_names = []; ev.audit_firm = null; ev.founded_year = null;
  ev.contradictions = []; ev.confidence_per_signal = {}; ev.evidence_citations = [];
  return ev;
}

// ═══════════════════════════════════════════════════════════════════════
// LONGEVITY — derived from founded_year, not AI
// ═══════════════════════════════════════════════════════════════════════
function longevityFlags(evidence) {
  const year = parseInt(evidence.founded_year);
  if (!year || year < 2008 || year > new Date().getFullYear()) {
    return { longevity_10y: 'UNKNOWN', longevity_5y: 'UNKNOWN', longevity_2y: 'UNKNOWN' };
  }
  const age = new Date().getFullYear() - year;
  return {
    longevity_10y: age >= 10 ? 'YES' : 'NO',
    longevity_5y:  age >= 5  ? 'YES' : 'NO',
    longevity_2y:  age >= 2  ? 'YES' : 'NO',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SCORING ENGINE  (#3 — direct points, no normalization)
// Each signal: YES → look up source URLs → classify tier → apply weight.
// UNKNOWN → 0 pts, no penalty. NO → 0 pts, no penalty.
// ═══════════════════════════════════════════════════════════════════════
function scoreSignals(signalMap, evidence, projectName, maxBucket) {
  const lFlags = longevityFlags(evidence);
  const ev = { ...evidence, ...lFlags };
  const applied = [];
  let total = 0;

  // Longevity is exclusive — only highest tier fires
  const longevityApplied = (() => {
    if (signalMap.longevity_10y && ev.longevity_10y === 'YES') return '10y';
    if (signalMap.longevity_5y  && ev.longevity_5y  === 'YES') return '5y';
    if (signalMap.longevity_2y  && ev.longevity_2y  === 'YES') return '2y';
    return null;
  })();

  for (const [key, basePoints] of Object.entries(signalMap)) {
    if (basePoints === 0) continue;

    // Longevity exclusivity
    if (['longevity_10y','longevity_5y','longevity_2y'].includes(key)) {
      const expected = key.replace('longevity_','');
      if (longevityApplied !== expected) continue;
    }

    const state = ev[key] || 'UNKNOWN';
    if (state !== 'YES') continue;

    // Tier classification: use signal's source URLs
    const urls = (ev[`${key}_urls`] || []);
    const tiers = urls.length > 0
      ? urls.map(u => classifySourceTier(u, projectName))
      : ['tier4'];  // no URL → tier4 (inferred)
    const bestTier = ['tier1','tier2','tier3','tier4'].find(t => tiers.includes(t)) || 'tier4';

    // Consensus multiplier: more independent sources = higher weight
    const uniqueTier1or2 = urls.filter(u => ['tier1','tier2'].includes(classifySourceTier(u, projectName))).length;
    const consensus = uniqueTier1or2 >= 2 ? 1.15 : uniqueTier1or2 === 1 ? 1.00 : urls.length >= 2 ? 0.90 : 0.75;

    const tierWeight = TIER_WEIGHTS[bestTier];
    const weightedPts = Math.round(basePoints * tierWeight * consensus);
    const confidence = evidence.confidence_per_signal?.[key] ?? (bestTier === 'tier1' ? 90 : bestTier === 'tier2' ? 70 : bestTier === 'tier3' ? 45 : 20);

    total += weightedPts;
    applied.push({
      key,
      label: SIGNAL_LABELS[key] || key,
      basePoints,
      weightedPoints: weightedPts,
      tier: bestTier,
      urls,
      confidence,
    });
  }

  // Cap at maxBucket — no normalization
  return { total: Math.min(maxBucket, total), applied };
}

const SIGNAL_LABELS = {
  open_source:'Open source confirmed', active_github:'Active GitHub', high_github_stars:'High GitHub stars',
  multiple_contributors:'Multiple contributors', audit_found:'Security audit found', multiple_audits:'Multiple security audits',
  audit_firm:'Audit firm named', bug_bounty:'Bug bounty active', regular_releases:'Regular release cadence',
  recent_commits:'Recent commits confirmed', whitepaper:'Whitepaper found', technical_docs:'Technical documentation',
  roadmap:'Roadmap confirmed', tokenomics:'Tokenomics documented', clear_use_case:'Clear use case articulated',
  founders_named:'Founders publicly named', linkedin_found:'LinkedIn profiles confirmed', team_page:'Team page found',
  verifiable_history:'Verifiable track record', active_social:'Active social accounts', large_community:'Large community',
  active_community:'Active community', genuine_engagement:'Genuine engagement', media_coverage:'Media coverage confirmed',
  live_product:'Live product confirmed', features_described:'Features described', user_reviews:'User reviews found',
  api_usage:'API/integration usage', sdks_found:'SDKs available', liquidity_locked:'Liquidity locked',
  trading_volume_mentioned:'Trading volume data', tvl_mentioned:'TVL data found', major_exchange_listed:'Major exchange listing',
  top10_chain:'Top-10 chain confirmed', institutional_adoption:'Institutional adoption', developer_ecosystem:'Developer ecosystem',
  grants_hackathons:'Grants/hackathons found', on_chain_governance:'On-chain governance', active_proposals:'Active proposals',
  treasury_transparency:'Treasury transparency', multisig_confirmed:'Multisig confirmed', funding_confirmed:'Funding confirmed',
  longevity_10y:'Active 10+ years', longevity_5y:'Active 5+ years', longevity_2y:'Active 2+ years',
};

// ═══════════════════════════════════════════════════════════════════════
// HARD EVENT VALIDATION
// ═══════════════════════════════════════════════════════════════════════
function validateHardEvent(key, evidence) {
  if (evidence[key] !== 'YES') return false;
  const cit = (evidence.evidence_citations || []).find(c => c.claim === key);
  if (!cit) return false;
  return cit.source_url?.startsWith('http') && cit.quote?.length >= 25 && (cit.confidence || 0) >= 0.85;
}

function checkHardEvents(evidence) {
  const confirmed = [], unverified = [];
  for (const ev of HARD_TRUST_EVENTS) {
    if (evidence[ev.key] !== 'YES') continue;
    const cit = (evidence.evidence_citations || []).find(c => c.claim === ev.key);
    if (validateHardEvent(ev.key, evidence)) {
      confirmed.push({ ...ev, citation: cit });
    } else {
      unverified.push({ label: ev.label, note: 'Mentioned in sources — insufficient citation for confirmed deduction.', citation: cit || null });
    }
  }
  return { confirmed, unverified };
}

function checkOperationalRisk(evidence) {
  const OPS = [
    { key: 'confirmed_hack',          label: 'Confirmed hack or breach' },
    { key: 'confirmed_exploit',       label: 'Confirmed smart contract exploit' },
    { key: 'confirmed_vulnerability', label: 'Confirmed vulnerability disclosure' },
  ];
  const confirmed = [], unverified = [];
  for (const op of OPS) {
    if (evidence[op.key] !== 'YES') continue;
    const cit = (evidence.evidence_citations || []).find(c => c.claim === op.key);
    if (validateHardEvent(op.key, evidence)) {
      confirmed.push({ ...op, citation: cit });
    } else {
      unverified.push({ label: op.label, note: 'Incident mentioned but not sufficiently sourced.' });
    }
  }
  const level = confirmed.length === 0 ? 'Low' : confirmed.length === 1 ? 'Medium' : 'High';
  return { confirmed, unverified, level };
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIDENCE — signal-coverage based, not source-count based
// ═══════════════════════════════════════════════════════════════════════
function computeConfidence(evidence, template, allSources) {
  const allSignals = { ...template.legitimacy, ...template.maturity };
  const lFlags = longevityFlags(evidence);
  const ev = { ...evidence, ...lFlags };

  let yesCount = 0, unknownCount = 0, totalSignals = 0;
  let tier1or2Sources = 0;

  for (const key of Object.keys(allSignals)) {
    totalSignals++;
    const state = ev[key] || 'UNKNOWN';
    if (state === 'YES') yesCount++;
    else if (state === 'UNKNOWN') unknownCount++;
  }

  // Source authority
  for (const src of allSources) {
    const t = classifySourceTier(src.url || '', '');
    if (t === 'tier1' || t === 'tier2') tier1or2Sources++;
  }
  const authority = allSources.length === 0 ? 0.05 : Math.min(1, tier1or2Sources / Math.max(1, allSources.length));

  // Coverage: fraction of signals that resolved to YES or NO (not UNKNOWN)
  const resolved = totalSignals - unknownCount;
  const coverage = totalSignals > 0 ? resolved / totalSignals : 0;

  // Contradiction penalty
  const contraFactor = Math.max(0.60, 1 - (evidence.contradictions?.length || 0) * 0.10);

  const raw = (authority * 0.40 + coverage * 0.60) * contraFactor;
  return Math.min(0.98, Math.max(0.05, raw));
}

// ═══════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE  (#6 — fully deterministic)
// ═══════════════════════════════════════════════════════════════════════
function getRecommendation(legitimacyScore, hardEventsConfirmed) {
  // Hard events override everything
  if (hardEventsConfirmed.length > 0) {
    return { label: 'CRITICAL RISK', symbol: '⛔', band: '0-29' };
  }
  if (legitimacyScore >= 90) return { label: 'STRONGLY TRUSTED',    symbol: '✓✓', band: '90-100' };
  if (legitimacyScore >= 80) return { label: 'TRUSTED',              symbol: '✓',  band: '80-89'  };
  if (legitimacyScore >= 65) return { label: 'GENERALLY LEGITIMATE', symbol: '~✓', band: '65-79'  };
  if (legitimacyScore >= 50) return { label: 'MIXED SIGNALS',        symbol: '~',  band: '50-64'  };
  if (legitimacyScore >= 30) return { label: 'HIGH RISK',            symbol: '✗',  band: '30-49'  };
  return { label: 'CRITICAL RISK', symbol: '⛔', band: '0-29' };
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════
async function collectEvidence(query, projectName = '') {
  try {
    const res = await tavilyClient.search(query, { searchDepth: 'advanced', maxResults: 5, includeAnswer: false });
    if (!res.results?.length) return { text: '', sourceCount: 0, sources: [] };
    const sources = res.results.map(r => ({
      title: r.title,
      url: r.url,
      tier: classifySourceTier(r.url, projectName),
      snippet: r.content?.substring(0, 500) || '',
    }));
    const text = sources.map((s, i) =>
      `[Source ${i+1} | ${s.tier.toUpperCase()} | ${s.url}]\n${s.title}\n${s.snippet}`
    ).join('\n\n---\n\n');
    return { text, sourceCount: sources.length, sources };
  } catch (err) {
    console.warn('  ⚠ Tavily error:', err.message);
    return { text: '', sourceCount: 0, sources: [] };
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
    messages: [
      { role: 'system', content: 'You are a structured data extraction engine. Return ONLY valid JSON. No markdown, no backticks, no explanation.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 3000, temperature: 0.0,
  });
  return c.choices[0].message.content;
}

async function groqSynthesize(prompt, systemMsg = 'You are a factual research assistant. Be specific and concise.') {
  const c = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
    max_tokens: 800, temperature: 0.2,
  });
  return c.choices[0].message.content;
}

async function scoreWithAI(prompt) {
  const r = await groqSynthesize(prompt, 'Return ONLY valid JSON. No markdown, no backticks, no preamble.');
  try { return JSON.parse(r.replace(/```json|```/g, '').trim()); } catch { return null; }
}

async function semanticScore(prompt, response, concept, maxScore = 10) {
  if (!response) return { score: 0, correct: false, factual_correctness: 0, completeness: 0, reasoning_quality: 0, explanation: 'No response received' };
  const result = await scoreWithAI(
    `Evaluate agent response.\nQuestion: "${prompt}"\nKey concepts: ${concept}\nResponse: ${response.substring(0, 600)}\n` +
    `Score 0-${maxScore}. Paraphrased correct = same as verbatim. Deduct only for factual errors.\n` +
    `Return ONLY: {"score":<0-${maxScore}>,"factual_correctness":<0-10>,"completeness":<0-10>,"reasoning_quality":<0-10>,"correct":true/false,"explanation":"one sentence"}`
  );
  return {
    score: Math.max(0, Math.min(maxScore, result?.score ?? Math.round(maxScore * 0.5))),
    factual_correctness: result?.factual_correctness ?? 5,
    completeness: result?.completeness ?? 5,
    reasoning_quality: result?.reasoning_quality ?? 5,
    correct: result?.correct ?? false,
    explanation: result?.explanation ?? 'Evaluated',
  };
}

function progressBar(score, max, width = 20) {
  if (max === 0) return '░'.repeat(width);
  const filled = Math.round((score / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

function confBar(c, width = 12) {
  const filled = Math.round(c * width);
  return '▓'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled)) + ` ${Math.round(c * 100)}%`;
}

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE — MAIN PIPELINE
// Three outputs: LEGITIMACY SCORE / MATURITY SCORE / OPERATIONAL RISK
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
    Object.entries(queries).map(async ([key, query]) => ({
      key, ...await collectEvidence(query, project.name)
    }))
  );
  const allSources   = searchResults.flatMap(r => r.sources);
  const totalSources = searchResults.reduce((a, r) => a + r.sourceCount, 0);
  const combinedText = searchResults.filter(r => r.text)
    .map(r => `=== ${r.key.toUpperCase()} ===\n${r.text}`)
    .join('\n\n');

  // 3 — Extract (Groq, temperature 0, YES/NO/UNKNOWN only)
  console.log('  → Extracting evidence...');
  const evidence = await extractEvidence(combinedText, project.name, template.label);

  // 4 — Hard event check
  const { confirmed: hardEvents, unverified: unverifiedHard } = checkHardEvents(evidence);

  // 5 — Score (direct points, no normalization, max 50 each)
  console.log('  → Scoring...');
  const { total: legitRaw, applied: legitApplied } = scoreSignals(template.legitimacy, evidence, project.name, 50);
  const { total: maturityRaw, applied: maturityApplied } = scoreSignals(template.maturity, evidence, project.name, 50);

  // Hard events force both to 0
  const legitimacyScore = hardEvents.length > 0 ? 0 : legitRaw;
  const maturityScore   = hardEvents.length > 0 ? 0 : maturityRaw;

  // 6 — Operational risk (separate axis)
  const opRisk = checkOperationalRisk(evidence);

  // 7 — Confidence
  const confidence = computeConfidence(evidence, template, allSources);

  // 8 — Recommendation (deterministic)
  const rec = getRecommendation(legitimacyScore * 2, hardEvents);  // ×2 to map 0-50 → 0-100

  // 9 — Calibration check
  const calibration = checkCalibration(project.name, legitimacyScore * 2, maturityScore * 2);

  // 10 — Verdict (Groq narrates from confirmed facts only — no scoring authority)
  console.log('  → Generating verdict...');
  const verdictText = await groqSynthesize(
    `Write a 2-3 sentence trust audit verdict for "${project.name}" (${template.label}).\n\n` +
    `Legitimacy Score: ${legitimacyScore}/50 (${legitimacyScore * 2}/100)\n` +
    `Maturity Score: ${maturityScore}/50 (${maturityScore * 2}/100)\n` +
    `Confidence: ${Math.round(confidence * 100)}%\nOperational Risk: ${opRisk.level}\n\n` +
    `Confirmed legitimacy signals:\n${legitApplied.map(s => `• ${s.label}`).join('\n') || '• None confirmed'}\n\n` +
    `Confirmed maturity signals:\n${maturityApplied.map(s => `• ${s.label}`).join('\n') || '• None confirmed'}\n\n` +
    `Hard trust events (override scoring if confirmed):\n${hardEvents.map(e => `• ${e.label}`).join('\n') || '• None'}\n\n` +
    `Operational risks (do NOT affect legitimacy — technical incidents):\n${opRisk.confirmed.map(r => `• ${r.label}`).join('\n') || '• None confirmed'}\n\n` +
    `Rules: Only use facts above. Legitimacy ≠ quality — a legitimate project can still be early stage or risky.\n` +
    `If confidence < 50%, note that scores reflect limited evidence, not confirmed problems.`,
    'Write a factual trust audit verdict. Do not add any information not listed above. Be direct.'
  );

  // ─── Format report ───
  const lowConfWarn = confidence < 0.40
    ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence * 100)}%): Limited sources retrieved. Scores reflect data availability — not confirmed problems. UNKNOWN ≠ negative.`
    : confidence < 0.65
    ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence * 100)}%): Some areas have limited evidence coverage.`
    : '';
  const anomalyWarn = calibration.anomaly ? `\n⚠  SCORE ANOMALY: ${calibration.note}` : '';
  const hardWarn    = hardEvents.length > 0
    ? `\n⛔ HARD TRUST EVENT — All scores overridden to 0\n` +
      hardEvents.map(e => `   ${e.label}\n   Source: ${e.citation.source_url}\n   Quote:  "${e.citation.quote}"`).join('\n')
    : '';

  // Signal blocks with source citations (#8) and confidence (#9)
  function formatSignalBlock(signals) {
    if (!signals.length) return '  (No signals confirmed in retrieved sources)';
    return signals.map(s => {
      const tierTag = `[${s.tier.toUpperCase()}]`;
      const confTag = `conf:${s.confidence}%`;
      const url     = s.urls[0] ? `\n    └─ ${s.urls[0]}` : '';
      return `  +${String(s.weightedPoints).padStart(2)}  ${s.label}  ${tierTag} ${confTag}${url}`;
    }).join('\n');
  }

  const unverifiedBlock = [...unverifiedHard, ...opRisk.unverified].length > 0
    ? [...unverifiedHard, ...opRisk.unverified].map(u =>
        `  ~ ${u.label}\n    ${u.note}${u.citation?.source_url ? '\n    Source: ' + u.citation.source_url : ''}`
      ).join('\n')
    : '  ✓ None';

  const operationalBlock = opRisk.confirmed.length > 0
    ? opRisk.confirmed.map(r =>
        `  ⚠ ${r.label}\n     Source: ${r.citation.source_url}\n     Quote:  "${r.citation.quote}"`
      ).join('\n') +
      '\n\n  NOTE: Operational incidents do not reduce legitimacy or maturity scores.\n' +
      '  A disclosed and patched exploit is evidence of process maturity, not untrustworthiness.'
    : '  ✓ None confirmed';

  const contraBlock = evidence.contradictions?.length > 0
    ? '\nCONTRADICTIONS DETECTED\n' + evidence.contradictions.map(c => `  ⚡ ${c}`).join('\n')
    : '';

  // Evidence state table
  const evidenceTable = [
    ['Whitepaper',       'whitepaper'],
    ['Technical Docs',   'technical_docs'],
    ['Roadmap',          'roadmap'],
    ['Active GitHub',    'active_github'],
    ['Security Audit',   'audit_found'],
    ['Founders Named',   'founders_named'],
    ['LinkedIn Found',   'linkedin_found'],
    ['Active Community', 'active_community'],
    ['Media Coverage',   'media_coverage'],
    ['Live Product',     'live_product'],
    ['Exchange Listed',  'major_exchange_listed'],
    ['Founded Year',     'founded_year'],
  ].map(([label, key]) => {
    const val = evidence[key];
    const display = val === 'YES' ? '✓ YES' : val === 'NO' ? '✗ NO' : (val && val !== 'UNKNOWN' ? val : '? UNKNOWN');
    const conf = evidence.confidence_per_signal?.[key];
    const confStr = conf !== undefined ? ` (conf:${conf}%)` : '';
    return `  ${label.padEnd(18)} ${display}${confStr}`;
  }).join('\n');

  const legitDisplay   = legitimacyScore * 2;  // show as /100 for readability
  const maturityDisplay = maturityScore * 2;

  return `VERIS TRUST REPORT
══════════════════════════════════════════════
Subject:          ${project.name}
Entity Class:     ${template.label}
Website:          ${project.website || 'Not provided'}
GitHub:           ${project.github || 'Not provided'}
Twitter:          ${project.twitter || 'Not provided'}
Docs:             ${project.docs || 'Not provided'}
Contract:         ${project.contract || 'Not provided'}
Founded:          ${evidence.founded_year || 'Unknown'}
Audited:          ${new Date().toUTCString()}
Audited by:       VERIS — Trust Infrastructure for the Agent Economy
${template.note}
══════════════════════════════════════════════
LEGITIMACY SCORE:   ${legitDisplay}/100  ${progressBar(legitDisplay, 100)}
MATURITY SCORE:     ${maturityDisplay}/100  ${progressBar(maturityDisplay, 100)}
CONFIDENCE:         ${confBar(confidence, 20)}
OPERATIONAL RISK:   ${opRisk.level}
${hardWarn}${lowConfWarn}${anomalyWarn}
RECOMMENDATION:  ${rec.symbol} ${rec.label}  [Band: ${rec.band}]
══════════════════════════════════════════════
EVIDENCE STATE TABLE
(YES = confirmed | NO = contradicted | UNKNOWN = not found — no score impact)
${evidenceTable}
══════════════════════════════════════════════
LEGITIMACY SIGNALS CONFIRMED  (max 50 pts)
(Format: points  signal  [tier]  confidence%  source URL)
${formatSignalBlock(legitApplied)}
  ─────────────────────────────────────────
  Raw total: ${legitRaw}/50 pts → displayed as ${legitDisplay}/100

MATURITY SIGNALS CONFIRMED  (max 50 pts)
${formatSignalBlock(maturityApplied)}
  ─────────────────────────────────────────
  Raw total: ${maturityRaw}/50 pts → displayed as ${maturityDisplay}/100
══════════════════════════════════════════════
UNVERIFIED CONCERNS  (mentioned in sources — insufficient citation — zero impact)
${unverifiedBlock}

OPERATIONAL RISKS  (separate axis — do not reduce legitimacy or maturity scores)
${operationalBlock}
${contraBlock}
══════════════════════════════════════════════
VERDICT
${verdictText}
══════════════════════════════════════════════
SCORE BANDS
  90-100  Strongly Trusted       80-89  Trusted
  65-79   Generally Legitimate   50-64  Mixed Signals
  30-49   High Risk              0-29   Critical Risk

SCORING METHODOLOGY
  Pipeline:      Search → Classify entity → Extract (Groq, temp 0.0) → Score (code) → Report
  Evidence:      YES / NO / UNKNOWN — UNKNOWN has zero score impact
  Evidence tiers: T1 Official/GitHub (×1.00) · T2 Major media/audit (×0.75) · T3 Community (×0.40) · T4 Inferred (×0.15)
  Scoring:       Direct fixed points per signal × tier weight × consensus multiplier — no normalization
  Hard events:   Confirmed fraud/sanctions/conviction → override all scores to 0
  Deductions:    Hard events require source_url + quote ≥25 chars + confidence ≥85%
  Operational:   Hacks/exploits on separate axis — never reduce legitimacy or maturity

LIMITATIONS
  • Grounded in Tavily search at audit time — not financial or legal advice
  • UNKNOWN evidence lowers confidence only — never lowers scores
  • Scores are directionally accurate — not a substitute for manual due diligence

AUDIT TRAIL
  Search:      Tavily Advanced (${totalSources} sources, ${Object.keys(queries).length} queries)
  Extraction:  Groq llama-3.3-70b-versatile (temperature 0.0)
  Scoring:     Deterministic code
  Auditor:     VERIS · CROO v1 · Base Mainnet
  Timestamp:   ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// BENCHMARK TEST SUITE  (#4)
// Import and run: await runBenchmarkSuite()
// ═══════════════════════════════════════════════════════════════════════
export const CALIBRATION_BENCHMARKS = {
  bitcoin:      { legitMin: 85, maturityMin: 85 },
  ethereum:     { legitMin: 85, maturityMin: 85 },
  solana:       { legitMin: 78, maturityMin: 75 },
  chainlink:    { legitMin: 78, maturityMin: 72 },
  uniswap:      { legitMin: 75, maturityMin: 70 },
  xrpl:         { legitMin: 75, maturityMin: 68 },
  xrp:          { legitMin: 75, maturityMin: 68 },
  hyperliquid:  { legitMin: 70, maturityMin: 60 },
  ftx:          { expectCritical: true },
  'terra luna': { expectCritical: true },
  celsius:      { expectCritical: true },
};

export function checkCalibration(projectName, legitScore100, maturityScore100) {
  const key = projectName.toLowerCase().trim();
  const bench = CALIBRATION_BENCHMARKS[key] || CALIBRATION_BENCHMARKS[key.split(' ')[0]];
  if (!bench) return { anomaly: false };
  if (bench.expectCritical && legitScore100 > 30) {
    return { anomaly: true, note: `Score ${legitScore100} unexpectedly high for known failed/fraudulent project.` };
  }
  if (bench.legitMin && legitScore100 < bench.legitMin - 15) {
    return { anomaly: true, note: `Legitimacy ${legitScore100} below expected floor (${bench.legitMin}) for ${projectName}. Check evidence coverage.` };
  }
  if (bench.maturityMin && maturityScore100 < bench.maturityMin - 15) {
    return { anomaly: true, note: `Maturity ${maturityScore100} below expected floor (${bench.maturityMin}) for ${projectName}. Check evidence coverage.` };
  }
  return { anomaly: false };
}

export async function runBenchmarkSuite(verbose = false) {
  const SUITE = [
    { name: 'Bitcoin',      entityType: 'l1l2',             legitMin: 85, maturityMin: 85 },
    { name: 'Ethereum',     entityType: 'l1l2',             legitMin: 85, maturityMin: 85 },
    { name: 'Solana',       entityType: 'l1l2',             legitMin: 78, maturityMin: 75 },
    { name: 'Chainlink',    entityType: 'tooling',          legitMin: 78, maturityMin: 72 },
    { name: 'Uniswap',      entityType: 'defi',             legitMin: 75, maturityMin: 70 },
    { name: 'XRPL',         entityType: 'infrastructure',   legitMin: 75, maturityMin: 68 },
    { name: 'Hyperliquid',  entityType: 'trading_protocol', legitMin: 70, maturityMin: 60 },
    { name: 'FTX',          entityType: 'trading_protocol', expectCritical: true },
    { name: 'Terra Luna',   entityType: 'l1l2',             expectCritical: true },
    { name: 'Celsius',      entityType: 'defi',             expectCritical: true },
  ];

  console.log('\n🧪 VERIS BENCHMARK SUITE');
  console.log('═'.repeat(60));
  const results = [];

  for (const test of SUITE) {
    process.stdout.write(`  ${test.name.padEnd(14)} `);
    try {
      const report = await runProjectDueDiligence({ name: test.name, entityType: test.entityType });
      const lM = report.match(/LEGITIMACY SCORE:\s+(\d+)/);
      const mM = report.match(/MATURITY SCORE:\s+(\d+)/);
      const l  = parseInt(lM?.[1] || '0');
      const m  = parseInt(mM?.[1] || '0');
      const isCritical = report.includes('HARD TRUST EVENT') || report.includes('CRITICAL RISK');

      let pass;
      if (test.expectCritical) {
        pass = l <= 30 || isCritical;
      } else {
        pass = l >= (test.legitMin - 10) && m >= (test.maturityMin - 10);
      }

      results.push({ name: test.name, l, m, pass, isCritical });
      console.log(`${pass ? '✓ PASS' : '✗ FAIL'}  L:${String(l).padStart(3)}  M:${String(m).padStart(3)}${isCritical ? '  [CRITICAL]' : ''}`);
      if (!pass && !test.expectCritical) console.log(`               Expected L≥${test.legitMin} M≥${test.maturityMin}`);
      if (verbose) console.log('\n' + report.substring(0, 600) + '\n...\n');
    } catch (err) {
      results.push({ name: test.name, pass: false, error: err.message });
      console.log(`✗ ERROR  ${err.message}`);
    }
  }

  const passed = results.filter(r => r.pass).length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`RESULT: ${passed}/${results.length} passed`);
  if (passed < results.length) {
    console.log('⚠ Failures detected. Review scoring before deploying.');
  } else {
    console.log('✓ All benchmarks passed.');
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT BENCHMARK PACKS (unchanged — separate product)
// ═══════════════════════════════════════════════════════════════════════
const BENCHMARK_PACKS = {
  research: { label: 'Research Agent', reliability: ['Explain how Aave liquidation works in simple terms.','Explain impermanent loss and when it occurs.','What problem does a liquidity pool solve?'], competence: [{prompt:'Explain the health factor concept in DeFi lending.',concept:'health factor — collateral ratio, liquidation threshold, risk management'},{prompt:'How does an automated market maker price assets?',concept:'AMM pricing — constant product formula, liquidity, slippage'},{prompt:'What is the difference between APR and APY in DeFi?',concept:'APR vs APY — compounding, frequency, yield calculation'},{prompt:'Why do DeFi protocols need oracles?',concept:'oracles — external price data, on-chain verification, manipulation risk'}], deep: ['Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.','What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?'], competenceEval: 'Evaluate a DeFi research agent on factual accuracy, depth, and source grounding.' },
  trading: { label: 'Trading Agent', reliability: ['Explain what a stop loss is and why traders use it.','What does it mean when a market is in backwardation?','Explain the concept of position sizing in trading.'], competence: [{prompt:'How does funding rate work in perpetual futures?',concept:'funding rate — longs pay shorts or vice versa, market balance, 8-hour intervals'},{prompt:'What does the RSI indicator measure?',concept:'RSI — momentum oscillator, overbought >70, oversold <30, divergence'},{prompt:'Explain the difference between a limit order and a market order.',concept:'limit vs market — price control, execution certainty, slippage'},{prompt:'What is the purpose of a liquidation price in leveraged trading?',concept:'liquidation — leverage, margin, forced close, collateral loss'}], deep: ['What are 3 warning signs that a crypto rally is losing momentum?','Explain how you would assess risk before entering a leveraged trade.'], competenceEval: 'Evaluate a trading agent on concept accuracy, risk awareness, and reasoning quality.' },
  data: { label: 'Data & Analytics Agent', reliability: ['Explain the difference between on-chain and off-chain data.','What does TVL measure and why does it matter in DeFi?','Explain what a moving average tells you about price trend.'], competence: [{prompt:'What is the difference between correlation and causation?',concept:'correlation vs causation — statistical relationship, not causal, confounding variables'},{prompt:'How would you detect wash trading in on-chain data?',concept:'wash trading — circular transactions, artificial volume, same wallet patterns'},{prompt:'What metrics would you track to monitor the health of a DeFi lending protocol?',concept:'lending health — utilization rate, bad debt, liquidations, TVL, collateral ratio'},{prompt:'Explain what standard deviation measures.',concept:'standard deviation — spread from mean, volatility, risk quantification'}], deep: ['What on-chain metrics best predict whether a DeFi protocol is growing or declining?','How would you build a simple risk dashboard for a DeFi portfolio?'], competenceEval: 'Evaluate a data analytics agent on statistical accuracy and data interpretation.' },
  writing: { label: 'Writing & Content Agent', reliability: ['Write a 50-word tweet announcing a new DeFi protocol launch.','Summarize what blockchain technology is in 3 sentences for a beginner.','Write a one-paragraph introduction to a crypto market report.'], competence: [{prompt:'Explain the difference between active and passive voice.',concept:'active vs passive — subject acts vs receives action, clarity'},{prompt:'What makes a strong call-to-action in marketing copy?',concept:'CTA — clarity, urgency, benefit, direct instruction, action verb'},{prompt:'What is the inverted pyramid style in journalism?',concept:'inverted pyramid — most important first, supporting details, background'},{prompt:'What is the difference between tone and voice in writing?',concept:'tone vs voice — tone per context, voice is consistent identity'}], deep: ['Write a 3-tweet thread explaining why AI agents are the future of commerce.','Draft a 100-word product description for an AI agent that audits Web3 projects.'], competenceEval: 'Evaluate a writing agent on clarity, grammar, tone, and format adherence.' },
  coding: { label: 'Coding & Developer Agent', reliability: ['Write a JavaScript function that calculates compound interest.','Explain what a smart contract is and how it differs from regular code.','What is the difference between async/await and callbacks?'], competence: [{prompt:'What does the ERC-20 standard define?',concept:'ERC-20 — token standard, transfer, approve, allowance, fungible, interoperability'},{prompt:'Explain what a reentrancy attack is and how to prevent it.',concept:'reentrancy — recursive external call, state not updated, checks-effects-interactions'},{prompt:'What is gas in Ethereum and why does it exist?',concept:'gas — computational cost, spam prevention, miner incentive, fee market'},{prompt:'What is the difference between memory and storage in Solidity?',concept:'memory vs storage — temporary vs persistent, gas cost, data location'}], deep: ['What are the top 3 security best practices for Solidity smart contracts?','Explain how WebSockets differ from REST APIs.'], competenceEval: 'Evaluate a coding agent on correctness, technical accuracy, and security awareness.' },
  defi: { label: 'DeFi Specialist Agent', reliability: ['Explain how an automated market maker works.','What is yield farming and what are its main risks?','How does a flash loan work?'], competence: [{prompt:'Explain the concept of slippage in a DEX trade.',concept:'slippage — price impact, liquidity depth, trade size, expected vs actual'},{prompt:'What is the role of an oracle in a lending protocol?',concept:'oracle — price feed, liquidation trigger, collateral valuation, manipulation risk'},{prompt:'Explain how liquidity provider tokens work.',concept:'LP tokens — pool share, redeemable for underlying, fee accrual, composable'},{prompt:'What is protocol-owned liquidity?',concept:'POL — OHM model, mercenary capital problem, sustainable liquidity'}], deep: ['Compare the risks of lending on Aave versus providing liquidity on Curve.','Explain 3 ways a DeFi protocol can fail even with a clean audit.'], competenceEval: 'Evaluate a DeFi specialist agent on protocol knowledge, mechanism accuracy, and risk awareness.' },
  security: { label: 'Security & Audit Agent', reliability: ['What are the most common smart contract vulnerabilities?','How would you assess whether a DeFi protocol is safe to use?','What is a Sybil attack?'], competence: [{prompt:'Explain how a reentrancy attack works step by step.',concept:'reentrancy — recursive external call, state not updated, drain funds, checks-effects-interactions'},{prompt:'What is a 51% attack and what does it enable?',concept:'51% attack — majority hash power, double spend, reorg, cannot steal keys'},{prompt:'What makes a smart contract audit different from a code review?',concept:'audit vs review — formal process, severity rating, economic attack vectors'},{prompt:'What is front-running in DeFi?',concept:'front-running — mempool, higher gas, sandwich attack, MEV, ordering'}], deep: ['What are 3 red flags that indicate a DeFi project might be a rug pull?','How would you verify that a smart contract audit was legitimate?'], competenceEval: 'Evaluate a security and audit agent on vulnerability knowledge and risk assessment.' },
  general: { label: 'General Purpose Agent', reliability: ['Explain what artificial intelligence is in simple terms.','What is the difference between Web2 and Web3?','Explain blockchain technology to a non-technical person.'], competence: [{prompt:'What is Bitcoin and what problem was it designed to solve?',concept:'Bitcoin — decentralized currency, double spend, trustless, censorship resistant'},{prompt:'What is an API and how do applications use it?',concept:'API — interface, requests, responses, data exchange, integration'},{prompt:'What is the difference between a public and private blockchain?',concept:'public vs private — permissionless vs permissioned, transparency, validators'},{prompt:'What is a crypto wallet and how does it actually work?',concept:'wallet — public private key pair, signs transactions, does not store coins'}], deep: ['What are the top 3 use cases for AI agents in the Web3 economy?','What makes CROO protocol different from traditional payment infrastructure?'], competenceEval: 'Evaluate a general purpose agent on breadth of knowledge, clarity, and helpfulness.' },
};

export function detectCategory(serviceDescription = '', agentName = '') {
  const text = (serviceDescription + ' ' + agentName).toLowerCase();
  const signals = { trading: ['trad','signal','market analysis','buy sell','portfolio','futures','spot'], data: ['data','analytics','metrics','dashboard','statistics','visualization'], writing: ['writ','content','copy','blog','tweet','social media','article','newsletter'], coding: ['cod','developer','script','program','solidity','smart contract','debug'], defi: ['defi','yield','liquidity','protocol','lending','borrow','swap','amm','pool','farming'], security: ['security','audit','vulnerability','risk assess','scam detect','hack','protect'], research: ['research','intelligence','report','briefing','due diligence','synthesis'] };
  let best = 'general', bestScore = 0;
  for (const [cat, terms] of Object.entries(signals)) { const s = terms.filter(t => text.includes(t)).length; if (s > bestScore) { bestScore = s; best = cat; } }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT AUDIT
// ═══════════════════════════════════════════════════════════════════════
async function placeTestOrder(agentClient, serviceId, prompt, timeoutMs = 90000) {
  return new Promise(async (resolve) => {
    const startTime = Date.now(); let orderId = '', timedOut = false, stream = null;
    const timer = setTimeout(() => { timedOut = true; if (stream) try { stream.close(); } catch {} resolve({ response: null, responseTime: timeoutMs, timedOut: true }); }, timeoutMs);
    try {
      await agentClient.negotiateOrder({ serviceId, requirements: JSON.stringify({ topic: prompt, task: prompt, text: prompt }) });
      stream = await agentClient.connectWebSocket();
      stream.on(EventType.OrderCreated, async (e) => { if (timedOut) return; orderId = e.order_id; try { await agentClient.payOrder(e.order_id); } catch (err) { console.warn('Pay error:', err.message); } });
      stream.on(EventType.OrderCompleted, async (e) => { if (timedOut || e.order_id !== orderId) return; clearTimeout(timer); try { const d = await agentClient.getDelivery(e.order_id); stream.close(); resolve({ response: d.deliverableText || '', responseTime: Date.now() - startTime, timedOut: false }); } catch { stream.close(); resolve({ response: null, responseTime: Date.now() - startTime, timedOut: false }); } });
      stream.on(EventType.OrderRejected, () => { clearTimeout(timer); if (stream) stream.close(); resolve({ response: null, responseTime: Date.now() - startTime, rejected: true }); });
    } catch (err) { clearTimeout(timer); resolve({ response: null, responseTime: Date.now() - startTime, error: err.message }); }
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
  const dS = await scoreWithAI(`${pack.competenceEval}\nPrompt:"${pack.deep[0]}"\nResponse:${r3.response?.substring(0,600)||'No response'}\nScore 0-10.\nReturn ONLY:{"score":<0-10>,"notes":"one line"}`);
  const completed = [r1,r2,r3].filter(r => r.response && !r.timedOut).length;
  const cr = Math.round((completed/3)*100);
  const rS = r1.response ? 15 : 0, coS = cS.score*2, pS = cr>=100?10:cr>=66?7:4;
  return { mode:'quick', total:Math.min(55,rS+coS+pS+(dS?.score??5)), maxScore:55, completionRate:cr, ordersPlaced:3, reliabilityScore:rS, competenceScore:coS, performanceScore:pS, deepScore:dS?.score??5 };
}

async function runFullAudit(agentClient, serviceId, pack) {
  console.log('  → Reliability tests...');
  const relR = [];
  for (const p of pack.reliability) { relR.push({prompt:p,...await placeTestOrder(agentClient,serviceId,p)}); await new Promise(r=>setTimeout(r,2000)); }
  const relC = relR.filter(r=>r.response&&!r.timedOut), relComp = relC.length/relR.length;
  const rSR = await scoreWithAI(`Evaluate reliability:\n\n${relC.map((r,i)=>`Response ${i+1}:"${r.prompt}"\n${r.response?.substring(0,300)}`).join('\n---\n')}\n\nCompletion:${Math.round(relComp*100)}%\nScore 0-25.\nReturn ONLY:{"score":<0-25>,"notes":"brief"}`);
  const reliability = {score:Math.min(25,rSR?.score??Math.round(relComp*20)),completionRate:Math.round(relComp*100),completed:relC.length,total:relR.length,timedOut:relR.filter(r=>r.timedOut).length,notes:rSR?.notes??`${relC.length}/${relR.length}`};
  console.log('  → Source verification...');
  const sR = await placeTestOrder(agentClient,serviceId,pack.deep[1]||pack.deep[0]);
  await new Promise(r=>setTimeout(r,2000));
  const sS = await scoreWithAI(`Evaluate source grounding:\nPrompt:"${pack.deep[1]||pack.deep[0]}"\nResponse:${sR.response?.substring(0,800)||'No response'}\nScore 0-25: named sources+8,data+6,time+5,uncertainty+4,no unsupported+2. Invented stats -8.\nReturn ONLY:{"score":<0-25>,"sourcesCited":["s"],"concerns":["c"]}`);
  const sourceVerification = {score:Math.max(0,Math.min(25,sS?.score??10)),sourcesCited:sS?.sourcesCited??[],concerns:sS?.concerns??[]};
  console.log('  → Domain competence...');
  const cR = [];
  for (const t of pack.competence) { const r=await placeTestOrder(agentClient,serviceId,t.prompt); cR.push({prompt:t.prompt,...await semanticScore(t.prompt,r.response,t.concept,10)}); await new Promise(r=>setTimeout(r,2000)); }
  const avgC = cR.reduce((a,b)=>a+b.score,0)/cR.length;
  const domainCompetence = {score:Math.min(25,Math.round(avgC*2.5)),accuracyRate:Math.round((cR.filter(r=>r.correct).length/cR.length)*100),competenceLevel:avgC>=7?'high':avgC>=5?'medium':'low',testBreakdown:cR.map(r=>({prompt:r.prompt.substring(0,60)+'...',correct:r.correct,factual_correctness:r.factual_correctness??5,completeness:r.completeness??5,reasoning_quality:r.reasoning_quality??5,explanation:r.explanation??'Evaluated'}))};
  console.log('  → Transparency probe...');
  const tR = await placeTestOrder(agentClient,serviceId,'What are your limitations? What topics or questions are you NOT reliable for?');
  await new Promise(r=>setTimeout(r,2000));
  const tS = await scoreWithAI(`Evaluate transparency:\n${tR.response?.substring(0,600)||'No response'}\nScore 0-15: acknowledges limitations+4,specifies weaknesses+4,uncertainty+4,not infallible+3. Deduct: claims no limits -8.\nReturn ONLY:{"score":<0-15>,"transparencyLevel":"high/medium/low","notes":"assessment"}`);
  const transparency = {score:Math.max(0,Math.min(15,tS?.score??7)),transparencyLevel:tS?.transparencyLevel??'medium',notes:tS?.notes??'Probe complete'};
  const perfScore = Math.max(0,Math.min(10,(reliability.completionRate>=100?10:reliability.completionRate>=66?7:reliability.completionRate>=33?4:1)-reliability.timedOut*2));
  return {mode:'full',reliability,sourceVerification,domainCompetence,transparency,perfScore,total:reliability.score+sourceVerification.score+domainCompetence.score+transparency.score+perfScore,maxScore:100,ordersPlaced:10};
}

export async function runAgentAudit(agentInfo, requesterSdkKey, category = 'general', mode = 'full') {
  console.log(`\n🤖 A2A Audit | Agent: ${agentInfo.agentId} | Category: ${category} | Mode: ${mode}`);
  const pack = BENCHMARK_PACKS[category] || BENCHMARK_PACKS.general;
  if (!['quick','full'].includes(mode)) mode = 'full';
  const agentClient = new AgentClient(crooConfig, requesterSdkKey);
  const results = mode === 'quick' ? await runQuickAudit(agentClient, agentInfo.serviceId, pack) : await runFullAudit(agentClient, agentInfo.serviceId, pack);
  const {total,maxScore} = results;
  const reliabilityLevel = total>=80?'High':total>=60?'Moderate':total>=40?'Low':'Unreliable';
  const verdict = total>=maxScore*0.8?'Strong reliability. Suitable for production.':total>=maxScore*0.6?'Adequate. Low-stakes tasks.':total>=maxScore*0.4?'Inconsistent. Use with caution.':'Fails standards. Not recommended.';
  const cats = Object.entries(BENCHMARK_PACKS).map(([k,v])=>`✓ ${k} — ${v.label}`).join('\n');
  if (mode==='quick') return `VERIS AGENT AUDIT (QUICK)\nAgent:${agentInfo.agentId} | Category:${pack.label}\nAudited:${new Date().toUTCString()}\n${'═'.repeat(50)}\nSCORE:${total}/${maxScore}  RELIABILITY:${reliabilityLevel}\n${'═'.repeat(50)}\nReliability:${results.reliabilityScore}/15 ${progressBar(results.reliabilityScore,15)}\nCompetence: ${results.competenceScore}/20 ${progressBar(results.competenceScore,20)}\nPerformance:${results.performanceScore}/10 ${progressBar(results.performanceScore,10)}\nDepth:      ${results.deepScore}/10 ${progressBar(results.deepScore,10)}\nCompletion:${results.completionRate}%\nVERDICT:${verdict}\nAUDIT TRAIL:VERIS·${new Date().toISOString()}`;
  return `VERIS AGENT AUDIT (FULL)\nAgent:${agentInfo.agentId} | Category:${pack.label}\nAudited:${new Date().toUTCString()}\n${'═'.repeat(50)}\nSCORE:${total}/100  RELIABILITY:${reliabilityLevel}\n${'═'.repeat(50)}\nReliability:    ${String(results.reliability.score).padStart(2)}/25 ${progressBar(results.reliability.score,25)}\nSrc Verif:      ${String(results.sourceVerification.score).padStart(2)}/25 ${progressBar(results.sourceVerification.score,25)}\nDomain Competence:${String(results.domainCompetence.score).padStart(2)}/25 ${progressBar(results.domainCompetence.score,25)}\nTransparency:   ${String(results.transparency.score).padStart(2)}/15 ${progressBar(results.transparency.score,15)}\nPerformance:    ${String(results.perfScore).padStart(2)}/10 ${progressBar(results.perfScore,10)}\nCompletion:${results.reliability.completionRate}% Accuracy:${results.domainCompetence.accuracyRate}% Level:${results.domainCompetence.competenceLevel?.toUpperCase()}\nCOMPETENCE\n${results.domainCompetence.testBreakdown?.map(t=>`• "${t.prompt}"\n  ${t.correct?'✓':'✗'} F:${t.factual_correctness} C:${t.completeness} R:${t.reasoning_quality} — ${t.explanation}`).join('\n')||'Tests completed'}\nVERDICT:${verdict}\nREC:${total>=80?'✓ PRODUCTION':total>=60?'⚠ TESTING':total>=40?'✗ HIGH RISK':'✗ DO NOT USE'}\nPACKS\n${cats}\nAUDIT TRAIL:VERIS·${category}·${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════
export async function runVERIS(requirements, requesterSdkKey) {
  const req = typeof requirements === 'string' ? JSON.parse(requirements) : requirements;
  if (req.type === 'agent') {
    if (!req.agentId || !req.serviceId) throw new Error('Agent audit requires: agentId and serviceId');
    return await runAgentAudit(
      { agentId: req.agentId, serviceId: req.serviceId }, requesterSdkKey,
      req.category || detectCategory(req.serviceDescription || '', req.agentName || ''),
      req.mode || 'full'
    );
  }
  if (req.type === 'project') {
    if (!req.name) throw new Error('Project due diligence requires: name');
    return await runProjectDueDiligence(req);
  }
  throw new Error('Invalid type. Use "project" or "agent".');
}
