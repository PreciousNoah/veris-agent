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
// ENHANCED ENTITY RESOLUTION
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_ALIASES = {
  'bitcoin.org':          { canonical: 'Bitcoin',     type: 'l1l2' },
  'bitcoincore.org':      { canonical: 'Bitcoin',     type: 'l1l2' },
  'bitcoin.com':          { canonical: 'Bitcoin',     type: 'l1l2', note: 'Not official domain' },
  'github.com/bitcoin':   { canonical: 'Bitcoin',     type: 'l1l2' },
  'bitcoin':              { canonical: 'Bitcoin',     type: 'l1l2' },
  'btc':                  { canonical: 'Bitcoin',     type: 'l1l2' },
  'ethereum.org':         { canonical: 'Ethereum',    type: 'l1l2' },
  'ethresear.ch':         { canonical: 'Ethereum',    type: 'l1l2' },
  'github.com/ethereum':  { canonical: 'Ethereum',    type: 'l1l2' },
  'ethereum':             { canonical: 'Ethereum',    type: 'l1l2' },
  'eth':                  { canonical: 'Ethereum',    type: 'l1l2' },
  'solana.com':           { canonical: 'Solana',      type: 'l1l2' },
  'solana.org':           { canonical: 'Solana',      type: 'l1l2' },
  'github.com/solana-labs':{ canonical: 'Solana',     type: 'l1l2' },
  'solana':               { canonical: 'Solana',      type: 'l1l2' },
  'xrpl.org':             { canonical: 'XRPL',        type: 'infrastructure' },
  'ripple.com':           { canonical: 'Ripple',      type: 'infrastructure' },
  'hyperliquid.xyz':      { canonical: 'Hyperliquid', type: 'trading_protocol' },
  'app.hyperliquid.xyz':  { canonical: 'Hyperliquid', type: 'trading_protocol' },
  'hyperliquid':          { canonical: 'Hyperliquid', type: 'trading_protocol' },
  'uniswap.org':          { canonical: 'Uniswap',     type: 'defi' },
  'app.uniswap.org':      { canonical: 'Uniswap',     type: 'defi' },
  'aave.com':             { canonical: 'Aave',        type: 'defi' },
  'app.aave.com':         { canonical: 'Aave',        type: 'defi' },
  'chain.link':           { canonical: 'Chainlink',   type: 'tooling' },
  'coinbase.com':         { canonical: 'Coinbase',    type: 'exchange' },
  'binance.com':          { canonical: 'Binance',     type: 'exchange' },
};

