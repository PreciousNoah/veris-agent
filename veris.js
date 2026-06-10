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
// SOURCE TIER CLASSIFIER
// Pattern-based. No AI.
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

const TIER2_PATTERNS = [
  'coindesk.com','theblock.co','messari.io','cointelegraph.com','decrypt.co',
  'bloomberg.com','reuters.com','ft.com','wsj.com','forbes.com','wired.com',
  'defillama.com','coingecko.com','coinmarketcap.com','etherscan.io',
  'dune.com','dune.xyz','nansen.ai','glassnode.com',
  'certik.com','trailofbits.com','openzeppelin.com','halborn.com',
  'consensys.io','immunefi.com','linkedin.com',
];

const TIER3_PATTERNS = [
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
  if (TIER2_PATTERNS.some(p => u.includes(p))) return 'tier2';
  if (TIER3_PATTERNS.some(p => u.includes(p))) return 'tier3';
  return 'tier4';
}

const TIER_WEIGHTS = { tier1: 1.00, tier2: 0.75, tier3: 0.40, tier4: 0.15 };

// ═══════════════════════════════════════════════════════════════════════
// MATURITY METRIC TIERS  (#1 — the core fix)
//
// Maturity is NOT "did we find evidence of X".
// Maturity is SCALE and TIME expressed as metric tiers.
// Each axis scores independently and sums to a fixed cap.
// Bitcoin hits all top tiers → ~90+ maturity automatically.
// ═══════════════════════════════════════════════════════════════════════
const MATURITY_METRICS = {

  longevity: {
    // Points for project age. Exclusive: only the highest matching tier fires.
    tiers: [
      { signal: 'longevity_10y',  points: 60, label: 'Operating 10+ years' },
      { signal: 'longevity_5y',   points: 40, label: 'Operating 5-9 years' },
      { signal: 'longevity_2y',   points: 20, label: 'Operating 2-4 years' },
      { signal: 'longevity_1y',   points: 10, label: 'Operating 1-2 years' },
    ],
    cap: 60,
    weight: 0.20,   // 20% of maturity score
  },

  ecosystem: {
    // Points for developer/integration ecosystem scale. Exclusive.
    tiers: [
      { signal: 'ecosystem_dominant', points: 60, label: 'Dominant global ecosystem' },
      { signal: 'ecosystem_major',    points: 40, label: 'Major ecosystem with broad integrations' },
      { signal: 'ecosystem_growing',  points: 25, label: 'Growing ecosystem' },
      { signal: 'ecosystem_small',    points: 10, label: 'Small but active ecosystem' },
    ],
    cap: 60,
    weight: 0.20,
  },

  adoption: {
    // Points for real-world usage scale. Exclusive.
    tiers: [
      { signal: 'adoption_global',  points: 60, label: 'Global institutional and retail adoption' },
      { signal: 'adoption_large',   points: 40, label: 'Large-scale adoption with significant users' },
      { signal: 'adoption_medium',  points: 25, label: 'Medium adoption with active user base' },
      { signal: 'adoption_small',   points: 10, label: 'Small but growing user base' },
    ],
    cap: 60,
    weight: 0.20,
  },

  development: {
    // Points for development activity. Additive up to cap.
    signals: {
      active_github:         15,
      multiple_contributors: 12,
      high_github_stars:     10,
      regular_releases:       8,
      recent_commits:         8,
      developer_ecosystem:   10,
      sdks_found:             7,
      grants_hackathons:      5,
      open_source:           10,
    },
    cap: 60,
    weight: 0.20,
  },

  security_track_record: {
    // Points for long-term security credibility. Additive up to cap.
    signals: {
      audit_found:           20,
      multiple_audits:       15,
      bug_bounty:            10,
      no_critical_hack:      15,  // derived: YES if confirmed_hack === NO or UNKNOWN
    },
    cap: 60,
    weight: 0.10,
  },

  market_presence: {
    // Points for market and institutional footprint. Additive up to cap.
    signals: {
      major_exchange_listed:  15,
      institutional_adoption: 15,
      top10_chain:            20,
      tvl_mentioned:          12,
      trading_volume_mentioned: 10,
      large_community:         8,
      media_coverage:          5,
    },
    cap: 60,
    weight: 0.10,
  },
};

