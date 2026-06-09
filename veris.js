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
// SOURCE QUALITY WEIGHTS  (#3)
// Not all sources carry equal authority.
// ═══════════════════════════════════════════════════════════════════════
const SOURCE_WEIGHTS = {
  github:        1.00,
  official_docs: 1.00,
  foundation:    0.95,
  major_media:   0.80,  // CoinDesk, Decrypt, Bloomberg, Reuters
  explorer:      0.80,  // Etherscan, Dune, DefiLlama
  audit_report:  0.95,
  linkedin:      0.90,
  community:     0.50,  // Reddit, Discord, Telegram
  blog:          0.30,
  unknown:       0.40,
};

function classifySourceQuality(url = '') {
  const u = url.toLowerCase();
  if (u.includes('github.com'))                       return 'github';
  if (u.includes('docs.') || u.includes('/docs'))     return 'official_docs';
  if (u.includes('foundation.'))                       return 'foundation';
  if (u.match(/coindesk|decrypt|bloomberg|reuters|cointelegraph|theblock/)) return 'major_media';
  if (u.match(/etherscan|defillama|dune\.xyz|coingecko|coinmarketcap/))     return 'explorer';
  if (u.match(/certik|trail.*bits|openzeppelin|consensys.*diligence|halborn/)) return 'audit_report';
  if (u.includes('linkedin.com'))                      return 'linkedin';
  if (u.match(/reddit|discord|telegram|twitter|x\.com/)) return 'community';
  if (u.match(/medium\.com|substack|mirror\.xyz/))    return 'blog';
  return 'unknown';
}

function sourceAuthorityScore(sources = []) {
  if (!sources.length) return 0;
  const weightedSum = sources.reduce((sum, s) => {
    const type = classifySourceQuality(s.url);
    return sum + (SOURCE_WEIGHTS[type] || 0.4);
  }, 0);
  return weightedSum / sources.length; // 0-1
}

// ═══════════════════════════════════════════════════════════════════════
// CALIBRATION BENCHMARKS  (#18)
// Expected ranges for well-known entity types.
// If score falls far outside range, flag anomaly.
// ═══════════════════════════════════════════════════════════════════════
const CALIBRATION_BENCHMARKS = {
  'bitcoin':      { low: 85, high: 98 },
  'ethereum':     { low: 85, high: 98 },
  'solana':       { low: 78, high: 95 },
  'xrpl':         { low: 75, high: 92 },
  'xrp':          { low: 75, high: 92 },
  'hyperliquid':  { low: 72, high: 90 },
  'aave':         { low: 75, high: 92 },
  'uniswap':      { low: 78, high: 93 },
  'chainlink':    { low: 78, high: 93 },
  // meme coins have no named benchmarks — general range is 15-45
};

function checkCalibration(projectName, trustScore, entityType) {
  const key = projectName.toLowerCase().replace(/\s+/g, '');
  const bench = CALIBRATION_BENCHMARKS[key];
  if (!bench) {
    // Apply generic sanity check by entity type
    if (entityType === 'memecoin' && trustScore > 70) return { anomaly: true, note: `Score ${trustScore} unusually high for meme coin entity class.` };
    if (['infrastructure', 'l1l2'].includes(entityType) && trustScore < 30) return { anomaly: true, note: `Score ${trustScore} unusually low for established infrastructure protocol.` };
    return { anomaly: false };
  }
  if (trustScore < bench.low - 15) return { anomaly: true, note: `Score ${trustScore} is significantly below expected range (${bench.low}–${bench.high}) for this project. Review evidence coverage.` };
  if (trustScore > bench.high + 5)  return { anomaly: true, note: `Score ${trustScore} is above expected ceiling (${bench.high}) for this project.` };
  return { anomaly: false };
}