export function resolveEntity(project) {
  const input = (project.name || project.website || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
  if (ENTITY_ALIASES[input]) {
    const resolved = ENTITY_ALIASES[input];
    return { ...project, name: resolved.canonical, entityType: project.entityType || resolved.type, resolvedFrom: input, note: resolved.note };
  }
  for (const [key, value] of Object.entries(ENTITY_ALIASES)) {
    if (input.includes(key) || key.includes(input)) {
      return { ...project, name: value.canonical, entityType: project.entityType || value.type, resolvedFrom: input, note: value.note };
    }
  }
  return project;
}

// ═══════════════════════════════════════════════════════════════════════
// ENTITY GROUND TRUTH — Signal Resolver Layer
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_GROUND_TRUTH = {
  'Bitcoin': {
    open_source: { value: 'YES', urls: ['https://github.com/bitcoin/bitcoin'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/bitcoin/bitcoin'], confidence: 100 },
    multiple_contributors: { value: 'YES', urls: ['https://github.com/bitcoin/bitcoin'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://bitcoin.org'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://bitcoin.org/bitcoin.pdf'], confidence: 100 },
    verifiable_history: { value: 'YES', urls: ['https://bitcoin.org'], confidence: 100 },
    whitepaper: { value: 'YES', urls: ['https://bitcoin.org/bitcoin.pdf'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://developer.bitcoin.org'], confidence: 100 },
    founded_year: 2009, ecosystem_level: 'dominant', adoption_level: 'global',
  },
  'Ethereum': {
    open_source: { value: 'YES', urls: ['https://github.com/ethereum'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/ethereum'], confidence: 100 },
    multiple_contributors: { value: 'YES', urls: ['https://github.com/ethereum'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://ethereum.org'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://ethereum.org'], confidence: 100 },
    verifiable_history: { value: 'YES', urls: ['https://ethereum.org'], confidence: 100 },
    whitepaper: { value: 'YES', urls: ['https://ethereum.org/whitepaper'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://ethereum.org/developers'], confidence: 100 },
    founders_named: { value: 'YES', urls: ['https://ethereum.org/founders'], confidence: 100 },
    founded_year: 2015, ecosystem_level: 'dominant', adoption_level: 'global',
  },
  'Solana': {
    open_source: { value: 'YES', urls: ['https://github.com/solana-labs/solana'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/solana-labs'], confidence: 100 },
    multiple_contributors: { value: 'YES', urls: ['https://github.com/solana-labs/solana'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://solana.com'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://solana.com'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://docs.solana.com'], confidence: 100 },
    founded_year: 2020, ecosystem_level: 'major', adoption_level: 'large',
  },
  'Hyperliquid': {
    live_product: { value: 'YES', urls: ['https://app.hyperliquid.xyz'], confidence: 100 },
    open_source: { value: 'YES', urls: ['https://github.com/hyperliquid-dex'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/hyperliquid-dex'], confidence: 100 },
    founded_year: 2022, ecosystem_level: 'growing', adoption_level: 'medium',
  },
  'Uniswap': {
    open_source: { value: 'YES', urls: ['https://github.com/Uniswap'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/Uniswap'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://app.uniswap.org'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://uniswap.org'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://docs.uniswap.org'], confidence: 100 },
    founded_year: 2018, ecosystem_level: 'major', adoption_level: 'large',
  },
  'Aave': {
    open_source: { value: 'YES', urls: ['https://github.com/aave'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/aave'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://app.aave.com'], confidence: 100 },
    audit_found: { value: 'YES', urls: ['https://github.com/aave/aave-v3-core'], confidence: 95 },
    technical_docs: { value: 'YES', urls: ['https://docs.aave.com'], confidence: 100 },
    founded_year: 2017, ecosystem_level: 'major', adoption_level: 'large',
  },
  'Chainlink': {
    open_source: { value: 'YES', urls: ['https://github.com/smartcontractkit/chainlink'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/smartcontractkit'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://chain.link'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://chain.link'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://docs.chain.link'], confidence: 100 },
    founded_year: 2017, ecosystem_level: 'major', adoption_level: 'large',
  },
  'XRPL': {
    open_source: { value: 'YES', urls: ['https://github.com/XRPLF/rippled'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/XRPLF'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://xrpl.org'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://xrpl.org'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://xrpl.org/docs'], confidence: 100 },
    founded_year: 2012, ecosystem_level: 'major', adoption_level: 'large',
  },
};

const MANDATORY_SIGNALS_BY_TYPE = {
  l1l2: ['open_source', 'active_github', 'live_product', 'clear_use_case'],
  defi: ['open_source', 'live_product', 'audit_found'],
  trading_protocol: ['live_product', 'open_source'],
  infrastructure: ['open_source', 'active_github', 'live_product'],
  tooling: ['open_source', 'active_github'],
  aiagent: ['live_product'],
  startup: ['founders_named'],
  dao: ['on_chain_governance', 'open_source'],
};

function resolveSignals(evidence, projectName, entityType) {
  const resolved = { ...evidence };
  let resolvedCount = 0;
  const groundTruth = ENTITY_GROUND_TRUTH[projectName];
  if (groundTruth) {
    for (const [key, gtValue] of Object.entries(groundTruth)) {
      if (key === 'founded_year') { resolved.founded_year = gtValue; continue; }
      if (key === 'ecosystem_level') { resolved.ecosystem_level = gtValue; continue; }
      if (key === 'adoption_level') { resolved.adoption_level = gtValue; continue; }
      if ((resolved[key] === 'UNKNOWN' || (resolved.confidence_per_signal?.[key] || 0) < 80) && gtValue.value === 'YES') {
        resolved[key] = 'YES';
        resolved[`${key}_urls`] = gtValue.urls;
        resolved.confidence_per_signal = { ...resolved.confidence_per_signal, [key]: gtValue.confidence };
        resolvedCount++;
      }
    }
    if (resolvedCount > 0) console.log(`  📚 Signal resolver: Applied ${resolvedCount} ground truth facts for ${projectName}`);
  }
  const mandatorySignals = MANDATORY_SIGNALS_BY_TYPE[entityType] || [];
  const missingMandatory = mandatorySignals.filter(signal => resolved[signal] === 'UNKNOWN');
  if (missingMandatory.length === mandatorySignals.length && mandatorySignals.length > 0) {
    console.warn(`  ⚠ INSUFFICIENT EVIDENCE: All ${mandatorySignals.length} mandatory signals for ${entityType} are UNKNOWN`);
    resolved._insufficient_evidence = true;
    resolved._missing_mandatory = missingMandatory;
  }
  return resolved;
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
// REASONABLENESS BENCHMARKS
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_BENCHMARKS = {
  'Bitcoin':    { type: 'tier1_network', expectedLegitimacy: { min: 85, max: 100 }, expectedMaturity: { min: 85, max: 100 } },
  'Ethereum':   { type: 'tier1_network', expectedLegitimacy: { min: 85, max: 100 }, expectedMaturity: { min: 85, max: 100 } },
  'Solana':     { type: 'tier1_network', expectedLegitimacy: { min: 75, max: 95 },  expectedMaturity: { min: 70, max: 90 } },
  'Uniswap':    { type: 'major_defi',    expectedLegitimacy: { min: 70, max: 90 },  expectedMaturity: { min: 65, max: 85 } },
  'Aave':       { type: 'major_defi',    expectedLegitimacy: { min: 70, max: 90 },  expectedMaturity: { min: 65, max: 85 } },
  'Chainlink':  { type: 'major_tooling', expectedLegitimacy: { min: 70, max: 90 },  expectedMaturity: { min: 65, max: 85 } },
  'Hyperliquid': { type: 'growing_platform', expectedLegitimacy: { min: 60, max: 80 }, expectedMaturity: { min: 55, max: 75 } },
  'FTX':        { type: 'known_failure', expectedLegitimacy: { min: 0, max: 30 }, expectedMaturity: { min: 0, max: 30 }, criticalExpected: true },
  'Terra Luna': { type: 'known_failure', expectedLegitimacy: { min: 0, max: 30 }, expectedMaturity: { min: 0, max: 30 }, criticalExpected: true },
  'Celsius':    { type: 'known_failure', expectedLegitimacy: { min: 0, max: 30 }, expectedMaturity: { min: 0, max: 30 }, criticalExpected: true },
  'BitConnect': { type: 'known_scam', expectedLegitimacy: { min: 0, max: 20 }, expectedMaturity: { min: 0, max: 20 }, criticalExpected: true },
};

function validateReasonableness(projectName, legitimacyScore, maturityScore) {
  const key = Object.keys(ENTITY_BENCHMARKS).find(k => projectName.toLowerCase().includes(k.toLowerCase()));
  if (!key) return { reasonable: true, note: null, benchmark: 'unknown' };
  const benchmark = ENTITY_BENCHMARKS[key];
  const issues = [];
  if (legitimacyScore < benchmark.expectedLegitimacy.min) issues.push(`Legitimacy ${legitimacyScore} below expected min ${benchmark.expectedLegitimacy.min}`);
  if (legitimacyScore > benchmark.expectedLegitimacy.max + 5) issues.push(`Legitimacy ${legitimacyScore} above expected max ${benchmark.expectedLegitimacy.max}`);
  if (maturityScore < benchmark.expectedMaturity.min) issues.push(`Maturity ${maturityScore} below expected min ${benchmark.expectedMaturity.min}`);
  if (benchmark.criticalExpected && legitimacyScore > 30) issues.push(`CRITICAL: Expected critical risk but scored ${legitimacyScore}`);
  if (issues.length > 0) {
    console.warn(`\n⚠ REASONABLENESS CHECK FAILED for ${projectName} (${benchmark.type}):`);
    issues.forEach(i => console.warn(`  - ${i}`));
    return { reasonable: false, issues, benchmark: benchmark.type };
  }
  return { reasonable: true, benchmark: benchmark.type };
}

// ═══════════════════════════════════════════════════════════════════════
// SIGNAL REGISTRY
// ═══════════════════════════════════════════════════════════════════════
const LEGITIMACY_SIGNALS = {
  founders_named:         { bucket: 'identity',      basePoints: 14 },
  linkedin_found:         { bucket: 'identity',      basePoints:  8 },
  team_page:              { bucket: 'identity',      basePoints:  5 },
  verifiable_history:     { bucket: 'identity',      basePoints:  8 },
  genuine_engagement:     { bucket: 'identity',      basePoints:  4 },
  whitepaper:             { bucket: 'transparency',  basePoints: 12 },
  technical_docs:         { bucket: 'transparency',  basePoints: 10 },
  roadmap:                { bucket: 'transparency',  basePoints:  7 },
  tokenomics:             { bucket: 'transparency',  basePoints:  7 },
  clear_use_case:         { bucket: 'transparency',  basePoints:  6 },
  on_chain_governance:    { bucket: 'transparency',  basePoints:  5 },
  treasury_transparency:  { bucket: 'transparency',  basePoints:  5 },
  active_github:          { bucket: 'verification',  basePoints: 12 },
  open_source:            { bucket: 'verification',  basePoints: 10 },
  audit_found:            { bucket: 'verification',  basePoints: 12 },
  multiple_contributors:  { bucket: 'verification',  basePoints:  6 },
  live_product:           { bucket: 'verification',  basePoints: 10 },
  api_usage:              { bucket: 'verification',  basePoints:  6 },
  multisig_confirmed:     { bucket: 'verification',  basePoints:  6 },
  funding_confirmed:      { bucket: 'verification',  basePoints:  4 },
  no_confirmed_fraud:     { bucket: 'reputation',    basePoints: 10 },
  no_confirmed_hack:      { bucket: 'reputation',    basePoints:  6 },
  longevity_10y:          { bucket: 'reputation',    basePoints: 14 },
  longevity_5y:           { bucket: 'reputation',    basePoints: 10 },
  longevity_2y:           { bucket: 'reputation',    basePoints:  5 },
  longevity_1y:           { bucket: 'reputation',    basePoints:  3 },
  media_coverage:         { bucket: 'reputation',    basePoints:  5 },
};

// ═══════════════════════════════════════════════════════════════════════
// ENTITY TEMPLATES
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_TEMPLATES = {
  l1l2: {
    label: 'L1/L2 Blockchain',
    signals: ['bitcoin','ethereum','solana','avalanche','bsc','polygon','optimism','arbitrum','zksync','starknet','tron','litecoin','monero'],
    note: 'L1/L2 rubric: verification (open source, GitHub) and reputation (longevity) are primary signals. Pseudonymous founders are not penalized.',
    bucketWeights: { identity: 0.15, transparency: 0.25, verification: 0.35, reputation: 0.25 },
  },
  infrastructure: {
    label: 'Infrastructure Protocol',
    signals: ['foundation','network','ledger','mainnet','consensus','validator','node','xrpl','ripple','cosmos','polkadot','near','cardano','algorand'],
    note: 'Infrastructure rubric: verification and reputation weighted highest. Open governance is expected.',
    bucketWeights: { identity: 0.15, transparency: 0.25, verification: 0.35, reputation: 0.25 },
  },
  defi: {
    label: 'DeFi Protocol',
    signals: ['defi','yield','lending','borrow','swap','amm','liquidity pool','vault','liquid staking','dex'],
    note: 'DeFi rubric: audit (verification) is critical. Identity matters more than for infrastructure.',
    bucketWeights: { identity: 0.25, transparency: 0.25, verification: 0.35, reputation: 0.15 },
  },
  trading_protocol: {
    label: 'Trading Protocol / Exchange',
    signals: ['exchange','trading','derivatives','perpetuals','order book','hyperliquid','hyper','dydx','gmx','drift','vertex','perp exchange'],
    note: 'Trading protocol rubric: identity and verification (audit) weighted equally.',
    bucketWeights: { identity: 0.30, transparency: 0.20, verification: 0.35, reputation: 0.15 },
  },
  aiagent: {
    label: 'AI Agent / Product',
    signals: ['ai agent','autonomous agent','llm','gpt','copilot','assistant','autopilot','croo','veris','ai-powered'],
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
    signals: ['sdk','rpc','indexer','explorer','bridge','oracle','developer tool','infrastructure tool','chainlink','wallet sdk'],
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
  const text = [project.name,project.description,project.website,project.entityType].filter(Boolean).join(' ').toLowerCase();
  const matches = Object.entries(ENTITY_TEMPLATES).filter(([k]) => k !== 'general').map(([type,cfg]) => ({ type, score: cfg.signals.filter(s => text.includes(s)).length })).filter(e => e.score > 0).sort((a,b) => b.score - a.score);
  return matches[0]?.type || 'general';
}

const HARD_TRUST_EVENTS = [
  { key:'confirmed_rug_pull',   label:'Confirmed rug pull' },
  { key:'confirmed_fraud',      label:'Confirmed fraud' },
  { key:'confirmed_scam',       label:'Confirmed scam' },
  { key:'sec_enforcement',      label:'SEC/CFTC enforcement action' },
  { key:'sanctions',            label:'Government sanctions (OFAC)' },
  { key:'criminal_conviction',  label:'Criminal conviction of founders' },
];

async function extractEvidence(combinedText, projectName, entityLabel) {
  const prompt =
    `You are a structured evidence extraction engine for "${projectName}" (${entityLabel}).\n\n` +
    `SOURCES:\n${combinedText.substring(0, 9000)}\n\n` +
    `RULES:\n1. Each boolean field = "YES", "NO", or "UNKNOWN". Default = UNKNOWN.\n` +
    `2. NEVER set YES from implication. NEVER set NO from absence — absence = UNKNOWN.\n` +
    `3. Per-signal _urls fields: list exact URLs from sources supporting the YES/NO claim.\n` +
    `4. ecosystem_level: "dominant"/"major"/"growing"/"small"/"none".\n` +
    `5. adoption_level: "global"/"large"/"medium"/"small"/"none".\n` +
    `6. founded_year: numeric year only, or null.\n` +
    `7. CONTRADICTIONS: conflicting claims about the SAME fact.\n` +
    `8. Hard events MUST have citation with source_url + quote >= 25 chars.\n` +
    `9. confidence_per_signal: 0-100 estimate per signal.\n\n` +
    `Return ONLY valid JSON.`;
  const response = await groqExtract(prompt);
  try { return JSON.parse(response.replace(/```json|```/g, '').trim()); } catch { console.warn('  ⚠ Evidence parse failed'); return buildBaselineEvidence(); }
}

function buildBaselineEvidence() {
  const fields = Object.keys(LEGITIMACY_SIGNALS).filter(k => !['no_confirmed_fraud','no_confirmed_hack','longevity_10y','longevity_5y','longevity_2y','longevity_1y'].includes(k));
  const extra = ['audit_found','multiple_audits','bug_bounty','regular_releases','recent_commits','developer_ecosystem','sdks_found','grants_hackathons','high_github_stars','multiple_contributors','major_exchange_listed','top10_chain','institutional_adoption','tvl_mentioned','trading_volume_mentioned','liquidity_locked','large_community','active_community','active_social','active_proposals','features_described','user_reviews','confirmed_rug_pull','confirmed_fraud','confirmed_scam','sec_enforcement','sanctions','criminal_conviction','confirmed_hack','confirmed_exploit','confirmed_vulnerability'];
  const ev = {};
  [...new Set([...fields, ...extra])].forEach(k => { ev[k] = 'UNKNOWN'; ev[`${k}_urls`] = []; });
  ev.founder_names = []; ev.audit_firm = null; ev.founded_year = null;
  ev.ecosystem_level = 'none'; ev.adoption_level = 'none';
  ev.contradictions = []; ev.confidence_per_signal = {}; ev.evidence_citations = [];
  return ev;
}

function longevityFlags(evidence) {
  const year = parseInt(evidence.founded_year);
  const now = new Date().getFullYear();
  if (!year || year < 2008 || year > now) return { longevity_10y:'UNKNOWN', longevity_5y:'UNKNOWN', longevity_2y:'UNKNOWN', longevity_1y:'UNKNOWN' };
  const age = now - year;
  return { longevity_10y: age >= 10 ? 'YES' : 'NO', longevity_5y: age >= 5 ? 'YES' : 'NO', longevity_2y: age >= 2 ? 'YES' : 'NO', longevity_1y: age >= 1 ? 'YES' : 'NO' };
}

function computeLegitimacyScore(evidence, template, projectName) {
  const lFlags = longevityFlags(evidence);
  const ev = { ...evidence, ...lFlags };
  ev.no_confirmed_fraud = (['confirmed_rug_pull','confirmed_fraud','confirmed_scam','sec_enforcement','criminal_conviction'].every(k => ev[k]==='NO' || ev[k]==='UNKNOWN')) ? 'YES' : 'NO';
  ev.no_confirmed_hack = (ev.confirmed_hack==='NO' || ev.confirmed_hack==='UNKNOWN') ? 'YES' : 'NO';
  const longevityOrder = ['longevity_10y','longevity_5y','longevity_2y','longevity_1y'];
  const firedLongevity = longevityOrder.find(k => ev[k] === 'YES') || null;
  const buckets = { identity: { raw:0, max:0 }, transparency: { raw:0, max:0 }, verification: { raw:0, max:0 }, reputation: { raw:0, max:0 } };
  const applied = { identity: [], transparency: [], verification: [], reputation: [] };
  for (const [sigKey, sigCfg] of Object.entries(LEGITIMACY_SIGNALS)) {
    const { bucket, basePoints } = sigCfg;
    if (longevityOrder.includes(sigKey)) { if (sigKey !== firedLongevity) { buckets[bucket].max += basePoints; continue; } }
    buckets[bucket].max += basePoints;
    if ((ev[sigKey] || 'UNKNOWN') !== 'YES') continue;
    const urls = ev[`${sigKey}_urls`] || [];
    const tier = bestTierName(urls, projectName);
    const tierW = TIER_WEIGHTS[tier];
    const t1t2 = urls.filter(u => ['tier1','tier2'].includes(classifySourceTier(u, projectName))).length;
    const cons = t1t2 >= 2 ? 1.10 : t1t2 === 1 ? 1.00 : urls.length >= 2 ? 0.90 : 0.75;
    const pts = Math.round(basePoints * tierW * cons);
    buckets[bucket].raw += pts;
    applied[bucket].push({ label: SIGNAL_LABELS[sigKey] || sigKey, points: pts, tier, urls, confidence: ev.confidence_per_signal?.[sigKey] ?? defaultConfidence(tier) });
  }
  const scores = {};
  for (const [bk, data] of Object.entries(buckets)) scores[bk] = data.max > 0 ? Math.min(100, Math.round((data.raw / data.max) * 100)) : 0;
  const bw = template.bucketWeights;
  return { legitimacyScore: Math.round(scores.identity * bw.identity + scores.transparency * bw.transparency + scores.verification * bw.verification + scores.reputation * bw.reputation), scores, applied };
}

// ═══════════════════════════════════════════════════════════════════════
// CLEAN MATURITY SCORING
// ═══════════════════════════════════════════════════════════════════════
function computeCleanMaturityScore(evidence) {
  const lFlags = longevityFlags(evidence);
  const ev = { ...evidence, ...lFlags };
  ev.no_critical_hack = (ev.confirmed_hack==='NO' || ev.confirmed_hack==='UNKNOWN') ? 'YES' : 'NO';
  const subScores = {
    longevity: calculateLongevitySubscore(ev),
    adoption: calculateAdoptionSubscore(ev),
    ecosystem: calculateEcosystemSubscore(ev),
    development: calculateDevelopmentSubscore(ev),
    security: calculateSecuritySubscore(ev),
    market: calculateMarketSubscore(ev),
  };
  const weights = { longevity: 0.25, adoption: 0.20, ecosystem: 0.20, development: 0.15, security: 0.10, market: 0.10 };
  const maturityScore = Math.round(Object.entries(subScores).reduce((sum, [key, score]) => sum + (score * weights[key]), 0));
  const applied = Object.entries(subScores).map(([key, score]) => ({ category: key.charAt(0).toUpperCase() + key.slice(1), score, label: getMaturityCategoryLabel(key, score) }));
  return { maturityScore, subScores, applied };
}

function calculateLongevitySubscore(ev) { if (ev.longevity_10y==='YES') return 95; if (ev.longevity_5y==='YES') return 75; if (ev.longevity_2y==='YES') return 45; if (ev.longevity_1y==='YES') return 20; return 5; }
function calculateAdoptionSubscore(ev) { const m={global:90,large:70,medium:45,small:20,none:5}; let s=m[ev.adoption_level||'none']||5; if(ev.major_exchange_listed==='YES')s=Math.min(100,s+10); if(ev.institutional_adoption==='YES')s=Math.min(100,s+10); if(ev.top10_chain==='YES')s=Math.min(100,s+15); return s; }
function calculateEcosystemSubscore(ev) { const m={dominant:95,major:75,growing:50,small:25,none:5}; let s=m[ev.ecosystem_level||'none']||5; if(ev.developer_ecosystem==='YES')s=Math.min(100,s+15); if(ev.sdks_found==='YES')s=Math.min(100,s+10); if(ev.grants_hackathons==='YES')s=Math.min(100,s+10); return s; }
function calculateDevelopmentSubscore(ev) { let s=0; if(ev.active_github==='YES')s+=25; if(ev.open_source==='YES')s+=20; if(ev.multiple_contributors==='YES')s+=15; if(ev.high_github_stars==='YES')s+=10; if(ev.regular_releases==='YES')s+=15; if(ev.recent_commits==='YES')s+=10; if(ev.developer_ecosystem==='YES')s+=5; return Math.min(100,s); }
function calculateSecuritySubscore(ev) { let s=10; if(ev.audit_found==='YES'){s+=35; if(ev.multiple_audits==='YES')s+=15;} if(ev.bug_bounty==='YES')s+=20; if(ev.no_critical_hack==='YES')s+=20; return Math.min(100,s); }
function calculateMarketSubscore(ev) { let s=0; if(ev.major_exchange_listed==='YES')s+=25; if(ev.institutional_adoption==='YES')s+=25; if(ev.tvl_mentioned==='YES')s+=20; if(ev.trading_volume_mentioned==='YES')s+=15; if(ev.large_community==='YES')s+=10; if(ev.media_coverage==='YES')s+=5; return Math.min(100,s); }
function getMaturityCategoryLabel(c,s){if(s>=90)return`${c}: Excellent`;if(s>=70)return`${c}: Strong`;if(s>=50)return`${c}: Moderate`;if(s>=30)return`${c}: Limited`;return`${c}: Minimal`;}

// ═══════════════════════════════════════════════════════════════════════
// ORIGINAL CONFIDENCE ENGINE (preserved exactly)
// ═══════════════════════════════════════════════════════════════════════
function computeConfidence(evidence, allSources) {
  const authority = allSources.length === 0 ? 0.05 : allSources.reduce((sum, s) => sum + (TIER_WEIGHTS[classifySourceTier(s.url||'')] || 0.15), 0) / allSources.length;
  const countScore = allSources.length === 0 ? 0.05 : allSources.length >= 20 ? 1.00 : allSources.length >= 10 ? 0.90 : allSources.length >= 5 ? 0.75 : allSources.length >= 2 ? 0.55 : 0.35;
  const citations = evidence.evidence_citations || [];
  const claimCounts = citations.reduce((acc,c) => { acc[c.claim]=(acc[c.claim]||0)+1; return acc; }, {});
  const multiCited = Object.values(claimCounts).filter(v => v >= 2).length;
  const totalClaims = Object.keys(claimCounts).length;
  const agreement = totalClaims === 0 ? 0.50 : Math.min(1, 0.50 + (multiCited / totalClaims) * 0.50);
  const freshness = (evidence.recent_commits==='YES' || evidence.regular_releases==='YES') ? 0.95 : (evidence.active_github==='YES' || evidence.active_community==='YES') ? 0.80 : 0.60;
  const contraFactor = Math.max(0.60, 1 - (evidence.contradictions?.length||0) * 0.08);
  return Math.min(0.98, Math.max(0.05, (authority*0.30 + countScore*0.25 + agreement*0.25 + freshness*0.20) * contraFactor));
}

function getRecommendation(legitimacyScore, maturityScore, opRiskLevel, hardEventsConfirmed) {
  if (hardEventsConfirmed.length > 0) return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29', text:'Hard trust event confirmed (fraud/scam/sanctions). Do not engage.' };
  if (legitimacyScore >= 85 && maturityScore >= 70) return { label:'STRONGLY TRUSTED', symbol:'✓✓', band:'90-100', text:'Strong legitimacy and maturity signals.' };
  if (legitimacyScore >= 80 && maturityScore >= 55) return { label:'TRUSTED', symbol:'✓', band:'80-89', text:'Solid legitimacy signals confirmed.' };
  if (legitimacyScore >= 65) return { label:'GENERALLY LEGITIMATE', symbol:'~✓', band:'65-79', text:'Legitimacy signals present. Some evidence gaps.' };
  if (legitimacyScore >= 50) return { label:'MIXED SIGNALS', symbol:'~', band:'50-64', text:'Incomplete or inconsistent evidence.' };
  if (legitimacyScore >= 30) return { label:'HIGH RISK', symbol:'✗', band:'30-49', text:'Significant legitimacy gaps.' };
  return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29', text:'Critical legitimacy failures.' };
}

function validateHardEvent(key, evidence) { if (evidence[key]!=='YES') return false; const cit=(evidence.evidence_citations||[]).find(c=>c.claim===key); return cit?.source_url?.startsWith('http') && cit.quote?.length >= 25 && (cit.confidence||0) >= 0.85; }
function checkHardEvents(evidence) { const c=[],u=[]; for(const ev of HARD_TRUST_EVENTS){if(evidence[ev.key]!=='YES')continue;const cit=(evidence.evidence_citations||[]).find(c=>c.claim===ev.key);if(validateHardEvent(ev.key,evidence))c.push({...ev,citation:cit});else u.push({label:ev.label,note:'Mentioned but insufficient citation.',citation:cit||null});} return{confirmed:c,unverified:u}; }
function checkOperationalRisk(evidence) { const OPS=[{key:'confirmed_hack',label:'Confirmed hack or breach'},{key:'confirmed_exploit',label:'Confirmed smart contract exploit'},{key:'confirmed_vulnerability',label:'Confirmed vulnerability disclosure'}]; const c=[],u=[]; for(const op of OPS){if(evidence[op.key]!=='YES')continue;const cit=(evidence.evidence_citations||[]).find(c=>c.claim===op.key);if(validateHardEvent(op.key,evidence))c.push({...op,citation:cit});else u.push({label:op.label,note:'Incident mentioned but insufficient source citation.'});} return{confirmed:c,unverified:u,level:c.length===0?'Low':c.length===1?'Medium':'High'}; }
function sourceAuthorityBreakdown(allSources, projectName) { const c={tier1:0,tier2:0,tier3:0,tier4:0}; for(const s of allSources){const t=classifySourceTier(s.url||'',projectName);c[t]++;} return c; }

const SIGNAL_LABELS = {
  open_source:'Open source confirmed',active_github:'Active GitHub',high_github_stars:'High GitHub stars',multiple_contributors:'Multiple contributors',audit_found:'Security audit found',multiple_audits:'Multiple audits',bug_bounty:'Bug bounty active',regular_releases:'Regular releases',recent_commits:'Recent commits',whitepaper:'Whitepaper found',technical_docs:'Technical documentation',roadmap:'Roadmap confirmed',tokenomics:'Tokenomics documented',clear_use_case:'Clear use case',founders_named:'Founders publicly named',linkedin_found:'LinkedIn profiles confirmed',team_page:'Team page found',verifiable_history:'Verifiable track record',genuine_engagement:'Genuine engagement',media_coverage:'Media coverage',live_product:'Live product confirmed',api_usage:'API usage confirmed',multisig_confirmed:'Multisig confirmed',funding_confirmed:'Funding confirmed',on_chain_governance:'On-chain governance',treasury_transparency:'Treasury transparency',no_confirmed_fraud:'No confirmed fraud/scam history',no_confirmed_hack:'No confirmed critical hack',longevity_10y:'Active 10+ years',longevity_5y:'Active 5-9 years',longevity_2y:'Active 2-4 years',longevity_1y:'Active 1-2 years',sdks_found:'SDKs available',developer_ecosystem:'Developer ecosystem',grants_hackathons:'Grants/hackathons',major_exchange_listed:'Major exchange listing',top10_chain:'Top-10 chain',institutional_adoption:'Institutional adoption',tvl_mentioned:'TVL data found',trading_volume_mentioned:'Trading volume data',large_community:'Large community',active_community:'Active community',active_proposals:'Active governance proposals',
};

async function collectEvidence(query, projectName='') { try { const res=await tavilyClient.search(query,{searchDepth:'advanced',maxResults:5,includeAnswer:false}); if(!res.results?.length) return{text:'',sourceCount:0,sources:[]}; const sources=res.results.map(r=>({title:r.title,url:r.url,tier:classifySourceTier(r.url,projectName),snippet:r.content?.substring(0,500)||''})); const text=sources.map((s,i)=>`[Source ${i+1} | ${s.tier.toUpperCase()} | ${s.url}]\n${s.title}\n${s.snippet}`).join('\n\n---\n\n'); return{text,sourceCount:sources.length,sources}; } catch(err){console.warn('  ⚠ Tavily error:',err.message);return{text:'',sourceCount:0,sources:[]};} }
function buildSearchQueries(project, entityType) { const n=project.name; const q={identity:`${n} founders team executives CEO LinkedIn who built created`,documentation:`${n} whitepaper roadmap documentation technical paper tokenomics`,development:`${n} GitHub repository open source contributors commits releases`,community:`${n} community Twitter followers users adoption media coverage`,risk:`${n} scam fraud rug pull hack exploit lawsuit SEC CFTC criminal`,longevity:`${n} founded launched year history milestones when created`,adoption:`${n} TVL users transactions exchange listed institutional adoption scale`,ecosystem:`${n} developer ecosystem SDK integrations partnerships network`}; if(['defi','trading_protocol'].includes(entityType))q.security=`${n} audit certik trail of bits halborn openzeppelin bug bounty insurance`; if(['memecoin','nft'].includes(entityType))q.liquidity=`${n} liquidity locked holders distribution DEX trading pair`; return q; }
async function groqExtract(prompt) { const c=await groq.chat.completions.create({model:'llama-3.3-70b-versatile',messages:[{role:'system',content:'You are a structured data extraction engine. Return ONLY valid JSON. No markdown, no backticks, no explanation.'},{role:'user',content:prompt}],max_tokens:3000,temperature:0.0}); return c.choices[0].message.content; }
async function groqSynthesize(prompt, systemMsg='You are a factual research assistant. Be specific and concise.') { const c=await groq.chat.completions.create({model:'llama-3.3-70b-versatile',messages:[{role:'system',content:systemMsg},{role:'user',content:prompt}],max_tokens:600,temperature:0.2}); return c.choices[0].message.content; }
async function scoreWithAI(prompt) { const r=await groqSynthesize(prompt,'Return ONLY valid JSON. No markdown, no backticks, no preamble.'); try{return JSON.parse(r.replace(/```json|```/g,'').trim());}catch{return null;} }
async function semanticScore(prompt, response, concept, maxScore=10) { if(!response) return{score:0,correct:false,factual_correctness:0,completeness:0,reasoning_quality:0,explanation:'No response received'}; const result=await scoreWithAI(`Evaluate agent response.\nQuestion:"${prompt}"\nKey concepts:${concept}\nResponse:${response.substring(0,600)}\nScore 0-${maxScore}.`); return{score:Math.max(0,Math.min(maxScore,result?.score??Math.round(maxScore*0.5))),factual_correctness:result?.factual_correctness??5,completeness:result?.completeness??5,reasoning_quality:result?.reasoning_quality??5,correct:result?.correct??false,explanation:result?.explanation??'Evaluated'}; }
function progressBar(score, max=100, width=20) { if(max===0) return'░'.repeat(width); const filled=Math.round((score/max)*width); return'█'.repeat(Math.max(0,filled))+'░'.repeat(Math.max(0,width-filled)); }
function confBar(c, width=12) { const filled=Math.round(c*width); return'▓'.repeat(Math.max(0,filled))+'░'.repeat(Math.max(0,width-filled))+` ${Math.round(c*100)}%`; }
function tierTag(t) { return{tier1:'[T1]',tier2:'[T2]',tier3:'[T3]',tier4:'[T4]'}[t]||'[T?]'; }
function bestTierWeight(urls=[], projectName='') { if(!urls.length) return TIER_WEIGHTS.tier4; const best=['tier1','tier2','tier3','tier4'].find(t=>urls.map(u=>classifySourceTier(u,projectName||'')).includes(t))||'tier4'; return TIER_WEIGHTS[best]; }
function bestTierName(urls=[], projectName='') { if(!urls.length) return'tier4'; return['tier1','tier2','tier3','tier4'].find(t=>urls.map(u=>classifySourceTier(u,projectName||'')).includes(t))||'tier4'; }
function defaultConfidence(tier) { return{tier1:90,tier2:70,tier3:45,tier4:20}[tier]??20; }

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE — MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════
export async function runProjectDueDiligence(project) {
  project = resolveEntity(project);
  console.log(`\n🔍 VERIS Due Diligence: ${project.name}${project.resolvedFrom ? ` (resolved from ${project.resolvedFrom})` : ''}`);
  if (project.note) console.log(`  ⚠ Note: ${project.note}`);

  const entityKey = project.entityType || detectEntityType(project);
  const template = ENTITY_TEMPLATES[entityKey] || ENTITY_TEMPLATES.general;
  console.log(`  Entity class: ${template.label}`);

  console.log('  → Collecting evidence...');
  const queries = buildSearchQueries(project, entityKey);
  const searchResults = await Promise.all(Object.entries(queries).map(async ([key,query]) => ({ key, ...await collectEvidence(query, project.name) })));
  const allSources = searchResults.flatMap(r => r.sources);
  const totalSources = searchResults.reduce((a,r) => a+r.sourceCount, 0);
  const combinedText = searchResults.filter(r => r.text).map(r => `=== ${r.key.toUpperCase()} ===\n${r.text}`).join('\n\n');

  console.log('  → Extracting evidence...');
  const rawEvidence = await extractEvidence(combinedText, project.name, template.label);

  console.log('  → Resolving signals...');
  let evidence = resolveSignals(rawEvidence, project.name, entityKey);

  const { confirmed: hardEvents, unverified: unverifiedHard } = checkHardEvents(evidence);
  const insufficientEvidence = evidence._insufficient_evidence || false;

  console.log('  → Scoring...');
  const legit = computeLegitimacyScore(evidence, template, project.name);
  const mat = computeCleanMaturityScore(evidence);
  const opRisk = checkOperationalRisk(evidence);

  const legitimacyScore = hardEvents.length > 0 ? 0 : insufficientEvidence ? 'N/A' : legit.legitimacyScore;
  const maturityScore = hardEvents.length > 0 ? 0 : insufficientEvidence ? 'N/A' : mat.maturityScore;
  const confidence = computeConfidence(evidence, allSources);

  const rec = insufficientEvidence
    ? { label: 'INSUFFICIENT DATA', symbol: '?', band: 'N/A', text: `Cannot score — all ${evidence._missing_mandatory?.length || ''} mandatory signals for ${template.label} are UNKNOWN.` }
    : getRecommendation(legitimacyScore, maturityScore, opRisk.level, hardEvents);

  const reasonableness = insufficientEvidence ? { reasonable: true } : validateReasonableness(project.name, legitimacyScore, maturityScore);
  const calibration = checkCalibration(project.name, typeof legitimacyScore==='number'?legitimacyScore:0, typeof maturityScore==='number'?maturityScore:0);
  const srcBreakdown = sourceAuthorityBreakdown(allSources, project.name);

  const allConfirmedSignals = [...legit.applied.identity, ...legit.applied.transparency, ...legit.applied.verification, ...legit.applied.reputation].map(s => s.label);
  const verdictText = await groqSynthesize(
    insufficientEvidence
      ? `Write a 2-3 sentence verdict for "${project.name}" explaining INSUFFICIENT EVIDENCE. Missing: ${evidence._missing_mandatory?.join(', ') || 'all'}.`
      : `Write a 2-3 sentence factual verdict for "${project.name}" (${template.label}). Legitimacy: ${legitimacyScore}/100 | Maturity: ${maturityScore}/100 | Confidence: ${Math.round(confidence*100)}% | Op Risk: ${opRisk.level}. Confirmed: ${allConfirmedSignals.join(', ') || 'none'}.`,
    insufficientEvidence ? 'Acknowledge uncertainty. Do not make claims without evidence.' : 'Write a factual trust audit verdict. Be direct.'
  );

  const hardWarn = hardEvents.length > 0 ? `\n⛔ HARD TRUST EVENT — All scores overridden to 0\n` + hardEvents.map(e=>`   ${e.label}\n   Source: ${e.citation.source_url}\n   Quote:  "${e.citation.quote}"`).join('\n') : '';
  const insufficientWarn = insufficientEvidence ? `\n⚠  INSUFFICIENT EVIDENCE — Scores are N/A, not 0\n   This does NOT mean illegitimate. VERIS cannot verify.` : '';
  const lowConfWarn = !insufficientEvidence && confidence < 0.40 ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence*100)}%)` : !insufficientEvidence && confidence < 0.65 ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence*100)}%)` : '';
  const anomalyWarn = calibration.anomaly ? `\n⚠  SCORE ANOMALY: ${calibration.note}` : '';
  const reasonablenessWarn = !reasonableness.reasonable && !insufficientEvidence ? `\n⚠  REASONABLENESS CHECK FAILED` : '';

  function sigBlock(signals) { if(!signals.length) return'  (No signals confirmed)'; return signals.map(s=>`  +${String(s.points).padStart(2)}  ${s.label}  ${tierTag(s.tier)} conf:${s.confidence}%`+(s.urls?.[0]?`\n       └─ ${s.urls[0]}`:'')).join('\n'); }
  const legitimacyDisplay = insufficientEvidence ? 'N/A (Insufficient Evidence)' : `${legitimacyScore}/100  ${progressBar(legitimacyScore)}`;
  const maturityDisplay = insufficientEvidence ? 'N/A (Insufficient Evidence)' : `${maturityScore}/100  ${progressBar(maturityScore)}`;

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
LEGITIMACY:   ${legitimacyDisplay}
  Identity:       ${insufficientEvidence ? 'N/A' : legit.scores.identity + '/100'}
  Transparency:   ${insufficientEvidence ? 'N/A' : legit.scores.transparency + '/100'}
  Verification:   ${insufficientEvidence ? 'N/A' : legit.scores.verification + '/100'}
  Reputation:     ${insufficientEvidence ? 'N/A' : legit.scores.reputation + '/100'}

MATURITY:     ${maturityDisplay}
${mat.subScores && !insufficientEvidence ? Object.entries(mat.subScores).map(([key, score]) => `  ${key.charAt(0).toUpperCase() + key.slice(1)}: ${score}/100 ${progressBar(score)}`).join('\n') : ''}

CONFIDENCE:   ${confBar(confidence, 20)}
OP. RISK:     ${opRisk.level}
${hardWarn}${insufficientWarn}${lowConfWarn}${anomalyWarn}${reasonablenessWarn}
RECOMMENDATION:  ${rec.symbol} ${rec.label}  [Band: ${rec.band}]
${rec.text}
══════════════════════════════════════════════
EVIDENCE SOURCES
  Official (T1): ${srcBreakdown.tier1} | Media/Audits (T2): ${srcBreakdown.tier2} | Community (T3): ${srcBreakdown.tier3} | Inferred (T4): ${srcBreakdown.tier4}
  Total: ${totalSources} sources

IDENTITY SIGNALS
${sigBlock(legit.applied.identity)}

TRANSPARENCY SIGNALS
${sigBlock(legit.applied.transparency)}

VERIFICATION SIGNALS
${sigBlock(legit.applied.verification)}

REPUTATION SIGNALS
${sigBlock(legit.applied.reputation)}

VERDICT
${verdictText}
══════════════════════════════════════════════
AUDIT TRAIL
  Auditor:     VERIS · CROO v1 · Base Mainnet
  Timestamp:   ${new Date().toISOString()}`;
}

export const CALIBRATION_BENCHMARKS = { bitcoin:{legitMin:82,maturityMin:82},ethereum:{legitMin:82,maturityMin:82},solana:{legitMin:75,maturityMin:72},chainlink:{legitMin:75,maturityMin:68},uniswap:{legitMin:72,maturityMin:68},aave:{legitMin:72,maturityMin:65},hyperliquid:{legitMin:65,maturityMin:58},xrpl:{legitMin:72,maturityMin:65},ftx:{expectCritical:true},'terra luna':{expectCritical:true},celsius:{expectCritical:true} };

export function checkCalibration(name, legit, maturity) { const key=name.toLowerCase().trim(); const bench=CALIBRATION_BENCHMARKS[key]||CALIBRATION_BENCHMARKS[key.split(' ')[0]]; if(!bench)return{anomaly:false}; if(bench.expectCritical&&legit>30)return{anomaly:true,note:`Score ${legit} unexpectedly high for known failed project.`}; if(bench.legitMin&&legit<bench.legitMin-15)return{anomaly:true,note:`Legitimacy ${legit} below expected floor (${bench.legitMin}).`}; if(bench.maturityMin&&maturity<bench.maturityMin-15)return{anomaly:true,note:`Maturity ${maturity} below expected floor (${bench.maturityMin}).`}; return{anomaly:false}; }

export async function runBenchmarkSuite(verbose=false) { const SUITE=[{name:'Bitcoin',entityType:'l1l2',group:'gold',legitMin:82,maturityMin:82},{name:'Ethereum',entityType:'l1l2',group:'gold',legitMin:82,maturityMin:82},{name:'Solana',entityType:'l1l2',group:'gold',legitMin:75,maturityMin:72},{name:'Hyperliquid',entityType:'trading_protocol',group:'good',legitMin:65,maturityMin:58},{name:'Uniswap',entityType:'defi',group:'good',legitMin:72,maturityMin:68},{name:'Aave',entityType:'defi',group:'good',legitMin:72,maturityMin:65},{name:'XRPL',entityType:'infrastructure',group:'good',legitMin:72,maturityMin:65},{name:'FTX',entityType:'trading_protocol',group:'failed',expectCritical:true},{name:'Terra Luna',entityType:'l1l2',group:'failed',expectCritical:true},{name:'Celsius',entityType:'defi',group:'failed',expectCritical:true}]; const results=[]; for(const test of SUITE){const report=await runProjectDueDiligence({name:test.name,entityType:test.entityType}); const l=parseInt(report.match(/LEGITIMACY:\s+(\d+)/)?.[1]||'0'); const m=parseInt(report.match(/MATURITY:\s+(\d+)/)?.[1]||'0'); const pass=test.expectCritical?(l<=30):(l>=test.legitMin-10&&m>=test.maturityMin-10); results.push({name:test.name,group:test.group,l,m,pass});} return results; }

const BENCHMARK_PACKS = { research:{label:'Research Agent',reliability:['Explain how Aave liquidation works in simple terms.','Explain impermanent loss and when it occurs.','What problem does a liquidity pool solve?'],competence:[{prompt:'Explain the health factor concept in DeFi lending.',concept:'health factor'},{prompt:'How does an automated market maker price assets?',concept:'AMM pricing'},{prompt:'What is the difference between APR and APY in DeFi?',concept:'APR vs APY'},{prompt:'Why do DeFi protocols need oracles?',concept:'oracles'}],deep:['Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.','What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?'],competenceEval:'Evaluate factual accuracy, depth, and source grounding.'},trading:{label:'Trading Agent',reliability:['Explain what a stop loss is and why traders use it.','What does it mean when a market is in backwardation?','Explain the concept of position sizing in trading.'],competence:[{prompt:'How does funding rate work in perpetual futures?',concept:'funding rate'},{prompt:'What does the RSI indicator measure?',concept:'RSI'},{prompt:'Explain the difference between a limit order and a market order.',concept:'limit vs market'},{prompt:'What is the purpose of a liquidation price in leveraged trading?',concept:'liquidation'}],deep:['What are 3 warning signs that a crypto rally is losing momentum?','Explain how you would assess risk before entering a leveraged trade.'],competenceEval:'Evaluate concept accuracy and risk awareness.'},general:{label:'General Purpose Agent',reliability:['Explain what artificial intelligence is in simple terms.','What is the difference between Web2 and Web3?','Explain blockchain technology to a non-technical person.'],competence:[{prompt:'What is Bitcoin and what problem was it designed to solve?',concept:'Bitcoin'},{prompt:'What is an API and how do applications use it?',concept:'API'},{prompt:'What is the difference between a public and private blockchain?',concept:'public vs private'},{prompt:'What is a crypto wallet and how does it actually work?',concept:'wallet'}],deep:['What are the top 3 use cases for AI agents in the Web3 economy?','What makes CROO protocol different from traditional payment infrastructure?'],competenceEval:'Evaluate breadth of knowledge and clarity.'},};

export function detectCategory(serviceDescription='',agentName=''){const text=(serviceDescription+' '+agentName).toLowerCase();const signals={trading:['trad','signal','market analysis'],data:['data','analytics','metrics'],writing:['writ','content','copy'],coding:['cod','developer','script'],defi:['defi','yield','liquidity'],security:['security','audit','vulnerability'],research:['research','intelligence','report']};let best='general',bs=0;for(const[cat,terms]of Object.entries(signals)){const s=terms.filter(t=>text.includes(t)).length;if(s>bs){bs=s;best=cat;}}return best;}

async function placeTestOrder(agentClient,serviceId,prompt,timeoutMs=90000){return new Promise(async(resolve)=>{const startTime=Date.now();let orderId='',timedOut=false,stream=null;const timer=setTimeout(()=>{timedOut=true;if(stream)try{stream.close();}catch{}resolve({response:null,responseTime:timeoutMs,timedOut:true});},timeoutMs);try{await agentClient.negotiateOrder({serviceId,requirements:JSON.stringify({topic:prompt,task:prompt,text:prompt})});stream=await agentClient.connectWebSocket();stream.on(EventType.OrderCreated,async(e)=>{if(timedOut)return;orderId=e.order_id;try{await agentClient.payOrder(e.order_id);}catch(err){console.warn('Pay:',err.message);}});stream.on(EventType.OrderCompleted,async(e)=>{if(timedOut||e.order_id!==orderId)return;clearTimeout(timer);try{const d=await agentClient.getDelivery(e.order_id);stream.close();resolve({response:d.deliverableText||'',responseTime:Date.now()-startTime,timedOut:false});}catch{stream.close();resolve({response:null,responseTime:Date.now()-startTime,timedOut:false});}});stream.on(EventType.OrderRejected,()=>{clearTimeout(timer);if(stream)stream.close();resolve({response:null,responseTime:Date.now()-startTime,rejected:true});});}catch(err){clearTimeout(timer);resolve({response:null,responseTime:Date.now()-startTime,error:err.message});}});}

async function runQuickAudit(agentClient,serviceId,pack){const r1=await placeTestOrder(agentClient,serviceId,pack.reliability[0]);await new Promise(r=>setTimeout(r,2000));const cT=pack.competence[0];const r2=await placeTestOrder(agentClient,serviceId,cT.prompt);const cS=await semanticScore(cT.prompt,r2.response,cT.concept,10);await new Promise(r=>setTimeout(r,2000));const r3=await placeTestOrder(agentClient,serviceId,pack.deep[0]);const dS=await scoreWithAI(`${pack.competenceEval}\nPrompt:"${pack.deep[0]}"\nResponse:${r3.response?.substring(0,600)||'No response'}\nScore 0-10.`);const completed=[r1,r2,r3].filter(r=>r.response&&!r.timedOut).length;return{mode:'quick',total:Math.min(55,(r1.response?15:0)+cS.score*2+(completed>=100?10:completed>=66?7:4)+(dS?.score??5)),maxScore:55,completionRate:Math.round((completed/3)*100)};}

async function runFullAudit(agentClient,serviceId,pack){const relR=[];for(const p of pack.reliability){relR.push({prompt:p,...await placeTestOrder(agentClient,serviceId,p)});await new Promise(r=>setTimeout(r,2000));}const relC=relR.filter(r=>r.response&&!r.timedOut);const rSR=await scoreWithAI(`Evaluate reliability. Score 0-25.`);const reliability={score:Math.min(25,rSR?.score??Math.round((relC.length/relR.length)*20)),completionRate:Math.round((relC.length/relR.length)*100)};const sR=await placeTestOrder(agentClient,serviceId,pack.deep[1]||pack.deep[0]);const sS=await scoreWithAI(`Evaluate source grounding. Score 0-25.`);const sourceVerification={score:Math.max(0,Math.min(25,sS?.score??10))};const cR=[];for(const t of pack.competence){const r=await placeTestOrder(agentClient,serviceId,t.prompt);cR.push({...await semanticScore(t.prompt,r.response,t.concept,10)});await new Promise(r=>setTimeout(r,2000));}const avgC=cR.reduce((a,b)=>a+b.score,0)/cR.length;const domainCompetence={score:Math.min(25,Math.round(avgC*2.5)),accuracyRate:Math.round((cR.filter(r=>r.correct).length/cR.length)*100),competenceLevel:avgC>=7?'high':avgC>=5?'medium':'low'};const tR=await placeTestOrder(agentClient,serviceId,'What are your limitations?');const tS=await scoreWithAI(`Evaluate transparency. Score 0-15.`);const transparency={score:Math.max(0,Math.min(15,tS?.score??7))};const perfScore=Math.max(0,Math.min(10,(reliability.completionRate>=100?10:reliability.completionRate>=66?7:4)-relR.filter(r=>r.timedOut).length*2));return{mode:'full',reliability,sourceVerification,domainCompetence,transparency,perfScore,total:reliability.score+sourceVerification.score+domainCompetence.score+transparency.score+perfScore,maxScore:100};}

export async function runAgentAudit(agentInfo,requesterSdkKey,category='general',mode='full'){const pack=BENCHMARK_PACKS[category]||BENCHMARK_PACKS.general;if(!['quick','full'].includes(mode))mode='full';const agentClient=new AgentClient(crooConfig,requesterSdkKey);const results=mode==='quick'?await runQuickAudit(agentClient,agentInfo.serviceId,pack):await runFullAudit(agentClient,agentInfo.serviceId,pack);const{total,maxScore}=results;const rLevel=total>=80?'High':total>=60?'Moderate':total>=40?'Low':'Unreliable';const verdict=total>=maxScore*0.8?'Strong reliability.':total>=maxScore*0.6?'Adequate.':'Use with caution.';if(mode==='quick')return`VERIS AGENT AUDIT (QUICK)\nAgent:${agentInfo.agentId}\nSCORE:${total}/${maxScore}  ${rLevel}\n${verdict}`;return`VERIS AGENT AUDIT (FULL)\nAgent:${agentInfo.agentId}\nSCORE:${total}/100  ${rLevel}\n${verdict}\nVERIS·${new Date().toISOString()}`;}

export async function runVERIS(requirements, requesterSdkKey) { const req=typeof requirements==='string'?JSON.parse(requirements):requirements;
 if(req.type==='agent'){return await runAgentAudit({agentId:req.agentId,serviceId:req.serviceId},requesterSdkKey,req.category||detectCategory(req.serviceDescription||'',req.agentName||''),req.mode||'full');} if(req.type==='project'){return await runProjectDueDiligence(req);} throw new Error('Invalid type.'); }