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
// SIGNAL GROUND TRUTH — Known facts for established entities
// These are NOT extracted by Groq. They're ground truth reference data.
// Applied BEFORE quality gates to ensure known entities aren't penalized
// by weak extraction.
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
// If ALL mandatory signals are UNKNOWN, report INSUFFICIENT DATA
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
// ENHANCED ENTITY RESOLUTION — Handles more variants
// Maps domains, subdomains, common names to canonical entities
// ═══════════════════════════════════════════════════════════════════════

const ENHANCED_ENTITY_MAP = {
  // Bitcoin ecosystem
  'bitcoin.org':             { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'bitcoincore.org':         { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'bitcoin.com':             { entity: 'Bitcoin',           type: 'l1l2', note: 'Not official bitcoin.org' },
  'github.com/bitcoin':      { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'bitcoin':                 { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  'btc':                     { entity: 'Bitcoin',           type: 'l1l2', network: 'Bitcoin' },
  
  // Ethereum ecosystem
  'ethereum.org':            { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'ethresear.ch':            { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'github.com/ethereum':     { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'ethereum':                { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  'eth':                     { entity: 'Ethereum',          type: 'l1l2', network: 'Ethereum' },
  
  // Solana
  'solana.com':              { entity: 'Solana',            type: 'l1l2', network: 'Solana' },
  'solana.org':              { entity: 'Solana',            type: 'l1l2', network: 'Solana' },
  'github.com/solana-labs':  { entity: 'Solana',            type: 'l1l2', network: 'Solana' },
  
  // Exchanges (separate from networks)
  'coinbase.com':            { entity: 'Coinbase',          type: 'exchange' },
  'binance.com':             { entity: 'Binance',           type: 'exchange' },
  'kraken.com':              { entity: 'Kraken',            type: 'exchange' },
  
  // DeFi protocols (separate from networks)
  'uniswap.org':             { entity: 'Uniswap',           type: 'defi' },
  'app.uniswap.org':         { entity: 'Uniswap',           type: 'defi' },
  'aave.com':                { entity: 'Aave',              type: 'defi' },
  'app.aave.com':            { entity: 'Aave',              type: 'defi' },
  
  // Trading platforms
  'hyperliquid.xyz':         { entity: 'Hyperliquid',      type: 'trading_protocol' },
  'app.hyperliquid.xyz':     { entity: 'Hyperliquid',      type: 'trading_protocol' },
  
  // Infrastructure
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
  
  // Try direct match first
  let resolved = ENHANCED_ENTITY_MAP[input];
  
  // Try partial match if no direct match
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
// SIGNAL RESOLVER — Apply ground truth + flag insufficient evidence
// Runs BEFORE quality gates to ensure known entities aren't penalized
// ═══════════════════════════════════════════════════════════════════════

function resolveSignals(evidence, projectName, entityType) {
  const resolved = { ...evidence };
  let resolvedCount = 0;
  
  // Apply ground truth for known entities
  const groundTruth = ENTITY_GROUND_TRUTH[projectName];
  if (groundTruth) {
    for (const [key, gtValue] of Object.entries(groundTruth)) {
      if (key === 'founded_year' || key === 'ecosystem_level' || key === 'adoption_level') {
        // Always trust ground truth for metadata
        if (key === 'founded_year') resolved.founded_year = gtValue;
        if (key === 'ecosystem_level') resolved.ecosystem_level = gtValue;
        if (key === 'adoption_level') resolved.adoption_level = gtValue;
        continue;
      }
      
      // Apply ground truth if Groq returned UNKNOWN or had low confidence
      const extractedConfidence = resolved.confidence_per_signal?.[key] || 0;
      if ((resolved[key] === 'UNKNOWN' || extractedConfidence < 80) && gtValue.value === 'YES') {
        resolved[key] = 'YES';
        resolved[`${key}_urls`] = gtValue.urls;
        resolved.confidence_per_signal = {
          ...resolved.confidence_per_signal,
          [key]: gtValue.confidence,
        };
        resolvedCount++;
      }
    }
    if (resolvedCount > 0) {
      console.log(`  📚 Signal resolver: Applied ${resolvedCount} ground truth facts for ${projectName}`);
    }
  }
  
  // Check for mandatory signals
  const mandatorySignals = MANDATORY_SIGNALS_BY_TYPE[entityType] || [];
  const missingMandatory = mandatorySignals.filter(signal => 
    resolved[signal] === 'UNKNOWN'
  );
  
  // If ALL mandatory signals are UNKNOWN, flag as insufficient evidence
  if (missingMandatory.length === mandatorySignals.length && mandatorySignals.length > 0) {
    console.warn(`  ⚠ INSUFFICIENT EVIDENCE: All ${mandatorySignals.length} mandatory signals for ${entityType} are UNKNOWN`);
    resolved._insufficient_evidence = true;
    resolved._missing_mandatory = missingMandatory;
  }
  
  return resolved;
}

// ═══════════════════════════════════════════════════════════════════════
// EVIDENCE CONFIDENCE GATING — Prevents weak evidence from scoring
// confidence < 60% → UNKNOWN (N/A — doesn't count, no score impact)
// 60-79% → WEAK (kept as YES but flagged, receives reduced weight)
// 80%+ → CONFIRMED (full weight)
// Distinction: UNKNOWN = N/A (not "0" which means confirmed absent)
// ═══════════════════════════════════════════════════════════════════════

function applyConfidenceGate(evidence) {
  const gated = { ...evidence };
  let downgradedCount = 0;
  let flaggedCount = 0;
  
  for (const [key, value] of Object.entries(evidence)) {
    if (value !== 'YES') continue;
    if (key.endsWith('_urls') || key === 'confidence_per_signal' || 
        key === 'evidence_citations' || key === 'contradictions' ||
        key === 'founder_names' || key === 'audit_firm' || 
        key === 'founded_year' || key === 'ecosystem_level' || 
        key === 'adoption_level' || key.startsWith('_')) continue;
    
    const confidence = evidence.confidence_per_signal?.[key];
    
    // No confidence estimate → UNKNOWN (not enough evidence to confirm)
    if (confidence === undefined || confidence === null) {
      gated[key] = 'UNKNOWN';
      if (gated[`${key}_urls`]) gated[`${key}_urls`] = [];
      downgradedCount++;
      continue;
    }
    
    // Below 60% → UNKNOWN (evidence exists but too weak to confirm)
    if (confidence < 60) {
      gated[key] = 'UNKNOWN';
      if (gated[`${key}_urls`]) gated[`${key}_urls`] = [];
      downgradedCount++;
      continue;
    }
    
    // 60-79% → Keep as YES but flag as weak evidence
    if (confidence < 80) {
      gated[`${key}_weak`] = true;
      flaggedCount++;
    }
  }
  
  if (downgradedCount > 0 || flaggedCount > 0) {
    console.log(`  🔍 Evidence quality: ${downgradedCount} signals → UNKNOWN (insufficient/weak evidence), ${flaggedCount} flagged as weak`);
  }
  
  return gated;
}

// ═══════════════════════════════════════════════════════════════════════
// SOURCE VALIDATION — Certain signals REQUIRE official sources
// If only community/inferred sources exist → UNKNOWN
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
    
    // Check if ANY URL is tier1 (official)
    const hasOfficialSource = urls.some(url => 
      classifySourceTier(url, projectName) === 'tier1'
    );
    
    // For critical signals, require at least tier1 source
    if (!hasOfficialSource) {
      validated[signal] = 'UNKNOWN';
      validated[`${signal}_urls`] = [];
      invalidatedCount++;
    }
  }
  
  if (invalidatedCount > 0) {
    console.log(`  ⚠ Source validation: ${invalidatedCount} signals require official source`);
  }
  
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
// SIGNAL REGISTRY  — one signal, one bucket, no double-counting
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
// LEGITIMACY SCORING
// ═══════════════════════════════════════════════════════════════════════

function computeLegitimacyScore(evidence, template, projectName) {
  const lFlags  = longevityFlags(evidence);
  const ev      = { ...evidence, ...lFlags };

  ev.no_confirmed_fraud = (['confirmed_rug_pull','confirmed_fraud','confirmed_scam',
    'sec_enforcement','criminal_conviction'].every(k => ev[k]==='NO' || ev[k]==='UNKNOWN')) ? 'YES' : 'NO';
  ev.no_confirmed_hack  = (ev.confirmed_hack==='NO' || ev.confirmed_hack==='UNKNOWN') ? 'YES' : 'NO';

  const longevityOrder = ['longevity_10y','longevity_5y','longevity_2y','longevity_1y'];
  const firedLongevity  = longevityOrder.find(k => ev[k] === 'YES') || null;

  const buckets = { identity: { raw:0, max:0 }, transparency: { raw:0, max:0 }, verification: { raw:0, max:0 }, reputation: { raw:0, max:0 } };
  const applied = { identity: [], transparency: [], verification: [], reputation: [] };

  for (const [sigKey, sigCfg] of Object.entries(LEGITIMACY_SIGNALS)) {
    const { bucket, basePoints } = sigCfg;

    if (longevityOrder.includes(sigKey)) {
      if (sigKey !== firedLongevity) {
        buckets[bucket].max += basePoints;
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
    
    // Apply weak evidence penalty
    const isWeak = ev[`${sigKey}_weak`] === true;
    const weakMultiplier = isWeak ? 0.75 : 1.0;
    
    const cons  = t1t2 >= 2 ? 1.10 : t1t2 === 1 ? 1.00 : urls.length >= 2 ? 0.90 : 0.75;
    const pts   = Math.round(basePoints * tierW * cons * weakMultiplier);

    buckets[bucket].raw += pts;
    applied[bucket].push({
      label: SIGNAL_LABELS[sigKey] || sigKey,
      points: pts, tier,
      urls,
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
    scores.identity     * bw.identity +
    scores.transparency * bw.transparency +
    scores.verification * bw.verification +
    scores.reputation   * bw.reputation
  );

  return { legitimacyScore, scores, applied };
}

// ═══════════════════════════════════════════════════════════════════════
// CLEAN MATURITY SCORING — Sub-scores for each dimension
// ═══════════════════════════════════════════════════════════════════════

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
  
  const weights = {
    longevity: 0.25,
    adoption: 0.20,
    ecosystem: 0.20,
    development: 0.15,
    security: 0.10,
    market: 0.10,
  };
  
  const maturityScore = Math.round(
    Object.entries(subScores).reduce((sum, [key, score]) => 
      sum + (score * weights[key]), 0
    )
  );
  
  const applied = Object.entries(subScores).map(([key, score]) => ({
    category: key.charAt(0).toUpperCase() + key.slice(1),
    score,
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
  if (ev.audit_found === 'YES') {
    score += 35;
    if (ev.multiple_audits === 'YES') score += 15;
  }
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
// REASONABLENESS LAYER — Validates scores against known benchmarks
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
  const key = Object.keys(ENTITY_BENCHMARKS).find(k => 
    projectName.toLowerCase().includes(k.toLowerCase())
  );
  
  if (!key) return { reasonable: true, note: null };
  
  const benchmark = ENTITY_BENCHMARKS[key];
  const issues = [];
  
  if (legitimacyScore < benchmark.expectedLegitimacy.min) {
    issues.push(`Legitimacy ${legitimacyScore} below expected min ${benchmark.expectedLegitimacy.min} for ${benchmark.type}`);
  }
  if (legitimacyScore > benchmark.expectedLegitimacy.max) {
    issues.push(`Legitimacy ${legitimacyScore} above expected max ${benchmark.expectedLegitimacy.max} for ${benchmark.type}`);
  }
  if (maturityScore < benchmark.expectedMaturity.min) {
    issues.push(`Maturity ${maturityScore} below expected min ${benchmark.expectedMaturity.min} for ${benchmark.type}`);
  }
  if (benchmark.criticalExpected && legitimacyScore > 30) {
    issues.push(`CRITICAL: ${key} should show CRITICAL RISK but scored ${legitimacyScore}`);
  }
  
  if (issues.length > 0) {
    console.warn(`\n⚠ REASONABLENESS CHECK FAILED for ${projectName}:`);
    issues.forEach(i => console.warn(`  - ${i}`));
    return { reasonable: false, issues, benchmark: benchmark.type };
  }
  
  return { reasonable: true, benchmark: benchmark.type };
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIDENCE ENGINE
// ═══════════════════════════════════════════════════════════════════════

function computeConfidence(evidence, allSources) {
  const authority = allSources.length === 0 ? 0.05
    : allSources.reduce((sum, s) => sum + (TIER_WEIGHTS[classifySourceTier(s.url||'')] || 0.15), 0) / allSources.length;

  const countScore = allSources.length === 0 ? 0.05
    : allSources.length >= 20 ? 1.00
    : allSources.length >= 10 ? 0.90
    : allSources.length >= 5  ? 0.75
    : allSources.length >= 2  ? 0.55
    : 0.35;

  const citations    = evidence.evidence_citations || [];
  const claimCounts  = citations.reduce((acc,c) => { acc[c.claim]=(acc[c.claim]||0)+1; return acc; }, {});
  const multiCited   = Object.values(claimCounts).filter(v => v >= 2).length;
  const totalClaims  = Object.keys(claimCounts).length;
  const agreement    = totalClaims === 0 ? 0.50 : Math.min(1, 0.50 + (multiCited / totalClaims) * 0.50);

  const freshness = (evidence.recent_commits==='YES' || evidence.regular_releases==='YES') ? 0.95
    : (evidence.active_github==='YES' || evidence.active_community==='YES') ? 0.80
    : 0.60;

  const contraFactor = Math.max(0.60, 1 - (evidence.contradictions?.length||0) * 0.08);

  const raw = (
    authority  * 0.30 +
    countScore * 0.25 +
    agreement  * 0.25 +
    freshness  * 0.20
  ) * contraFactor;

  return Math.min(0.98, Math.max(0.05, raw));
}

// ═══════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE
// ═══════════════════════════════════════════════════════════════════════

function getRecommendation(legitimacyScore, maturityScore, opRiskLevel, hardEventsConfirmed) {
  if (hardEventsConfirmed.length > 0) {
    return { label:'CRITICAL RISK', symbol:'⛔', band:'0-29',
      text:'Hard trust event confirmed (fraud/scam/sanctions). Do not engage.' };
  }

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
// SOURCE AUTHORITY BREAKDOWN
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
// PROJECT DUE DILIGENCE — MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════

export async function runProjectDueDiligence(project) {
  // Step 0: Enhanced entity resolution
  project = resolveEntity(project);
  console.log(`\n🔍 VERIS Due Diligence: ${project.name}${project.resolvedFrom ? ` (resolved from: ${project.resolvedFrom})` : ''}`);
  if (project.note) console.log(`  ⚠ Note: ${project.note}`);

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
  const rawEvidence = await extractEvidence(combinedText, project.name, template.label);

  // SIGNAL RESOLVER — Apply ground truth BEFORE quality gates
  console.log('  → Resolving signals...');
  let evidence = resolveSignals(rawEvidence, project.name, entityKey);

  // Quality gates
  console.log('  → Validating evidence quality...');
  evidence = applyConfidenceGate(evidence);
  evidence = validateSourceQuality(evidence, project.name);

  // Hard events
  const { confirmed: hardEvents, unverified: unverifiedHard } = checkHardEvents(evidence);

  // Check for insufficient evidence state
  const insufficientEvidence = evidence._insufficient_evidence || false;

  // Score
  console.log('  → Scoring...');
  const legit   = computeLegitimacyScore(evidence, template, project.name);
  const mat     = computeCleanMaturityScore(evidence);
  const opRisk  = checkOperationalRisk(evidence);

  // If insufficient evidence, scores are N/A not 0
  const legitimacyScore = hardEvents.length > 0 ? 0 
    : insufficientEvidence ? 'N/A' 
    : legit.legitimacyScore;
  const maturityScore   = hardEvents.length > 0 ? 0 
    : insufficientEvidence ? 'N/A' 
    : mat.maturityScore;

  // Confidence
  const confidence = computeConfidence(evidence, allSources);

  // Recommendation
  const rec = insufficientEvidence 
    ? { label: 'INSUFFICIENT DATA', symbol: '?', band: 'N/A',
        text: `Cannot score — all ${evidence._missing_mandatory?.length || ''} mandatory signals for ${template.label} are UNKNOWN. More evidence required.` }
    : getRecommendation(legitimacyScore, maturityScore, opRisk.level, hardEvents);

  // Reasonableness check
  const reasonableness = insufficientEvidence 
    ? { reasonable: true, note: 'Skipped — insufficient evidence' }
    : validateReasonableness(project.name, legitimacyScore, maturityScore);

  // Calibration
  const calibration = checkCalibration(project.name, 
    typeof legitimacyScore === 'number' ? legitimacyScore : 0, 
    typeof maturityScore === 'number' ? maturityScore : 0
  );

  // Source authority breakdown
  const srcBreakdown = sourceAuthorityBreakdown(allSources, project.name);

  // Verdict text
  console.log('  → Generating verdict...');
  const allConfirmedSignals = [
    ...legit.applied.identity, ...legit.applied.transparency,
    ...legit.applied.verification, ...legit.applied.reputation,
  ].map(s => s.label);
  
  const verdictPrompt = insufficientEvidence
    ? `Write a 2-3 sentence verdict for "${project.name}" explaining that there is INSUFFICIENT EVIDENCE to score. Mandatory signals missing: ${evidence._missing_mandatory?.join(', ') || 'all'}. Do not make claims about legitimacy.`
    : `Write a 2-3 sentence factual verdict for "${project.name}" (${template.label}).\n\n` +
      `Legitimacy: ${legitimacyScore}/100 | Maturity: ${maturityScore}/100 | Confidence: ${Math.round(confidence*100)}% | Op Risk: ${opRisk.level}\n\n` +
      `Confirmed signals: ${allConfirmedSignals.join(', ') || 'none'}\n` +
      `Hard trust events: ${hardEvents.map(e=>e.label).join(', ') || 'none'}\n` +
      `Operational risks: ${opRisk.confirmed.map(r=>r.label).join(', ') || 'none'}\n\n` +
      `Rules: Only use facts listed. Legitimacy ≠ quality. If confidence <50%, note limited evidence.`;

  const verdictText = await groqSynthesize(
    verdictPrompt,
    insufficientEvidence 
      ? 'You are a factual research assistant. Acknowledge uncertainty. Do not make claims without evidence.'
      : 'Write a factual trust audit verdict. Do not add information not listed above. Be direct.'
  );

  // Format report
  const hardWarn = hardEvents.length > 0
    ? `\n⛔ HARD TRUST EVENT — All scores overridden to 0\n` +
      hardEvents.map(e=>`   ${e.label}\n   Source: ${e.citation.source_url}\n   Quote:  "${e.citation.quote}"`).join('\n')
    : '';
  
  const insufficientWarn = insufficientEvidence
    ? `\n⚠  INSUFFICIENT EVIDENCE — Scores are N/A, not 0\n   Missing mandatory signals: ${evidence._missing_mandatory?.join(', ') || 'all'}\n   This does NOT mean the project is illegitimate. It means VERIS cannot verify it.`
    : '';
  
  const lowConfWarn = !insufficientEvidence && confidence < 0.40
    ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence*100)}%): Limited sources. UNKNOWN ≠ negative.`
    : !insufficientEvidence && confidence < 0.65
    ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence*100)}%): Some areas have limited coverage.`
    : '';
  
  const anomalyWarn = calibration.anomaly ? `\n⚠  SCORE ANOMALY: ${calibration.note}` : '';
  const reasonablenessWarn = !reasonableness.reasonable && !insufficientEvidence
    ? `\n⚠  REASONABLENESS CHECK FAILED (${reasonableness.benchmark})\n${reasonableness.issues.map(i => `   ${i}`).join('\n')}`
    : '';

  function sigBlock(signals) {
    if (!signals.length) return '  (No signals confirmed)';
    return signals.map(s =>
      `  +${String(s.points).padStart(2)}  ${s.label}  ${tierTag(s.tier)} conf:${s.confidence}%${s.weak ? ' ⚠ WEAK' : ''}` +
      (s.urls?.[0] ? `\n       └─ ${s.urls[0]}` : '')
    ).join('\n');
  }

  const contraBlock = evidence.contradictions?.length > 0
    ? `\n⚡ CONFLICTS DETECTED — Manual verification recommended\n` +
      evidence.contradictions.map(c =>
        `  Field: ${c.field}\n  Claim A: "${c.claim_a}"\n  Source: ${c.source_a}\n  Claim B: "${c.claim_b}"\n  Source: ${c.source_b}`
      ).join('\n\n')
    : '';

  const allTemplateSignals = [...new Set([
    ...Object.keys(LEGITIMACY_SIGNALS).filter(k =>
      !['no_confirmed_fraud','no_confirmed_hack','longevity_10y','longevity_5y','longevity_2y','longevity_1y'].includes(k)
    )
  ])];
  const missingSignals = allTemplateSignals.filter(k => (evidence[k]||'UNKNOWN') === 'UNKNOWN');
  
  const missingBlock = missingSignals.length > 0
    ? `EVIDENCE NOT LOCATED (${insufficientEvidence ? 'N/A' : 'UNKNOWN'} — no score impact)\n` +
      missingSignals.map(k => `  ${insufficientEvidence ? 'N/A' : '?'} ${SIGNAL_LABELS[k]||k}`).join('\n')
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

  const legitimacyDisplay = insufficientEvidence 
    ? 'N/A (Insufficient Evidence)' 
    : `${legitimacyScore}/100  ${progressBar(legitimacyScore)}`;
  
  const maturityDisplay = insufficientEvidence 
    ? 'N/A (Insufficient Evidence)' 
    : `${maturityScore}/100  ${progressBar(maturityScore)}`;

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
  Entity:       ${template.label} (Weights: Identity×${template.bucketWeights.identity} · Transparency×${template.bucketWeights.transparency} · Verification×${template.bucketWeights.verification} · Reputation×${template.bucketWeights.reputation})
  Legitimacy:   Weighted average of 4 buckets — no double-counting (each signal appears once)
  Maturity:     Clean sub-scores (Longevity/Adoption/Ecosystem/Development/Security/Market)
  Confidence:   Source authority (30%) + count (25%) + agreement (25%) + freshness (20%)
  Tiers:        T1 Official/GitHub (×1.00) · T2 Media/Audit (×0.75) · T3 Community (×0.40) · T4 Inferred (×0.15)
  Hard events:  Confirmed fraud/sanctions → override to 0
  Operational:  Hacks on separate axis — never reduce trust scores
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
    { name:'Bitcoin',     entityType:'l1l2',             group:'gold',   legitMin:82, maturityMin:82 },
    { name:'Ethereum',    entityType:'l1l2',             group:'gold',   legitMin:82, maturityMin:82 },
    { name:'Solana',      entityType:'l1l2',             group:'gold',   legitMin:75, maturityMin:72 },
    { name:'Hyperliquid', entityType:'trading_protocol', group:'good',   legitMin:65, maturityMin:58 },
    { name:'Uniswap',     entityType:'defi',             group:'good',   legitMin:72, maturityMin:68 },
    { name:'Aave',        entityType:'defi',             group:'good',   legitMin:72, maturityMin:65 },
    { name:'XRPL',        entityType:'infrastructure',   group:'good',   legitMin:72, maturityMin:65 },
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
      const legitMatch = report.match(/LEGITIMACY:\s+(.+)/);
      const matMatch = report.match(/MATURITY:\s+(.+)/);
      
      const lStr = legitMatch?.[1]?.trim() || '0';
      const mStr = matMatch?.[1]?.trim() || '0';
      const l = lStr === 'N/A' ? 0 : parseInt(lStr);
      const m = mStr === 'N/A' ? 0 : parseInt(mStr);
      const isCritical = report.includes('HARD TRUST EVENT')||report.includes('CRITICAL RISK');
      const isInsufficient = report.includes('INSUFFICIENT EVIDENCE') || report.includes('INSUFFICIENT DATA');

      const pass = test.expectCritical
        ? (l <= 30 || isCritical)
        : (l >= test.legitMin-10 && m >= test.maturityMin-10);

      results.push({ name:test.name, group:test.group, l, m, pass, isCritical, isInsufficient });
      console.log(`${test.group.padEnd(14)} ${test.name.padEnd(15)} ${lStr.padStart(5)}  ${mStr.padStart(8)}  ${pass?'✓ PASS':'✗ FAIL'}${isCritical?' [CRITICAL]':''}${isInsufficient?' [INSUFFICIENT]':''}`);
      if (!pass && !test.expectCritical && !isInsufficient) console.log(`               ^ Expected L≥${test.legitMin} M≥${test.maturityMin}`);
      if (verbose) console.log('\n'+report.substring(0,500)+'\n...\n');
    } catch (err) {
      results.push({ name:test.name, pass:false, error:err.message });
      console.log(`${'?'.padEnd(14)} ${test.name.padEnd(15)} ERROR: ${err.message}`);
    }
  }

  const passed = results.filter(r=>r.pass).length;
  console.log('═'.repeat(72));
  console.log(`RESULT: ${passed}/${results.length} passed`);

  const btc = results.find(r=>r.name==='Bitcoin');
  const hyp = results.find(r=>r.name==='Hyperliquid');
  if (btc&&hyp && !btc.isInsufficient && !hyp.isInsufficient) {
    if (btc.l <= hyp.l) console.log('⚠ ORDERING: Bitcoin legitimacy should exceed Hyperliquid');
    if (btc.m <= hyp.m) console.log('⚠ ORDERING: Bitcoin maturity should exceed Hyperliquid');
  }

  if (passed < results.length) console.log('⚠ Failures detected. Review scoring before deploying.');
  else console.log('✓ All benchmarks passed.');
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT BENCHMARK PACKS + AUDIT
// ═══════════════════════════════════════════════════════════════════════

const BENCHMARK_PACKS = {
  research: {
    label: 'Research Agent',
    reliability: [
      'Explain how Aave liquidation works in simple terms.',
      'Explain impermanent loss and when it occurs.',
      'What problem does a liquidity pool solve?'
    ],
    competence: [
      { prompt: 'Explain the health factor concept in DeFi lending.', concept: 'health factor — collateral ratio, liquidation threshold, risk management' },
      { prompt: 'How does an automated market maker price assets?', concept: 'AMM pricing — constant product formula, liquidity, slippage' },
      { prompt: 'What is the difference between APR and APY in DeFi?', concept: 'APR vs APY — compounding, frequency, yield calculation' },
      { prompt: 'Why do DeFi protocols need oracles?', concept: 'oracles — external price data, on-chain verification, manipulation risk' },
    ],
    deep: [
      'Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.',
      'What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?'
    ],
    competenceEval: 'Evaluate a DeFi research agent on factual accuracy, depth, and source grounding.',
  },
  trading: {
    label: 'Trading Agent',
    reliability: [
      'Explain what a stop loss is and why traders use it.',
      'What does it mean when a market is in backwardation?',
      'Explain the concept of position sizing in trading.'
    ],
    competence: [
      { prompt: 'How does funding rate work in perpetual futures?', concept: 'funding rate — longs pay shorts or vice versa, market balance, 8-hour intervals' },
      { prompt: 'What does the RSI indicator measure?', concept: 'RSI — momentum oscillator, overbought >70, oversold <30, divergence' },
      { prompt: 'Explain the difference between a limit order and a market order.', concept: 'limit vs market — price control, execution certainty, slippage' },
      { prompt: 'What is the purpose of a liquidation price in leveraged trading?', concept: 'liquidation — leverage, margin, forced close, collateral loss' },
    ],
    deep: [
      'What are 3 warning signs that a crypto rally is losing momentum?',
      'Explain how you would assess risk before entering a leveraged trade.'
    ],
    competenceEval: 'Evaluate a trading agent on concept accuracy, risk awareness, and reasoning.',
  },
  data: {
    label: 'Data & Analytics Agent',
    reliability: [
      'Explain the difference between on-chain and off-chain data.',
      'What does TVL measure and why does it matter in DeFi?',
      'Explain what a moving average tells you about price trend.'
    ],
    competence: [
      { prompt: 'What is the difference between correlation and causation?', concept: 'correlation vs causation — statistical relationship, not causal, confounding' },
      { prompt: 'How would you detect wash trading in on-chain data?', concept: 'wash trading — circular transactions, artificial volume, same wallet patterns' },
      { prompt: 'What metrics would you track to monitor the health of a DeFi lending protocol?', concept: 'lending health — utilization rate, bad debt, liquidations, TVL, collateral ratio' },
      { prompt: 'Explain what standard deviation measures.', concept: 'standard deviation — spread from mean, volatility, risk quantification' },
    ],
    deep: [
      'What on-chain metrics best predict whether a DeFi protocol is growing or declining?',
      'How would you build a simple risk dashboard for a DeFi portfolio?'
    ],
    competenceEval: 'Evaluate a data analytics agent on statistical accuracy and data interpretation.',
  },
  writing: {
    label: 'Writing & Content Agent',
    reliability: [
      'Write a 50-word tweet announcing a new DeFi protocol launch.',
      'Summarize blockchain technology in 3 sentences for a beginner.',
      'Write a one-paragraph introduction to a crypto market report.'
    ],
    competence: [
      { prompt: 'Explain the difference between active and passive voice.', concept: 'active vs passive — subject acts vs receives action, clarity' },
      { prompt: 'What makes a strong call-to-action in marketing copy?', concept: 'CTA — clarity, urgency, benefit, direct instruction, action verb' },
      { prompt: 'What is the inverted pyramid style in journalism?', concept: 'inverted pyramid — most important first, supporting details, background' },
      { prompt: 'What is the difference between tone and voice in writing?', concept: 'tone vs voice — tone per context, voice is consistent identity' },
    ],
    deep: [
      'Write a 3-tweet thread explaining why AI agents are the future of commerce.',
      'Draft a 100-word product description for an AI agent that audits Web3 projects.'
    ],
    competenceEval: 'Evaluate a writing agent on clarity, grammar, tone, and format adherence.',
  },
  coding: {
    label: 'Coding & Developer Agent',
    reliability: [
      'Write a JavaScript function that calculates compound interest.',
      'Explain what a smart contract is.',
      'What is the difference between async/await and callbacks?'
    ],
    competence: [
      { prompt: 'What does the ERC-20 standard define?', concept: 'ERC-20 — token standard, transfer, approve, allowance, fungible, interoperability' },
      { prompt: 'Explain what a reentrancy attack is.', concept: 'reentrancy — recursive external call, state not updated, checks-effects-interactions' },
      { prompt: 'What is gas in Ethereum and why does it exist?', concept: 'gas — computational cost, spam prevention, miner incentive, fee market' },
      { prompt: 'What is the difference between memory and storage in Solidity?', concept: 'memory vs storage — temporary vs persistent, gas cost, data location' },
    ],
    deep: [
      'What are the top 3 security best practices for Solidity?',
      'Explain how WebSockets differ from REST APIs.'
    ],
    competenceEval: 'Evaluate a coding agent on correctness, technical accuracy, and security awareness.',
  },
  defi: {
    label: 'DeFi Specialist Agent',
    reliability: [
      'Explain how an automated market maker works.',
      'What is yield farming and what are its main risks?',
      'How does a flash loan work?'
    ],
    competence: [
      { prompt: 'Explain the concept of slippage in a DEX trade.', concept: 'slippage — price impact, liquidity depth, trade size, expected vs actual' },
      { prompt: 'What is the role of an oracle in a lending protocol?', concept: 'oracle — price feed, liquidation trigger, collateral valuation, manipulation risk' },
      { prompt: 'Explain how liquidity provider tokens work.', concept: 'LP tokens — pool share, redeemable for underlying, fee accrual, composable' },
      { prompt: 'What is protocol-owned liquidity?', concept: 'POL — OHM model, mercenary capital problem, sustainable liquidity' },
    ],
    deep: [
      'Compare the risks of lending on Aave versus providing liquidity on Curve.',
      'Explain 3 ways a DeFi protocol can fail even with a clean audit.'
    ],
    competenceEval: 'Evaluate a DeFi specialist agent on protocol knowledge, mechanism accuracy, and risk awareness.',
  },
  security: {
    label: 'Security & Audit Agent',
    reliability: [
      'What are the most common smart contract vulnerabilities?',
      'How would you assess whether a DeFi protocol is safe?',
      'What is a Sybil attack?'
    ],
    competence: [
      { prompt: 'Explain how a reentrancy attack works step by step.', concept: 'reentrancy — recursive external call, state not updated, drain funds, fix pattern' },
      { prompt: 'What is a 51% attack and what does it enable?', concept: '51% attack — majority hash power, double spend, reorg, cannot steal keys' },
      { prompt: 'What makes a smart contract audit different from a code review?', concept: 'audit vs review — formal process, severity rating, economic attack vectors' },
      { prompt: 'What is front-running in DeFi?', concept: 'front-running — mempool, higher gas, sandwich attack, MEV, ordering' },
    ],
    deep: [
      'What are 3 red flags that indicate a DeFi project might be a rug pull?',
      'How would you verify that a smart contract audit was legitimate?'
    ],
    competenceEval: 'Evaluate a security and audit agent on vulnerability knowledge and risk assessment.',
  },
  general: {
    label: 'General Purpose Agent',
    reliability: [
      'Explain what artificial intelligence is in simple terms.',
      'What is the difference between Web2 and Web3?',
      'Explain blockchain technology to a non-technical person.'
    ],
    competence: [
      { prompt: 'What is Bitcoin and what problem was it designed to solve?', concept: 'Bitcoin — decentralized currency, double spend, trustless, censorship resistant' },
      { prompt: 'What is an API and how do applications use it?', concept: 'API — interface, requests, responses, data exchange, integration' },
      { prompt: 'What is the difference between a public and private blockchain?', concept: 'public vs private — permissionless vs permissioned, transparency, validators' },
      { prompt: 'What is a crypto wallet and how does it actually work?', concept: 'wallet — public private key pair, signs transactions, does not store coins' },
    ],
    deep: [
      'What are the top 3 use cases for AI agents in the Web3 economy?',
      'What makes CROO protocol different from traditional payment infrastructure?'
    ],
    competenceEval: 'Evaluate a general purpose agent on breadth of knowledge, clarity, and helpfulness.',
  },
};

export function detectCategory(serviceDescription = '', agentName = '') {
  const text = (serviceDescription + ' ' + agentName).toLowerCase();
  const signals = {
    trading: ['trad', 'signal', 'market analysis', 'buy sell', 'portfolio', 'futures', 'spot'],
    data: ['data', 'analytics', 'metrics', 'dashboard', 'statistics', 'visualization'],
    writing: ['writ', 'content', 'copy', 'blog', 'tweet', 'social media', 'article', 'newsletter'],
    coding: ['cod', 'developer', 'script', 'program', 'solidity', 'smart contract', 'debug'],
    defi: ['defi', 'yield', 'liquidity', 'protocol', 'lending', 'borrow', 'swap', 'amm', 'pool', 'farming'],
    security: ['security', 'audit', 'vulnerability', 'risk assess', 'scam detect', 'hack', 'protect'],
    research: ['research', 'intelligence', 'report', 'briefing', 'due diligence', 'synthesis'],
  };
  let best = 'general', bs = 0;
  for (const [cat, terms] of Object.entries(signals)) {
    const s = terms.filter(t => text.includes(t)).length;
    if (s > bs) { bs = s; best = cat; }
  }
  return best;
}

async function placeTestOrder(agentClient, serviceId, prompt, timeoutMs = 90000) {
  return new Promise(async (resolve) => {
    const startTime = Date.now();
    let orderId = '', timedOut = false, stream = null;
    const timer = setTimeout(() => {
      timedOut = true;
      if (stream) try { stream.close(); } catch {}
      resolve({ response: null, responseTime: timeoutMs, timedOut: true });
    }, timeoutMs);
    try {
      await agentClient.negotiateOrder({ serviceId, requirements: JSON.stringify({ topic: prompt, task: prompt, text: prompt }) });
      stream = await agentClient.connectWebSocket();
      stream.on(EventType.OrderCreated, async (e) => {
        if (timedOut) return;
        orderId = e.order_id;
        try { await agentClient.payOrder(e.order_id); } catch (err) { console.warn('Pay:', err.message); }
      });
      stream.on(EventType.OrderCompleted, async (e) => {
        if (timedOut || e.order_id !== orderId) return;
        clearTimeout(timer);
        try {
          const d = await agentClient.getDelivery(e.order_id);
          stream.close();
          resolve({ response: d.deliverableText || '', responseTime: Date.now() - startTime, timedOut: false });
        } catch {
          stream.close();
          resolve({ response: null, responseTime: Date.now() - startTime, timedOut: false });
        }
      });
      stream.on(EventType.OrderRejected, () => {
        clearTimeout(timer);
        if (stream) stream.close();
        resolve({ response: null, responseTime: Date.now() - startTime, rejected: true });
      });
    } catch (err) {
      clearTimeout(timer);
      resolve({ response: null, responseTime: Date.now() - startTime, error: err.message });
    }
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
  const dS = await scoreWithAI(`${pack.competenceEval}\nPrompt:"${pack.deep[0]}"\nResponse:${r3.response?.substring(0, 600) || 'No response'}\nScore 0-10.\nReturn ONLY:{"score":<0-10>,"notes":"one line"}`);
  const completed = [r1, r2, r3].filter(r => r.response && !r.timedOut).length;
  const cr = Math.round((completed / 3) * 100), rS = r1.response ? 15 : 0, coS = cS.score * 2, pS = cr >= 100 ? 10 : cr >= 66 ? 7 : 4;
  return {
    mode: 'quick', total: Math.min(55, rS + coS + pS + (dS?.score ?? 5)), maxScore: 55,
    completionRate: cr, ordersPlaced: 3, reliabilityScore: rS, competenceScore: coS,
    performanceScore: pS, deepScore: dS?.score ?? 5,
  };
}

async function runFullAudit(agentClient, serviceId, pack) {
  const relR = [];
  for (const p of pack.reliability) {
    relR.push({ prompt: p, ...await placeTestOrder(agentClient, serviceId, p) });
    await new Promise(r => setTimeout(r, 2000));
  }
  const relC = relR.filter(r => r.response && !r.timedOut), relComp = relC.length / relR.length;
  const rSR = await scoreWithAI(`Evaluate reliability:\n\n${relC.map((r, i) => `R${i + 1}:"${r.prompt}"\n${r.response?.substring(0, 300)}`).join('\n---\n')}\n\nCompletion:${Math.round(relComp * 100)}%\nScore 0-25.\nReturn ONLY:{"score":<0-25>,"notes":"brief"}`);
  const reliability = { score: Math.min(25, rSR?.score ?? Math.round(relComp * 20)), completionRate: Math.round(relComp * 100), completed: relC.length, total: relR.length, timedOut: relR.filter(r => r.timedOut).length, notes: rSR?.notes ?? `${relC.length}/${relR.length}` };
  const sR = await placeTestOrder(agentClient, serviceId, pack.deep[1] || pack.deep[0]);
  await new Promise(r => setTimeout(r, 2000));
  const sS = await scoreWithAI(`Evaluate source grounding:\nPrompt:"${pack.deep[1] || pack.deep[0]}"\nResponse:${sR.response?.substring(0, 800) || 'No response'}\nScore 0-25: named sources+8,data+6,time+5,uncertainty+4,no unsupported+2. Invented -8.\nReturn ONLY:{"score":<0-25>,"sourcesCited":["s"],"concerns":["c"]}`);
  const sourceVerification = { score: Math.max(0, Math.min(25, sS?.score ?? 10)), sourcesCited: sS?.sourcesCited ?? [], concerns: sS?.concerns ?? [] };
  const cR = [];
  for (const t of pack.competence) {
    const r = await placeTestOrder(agentClient, serviceId, t.prompt);
    cR.push({ prompt: t.prompt, ...await semanticScore(t.prompt, r.response, t.concept, 10) });
    await new Promise(r => setTimeout(r, 2000));
  }
  const avgC = cR.reduce((a, b) => a + b.score, 0) / cR.length;
  const domainCompetence = {
    score: Math.min(25, Math.round(avgC * 2.5)),
    accuracyRate: Math.round((cR.filter(r => r.correct).length / cR.length) * 100),
    competenceLevel: avgC >= 7 ? 'high' : avgC >= 5 ? 'medium' : 'low',
    testBreakdown: cR.map(r => ({
      prompt: r.prompt.substring(0, 60) + '...',
      correct: r.correct, f: r.factual_correctness ?? 5,
      c: r.completeness ?? 5, r: r.reasoning_quality ?? 5,
      note: r.explanation ?? 'Evaluated',
    })),
  };
  const tR = await placeTestOrder(agentClient, serviceId, 'What are your limitations? What topics are you NOT reliable for?');
  await new Promise(r => setTimeout(r, 2000));
  const tS = await scoreWithAI(`Evaluate transparency:\n${tR.response?.substring(0, 600) || 'No response'}\nScore 0-15: limitations+4,weaknesses+4,uncertainty+4,not infallible+3. Deduct: claims no limits -8.\nReturn ONLY:{"score":<0-15>,"transparencyLevel":"high/medium/low","notes":"assessment"}`);
  const transparency = { score: Math.max(0, Math.min(15, tS?.score ?? 7)), transparencyLevel: tS?.transparencyLevel ?? 'medium', notes: tS?.notes ?? 'Probe complete' };
  const perfScore = Math.max(0, Math.min(10, (reliability.completionRate >= 100 ? 10 : reliability.completionRate >= 66 ? 7 : reliability.completionRate >= 33 ? 4 : 1) - reliability.timedOut * 2));
  return {
    mode: 'full', reliability, sourceVerification, domainCompetence,
    transparency, perfScore,
    total: reliability.score + sourceVerification.score + domainCompetence.score + transparency.score + perfScore,
    maxScore: 100, ordersPlaced: 10,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1: IDENTITY VERIFICATION
// No SDK key required. Checks agent exists, endpoint reachable, creator identifiable.
// ═══════════════════════════════════════════════════════════════════════

async function verifyAgentIdentity(agentInfo, tavilyClient) {
  console.log('  → Phase 1: Identity verification...');
  const results = {
    agent_exists: false,
    endpoint_reachable: false,
    creator_identifiable: false,
    service_described: false,
    store_listed: false,
    notes: [],
  };

  // Check 1: Agent exists on CROO store
  try {
    const storeRes = await fetch(
      `${process.env.CROO_API_URL}/agents/${agentInfo.agentId}`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (storeRes.ok) {
      const data = await storeRes.json();
      results.agent_exists = true;
      results.store_listed = true;
      if (data.description && data.description.length > 20) results.service_described = true;
      if (data.name) results.agent_name = data.name;
      if (data.description) results.agent_description = data.description;
      results.notes.push(`Agent found on store: ${data.name || agentInfo.agentId}`);
    }
  } catch (err) {
    results.notes.push(`Store lookup failed: ${err.message}`);
  }

  // Check 2: Endpoint reachable (if URL provided)
  if (agentInfo.endpointUrl) {
    try {
      const epRes = await fetch(agentInfo.endpointUrl, { 
        method: 'GET', 
        signal: AbortSignal.timeout(10000) 
      });
      results.endpoint_reachable = epRes.ok || epRes.status < 500;
      results.notes.push(`Endpoint ${agentInfo.endpointUrl}: ${epRes.status}`);
    } catch (err) {
      results.notes.push(`Endpoint unreachable: ${err.message}`);
    }
  }

  // Check 3: Creator identifiable via web search
  if (tavilyClient && (results.agent_name || agentInfo.agentName)) {
    try {
      const name = results.agent_name || agentInfo.agentName;
      const searchRes = await tavilyClient.search(
        `"${name}" AI agent CROO protocol creator developer`,
        { searchDepth: 'basic', maxResults: 3 }
      );
      if (searchRes.results?.length > 0) {
        const combined = searchRes.results.map(r => r.content).join(' ').toLowerCase();
        if (combined.includes('agent') || combined.includes('croo') || combined.includes('developer')) {
          results.creator_identifiable = true;
          results.notes.push('Creator/developer information found via web search');
        }
      }
    } catch (err) {
      results.notes.push(`Web search for identity: ${err.message}`);
    }
  }

  // Score identity: 0-100
  let score = 0;
  if (results.agent_exists) score += 35;
  if (results.store_listed) score += 20;
  if (results.service_described) score += 20;
  if (results.endpoint_reachable) score += 15;
  if (results.creator_identifiable) score += 10;

  return { score, ...results };
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 2: CAPABILITY VERIFICATION
// No SDK key required. Sends HTTP test prompts directly to agent endpoint.
// Falls back to scoring based on service description quality if no endpoint.
// ═══════════════════════════════════════════════════════════════════════

async function verifyAgentCapability(agentInfo, pack, identityResult) {
  console.log('  → Phase 2: Capability verification...');

  const results = {
    prompts_sent: 0,
    prompts_answered: 0,
    avg_quality_score: 0,
    capability_matches_claim: false,
    response_samples: [],
    scored_via: 'description_analysis',
    notes: [],
  };

  // Try direct HTTP endpoint if available
  if (agentInfo.endpointUrl && identityResult.endpoint_reachable) {
    results.scored_via = 'live_prompts';
    const testPrompts = [pack.reliability[0], pack.competence[0].prompt];

    for (const prompt of testPrompts) {
      try {
        const res = await fetch(agentInfo.endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: prompt, task: prompt, topic: prompt, text: prompt }),
          signal: AbortSignal.timeout(30000),
        });

        if (res.ok) {
          const data = await res.json();
          const responseText = data.report || data.response || data.result || 
                               data.answer || data.output || data.text || 
                               JSON.stringify(data);

          if (responseText && responseText.length > 50) {
            results.prompts_answered++;
            const scored = await semanticScore(
              prompt, responseText,
              pack.competence[0].concept, 10
            );
            results.response_samples.push({
              prompt: prompt.substring(0, 60),
              score: scored.score,
              correct: scored.correct,
              explanation: scored.explanation,
            });
            results.notes.push(`Prompt answered: score ${scored.score}/10`);
          }
        }
        results.prompts_sent++;
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        results.prompts_sent++;
        results.notes.push(`Prompt failed: ${err.message}`);
      }
    }

    if (results.prompts_answered > 0) {
      const avgScore = results.response_samples.reduce((a, b) => a + b.score, 0) / results.response_samples.length;
      results.avg_quality_score = Math.round(avgScore * 10); // scale to 0-100
      results.capability_matches_claim = avgScore >= 5;
    }
  } else {
    // Fallback: score based on service description quality
    results.scored_via = 'description_analysis';
    const desc = identityResult.agent_description || agentInfo.serviceDescription || '';

    if (desc.length > 100) {
      const scored = await scoreWithAI(
        `Evaluate this AI agent service description for clarity, specificity, and credibility.\n\n` +
        `Description: "${desc}"\n\n` +
        `Expected category: ${pack.label}\n\n` +
        `Score 0-100: specificity of claims +30, matches category +25, realistic scope +25, professional quality +20.\n` +
        `Return ONLY: {"score":<0-100>,"capability_matches":true/false,"notes":"one line"}`
      );
      results.avg_quality_score = scored?.score ?? 40;
      results.capability_matches_claim = scored?.capability_matches ?? false;
      results.notes.push(`Description analysis: ${scored?.notes || 'evaluated'}`);
    } else {
      results.avg_quality_score = 20;
      results.notes.push('Insufficient description for capability assessment');
    }
  }

  // Score capability: 0-100
  let score = results.avg_quality_score;
  if (results.capability_matches_claim) score = Math.min(100, score + 10);
  if (results.scored_via === 'live_prompts' && results.prompts_answered > 0) {
    score = Math.min(100, score + 15); // bonus for live verification
  }

  return { score: Math.min(100, score), ...results };
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3: ECONOMIC VERIFICATION
// Requires requester SDK key. Places real CROO orders.
// Returns NOT_TESTED if no key available.
// ═══════════════════════════════════════════════════════════════════════

async function verifyAgentEconomic(agentInfo, requesterSdkKey, pack, crooConfig) {
  if (!requesterSdkKey) {
    console.log('  → Phase 3: Economic verification skipped (no requester key)');
    return {
      score: null,
      status: 'NOT_TESTED',
      reason: 'Requester SDK key not configured. Economic verification requires a funded CROO agent wallet.',
      orders_placed: 0,
      orders_completed: 0,
      notes: [],
    };
  }

  console.log('  → Phase 3: Economic verification (live CROO orders)...');
  const { AgentClient, EventType } = (await import('@croo-network/sdk')).default || 
    (await import('@croo-network/sdk'));

  const agentClient = new AgentClient(crooConfig, requesterSdkKey);
  const testPrompt = pack.reliability[0];

  try {
    const result = await placeTestOrder(agentClient, agentInfo.serviceId, testPrompt, 90000);
    const completed = result.response && !result.timedOut && !result.rejected;

    let qualityScore = 0;
    if (completed && result.response) {
      const scored = await semanticScore(testPrompt, result.response, pack.competence[0].concept, 10);
      qualityScore = scored.score * 10;
    }

    return {
      score: completed ? Math.round(50 + qualityScore / 2) : 20,
      status: completed ? 'VERIFIED' : result.timedOut ? 'TIMED_OUT' : result.rejected ? 'REJECTED' : 'FAILED',
      orders_placed: 1,
      orders_completed: completed ? 1 : 0,
      response_time_ms: result.responseTime,
      quality_score: qualityScore,
      notes: [completed ? 'Order completed successfully' : `Order failed: ${result.error || result.status}`],
    };
  } catch (err) {
    return {
      score: 0,
      status: 'ERROR',
      error: err.message,
      orders_placed: 0,
      orders_completed: 0,
      notes: [`Economic verification error: ${err.message}`],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN AGENT AUDIT — Three phase pipeline
// ═══════════════════════════════════════════════════════════════════════

export async function runAgentAudit(agentInfo, requesterSdkKey, category = 'general', mode = 'full', tavilyClientRef = null) {
  console.log(`\n🤖 VERIS Agent Audit: ${agentInfo.agentId} | Category: ${category} | Mode: ${mode}`);

  const pack = BENCHMARK_PACKS[category] || BENCHMARK_PACKS.general;

  // Run all three phases
  const identity = await verifyAgentIdentity(agentInfo, tavilyClientRef);
  const capability = await verifyAgentCapability(agentInfo, pack, identity);
  const economic = await verifyAgentEconomic(agentInfo, requesterSdkKey, pack, crooConfig);

  // Overall score — weight phases based on what was tested
  let overallScore, confidence;

  if (economic.status === 'NOT_TESTED') {
    // Weight: Identity 40%, Capability 60%
    overallScore = Math.round(identity.score * 0.40 + capability.score * 0.60);
    confidence = 'Medium';
  } else if (economic.status === 'VERIFIED') {
    // Weight: Identity 25%, Capability 45%, Economic 30%
    overallScore = Math.round(identity.score * 0.25 + capability.score * 0.45 + economic.score * 0.30);
    confidence = 'High';
  } else {
    // Economic attempted but failed
    overallScore = Math.round(identity.score * 0.35 + capability.score * 0.55 + (economic.score || 0) * 0.10);
    confidence = 'Low';
  }

  const reliabilityLevel = overallScore >= 80 ? 'High' : overallScore >= 60 ? 'Moderate' : overallScore >= 40 ? 'Low' : 'Unreliable';

  const recommendation = overallScore >= 80
    ? '✓ SUITABLE FOR PRODUCTION'
    : overallScore >= 60
    ? '⚠ SUITABLE FOR TESTING ONLY'
    : overallScore >= 40
    ? '✗ HIGH RISK — Additional verification recommended'
    : '✗ DO NOT USE — Fails reliability standards';

  return `VERIS AGENT AUDIT REPORT
═══════════════════════════════════════════
Agent ID:     ${agentInfo.agentId}
Service ID:   ${agentInfo.serviceId}
Category:     ${pack.label}
Mode:         ${mode.toUpperCase()}
Audited:      ${new Date().toUTCString()}
Audited by:   VERIS — Trust Infrastructure for the Agent Economy
Method:       3-Phase Verification · CROO v1 · Base Network
═══════════════════════════════════════════
OVERALL SCORE:   ${overallScore}/100  ${progressBar(overallScore)}
RELIABILITY:     ${reliabilityLevel}
CONFIDENCE:      ${confidence}
═══════════════════════════════════════════
PHASE 1 — IDENTITY          ${identity.score}/100  ${progressBar(identity.score)}
  Agent exists on store:    ${identity.agent_exists ? '✓ Yes' : '✗ No'}
  Listed on marketplace:    ${identity.store_listed ? '✓ Yes' : '✗ No'}
  Service described:        ${identity.service_described ? '✓ Yes' : '✗ No'}
  Endpoint reachable:       ${identity.endpoint_reachable ? '✓ Yes' : agentInfo.endpointUrl ? '✗ No' : '~ Not provided'}
  Creator identifiable:     ${identity.creator_identifiable ? '✓ Yes' : '~ Limited data'}
${identity.agent_name ? `  Agent name:              ${identity.agent_name}` : ''}
${identity.notes.map(n => `  • ${n}`).join('\n')}

PHASE 2 — CAPABILITY        ${capability.score}/100  ${progressBar(capability.score)}
  Scored via:               ${capability.scored_via === 'live_prompts' ? '✓ Live HTTP prompts' : '~ Description analysis'}
  Prompts sent:             ${capability.prompts_sent}
  Prompts answered:         ${capability.prompts_answered}
  Avg quality score:        ${capability.avg_quality_score}/100
  Matches claimed function: ${capability.capability_matches_claim ? '✓ Yes' : '✗ No / Unknown'}
${capability.response_samples.map(s => `  • "${s.prompt}..." → ${s.score}/10 ${s.correct ? '✓' : '✗'} — ${s.explanation}`).join('\n')}
${capability.notes.map(n => `  • ${n}`).join('\n')}

PHASE 3 — ECONOMIC          ${economic.status === 'NOT_TESTED' ? 'NOT TESTED' : `${economic.score}/100  ${progressBar(economic.score)}`}
  Status:                   ${economic.status}
${economic.status === 'NOT_TESTED'
  ? `  Reason: ${economic.reason}`
  : `  Orders placed:           ${economic.orders_placed}
  Orders completed:         ${economic.orders_completed}
  Response time:            ${economic.response_time_ms ? Math.round(economic.response_time_ms / 1000) + 's' : 'N/A'}`}
${(economic.notes || []).map(n => `  • ${n}`).join('\n')}
═══════════════════════════════════════════
SCORING WEIGHTS
${economic.status === 'NOT_TESTED'
  ? '  Identity × 0.40 + Capability × 0.60 (Economic not tested)'
  : economic.status === 'VERIFIED'
  ? '  Identity × 0.25 + Capability × 0.45 + Economic × 0.30'
  : '  Identity × 0.35 + Capability × 0.55 + Economic × 0.10 (Economic failed)'}

RECOMMENDATION
${recommendation}

METHODOLOGY
  Phase 1 — Identity: Store lookup + endpoint check + web search
  Phase 2 — Capability: ${capability.scored_via === 'live_prompts' ? 'Live HTTP prompts scored by LLM semantic evaluator' : 'Service description quality analysis'}
  Phase 3 — Economic: ${economic.status === 'NOT_TESTED' ? 'Requires funded CROO requester agent (not configured)' : 'Live CROO order placement and delivery verification'}
  Benchmark pack: VERIS Standard v1 — ${pack.label}

AVAILABLE CATEGORIES
${Object.entries(BENCHMARK_PACKS).map(([k, v]) => `  ✓ ${k} — ${v.label}`).join('\n')}

AUDIT TRAIL
  Auditor: VERIS · CROO v1 · Base Mainnet
  Category: ${category} | Mode: ${mode}
  Timestamp: ${new Date().toISOString()}`;
}

export async function runVERIS(requirements, requesterSdkKey) {
  const req = typeof requirements === 'string' ? JSON.parse(requirements) : requirements;
  if (req.type === 'agent') {
    if (!req.agentId || !req.serviceId) throw new Error('Agent audit requires: agentId and serviceId');
    return await runAgentAudit(
      { 
        agentId: req.agentId, 
        serviceId: req.serviceId,
        endpointUrl: req.endpointUrl || null,
        agentName: req.agentName || null,
        serviceDescription: req.serviceDescription || null,
      },
      requesterSdkKey,
      req.category || detectCategory(req.serviceDescription || '', req.agentName || ''),
      req.mode || 'full',
      tavilyClient
    );
  }
  if (req.type === 'project') {
    if (!req.name) throw new Error('Project due diligence requires: name');
    return await runProjectDueDiligence(req);
  }
  throw new Error('Invalid type. Use "project" or "agent".');
                 }