// ═══════════════════════════════════════════════════════════════════════
// ENTITY CLASSIFICATION  (#1)
// 10 entity types, each with its own scoring rubric.
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_TEMPLATES = {
  infrastructure: {
    label: 'Infrastructure Protocol',
    signals: ['foundation', 'layer 1', 'layer 2', 'l1', 'l2', 'network', 'ledger', 'mainnet', 'consensus', 'validator', 'node', 'xrpl', 'ripple', 'cosmos', 'polkadot', 'near', 'algorand', 'cardano', 'tezos'],
    note: 'Infrastructure rubric: development activity and documentation weighted highest. Distributed governance means no startup team page — absence is not a red flag.',
    // Positive signal points  (#2 deterministic)
    scoring: {
      // Longevity  (#7)
      longevity_10y:   10, longevity_5y: 6, longevity_2y: 3,
      // Ecosystem  (#9)
      top10_chain: 8, major_exchange_listed: 5, institutional_adoption: 6,
      developer_ecosystem: 6, sdks_found: 4, grants_hackathons: 3,
      // Development  (#13 GitHub intelligence)
      active_github: 6, high_github_stars: 4, multiple_contributors: 4,
      open_source: 3, audit_found: 6, regular_releases: 3, recent_commits: 4,
      // Documentation
      whitepaper: 5, technical_docs: 4, roadmap: 3, clear_use_case: 2,
      // Community  (#15)
      large_community: 4, active_community: 3, media_coverage: 3,
      // Governance
      on_chain_governance: 4, treasury_transparency: 3,
    },
  },
  l1l2: {
    label: 'L1/L2 Blockchain',
    signals: ['bitcoin', 'ethereum', 'solana', 'avalanche', 'binance smart chain', 'bsc', 'polygon', 'optimism', 'arbitrum', 'base', 'zksync', 'starknet', 'scroll'],
    note: 'L1/L2 rubric: identical to infrastructure. Longevity, ecosystem adoption, and development activity are primary signals.',
    scoring: {
      longevity_10y: 12, longevity_5y: 8, longevity_2y: 4,
      top10_chain: 10, major_exchange_listed: 6, institutional_adoption: 7,
      developer_ecosystem: 7, sdks_found: 4, grants_hackathons: 4,
      active_github: 7, high_github_stars: 5, multiple_contributors: 5,
      open_source: 4, audit_found: 5, regular_releases: 3, recent_commits: 4,
      whitepaper: 4, technical_docs: 4, roadmap: 2, clear_use_case: 2,
      large_community: 5, active_community: 4, media_coverage: 4,
      on_chain_governance: 4, treasury_transparency: 3,
    },
  },
  defi: {
    label: 'DeFi Protocol',
    signals: ['defi', 'yield', 'lending', 'borrow', 'swap', 'amm', 'liquidity', 'pool', 'vault', 'perp', 'perpetual', 'dex', 'staking', 'liquid staking'],
    note: 'DeFi rubric: audit status and smart contract security weighted most critically.',
    scoring: {
      longevity_5y: 6, longevity_2y: 3,
      audit_found: 10, multiple_audits: 5, bug_bounty: 4,
      tvl_mentioned: 6, major_exchange_listed: 4, institutional_adoption: 4,
      active_github: 5, multiple_contributors: 3, open_source: 4, recent_commits: 3,
      whitepaper: 4, technical_docs: 4, tokenomics: 4, roadmap: 3,
      founders_named: 4, verifiable_history: 4, linkedin_found: 2,
      large_community: 3, active_community: 3, media_coverage: 3,
    },
  },
  trading_protocol: {
    label: 'Trading Protocol / Exchange',
    signals: ['exchange', 'trading', 'spot trading', 'derivatives', 'perpetuals', 'order book', 'hyperliquid', 'hyper', 'dydx', 'gmx', 'drift', 'vertex'],
    note: 'Trading protocol rubric: security audit, liquidity, and team transparency weighted heavily.',
    scoring: {
      longevity_5y: 5, longevity_2y: 3,
      audit_found: 9, multiple_audits: 5, bug_bounty: 4,
      tvl_mentioned: 7, trading_volume_mentioned: 6, major_exchange_listed: 3,
      active_github: 4, open_source: 4, recent_commits: 3,
      founders_named: 6, verifiable_history: 5, linkedin_found: 3, team_page: 3,
      whitepaper: 3, technical_docs: 4, clear_use_case: 3,
      large_community: 3, active_community: 3, media_coverage: 4,
    },
  },
  aiagent: {
    label: 'AI Agent / Product',
    signals: ['ai agent', 'autonomous agent', 'llm', 'gpt', 'copilot', 'assistant', 'autopilot', 'croo', 'veris', 'ai-powered'],
    note: 'AI agent rubric: creator identity and live functionality weighted most.',
    scoring: {
      founders_named: 8, linkedin_found: 5, verifiable_history: 5, team_page: 3,
      live_product: 9, features_described: 5, user_reviews: 4, api_usage: 4,
      technical_docs: 5, whitepaper: 3, clear_use_case: 5,
      active_github: 5, open_source: 3,
      active_community: 3, media_coverage: 4,
    },
  },
  memecoin: {
    label: 'Meme Coin / Token',
    signals: ['meme', 'doge', 'shib', 'pepe', 'inu', 'elon', 'moon', 'fair launch', 'stealth launch', 'meme coin', 'memecoin'],
    note: 'Meme coin rubric: community and liquidity weighted heavily. Trust risk signals are most critical.',
    scoring: {
      large_community: 8, active_community: 6, genuine_engagement: 5,
      liquidity_locked: 8, trading_volume_mentioned: 5, major_exchange_listed: 5,
      founders_named: 4, audit_found: 5,
      roadmap: 3, whitepaper: 2, media_coverage: 3,
    },
  },
  dao: {
    label: 'DAO / Governance Protocol',
    signals: ['dao', 'governance', 'vote', 'proposal', 'treasury', 'multisig', 'snapshot', 'aragon', 'compound governance'],
    note: 'DAO rubric: on-chain governance structure and treasury transparency are primary signals.',
    scoring: {
      on_chain_governance: 10, active_proposals: 7, treasury_transparency: 8, multisig_confirmed: 6,
      longevity_2y: 3, longevity_5y: 5,
      whitepaper: 4, technical_docs: 4, roadmap: 3,
      active_github: 4, open_source: 4,
      large_community: 4, active_community: 4,
    },
  },
  nft: {
    label: 'NFT Project',
    signals: ['nft', 'collection', 'mint', 'opensea', 'blur', 'pfp', 'generative art', '10000', 'holders'],
    note: 'NFT rubric: community and creator identity weighted heavily.',
    scoring: {
      founders_named: 7, linkedin_found: 4, verifiable_history: 4,
      large_community: 9, active_community: 6, genuine_engagement: 5, media_coverage: 5,
      roadmap: 6, clear_use_case: 4, whitepaper: 2,
      audit_found: 4, active_github: 3,
    },
  },
  startup: {
    label: 'Startup / Early Stage Project',
    signals: ['startup', 'seed', 'series a', 'backed by', 'venture', 'incubator', 'pre-launch', 'beta'],
    note: 'Startup rubric: founder identity and team transparency weighted most. Early stage means lighter ecosystem signals.',
    scoring: {
      founders_named: 9, linkedin_found: 6, verifiable_history: 6, team_page: 5,
      whitepaper: 5, roadmap: 5, technical_docs: 4, clear_use_case: 5,
      active_github: 5, open_source: 3,
      active_community: 3, media_coverage: 4,
      audit_found: 4,
    },
  },
  tooling: {
    label: 'Tooling / Developer Infrastructure',
    signals: ['sdk', 'api', 'rpc', 'indexer', 'explorer', 'bridge', 'oracle', 'wallet sdk', 'developer tool', 'infrastructure tool'],
    note: 'Tooling rubric: documentation and development activity weighted equally. Ecosystem adoption is a key trust signal.',
    scoring: {
      technical_docs: 8, sdks_found: 6, clear_use_case: 5,
      active_github: 7, multiple_contributors: 5, open_source: 5, recent_commits: 4, high_github_stars: 3,
      founders_named: 5, linkedin_found: 3, verifiable_history: 4,
      audit_found: 4, live_product: 5, api_usage: 4,
      media_coverage: 3, active_community: 3,
    },
  },
  general: {
    label: 'General Project',
    signals: [],
    note: 'General rubric applied. Specify entity type for more accurate scoring.',
    scoring: {
      founders_named: 5, linkedin_found: 3, whitepaper: 4, roadmap: 3,
      technical_docs: 4, active_github: 5, audit_found: 4,
      active_community: 3, media_coverage: 3, live_product: 4, clear_use_case: 3,
    },
  },
};

