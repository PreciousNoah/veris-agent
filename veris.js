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
// ENTITY RESOLUTION  (#3)
// Maps known project names / domain variants to canonical entity.
// Prevents auditing bitcoin.org (a website) instead of Bitcoin (a network).
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_ALIASES = {
  'bitcoin.org':          { canonical: 'Bitcoin',     type: 'l1l2' },
  'bitcoincore.org':      { canonical: 'Bitcoin',     type: 'l1l2' },
  'ethereum.org':         { canonical: 'Ethereum',    type: 'l1l2' },
  'xrpl.org':             { canonical: 'XRPL',        type: 'infrastructure' },
  'ripple.com':           { canonical: 'Ripple',      type: 'infrastructure' },
  'hyperliquid.xyz':      { canonical: 'Hyperliquid', type: 'trading_protocol' },
  'app.hyperliquid.xyz':  { canonical: 'Hyperliquid', type: 'trading_protocol' },
  'uniswap.org':          { canonical: 'Uniswap',     type: 'defi' },
  'aave.com':             { canonical: 'Aave',        type: 'defi' },
  'solana.com':           { canonical: 'Solana',      type: 'l1l2' },
  'chain.link':           { canonical: 'Chainlink',   type: 'tooling' },
};

export function resolveEntity(project) {
  // If name is a URL or domain, resolve it
  const input = (project.name || project.website || '').toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (ENTITY_ALIASES[input]) {
    const resolved = ENTITY_ALIASES[input];
    return {
      ...project,
      name: resolved.canonical,
      entityType: project.entityType || resolved.type,
      resolvedFrom: input,
    };
  }
  return project;
}

// ═══════════════════════════════════════════════════════════════════════
// SOURCE TIER CLASSIFIER
// ═══════════════════════════════════════════════════════════════════════
const OFFICIAL_DOMAINS = {
  bitcoin:      ['bitcoin.org','bitcoincore.org','github.com/bitcoin'],
  ethereum:     ['ethereum.org','ethresear.ch','eips.ethereum.org','github.com/ethereum'],
  solana:       ['solana.com','docs.solana.com','github.com/solana-labs'],
  chainlink:    ['chain.link','docs.chain.link','github.com/smartcontractkit'],
  uniswap:      ['uniswap.org','docs.uniswap.org','github.com/uniswap'],
  xrpl:         ['xrpl.org','ripple.com','github.com/xrplf','github.com/ripple'],
  xrp:          ['xrpl.org','ripple.com','github.com/xrplf'],
  hyperliquid:  ['hyperliquid.xyz','app.hyperliquid.xyz','github.com/hyperliquid-dex'],
  aave:         ['aave.com','docs.aave.com','github.com/aave'],
  cosmos:       ['cosmos.network','docs.cosmos.network','github.com/cosmos'],
  polkadot:     ['polkadot.network','wiki.polkadot.network','github.com/paritytech'],
  avalanche:    ['avax.network','docs.avax.network','github.com/ava-labs'],
};

const TIER2_DOMAINS = [
  'coindesk.com','theblock.co','messari.io','cointelegraph.com','decrypt.co',
  'bloomberg.com','reuters.com','ft.com','wsj.com','forbes.com','wired.com',
  'defillama.com','coingecko.com','coinmarketcap.com','etherscan.io',
  'dune.com','dune.xyz','nansen.ai','glassnode.com',
  'certik.com','trailofbits.com','openzeppelin.com','halborn.com',
  'consensys.io','immunefi.com','linkedin.com',
];

const TIER3_DOMAINS = [
  'reddit.com','discord.com','discord.gg','t.me','telegram.org',
  'twitter.com','x.com','medium.com','mirror.xyz','substack.com',
  'bitcointalk.org','forum.',
];