// ═══════════════════════════════════════════════════════════════════════
// ENTITY TEMPLATES — legitimacy only (maturity is entity-agnostic now)
//
// Legitimacy = identity + transparency + verifiability
// Three sub-scores that combine to Legitimacy.  (#7)
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_TEMPLATES = {

  l1l2: {
    label: 'L1/L2 Blockchain',
    signals: ['bitcoin','ethereum','solana','avalanche','bsc','polygon','optimism',
              'arbitrum','base network','zksync','starknet','tron','litecoin','monero'],
    note: 'L1/L2 rubric: open source code and network activity are primary legitimacy signals. No startup team page expected.',
    identity:      { open_source:10, active_github:8, verifiable_history:8, founders_named:4, media_coverage:5, multiple_contributors:5 },
    transparency:  { whitepaper:10, technical_docs:10, on_chain_governance:8, roadmap:5, clear_use_case:5 },
    verification:  { audit_found:10, open_source:8, active_github:8, on_chain_governance:6, treasury_transparency:5, multiple_contributors:5 },
  },

  infrastructure: {
    label: 'Infrastructure Protocol',
    signals: ['foundation','layer','network','ledger','mainnet','consensus','validator',
              'node','xrpl','ripple','cosmos','polkadot','near','cardano','algorand'],
    note: 'Infrastructure rubric: active development and documentation are primary legitimacy signals.',
    identity:      { open_source:10, active_github:10, verifiable_history:7, media_coverage:5, founders_named:3, multiple_contributors:5 },
    transparency:  { whitepaper:10, technical_docs:10, on_chain_governance:8, clear_use_case:5, roadmap:4 },
    verification:  { open_source:10, audit_found:8, active_github:8, on_chain_governance:6, treasury_transparency:5, multiple_contributors:5 },
  },

  defi: {
    label: 'DeFi Protocol',
    signals: ['defi','yield','lending','borrow','swap','amm','liquidity pool','vault','liquid staking','dex'],
    note: 'DeFi rubric: security audit is the single most critical legitimacy signal.',
    identity:      { founders_named:10, linkedin_found:8, verifiable_history:7, team_page:5, open_source:5, active_github:5 },
    transparency:  { whitepaper:10, tokenomics:8, technical_docs:8, roadmap:5, clear_use_case:5 },
    verification:  { audit_found:15, open_source:8, active_github:7, multiple_audits:5, bug_bounty:5 },
  },

  trading_protocol: {
    label: 'Trading Protocol / Exchange',
    signals: ['exchange','trading','derivatives','perpetuals','order book','hyperliquid',
              'hyper','dydx','gmx','drift','vertex','perp exchange'],
    note: 'Trading protocol rubric: audit status and team transparency are critical.',
    identity:      { founders_named:12, linkedin_found:8, verifiable_history:8, team_page:5, open_source:5 },
    transparency:  { technical_docs:10, whitepaper:8, tokenomics:6, roadmap:5, clear_use_case:5 },
    verification:  { audit_found:15, open_source:8, active_github:7, multiple_audits:5, bug_bounty:5 },
  },

  aiagent: {
    label: 'AI Agent / Product',
    signals: ['ai agent','autonomous agent','llm','gpt','copilot','assistant','autopilot','croo','veris','ai-powered'],
    note: 'AI agent rubric: live working product and creator identity are primary legitimacy signals.',
    identity:      { founders_named:12, linkedin_found:9, verifiable_history:8, team_page:5, clear_use_case:5 },
    transparency:  { technical_docs:10, whitepaper:8, clear_use_case:8, roadmap:5, features_described:5 },
    verification:  { live_product:15, api_usage:8, audit_found:6, active_github:5, user_reviews:5 },
  },

  memecoin: {
    label: 'Meme Coin / Token',
    signals: ['meme','doge','shib','pepe','inu','elon','moon','fair launch','stealth launch','meme coin'],
    note: 'Meme coin rubric: liquidity lock and audit are primary legitimacy signals. Limited signals expected by nature.',
    identity:      { founders_named:10, open_source:8, verifiable_history:6, active_social:5, genuine_engagement:5 },
    transparency:  { tokenomics:12, roadmap:8, clear_use_case:8, whitepaper:5 },
    verification:  { liquidity_locked:15, audit_found:12, open_source:8 },
  },

  dao: {
    label: 'DAO / Governance Protocol',
    signals: ['dao','governance','vote','proposal','treasury','multisig','snapshot','aragon'],
    note: 'DAO rubric: on-chain governance and treasury transparency are primary legitimacy signals.',
    identity:      { on_chain_governance:12, open_source:10, verifiable_history:6, active_github:5, founders_named:3 },
    transparency:  { treasury_transparency:12, whitepaper:8, on_chain_governance:8, roadmap:5, active_proposals:5 },
    verification:  { multisig_confirmed:12, on_chain_governance:10, open_source:8, audit_found:5, active_proposals:5 },
  },

  startup: {
    label: 'Startup / Early Stage',
    signals: ['startup','seed','series a','backed by','venture','incubator','beta'],
    note: 'Startup rubric: founder identity and team transparency are the primary legitimacy signals.',
    identity:      { founders_named:14, linkedin_found:10, verifiable_history:8, team_page:6, clear_use_case:4 },
    transparency:  { whitepaper:8, roadmap:8, technical_docs:6, clear_use_case:6, tokenomics:4 },
    verification:  { live_product:12, active_github:8, audit_found:6, funding_confirmed:6, user_reviews:5 },
  },

  tooling: {
    label: 'Tooling / Developer Infrastructure',
    signals: ['sdk','rpc','indexer','explorer','bridge','oracle','developer tool','infrastructure tool','chainlink','wallet sdk'],
    note: 'Tooling rubric: active open source codebase and documentation are the primary legitimacy signals.',
    identity:      { founders_named:8, active_github:10, open_source:10, verifiable_history:6, media_coverage:4 },
    transparency:  { technical_docs:12, clear_use_case:8, whitepaper:6, roadmap:5, features_described:5 },
    verification:  { active_github:10, open_source:10, audit_found:8, api_usage:6, live_product:5 },
  },

  general: {
    label: 'General Project',
    signals: [],
    note: 'General rubric applied. Specify entity type for more accurate scoring.',
    identity:      { founders_named:10, active_github:8, open_source:6, verifiable_history:6, media_coverage:5 },
    transparency:  { whitepaper:8, technical_docs:8, roadmap:6, clear_use_case:5, tokenomics:4 },
    verification:  { audit_found:8, live_product:8, active_github:6, open_source:6, user_reviews:5 },
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
// HARD TRUST EVENTS — override all scores if verified
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
// Groq reads sources → returns YES / NO / UNKNOWN per signal.
// Adds per-signal source URLs and confidence estimates.
// Contradiction detection built into prompt.
// ═══════════════════════════════════════════════════════════════════════
async function extractEvidence(combinedText, projectName, entityLabel) {
  const prompt =
    `You are a structured evidence extraction engine for "${projectName}" (${entityLabel}).\n\n` +
    `SOURCES:\n${combinedText.substring(0,9000)}\n\n` +
    `RULES:\n` +
    `1. Each field = "YES", "NO", or "UNKNOWN". Default = UNKNOWN.\n` +
    `   YES = a source explicitly states this is true.\n` +
    `   NO  = a source explicitly states this is false or absent.\n` +
    `   UNKNOWN = not mentioned, ambiguous, or insufficient evidence.\n` +
    `2. NEVER set YES from implication. NEVER set NO from absence — use UNKNOWN.\n` +
    `3. Per-signal source_urls: list exact URLs that support the YES/NO claim.\n` +
    `4. ecosystem_level: "dominant", "major", "growing", "small", or "none". Based on explicit evidence only.\n` +
    `5. adoption_level: "global", "large", "medium", "small", or "none". Based on explicit evidence only.\n` +
    `6. founded_year: numeric year only, or null.\n` +
    `7. CONTRADICTION DETECTION: If two sources make conflicting claims about the same fact,\n` +
    `   add an entry to contradictions: {"field":"...","claim_a":"...","source_a":"...","claim_b":"...","source_b":"..."}.\n` +
    `8. Hard trust events require a citation with source_url + verbatim quote. Without that, set to UNKNOWN.\n` +
    `9. confidence_per_signal: 0-100 per signal. Base on source authority and clarity.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{\n` +
    `  "whitepaper":"UNKNOWN","whitepaper_urls":[],\n` +
    `  "roadmap":"UNKNOWN","roadmap_urls":[],\n` +
    `  "tokenomics":"UNKNOWN","tokenomics_urls":[],\n` +
    `  "technical_docs":"UNKNOWN","technical_docs_urls":[],\n` +
    `  "clear_use_case":"UNKNOWN","clear_use_case_urls":[],\n` +
    `  "active_github":"UNKNOWN","active_github_urls":[],\n` +
    `  "high_github_stars":"UNKNOWN","high_github_stars_urls":[],\n` +
    `  "multiple_contributors":"UNKNOWN","multiple_contributors_urls":[],\n` +
    `  "open_source":"UNKNOWN","open_source_urls":[],\n` +
    `  "audit_found":"UNKNOWN","audit_found_urls":[],\n` +
    `  "multiple_audits":"UNKNOWN","multiple_audits_urls":[],\n` +
    `  "audit_firm":null,\n` +
    `  "bug_bounty":"UNKNOWN","bug_bounty_urls":[],\n` +
    `  "regular_releases":"UNKNOWN","regular_releases_urls":[],\n` +
    `  "recent_commits":"UNKNOWN","recent_commits_urls":[],\n` +
    `  "founders_named":"UNKNOWN","founders_named_urls":[],\n` +
    `  "founder_names":[],\n` +
    `  "linkedin_found":"UNKNOWN","linkedin_found_urls":[],\n` +
    `  "team_page":"UNKNOWN","team_page_urls":[],\n` +
    `  "verifiable_history":"UNKNOWN","verifiable_history_urls":[],\n` +
    `  "active_social":"UNKNOWN","active_social_urls":[],\n` +
    `  "large_community":"UNKNOWN","large_community_urls":[],\n` +
    `  "active_community":"UNKNOWN","active_community_urls":[],\n` +
    `  "genuine_engagement":"UNKNOWN","genuine_engagement_urls":[],\n` +
    `  "media_coverage":"UNKNOWN","media_coverage_urls":[],\n` +
    `  "live_product":"UNKNOWN","live_product_urls":[],\n` +
    `  "features_described":"UNKNOWN","features_described_urls":[],\n` +
    `  "user_reviews":"UNKNOWN","user_reviews_urls":[],\n` +
    `  "api_usage":"UNKNOWN","api_usage_urls":[],\n` +
    `  "sdks_found":"UNKNOWN","sdks_found_urls":[],\n` +
    `  "liquidity_locked":"UNKNOWN","liquidity_locked_urls":[],\n` +
    `  "trading_volume_mentioned":"UNKNOWN","trading_volume_mentioned_urls":[],\n` +
    `  "tvl_mentioned":"UNKNOWN","tvl_mentioned_urls":[],\n` +
    `  "major_exchange_listed":"UNKNOWN","major_exchange_listed_urls":[],\n` +
    `  "top10_chain":"UNKNOWN","top10_chain_urls":[],\n` +
    `  "institutional_adoption":"UNKNOWN","institutional_adoption_urls":[],\n` +
    `  "developer_ecosystem":"UNKNOWN","developer_ecosystem_urls":[],\n` +
    `  "grants_hackathons":"UNKNOWN","grants_hackathons_urls":[],\n` +
    `  "on_chain_governance":"UNKNOWN","on_chain_governance_urls":[],\n` +
    `  "active_proposals":"UNKNOWN","active_proposals_urls":[],\n` +
    `  "treasury_transparency":"UNKNOWN","treasury_transparency_urls":[],\n` +
    `  "multisig_confirmed":"UNKNOWN","multisig_confirmed_urls":[],\n` +
    `  "funding_confirmed":"UNKNOWN","funding_confirmed_urls":[],\n` +
    `  "features_described":"UNKNOWN","features_described_urls":[],\n` +
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
    `evidence_citations (required for hard trust events): [{"claim":"...","source_url":"https://...","quote":"verbatim ≥25 chars","confidence":0.0-1.0}]\n` +
    `contradictions: [{"field":"audit_found","claim_a":"fully audited by CertIK","source_a":"https://...","claim_b":"no audit report available","source_b":"https://..."}]`;

  const response = await groqExtract(prompt);
  try {
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch {
    console.warn('  ⚠ Evidence parse failed — neutral baseline');
    return buildBaselineEvidence();
  }
}

function buildBaselineEvidence() {
  const boolFields = ['whitepaper','roadmap','tokenomics','technical_docs','clear_use_case','active_github','high_github_stars','multiple_contributors','open_source','audit_found','multiple_audits','bug_bounty','regular_releases','recent_commits','founders_named','linkedin_found','team_page','verifiable_history','active_social','large_community','active_community','genuine_engagement','media_coverage','live_product','features_described','user_reviews','api_usage','sdks_found','liquidity_locked','trading_volume_mentioned','tvl_mentioned','major_exchange_listed','top10_chain','institutional_adoption','developer_ecosystem','grants_hackathons','on_chain_governance','active_proposals','treasury_transparency','multisig_confirmed','funding_confirmed','confirmed_rug_pull','confirmed_fraud','confirmed_scam','sec_enforcement','sanctions','criminal_conviction','confirmed_hack','confirmed_exploit','confirmed_vulnerability'];
  const ev = {};
  boolFields.forEach(k => { ev[k] = 'UNKNOWN'; ev[`${k}_urls`] = []; });
  ev.founder_names = []; ev.audit_firm = null; ev.founded_year = null;
  ev.ecosystem_level = 'none'; ev.adoption_level = 'none';
  ev.contradictions = []; ev.confidence_per_signal = {}; ev.evidence_citations = [];
  return ev;
}

// ═══════════════════════════════════════════════════════════════════════
// LONGEVITY FLAGS — from founded_year, not AI
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
// MATURITY SCORING  (#1 — metric tiers, not evidence count)
//
// Each axis scores on a scale independent of other axes.
// Score is weighted sum of axes, normalized to 0-100.
// Bitcoin's longevity_10y + ecosystem_dominant + adoption_global alone
// account for ~60pts before any development or security signals fire.
// ═══════════════════════════════════════════════════════════════════════
function computeMaturityScore(evidence, allSources) {
  const lFlags = longevityFlags(evidence);
  const ev = { ...evidence, ...lFlags };
  const applied = [];
  const axisScores = {};

  for (const [axisKey, axis] of Object.entries(MATURITY_METRICS)) {
    let axisScore = 0;
    const axisApplied = [];

    if (axis.tiers) {
      // Exclusive tiers — only highest matching fires
      for (const tier of axis.tiers) {
        const state = ev[tier.signal] || 'UNKNOWN';
        if (state === 'YES') {
          const tierWeight = bestTierWeight(ev[`${tier.signal}_urls`] || [], '');
          const pts = Math.round(tier.points * tierWeight);
          axisScore = pts;
          axisApplied.push({ label: tier.label, points: pts, tier: bestTierName(ev[`${tier.signal}_urls`] || [], '') });
          break;  // exclusive — stop after first match
        }
      }
      // Special: ecosystem and adoption levels from extracted string fields
      if (axisKey === 'ecosystem') {
        axisScore = ecosystemPoints(evidence.ecosystem_level);
        if (axisScore > 0) axisApplied.push({ label: `Ecosystem: ${evidence.ecosystem_level}`, points: axisScore, tier: 'tier2' });
      }
      if (axisKey === 'adoption') {
        axisScore = adoptionPoints(evidence.adoption_level);
        if (axisScore > 0) axisApplied.push({ label: `Adoption: ${evidence.adoption_level}`, points: axisScore, tier: 'tier2' });
      }
    } else {
      // Additive signals
      for (const [sigKey, basePts] of Object.entries(axis.signals || {})) {
        let state = ev[sigKey] || 'UNKNOWN';

        // Derived signal: no_critical_hack = YES if confirmed_hack is NO or UNKNOWN
        if (sigKey === 'no_critical_hack') {
          state = (ev.confirmed_hack === 'NO' || ev.confirmed_hack === 'UNKNOWN') ? 'YES' : 'NO';
        }

        if (state !== 'YES') continue;
        const urls = ev[`${sigKey}_urls`] || [];
        const tierW = bestTierWeight(urls, '');
        const pts   = Math.round(basePts * tierW);
        axisScore  += pts;
        axisApplied.push({ label: SIGNAL_LABELS[sigKey] || sigKey, points: pts, tier: bestTierName(urls, '') });
      }
    }

    axisScore = Math.min(axis.cap, axisScore);
    axisScores[axisKey] = { raw: axisScore, cap: axis.cap, weight: axis.weight };
    applied.push(...axisApplied);
  }

  // Weighted sum across axes, normalized to 0-100
  let weightedSum = 0;
  let totalWeight = 0;
  for (const ax of Object.values(axisScores)) {
    weightedSum += (ax.raw / ax.cap) * ax.weight;
    totalWeight += ax.weight;
  }
  const maturityScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;

  return { maturityScore: Math.min(100, maturityScore), applied, axisScores };
}

function ecosystemPoints(level) {
  return { dominant: 60, major: 40, growing: 25, small: 10, none: 0 }[level] ?? 0;
}
function adoptionPoints(level) {
  return { global: 60, large: 40, medium: 25, small: 10, none: 0 }[level] ?? 0;
}

function bestTierWeight(urls = [], projectName = '') {
  if (!urls.length) return TIER_WEIGHTS.tier4;
  const tiers = urls.map(u => classifySourceTier(u, projectName));
  const best  = ['tier1','tier2','tier3','tier4'].find(t => tiers.includes(t)) || 'tier4';
  return TIER_WEIGHTS[best];
}

function bestTierName(urls = [], projectName = '') {
  if (!urls.length) return 'tier4';
  const tiers = urls.map(u => classifySourceTier(u, projectName));
  return ['tier1','tier2','tier3','tier4'].find(t => tiers.includes(t)) || 'tier4';
}

// ═══════════════════════════════════════════════════════════════════════
// LEGITIMACY SCORING  (#7 — three sub-layers)
// Identity + Transparency + Verification → Legitimacy
// Each sub-layer scores 0-100, then average → Legitimacy Score.
// ═══════════════════════════════════════════════════════════════════════
function computeLegitimacyScore(evidence, template, projectName) {
  const lFlags = longevityFlags(evidence);
  const ev = { ...evidence, ...lFlags };

  function scoreLayer(signalMap) {
    let raw = 0, max = 0;
    const applied = [];
    for (const [key, basePts] of Object.entries(signalMap)) {
      max += basePts;
      const state = ev[key] || 'UNKNOWN';
      if (state !== 'YES') continue;
      const urls  = ev[`${key}_urls`] || [];
      const tierW = bestTierWeight(urls, projectName);
      // Consensus: ≥2 tier1/tier2 sources → small bonus
      const t1t2  = urls.filter(u => ['tier1','tier2'].includes(classifySourceTier(u, projectName))).length;
      const cons  = t1t2 >= 2 ? 1.10 : t1t2 === 1 ? 1.00 : urls.length >= 2 ? 0.90 : 0.75;
      const pts   = Math.round(basePts * tierW * cons);
      raw  += pts;
      applied.push({ label: SIGNAL_LABELS[key] || key, points: pts, tier: bestTierName(urls, projectName), urls, confidence: evidence.confidence_per_signal?.[key] ?? (tierW === 1 ? 90 : tierW === 0.75 ? 70 : tierW === 0.4 ? 45 : 20) });
    }
    // Normalize this layer to 0-100
    const score = max > 0 ? Math.min(100, Math.round((raw / max) * 100)) : 0;
    return { score, applied };
  }

  const identity      = scoreLayer(template.identity     || {});
  const transparency  = scoreLayer(template.transparency  || {});
  const verification  = scoreLayer(template.verification  || {});

  // Legitimacy = weighted average of three layers
  const legitimacyScore = Math.round((identity.score * 0.35) + (transparency.score * 0.30) + (verification.score * 0.35));

  return {
    legitimacyScore,
    identityScore:      identity.score,
    transparencyScore:  transparency.score,
    verificationScore:  verification.score,
    identityApplied:    identity.applied,
    transparencyApplied: transparency.applied,
    verificationApplied: verification.applied,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// REPUTATION SCORE  (#2)
// Longevity without fraud = evidence of trustworthiness in itself.
// Separate from legitimacy and maturity — added as bonus to legitimacy.
// ═══════════════════════════════════════════════════════════════════════
function computeReputationBonus(evidence) {
  const lFlags = longevityFlags(evidence);
  let bonus = 0;
  const signals = [];

  // Longevity without scandal
  if (lFlags.longevity_10y === 'YES') {
    bonus += 8;
    signals.push('Operating 10+ years without collapse (+8)');
  } else if (lFlags.longevity_5y === 'YES') {
    bonus += 5;
    signals.push('Operating 5+ years without collapse (+5)');
  } else if (lFlags.longevity_2y === 'YES') {
    bonus += 2;
    signals.push('Operating 2+ years without collapse (+2)');
  }

  // No confirmed fraud/rug/scam history
  const noFraud = ['confirmed_rug_pull','confirmed_fraud','confirmed_scam','sec_enforcement','criminal_conviction']
    .every(k => evidence[k] === 'NO' || evidence[k] === 'UNKNOWN');
  if (noFraud && lFlags.longevity_5y === 'YES') {
    bonus += 5;
    signals.push('No confirmed fraud or exit scam in 5+ years (+5)');
  }

  // No sanctions
  if (evidence.sanctions === 'NO' || evidence.sanctions === 'UNKNOWN') {
    if (lFlags.longevity_2y === 'YES') {
      bonus += 2;
      signals.push('No government sanctions detected (+2)');
    }
  }

  return { bonus: Math.min(15, bonus), signals };
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIDENCE ENGINE  (#3)
// Based on source authority + cross-source agreement + coverage.
// Not retrieval count.
// ═══════════════════════════════════════════════════════════════════════
function computeConfidence(evidence, template, allSources) {
  // Authority: weighted average of source tiers
  const authority = allSources.length === 0 ? 0.05
    : allSources.reduce((sum, s) => {
        const t = classifySourceTier(s.url || '', '');
        return sum + (TIER_WEIGHTS[t] || 0.15);
      }, 0) / allSources.length;

  // Coverage: fraction of key signals that are YES or NO (resolved)
  const allSignalKeys = [
    ...Object.keys(template.identity    || {}),
    ...Object.keys(template.transparency || {}),
    ...Object.keys(template.verification || {}),
  ];
  const uniqueKeys = [...new Set(allSignalKeys)];
  const resolved   = uniqueKeys.filter(k => (evidence[k] || 'UNKNOWN') !== 'UNKNOWN').length;
  const coverage   = uniqueKeys.length > 0 ? resolved / uniqueKeys.length : 0;

  // Cross-source agreement: bonus when multiple independent sources agree
  const citations   = evidence.evidence_citations || [];
  const claimCounts = citations.reduce((acc,c) => { acc[c.claim] = (acc[c.claim]||0)+1; return acc; }, {});
  const multiCited  = Object.values(claimCounts).filter(v => v >= 2).length;
  const agreement   = Math.min(1, 0.70 + multiCited * 0.04);

  // Contradiction penalty
  const contraFactor = Math.max(0.60, 1 - (evidence.contradictions?.length || 0) * 0.10);

  const raw = (authority * 0.40 + coverage * 0.35 + agreement * 0.25) * contraFactor;
  return Math.min(0.98, Math.max(0.05, raw));
}

// ═══════════════════════════════════════════════════════════════════════
// HARD EVENT VALIDATION
// ═══════════════════════════════════════════════════════════════════════
function validateHardEvent(key, evidence) {
  if (evidence[key] !== 'YES') return false;
  const cit = (evidence.evidence_citations || []).find(c => c.claim === key);
  if (!cit) return false;
  return cit.source_url?.startsWith('http') && cit.quote?.length >= 25 && (cit.confidence||0) >= 0.85;
}

function checkHardEvents(evidence) {
  const confirmed = [], unverified = [];
  for (const ev of HARD_TRUST_EVENTS) {
    if (evidence[ev.key] !== 'YES') continue;
    const cit = (evidence.evidence_citations || []).find(c => c.claim === ev.key);
    if (validateHardEvent(ev.key, evidence)) confirmed.push({ ...ev, citation: cit });
    else unverified.push({ label: ev.label, note: 'Mentioned but insufficient citation.', citation: cit||null });
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
    const cit = (evidence.evidence_citations||[]).find(c => c.claim === op.key);
    if (validateHardEvent(op.key, evidence)) confirmed.push({ ...op, citation: cit });
    else unverified.push({ label: op.label, note: 'Mentioned but insufficient source citation.' });
  }
  return { confirmed, unverified, level: confirmed.length === 0 ? 'Low' : confirmed.length === 1 ? 'Medium' : 'High' };
}

// ═══════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE — fully deterministic  (#6)
// ═══════════════════════════════════════════════════════════════════════
function getRecommendation(legitimacyScore, hardEventsConfirmed) {
  if (hardEventsConfirmed.length > 0) return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29' };
  if (legitimacyScore >= 90) return { label:'STRONGLY TRUSTED',    symbol:'✓✓', band:'90-100' };
  if (legitimacyScore >= 80) return { label:'TRUSTED',              symbol:'✓',  band:'80-89'  };
  if (legitimacyScore >= 65) return { label:'GENERALLY LEGITIMATE', symbol:'~✓', band:'65-79'  };
  if (legitimacyScore >= 50) return { label:'MIXED SIGNALS',        symbol:'~',  band:'50-64'  };
  if (legitimacyScore >= 30) return { label:'HIGH RISK',            symbol:'✗',  band:'30-49'  };
  return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29' };
}

// ═══════════════════════════════════════════════════════════════════════
// SIGNAL LABELS
// ═══════════════════════════════════════════════════════════════════════
const SIGNAL_LABELS = {
  open_source:'Open source confirmed', active_github:'Active GitHub', high_github_stars:'High GitHub stars',
  multiple_contributors:'Multiple contributors', audit_found:'Security audit found', multiple_audits:'Multiple security audits',
  bug_bounty:'Bug bounty active', regular_releases:'Regular releases', recent_commits:'Recent commits',
  whitepaper:'Whitepaper found', technical_docs:'Technical documentation', roadmap:'Roadmap confirmed',
  tokenomics:'Tokenomics documented', clear_use_case:'Clear use case', founders_named:'Founders publicly named',
  linkedin_found:'LinkedIn profiles confirmed', team_page:'Team page found', verifiable_history:'Verifiable track record',
  active_social:'Active social accounts', large_community:'Large community', active_community:'Active community',
  genuine_engagement:'Genuine engagement', media_coverage:'Media coverage', live_product:'Live product confirmed',
  features_described:'Features described', user_reviews:'User reviews found', api_usage:'API usage confirmed',
  sdks_found:'SDKs available', liquidity_locked:'Liquidity locked', trading_volume_mentioned:'Trading volume data',
  tvl_mentioned:'TVL data found', major_exchange_listed:'Major exchange listing', top10_chain:'Top-10 chain',
  institutional_adoption:'Institutional adoption', developer_ecosystem:'Developer ecosystem',
  grants_hackathons:'Grants/hackathons', on_chain_governance:'On-chain governance', active_proposals:'Active proposals',
  treasury_transparency:'Treasury transparency', multisig_confirmed:'Multisig confirmed',
  funding_confirmed:'Funding confirmed', longevity_10y:'Active 10+ years', longevity_5y:'Active 5+ years',
  longevity_2y:'Active 2+ years', longevity_1y:'Active 1+ year', no_critical_hack:'No confirmed critical hack',
};

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════
async function collectEvidence(query, projectName = '') {
  try {
    const res = await tavilyClient.search(query, { searchDepth:'advanced', maxResults:5, includeAnswer:false });
    if (!res.results?.length) return { text:'', sourceCount:0, sources:[] };
    const sources = res.results.map(r => ({
      title: r.title, url: r.url,
      tier: classifySourceTier(r.url, projectName),
      snippet: r.content?.substring(0,500) || '',
    }));
    const text = sources.map((s,i) =>
      `[Source ${i+1} | ${s.tier.toUpperCase()} | ${s.url}]\n${s.title}\n${s.snippet}`
    ).join('\n\n---\n\n');
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
  return { score:Math.max(0,Math.min(maxScore,result?.score??Math.round(maxScore*0.5))), factual_correctness:result?.factual_correctness??5, completeness:result?.completeness??5, reasoning_quality:result?.reasoning_quality??5, correct:result?.correct??false, explanation:result?.explanation??'Evaluated' };
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

function tierTag(t) {
  return { tier1:'[T1:Official]', tier2:'[T2:Media]', tier3:'[T3:Community]', tier4:'[T4:Inferred]' }[t]||'[T?]';
}

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE — MAIN PIPELINE
// Three outputs: LEGITIMACY / MATURITY / OPERATIONAL RISK
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
    Object.entries(queries).map(async ([key,query]) => ({ key, ...await collectEvidence(query,project.name) }))
  );
  const allSources   = searchResults.flatMap(r => r.sources);
  const totalSources = searchResults.reduce((a,r) => a+r.sourceCount, 0);
  const combinedText = searchResults.filter(r => r.text).map(r => `=== ${r.key.toUpperCase()} ===\n${r.text}`).join('\n\n');

  // 3 — Extract (Groq, temp 0.0, YES/NO/UNKNOWN + ecosystem/adoption levels + contradictions)
  console.log('  → Extracting evidence...');
  const evidence = await extractEvidence(combinedText, project.name, template.label);

  // 4 — Hard events
  const { confirmed: hardEvents, unverified: unverifiedHard } = checkHardEvents(evidence);

  // 5 — Score legitimacy (three layers)
  console.log('  → Scoring...');
  const legit = computeLegitimacyScore(evidence, template, project.name);
  const rep   = computeReputationBonus(evidence);
  const rawLegit = Math.min(100, legit.legitimacyScore + rep.bonus);

  // 6 — Score maturity (metric tiers, not evidence count)
  const mat = computeMaturityScore(evidence, allSources);

  // Hard events override
  const legitimacyScore = hardEvents.length > 0 ? 0 : rawLegit;
  const maturityScore   = hardEvents.length > 0 ? 0 : mat.maturityScore;

  // 7 — Operational risk
  const opRisk = checkOperationalRisk(evidence);

  // 8 — Confidence
  const confidence = computeConfidence(evidence, template, allSources);

  // 9 — Recommendation
  const rec = getRecommendation(legitimacyScore, hardEvents);

  // 10 — Calibration
  const calibration = checkCalibration(project.name, legitimacyScore, maturityScore);

  // 11 — Verdict (Groq narrates from confirmed facts only)
  console.log('  → Generating verdict...');
  const verdictText = await groqSynthesize(
    `Write a 2-3 sentence trust audit verdict for "${project.name}" (${template.label}).\n\n` +
    `Legitimacy: ${legitimacyScore}/100 (Identity:${legit.identityScore} Transparency:${legit.transparencyScore} Verification:${legit.verificationScore})\n` +
    `Maturity: ${maturityScore}/100\nConfidence: ${Math.round(confidence*100)}%\nOperational Risk: ${opRisk.level}\n\n` +
    `Confirmed legitimacy signals:\n${[...legit.identityApplied,...legit.transparencyApplied,...legit.verificationApplied].map(s=>`• ${s.label}`).join('\n')||'• None'}\n\n` +
    `Confirmed maturity signals:\n${mat.applied.map(s=>`• ${s.label}`).join('\n')||'• None'}\n\n` +
    `Reputation:\n${rep.signals.join('\n')||'• None'}\n\n` +
    `Hard trust events:\n${hardEvents.map(e=>`• ${e.label}`).join('\n')||'• None'}\n\n` +
    `Operational risks:\n${opRisk.confirmed.map(r=>`• ${r.label}`).join('\n')||'• None confirmed'}\n\n` +
    `Rules: Only reference facts above. Legitimacy ≠ quality. If confidence <50%, note scores reflect limited evidence.`,
    'Write a factual trust audit verdict. Do not add information not listed above. Be direct.'
  );

  // ─── Format ───
  const hardWarn = hardEvents.length > 0
    ? `\n⛔ HARD TRUST EVENT — All scores overridden to 0\n` +
      hardEvents.map(e => `   ${e.label}\n   Source: ${e.citation.source_url}\n   Quote:  "${e.citation.quote}"`).join('\n')
    : '';
  const lowConfWarn = confidence < 0.40
    ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence*100)}%): Limited sources. UNKNOWN ≠ negative.`
    : confidence < 0.65
    ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence*100)}%): Some areas have limited evidence.`
    : '';
  const anomalyWarn = calibration.anomaly ? `\n⚠  SCORE ANOMALY: ${calibration.note}` : '';

  function signalBlock(signals) {
    if (!signals.length) return '  (No signals confirmed in retrieved sources)';
    return signals.map(s =>
      `  +${String(s.points).padStart(2)}  ${s.label}  ${tierTag(s.tier)}${s.confidence!==undefined?` conf:${s.confidence}%`:''}` +
      (s.urls?.[0] ? `\n       └─ ${s.urls[0]}` : '')
    ).join('\n');
  }

  // Contradiction block  (#5)
  const contraBlock = evidence.contradictions?.length > 0
    ? '\n══════════════════════════════════════════════\n' +
      '⚡ CONFLICTS DETECTED — Manual verification recommended\n' +
      evidence.contradictions.map(c =>
        `  Field: ${c.field}\n` +
        `  Claim A: "${c.claim_a}"\n  Source: ${c.source_a}\n` +
        `  Claim B: "${c.claim_b}"\n  Source: ${c.source_b}`
      ).join('\n\n')
    : '';

  // Evidence missing section  (#6)
  const allTemplateSignals = [...new Set([
    ...Object.keys(template.identity||{}),
    ...Object.keys(template.transparency||{}),
    ...Object.keys(template.verification||{}),
  ])];
  const missingSignals = allTemplateSignals.filter(k => (evidence[k]||'UNKNOWN') === 'UNKNOWN');
  const missingBlock = missingSignals.length > 0
    ? '\nEVIDENCE NOT LOCATED (UNKNOWN — no score impact)\n' +
      missingSignals.map(k => `  ? ${SIGNAL_LABELS[k]||k}`).join('\n')
    : '';

  const unverifiedBlock = [...unverifiedHard,...opRisk.unverified].length > 0
    ? [...unverifiedHard,...opRisk.unverified].map(u =>
        `  ~ ${u.label}\n    ${u.note}${u.citation?.source_url?'\n    Source: '+u.citation.source_url:''}`
      ).join('\n')
    : '  ✓ None';

  const operationalBlock = opRisk.confirmed.length > 0
    ? opRisk.confirmed.map(r =>
        `  ⚠ ${r.label}\n     Source: ${r.citation.source_url}\n     Quote:  "${r.citation.quote}"`
      ).join('\n') +
      '\n\n  NOTE: Operational incidents do not reduce legitimacy or maturity scores.'
    : '  ✓ None confirmed';

  const repBlock = rep.signals.length > 0
    ? rep.signals.map(s => `  ✓ ${s}`).join('\n') + `\n  Reputation bonus: +${rep.bonus} pts`
    : '  (Insufficient longevity data for reputation bonus)';

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
LEGITIMACY:   ${legitimacyScore}/100  ${progressBar(legitimacyScore,100)}
  Identity:       ${legit.identityScore}/100
  Transparency:   ${legit.transparencyScore}/100
  Verification:   ${legit.verificationScore}/100

MATURITY:     ${maturityScore}/100  ${progressBar(maturityScore,100)}
  Longevity:      ${evidence.founded_year ? `Founded ${evidence.founded_year}` : 'Unknown'}
  Ecosystem:      ${evidence.ecosystem_level || 'Unknown'}
  Adoption:       ${evidence.adoption_level  || 'Unknown'}

CONFIDENCE:   ${confBar(confidence,20)}
OP. RISK:     ${opRisk.level}
${hardWarn}${lowConfWarn}${anomalyWarn}
RECOMMENDATION:  ${rec.symbol} ${rec.label}  [Band: ${rec.band}]
══════════════════════════════════════════════
IDENTITY SIGNALS
${signalBlock(legit.identityApplied)}

TRANSPARENCY SIGNALS
${signalBlock(legit.transparencyApplied)}

VERIFICATION SIGNALS
${signalBlock(legit.verificationApplied)}

REPUTATION SIGNALS
${repBlock}

MATURITY SIGNALS
${signalBlock(mat.applied)}
${missingBlock}
══════════════════════════════════════════════
UNVERIFIED CONCERNS  (no score impact)
${unverifiedBlock}

OPERATIONAL RISKS  (separate axis — never reduce legitimacy or maturity)
${operationalBlock}
${contraBlock}
══════════════════════════════════════════════
VERDICT
${verdictText}
══════════════════════════════════════════════
SCORE BANDS
  90-100  Strongly Trusted    80-89  Trusted
  65-79   Generally Legitimate  50-64  Mixed Signals
  30-49   High Risk            0-29   Critical Risk

METHODOLOGY
  Legitimacy = (Identity×0.35 + Transparency×0.30 + Verification×0.35) + Reputation bonus
  Maturity   = Weighted metric tiers (Longevity 20% · Ecosystem 20% · Adoption 20% · Dev 20% · Security 10% · Market 10%)
  Tiers:     T1 Official (×1.0) · T2 Media/Audit (×0.75) · T3 Community (×0.40) · T4 Inferred (×0.15)
  UNKNOWN    = zero score impact — only reduces confidence
  Hard events: confirmed fraud/sanctions → override all scores to 0
  Operational: hacks on separate axis — never reduce legitimacy or maturity

AUDIT TRAIL
  Search:      Tavily Advanced (${totalSources} sources, ${Object.keys(queries).length} queries)
  Extraction:  Groq llama-3.3-70b-versatile (temperature 0.0)
  Scoring:     Deterministic code
  Auditor:     VERIS · CROO v1 · Base Mainnet
  Timestamp:   ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// BENCHMARK SUITE  (#8)
// ═══════════════════════════════════════════════════════════════════════
export const CALIBRATION_BENCHMARKS = {
  bitcoin:      { legitMin:85, maturityMin:85 },
  ethereum:     { legitMin:85, maturityMin:85 },
  solana:       { legitMin:78, maturityMin:75 },
  chainlink:    { legitMin:78, maturityMin:72 },
  uniswap:      { legitMin:75, maturityMin:70 },
  aave:         { legitMin:75, maturityMin:68 },
  hyperliquid:  { legitMin:70, maturityMin:60 },
  xrpl:         { legitMin:75, maturityMin:68 },
  ftx:          { expectCritical:true },
  'terra luna': { expectCritical:true },
  celsius:      { expectCritical:true },
};

export function checkCalibration(projectName, legitScore, maturityScore) {
  const key   = projectName.toLowerCase().trim();
  const bench = CALIBRATION_BENCHMARKS[key] || CALIBRATION_BENCHMARKS[key.split(' ')[0]];
  if (!bench) return { anomaly:false };
  if (bench.expectCritical && legitScore > 30) return { anomaly:true, note:`Score ${legitScore} unexpectedly high for known failed/fraudulent project.` };
  if (bench.legitMin   && legitScore   < bench.legitMin   - 15) return { anomaly:true, note:`Legitimacy ${legitScore} below expected floor (${bench.legitMin}) for ${projectName}.` };
  if (bench.maturityMin && maturityScore < bench.maturityMin - 15) return { anomaly:true, note:`Maturity ${maturityScore} below expected floor (${bench.maturityMin}) for ${projectName}.` };
  return { anomaly:false };
}

export async function runBenchmarkSuite(verbose=false) {
  const SUITE = [
    // Gold standard
    { name:'Bitcoin',     entityType:'l1l2',             group:'gold',    legitMin:85, maturityMin:85 },
    { name:'Ethereum',    entityType:'l1l2',             group:'gold',    legitMin:85, maturityMin:85 },
    { name:'Solana',      entityType:'l1l2',             group:'gold',    legitMin:78, maturityMin:75 },
    // Good projects
    { name:'Hyperliquid', entityType:'trading_protocol', group:'good',    legitMin:70, maturityMin:60 },
    { name:'Uniswap',     entityType:'defi',             group:'good',    legitMin:75, maturityMin:70 },
    { name:'Aave',        entityType:'defi',             group:'good',    legitMin:75, maturityMin:68 },
    // Known failures — expect critical
    { name:'FTX',         entityType:'trading_protocol', group:'failed',  expectCritical:true },
    { name:'Terra Luna',  entityType:'l1l2',             group:'failed',  expectCritical:true },
    { name:'Celsius',     entityType:'defi',             group:'failed',  expectCritical:true },
  ];

  console.log('\n🧪 VERIS BENCHMARK SUITE');
  console.log('═'.repeat(70));
  console.log('Group          Name            Legitimacy  Maturity  Pass?');
  console.log('─'.repeat(70));

  const results = [];
  for (const test of SUITE) {
    try {
      const report = await runProjectDueDiligence({ name:test.name, entityType:test.entityType });
      const l = parseInt(report.match(/LEGITIMACY:\s+(\d+)/)?.[1]  || '0');
      const m = parseInt(report.match(/MATURITY:\s+(\d+)/)?.[1] || '0');
      const isCritical = report.includes('HARD TRUST EVENT') || report.includes('CRITICAL RISK');

      const pass = test.expectCritical
        ? (l <= 30 || isCritical)
        : (l >= test.legitMin - 10 && m >= test.maturityMin - 10);

      results.push({ name:test.name, group:test.group, l, m, pass, isCritical });
      const passStr = pass ? '✓ PASS' : '✗ FAIL';
      console.log(`${test.group.padEnd(14)} ${test.name.padEnd(15)} L:${String(l).padStart(3)}       M:${String(m).padStart(3)}    ${passStr}${isCritical?' [CRITICAL]':''}`);
      if (!pass && !test.expectCritical) console.log(`               ^ Expected L≥${test.legitMin} M≥${test.maturityMin}`);
      if (verbose) console.log('\n' + report.substring(0,500) + '\n...\n');
    } catch (err) {
      results.push({ name:test.name, pass:false, error:err.message });
      console.log(`${'?'.padEnd(14)} ${test.name.padEnd(15)} ERROR: ${err.message}`);
    }
  }

  const passed = results.filter(r => r.pass).length;
  console.log('═'.repeat(70));
  console.log(`RESULT: ${passed}/${results.length} passed`);

  // Ordering sanity check
  const btc = results.find(r => r.name==='Bitcoin');
  const hyp = results.find(r => r.name==='Hyperliquid');
  if (btc && hyp && btc.l <= hyp.l) console.log('⚠ ORDERING FAILURE: Bitcoin should score higher than Hyperliquid on legitimacy');
  if (btc && hyp && btc.m <= hyp.m) console.log('⚠ ORDERING FAILURE: Bitcoin should score higher than Hyperliquid on maturity');

  if (passed < results.length) console.log('⚠ Failures detected. Review scoring before deploying.');
  else console.log('✓ All benchmarks passed.');
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT BENCHMARK PACKS
// ═══════════════════════════════════════════════════════════════════════
const BENCHMARK_PACKS = {
  research: { label:'Research Agent', reliability:['Explain how Aave liquidation works in simple terms.','Explain impermanent loss and when it occurs.','What problem does a liquidity pool solve?'], competence:[{prompt:'Explain the health factor concept in DeFi lending.',concept:'health factor — collateral ratio, liquidation threshold, risk management'},{prompt:'How does an automated market maker price assets?',concept:'AMM pricing — constant product formula, liquidity, slippage'},{prompt:'What is the difference between APR and APY in DeFi?',concept:'APR vs APY — compounding, frequency, yield calculation'},{prompt:'Why do DeFi protocols need oracles?',concept:'oracles — external price data, on-chain verification, manipulation risk'}], deep:['Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.','What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?'], competenceEval:'Evaluate a DeFi research agent on factual accuracy, depth, and source grounding.' },
  trading: { label:'Trading Agent', reliability:['Explain what a stop loss is and why traders use it.','What does it mean when a market is in backwardation?','Explain the concept of position sizing in trading.'], competence:[{prompt:'How does funding rate work in perpetual futures?',concept:'funding rate — longs pay shorts or vice versa, market balance, 8-hour intervals'},{prompt:'What does the RSI indicator measure?',concept:'RSI — momentum oscillator, overbought >70, oversold <30, divergence'},{prompt:'Explain the difference between a limit order and a market order.',concept:'limit vs market — price control, execution certainty, slippage'},{prompt:'What is the purpose of a liquidation price in leveraged trading?',concept:'liquidation — leverage, margin, forced close, collateral loss'}], deep:['What are 3 warning signs that a crypto rally is losing momentum?','Explain how you would assess risk before entering a leveraged trade.'], competenceEval:'Evaluate a trading agent on concept accuracy, risk awareness, and reasoning.' },
  data: { label:'Data & Analytics Agent', reliability:['Explain the difference between on-chain and off-chain data.','What does TVL measure and why does it matter in DeFi?','Explain what a moving average tells you about price trend.'], competence:[{prompt:'What is the difference between correlation and causation?',concept:'correlation vs causation — statistical relationship, not causal, confounding'},{prompt:'How would you detect wash trading in on-chain data?',concept:'wash trading — circular transactions, artificial volume, same wallet patterns'},{prompt:'What metrics would you track to monitor the health of a DeFi lending protocol?',concept:'lending health — utilization rate, bad debt, liquidations, TVL, collateral ratio'},{prompt:'Explain what standard deviation measures.',concept:'standard deviation — spread from mean, volatility, risk quantification'}], deep:['What on-chain metrics best predict whether a DeFi protocol is growing or declining?','How would you build a simple risk dashboard for a DeFi portfolio?'], competenceEval:'Evaluate a data analytics agent on statistical accuracy and data interpretation.' },
  writing: { label:'Writing & Content Agent', reliability:['Write a 50-word tweet announcing a new DeFi protocol launch.','Summarize blockchain technology in 3 sentences for a beginner.','Write a one-paragraph introduction to a crypto market report.'], competence:[{prompt:'Explain the difference between active and passive voice.',concept:'active vs passive — subject acts vs receives action, clarity'},{prompt:'What makes a strong call-to-action in marketing copy?',concept:'CTA — clarity, urgency, benefit, direct instruction, action verb'},{prompt:'What is the inverted pyramid style in journalism?',concept:'inverted pyramid — most important first, supporting details, background'},{prompt:'What is the difference between tone and voice in writing?',concept:'tone vs voice — tone per context, voice is consistent identity'}], deep:['Write a 3-tweet thread explaining why AI agents are the future of commerce.','Draft a 100-word product description for an AI agent that audits Web3 projects.'], competenceEval:'Evaluate a writing agent on clarity, grammar, tone, and format adherence.' },
  coding: { label:'Coding & Developer Agent', reliability:['Write a JavaScript function that calculates compound interest.','Explain what a smart contract is.','What is the difference between async/await and callbacks?'], competence:[{prompt:'What does the ERC-20 standard define?',concept:'ERC-20 — token standard, transfer, approve, allowance, fungible, interoperability'},{prompt:'Explain what a reentrancy attack is and how to prevent it.',concept:'reentrancy — recursive external call, state not updated, checks-effects-interactions'},{prompt:'What is gas in Ethereum and why does it exist?',concept:'gas — computational cost, spam prevention, miner incentive, fee market'},{prompt:'What is the difference between memory and storage in Solidity?',concept:'memory vs storage — temporary vs persistent, gas cost, data location'}], deep:['What are the top 3 security best practices for Solidity?','Explain how WebSockets differ from REST APIs.'], competenceEval:'Evaluate a coding agent on correctness, technical accuracy, and security awareness.' },
  defi: { label:'DeFi Specialist Agent', reliability:['Explain how an automated market maker works.','What is yield farming and what are its main risks?','How does a flash loan work?'], competence:[{prompt:'Explain the concept of slippage in a DEX trade.',concept:'slippage — price impact, liquidity depth, trade size, expected vs actual'},{prompt:'What is the role of an oracle in a lending protocol?',concept:'oracle — price feed, liquidation trigger, collateral valuation, manipulation risk'},{prompt:'Explain how liquidity provider tokens work.',concept:'LP tokens — pool share, redeemable for underlying, fee accrual, composable'},{prompt:'What is protocol-owned liquidity?',concept:'POL — OHM model, mercenary capital problem, sustainable liquidity'}], deep:['Compare the risks of lending on Aave versus providing liquidity on Curve.','Explain 3 ways a DeFi protocol can fail even with a clean audit.'], competenceEval:'Evaluate a DeFi specialist agent on protocol knowledge, mechanism accuracy, and risk awareness.' },
  security: { label:'Security & Audit Agent', reliability:['What are the most common smart contract vulnerabilities?','How would you assess whether a DeFi protocol is safe?','What is a Sybil attack?'], competence:[{prompt:'Explain how a reentrancy attack works step by step.',concept:'reentrancy — recursive external call, state not updated, drain funds, checks-effects-interactions'},{prompt:'What is a 51% attack and what does it enable?',concept:'51% attack — majority hash power, double spend, reorg, cannot steal keys'},{prompt:'What makes a smart contract audit different from a code review?',concept:'audit vs review — formal process, severity rating, economic attack vectors'},{prompt:'What is front-running in DeFi?',concept:'front-running — mempool, higher gas, sandwich attack, MEV, ordering'}], deep:['What are 3 red flags that indicate a DeFi project might be a rug pull?','How would you verify that a smart contract audit was legitimate?'], competenceEval:'Evaluate a security and audit agent on vulnerability knowledge and risk assessment.' },
  general: { label:'General Purpose Agent', reliability:['Explain what artificial intelligence is in simple terms.','What is the difference between Web2 and Web3?','Explain blockchain technology to a non-technical person.'], competence:[{prompt:'What is Bitcoin and what problem was it designed to solve?',concept:'Bitcoin — decentralized currency, double spend, trustless, censorship resistant'},{prompt:'What is an API and how do applications use it?',concept:'API — interface, requests, responses, data exchange, integration'},{prompt:'What is the difference between a public and private blockchain?',concept:'public vs private — permissionless vs permissioned, transparency, validators'},{prompt:'What is a crypto wallet and how does it actually work?',concept:'wallet — public private key pair, signs transactions, does not store coins'}], deep:['What are the top 3 use cases for AI agents in the Web3 economy?','What makes CROO protocol different from traditional payment infrastructure?'], competenceEval:'Evaluate a general purpose agent on breadth of knowledge, clarity, and helpfulness.' },
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

async function runQuickAudit(agentClient,serviceId,pack) {
  const r1=await placeTestOrder(agentClient,serviceId,pack.reliability[0]); await new Promise(r=>setTimeout(r,2000));
  const cT=pack.competence[0]; const r2=await placeTestOrder(agentClient,serviceId,cT.prompt); const cS=await semanticScore(cT.prompt,r2.response,cT.concept,10); await new Promise(r=>setTimeout(r,2000));
  const r3=await placeTestOrder(agentClient,serviceId,pack.deep[0]);
  const dS=await scoreWithAI(`${pack.competenceEval}\nPrompt:"${pack.deep[0]}"\nResponse:${r3.response?.substring(0,600)||'No response'}\nScore 0-10.\nReturn ONLY:{"score":<0-10>,"notes":"one line"}`);
  const completed=[r1,r2,r3].filter(r=>r.response&&!r.timedOut).length;
  const cr=Math.round((completed/3)*100), rS=r1.response?15:0, coS=cS.score*2, pS=cr>=100?10:cr>=66?7:4;
  return {mode:'quick',total:Math.min(55,rS+coS+pS+(dS?.score??5)),maxScore:55,completionRate:cr,ordersPlaced:3,reliabilityScore:rS,competenceScore:coS,performanceScore:pS,deepScore:dS?.score??5};
}

async function runFullAudit(agentClient,serviceId,pack) {
  console.log('  → Reliability...'); const relR=[];
  for(const p of pack.reliability){relR.push({prompt:p,...await placeTestOrder(agentClient,serviceId,p)});await new Promise(r=>setTimeout(r,2000));}
  const relC=relR.filter(r=>r.response&&!r.timedOut),relComp=relC.length/relR.length;
  const rSR=await scoreWithAI(`Evaluate reliability:\n\n${relC.map((r,i)=>`R${i+1}:"${r.prompt}"\n${r.response?.substring(0,300)}`).join('\n---\n')}\n\nCompletion:${Math.round(relComp*100)}%\nScore 0-25.\nReturn ONLY:{"score":<0-25>,"notes":"brief"}`);
  const reliability={score:Math.min(25,rSR?.score??Math.round(relComp*20)),completionRate:Math.round(relComp*100),completed:relC.length,total:relR.length,timedOut:relR.filter(r=>r.timedOut).length,notes:rSR?.notes??`${relC.length}/${relR.length}`};
  console.log('  → Source verification...'); const sR=await placeTestOrder(agentClient,serviceId,pack.deep[1]||pack.deep[0]); await new Promise(r=>setTimeout(r,2000));
  const sS=await scoreWithAI(`Evaluate source grounding:\nPrompt:"${pack.deep[1]||pack.deep[0]}"\nResponse:${sR.response?.substring(0,800)||'No response'}\nScore 0-25: named sources+8,data+6,time+5,uncertainty+4,no unsupported+2. Invented -8.\nReturn ONLY:{"score":<0-25>,"sourcesCited":["s"],"concerns":["c"]}`);
  const sourceVerification={score:Math.max(0,Math.min(25,sS?.score??10)),sourcesCited:sS?.sourcesCited??[],concerns:sS?.concerns??[]};
  console.log('  → Domain competence...'); const cR=[];
  for(const t of pack.competence){const r=await placeTestOrder(agentClient,serviceId,t.prompt);cR.push({prompt:t.prompt,...await semanticScore(t.prompt,r.response,t.concept,10)});await new Promise(r=>setTimeout(r,2000));}
  const avgC=cR.reduce((a,b)=>a+b.score,0)/cR.length;
  const domainCompetence={score:Math.min(25,Math.round(avgC*2.5)),accuracyRate:Math.round((cR.filter(r=>r.correct).length/cR.length)*100),competenceLevel:avgC>=7?'high':avgC>=5?'medium':'low',testBreakdown:cR.map(r=>({prompt:r.prompt.substring(0,60)+'...',correct:r.correct,factual_correctness:r.factual_correctness??5,completeness:r.completeness??5,reasoning_quality:r.reasoning_quality??5,explanation:r.explanation??'Evaluated'}))};
  console.log('  → Transparency...'); const tR=await placeTestOrder(agentClient,serviceId,'What are your limitations? What topics are you NOT reliable for?'); await new Promise(r=>setTimeout(r,2000));
  const tS=await scoreWithAI(`Evaluate transparency:\n${tR.response?.substring(0,600)||'No response'}\nScore 0-15: limitations+4,weaknesses+4,uncertainty+4,not infallible+3. Deduct: claims no limits -8.\nReturn ONLY:{"score":<0-15>,"transparencyLevel":"high/medium/low","notes":"assessment"}`);
  const transparency={score:Math.max(0,Math.min(15,tS?.score??7)),transparencyLevel:tS?.transparencyLevel??'medium',notes:tS?.notes??'Probe complete'};
  const perfScore=Math.max(0,Math.min(10,(reliability.completionRate>=100?10:reliability.completionRate>=66?7:reliability.completionRate>=33?4:1)-reliability.timedOut*2));
  return {mode:'full',reliability,sourceVerification,domainCompetence,transparency,perfScore,total:reliability.score+sourceVerification.score+domainCompetence.score+transparency.score+perfScore,maxScore:100,ordersPlaced:10};
}

export async function runAgentAudit(agentInfo, requesterSdkKey, category='general', mode='full') {
  console.log(`\n🤖 A2A Audit | Agent: ${agentInfo.agentId} | Category: ${category} | Mode: ${mode}`);
  const pack=BENCHMARK_PACKS[category]||BENCHMARK_PACKS.general;
  if(!['quick','full'].includes(mode)) mode='full';
  const agentClient=new AgentClient(crooConfig,requesterSdkKey);
  const results=mode==='quick'?await runQuickAudit(agentClient,agentInfo.serviceId,pack):await runFullAudit(agentClient,agentInfo.serviceId,pack);
  const {total,maxScore}=results;
  const rLevel=total>=80?'High':total>=60?'Moderate':total>=40?'Low':'Unreliable';
  const verdict=total>=maxScore*0.8?'Strong reliability. Suitable for production.':total>=maxScore*0.6?'Adequate. Low-stakes tasks.':total>=maxScore*0.4?'Inconsistent. Use with caution.':'Fails standards. Not recommended.';
  const cats=Object.entries(BENCHMARK_PACKS).map(([k,v])=>`✓ ${k} — ${v.label}`).join('\n');
  if(mode==='quick') return `VERIS AGENT AUDIT (QUICK)\nAgent:${agentInfo.agentId} | Category:${pack.label}\n${'═'.repeat(50)}\nSCORE:${total}/${maxScore}  ${rLevel}\n${'═'.repeat(50)}\nReliability: ${results.reliabilityScore}/15 ${progressBar(results.reliabilityScore,15)}\nCompetence:  ${results.competenceScore}/20 ${progressBar(results.competenceScore,20)}\nPerformance: ${results.performanceScore}/10 ${progressBar(results.performanceScore,10)}\nDepth:       ${results.deepScore}/10 ${progressBar(results.deepScore,10)}\nCompletion:${results.completionRate}%\n${verdict}\nVERIS·${new Date().toISOString()}`;
  return `VERIS AGENT AUDIT (FULL)\nAgent:${agentInfo.agentId} | Category:${pack.label}\n${'═'.repeat(50)}\nSCORE:${total}/100  ${rLevel}\nHALLUCINATION RISK:${results.domainCompetence.competenceLevel==='high'?'Low':results.domainCompetence.competenceLevel==='medium'?'Moderate':'High'}\n${'═'.repeat(50)}\nReliability:   ${String(results.reliability.score).padStart(2)}/25 ${progressBar(results.reliability.score,25)}\nSrc Verif:     ${String(results.sourceVerification.score).padStart(2)}/25 ${progressBar(results.sourceVerification.score,25)}\nCompetence:    ${String(results.domainCompetence.score).padStart(2)}/25 ${progressBar(results.domainCompetence.score,25)}\nTransparency:  ${String(results.transparency.score).padStart(2)}/15 ${progressBar(results.transparency.score,15)}\nPerformance:   ${String(results.perfScore).padStart(2)}/10 ${progressBar(results.perfScore,10)}\nAccuracy:${results.domainCompetence.accuracyRate}% Level:${results.domainCompetence.competenceLevel?.toUpperCase()}\n${results.domainCompetence.testBreakdown?.map(t=>`• "${t.prompt}"\n  ${t.correct?'✓':'✗'} F:${t.factual_correctness} C:${t.completeness} R:${t.reasoning_quality} — ${t.explanation}`).join('\n')||'Tests completed'}\n${verdict}\n${total>=80?'✓ PRODUCTION':total>=60?'⚠ TESTING':total>=40?'✗ HIGH RISK':'✗ DO NOT USE'}\n${cats}\nVERIS·${category}·${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════
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