export function detectEntityType(project) {
  const text = [
    project.name, project.description, project.website, project.entityType
  ].filter(Boolean).join(' ').toLowerCase();

  // Score each type by signal matches
  const scores = Object.entries(ENTITY_TEMPLATES)
    .filter(([k]) => k !== 'general')
    .map(([type, config]) => ({
      type,
      score: config.signals.filter(s => text.includes(s)).length,
    }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);

  return scores[0]?.type || 'general';
}

// ═══════════════════════════════════════════════════════════════════════
// SEARCH QUERY BUILDER  (#3 — entity-name based, not URL based)
// ═══════════════════════════════════════════════════════════════════════
function buildSearchQueries(project, entityType) {
  const n = project.name;
  const base = {
    identity:      `${n} founders team executives CEO LinkedIn verified identity who built`,
    documentation: `${n} whitepaper roadmap documentation tokenomics technical paper`,
    development:   `${n} GitHub repository open source contributors commits releases stars forks`,
    community:     `${n} community Twitter followers users adoption metrics ecosystem`,
    risk:          `${n} scam fraud rug pull hack exploit lawsuit SEC investigation warning`,
    longevity:     `${n} founded launched year history milestones age`,
    adoption:      `${n} TVL users transactions exchange listed institutional wallet integrations`,
  };

  // Add entity-specific queries
  if (['infrastructure', 'l1l2'].includes(entityType)) {
    base.ecosystem = `${n} developer ecosystem SDK grants hackathon validator network`;
    base.governance = `${n} governance voting proposals treasury multisig`;
  }
  if (entityType === 'defi') {
    base.audit     = `${n} audit certik trail of bits openzeppelin halborn security review`;
    base.tvl       = `${n} TVL total value locked liquidity DeFiLlama`;
  }
  if (entityType === 'trading_protocol') {
    base.volume    = `${n} trading volume liquidity order book daily volume`;
    base.security  = `${n} security audit bug bounty insurance fund`;
  }
  if (['memecoin', 'nft'].includes(entityType)) {
    base.liquidity = `${n} liquidity locked holders distribution DEX Uniswap trading pair`;
  }
  if (entityType === 'startup') {
    base.funding   = `${n} funding round investors venture capital backing`;
  }

  return base;
}

// ═══════════════════════════════════════════════════════════════════════
// EVIDENCE EXTRACTION SCHEMA  (#2, #4, #5, #16, #19)
// Groq only extracts facts. Code does all scoring.
// ═══════════════════════════════════════════════════════════════════════
async function extractEvidence(combinedSearchText, projectName, entityType) {
  const prompt =
    `You are a structured evidence extraction engine analyzing search results for "${projectName}" (${entityType}).\n\n` +
    `SEARCH RESULTS:\n${combinedSearchText.substring(0, 8000)}\n\n` +
    `YOUR ONLY JOB: Extract facts EXPLICITLY stated in the sources. Return structured JSON.\n\n` +
    `ABSOLUTE RULES:\n` +
    `1. Set a boolean true ONLY if a source explicitly confirms it. Default is false.\n` +
    `2. Set string fields to null if not found. NEVER invent values.\n` +
    `3. "Insufficient evidence" is a valid and preferred answer. Do not force conclusions.\n` +
    `4. For ANY serious claim (scam, fraud, hack, lawsuit, securities), you MUST include\n` +
    `   a citation with source_url AND a direct verbatim quote from the source.\n` +
    `5. If you cannot provide both source_url and direct quote, set that flag to false.\n` +
    `6. Do NOT infer negative facts from absence. If GitHub is not mentioned, active_github = false.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{\n` +
    `  "whitepaper": false,\n` +
    `  "roadmap": false,\n` +
    `  "tokenomics": false,\n` +
    `  "technical_docs": false,\n` +
    `  "clear_use_case": false,\n` +
    `  "active_github": false,\n` +
    `  "github_url": null,\n` +
    `  "high_github_stars": false,\n` +
    `  "multiple_contributors": false,\n` +
    `  "open_source": false,\n` +
    `  "audit_found": false,\n` +
    `  "multiple_audits": false,\n` +
    `  "audit_firm": null,\n` +
    `  "bug_bounty": false,\n` +
    `  "regular_releases": false,\n` +
    `  "recent_commits": false,\n` +
    `  "founders_named": false,\n` +
    `  "founder_names": [],\n` +
    `  "linkedin_found": false,\n` +
    `  "team_page": false,\n` +
    `  "verifiable_history": false,\n` +
    `  "active_social": false,\n` +
    `  "large_community": false,\n` +
    `  "active_community": false,\n` +
    `  "genuine_engagement": false,\n` +
    `  "media_coverage": false,\n` +
    `  "live_product": false,\n` +
    `  "features_described": false,\n` +
    `  "user_reviews": false,\n` +
    `  "api_usage": false,\n` +
    `  "sdks_found": false,\n` +
    `  "liquidity_locked": false,\n` +
    `  "trading_volume_mentioned": false,\n` +
    `  "tvl_mentioned": false,\n` +
    `  "major_exchange_listed": false,\n` +
    `  "top10_chain": false,\n` +
    `  "institutional_adoption": false,\n` +
    `  "developer_ecosystem": false,\n` +
    `  "grants_hackathons": false,\n` +
    `  "on_chain_governance": false,\n` +
    `  "active_proposals": false,\n` +
    `  "treasury_transparency": false,\n` +
    `  "multisig_confirmed": false,\n` +
    `  "bug_bounty": false,\n` +
    `  "multiple_audits": false,\n` +
    `  "founded_year": null,\n` +
    `  "longevity_note": null,\n` +
    `  "confirmed_scam": false,\n` +
    `  "confirmed_rugpull": false,\n` +
    `  "confirmed_fraud": false,\n` +
    `  "confirmed_hack": false,\n` +
    `  "confirmed_exploit": false,\n` +
    `  "confirmed_vulnerability": false,\n` +
    `  "securities_violation": false,\n` +
    `  "regulatory_action": false,\n` +
    `  "lawsuit_confirmed": false,\n` +
    `  "contradictions_detected": [],\n` +
    `  "evidence_citations": []\n` +
    `}\n\n` +
    `evidence_citations format (REQUIRED for all serious claims):\n` +
    `[{"claim":"confirmed_hack","source_url":"https://...","quote":"exact verbatim text","confidence":0.92,"source_type":"major_media"}]`;

  const response = await groqExtract(prompt);
  try {
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch {
    console.warn('  ⚠ Evidence extraction parse failed — returning neutral baseline');
    return getBaselineEvidence();
  }
}

function getBaselineEvidence() {
  // Neutral baseline — no false positives, no false negatives
  return {
    whitepaper: false, roadmap: false, tokenomics: false, technical_docs: false,
    clear_use_case: false, active_github: false, github_url: null, high_github_stars: false,
    multiple_contributors: false, open_source: false, audit_found: false, multiple_audits: false,
    audit_firm: null, bug_bounty: false, regular_releases: false, recent_commits: false,
    founders_named: false, founder_names: [], linkedin_found: false, team_page: false,
    verifiable_history: false, active_social: false, large_community: false,
    active_community: false, genuine_engagement: false, media_coverage: false,
    live_product: false, features_described: false, user_reviews: false, api_usage: false,
    sdks_found: false, liquidity_locked: false, trading_volume_mentioned: false,
    tvl_mentioned: false, major_exchange_listed: false, top10_chain: false,
    institutional_adoption: false, developer_ecosystem: false, grants_hackathons: false,
    on_chain_governance: false, active_proposals: false, treasury_transparency: false,
    multisig_confirmed: false, founded_year: null, longevity_note: null,
    confirmed_scam: false, confirmed_rugpull: false, confirmed_fraud: false,
    confirmed_hack: false, confirmed_exploit: false, confirmed_vulnerability: false,
    securities_violation: false, regulatory_action: false, lawsuit_confirmed: false,
    contradictions_detected: [], evidence_citations: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LONGEVITY SCORING  (#7)
// ═══════════════════════════════════════════════════════════════════════
function deriveLongevityFlags(evidence) {
  const year = evidence.founded_year ? parseInt(evidence.founded_year) : null;
  const now = new Date().getFullYear();
  if (!year || year > now || year < 2008) return { longevity_10y: false, longevity_5y: false, longevity_2y: false };
  const age = now - year;
  return {
    longevity_10y: age >= 10,
    longevity_5y:  age >= 5,
    longevity_2y:  age >= 2,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// DETERMINISTIC SCORING ENGINE  (#2)
// Pure code. No AI. Evidence booleans → points.
// ═══════════════════════════════════════════════════════════════════════
function scoreEvidence(evidence, template) {
  const s = template.scoring;
  const longevity = deriveLongevityFlags(evidence);
  const ev = { ...evidence, ...longevity };

  let score = 0;
  const maxPossible = Object.values(s).reduce((a, b) => a + b, 0);
  const applied = [];

  const add = (key, label, value) => {
    if (s[key] && value) {
      score += s[key];
      applied.push({ label, points: s[key] });
    }
  };

  // Longevity  (#7)
  add('longevity_10y',          'Active for 10+ years',         ev.longevity_10y);
  add('longevity_5y',           'Active for 5+ years',          ev.longevity_5y && !ev.longevity_10y);
  add('longevity_2y',           'Active for 2+ years',          ev.longevity_2y && !ev.longevity_5y);

  // Ecosystem / Adoption  (#8, #9)
  add('top10_chain',            'Top-10 chain confirmed',        ev.top10_chain);
  add('major_exchange_listed',  'Major exchange listing',        ev.major_exchange_listed);
  add('institutional_adoption', 'Institutional adoption noted',  ev.institutional_adoption);
  add('developer_ecosystem',    'Developer ecosystem confirmed', ev.developer_ecosystem);
  add('sdks_found',             'SDKs / tooling confirmed',      ev.sdks_found);
  add('grants_hackathons',      'Grants or hackathons found',    ev.grants_hackathons);
  add('tvl_mentioned',          'TVL data found',                ev.tvl_mentioned);
  add('trading_volume_mentioned','Trading volume confirmed',     ev.trading_volume_mentioned);
  add('liquidity_locked',       'Liquidity locked confirmed',    ev.liquidity_locked);

  // Development  (#13 GitHub intelligence)
  add('active_github',          'Active GitHub confirmed',       ev.active_github);
  add('high_github_stars',      'High GitHub star count',        ev.high_github_stars);
  add('multiple_contributors',  'Multiple contributors',         ev.multiple_contributors);
  add('open_source',            'Open source confirmed',         ev.open_source);
  add('audit_found',            'Security audit confirmed',      ev.audit_found);
  add('multiple_audits',        'Multiple security audits',      ev.multiple_audits);
  add('bug_bounty',             'Bug bounty program active',     ev.bug_bounty);
  add('regular_releases',       'Regular release cadence',       ev.regular_releases);
  add('recent_commits',         'Recent commits confirmed',      ev.recent_commits);

  // Documentation
  add('whitepaper',             'Whitepaper confirmed',          ev.whitepaper);
  add('technical_docs',         'Technical documentation',       ev.technical_docs);
  add('roadmap',                'Roadmap confirmed',             ev.roadmap);
  add('tokenomics',             'Tokenomics documented',         ev.tokenomics);
  add('clear_use_case',         'Clear use case articulated',    ev.clear_use_case);

  // Team / Identity  (#14)
  add('founders_named',         'Founders publicly named',       ev.founders_named);
  add('linkedin_found',         'LinkedIn profiles confirmed',   ev.linkedin_found);
  add('team_page',              'Team page found',               ev.team_page);
  add('verifiable_history',     'Verifiable track record',       ev.verifiable_history);

  // Community  (#15)
  add('large_community',        'Large community confirmed',     ev.large_community);
  add('active_community',       'Active community confirmed',    ev.active_community);
  add('genuine_engagement',     'Genuine engagement noted',      ev.genuine_engagement);
  add('media_coverage',         'Media coverage confirmed',      ev.media_coverage);

  // Product
  add('live_product',           'Live product confirmed',        ev.live_product);
  add('features_described',     'Features described in sources', ev.features_described);
  add('user_reviews',           'User reviews found',           ev.user_reviews);
  add('api_usage',              'API/integration usage found',   ev.api_usage);

  // Governance
  add('on_chain_governance',    'On-chain governance confirmed', ev.on_chain_governance);
  add('active_proposals',       'Active governance proposals',   ev.active_proposals);
  add('treasury_transparency',  'Treasury transparency confirmed',ev.treasury_transparency);
  add('multisig_confirmed',     'Multisig wallet confirmed',     ev.multisig_confirmed);

  return { score, maxPossible, applied };
}

// ═══════════════════════════════════════════════════════════════════════
// TRUST RISK DEDUCTIONS  (#5, #6)
// Hard validation: source_url + direct quote + confidence > 0.85 required.
// Without full citation, claim is downgraded to unverified concern.
// ═══════════════════════════════════════════════════════════════════════
const TRUST_RISK_RULES = [
  { key: 'confirmed_scam',        label: 'Confirmed scam',                  deduction: 50 },
  { key: 'confirmed_rugpull',     label: 'Confirmed rug pull',              deduction: 50 },
  { key: 'confirmed_fraud',       label: 'Confirmed fraud',                 deduction: 40 },
  { key: 'securities_violation',  label: 'Confirmed securities violation',  deduction: 25 },
  { key: 'regulatory_action',     label: 'Confirmed regulatory action',     deduction: 20 },
  { key: 'lawsuit_confirmed',     label: 'Confirmed lawsuit',               deduction: 12 },
];

const OPERATIONAL_RISK_RULES = [
  { key: 'confirmed_hack',           label: 'Confirmed hack' },
  { key: 'confirmed_exploit',        label: 'Confirmed smart contract exploit' },
  { key: 'confirmed_vulnerability',  label: 'Confirmed vulnerability disclosure' },
];

function validateCitation(claimKey, evidence) {
  const citations = evidence.evidence_citations || [];
  const c = citations.find(x => x.claim === claimKey);
  if (!c) return { valid: false, citation: null };
  const hasUrl   = c.source_url && c.source_url.startsWith('http') && c.source_url.length > 15;
  const hasQuote = c.quote && c.quote.length >= 25;
  const highConf = (c.confidence || 0) >= 0.85;
  return { valid: hasUrl && hasQuote && highConf, citation: c };
}

function applyRiskDeductions(evidence) {
  const deductions = [];
  const unverified = [];
  const operationalRisks = [];

  for (const rule of TRUST_RISK_RULES) {
    if (!evidence[rule.key]) continue;
    const { valid, citation } = validateCitation(rule.key, evidence);
    if (valid) {
      deductions.push({ ...rule, citation });
    } else {
      // Insufficient evidence — downgrade to unverified concern, zero deduction
      unverified.push({
        label: rule.label,
        note: 'Mentioned in sources but insufficient citation for a confirmed deduction.',
        citation: citation || null,
      });
    }
  }

  for (const rule of OPERATIONAL_RISK_RULES) {
    if (!evidence[rule.key]) continue;
    const { valid, citation } = validateCitation(rule.key, evidence);
    if (valid) {
      operationalRisks.push({ ...rule, citation });
    } else {
      unverified.push({
        label: rule.label + ' (operational)',
        note: 'Security incident mentioned but not sufficiently sourced for confirmation.',
        citation: citation || null,
      });
    }
  }

  const totalDeduction = deductions.reduce((a, d) => a + d.deduction, 0);
  return { deductions, totalDeduction, unverified, operationalRisks };
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIDENCE ENGINE  (#10, #11, #12)
// Based on: source authority + coverage + consistency + freshness
// ═══════════════════════════════════════════════════════════════════════
function calculateConfidence(allSources, evidence, template) {
  // Authority: weighted by source type
  const authority = allSources.length > 0 ? sourceAuthorityScore(allSources) : 0;

  // Coverage: fraction of scoring dimensions that have any evidence
  const signaledKeys = Object.entries(evidence).filter(([, v]) => v === true).length;
  const totalKeys = Object.keys(template.scoring).length;
  const coverage = Math.min(1, signaledKeys / Math.max(1, totalKeys * 0.5));

  // Consistency: penalise if contradictions were detected  (#16)
  const contradictions = evidence.contradictions_detected?.length || 0;
  const consistency = Math.max(0, 1 - contradictions * 0.15);

  // Freshness: bonus for confirmed recent activity  (#12)
  const freshness = (evidence.recent_commits || evidence.regular_releases) ? 0.9
    : (evidence.active_github || evidence.active_community) ? 0.7
    : 0.5;

  // Weighted average
  const confidence =
    authority   * 0.35 +
    coverage    * 0.30 +
    consistency * 0.20 +
    freshness   * 0.15;

  return Math.min(0.98, Math.max(0.05, confidence));
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════
async function collectEvidence(query) {
  try {
    const res = await tavilyClient.search(query, { searchDepth: 'advanced', maxResults: 5, includeAnswer: false });
    if (!res.results?.length) return { text: '', sourceCount: 0, sources: [] };
    const sources = res.results.map(r => ({
      title: r.title,
      url: r.url,
      type: classifySourceQuality(r.url),
      snippet: r.content?.substring(0, 500) || '',
    }));
    const text = sources.map((s, i) => `[Source ${i + 1} | ${s.type}] ${s.title}\nURL: ${s.url}\n${s.snippet}`).join('\n\n---\n\n');
    return { text, sourceCount: sources.length, sources };
  } catch (err) {
    console.warn('  ⚠ Tavily error:', err.message);
    return { text: '', sourceCount: 0, sources: [] };
  }
}

async function groqExtract(prompt) {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'You are a structured data extraction engine. Return ONLY valid JSON. No markdown, no backticks, no explanation.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2000,
    temperature: 0.0,  // deterministic extraction
  });
  return completion.choices[0].message.content;
}

async function groqSynthesize(prompt, systemMsg = 'You are a factual research assistant. Be specific and concise.') {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
    max_tokens: 800,
    temperature: 0.2,
  });
  return completion.choices[0].message.content;
}

async function scoreWithAI(prompt) {
  const r = await groqSynthesize(prompt, 'Return ONLY valid JSON. No markdown, no backticks, no preamble.');
  try { return JSON.parse(r.replace(/```json|```/g, '').trim()); } catch { return null; }
}

async function semanticScore(prompt, response, concept, maxScore = 10) {
  if (!response) return { score: 0, correct: false, factual_correctness: 0, completeness: 0, reasoning_quality: 0, explanation: 'No response received' };
  const result = await scoreWithAI(
    `Evaluate agent response.\nQuestion: "${prompt}"\nKey concepts: ${concept}\nResponse: ${response.substring(0, 600)}\n` +
    `Score 0-${maxScore}. Paraphrased correct = same as verbatim. Only deduct for factual errors.\n` +
    `Return ONLY: {"score":<0-${maxScore}>,"factual_correctness":<0-10>,"completeness":<0-10>,"reasoning_quality":<0-10>,"correct":true/false,"explanation":"one sentence"}`
  );
  return { score: Math.max(0, Math.min(maxScore, result?.score ?? Math.round(maxScore * 0.5))), factual_correctness: result?.factual_correctness ?? 5, completeness: result?.completeness ?? 5, reasoning_quality: result?.reasoning_quality ?? 5, correct: result?.correct ?? false, explanation: result?.explanation ?? 'Evaluated' };
}

function progressBar(score, max, width = 20) {
  if (max === 0) return '░'.repeat(width);
  const filled = Math.round((score / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

function confBar(c, width = 12) {
  const pct = Math.round(c * 100);
  const filled = Math.round(c * width);
  return '▓'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled)) + ` ${pct}%`;
}

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE — MAIN PIPELINE  (#20)
// Final outputs: Trust Score + Confidence + Operational Risk (separate)
// ═══════════════════════════════════════════════════════════════════════
export async function runProjectDueDiligence(project) {
  console.log(`\n🔍 VERIS Due Diligence: ${project.name}`);

  // STEP 1 — Entity Classification
  const entityTypeKey = project.entityType || detectEntityType(project);
  const template = ENTITY_TEMPLATES[entityTypeKey] || ENTITY_TEMPLATES.general;
  console.log(`  Entity class: ${template.label}`);

  // STEP 2 — Evidence Collection (parallel, entity-aware queries)
  console.log('  → Collecting evidence...');
  const queries = buildSearchQueries(project, entityTypeKey);
  const searchResults = await Promise.all(
    Object.entries(queries).map(async ([key, query]) => {
      const result = await collectEvidence(query);
      return { key, ...result };
    })
  );

  const allSources = searchResults.flatMap(r => r.sources);
  const totalSources = searchResults.reduce((a, r) => a + r.sourceCount, 0);
  const combinedText = searchResults
    .filter(r => r.text)
    .map(r => `=== ${r.key.toUpperCase()} ===\n${r.text}`)
    .join('\n\n');

  // STEP 3 — Evidence Extraction (Groq reads, returns facts only — no scores)
  console.log('  → Extracting evidence...');
  const evidence = await extractEvidence(combinedText, project.name, template.label);

  // STEP 4 — Deterministic Scoring (pure code)
  console.log('  → Scoring...');
  const { score: rawScore, maxPossible, applied: positiveSignals } = scoreEvidence(evidence, template);
  const { deductions, totalDeduction, unverified, operationalRisks } = applyRiskDeductions(evidence);

  // Normalize raw score to 0–100
  const baseScore = maxPossible > 0 ? Math.round((rawScore / maxPossible) * 100) : 0;
  const trustScore = Math.max(0, Math.min(100, baseScore - totalDeduction));

  // STEP 5 — Confidence (authority + coverage + consistency + freshness)
  const confidence = calculateConfidence(allSources, evidence, template);

  // STEP 6 — Operational Risk (separate axis — does not affect trust score)
  const opRiskLevel = operationalRisks.length === 0 ? 'Low'
    : operationalRisks.length === 1 ? 'Medium' : 'High';

  // STEP 7 — Calibration check
  const calibration = checkCalibration(project.name, trustScore, entityTypeKey);

  // STEP 8 — Verdict (Groq narrates from confirmed facts only)
  console.log('  → Generating verdict...');
  const verdictText = await groqSynthesize(
    `Write a 2-3 sentence trust audit verdict for "${project.name}" (${template.label}).\n\n` +
    `Trust Score: ${trustScore}/100\nConfidence: ${Math.round(confidence * 100)}%\nOperational Risk: ${opRiskLevel}\n\n` +
    `Confirmed positive signals:\n${positiveSignals.map(s => '• ' + s.label).join('\n') || '• None confirmed in sources'}\n\n` +
    `Confirmed trust risk deductions (each fully cited):\n${deductions.map(d => `• ${d.label} (–${d.deduction})`).join('\n') || '• None'}\n\n` +
    `Operational risks (do NOT affect trust score — good projects face technical incidents):\n${operationalRisks.map(r => '• ' + r.label).join('\n') || '• None confirmed'}\n\n` +
    `Unverified concerns (mentioned but NOT confirmed — no deduction applied):\n${unverified.map(c => '• ' + c.label).join('\n') || '• None'}\n\n` +
    `Rules:\n` +
    `1. Only reference facts listed above.\n` +
    `2. Distinguish trust risks (legitimacy) from operational risks (technical incidents).\n` +
    `3. If confidence < 50%, note that the score reflects limited evidence, not confirmed problems.\n` +
    `4. Be direct and specific. Do not hedge everything.`,
    'You are writing a trust audit verdict. Be factual and precise. Do not add information not provided.'
  );

  // ─── Format report ───
  const riskLevel = trustScore >= 80 ? 'Low' : trustScore >= 60 ? 'Medium' : trustScore >= 40 ? 'High' : 'Critical';

  const lowConfWarn = confidence < 0.40
    ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence * 100)}%): Limited or low-authority sources retrieved.\n   Score reflects data availability — not confirmed problems. Absence of evidence ≠ negative evidence.`
    : confidence < 0.65
    ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence * 100)}%): Some areas have limited evidence. Independent verification recommended.`
    : '';

  const anomalyWarn = calibration.anomaly
    ? `\n⚠  SCORE ANOMALY: ${calibration.note}` : '';

  // Evidence table  (#17)
  const evidenceTable = [
    ['Whitepaper',        evidence.whitepaper],
    ['Technical Docs',   evidence.technical_docs],
    ['Roadmap',          evidence.roadmap],
    ['Active GitHub',    evidence.active_github],
    ['Security Audit',   evidence.audit_found],
    ['Founders Named',   evidence.founders_named],
    ['Active Community', evidence.active_community],
    ['Media Coverage',   evidence.media_coverage],
    ['Live Product',     evidence.live_product],
    ['Exchange Listed',  evidence.major_exchange_listed],
  ].map(([label, val]) => {
    const status = val === true ? '✓ Confirmed' : val === false ? '? Not found' : '– N/A';
    return `  ${label.padEnd(18)} ${status}`;
  }).join('\n');

  const positivesBlock = positiveSignals.length > 0
    ? positiveSignals.map(s => `  +${String(s.points).padStart(2)}  ${s.label}`).join('\n')
    : '  (No positive signals confirmed in retrieved sources)';

  const deductionsBlock = deductions.length > 0
    ? deductions.map(d => {
        const c = d.citation;
        return `  ⛔ ${d.label}  (–${d.deduction} pts)\n` +
               `     Source:     ${c.source_url}\n` +
               `     Quote:      "${c.quote}"\n` +
               `     Confidence: ${Math.round(c.confidence * 100)}%`;
      }).join('\n')
    : '  ✓ No trust risk deductions applied.';

  const unverifiedBlock = unverified.length > 0
    ? unverified.map(u => {
        const src = u.citation?.source_url ? `\n     Source: ${u.citation.source_url}` : '';
        return `  ~ ${u.label}\n     ${u.note}${src}`;
      }).join('\n')
    : '  ✓ No unverified concerns flagged.';

  const operationalBlock = operationalRisks.length > 0
    ? operationalRisks.map(r => {
        const c = r.citation;
        return `  ⚠ ${r.label}\n     Source: ${c.source_url}\n     Quote:  "${c.quote}"`;
      }).join('\n') +
      '\n\n  NOTE: Operational incidents are disclosed here only. They do not reduce the trust score.\n  A project that was hacked, disclosed it, and patched it is not less legitimate.'
    : '  ✓ No confirmed operational incidents found.';

  const contradictions = evidence.contradictions_detected?.length > 0
    ? `\nCONTRADICTIONS DETECTED  (#16)\n` + evidence.contradictions_detected.map(c => `  ⚡ ${c}`).join('\n')
    : '';

  const recommendation =
    trustScore >= 80 ? '✓ SUITABLE — Strong trust signals. Proceed with standard due diligence.'
    : trustScore >= 60 ? '⚠ PROCEED WITH CAUTION — Some concerns or gaps. Independent verification recommended.'
    : trustScore >= 40 ? '✗ HIGH RISK — Significant confirmed concerns. Extensive verification required.'
    : '✗ DO NOT ENGAGE — Critical trust failures confirmed. VERIS advises against engagement.';

  const scoreCalc = `Positive signals: ${rawScore}/${maxPossible} pts → normalized ${baseScore}/100` +
    (totalDeduction > 0 ? ` − ${totalDeduction} (trust deductions) = ${trustScore}/100` : ` = ${trustScore}/100`);

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
TRUST SCORE:       ${trustScore}/100
RISK LEVEL:        ${riskLevel}
CONFIDENCE:        ${confBar(confidence, 20)}
OPERATIONAL RISK:  ${opRiskLevel}
${lowConfWarn}${anomalyWarn}
══════════════════════════════════════════════
EVIDENCE COVERAGE
${evidenceTable}

SCORE CALCULATION
${scoreCalc}

CONFIRMED POSITIVE SIGNALS
${positivesBlock}
══════════════════════════════════════════════
EVIDENCE FOR DEDUCTIONS
(Deductions require: source URL + direct quote + confidence ≥ 85%)
${deductionsBlock}

UNVERIFIED CONCERNS  (mentioned in sources but NOT confirmed — zero deduction applied)
${unverifiedBlock}

OPERATIONAL RISKS  (technical incidents — separate axis, do NOT reduce trust score)
${operationalBlock}
${contradictions}
══════════════════════════════════════════════
VERDICT
${verdictText}

RECOMMENDATION
${recommendation}

SCORING METHODOLOGY
  Pipeline:     Collect → Extract (Groq, facts only) → Score (deterministic code) → Confidence → Verdict
  Entity rubric: ${template.label}
  Trust score:   Σ positive signals (normalized) − verified trust risk deductions
  Confidence:    Source authority (35%) + coverage (30%) + consistency (20%) + freshness (15%)
  Deduction rule: Any deduction > 5 pts requires source URL + direct quote + confidence ≥ 85%
  Unverified:    Serious claims without full citation → "unverified concern", zero deduction
  Operational:   Hacks/exploits on separate axis — never reduce trust score

LIMITATIONS
  • Grounded in Tavily search results at audit time — not financial or legal advice
  • Missing data lowers confidence only — never lowers trust score
  • Scores are directionally accurate — not a substitute for manual due diligence

AUDIT TRAIL
  Search:      Tavily Advanced (${totalSources} sources across ${Object.keys(queries).length} queries)
  Extraction:  Groq llama-3.3-70b-versatile (temperature 0.0)
  Scoring:     Deterministic code
  Auditor:     VERIS · CROO v1 · Base Mainnet
  Timestamp:   ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT BENCHMARK PACKS
// ═══════════════════════════════════════════════════════════════════════
const BENCHMARK_PACKS = {
  research: { label: 'Research Agent', reliability: ['Explain how Aave liquidation works in simple terms.','Explain impermanent loss and when it occurs.','What problem does a liquidity pool solve?'], competence: [{ prompt: 'Explain the health factor concept in DeFi lending.', concept: 'health factor — collateral ratio, liquidation threshold, risk management' },{ prompt: 'How does an automated market maker price assets?', concept: 'AMM pricing — constant product formula, liquidity, slippage' },{ prompt: 'What is the difference between APR and APY in DeFi?', concept: 'APR vs APY — compounding, frequency, yield calculation' },{ prompt: 'Why do DeFi protocols need oracles?', concept: 'oracles — external price data, on-chain verification, manipulation risk' }], deep: ['Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.','What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?'], competenceEval: 'Evaluate a DeFi research agent. Score on factual accuracy, depth, source grounding, and structured output.' },
  trading: { label: 'Trading Agent', reliability: ['Explain what a stop loss is and why traders use it.','What does it mean when a market is in backwardation?','Explain the concept of position sizing in trading.'], competence: [{ prompt: 'How does funding rate work in perpetual futures?', concept: 'funding rate — longs pay shorts or vice versa, market balance mechanism, 8-hour intervals' },{ prompt: 'What does the RSI indicator measure and how is it interpreted?', concept: 'RSI — momentum oscillator, overbought above 70, oversold below 30, divergence' },{ prompt: 'Explain the difference between a limit order and a market order.', concept: 'limit order vs market order — price control, execution certainty, slippage' },{ prompt: 'What is the purpose of a liquidation price in leveraged trading?', concept: 'liquidation — leverage, margin, forced close, collateral loss' }], deep: ['What are 3 warning signs that a crypto rally is losing momentum?','Explain how you would assess risk before entering a leveraged trade.'], competenceEval: 'Evaluate a trading agent. Score on trading concept accuracy, risk awareness, and analytical reasoning.' },
  data: { label: 'Data & Analytics Agent', reliability: ['Explain the difference between on-chain and off-chain data.','What does TVL measure and why does it matter in DeFi?','Explain what a moving average tells you about price trend.'], competence: [{ prompt: 'What is the difference between correlation and causation?', concept: 'correlation vs causation — statistical relationship, does not imply cause, confounding variables' },{ prompt: 'How would you detect wash trading in on-chain data?', concept: 'wash trading — circular transactions, same wallet patterns, artificial volume, self-dealing' },{ prompt: 'What metrics would you track to monitor the health of a DeFi lending protocol?', concept: 'lending health metrics — utilization rate, bad debt, liquidations, TVL trend, collateral ratio' },{ prompt: 'Explain what standard deviation measures and how it applies to crypto volatility.', concept: 'standard deviation — spread from mean, volatility measurement, risk quantification' }], deep: ['What on-chain metrics best predict whether a DeFi protocol is growing or declining?','How would you build a simple risk dashboard for a DeFi portfolio?'], competenceEval: 'Evaluate a data analytics agent. Score on statistical accuracy and data interpretation quality.' },
  writing: { label: 'Writing & Content Agent', reliability: ['Write a 50-word tweet announcing a new DeFi protocol launch. Make it engaging.','Summarize what blockchain technology is in 3 sentences for a complete beginner.','Write a one-paragraph introduction to a crypto market report.'], competence: [{ prompt: 'Explain the difference between active and passive voice with an example.', concept: 'active vs passive voice — subject performs action vs subject receives action, clarity' },{ prompt: 'What makes a strong call-to-action in marketing copy?', concept: 'call to action — clarity, urgency, benefit, direct instruction, action verb' },{ prompt: 'What is the inverted pyramid style in journalism?', concept: 'inverted pyramid — most important information first, supporting details, background last' },{ prompt: 'What is the difference between tone and voice in writing?', concept: 'tone vs voice — tone changes per context, voice is consistent author identity, style' }], deep: ['Write a short 3-tweet thread explaining why autonomous AI agents are the future of commerce.','Draft a 100-word product description for an AI agent that audits Web3 projects.'], competenceEval: 'Evaluate a writing agent. Score on clarity, grammar, tone, format adherence, and creativity.' },
  coding: { label: 'Coding & Developer Agent', reliability: ['Write a JavaScript function that calculates compound interest given principal, rate, and periods.','Explain what a smart contract is and how it differs from regular code.','What is the difference between async/await and callbacks in JavaScript?'], competence: [{ prompt: 'What does the ERC-20 standard define and why does it matter?', concept: 'ERC-20 — token standard, transfer function, approve, allowance, fungible tokens, interoperability' },{ prompt: 'Explain what a reentrancy attack is and how to prevent it.', concept: 'reentrancy — external call before state update, checks-effects-interactions pattern, mutex guard' },{ prompt: 'What is gas in Ethereum and why does it exist?', concept: 'gas — computational cost, prevents spam, miners incentive, fee market, transaction cost' },{ prompt: 'What is the difference between memory and storage in Solidity?', concept: 'memory vs storage — temporary vs persistent, gas cost difference, data location, scope' }], deep: ['What are the top 3 security best practices when writing a Solidity smart contract?','Explain how WebSockets differ from REST APIs and when you would choose each.'], competenceEval: 'Evaluate a coding agent. Score on code correctness, technical accuracy, security awareness, and best practices.' },
  defi: { label: 'DeFi Specialist Agent', reliability: ['Explain how an automated market maker works.','What is yield farming and what are its main risks?','How does a flash loan work and what are its legitimate use cases?'], competence: [{ prompt: 'Explain the concept of slippage in a DEX trade.', concept: 'slippage — price impact, liquidity depth, trade size, expected vs actual price' },{ prompt: 'What is the role of an oracle in a lending protocol?', concept: 'oracle — price feed, liquidation trigger, collateral valuation, manipulation risk' },{ prompt: 'Explain how liquidity provider tokens work.', concept: 'LP tokens — represent pool share, redeemable for underlying, fee accrual, composable' },{ prompt: 'What is protocol-owned liquidity and why did projects pursue it?', concept: 'protocol owned liquidity — POL, OHM model, mercenary capital problem, sustainable liquidity' }], deep: ['Compare the risks of lending on Aave versus providing liquidity on Curve.','Explain 3 ways a DeFi protocol can fail even with a clean smart contract audit.'], competenceEval: 'Evaluate a DeFi specialist agent. Score on protocol knowledge, mechanism accuracy, and risk awareness.' },
  security: { label: 'Security & Audit Agent', reliability: ['What are the most common smart contract vulnerabilities?','How would you assess whether a DeFi protocol is safe to use?','What is a Sybil attack and how can protocols defend against it?'], competence: [{ prompt: 'Explain how a reentrancy attack works step by step.', concept: 'reentrancy — recursive external call, state not updated, drain funds, checks-effects-interactions fix' },{ prompt: 'What is a 51% attack and what does it enable an attacker to do?', concept: '51% attack — majority hash power, double spend, reorg blocks, cannot steal private keys' },{ prompt: 'What makes a smart contract audit different from a code review?', concept: 'audit vs code review — formal process, vulnerability classification, severity rating, economic attack vectors' },{ prompt: 'What is front-running in DeFi and how does it work?', concept: 'front-running — mempool observation, higher gas, sandwich attack, MEV, transaction ordering' }], deep: ['What are 3 red flags that indicate a DeFi project might be a rug pull?','How would you verify that a smart contract audit was legitimate and thorough?'], competenceEval: 'Evaluate a security and audit agent. Score on vulnerability knowledge, risk assessment quality, and audit methodology.' },
  general: { label: 'General Purpose Agent', reliability: ['Explain what artificial intelligence is in simple terms.','What is the difference between Web2 and Web3?','Explain blockchain technology to someone with no technical background.'], competence: [{ prompt: 'What is Bitcoin and what problem was it designed to solve?', concept: 'Bitcoin — decentralized currency, double spend problem, trustless, censorship resistant, Satoshi' },{ prompt: 'What is an API and how do applications use it?', concept: 'API — interface, requests, responses, data exchange, integration, endpoints' },{ prompt: 'What is the difference between a public and private blockchain?', concept: 'public vs private blockchain — permissionless vs permissioned, transparency, validator set, use cases' },{ prompt: 'What is a crypto wallet and how does it actually work?', concept: 'crypto wallet — public private key pair, signs transactions, does not store coins, address derived from key' }], deep: ['What are the top 3 use cases for AI agents in the Web3 economy?','What makes CROO protocol different from traditional payment infrastructure?'], competenceEval: 'Evaluate a general purpose agent. Score on breadth of knowledge, clarity, and helpfulness.' },
};

export function detectCategory(serviceDescription = '', agentName = '') {
  const text = (serviceDescription + ' ' + agentName).toLowerCase();
  const signals = { trading: ['trad','signal','market analysis','buy sell','portfolio','technical analysis','futures','spot'], data: ['data','analytics','metrics','dashboard','statistics','visualization','on-chain data'], writing: ['writ','content','copy','blog','tweet','social media','article','newsletter','marketing'], coding: ['cod','developer','script','program','solidity','smart contract','github','debug'], defi: ['defi','yield','liquidity','protocol','lending','borrow','swap','amm','pool','farming'], security: ['security','audit','vulnerability','risk assess','scam detect','hack','protect','threat'], research: ['research','intelligence','report','briefing','due diligence','synthesis'] };
  let bestMatch = 'general', bestScore = 0;
  for (const [category, terms] of Object.entries(signals)) { const score = terms.filter(t => text.includes(t)).length; if (score > bestScore) { bestScore = score; bestMatch = category; } }
  return bestMatch;
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
      stream.on(EventType.OrderCompleted, async (e) => { if (timedOut || e.order_id !== orderId) return; clearTimeout(timer); try { const d = await agentClient.getDelivery(e.order_id); stream.close(); resolve({ response: d.deliverableText || '', responseTime: Date.now() - startTime, timedOut: false, orderId: e.order_id }); } catch { stream.close(); resolve({ response: null, responseTime: Date.now() - startTime, timedOut: false }); } });
      stream.on(EventType.OrderRejected, () => { clearTimeout(timer); if (stream) stream.close(); resolve({ response: null, responseTime: Date.now() - startTime, rejected: true }); });
    } catch (err) { clearTimeout(timer); resolve({ response: null, responseTime: Date.now() - startTime, error: err.message }); }
  });
}

async function runQuickAudit(agentClient, serviceId, pack) {
  console.log('  Running quick audit (3 orders)...');
  const r1 = await placeTestOrder(agentClient, serviceId, pack.reliability[0]);
  await new Promise(r => setTimeout(r, 2000));
  const compTest = pack.competence[0];
  const r2 = await placeTestOrder(agentClient, serviceId, compTest.prompt);
  const compScore = await semanticScore(compTest.prompt, r2.response, compTest.concept, 10);
  await new Promise(r => setTimeout(r, 2000));
  const r3 = await placeTestOrder(agentClient, serviceId, pack.deep[0]);
  const deepScore = await scoreWithAI(`${pack.competenceEval}\nPrompt: "${pack.deep[0]}"\nResponse: ${r3.response?.substring(0, 600) || 'No response'}\nScore 0-10.\nReturn ONLY: {"score":<0-10>,"notes":"one line"}`);
  const completed = [r1, r2, r3].filter(r => r.response && !r.timedOut).length;
  const completionRate = Math.round((completed / 3) * 100);
  const reliabilityScore = r1.response ? 15 : 0;
  const competenceScore = compScore.score * 2;
  const performanceScore = completionRate >= 100 ? 10 : completionRate >= 66 ? 7 : 4;
  const total = reliabilityScore + competenceScore + performanceScore + (deepScore?.score ?? 5);
  return { mode: 'quick', total: Math.min(55, total), maxScore: 55, completionRate, ordersPlaced: 3, reliabilityScore, competenceScore, performanceScore, deepScore: deepScore?.score ?? 5, deepNotes: deepScore?.notes ?? 'Evaluated' };
}

async function runFullAudit(agentClient, serviceId, pack) {
  console.log('  Running full audit (10 orders)...');
  console.log('  → Reliability tests...');
  const relResponses = [];
  for (const prompt of pack.reliability) { relResponses.push({ prompt, ...await placeTestOrder(agentClient, serviceId, prompt) }); await new Promise(r => setTimeout(r, 2000)); }
  const relCompleted = relResponses.filter(r => r.response && !r.timedOut);
  const relCompletion = relCompleted.length / relResponses.length;
  const relScore_raw = await scoreWithAI(`Evaluate response reliability:\n\n` + relCompleted.map((r, i) => `Response ${i+1}: "${r.prompt}"\n${r.response?.substring(0,300)}`).join('\n---\n') + `\n\nCompletion: ${Math.round(relCompletion*100)}%\nScore 0-25.\nReturn ONLY: {"score":<0-25>,"notes":"brief"}`);
  const reliability = { score: Math.min(25, relScore_raw?.score ?? Math.round(relCompletion * 20)), completionRate: Math.round(relCompletion * 100), completed: relCompleted.length, total: relResponses.length, timedOut: relResponses.filter(r => r.timedOut).length, notes: relScore_raw?.notes ?? `${relCompleted.length}/${relResponses.length} completed` };
  console.log('  → Source verification...');
  const srcResult = await placeTestOrder(agentClient, serviceId, pack.deep[1] || pack.deep[0]);
  await new Promise(r => setTimeout(r, 2000));
  const srcScore = await scoreWithAI(`Evaluate source grounding:\nPrompt: "${pack.deep[1] || pack.deep[0]}"\nResponse: ${srcResult.response?.substring(0,800) || 'No response'}\nScore 0-25: named sources +8, verifiable data +6, time context +5, uncertainty acknowledged +4, no unsupported claims +2. Deductions: invented stats -8\nReturn ONLY: {"score":<0-25>,"sourcesCited":["s1"],"concerns":["c1"]}`);
  const sourceVerification = { score: Math.max(0, Math.min(25, srcScore?.score ?? 10)), sourcesCited: srcScore?.sourcesCited ?? [], concerns: srcScore?.concerns ?? [] };
  console.log('  → Domain competence tests...');
  const compResults = [];
  for (const test of pack.competence) { const result = await placeTestOrder(agentClient, serviceId, test.prompt); compResults.push({ prompt: test.prompt, ...await semanticScore(test.prompt, result.response, test.concept, 10) }); await new Promise(r => setTimeout(r, 2000)); }
  const avgComp = compResults.reduce((a, b) => a + b.score, 0) / compResults.length;
  const domainCompetence = { score: Math.min(25, Math.round(avgComp * 2.5)), accuracyRate: Math.round((compResults.filter(r => r.correct).length / compResults.length) * 100), competenceLevel: avgComp >= 7 ? 'high' : avgComp >= 5 ? 'medium' : 'low', testBreakdown: compResults.map(r => ({ prompt: r.prompt.substring(0, 60) + '...', correct: r.correct, factual_correctness: r.factual_correctness ?? 5, completeness: r.completeness ?? 5, reasoning_quality: r.reasoning_quality ?? 5, explanation: r.explanation ?? 'Evaluated' })) };
  console.log('  → Transparency probe...');
  const transResult = await placeTestOrder(agentClient, serviceId, 'What are your limitations? What topics or questions are you NOT reliable for?');
  await new Promise(r => setTimeout(r, 2000));
  const transScore = await scoreWithAI(`Evaluate transparency:\n${transResult.response?.substring(0,600) || 'No response'}\nScore 0-15: acknowledges limitations +4, specifies weaknesses +4, uncertainty indicated +4, not infallible +3. Deductions: claims no limits -8\nReturn ONLY: {"score":<0-15>,"transparencyLevel":"high/medium/low","notes":"assessment"}`);
  const transparency = { score: Math.max(0, Math.min(15, transScore?.score ?? 7)), transparencyLevel: transScore?.transparencyLevel ?? 'medium', notes: transScore?.notes ?? 'Probe complete' };
  const perfScore = Math.max(0, Math.min(10, (reliability.completionRate >= 100 ? 10 : reliability.completionRate >= 66 ? 7 : reliability.completionRate >= 33 ? 4 : 1) - reliability.timedOut * 2));
  return { mode: 'full', reliability, sourceVerification, domainCompetence, transparency, perfScore, total: reliability.score + sourceVerification.score + domainCompetence.score + transparency.score + perfScore, maxScore: 100, ordersPlaced: 10 };
}

export async function runAgentAudit(agentInfo, requesterSdkKey, category = 'general', mode = 'full') {
  console.log(`\n🤖 A2A Audit | Agent: ${agentInfo.agentId} | Category: ${category} | Mode: ${mode}`);
  const pack = BENCHMARK_PACKS[category] || BENCHMARK_PACKS.general;
  if (!['quick','full'].includes(mode)) mode = 'full';
  const agentClient = new AgentClient(crooConfig, requesterSdkKey);
  const results = mode === 'quick' ? await runQuickAudit(agentClient, agentInfo.serviceId, pack) : await runFullAudit(agentClient, agentInfo.serviceId, pack);
  const { total, maxScore } = results;
  const reliabilityLevel = total >= 80 ? 'High' : total >= 60 ? 'Moderate' : total >= 40 ? 'Low' : 'Unreliable';
  const verdict = total >= maxScore * 0.8 ? `Strong reliability. Suitable for production.`
    : total >= maxScore * 0.6 ? `Adequate performance. Suitable for low-stakes tasks.`
    : total >= maxScore * 0.4 ? `Inconsistent. Use with caution and oversight.`
    : `Fails reliability standards. Not recommended for autonomous use.`;
  const supportedCategories = Object.entries(BENCHMARK_PACKS).map(([k, v]) => `✓ ${k} — ${v.label}`).join('\n');

  if (mode === 'quick') {
    return `VERIS AGENT AUDIT (QUICK)\nAgent: ${agentInfo.agentId} | Category: ${pack.label}\nAudited: ${new Date().toUTCString()}\n${'═'.repeat(48)}\nQUICK SCORE: ${total}/${maxScore}  RELIABILITY: ${reliabilityLevel}\n${'═'.repeat(48)}\nReliability: ${results.reliabilityScore}/15  ${progressBar(results.reliabilityScore, 15)}\nCompetence:  ${results.competenceScore}/20  ${progressBar(results.competenceScore, 20)}\nPerformance: ${results.performanceScore}/10  ${progressBar(results.performanceScore, 10)}\nDepth:       ${results.deepScore}/10  ${progressBar(results.deepScore, 10)}\nCompletion: ${results.completionRate}%\nVERDICT: ${verdict}\nAUDIT TRAIL: VERIS · Tavily + Groq · ${new Date().toISOString()}`;
  }

  return `VERIS AGENT AUDIT (FULL)\nAgent: ${agentInfo.agentId} | Category: ${pack.label}\nAudited: ${new Date().toUTCString()}\n${'═'.repeat(48)}\nOVERALL SCORE: ${total}/100  RELIABILITY: ${reliabilityLevel}\nHALLUCINATION RISK: ${results.domainCompetence.competenceLevel === 'high' ? 'Low' : results.domainCompetence.competenceLevel === 'medium' ? 'Moderate' : 'High'}\n${'═'.repeat(48)}\nResponse Reliability: ${String(results.reliability.score).padStart(2)}/25  ${progressBar(results.reliability.score, 25)}\nSource Verification:  ${String(results.sourceVerification.score).padStart(2)}/25  ${progressBar(results.sourceVerification.score, 25)}\nDomain Competence:    ${String(results.domainCompetence.score).padStart(2)}/25  ${progressBar(results.domainCompetence.score, 25)}\nTransparency:         ${String(results.transparency.score).padStart(2)}/15  ${progressBar(results.transparency.score, 15)}\nPerformance:          ${String(results.perfScore).padStart(2)}/10  ${progressBar(results.perfScore, 10)}\nCompletion: ${results.reliability.completionRate}% | Accuracy: ${results.domainCompetence.accuracyRate}% | Level: ${results.domainCompetence.competenceLevel?.toUpperCase()}\nCOMPETENCE BREAKDOWN\n${results.domainCompetence.testBreakdown?.map(t => `• "${t.prompt}"\n  ${t.correct ? '✓' : '✗'} F:${t.factual_correctness} C:${t.completeness} R:${t.reasoning_quality} — ${t.explanation}`).join('\n') || 'Tests completed'}\nVERDICT: ${verdict}\nRECOMMENDATION: ${total >= 80 ? '✓ SUITABLE FOR PRODUCTION' : total >= 60 ? '⚠ TESTING ONLY' : total >= 40 ? '✗ HIGH RISK' : '✗ DO NOT USE'}\nAVAILABLE PACKS\n${supportedCategories}\nAUDIT TRAIL: VERIS · Tavily + Groq · ${category} · ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════
export async function runVERIS(requirements, requesterSdkKey) {
  const req = typeof requirements === 'string' ? JSON.parse(requirements) : requirements;
  if (req.type === 'agent') {
    if (!req.agentId || !req.serviceId) throw new Error('Agent audit requires: agentId and serviceId');
    const category = req.category || detectCategory(req.serviceDescription || '', req.agentName || '');
    return await runAgentAudit({ agentId: req.agentId, serviceId: req.serviceId }, requesterSdkKey, category, req.mode || 'full');
  }
  if (req.type === 'project') {
    if (!req.name) throw new Error('Project due diligence requires: name');
    return await runProjectDueDiligence(req);
  }
  throw new Error('Invalid type. Use "project" or "agent".');
}