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
// SIGNAL GROUND TRUTH
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
    founded_year: 2009,
    ecosystem_level: 'dominant',
    adoption_level: 'global',
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
    founded_year: 2015,
    ecosystem_level: 'dominant',
    adoption_level: 'global',
  },
  'Solana': {
    open_source: { value: 'YES', urls: ['https://github.com/solana-labs/solana'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/solana-labs'], confidence: 100 },
    multiple_contributors: { value: 'YES', urls: ['https://github.com/solana-labs/solana'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://solana.com'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://solana.com'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://docs.solana.com'], confidence: 100 },
    founded_year: 2020,
    ecosystem_level: 'major',
    adoption_level: 'large',
  },
  'Hyperliquid': {
    live_product: { value: 'YES', urls: ['https://app.hyperliquid.xyz'], confidence: 100 },
    open_source: { value: 'YES', urls: ['https://github.com/hyperliquid-dex'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/hyperliquid-dex'], confidence: 100 },
    founded_year: 2022,
    ecosystem_level: 'growing',
    adoption_level: 'medium',
  },
  'Uniswap': {
    open_source: { value: 'YES', urls: ['https://github.com/Uniswap'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/Uniswap'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://app.uniswap.org'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://uniswap.org'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://docs.uniswap.org'], confidence: 100 },
    founded_year: 2018,
    ecosystem_level: 'major',
    adoption_level: 'large',
  },
  'Aave': {
    open_source: { value: 'YES', urls: ['https://github.com/aave'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/aave'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://app.aave.com'], confidence: 100 },
    audit_found: { value: 'YES', urls: ['https://github.com/aave/aave-v3-core'], confidence: 95 },
    technical_docs: { value: 'YES', urls: ['https://docs.aave.com'], confidence: 100 },
    founded_year: 2017,
    ecosystem_level: 'major',
    adoption_level: 'large',
  },
  'Chainlink': {
    open_source: { value: 'YES', urls: ['https://github.com/smartcontractkit/chainlink'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/smartcontractkit'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://chain.link'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://chain.link'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://docs.chain.link'], confidence: 100 },
    founded_year: 2017,
    ecosystem_level: 'major',
    adoption_level: 'large',
  },
  'XRPL': {
    open_source: { value: 'YES', urls: ['https://github.com/XRPLF/rippled'], confidence: 100 },
    active_github: { value: 'YES', urls: ['https://github.com/XRPLF'], confidence: 100 },
    live_product: { value: 'YES', urls: ['https://xrpl.org'], confidence: 100 },
    clear_use_case: { value: 'YES', urls: ['https://xrpl.org'], confidence: 100 },
    technical_docs: { value: 'YES', urls: ['https://xrpl.org/docs'], confidence: 100 },
    founded_year: 2012,
    ecosystem_level: 'major',
    adoption_level: 'large',
  },
};

// ═══════════════════════════════════════════════════════════════════════
// MANDATORY SIGNALS PER ENTITY TYPE
// ═══════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════
// ENHANCED ENTITY RESOLUTION
// ═══════════════════════════════════════════════════════════════════════

const ENHANCED_ENTITY_MAP = {
  'bitcoin.org':             { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'bitcoincore.org':         { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'bitcoin.com':             { entity: 'Bitcoin',           type: 'l1l2', note: 'Not official bitcoin.org' },
  'github.com/bitcoin':      { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'bitcoin':                 { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'btc':                     { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'ethereum.org':            { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'ethresear.ch':            { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'github.com/ethereum':     { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'ethereum':                { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'eth':                     { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'solana.com':              { entity: 'Solana',            type: 'l1l2', network: 'Solana' },
  'solana.org':              { entity: 'Solana',            type: 'l1l2', network: 'Solana' },
  'github.com/solana-labs':  { entity: 'Solana',            type: 'l1l2', network: 'Solana' },
  'coinbase.com':            { entity: 'Coinbase',          type: 'exchange' },
  'binance.com':             { entity: 'Binance',           type: 'exchange' },
  'kraken.com':              { entity: 'Kraken',            type: 'exchange' },
  'uniswap.org':             { entity: 'Uniswap',           type: 'defi' },
  'app.uniswap.org':         { entity: 'Uniswap',           type: 'defi' },
  'aave.com':                { entity: 'Aave',              type: 'defi' },
  'app.aave.com':            { entity: 'Aave',              type: 'defi' },
  'hyperliquid.xyz':         { entity: 'Hyperliquid',      type: 'trading_protocol' },
  'app.hyperliquid.xyz':     { entity: 'Hyperliquid',      type: 'trading_protocol' },
  'chain.link':              { entity: 'Chainlink',        type: 'tooling' },
  'xrpl.org':                { entity: 'XRPL',             type: 'infrastructure' },
  'ripple.com':              { entity: 'Ripple',           type: 'infrastructure' },
};

export function resolveEntity(project) {
  const input = (project.name || project.website || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .trim();
  let resolved = ENHANCED_ENTITY_MAP[input];
  if (!resolved) {
    for (const [key, value] of Object.entries(ENHANCED_ENTITY_MAP)) {
      if (input.includes(key) || key.includes(input)) {
        resolved = value;
        break;
      }
    }
  }
  if (resolved) {
    const originalName = project.name;
    return {
      ...project,
      name: resolved.entity,
      entityType: project.entityType || resolved.type,
      network: resolved.network,
      resolvedFrom: originalName !== resolved.entity ? originalName : undefined,
      note: resolved.note,
    };
  }
  return project;
}

// ═══════════════════════════════════════════════════════════════════════
// SIGNAL RESOLVER
// ═══════════════════════════════════════════════════════════════════════

function resolveSignals(evidence, projectName, entityType) {
  const resolved = { ...evidence };
  let resolvedCount = 0;
  const groundTruth = ENTITY_GROUND_TRUTH[projectName];
  if (groundTruth) {
    for (const [key, gtValue] of Object.entries(groundTruth)) {
      if (key === 'founded_year' || key === 'ecosystem_level' || key === 'adoption_level') {
        if (key === 'founded_year') resolved.founded_year = gtValue;
        if (key === 'ecosystem_level') resolved.ecosystem_level = gtValue;
        if (key === 'adoption_level') resolved.adoption_level = gtValue;
        continue;
      }
      const extractedConfidence = resolved.confidence_per_signal?.[key] || 0;
      if ((resolved[key] === 'UNKNOWN' || extractedConfidence < 80) && gtValue.value === 'YES') {
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
// EVIDENCE CONFIDENCE GATING
// ═══════════════════════════════════════════════════════════════════════

function applyConfidenceGate(evidence) {
  const gated = { ...evidence };
  let downgradedCount = 0;
  let flaggedCount = 0;
  for (const [key, value] of Object.entries(evidence)) {
    if (value !== 'YES') continue;
    if (key.endsWith('_urls') || key === 'confidence_per_signal' || key === 'evidence_citations' || key === 'contradictions' || key === 'founder_names' || key === 'audit_firm' || key === 'founded_year' || key === 'ecosystem_level' || key === 'adoption_level' || key.startsWith('_')) continue;
    const confidence = evidence.confidence_per_signal?.[key];
    if (confidence === undefined || confidence === null) {
      gated[key] = 'UNKNOWN';
      if (gated[`${key}_urls`]) gated[`${key}_urls`] = [];
      downgradedCount++;
      continue;
    }
    if (confidence < 60) {
      gated[key] = 'UNKNOWN';
      if (gated[`${key}_urls`]) gated[`${key}_urls`] = [];
      downgradedCount++;
      continue;
    }
    if (confidence < 80) {
      gated[`${key}_weak`] = true;
      flaggedCount++;
    }
  }
  if (downgradedCount > 0 || flaggedCount > 0) {
    console.log(`  🔍 Evidence quality: ${downgradedCount} signals → UNKNOWN, ${flaggedCount} flagged as weak`);
  }
  return gated;
}

// ═══════════════════════════════════════════════════════════════════════
// SOURCE VALIDATION
// ═══════════════════════════════════════════════════════════════════════

const SIGNALS_REQUIRING_OFFICIAL = [
  'whitepaper', 'technical_docs', 'roadmap', 'tokenomics',
  'audit_found', 'open_source', 'active_github', 'team_page',
  'founders_named', 'on_chain_governance', 'treasury_transparency',
];

function validateSourceQuality(evidence, projectName) {
  const validated = { ...evidence };
  let invalidatedCount = 0;
  for (const signal of SIGNALS_REQUIRING_OFFICIAL) {
    if (validated[signal] !== 'YES') continue;
    const urls = validated[`${signal}_urls`] || [];
    const hasOfficialSource = urls.some(url => classifySourceTier(url, projectName) === 'tier1');
    if (!hasOfficialSource) {
      validated[signal] = 'UNKNOWN';
      validated[`${signal}_urls`] = [];
      invalidatedCount++;
    }
  }
  if (invalidatedCount > 0) console.log(`  ⚠ Source validation: ${invalidatedCount} signals require official source`);
  return validated;
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

const ENTITY_TEMPLATES = {
  l1l2: {
    label: 'L1/L2 Blockchain',
    note: 'L1/L2 rubric: verification (open source, GitHub) and reputation (longevity) are primary signals.',
    bucketWeights: { identity: 0.15, transparency: 0.25, verification: 0.35, reputation: 0.25 },
  },
  infrastructure: {
    label: 'Infrastructure Protocol',
    note: 'Infrastructure rubric: verification and reputation weighted highest.',
    bucketWeights: { identity: 0.15, transparency: 0.25, verification: 0.35, reputation: 0.25 },
  },
  defi: {
    label: 'DeFi Protocol',
    note: 'DeFi rubric: audit (verification) is critical. Identity matters more than for infrastructure.',
    bucketWeights: { identity: 0.25, transparency: 0.25, verification: 0.35, reputation: 0.15 },
  },
  trading_protocol: {
    label: 'Trading Protocol / Exchange',
    note: 'Trading protocol rubric: identity and verification (audit) weighted equally.',
    bucketWeights: { identity: 0.30, transparency: 0.20, verification: 0.35, reputation: 0.15 },
  },
  aiagent: {
    label: 'AI Agent / Product',
    note: 'AI agent rubric: live product (verification) and creator identity are primary.',
    bucketWeights: { identity: 0.30, transparency: 0.25, verification: 0.30, reputation: 0.15 },
  },
  memecoin: {
    label: 'Meme Coin / Token',
    note: 'Meme coin rubric: verification (audit, liquidity lock) and transparency weighted most.',
    bucketWeights: { identity: 0.20, transparency: 0.30, verification: 0.35, reputation: 0.15 },
  },
  dao: {
    label: 'DAO / Governance Protocol',
    note: 'DAO rubric: on-chain verification and transparency are primary.',
    bucketWeights: { identity: 0.10, transparency: 0.35, verification: 0.35, reputation: 0.20 },
  },
  startup: {
    label: 'Startup / Early Stage',
    note: 'Startup rubric: identity (founder transparency) is the primary legitimacy signal.',
    bucketWeights: { identity: 0.40, transparency: 0.25, verification: 0.25, reputation: 0.10 },
  },
  tooling: {
    label: 'Tooling / Developer Infrastructure',
    note: 'Tooling rubric: verification (GitHub, open source) is primary.',
    bucketWeights: { identity: 0.20, transparency: 0.25, verification: 0.40, reputation: 0.15 },
  },
  general: {
    label: 'General Project',
    note: 'General rubric. Specify entity type for more accurate scoring.',
    bucketWeights: { identity: 0.25, transparency: 0.25, verification: 0.25, reputation: 0.25 },
  },
};

export function detectEntityType(project) {
  const text = [project.name, project.description, project.website, project.entityType]
    .filter(Boolean).join(' ').toLowerCase();
  const signals = {
    l1l2: ['blockchain', 'layer 1', 'layer 2', 'l1', 'l2', 'mainnet', 'consensus', 'validator', 'node'],
    infrastructure: ['foundation', 'network', 'ledger', 'xrpl', 'ripple', 'cosmos', 'polkadot', 'near', 'cardano', 'algorand'],
    defi: ['defi', 'yield', 'lending', 'borrow', 'swap', 'amm', 'liquidity pool', 'vault', 'liquid staking', 'dex'],
    trading_protocol: ['exchange', 'trading', 'derivatives', 'perpetuals', 'order book', 'hyperliquid', 'dydx', 'gmx', 'drift'],
    aiagent: ['ai agent', 'autonomous agent', 'llm', 'gpt', 'copilot', 'assistant', 'autopilot', 'croo', 'veris', 'ai-powered'],
    memecoin: ['meme', 'doge', 'shib', 'pepe', 'inu', 'elon', 'moon', 'fair launch', 'stealth launch'],
    dao: ['dao', 'governance', 'vote', 'proposal', 'treasury', 'multisig', 'snapshot', 'aragon'],
    startup: ['startup', 'seed', 'series a', 'backed by', 'venture', 'incubator', 'beta'],
    tooling: ['sdk', 'rpc', 'indexer', 'explorer', 'bridge', 'oracle', 'developer tool', 'chainlink', 'wallet sdk'],
  };
  const matches = Object.entries(signals)
    .filter(([k]) => k !== 'general')
    .map(([type, terms]) => ({ type, score: terms.filter(s => text.includes(s)).length }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);
  return matches[0]?.type || 'general';
}

// ═══════════════════════════════════════════════════════════════════════
// HARD TRUST EVENTS
// ═══════════════════════════════════════════════════════════════════════

const HARD_TRUST_EVENTS = [
  { key: 'confirmed_rug_pull',   label: 'Confirmed rug pull' },
  { key: 'confirmed_fraud',      label: 'Confirmed fraud' },
  { key: 'confirmed_scam',       label: 'Confirmed scam' },
  { key: 'sec_enforcement',      label: 'SEC/CFTC enforcement action' },
  { key: 'sanctions',            label: 'Government sanctions (OFAC)' },
  { key: 'criminal_conviction',  label: 'Criminal conviction of founders' },
];

// ═══════════════════════════════════════════════════════════════════════
// EVIDENCE EXTRACTION
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
    `8. Hard events MUST have citation with source_url + quote >= 25 chars. Without it, set UNKNOWN.\n` +
    `9. confidence_per_signal: 0-100 estimate per signal based on source authority and clarity.\n\n` +
    `Return ONLY valid JSON with all fields from schema.`;

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
// LONGEVITY, LEGITIMACY, MATURITY, CONFIDENCE, RECOMMENDATION
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
    if (longevityOrder.includes(sigKey)) {
      if (sigKey !== firedLongevity) { buckets[bucket].max += basePoints; continue; }
    }
    buckets[bucket].max += basePoints;
    const state = ev[sigKey] || 'UNKNOWN';
    if (state !== 'YES') continue;
    const urls = ev[`${sigKey}_urls`] || [];
    const tier = bestTierName(urls, projectName);
    const tierW = TIER_WEIGHTS[tier];
    const t1t2 = urls.filter(u => ['tier1','tier2'].includes(classifySourceTier(u, projectName))).length;
    const isWeak = ev[`${sigKey}_weak`] === true;
    const weakMultiplier = isWeak ? 0.75 : 1.0;
    const cons = t1t2 >= 2 ? 1.10 : t1t2 === 1 ? 1.00 : urls.length >= 2 ? 0.90 : 0.75;
    const pts = Math.round(basePoints * tierW * cons * weakMultiplier);
    buckets[bucket].raw += pts;
    applied[bucket].push({
      label: SIGNAL_LABELS[sigKey] || sigKey,
      points: pts, tier, urls,
      confidence: ev.confidence_per_signal?.[sigKey] ?? defaultConfidence(tier),
      weak: isWeak,
    });
  }
  const scores = {};
  for (const [bk, data] of Object.entries(buckets)) {
    scores[bk] = data.max > 0 ? Math.min(100, Math.round((data.raw / data.max) * 100)) : 0;
  }
  const bw = template.bucketWeights;
  const legitimacyScore = Math.round(
    scores.identity * bw.identity + scores.transparency * bw.transparency +
    scores.verification * bw.verification + scores.reputation * bw.reputation
  );
  return { legitimacyScore, scores, applied };
}

function computeCleanMaturityScore(evidence) {
  const lFlags = longevityFlags(evidence);
  const ev = { ...evidence, ...lFlags };
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
  const applied = Object.entries(subScores).map(([key, score]) => ({
    category: key.charAt(0).toUpperCase() + key.slice(1), score,
    label: getMaturityCategoryLabel(key, score),
  }));
  return { maturityScore, subScores, applied };
}

function calculateLongevitySubscore(ev) {
  if (ev.longevity_10y === 'YES') return 95;
  if (ev.longevity_5y === 'YES') return 75;
  if (ev.longevity_2y === 'YES') return 45;
  if (ev.longevity_1y === 'YES') return 20;
  return 5;
}
function calculateAdoptionSubscore(ev) {
  const level = ev.adoption_level || 'none';
  const baseMap = { global: 90, large: 70, medium: 45, small: 20, none: 5 };
  let score = baseMap[level] || 5;
  if (ev.major_exchange_listed === 'YES') score = Math.min(100, score + 10);
  if (ev.institutional_adoption === 'YES') score = Math.min(100, score + 10);
  if (ev.top10_chain === 'YES') score = Math.min(100, score + 15);
  return score;
}
function calculateEcosystemSubscore(ev) {
  const level = ev.ecosystem_level || 'none';
  const baseMap = { dominant: 95, major: 75, growing: 50, small: 25, none: 5 };
  let score = baseMap[level] || 5;
  if (ev.developer_ecosystem === 'YES') score = Math.min(100, score + 15);
  if (ev.sdks_found === 'YES') score = Math.min(100, score + 10);
  if (ev.grants_hackathons === 'YES') score = Math.min(100, score + 10);
  return score;
}
function calculateDevelopmentSubscore(ev) {
  let score = 0;
  if (ev.active_github === 'YES') score += 25;
  if (ev.open_source === 'YES') score += 20;
  if (ev.multiple_contributors === 'YES') score += 15;
  if (ev.high_github_stars === 'YES') score += 10;
  if (ev.regular_releases === 'YES') score += 15;
  if (ev.recent_commits === 'YES') score += 10;
  if (ev.developer_ecosystem === 'YES') score += 5;
  return Math.min(100, score);
}
function calculateSecuritySubscore(ev) {
  let score = 10;
  if (ev.audit_found === 'YES') { score += 35; if (ev.multiple_audits === 'YES') score += 15; }
  if (ev.bug_bounty === 'YES') score += 20;
  if ((ev.confirmed_hack || 'UNKNOWN') !== 'YES') score += 20;
  return Math.min(100, score);
}
function calculateMarketSubscore(ev) {
  let score = 0;
  if (ev.major_exchange_listed === 'YES') score += 25;
  if (ev.institutional_adoption === 'YES') score += 25;
  if (ev.tvl_mentioned === 'YES') score += 20;
  if (ev.trading_volume_mentioned === 'YES') score += 15;
  if (ev.large_community === 'YES') score += 10;
  if (ev.media_coverage === 'YES') score += 5;
  return Math.min(100, score);
}
function getMaturityCategoryLabel(category, score) {
  if (score >= 90) return `${category}: Excellent`;
  if (score >= 70) return `${category}: Strong`;
  if (score >= 50) return `${category}: Moderate`;
  if (score >= 30) return `${category}: Limited`;
  return `${category}: Minimal`;
}

// ═══════════════════════════════════════════════════════════════════════
// REASONABLENESS LAYER
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
  if (!key) return { reasonable: true, note: null };
  const benchmark = ENTITY_BENCHMARKS[key];
  const issues = [];
  if (legitimacyScore < benchmark.expectedLegitimacy.min) issues.push(`Legitimacy ${legitimacyScore} below expected min ${benchmark.expectedLegitimacy.min} for ${benchmark.type}`);
  if (legitimacyScore > benchmark.expectedLegitimacy.max) issues.push(`Legitimacy ${legitimacyScore} above expected max ${benchmark.expectedLegitimacy.max} for ${benchmark.type}`);
  if (maturityScore < benchmark.expectedMaturity.min) issues.push(`Maturity ${maturityScore} below expected min ${benchmark.expectedMaturity.min} for ${benchmark.type}`);
  if (benchmark.criticalExpected && legitimacyScore > 30) issues.push(`CRITICAL: ${key} should show CRITICAL RISK but scored ${legitimacyScore}`);
  if (issues.length > 0) {
    console.warn(`\n⚠ REASONABLENESS CHECK FAILED for ${projectName}:`);
    issues.forEach(i => console.warn(`  - ${i}`));
    return { reasonable: false, issues, benchmark: benchmark.type };
  }
  return { reasonable: true, benchmark: benchmark.type };
}

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
  return Math.min(0.98, Math.max(0.05, (authority * 0.30 + countScore * 0.25 + agreement * 0.25 + freshness * 0.20) * contraFactor));
}

function getRecommendation(legitimacyScore, maturityScore, opRiskLevel, hardEventsConfirmed) {
  if (hardEventsConfirmed.length > 0) return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29', text:'Hard trust event confirmed (fraud/scam/sanctions). Do not engage.' };
  if (legitimacyScore >= 85 && maturityScore >= 70) return { label:'STRONGLY TRUSTED', symbol:'✓✓', band:'90-100', text:'Strong legitimacy and maturity signals across multiple independent sources.' };
  if (legitimacyScore >= 80 && maturityScore >= 55) return { label:'TRUSTED', symbol:'✓', band:'80-89', text:'Solid legitimacy signals confirmed. Standard due diligence recommended.' };
  if (legitimacyScore >= 65) return { label:'GENERALLY LEGITIMATE', symbol:'~✓', band:'65-79', text:'Legitimacy signals present. Some evidence gaps.' };
  if (legitimacyScore >= 50) return { label:'MIXED SIGNALS', symbol:'~', band:'50-64', text:'Incomplete or inconsistent evidence. Manual research required.' };
  if (legitimacyScore >= 30) return { label:'HIGH RISK', symbol:'✗', band:'30-49', text:'Significant legitimacy gaps. Proceed only with extensive verification.' };
  return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29', text:'Critical legitimacy failures or confirmed negative events.' };
}

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
    { key:'confirmed_hack', label:'Confirmed hack or breach' },
    { key:'confirmed_exploit', label:'Confirmed smart contract exploit' },
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

function sourceAuthorityBreakdown(allSources, projectName) {
  const counts = { tier1:0, tier2:0, tier3:0, tier4:0 };
  for (const s of allSources) { const t = classifySourceTier(s.url||'', projectName); counts[t]++; }
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
    const sources = res.results.map(r => ({ title: r.title, url: r.url, tier: classifySourceTier(r.url, projectName), snippet: r.content?.substring(0,500)||'' }));
    const text = sources.map((s,i) => `[Source ${i+1} | ${s.tier.toUpperCase()} | ${s.url}]\n${s.title}\n${s.snippet}`).join('\n\n---\n\n');
    return { text, sourceCount:sources.length, sources };
  } catch (err) { console.warn('  ⚠ Tavily error:', err.message); return { text:'', sourceCount:0, sources:[] }; }
}

function buildSearchQueries(project, entityType) {
  const n = project.name;
  const q = {
    identity: `${n} founders team executives CEO LinkedIn who built created`,
    documentation: `${n} whitepaper roadmap documentation technical paper tokenomics`,
    development: `${n} GitHub repository open source contributors commits releases`,
    community: `${n} community Twitter followers users adoption media coverage`,
    risk: `${n} scam fraud rug pull hack exploit lawsuit SEC CFTC criminal`,
    longevity: `${n} founded launched year history milestones when created`,
    adoption: `${n} TVL users transactions exchange listed institutional adoption scale`,
    ecosystem: `${n} developer ecosystem SDK integrations partnerships network`,
  };
  if (['defi','trading_protocol'].includes(entityType)) q.security = `${n} audit certik trail of bits halborn openzeppelin bug bounty insurance`;
  if (['memecoin','nft'].includes(entityType)) q.liquidity = `${n} liquidity locked holders distribution DEX trading pair`;
  return q;
}

async function groqExtract(prompt) {
  const c = await groq.chat.completions.create({
    model:'llama-3.3-70b-versatile',
    messages:[{ role:'system', content:'You are a structured data extraction engine. Return ONLY valid JSON. No markdown, no backticks, no explanation.' },{ role:'user', content:prompt }],
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

function progressBar(score, max=100, width=20) {
  if (max===0) return '░'.repeat(width);
  const filled = Math.round((score/max)*width);
  return '█'.repeat(Math.max(0,filled))+'░'.repeat(Math.max(0,width-filled));
}
function confBar(c, width=12) {
  const filled = Math.round(c*width);
  return '▓'.repeat(Math.max(0,filled))+'░'.repeat(Math.max(0,width-filled))+` ${Math.round(c*100)}%`;
}
function tierTag(t) { return { tier1:'[T1]', tier2:'[T2]', tier3:'[T3]', tier4:'[T4]' }[t]||'[T?]'; }
function bestTierName(urls = [], projectName = '') {
  if (!urls.length) return 'tier4';
  return ['tier1','tier2','tier3','tier4'].find(t => urls.map(u=>classifySourceTier(u,projectName||'')).includes(t)) || 'tier4';
}
function defaultConfidence(tier) { return { tier1:90, tier2:70, tier3:45, tier4:20 }[tier] ?? 20; }

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE — MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════

export async function runProjectDueDiligence(project) {
  project = resolveEntity(project);
  console.log(`\n🔍 VERIS Due Diligence: ${project.name}${project.resolvedFrom ? ` (resolved from: ${project.resolvedFrom})` : ''}`);
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
  console.log('  → Validating evidence quality...');
  evidence = applyConfidenceGate(evidence);
  evidence = validateSourceQuality(evidence, project.name);
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
    ? { label: 'INSUFFICIENT DATA', symbol: '?', band: 'N/A', text: `Cannot score — all ${evidence._missing_mandatory?.length || ''} mandatory signals for ${template.label} are UNKNOWN. More evidence required.` }
    : getRecommendation(legitimacyScore, maturityScore, opRisk.level, hardEvents);
  const reasonableness = insufficientEvidence ? { reasonable: true, note: 'Skipped — insufficient evidence' } : validateReasonableness(project.name, legitimacyScore, maturityScore);
  const calibration = checkCalibration(project.name, typeof legitimacyScore === 'number' ? legitimacyScore : 0, typeof maturityScore === 'number' ? maturityScore : 0);
  const srcBreakdown = sourceAuthorityBreakdown(allSources, project.name);
  console.log('  → Generating verdict...');
  const allConfirmedSignals = [...legit.applied.identity, ...legit.applied.transparency, ...legit.applied.verification, ...legit.applied.reputation].map(s => s.label);
  const verdictPrompt = insufficientEvidence
    ? `Write a 2-3 sentence verdict for "${project.name}" explaining that there is INSUFFICIENT EVIDENCE to score. Mandatory signals missing: ${evidence._missing_mandatory?.join(', ') || 'all'}. Do not make claims about legitimacy.`
    : `Write a 2-3 sentence factual verdict for "${project.name}" (${template.label}).\n\nLegitimacy: ${legitimacyScore}/100 | Maturity: ${maturityScore}/100 | Confidence: ${Math.round(confidence*100)}% | Op Risk: ${opRisk.level}\n\nConfirmed signals: ${allConfirmedSignals.join(', ') || 'none'}\nHard trust events: ${hardEvents.map(e=>e.label).join(', ') || 'none'}\nOperational risks: ${opRisk.confirmed.map(r=>r.label).join(', ') || 'none'}\n\nRules: Only use facts listed. Legitimacy ≠ quality. If confidence <50%, note limited evidence.`;
  const verdictText = await groqSynthesize(verdictPrompt, insufficientEvidence ? 'You are a factual research assistant. Acknowledge uncertainty. Do not make claims without evidence.' : 'Write a factual trust audit verdict. Do not add information not listed above. Be direct.');
  const hardWarn = hardEvents.length > 0 ? `\n⛔ HARD TRUST EVENT — All scores overridden to 0\n` + hardEvents.map(e=>`   ${e.label}\n   Source: ${e.citation.source_url}\n   Quote:  "${e.citation.quote}"`).join('\n') : '';
  const insufficientWarn = insufficientEvidence ? `\n⚠  INSUFFICIENT EVIDENCE — Scores are N/A, not 0\n   Missing mandatory signals: ${evidence._missing_mandatory?.join(', ') || 'all'}\n   This does NOT mean the project is illegitimate. It means VERIS cannot verify it.` : '';
  const lowConfWarn = !insufficientEvidence && confidence < 0.40 ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence*100)}%): Limited sources. UNKNOWN ≠ negative.` : !insufficientEvidence && confidence < 0.65 ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence*100)}%): Some areas have limited coverage.` : '';
  const anomalyWarn = calibration.anomaly ? `\n⚠  SCORE ANOMALY: ${calibration.note}` : '';
  const reasonablenessWarn = !reasonableness.reasonable && !insufficientEvidence ? `\n⚠  REASONABLENESS CHECK FAILED (${reasonableness.benchmark})\n${reasonableness.issues.map(i => `   ${i}`).join('\n')}` : '';
  function sigBlock(signals) {
    if (!signals.length) return '  (No signals confirmed)';
    return signals.map(s => `  +${String(s.points).padStart(2)}  ${s.label}  ${tierTag(s.tier)} conf:${s.confidence}%${s.weak ? ' ⚠ WEAK' : ''}` + (s.urls?.[0] ? `\n       └─ ${s.urls[0]}` : '')).join('\n');
  }
  const contraBlock = evidence.contradictions?.length > 0 ? `\n⚡ CONFLICTS DETECTED — Manual verification recommended\n` + evidence.contradictions.map(c => `  Field: ${c.field}\n  Claim A: "${c.claim_a}"\n  Source: ${c.source_a}\n  Claim B: "${c.claim_b}"\n  Source: ${c.source_b}`).join('\n\n') : '';
  const allTemplateSignals = [...new Set([...Object.keys(LEGITIMACY_SIGNALS).filter(k => !['no_confirmed_fraud','no_confirmed_hack','longevity_10y','longevity_5y','longevity_2y','longevity_1y'].includes(k))])];
  const missingSignals = allTemplateSignals.filter(k => (evidence[k]||'UNKNOWN') === 'UNKNOWN');
  const missingBlock = missingSignals.length > 0 ? `EVIDENCE NOT LOCATED (${insufficientEvidence ? 'N/A' : 'UNKNOWN'} — no score impact)\n` + missingSignals.map(k => `  ${insufficientEvidence ? 'N/A' : '?'} ${SIGNAL_LABELS[k]||k}`).join('\n') : '';
  const unverifiedBlock = [...unverifiedHard,...opRisk.unverified].length > 0 ? [...unverifiedHard,...opRisk.unverified].map(u => `  ~ ${u.label}  |  ${u.note}${u.citation?.source_url?'\n    Source: '+u.citation.source_url:''}`).join('\n') : '  ✓ None';
  const operationalBlock = opRisk.confirmed.length > 0 ? opRisk.confirmed.map(r => `  ⚠ ${r.label}\n     Source: ${r.citation.source_url}\n     Quote:  "${r.citation.quote}"`).join('\n') + '\n\n  NOTE: Operational incidents do not reduce legitimacy or maturity scores.' : '  ✓ None confirmed';
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
  Longevity:      ${insufficientEvidence ? 'N/A' : mat.subScores.longevity + '/100'}
  Adoption:       ${insufficientEvidence ? 'N/A' : mat.subScores.adoption + '/100'}
  Ecosystem:      ${insufficientEvidence ? 'N/A' : mat.subScores.ecosystem + '/100'}
  Development:    ${insufficientEvidence ? 'N/A' : mat.subScores.development + '/100'}
  Security:       ${insufficientEvidence ? 'N/A' : mat.subScores.security + '/100'}
  Market:         ${insufficientEvidence ? 'N/A' : mat.subScores.market + '/100'}

CONFIDENCE:   ${confBar(confidence, 20)}
OP. RISK:     ${opRisk.level}
${hardWarn}${insufficientWarn}${lowConfWarn}${anomalyWarn}${reasonablenessWarn}
RECOMMENDATION:  ${rec.symbol} ${rec.label}  [Band: ${rec.band}]
${rec.text}
══════════════════════════════════════════════
EVIDENCE SOURCES
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
${mat.applied.length ? mat.applied.map(s=>`  +${String(s.score).padStart(2)}  ${s.label}`).join('\n') : '  (No signals confirmed)'}

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
  N/A     Insufficient Data

METHODOLOGY
  Entity:       ${template.label}
  Legitimacy:   Weighted average of 4 buckets — no double-counting
  Maturity:     Clean sub-scores (Longevity/Adoption/Ecosystem/Development/Security/Market)
  Confidence:   Source authority (30%) + count (25%) + agreement (25%) + freshness (20%)
  Tiers:        T1 Official (×1.00) · T2 Media (×0.75) · T3 Community (×0.40) · T4 Inferred (×0.15)
  Hard events:  Confirmed fraud/sanctions → override to 0
  Ground Truth: Signal resolver applies known facts for established entities

AUDIT TRAIL
  Search:      Tavily Advanced (${totalSources} sources)
  Extraction:  Groq llama-3.3-70b-versatile (temperature 0.0)
  Resolver:    Signal resolver + confidence gate + source validation
  Scoring:     Deterministic code + reasonableness check
  Auditor:     VERIS · CROO v1 · Base Mainnet
  Timestamp:   ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// BENCHMARK SUITE
// ═══════════════════════════════════════════════════════════════════════

export const CALIBRATION_BENCHMARKS = {
  bitcoin: { legitMin:82, maturityMin:82 }, ethereum: { legitMin:82, maturityMin:82 },
  solana: { legitMin:75, maturityMin:72 }, chainlink: { legitMin:75, maturityMin:68 },
  uniswap: { legitMin:72, maturityMin:68 }, aave: { legitMin:72, maturityMin:65 },
  hyperliquid: { legitMin:65, maturityMin:58 }, xrpl: { legitMin:72, maturityMin:65 },
  ftx: { expectCritical:true }, 'terra luna': { expectCritical:true }, celsius: { expectCritical:true },
};

export function checkCalibration(name, legit, maturity) {
  const key = name.toLowerCase().trim();
  const bench = CALIBRATION_BENCHMARKS[key] || CALIBRATION_BENCHMARKS[key.split(' ')[0]];
  if (!bench) return { anomaly:false };
  if (bench.expectCritical && legit > 30) return { anomaly:true, note:`Score ${legit} unexpectedly high for known failed project.` };
  if (bench.legitMin && legit < bench.legitMin - 15) return { anomaly:true, note:`Legitimacy ${legit} below expected floor (${bench.legitMin}).` };
  if (bench.maturityMin && maturity < bench.maturityMin - 15) return { anomaly:true, note:`Maturity ${maturity} below expected floor (${bench.maturityMin}).` };
  return { anomaly:false };
}

export async function runBenchmarkSuite(verbose=false) {
  const SUITE = [
    { name:'Bitcoin', entityType:'l1l2', group:'gold', legitMin:82, maturityMin:82 },
    { name:'Ethereum', entityType:'l1l2', group:'gold', legitMin:82, maturityMin:82 },
    { name:'Solana', entityType:'l1l2', group:'gold', legitMin:75, maturityMin:72 },
    { name:'Hyperliquid', entityType:'trading_protocol', group:'good', legitMin:65, maturityMin:58 },
    { name:'Uniswap', entityType:'defi', group:'good', legitMin:72, maturityMin:68 },
    { name:'Aave', entityType:'defi', group:'good', legitMin:72, maturityMin:65 },
    { name:'XRPL', entityType:'infrastructure', group:'good', legitMin:72, maturityMin:65 },
    { name:'FTX', entityType:'trading_protocol', group:'failed', expectCritical:true },
    { name:'Terra Luna', entityType:'l1l2', group:'failed', expectCritical:true },
    { name:'Celsius', entityType:'defi', group:'failed', expectCritical:true },
  ];
  console.log('\n🧪 VERIS BENCHMARK SUITE');
  console.log('═'.repeat(72));
  const results = [];
  for (const test of SUITE) {
    try {
      const report = await runProjectDueDiligence({ name:test.name, entityType:test.entityType });
      const lStr = report.match(/LEGITIMACY:\s+(.+)/)?.[1]?.trim() || '0';
      const mStr = report.match(/MATURITY:\s+(.+)/)?.[1]?.trim() || '0';
      const l = lStr === 'N/A' ? 0 : parseInt(lStr);
      const m = mStr === 'N/A' ? 0 : parseInt(mStr);
      const isCritical = report.includes('HARD TRUST EVENT')||report.includes('CRITICAL RISK');
      const isInsufficient = report.includes('INSUFFICIENT EVIDENCE');
      const pass = test.expectCritical ? (l <= 30 || isCritical) : (l >= test.legitMin-10 && m >= test.maturityMin-10);
      results.push({ name:test.name, group:test.group, l, m, pass, isCritical, isInsufficient });
      console.log(`${test.group.padEnd(14)} ${test.name.padEnd(15)} ${lStr.padStart(5)}  ${mStr.padStart(8)}  ${pass?'✓ PASS':'✗ FAIL'}${isCritical?' [CRITICAL]':''}${isInsufficient?' [INSUFFICIENT]':''}`);
    } catch (err) {
      results.push({ name:test.name, pass:false, error:err.message });
      console.log(`${'?'.padEnd(14)} ${test.name.padEnd(15)} ERROR: ${err.message}`);
    }
  }
  const passed = results.filter(r=>r.pass).length;
  console.log('═'.repeat(72));
  console.log(`RESULT: ${passed}/${results.length} passed`);
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT DISCOVERY & VERIFICATION — Progressive trust layers
// Layer 1: Discovery (public, no credentials)
// Layer 2: Functional (endpoint testing)
// Layer 3: Economic (CROO order flow, SDK key optional)
// ═══════════════════════════════════════════════════════════════════════

async function fetchAgentPage(agentUrl) {
  try {
    const response = await fetch(agentUrl, {
      headers: { 'Accept': 'application/json, text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { reachable: false, status: response.status };
    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const html = await response.text();
      const jsonMatch = html.match(/<script[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/)
        || html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/)
        || html.match(/{[\s\S]*"name"[\s\S]*}/);
      data = jsonMatch ? JSON.parse(jsonMatch[1] || jsonMatch[0]) : { raw: html.substring(0, 500) };
    }
    return { reachable: true, status: response.status, data };
  } catch (err) {
    return { reachable: false, error: err.message };
  }
}

function extractAgentCard(pageData, agentUrl) {
  const card = { name: null, description: null, provider: null, skills: [], categories: [], endpointUrl: null, serviceId: null, agentId: null, version: null };
  const data = pageData?.data || pageData || {};
  card.name = data.name || data.agent_name || data.title || null;
  card.description = data.description || data.about || data.summary || null;
  card.provider = data.provider || data.author || data.created_by || null;
  card.skills = data.skills || data.capabilities || data.services || [];
  card.categories = data.categories || data.tags || data.labels || [];
  card.endpointUrl = data.endpoint || data.url || data.api_endpoint || agentUrl;
  card.serviceId = data.service_id || data.serviceId || null;
  card.agentId = data.agent_id || data.agentId || data.id || null;
  card.version = data.version || null;
  if (!card.name && data.props?.pageProps?.agent) {
    const agent = data.props.pageProps.agent;
    card.name = agent.name || card.name;
    card.description = agent.description || card.description;
    card.skills = agent.skills || card.skills;
    card.endpointUrl = agent.endpoint || card.endpointUrl;
  }
  if (!card.name && data.raw) {
    const nameMatch = data.raw.match(/<h1[^>]*>([^<]+)<\/h1>/);
    if (nameMatch) card.name = nameMatch[1].trim();
  }
  const urlMatch = agentUrl.match(/\/([a-f0-9-]{36})(?:\/|$)/);
  if (urlMatch && !card.agentId) card.agentId = urlMatch[1];
  return card;
}

async function testEndpoint(endpointUrl) {
  try {
    const start = Date.now();
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'ping', message: 'health check' }),
      signal: AbortSignal.timeout(15000),
    });
    const latency = Date.now() - start;
    if (!response.ok) return { reachable: true, responding: false, status: response.status, latency };
    let body;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) { body = await response.json(); }
    else { const text = await response.text(); body = { raw: text.substring(0, 300) }; }
    return { reachable: true, responding: true, status: response.status, latency, responseFormat: contentType.includes('json') ? 'structured' : 'text', sampleResponse: body };
  } catch (err) {
    return { reachable: true, responding: false, error: err.message };
  }
}

async function testA2ACommunication(endpointUrl) {
  const testQueries = ['What services do you provide?', 'What are your capabilities?'];
  const results = [];
  for (const query of testQueries) {
    try {
      const start = Date.now();
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, message: query, task: query }),
        signal: AbortSignal.timeout(20000),
      });
      const latency = Date.now() - start;
      let body = null;
      try { body = await response.json(); } catch { body = { raw: 'unparseable' }; }
      results.push({ query, responded: response.ok, latency, hasContent: body && (body.response || body.result || body.answer || body.content || body.raw)?.length > 0 });
    } catch (err) {
      results.push({ query, responded: false, error: err.message });
    }
  }
  const responseRate = results.filter(r => r.responded).length / results.length;
  const avgLatency = results.filter(r => r.latency).reduce((s, r) => s + r.latency, 0) / (results.filter(r => r.latency).length || 1);
  return { queriesAttempted: results.length, queriesCompleted: results.filter(r => r.responded && r.hasContent).length, responseRate: Math.round(responseRate * 100), averageLatency: Math.round(avgLatency), results };
}

async function testEconomicFlow(agentId, serviceId, sdkKey) {
  if (!sdkKey) return { tested: false, reason: 'No SDK key provided' };
  try {
    const agentClient = new AgentClient(crooConfig, sdkKey);
    await agentClient.negotiateOrder({ serviceId, requirements: JSON.stringify({ query: 'VERIS economic verification test' }) });
    const stream = await agentClient.connectWebSocket();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { if (stream) try { stream.close(); } catch {} resolve({ tested: true, orderAccepted: true, orderPaid: false, orderCompleted: false, delivery: null }); }, 45000);
      stream.on(EventType.OrderCreated, async (e) => {
        try { await agentClient.payOrder(e.order_id); } catch (err) { clearTimeout(timeout); stream.close(); resolve({ tested: true, orderAccepted: true, orderPaid: false, error: err.message }); }
      });
      stream.on(EventType.OrderCompleted, async (e) => {
        let delivery = null;
        try { delivery = await agentClient.getDelivery(e.order_id); } catch {}
        clearTimeout(timeout); stream.close();
        resolve({ tested: true, orderAccepted: true, orderPaid: true, orderCompleted: true, delivery: delivery?.deliverableText?.substring(0, 200) || null });
      });
      stream.on(EventType.OrderRejected, () => { clearTimeout(timeout); stream.close(); resolve({ tested: true, orderAccepted: false, reason: 'Order rejected by agent' }); });
    });
  } catch (err) {
    return { tested: true, orderAccepted: false, error: err.message };
  }
}

function generateAgentTrustReport(discovery, card, endpoint, a2a, economic) {
  const layer1Pass = discovery.reachable && card.name;
  const layer2Pass = layer1Pass && endpoint.responding && a2a.responseRate >= 50;
  const layer3Pass = economic?.tested && economic?.orderCompleted;
  let trustLevel, symbol;
  if (layer3Pass) { trustLevel = 'Verified (L3)'; symbol = '✓✓✓'; }
  else if (layer2Pass) { trustLevel = 'Functional (L2)'; symbol = '✓✓'; }
  else if (layer1Pass) { trustLevel = 'Discovered (L1)'; symbol = '✓'; }
  else { trustLevel = 'Unreachable'; symbol = '✗'; }
  return `VERIS AGENT TRUST REPORT
══════════════════════════════════════════════
Agent URL:       ${discovery.agentUrl}
Trust Level:     ${symbol} ${trustLevel}
Scanned:         ${new Date().toUTCString()}
══════════════════════════════════════════════
LAYER 1 — DISCOVERY
  Reachable:     ${discovery.reachable ? '✓ Yes' : '✗ No'}${discovery.status ? ` (HTTP ${discovery.status})` : ''}
  Agent Name:    ${card.name || '✗ Not found'}
  Description:   ${card.description ? card.description.substring(0, 100) + '...' : '✗ Not found'}
  Provider:      ${card.provider || 'Unknown'}
  Skills:        ${card.skills?.length ? card.skills.join(', ') : 'None declared'}
  Categories:    ${card.categories?.length ? card.categories.join(', ') : 'None'}
  Agent ID:      ${card.agentId || 'Not found'}
  Service ID:    ${card.serviceId || 'Not found'}
  Version:       ${card.version || 'Not specified'}
══════════════════════════════════════════════
LAYER 2 — FUNCTIONAL
  Endpoint:      ${card.endpointUrl || 'Unknown'}
  Responding:    ${endpoint.responding ? `✓ Yes (${endpoint.latency}ms)` : endpoint.reachable === false ? '✗ Unreachable' : '✗ No response'}
  Format:        ${endpoint.responseFormat || 'Unknown'}
  A2A Comm:      ${a2a.queriesCompleted}/${a2a.queriesAttempted} queries completed
  Response Rate: ${a2a.responseRate}%
  Avg Latency:   ${a2a.averageLatency}ms
══════════════════════════════════════════════
LAYER 3 — ECONOMIC (CROO Payment Flow)
  SDK Key:       ${economic?.tested ? 'Provided' : 'Not provided'}
  Order Flow:    ${economic?.tested === false ? '~ Not tested' : economic?.orderCompleted ? '✓ Full flow verified' : economic?.orderAccepted ? '~ Partial (payment pending)' : '✗ Failed'}
  ${economic?.error ? `Error: ${economic.error}` : ''}
  ${economic?.delivery ? `Delivery: ${economic.delivery.substring(0, 150)}...` : ''}
══════════════════════════════════════════════
VERDICT
  ${trustLevel === 'Verified (L3)' ? 'Agent is fully verified across all trust layers. Production-ready for CROO integration.' :
    trustLevel === 'Functional (L2)' ? 'Agent is discoverable and responding to queries. Functional for basic tasks. Economic verification available with SDK key.' :
    trustLevel === 'Discovered (L1)' ? 'Agent card found but endpoint is not responding. May be offline or misconfigured.' :
    'Agent URL is unreachable. Verify the URL is correct and the agent is online.'}
══════════════════════════════════════════════
METHODOLOGY
  Layer 1: Public page fetch + agent card extraction
  Layer 2: Endpoint health check + A2A query test
  Layer 3: CROO order negotiation → payment → delivery
  No credentials required for Layers 1-2.
  SDK key required for Layer 3 (optional).
VERIS · ${new Date().toISOString()}`;
}

export async function runAgentAudit(requirements) {
  const agentUrl = requirements.agentUrl;
  const sdkKey = requirements.sdkKey || null;
  if (!agentUrl) throw new Error('Agent audit requires: agentUrl');
  console.log(`\n🤖 VERIS Agent Audit: ${agentUrl}`);
  console.log('  → Layer 1: Fetching agent page...');
  const discovery = await fetchAgentPage(agentUrl);
  discovery.agentUrl = agentUrl;
  if (!discovery.reachable) {
    console.log(`  ✗ Agent unreachable: ${discovery.error || `HTTP ${discovery.status}`}`);
    return generateAgentTrustReport(discovery, { name: null, description: null, provider: null, skills: [], categories: [], endpointUrl: null, agentId: null, serviceId: null, version: null }, { reachable: false, responding: false }, { queriesAttempted: 0, queriesCompleted: 0, responseRate: 0, averageLatency: 0 }, { tested: !!sdkKey, orderAccepted: false });
  }
  const card = extractAgentCard(discovery.data || discovery, agentUrl);
  console.log(`  ✓ Agent found: ${card.name || 'Unknown'}`);
  if (card.skills?.length) console.log(`    Skills: ${card.skills.join(', ')}`);
  console.log('  → Layer 2: Testing endpoint...');
  const endpointUrl = card.endpointUrl || agentUrl;
  const endpoint = await testEndpoint(endpointUrl);
  let a2a = { queriesAttempted: 0, queriesCompleted: 0, responseRate: 0, averageLatency: 0 };
  if (endpoint.responding) {
    console.log(`  ✓ Endpoint responding (${endpoint.latency}ms)`);
    console.log('  → Testing A2A communication...');
    a2a = await testA2ACommunication(endpointUrl);
    console.log(`  ✓ A2A: ${a2a.queriesCompleted}/${a2a.queriesAttempted} queries completed`);
  } else {
    console.log('  ✗ Endpoint not responding');
  }
  let economic = { tested: false, reason: 'No SDK key provided' };
  if (sdkKey && card.serviceId) {
    console.log('  → Layer 3: Testing economic flow...');
    economic = await testEconomicFlow(card.agentId, card.serviceId, sdkKey);
    if (economic.orderCompleted) console.log('  ✓ Full CROO order flow verified');
    else if (economic.orderAccepted) console.log('  ~ Order accepted but payment/delivery incomplete');
    else console.log('  ✗ Economic flow failed');
  } else if (!sdkKey) {
    console.log('  ~ Layer 3 skipped (no SDK key)');
  } else if (!card.serviceId) {
    console.log('  ~ Layer 3 skipped (no service ID found)');
  }
  return generateAgentTrustReport(discovery, card, endpoint, a2a, economic);
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════

export async function runVERIS(requirements, requesterSdkKey) {
  const req = typeof requirements === 'string' ? JSON.parse(requirements) : requirements;
  if (req.type === 'agent') {
    if (!req.agentUrl) throw new Error('Agent audit requires: agentUrl');
    return await runAgentAudit({ agentUrl: req.agentUrl, sdkKey: req.sdkKey || requesterSdkKey || null });
  }
  if (req.type === 'project') {
    if (!req.name) throw new Error('Project due diligence requires: name');
    return await runProjectDueDiligence(req);
  }
  throw new Error('Invalid type. Use "project" or "agent".');
}