function classifySourceTier(url = '', projectName = '') {
  if (!url) return 'tier4';
  const u = url.toLowerCase();
  if (u.includes('github.com')) return 'tier1';
  if (u.match(/\/docs\.|\/whitepaper|\.pdf$|\/wiki\b/)) return 'tier1';
  if (u.match(/certik\.com|trailofbits|openzeppelin\.com|halborn\.com|immunefi\.com/)) return 'tier1';
  const key = (projectName || '').toLowerCase().split(' ')[0];
  if ((OFFICIAL_DOMAINS[key] || []).some(d => u.includes(d))) return 'tier1';
  if (u.match(/^https?:\/\/docs\./)) return 'tier1';
  if (u.match(/^https?:\/\/[a-z-]+\.org\//) && !u.match(/reddit|forum/)) return 'tier1';
  if (TIER2_DOMAINS.some(p => u.includes(p))) return 'tier2';
  if (TIER3_DOMAINS.some(p => u.includes(p))) return 'tier3';
  return 'tier4';
}

const TIER_WEIGHTS = { tier1: 1.00, tier2: 0.75, tier3: 0.40, tier4: 0.15 };

// ═══════════════════════════════════════════════════════════════════════
// SIGNAL REGISTRY  (#4 — one signal, one bucket, no double-counting)
//
// Every boolean signal belongs to exactly one dimension.
// Legitimacy = Identity + Transparency + Verification + Reputation
// Maturity   = Longevity + Ecosystem + Adoption + Development + Security + Market
// ═══════════════════════════════════════════════════════════════════════

// LEGITIMACY SIGNAL REGISTRY
// Key: signal name. Value: { bucket, basePoints }
// Each signal appears in exactly ONE bucket.
const LEGITIMACY_SIGNALS = {
  // Identity — who/what is behind it?
  // Note: for decentralized protocols, open_source IS identity evidence
  founders_named:         { bucket: 'identity',      basePoints: 14 },
  linkedin_found:         { bucket: 'identity',      basePoints:  8 },
  team_page:              { bucket: 'identity',      basePoints:  5 },
  verifiable_history:     { bucket: 'identity',      basePoints:  8 },
  genuine_engagement:     { bucket: 'identity',      basePoints:  4 },
  // Transparency — what information is publicly available?
  whitepaper:             { bucket: 'transparency',  basePoints: 12 },
  technical_docs:         { bucket: 'transparency',  basePoints: 10 },
  roadmap:                { bucket: 'transparency',  basePoints:  7 },
  tokenomics:             { bucket: 'transparency',  basePoints:  7 },
  clear_use_case:         { bucket: 'transparency',  basePoints:  6 },
  on_chain_governance:    { bucket: 'transparency',  basePoints:  5 },
  treasury_transparency:  { bucket: 'transparency',  basePoints:  5 },
  // Verification — can claims be independently verified?
  active_github:          { bucket: 'verification',  basePoints: 12 },
  open_source:            { bucket: 'verification',  basePoints: 10 },
  audit_found:            { bucket: 'verification',  basePoints: 12 },
  multiple_contributors:  { bucket: 'verification',  basePoints:  6 },
  live_product:           { bucket: 'verification',  basePoints: 10 },
  api_usage:              { bucket: 'verification',  basePoints:  6 },
  multisig_confirmed:     { bucket: 'verification',  basePoints:  6 },
  funding_confirmed:      { bucket: 'verification',  basePoints:  4 },
  // Reputation — track record over time (no bonus system — direct dimension)
  no_confirmed_fraud:     { bucket: 'reputation',    basePoints: 10 }, // derived
  no_confirmed_hack:      { bucket: 'reputation',    basePoints:  6 }, // derived
  longevity_10y:          { bucket: 'reputation',    basePoints: 14 },
  longevity_5y:           { bucket: 'reputation',    basePoints: 10 },
  longevity_2y:           { bucket: 'reputation',    basePoints:  5 },
  longevity_1y:           { bucket: 'reputation',    basePoints:  3 },
  media_coverage:         { bucket: 'reputation',    basePoints:  5 },
};

// MATURITY SIGNAL REGISTRY — metric-tier based
const MATURITY_METRICS = {
  longevity: {
    tiers: [
      { signal: 'longevity_10y', points: 60, label: 'Operating 10+ years' },
      { signal: 'longevity_5y',  points: 40, label: 'Operating 5-9 years' },
      { signal: 'longevity_2y',  points: 20, label: 'Operating 2-4 years' },
      { signal: 'longevity_1y',  points: 10, label: 'Operating 1-2 years' },
    ],
    cap: 60, weight: 0.20,
  },
  ecosystem: {
    // Driven by ecosystem_level string extracted from sources
    cap: 60, weight: 0.20,
  },
  adoption: {
    // Driven by adoption_level string extracted from sources
    cap: 60, weight: 0.20,
  },
  development: {
    signals: {
      active_github: 15, multiple_contributors: 12, high_github_stars: 10,
      regular_releases: 8, recent_commits: 8, developer_ecosystem: 10,
      sdks_found: 7, grants_hackathons: 5, open_source: 5,
    },
    cap: 60, weight: 0.20,
  },
  security_track: {
    signals: {
      audit_found: 20, multiple_audits: 15, bug_bounty: 10, no_critical_hack: 15,
    },
    cap: 60, weight: 0.10,
  },
  market: {
    signals: {
      major_exchange_listed: 15, institutional_adoption: 15, top10_chain: 20,
      tvl_mentioned: 12, trading_volume_mentioned: 10, large_community: 8,
      media_coverage: 5,
    },
    cap: 60, weight: 0.10,
  },
};

// ═══════════════════════════════════════════════════════════════════════
// ENTITY TEMPLATES  — per-type bucket weights only
// No signal lists here — signals come from registry above.
// Weight = how much each legitimacy bucket matters for this entity type.
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_TEMPLATES = {
  l1l2: {
    label: 'L1/L2 Blockchain',
    signals: ['bitcoin','ethereum','solana','avalanche','bsc','polygon','optimism',
              'arbitrum','zksync','starknet','tron','litecoin','monero'],
    note: 'L1/L2 rubric: verification (open source, GitHub) and reputation (longevity) are primary signals. Pseudonymous founders are not penalized.',
    bucketWeights: { identity: 0.15, transparency: 0.25, verification: 0.35, reputation: 0.25 },
  },
  infrastructure: {
    label: 'Infrastructure Protocol',
    signals: ['foundation','network','ledger','mainnet','consensus','validator','node',
              'xrpl','ripple','cosmos','polkadot','near','cardano','algorand'],
    note: 'Infrastructure rubric: verification and reputation weighted highest. Open governance is expected.',
    bucketWeights: { identity: 0.15, transparency: 0.25, verification: 0.35, reputation: 0.25 },
  },
  defi: {
    label: 'DeFi Protocol',
    signals: ['defi','yield','lending','borrow','swap','amm','liquidity pool','vault',
              'liquid staking','dex'],
    note: 'DeFi rubric: audit (verification) is critical. Identity matters more than for infrastructure.',
    bucketWeights: { identity: 0.25, transparency: 0.25, verification: 0.35, reputation: 0.15 },
  },
  trading_protocol: {
    label: 'Trading Protocol / Exchange',
    signals: ['exchange','trading','derivatives','perpetuals','order book','hyperliquid',
              'hyper','dydx','gmx','drift','vertex','perp exchange'],
    note: 'Trading protocol rubric: identity and verification (audit) weighted equally.',
    bucketWeights: { identity: 0.30, transparency: 0.20, verification: 0.35, reputation: 0.15 },
  },
  aiagent: {
    label: 'AI Agent / Product',
    signals: ['ai agent','autonomous agent','llm','gpt','copilot','assistant','autopilot',
              'croo','veris','ai-powered'],
    note: 'AI agent rubric: live product (verification) and creator identity are primary.',
    bucketWeights: { identity: 0.30, transparency: 0.25, verification: 0.30, reputation: 0.15 },
  },
  memecoin: {
    label: 'Meme Coin / Token',
    signals: ['meme','doge','shib','pepe','inu','elon','moon','fair launch','stealth launch'],
    note: 'Meme coin rubric: verification (audit, liquidity lock) and transparency weighted most.',
    bucketWeights: { identity: 0.20, transparency: 0.30, verification: 0.35, reputation: 0.15 },
  },
  dao: {
    label: 'DAO / Governance Protocol',
    signals: ['dao','governance','vote','proposal','treasury','multisig','snapshot','aragon'],
    note: 'DAO rubric: on-chain verification and transparency are primary.',
    bucketWeights: { identity: 0.10, transparency: 0.35, verification: 0.35, reputation: 0.20 },
  },
  startup: {
    label: 'Startup / Early Stage',
    signals: ['startup','seed','series a','backed by','venture','incubator','beta'],
    note: 'Startup rubric: identity (founder transparency) is the primary legitimacy signal.',
    bucketWeights: { identity: 0.40, transparency: 0.25, verification: 0.25, reputation: 0.10 },
  },
  tooling: {
    label: 'Tooling / Developer Infrastructure',
    signals: ['sdk','rpc','indexer','explorer','bridge','oracle','developer tool',
              'infrastructure tool','chainlink','wallet sdk'],
    note: 'Tooling rubric: verification (GitHub, open source) is primary.',
    bucketWeights: { identity: 0.20, transparency: 0.25, verification: 0.40, reputation: 0.15 },
  },
  general: {
    label: 'General Project',
    signals: [],
    note: 'General rubric. Specify entity type for more accurate scoring.',
    bucketWeights: { identity: 0.25, transparency: 0.25, verification: 0.25, reputation: 0.25 },
  },
};

export function detectEntityType(project) {
  const text = [project.name,project.description,project.website,project.entityType]
    .filter(Boolean).join(' ').toLowerCase();
  const matches = Object.entries(ENTITY_TEMPLATES)
    .filter(([k]) => k !== 'general')
    .map(([type,cfg]) => ({ type, score: cfg.signals.filter(s => text.includes(s)).length }))
    .filter(e => e.score > 0)
    .sort((a,b) => b.score - a.score);
  return matches[0]?.type || 'general';
}

// ═══════════════════════════════════════════════════════════════════════
// HARD TRUST EVENTS
// ═══════════════════════════════════════════════════════════════════════
const HARD_TRUST_EVENTS = [
  { key:'confirmed_rug_pull',   label:'Confirmed rug pull' },
  { key:'confirmed_fraud',      label:'Confirmed fraud' },
  { key:'confirmed_scam',       label:'Confirmed scam' },
  { key:'sec_enforcement',      label:'SEC/CFTC enforcement action' },
  { key:'sanctions',            label:'Government sanctions (OFAC)' },
  { key:'criminal_conviction',  label:'Criminal conviction of founders' },
];

// ═══════════════════════════════════════════════════════════════════════
// EVIDENCE EXTRACTION
// YES / NO / UNKNOWN per signal + ecosystem_level + adoption_level +
// contradictions + per-signal source URLs + confidence estimates.
// Temperature 0.0.
// ═══════════════════════════════════════════════════════════════════════
async function extractEvidence(combinedText, projectName, entityLabel) {
  const prompt =
    `You are a structured evidence extraction engine for "${projectName}" (${entityLabel}).\n\n` +
    `SOURCES:\n${combinedText.substring(0, 9000)}\n\n` +
    `RULES:\n` +
    `1. Each boolean field = "YES", "NO", or "UNKNOWN". Default = UNKNOWN.\n` +
    `   YES = source explicitly confirms. NO = source explicitly contradicts. UNKNOWN = not mentioned.\n` +
    `2. NEVER set YES from implication. NEVER set NO from absence — absence = UNKNOWN.\n` +
    `3. Per-signal _urls fields: list exact URLs from sources supporting the YES/NO claim.\n` +
    `4. ecosystem_level: "dominant"/"major"/"growing"/"small"/"none" — based on explicit evidence only.\n` +
    `5. adoption_level: "global"/"large"/"medium"/"small"/"none" — based on explicit evidence only.\n` +
    `6. founded_year: numeric year only, or null.\n` +
    `7. CONTRADICTIONS: If two sources make conflicting claims about the SAME fact, add to contradictions array.\n` +
    `8. Hard events (fraud, scam, rug, sec_enforcement, sanctions, conviction) MUST have citation with source_url + quote >= 25 chars. Without it, set UNKNOWN.\n` +
    `9. confidence_per_signal: 0-100 estimate per signal based on source authority and clarity.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{\n` +
    `  "whitepaper":"UNKNOWN","whitepaper_urls":[],\n` +
    `  "roadmap":"UNKNOWN","roadmap_urls":[],\n` +
    `  "tokenomics":"UNKNOWN","tokenomics_urls":[],\n` +
    `  "technical_docs":"UNKNOWN","technical_docs_urls":[],\n` +
    `  "clear_use_case":"UNKNOWN","clear_use_case_urls":[],\n` +
    `  "on_chain_governance":"UNKNOWN","on_chain_governance_urls":[],\n` +
    `  "treasury_transparency":"UNKNOWN","treasury_transparency_urls":[],\n` +
    `  "active_github":"UNKNOWN","active_github_urls":[],\n` +
    `  "open_source":"UNKNOWN","open_source_urls":[],\n` +
    `  "audit_found":"UNKNOWN","audit_found_urls":[],\n` +
    `  "multiple_audits":"UNKNOWN","multiple_audits_urls":[],\n` +
    `  "audit_firm":null,\n` +
    `  "bug_bounty":"UNKNOWN","bug_bounty_urls":[],\n` +
    `  "multiple_contributors":"UNKNOWN","multiple_contributors_urls":[],\n` +
    `  "high_github_stars":"UNKNOWN","high_github_stars_urls":[],\n` +
    `  "regular_releases":"UNKNOWN","regular_releases_urls":[],\n` +
    `  "recent_commits":"UNKNOWN","recent_commits_urls":[],\n` +
    `  "developer_ecosystem":"UNKNOWN","developer_ecosystem_urls":[],\n` +
    `  "sdks_found":"UNKNOWN","sdks_found_urls":[],\n` +
    `  "grants_hackathons":"UNKNOWN","grants_hackathons_urls":[],\n` +
    `  "live_product":"UNKNOWN","live_product_urls":[],\n` +
    `  "api_usage":"UNKNOWN","api_usage_urls":[],\n` +
    `  "multisig_confirmed":"UNKNOWN","multisig_confirmed_urls":[],\n` +
    `  "funding_confirmed":"UNKNOWN","funding_confirmed_urls":[],\n` +
    `  "founders_named":"UNKNOWN","founders_named_urls":[],\n` +
    `  "founder_names":[],\n` +
    `  "linkedin_found":"UNKNOWN","linkedin_found_urls":[],\n` +
    `  "team_page":"UNKNOWN","team_page_urls":[],\n` +
    `  "verifiable_history":"UNKNOWN","verifiable_history_urls":[],\n` +
    `  "genuine_engagement":"UNKNOWN","genuine_engagement_urls":[],\n` +
    `  "media_coverage":"UNKNOWN","media_coverage_urls":[],\n` +
    `  "active_social":"UNKNOWN","active_social_urls":[],\n` +
    `  "large_community":"UNKNOWN","large_community_urls":[],\n` +
    `  "active_community":"UNKNOWN","active_community_urls":[],\n` +
    `  "major_exchange_listed":"UNKNOWN","major_exchange_listed_urls":[],\n` +
    `  "top10_chain":"UNKNOWN","top10_chain_urls":[],\n` +
    `  "institutional_adoption":"UNKNOWN","institutional_adoption_urls":[],\n` +
    `  "tvl_mentioned":"UNKNOWN","tvl_mentioned_urls":[],\n` +
    `  "trading_volume_mentioned":"UNKNOWN","trading_volume_mentioned_urls":[],\n` +
    `  "liquidity_locked":"UNKNOWN","liquidity_locked_urls":[],\n` +
    `  "active_proposals":"UNKNOWN","active_proposals_urls":[],\n` +
    `  "features_described":"UNKNOWN","features_described_urls":[],\n` +
    `  "user_reviews":"UNKNOWN","user_reviews_urls":[],\n` +
    `  "ecosystem_level":"none",\n` +
    `  "adoption_level":"none",\n` +
    `  "founded_year":null,\n` +
    `  "confirmed_rug_pull":"UNKNOWN","confirmed_fraud":"UNKNOWN",\n` +
    `  "confirmed_scam":"UNKNOWN","sec_enforcement":"UNKNOWN",\n` +
    `  "sanctions":"UNKNOWN","criminal_conviction":"UNKNOWN",\n` +
    `  "confirmed_hack":"UNKNOWN","confirmed_exploit":"UNKNOWN",\n` +
    `  "confirmed_vulnerability":"UNKNOWN",\n` +
    `  "contradictions":[],\n` +
    `  "confidence_per_signal":{},\n` +
    `  "evidence_citations":[]\n` +
    `}\n\n` +
    `contradictions schema: [{"field":"audit_found","claim_a":"fully audited","source_a":"https://...","claim_b":"no audit found","source_b":"https://..."}]\n` +
    `evidence_citations schema: [{"claim":"field_name","source_url":"https://...","quote":"verbatim >= 25 chars","confidence":0.0-1.0}]`;

  const response = await groqExtract(prompt);
  try {
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch {
    console.warn('  ⚠ Evidence parse failed — neutral baseline');
    return buildBaselineEvidence();
  }
}

function buildBaselineEvidence() {
  const fields = Object.keys(LEGITIMACY_SIGNALS)
    .filter(k => !['no_confirmed_fraud','no_confirmed_hack','longevity_10y','longevity_5y','longevity_2y','longevity_1y'].includes(k));
  const extra = ['audit_found','multiple_audits','bug_bounty','regular_releases','recent_commits','developer_ecosystem','sdks_found','grants_hackathons','high_github_stars','multiple_contributors','major_exchange_listed','top10_chain','institutional_adoption','tvl_mentioned','trading_volume_mentioned','liquidity_locked','large_community','active_community','active_social','active_proposals','features_described','user_reviews','confirmed_rug_pull','confirmed_fraud','confirmed_scam','sec_enforcement','sanctions','criminal_conviction','confirmed_hack','confirmed_exploit','confirmed_vulnerability'];
  const allFields = [...new Set([...fields, ...extra])];
  const ev = {};
  allFields.forEach(k => { ev[k] = 'UNKNOWN'; ev[`${k}_urls`] = []; });
  ev.founder_names = []; ev.audit_firm = null; ev.founded_year = null;
  ev.ecosystem_level = 'none'; ev.adoption_level = 'none';
  ev.contradictions = []; ev.confidence_per_signal = {}; ev.evidence_citations = [];
  return ev;
}

// ═══════════════════════════════════════════════════════════════════════
// LONGEVITY FLAGS
// ═══════════════════════════════════════════════════════════════════════
function longevityFlags(evidence) {
  const year = parseInt(evidence.founded_year);
  const now  = new Date().getFullYear();
  if (!year || year < 2008 || year > now) {
    return { longevity_10y:'UNKNOWN', longevity_5y:'UNKNOWN', longevity_2y:'UNKNOWN', longevity_1y:'UNKNOWN' };
  }
  const age = now - year;
  return {
    longevity_10y: age >= 10 ? 'YES' : 'NO',
    longevity_5y:  age >= 5  ? 'YES' : 'NO',
    longevity_2y:  age >= 2  ? 'YES' : 'NO',
    longevity_1y:  age >= 1  ? 'YES' : 'NO',
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LEGITIMACY SCORING  (#4 no double-counting, #5 reputation as dimension)
//
// Four buckets: identity, transparency, verification, reputation.
// Each bucket scores 0-100 independently.
// Legitimacy = weighted average of four bucket scores.
// Weights are entity-type specific.
// ═══════════════════════════════════════════════════════════════════════
function computeLegitimacyScore(evidence, template, projectName) {
  const lFlags  = longevityFlags(evidence);
  const ev      = { ...evidence, ...lFlags };

  // Derived signals: no_confirmed_fraud, no_confirmed_hack
  ev.no_confirmed_fraud = (['confirmed_rug_pull','confirmed_fraud','confirmed_scam',
    'sec_enforcement','criminal_conviction'].every(k => ev[k]==='NO' || ev[k]==='UNKNOWN')) ? 'YES' : 'NO';
  ev.no_confirmed_hack  = (ev.confirmed_hack==='NO' || ev.confirmed_hack==='UNKNOWN') ? 'YES' : 'NO';

  // Longevity is exclusive in reputation bucket — only highest fires
  const longevityOrder = ['longevity_10y','longevity_5y','longevity_2y','longevity_1y'];
  const firedLongevity  = longevityOrder.find(k => ev[k] === 'YES') || null;

  const buckets = { identity: { raw:0, max:0 }, transparency: { raw:0, max:0 }, verification: { raw:0, max:0 }, reputation: { raw:0, max:0 } };
  const applied = { identity: [], transparency: [], verification: [], reputation: [] };

  for (const [sigKey, sigCfg] of Object.entries(LEGITIMACY_SIGNALS)) {
    const { bucket, basePoints } = sigCfg;

    // Longevity exclusivity in reputation bucket
    if (longevityOrder.includes(sigKey)) {
      if (sigKey !== firedLongevity) {
        buckets[bucket].max += basePoints;  // still counts toward max
        continue;
      }
    }

    buckets[bucket].max += basePoints;
    const state = ev[sigKey] || 'UNKNOWN';
    if (state !== 'YES') continue;

    const urls  = ev[`${sigKey}_urls`] || [];
    const tier  = bestTierName(urls, projectName);
    const tierW = TIER_WEIGHTS[tier];
    const t1t2  = urls.filter(u => ['tier1','tier2'].includes(classifySourceTier(u, projectName))).length;
    const cons  = t1t2 >= 2 ? 1.10 : t1t2 === 1 ? 1.00 : urls.length >= 2 ? 0.90 : 0.75;
    const pts   = Math.round(basePoints * tierW * cons);

    buckets[bucket].raw += pts;
    applied[bucket].push({
      label: SIGNAL_LABELS[sigKey] || sigKey,
      points: pts, tier,
      urls,
      confidence: ev.confidence_per_signal?.[sigKey] ?? defaultConfidence(tier),
    });
  }

  // Normalize each bucket to 0-100
  const scores = {};
  for (const [bk, data] of Object.entries(buckets)) {
    scores[bk] = data.max > 0 ? Math.min(100, Math.round((data.raw / data.max) * 100)) : 0;
  }

  // Weighted legitimacy
  const bw = template.bucketWeights;
  const legitimacyScore = Math.round(
    scores.identity     * bw.identity +
    scores.transparency * bw.transparency +
    scores.verification * bw.verification +
    scores.reputation   * bw.reputation
  );

  return { legitimacyScore, scores, applied };
}

// ═══════════════════════════════════════════════════════════════════════
// MATURITY SCORING — metric tiers, not evidence count
// ═══════════════════════════════════════════════════════════════════════
function computeMaturityScore(evidence) {
  const lFlags = longevityFlags(evidence);
  const ev     = { ...evidence, ...lFlags };
  ev.no_critical_hack = (ev.confirmed_hack==='NO' || ev.confirmed_hack==='UNKNOWN') ? 'YES' : 'NO';

  const applied = [];
  const axisScores = {};

  for (const [axisKey, axis] of Object.entries(MATURITY_METRICS)) {
    let axisScore = 0;
    const axisApplied = [];

    if (axisKey === 'longevity' && axis.tiers) {
      for (const tier of axis.tiers) {
        if ((ev[tier.signal] || 'UNKNOWN') === 'YES') {
          const tierW = bestTierWeight(ev[`${tier.signal}_urls`] || []);
          const pts   = Math.round(tier.points * tierW);
          axisScore   = pts;
          axisApplied.push({ label: tier.label, points: pts, tier: bestTierName(ev[`${tier.signal}_urls`]||[]) });
          break;
        }
      }
    } else if (axisKey === 'ecosystem') {
      axisScore = ecosystemPoints(evidence.ecosystem_level);
      if (axisScore > 0) axisApplied.push({ label:`Ecosystem: ${evidence.ecosystem_level}`, points:axisScore });
    } else if (axisKey === 'adoption') {
      axisScore = adoptionPoints(evidence.adoption_level);
      if (axisScore > 0) axisApplied.push({ label:`Adoption: ${evidence.adoption_level}`, points:axisScore });
    } else if (axis.signals) {
      for (const [sigKey, basePts] of Object.entries(axis.signals)) {
        const state = ev[sigKey] || 'UNKNOWN';
        if (state !== 'YES') continue;
        const urls  = ev[`${sigKey}_urls`] || [];
        const tierW = bestTierWeight(urls);
        const pts   = Math.round(basePts * tierW);
        axisScore  += pts;
        axisApplied.push({ label: SIGNAL_LABELS[sigKey]||sigKey, points:pts, tier:bestTierName(urls) });
      }
    }

    axisScore = Math.min(axis.cap, axisScore);
    axisScores[axisKey] = { score: axisScore, cap: axis.cap, weight: axis.weight };
    applied.push(...axisApplied);
  }

  let weightedSum = 0, totalWeight = 0;
  for (const ax of Object.values(axisScores)) {
    weightedSum += (ax.score / ax.cap) * ax.weight;
    totalWeight += ax.weight;
  }
  const maturityScore = totalWeight > 0 ? Math.min(100, Math.round((weightedSum/totalWeight)*100)) : 0;
  return { maturityScore, applied, axisScores };
}

function ecosystemPoints(level) {
  return { dominant:60, major:40, growing:25, small:10, none:0 }[level] ?? 0;
}
function adoptionPoints(level) {
  return { global:60, large:40, medium:25, small:10, none:0 }[level] ?? 0;
}
function bestTierWeight(urls = [], projectName = '') {
  if (!urls.length) return TIER_WEIGHTS.tier4;
  const best = ['tier1','tier2','tier3','tier4'].find(t => urls.map(u=>classifySourceTier(u,projectName||'')).includes(t)) || 'tier4';
  return TIER_WEIGHTS[best];
}
function bestTierName(urls = [], projectName = '') {
  if (!urls.length) return 'tier4';
  return ['tier1','tier2','tier3','tier4'].find(t => urls.map(u=>classifySourceTier(u,projectName||'')).includes(t)) || 'tier4';
}
function defaultConfidence(tier) {
  return { tier1:90, tier2:70, tier3:45, tier4:20 }[tier] ?? 20;
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIDENCE ENGINE  (#1 — authority + count + agreement + freshness)
// Confidence is about HOW WELL we know, not about WHAT we know.
// Bitcoin should get 90%+ because of massive tier1/tier2 source coverage.
// A meme coin with no official sources should get ~30-50%.
// ═══════════════════════════════════════════════════════════════════════
function computeConfidence(evidence, allSources) {
  // 1. Source authority: weighted average of tier weights across ALL sources
  const authority = allSources.length === 0 ? 0.05
    : allSources.reduce((sum, s) => sum + (TIER_WEIGHTS[classifySourceTier(s.url||'')] || 0.15), 0) / allSources.length;

  // 2. Source count: more sources = higher confidence, diminishing returns
  const countScore = allSources.length === 0 ? 0.05
    : allSources.length >= 20 ? 1.00
    : allSources.length >= 10 ? 0.90
    : allSources.length >= 5  ? 0.75
    : allSources.length >= 2  ? 0.55
    : 0.35;

  // 3. Cross-source agreement: multiple sources confirming same signals
  const citations    = evidence.evidence_citations || [];
  const claimCounts  = citations.reduce((acc,c) => { acc[c.claim]=(acc[c.claim]||0)+1; return acc; }, {});
  const multiCited   = Object.values(claimCounts).filter(v => v >= 2).length;
  const totalClaims  = Object.keys(claimCounts).length;
  const agreement    = totalClaims === 0 ? 0.50 : Math.min(1, 0.50 + (multiCited / totalClaims) * 0.50);

  // 4. Freshness: recent activity signals
  const freshness = (evidence.recent_commits==='YES' || evidence.regular_releases==='YES') ? 0.95
    : (evidence.active_github==='YES' || evidence.active_community==='YES') ? 0.80
    : 0.60;

  // 5. Contradiction penalty
  const contraFactor = Math.max(0.60, 1 - (evidence.contradictions?.length||0) * 0.08);

  // Weighted combination
  const raw = (
    authority  * 0.30 +
    countScore * 0.25 +
    agreement  * 0.25 +
    freshness  * 0.20
  ) * contraFactor;

  return Math.min(0.98, Math.max(0.05, raw));
}

// ═══════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE  (#8 — fully deterministic rules)
// Groq does NOT set the label. Code does.
// ═══════════════════════════════════════════════════════════════════════
function getRecommendation(legitimacyScore, maturityScore, opRiskLevel, hardEventsConfirmed) {
  // Hard events override everything
  if (hardEventsConfirmed.length > 0) {
    return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29',
      text:'Hard trust event confirmed (fraud/scam/sanctions). Do not engage.' };
  }

  // Rule-based derivation from two scores
  if (legitimacyScore >= 85 && maturityScore >= 70) {
    return { label:'STRONGLY TRUSTED', symbol:'✓✓', band:'90-100',
      text:'Strong legitimacy and maturity signals across multiple independent sources.' };
  }
  if (legitimacyScore >= 80 && maturityScore >= 55) {
    return { label:'TRUSTED', symbol:'✓', band:'80-89',
      text:'Solid legitimacy signals confirmed. Standard due diligence recommended.' };
  }
  if (legitimacyScore >= 65) {
    return { label:'GENERALLY LEGITIMATE', symbol:'~✓', band:'65-79',
      text:'Legitimacy signals present. Some evidence gaps — independent verification recommended.' };
  }
  if (legitimacyScore >= 50) {
    return { label:'MIXED SIGNALS', symbol:'~', band:'50-64',
      text:'Incomplete or inconsistent evidence. Manual research required before engagement.' };
  }
  if (legitimacyScore >= 30) {
    return { label:'HIGH RISK', symbol:'✗', band:'30-49',
      text:'Significant legitimacy gaps. Proceed only with extensive independent verification.' };
  }
  return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29',
    text:'Critical legitimacy failures or confirmed negative events. VERIS advises against engagement.' };
}

// ═══════════════════════════════════════════════════════════════════════
// HARD EVENT / OPERATIONAL RISK
// ═══════════════════════════════════════════════════════════════════════
function validateHardEvent(key, evidence) {
  if (evidence[key] !== 'YES') return false;
  const cit = (evidence.evidence_citations||[]).find(c => c.claim===key);
  return cit?.source_url?.startsWith('http') && cit.quote?.length >= 25 && (cit.confidence||0) >= 0.85;
}

function checkHardEvents(evidence) {
  const confirmed = [], unverified = [];
  for (const ev of HARD_TRUST_EVENTS) {
    if (evidence[ev.key] !== 'YES') continue;
    const cit = (evidence.evidence_citations||[]).find(c => c.claim===ev.key);
    if (validateHardEvent(ev.key, evidence)) confirmed.push({ ...ev, citation:cit });
    else unverified.push({ label:ev.label, note:'Mentioned but insufficient citation.', citation:cit||null });
  }
  return { confirmed, unverified };
}

function checkOperationalRisk(evidence) {
  const OPS = [
    { key:'confirmed_hack',          label:'Confirmed hack or breach' },
    { key:'confirmed_exploit',       label:'Confirmed smart contract exploit' },
    { key:'confirmed_vulnerability', label:'Confirmed vulnerability disclosure' },
  ];
  const confirmed = [], unverified = [];
  for (const op of OPS) {
    if (evidence[op.key] !== 'YES') continue;
    const cit = (evidence.evidence_citations||[]).find(c=>c.claim===op.key);
    if (validateHardEvent(op.key, evidence)) confirmed.push({ ...op, citation:cit });
    else unverified.push({ label:op.label, note:'Incident mentioned but insufficient source citation.' });
  }
  return { confirmed, unverified, level: confirmed.length===0?'Low':confirmed.length===1?'Medium':'High' };
}

// ═══════════════════════════════════════════════════════════════════════
// SOURCE AUTHORITY BREAKDOWN  (#6)
// ═══════════════════════════════════════════════════════════════════════
function sourceAuthorityBreakdown(allSources, projectName) {
  const counts = { tier1:0, tier2:0, tier3:0, tier4:0 };
  for (const s of allSources) {
    const t = classifySourceTier(s.url||'', projectName);
    counts[t]++;
  }
  return counts;
}

const SIGNAL_LABELS = {
  open_source:'Open source confirmed', active_github:'Active GitHub', high_github_stars:'High GitHub stars',
  multiple_contributors:'Multiple contributors', audit_found:'Security audit found', multiple_audits:'Multiple audits',
  bug_bounty:'Bug bounty active', regular_releases:'Regular releases', recent_commits:'Recent commits',
  whitepaper:'Whitepaper found', technical_docs:'Technical documentation', roadmap:'Roadmap confirmed',
  tokenomics:'Tokenomics documented', clear_use_case:'Clear use case', founders_named:'Founders publicly named',
  linkedin_found:'LinkedIn profiles confirmed', team_page:'Team page found', verifiable_history:'Verifiable track record',
  genuine_engagement:'Genuine engagement', media_coverage:'Media coverage', live_product:'Live product confirmed',
  api_usage:'API usage confirmed', multisig_confirmed:'Multisig confirmed', funding_confirmed:'Funding confirmed',
  on_chain_governance:'On-chain governance', treasury_transparency:'Treasury transparency',
  no_confirmed_fraud:'No confirmed fraud/scam history', no_confirmed_hack:'No confirmed critical hack',
  longevity_10y:'Active 10+ years', longevity_5y:'Active 5-9 years', longevity_2y:'Active 2-4 years', longevity_1y:'Active 1-2 years',
  sdks_found:'SDKs available', developer_ecosystem:'Developer ecosystem', grants_hackathons:'Grants/hackathons',
  major_exchange_listed:'Major exchange listing', top10_chain:'Top-10 chain', institutional_adoption:'Institutional adoption',
  tvl_mentioned:'TVL data found', trading_volume_mentioned:'Trading volume data', large_community:'Large community',
  active_community:'Active community', active_proposals:'Active governance proposals',
};

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════
async function collectEvidence(query, projectName='') {
  try {
    const res = await tavilyClient.search(query, { searchDepth:'advanced', maxResults:5, includeAnswer:false });
    if (!res.results?.length) return { text:'', sourceCount:0, sources:[] };
    const sources = res.results.map(r => ({
      title: r.title, url: r.url,
      tier: classifySourceTier(r.url, projectName),
      snippet: r.content?.substring(0,500)||'',
    }));
    const text = sources.map((s,i) =>
      `[Source ${i+1} | ${s.tier.toUpperCase()} | ${s.url}]\n${s.title}\n${s.snippet}`
    ).join('\n\n---\n\n');
    return { text, sourceCount:sources.length, sources };
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
    longevity:     `${n} founded launched year history milestones when created`,
    adoption:      `${n} TVL users transactions exchange listed institutional adoption scale`,
    ecosystem:     `${n} developer ecosystem SDK integrations partnerships network`,
  };
  if (['defi','trading_protocol'].includes(entityType)) {
    q.security = `${n} audit certik trail of bits halborn openzeppelin bug bounty insurance`;
  }
  if (['memecoin','nft'].includes(entityType)) {
    q.liquidity = `${n} liquidity locked holders distribution DEX trading pair`;
  }
  return q;
}

async function groqExtract(prompt) {
  const c = await groq.chat.completions.create({
    model:'llama-3.3-70b-versatile',
    messages:[
      { role:'system', content:'You are a structured data extraction engine. Return ONLY valid JSON. No markdown, no backticks, no explanation.' },
      { role:'user', content:prompt },
    ],
    max_tokens:3000, temperature:0.0,
  });
  return c.choices[0].message.content;
}

async function groqSynthesize(prompt, systemMsg='You are a factual research assistant. Be specific and concise.') {
  const c = await groq.chat.completions.create({
    model:'llama-3.3-70b-versatile',
    messages:[{ role:'system', content:systemMsg },{ role:'user', content:prompt }],
    max_tokens:600, temperature:0.2,
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
  return { score:Math.max(0,Math.min(maxScore,result?.score??Math.round(maxScore*0.5))), factual_correctness:result?.factual_correctness??5, completeness:result?.completeness??5, reasoning_quality:result?.reasoning_quality??5, correct:result?.correct??false, explanation:result?.explanation??'Evaluated' };
}

function progressBar(score, max=100, width=20) {
  if (max===0) return '░'.repeat(width);
  const filled = Math.round((score/max)*width);
  return '█'.repeat(Math.max(0,filled))+'░'.repeat(Math.max(0,width-filled));
}

function confBar(c, width=12) {
  const filled = Math.round(c*width);
  return '▓'.repeat(Math.max(0,filled))+'░'.repeat(Math.max(0,width-filled))+` ${Math.round(c*100)}%`;
}

function tierTag(t) {
  return { tier1:'[T1]', tier2:'[T2]', tier3:'[T3]', tier4:'[T4]' }[t]||'[T?]';
}

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE — MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════
export async function runProjectDueDiligence(project) {
  // Entity resolution first (#3)
  project = resolveEntity(project);
  console.log(`\n🔍 VERIS Due Diligence: ${project.name}${project.resolvedFrom ? ` (resolved from ${project.resolvedFrom})` : ''}`);

  const entityKey = project.entityType || detectEntityType(project);
  const template  = ENTITY_TEMPLATES[entityKey] || ENTITY_TEMPLATES.general;
  console.log(`  Entity class: ${template.label}`);

  // Collect
  console.log('  → Collecting evidence...');
  const queries = buildSearchQueries(project, entityKey);
  const searchResults = await Promise.all(
    Object.entries(queries).map(async ([key,query]) => ({ key, ...await collectEvidence(query, project.name) }))
  );
  const allSources   = searchResults.flatMap(r => r.sources);
  const totalSources = searchResults.reduce((a,r) => a+r.sourceCount, 0);
  const combinedText = searchResults.filter(r => r.text).map(r => `=== ${r.key.toUpperCase()} ===\n${r.text}`).join('\n\n');

  // Extract
  console.log('  → Extracting evidence...');
  const evidence = await extractEvidence(combinedText, project.name, template.label);

  // Hard events
  const { confirmed: hardEvents, unverified: unverifiedHard } = checkHardEvents(evidence);

  // Score
  console.log('  → Scoring...');
  const legit   = computeLegitimacyScore(evidence, template, project.name);
  const mat     = computeMaturityScore(evidence);
  const opRisk  = checkOperationalRisk(evidence);

  const legitimacyScore = hardEvents.length > 0 ? 0 : legit.legitimacyScore;
  const maturityScore   = hardEvents.length > 0 ? 0 : mat.maturityScore;

  // Confidence
  const confidence = computeConfidence(evidence, allSources);

  // Recommendation (deterministic rules)
  const rec = getRecommendation(legitimacyScore, maturityScore, opRisk.level, hardEvents);

  // Calibration
  const calibration = checkCalibration(project.name, legitimacyScore, maturityScore);

  // Source authority breakdown (#6)
  const srcBreakdown = sourceAuthorityBreakdown(allSources, project.name);

  // Verdict text — Groq writes a factual paragraph from confirmed signals only
  console.log('  → Generating verdict...');
  const allConfirmedSignals = [
    ...legit.applied.identity, ...legit.applied.transparency,
    ...legit.applied.verification, ...legit.applied.reputation,
  ].map(s => s.label);
  const verdictText = await groqSynthesize(
    `Write a 2-3 sentence factual verdict for "${project.name}" (${template.label}).\n\n` +
    `Legitimacy: ${legitimacyScore}/100 | Maturity: ${maturityScore}/100 | Confidence: ${Math.round(confidence*100)}% | Op Risk: ${opRisk.level}\n\n` +
    `Confirmed signals: ${allConfirmedSignals.join(', ') || 'none'}\n` +
    `Hard trust events: ${hardEvents.map(e=>e.label).join(', ') || 'none'}\n` +
    `Operational risks: ${opRisk.confirmed.map(r=>r.label).join(', ') || 'none'}\n\n` +
    `Rules: Only use facts listed. Legitimacy ≠ quality. If confidence <50%, note limited evidence.`,
    'Write a factual trust audit verdict. Do not add information not listed above. Be direct.'
  );

  // ─── Format report ───
  const hardWarn = hardEvents.length > 0
    ? `\n⛔ HARD TRUST EVENT — All scores overridden to 0\n` +
      hardEvents.map(e=>`   ${e.label}\n   Source: ${e.citation.source_url}\n   Quote:  "${e.citation.quote}"`).join('\n')
    : '';
  const lowConfWarn = confidence < 0.40
    ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence*100)}%): Limited sources. UNKNOWN ≠ negative.`
    : confidence < 0.65
    ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence*100)}%): Some areas have limited coverage.`
    : '';
  const anomalyWarn = calibration.anomaly ? `\n⚠  SCORE ANOMALY: ${calibration.note}` : '';

  function sigBlock(signals) {
    if (!signals.length) return '  (No signals confirmed)';
    return signals.map(s =>
      `  +${String(s.points).padStart(2)}  ${s.label}  ${tierTag(s.tier)} conf:${s.confidence}%` +
      (s.urls?.[0] ? `\n       └─ ${s.urls[0]}` : '')
    ).join('\n');
  }

  // Contradiction block (#7)
  const contraBlock = evidence.contradictions?.length > 0
    ? `\n⚡ CONFLICTS DETECTED — Manual verification recommended\n` +
      evidence.contradictions.map(c =>
        `  Field: ${c.field}\n  Claim A: "${c.claim_a}"\n  Source: ${c.source_a}\n  Claim B: "${c.claim_b}"\n  Source: ${c.source_b}`
      ).join('\n\n')
    : '';

  // Evidence missing section
  const allTemplateSignals = [...new Set([
    ...Object.keys(LEGITIMACY_SIGNALS).filter(k =>
      !['no_confirmed_fraud','no_confirmed_hack','longevity_10y','longevity_5y','longevity_2y','longevity_1y'].includes(k)
    )
  ])];
  const missingSignals = allTemplateSignals.filter(k => (evidence[k]||'UNKNOWN') === 'UNKNOWN');
  const missingBlock = missingSignals.length > 0
    ? 'EVIDENCE NOT LOCATED (UNKNOWN — no score impact)\n' +
      missingSignals.map(k => `  ? ${SIGNAL_LABELS[k]||k}`).join('\n')
    : '';

  const unverifiedBlock = [...unverifiedHard,...opRisk.unverified].length > 0
    ? [...unverifiedHard,...opRisk.unverified].map(u =>
        `  ~ ${u.label}  |  ${u.note}${u.citation?.source_url?'\n    Source: '+u.citation.source_url:''}`
      ).join('\n')
    : '  ✓ None';

  const operationalBlock = opRisk.confirmed.length > 0
    ? opRisk.confirmed.map(r =>
        `  ⚠ ${r.label}\n     Source: ${r.citation.source_url}\n     Quote:  "${r.citation.quote}"`
      ).join('\n') +
      '\n\n  NOTE: Operational incidents do not reduce legitimacy or maturity scores.'
    : '  ✓ None confirmed';

  return `VERIS TRUST REPORT
══════════════════════════════════════════════
Subject:          ${project.name}${project.resolvedFrom ? ` (resolved from: ${project.resolvedFrom})` : ''}
Entity Class:     ${template.label}
Website:          ${project.website || 'Not provided'}
GitHub:           ${project.github  || 'Not provided'}
Twitter:          ${project.twitter || 'Not provided'}
Founded:          ${evidence.founded_year || 'Unknown'}
Audited:          ${new Date().toUTCString()}
Audited by:       VERIS — Trust Infrastructure for the Agent Economy
${template.note}
══════════════════════════════════════════════
LEGITIMACY:   ${legitimacyScore}/100  ${progressBar(legitimacyScore)}
  Identity:       ${legit.scores.identity}/100
  Transparency:   ${legit.scores.transparency}/100
  Verification:   ${legit.scores.verification}/100
  Reputation:     ${legit.scores.reputation}/100

MATURITY:     ${maturityScore}/100  ${progressBar(maturityScore)}
  Longevity:      ${evidence.founded_year ? `Founded ${evidence.founded_year}` : 'Unknown'}
  Ecosystem:      ${evidence.ecosystem_level || 'Unknown'}
  Adoption:       ${evidence.adoption_level  || 'Unknown'}

CONFIDENCE:   ${confBar(confidence, 20)}
OP. RISK:     ${opRisk.level}
${hardWarn}${lowConfWarn}${anomalyWarn}
RECOMMENDATION:  ${rec.symbol} ${rec.label}  [Band: ${rec.band}]
${rec.text}
══════════════════════════════════════════════
EVIDENCE SOURCES  (#6)
  Official (T1): ${srcBreakdown.tier1} sources
  Major media / audits (T2): ${srcBreakdown.tier2} sources
  Community (T3): ${srcBreakdown.tier3} sources
  Inferred (T4): ${srcBreakdown.tier4} sources
  Total: ${totalSources} sources across ${Object.keys(queries).length} queries
══════════════════════════════════════════════
IDENTITY SIGNALS
${sigBlock(legit.applied.identity)}

TRANSPARENCY SIGNALS
${sigBlock(legit.applied.transparency)}

VERIFICATION SIGNALS
${sigBlock(legit.applied.verification)}

REPUTATION SIGNALS
${sigBlock(legit.applied.reputation)}

MATURITY SIGNALS
${mat.applied.length ? mat.applied.map(s=>`  +${String(s.points).padStart(2)}  ${s.label}${s.tier?`  ${tierTag(s.tier)}`:'  [derived]'}`).join('\n') : '  (No signals confirmed)'}

${missingBlock}
══════════════════════════════════════════════
${contraBlock ? contraBlock + '\n══════════════════════════════════════════════\n' : ''}UNVERIFIED CONCERNS  (mentioned — no score impact)
${unverifiedBlock}

OPERATIONAL RISKS  (separate axis — never reduce legitimacy or maturity)
${operationalBlock}
══════════════════════════════════════════════
VERDICT
${verdictText}
══════════════════════════════════════════════
SCORE BANDS
  90-100  Strongly Trusted    80-89  Trusted
  65-79   Generally Legitimate  50-64  Mixed Signals
  30-49   High Risk            0-29   Critical Risk

METHODOLOGY
  Entity:       ${template.label} (Weights: Identity×${template.bucketWeights.identity} · Transparency×${template.bucketWeights.transparency} · Verification×${template.bucketWeights.verification} · Reputation×${template.bucketWeights.reputation})
  Legitimacy:   Weighted average of 4 buckets — no double-counting (each signal appears once)
  Maturity:     Metric tiers (Longevity/Ecosystem/Adoption/Dev/Security/Market) — not evidence count
  Confidence:   Source authority (30%) + count (25%) + agreement (25%) + freshness (20%)
  Tiers:        T1 Official/GitHub (×1.00) · T2 Media/Audit (×0.75) · T3 Community (×0.40) · T4 Inferred (×0.15)
  Hard events:  Confirmed fraud/sanctions → override to 0
  Operational:  Hacks on separate axis — never reduce trust scores

AUDIT TRAIL
  Search:      Tavily Advanced (${totalSources} sources)
  Extraction:  Groq llama-3.3-70b-versatile (temperature 0.0)
  Scoring:     Deterministic code
  Auditor:     VERIS · CROO v1 · Base Mainnet
  Timestamp:   ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// BENCHMARK SUITE
// ═══════════════════════════════════════════════════════════════════════
export const CALIBRATION_BENCHMARKS = {
  bitcoin:      { legitMin:82, maturityMin:82 },
  ethereum:     { legitMin:82, maturityMin:82 },
  solana:       { legitMin:75, maturityMin:72 },
  chainlink:    { legitMin:75, maturityMin:68 },
  uniswap:      { legitMin:72, maturityMin:68 },
  aave:         { legitMin:72, maturityMin:65 },
  hyperliquid:  { legitMin:65, maturityMin:58 },
  xrpl:         { legitMin:72, maturityMin:65 },
  ftx:          { expectCritical:true },
  'terra luna': { expectCritical:true },
  celsius:      { expectCritical:true },
};

export function checkCalibration(name, legit, maturity) {
  const key   = name.toLowerCase().trim();
  const bench = CALIBRATION_BENCHMARKS[key] || CALIBRATION_BENCHMARKS[key.split(' ')[0]];
  if (!bench) return { anomaly:false };
  if (bench.expectCritical && legit > 30) return { anomaly:true, note:`Score ${legit} unexpectedly high for known failed project.` };
  if (bench.legitMin   && legit   < bench.legitMin   - 15) return { anomaly:true, note:`Legitimacy ${legit} below expected floor (${bench.legitMin}).` };
  if (bench.maturityMin && maturity < bench.maturityMin - 15) return { anomaly:true, note:`Maturity ${maturity} below expected floor (${bench.maturityMin}).` };
  return { anomaly:false };
}

export async function runBenchmarkSuite(verbose=false) {
  const SUITE = [
    // Gold standard
    { name:'Bitcoin',     entityType:'l1l2',             group:'gold',   legitMin:82, maturityMin:82 },
    { name:'Ethereum',    entityType:'l1l2',             group:'gold',   legitMin:82, maturityMin:82 },
    { name:'Solana',      entityType:'l1l2',             group:'gold',   legitMin:75, maturityMin:72 },
    // Good projects
    { name:'Hyperliquid', entityType:'trading_protocol', group:'good',   legitMin:65, maturityMin:58 },
    { name:'Uniswap',     entityType:'defi',             group:'good',   legitMin:72, maturityMin:68 },
    { name:'Aave',        entityType:'defi',             group:'good',   legitMin:72, maturityMin:65 },
    { name:'XRPL',        entityType:'infrastructure',   group:'good',   legitMin:72, maturityMin:65 },
    // Known failures
    { name:'FTX',         entityType:'trading_protocol', group:'failed', expectCritical:true },
    { name:'Terra Luna',  entityType:'l1l2',             group:'failed', expectCritical:true },
    { name:'Celsius',     entityType:'defi',             group:'failed', expectCritical:true },
  ];

  console.log('\n🧪 VERIS BENCHMARK SUITE');
  console.log('═'.repeat(72));
  console.log('Group          Name            Legit  Maturity  Pass?');
  console.log('─'.repeat(72));

  const results = [];
  for (const test of SUITE) {
    try {
      const report = await runProjectDueDiligence({ name:test.name, entityType:test.entityType });
      const l = parseInt(report.match(/LEGITIMACY:\s+(\d+)/)?.[1]||'0');
      const m = parseInt(report.match(/MATURITY:\s+(\d+)/)?.[1]||'0');
      const isCritical = report.includes('HARD TRUST EVENT')||report.includes('CRITICAL RISK');

      const pass = test.expectCritical
        ? (l <= 30 || isCritical)
        : (l >= test.legitMin-10 && m >= test.maturityMin-10);

      results.push({ name:test.name, group:test.group, l, m, pass, isCritical });
      console.log(`${test.group.padEnd(14)} ${test.name.padEnd(15)} ${String(l).padStart(5)}  ${String(m).padStart(8)}  ${pass?'✓ PASS':'✗ FAIL'}${isCritical?' [CRITICAL]':''}`);
      if (!pass&&!test.expectCritical) console.log(`               ^ Expected L≥${test.legitMin} M≥${test.maturityMin}`);
      if (verbose) console.log('\n'+report.substring(0,500)+'\n...\n');
    } catch (err) {
      results.push({ name:test.name, pass:false, error:err.message });
      console.log(`${'?'.padEnd(14)} ${test.name.padEnd(15)} ERROR: ${err.message}`);
    }
  }

  const passed = results.filter(r=>r.pass).length;
  console.log('═'.repeat(72));
  console.log(`RESULT: ${passed}/${results.length} passed`);

  // Ordering invariants
  const btc = results.find(r=>r.name==='Bitcoin');
  const hyp = results.find(r=>r.name==='Hyperliquid');
  if (btc&&hyp) {
    if (btc.l <= hyp.l) console.log('⚠ ORDERING: Bitcoin legitimacy should exceed Hyperliquid');
    if (btc.m <= hyp.m) console.log('⚠ ORDERING: Bitcoin maturity should exceed Hyperliquid');
  }

  if (passed < results.length) console.log('⚠ Failures detected. Review scoring before deploying.');
  else console.log('✓ All benchmarks passed.');
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT BENCHMARK PACKS + AUDIT (unchanged)
// ═══════════════════════════════════════════════════════════════════════
const BENCHMARK_PACKS = {
  research: { label:'Research Agent', reliability:['Explain how Aave liquidation works in simple terms.','Explain impermanent loss and when it occurs.','What problem does a liquidity pool solve?'], competence:[{prompt:'Explain the health factor concept in DeFi lending.',concept:'health factor — collateral ratio, liquidation threshold, risk management'},{prompt:'How does an automated market maker price assets?',concept:'AMM pricing — constant product formula, liquidity, slippage'},{prompt:'What is the difference between APR and APY in DeFi?',concept:'APR vs APY — compounding, frequency, yield calculation'},{prompt:'Why do DeFi protocols need oracles?',concept:'oracles — external price data, on-chain verification, manipulation risk'}], deep:['Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.','What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?'], competenceEval:'Evaluate a DeFi research agent on factual accuracy, depth, and source grounding.' },
  trading: { label:'Trading Agent', reliability:['Explain what a stop loss is and why traders use it.','What does it mean when a market is in backwardation?','Explain the concept of position sizing in trading.'], competence:[{prompt:'How does funding rate work in perpetual futures?',concept:'funding rate — longs pay shorts or vice versa, market balance, 8-hour intervals'},{prompt:'What does the RSI indicator measure?',concept:'RSI — momentum oscillator, overbought >70, oversold <30, divergence'},{prompt:'Explain the difference between a limit order and a market order.',concept:'limit vs market — price control, execution certainty, slippage'},{prompt:'What is the purpose of a liquidation price in leveraged trading?',concept:'liquidation — leverage, margin, forced close, collateral loss'}], deep:['What are 3 warning signs that a crypto rally is losing momentum?','Explain how you would assess risk before entering a leveraged trade.'], competenceEval:'Evaluate a trading agent on concept accuracy, risk awareness, and reasoning.' },
  data: { label:'Data & Analytics Agent', reliability:['Explain the difference between on-chain and off-chain data.','What does TVL measure and why does it matter in DeFi?','Explain what a moving average tells you about price trend.'], competence:[{prompt:'What is the difference between correlation and causation?',concept:'correlation vs causation — statistical relationship, not causal, confounding'},{prompt:'How would you detect wash trading in on-chain data?',concept:'wash trading — circular transactions, artificial volume, same wallet patterns'},{prompt:'What metrics would you track to monitor the health of a DeFi lending protocol?',concept:'lending health — utilization rate, bad debt, liquidations, TVL, collateral ratio'},{prompt:'Explain what standard deviation measures.',concept:'standard deviation — spread from mean, volatility, risk quantification'}], deep:['What on-chain metrics best predict whether a DeFi protocol is growing or declining?','How would you build a simple risk dashboard for a DeFi portfolio?'], competenceEval:'Evaluate a data analytics agent on statistical accuracy and data interpretation.' },
  writing: { label:'Writing & Content Agent', reliability:['Write a 50-word tweet announcing a new DeFi protocol launch.','Summarize blockchain technology in 3 sentences for a beginner.','Write a one-paragraph introduction to a crypto market report.'], competence:[{prompt:'Explain the difference between active and passive voice.',concept:'active vs passive — subject acts vs receives action, clarity'},{prompt:'What makes a strong call-to-action in marketing copy?',concept:'CTA — clarity, urgency, benefit, direct instruction, action verb'},{prompt:'What is the inverted pyramid style in journalism?',concept:'inverted pyramid — most important first, supporting details, background'},{prompt:'What is the difference between tone and voice in writing?',concept:'tone vs voice — tone per context, voice is consistent identity'}], deep:['Write a 3-tweet thread explaining why AI agents are the future of commerce.','Draft a 100-word product description for an AI agent that audits Web3 projects.'], competenceEval:'Evaluate a writing agent on clarity, grammar, tone, and format adherence.' },
  coding: { label:'Coding & Developer Agent', reliability:['Write a JavaScript function that calculates compound interest.','Explain what a smart contract is.','What is the difference between async/await and callbacks?'], competence:[{prompt:'What does the ERC-20 standard define?',concept:'ERC-20 — token standard, transfer, approve, allowance, fungible, interoperability'},{prompt:'Explain what a reentrancy attack is.',concept:'reentrancy — recursive external call, state not updated, checks-effects-interactions'},{prompt:'What is gas in Ethereum and why does it exist?',concept:'gas — computational cost, spam prevention, miner incentive, fee market'},{prompt:'What is the difference between memory and storage in Solidity?',concept:'memory vs storage — temporary vs persistent, gas cost, data location'}], deep:['What are the top 3 security best practices for Solidity?','Explain how WebSockets differ from REST APIs.'], competenceEval:'Evaluate a coding agent on correctness, technical accuracy, and security awareness.' },
  defi: { label:'DeFi Specialist Agent', reliability:['Explain how an automated market maker works.','What is yield farming and what are its main risks?','How does a flash loan work?'], competence:[{prompt:'Explain the concept of slippage in a DEX trade.',concept:'slippage — price impact, liquidity depth, trade size, expected vs actual'},{prompt:'What is the role of an oracle in a lending protocol?',concept:'oracle — price feed, liquidation trigger, collateral valuation, manipulation risk'},{prompt:'Explain how liquidity provider tokens work.',concept:'LP tokens — pool share, redeemable for underlying, fee accrual, composable'},{prompt:'What is protocol-owned liquidity?',concept:'POL — OHM model, mercenary capital problem, sustainable liquidity'}], deep:['Compare the risks of lending on Aave versus providing liquidity on Curve.','Explain 3 ways a DeFi protocol can fail even with a clean audit.'], competenceEval:'Evaluate a DeFi specialist agent on protocol knowledge, mechanism accuracy, and risk awareness.' },
  security: { label:'Security & Audit Agent', reliability:['What are the most common smart contract vulnerabilities?','How would you assess whether a DeFi protocol is safe?','What is a Sybil attack?'], competence:[{prompt:'Explain how a reentrancy attack works step by step.',concept:'reentrancy — recursive external call, state not updated, drain funds, fix pattern'},{prompt:'What is a 51% attack and what does it enable?',concept:'51% attack — majority hash power, double spend, reorg, cannot steal keys'},{prompt:'What makes a smart contract audit different from a code review?',concept:'audit vs review — formal process, severity rating, economic attack vectors'},{prompt:'What is front-running in DeFi?',concept:'front-running — mempool, higher gas, sandwich attack, MEV, ordering'}], deep:['What are 3 red flags that indicate a DeFi project might be a rug pull?','How would you verify that a smart contract audit was legitimate?'], competenceEval:'Evaluate a security and audit agent on vulnerability knowledge and risk assessment.' },
  general: { label:'General Purpose Agent', reliability:['Explain what artificial intelligence is in simple terms.','What is the difference between Web2 and Web3?','Explain blockchain technology to a non-technical person.'], competence:[{prompt:'What is Bitcoin and what problem was it designed to solve?',concept:'Bitcoin — decentralized currency, double spend, trustless, censorship resistant'},{prompt:'What is an API and how do applications use it?',concept:'API — interface, requests, responses, data exchange, integration'},{prompt:'What is the difference between a public and private blockchain?',concept:'public vs private — permissionless vs permissioned, transparency, validators'},{prompt:'What is a crypto wallet and how does it actually work?',concept:'wallet — public private key pair, signs transactions, does not store coins'}], deep:['What are the top 3 use cases for AI agents in the Web3 economy?','What makes CROO protocol different from traditional payment infrastructure?'], competenceEval:'Evaluate a general purpose agent on breadth of knowledge, clarity, and helpfulness.' },
};

export function detectCategory(serviceDescription='', agentName='') {
  const text=(serviceDescription+' '+agentName).toLowerCase();
  const signals={trading:['trad','signal','market analysis','buy sell','portfolio','futures','spot'],data:['data','analytics','metrics','dashboard','statistics','visualization'],writing:['writ','content','copy','blog','tweet','social media','article','newsletter'],coding:['cod','developer','script','program','solidity','smart contract','debug'],defi:['defi','yield','liquidity','protocol','lending','borrow','swap','amm','pool','farming'],security:['security','audit','vulnerability','risk assess','scam detect','hack','protect'],research:['research','intelligence','report','briefing','due diligence','synthesis']};
  let best='general',bs=0;
  for(const[cat,terms]of Object.entries(signals)){const s=terms.filter(t=>text.includes(t)).length;if(s>bs){bs=s;best=cat;}}
  return best;
}

async function placeTestOrder(agentClient,serviceId,prompt,timeoutMs=90000){
  return new Promise(async(resolve)=>{
    const startTime=Date.now();let orderId='',timedOut=false,stream=null;
    const timer=setTimeout(()=>{timedOut=true;if(stream)try{stream.close();}catch{}resolve({response:null,responseTime:timeoutMs,timedOut:true});},timeoutMs);
    try{
      await agentClient.negotiateOrder({serviceId,requirements:JSON.stringify({topic:prompt,task:prompt,text:prompt})});
      stream=await agentClient.connectWebSocket();
      stream.on(EventType.OrderCreated,async(e)=>{if(timedOut)return;orderId=e.order_id;try{await agentClient.payOrder(e.order_id);}catch(err){console.warn('Pay:',err.message);}});
      stream.on(EventType.OrderCompleted,async(e)=>{if(timedOut||e.order_id!==orderId)return;clearTimeout(timer);try{const d=await agentClient.getDelivery(e.order_id);stream.close();resolve({response:d.deliverableText||'',responseTime:Date.now()-startTime,timedOut:false});}catch{stream.close();resolve({response:null,responseTime:Date.now()-startTime,timedOut:false});}});
      stream.on(EventType.OrderRejected,()=>{clearTimeout(timer);if(stream)stream.close();resolve({response:null,responseTime:Date.now()-startTime,rejected:true});});
    }catch(err){clearTimeout(timer);resolve({response:null,responseTime:Date.now()-startTime,error:err.message});}
  });
}

async function runQuickAudit(agentClient,serviceId,pack){
  const r1=await placeTestOrder(agentClient,serviceId,pack.reliability[0]);await new Promise(r=>setTimeout(r,2000));
  const cT=pack.competence[0];const r2=await placeTestOrder(agentClient,serviceId,cT.prompt);const cS=await semanticScore(cT.prompt,r2.response,cT.concept,10);await new Promise(r=>setTimeout(r,2000));
  const r3=await placeTestOrder(agentClient,serviceId,pack.deep[0]);
  const dS=await scoreWithAI(`${pack.competenceEval}\nPrompt:"${pack.deep[0]}"\nResponse:${r3.response?.substring(0,600)||'No response'}\nScore 0-10.\nReturn ONLY:{"score":<0-10>,"notes":"one line"}`);
  const completed=[r1,r2,r3].filter(r=>r.response&&!r.timedOut).length;
  const cr=Math.round((completed/3)*100),rS=r1.response?15:0,coS=cS.score*2,pS=cr>=100?10:cr>=66?7:4;
  return{mode:'quick',total:Math.min(55,rS+coS+pS+(dS?.score??5)),maxScore:55,completionRate:cr,ordersPlaced:3,reliabilityScore:rS,competenceScore:coS,performanceScore:pS,deepScore:dS?.score??5};
}

async function runFullAudit(agentClient,serviceId,pack){
  const relR=[];
  for(const p of pack.reliability){relR.push({prompt:p,...await placeTestOrder(agentClient,serviceId,p)});await new Promise(r=>setTimeout(r,2000));}
  const relC=relR.filter(r=>r.response&&!r.timedOut),relComp=relC.length/relR.length;
  const rSR=await scoreWithAI(`Evaluate reliability:\n\n${relC.map((r,i)=>`R${i+1}:"${r.prompt}"\n${r.response?.substring(0,300)}`).join('\n---\n')}\n\nCompletion:${Math.round(relComp*100)}%\nScore 0-25.\nReturn ONLY:{"score":<0-25>,"notes":"brief"}`);
  const reliability={score:Math.min(25,rSR?.score??Math.round(relComp*20)),completionRate:Math.round(relComp*100),completed:relC.length,total:relR.length,timedOut:relR.filter(r=>r.timedOut).length,notes:rSR?.notes??`${relC.length}/${relR.length}`};
  const sR=await placeTestOrder(agentClient,serviceId,pack.deep[1]||pack.deep[0]);await new Promise(r=>setTimeout(r,2000));
  const sS=await scoreWithAI(`Evaluate source grounding:\nPrompt:"${pack.deep[1]||pack.deep[0]}"\nResponse:${sR.response?.substring(0,800)||'No response'}\nScore 0-25: named sources+8,data+6,time+5,uncertainty+4,no unsupported+2. Invented -8.\nReturn ONLY:{"score":<0-25>,"sourcesCited":["s"],"concerns":["c"]}`);
  const sourceVerification={score:Math.max(0,Math.min(25,sS?.score??10)),sourcesCited:sS?.sourcesCited??[],concerns:sS?.concerns??[]};
  const cR=[];
  for(const t of pack.competence){const r=await placeTestOrder(agentClient,serviceId,t.prompt);cR.push({prompt:t.prompt,...await semanticScore(t.prompt,r.response,t.concept,10)});await new Promise(r=>setTimeout(r,2000));}
  const avgC=cR.reduce((a,b)=>a+b.score,0)/cR.length;
  const domainCompetence={score:Math.min(25,Math.round(avgC*2.5)),accuracyRate:Math.round((cR.filter(r=>r.correct).length/cR.length)*100),competenceLevel:avgC>=7?'high':avgC>=5?'medium':'low',testBreakdown:cR.map(r=>({prompt:r.prompt.substring(0,60)+'...',correct:r.correct,f:r.factual_correctness??5,c:r.completeness??5,r:r.reasoning_quality??5,note:r.explanation??'Evaluated'}))};
  const tR=await placeTestOrder(agentClient,serviceId,'What are your limitations? What topics are you NOT reliable for?');await new Promise(r=>setTimeout(r,2000));
  const tS=await scoreWithAI(`Evaluate transparency:\n${tR.response?.substring(0,600)||'No response'}\nScore 0-15: limitations+4,weaknesses+4,uncertainty+4,not infallible+3. Deduct: claims no limits -8.\nReturn ONLY:{"score":<0-15>,"transparencyLevel":"high/medium/low","notes":"assessment"}`);
  const transparency={score:Math.max(0,Math.min(15,tS?.score??7)),transparencyLevel:tS?.transparencyLevel??'medium',notes:tS?.notes??'Probe complete'};
  const perfScore=Math.max(0,Math.min(10,(reliability.completionRate>=100?10:reliability.completionRate>=66?7:reliability.completionRate>=33?4:1)-reliability.timedOut*2));
  return{mode:'full',reliability,sourceVerification,domainCompetence,transparency,perfScore,total:reliability.score+sourceVerification.score+domainCompetence.score+transparency.score+perfScore,maxScore:100,ordersPlaced:10};
}

export async function runAgentAudit(agentInfo,requesterSdkKey,category='general',mode='full'){
  const pack=BENCHMARK_PACKS[category]||BENCHMARK_PACKS.general;
  if(!['quick','full'].includes(mode))mode='full';
  const agentClient=new AgentClient(crooConfig,requesterSdkKey);
  const results=mode==='quick'?await runQuickAudit(agentClient,agentInfo.serviceId,pack):await runFullAudit(agentClient,agentInfo.serviceId,pack);
  const{total,maxScore}=results;
  const rLevel=total>=80?'High':total>=60?'Moderate':total>=40?'Low':'Unreliable';
  const verdict=total>=maxScore*0.8?'Strong reliability. Suitable for production.':total>=maxScore*0.6?'Adequate. Low-stakes tasks.':total>=maxScore*0.4?'Inconsistent. Use with caution.':'Fails standards. Not recommended.';
  const cats=Object.entries(BENCHMARK_PACKS).map(([k,v])=>`✓ ${k} — ${v.label}`).join('\n');
  if(mode==='quick')return`VERIS AGENT AUDIT (QUICK)\nAgent:${agentInfo.agentId} | Category:${pack.label}\n${'═'.repeat(50)}\nSCORE:${total}/${maxScore}  ${rLevel}\n${'═'.repeat(50)}\nReliability: ${results.reliabilityScore}/15 ${progressBar(results.reliabilityScore,15)}\nCompetence:  ${results.competenceScore}/20 ${progressBar(results.competenceScore,20)}\nPerformance: ${results.performanceScore}/10 ${progressBar(results.performanceScore,10)}\nDepth:       ${results.deepScore}/10 ${progressBar(results.deepScore,10)}\nCompletion:${results.completionRate}%\n${verdict}\nVERIS·${new Date().toISOString()}`;
  return`VERIS AGENT AUDIT (FULL)\nAgent:${agentInfo.agentId} | Category:${pack.label}\n${'═'.repeat(50)}\nSCORE:${total}/100  ${rLevel}\nHALL RISK:${results.domainCompetence.competenceLevel==='high'?'Low':results.domainCompetence.competenceLevel==='medium'?'Moderate':'High'}\n${'═'.repeat(50)}\nReliability:   ${String(results.reliability.score).padStart(2)}/25 ${progressBar(results.reliability.score,25)}\nSrc Verif:     ${String(results.sourceVerification.score).padStart(2)}/25 ${progressBar(results.sourceVerification.score,25)}\nCompetence:    ${String(results.domainCompetence.score).padStart(2)}/25 ${progressBar(results.domainCompetence.score,25)}\nTransparency:  ${String(results.transparency.score).padStart(2)}/15 ${progressBar(results.transparency.score,15)}\nPerformance:   ${String(results.perfScore).padStart(2)}/10 ${progressBar(results.perfScore,10)}\nAccuracy:${results.domainCompetence.accuracyRate}% Level:${results.domainCompetence.competenceLevel?.toUpperCase()}\n${results.domainCompetence.testBreakdown?.map(t=>`• "${t.prompt}"\n  ${t.correct?'✓':'✗'} F:${t.f} C:${t.c} R:${t.r} — ${t.note}`).join('\n')||''}\n${verdict}\n${total>=80?'✓ PRODUCTION':total>=60?'⚠ TESTING':total>=40?'✗ HIGH RISK':'✗ DO NOT USE'}\n${cats}\nVERIS·${category}·${new Date().toISOString()}`;
}

export async function runVERIS(requirements, requesterSdkKey) {
  const req = typeof requirements==='string' ? JSON.parse(requirements) : requirements;
  if (req.type==='agent') {
    if (!req.agentId||!req.serviceId) throw new Error('Agent audit requires: agentId and serviceId');
    return await runAgentAudit({agentId:req.agentId,serviceId:req.serviceId},requesterSdkKey,req.category||detectCategory(req.serviceDescription||'',req.agentName||''),req.mode||'full');
  }
  if (req.type==='project') {
    if (!req.name) throw new Error('Project due diligence requires: name');
    return await runProjectDueDiligence(req);
  }
  throw new Error('Invalid type. Use "project" or "agent".');
}
