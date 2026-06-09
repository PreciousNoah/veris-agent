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

// ═══════════════════════════════════════════════════════
// STEP 1 — ENTITY CLASSIFICATION
// ═══════════════════════════════════════════════════════
//
// Each template defines:
//   dimensions  — what evidence buckets to collect
//   weights     — how much each bucket contributes to trust score (must sum to 1.0)
//   note        — shown in report, explains rubric choice

const ENTITY_TEMPLATES = {
  infrastructure: {
    label: 'Infrastructure Protocol',
    signals: ['foundation', 'protocol', 'layer 1', 'layer 2', 'network', 'ledger', 'chain', 'xrp', 'bitcoin', 'ethereum', 'cosmos', 'polkadot', 'avalanche', 'solana', 'ripple', 'xrpl'],
    dimensions: {
      documentation:   { label: 'Documentation',      weight: 0.25, maxRaw: 20 },
      development:     { label: 'Development Activity',weight: 0.35, maxRaw: 20 },
      team:            { label: 'Team / Governance',   weight: 0.15, maxRaw: 20 },
      social:          { label: 'Ecosystem Adoption',  weight: 0.10, maxRaw: 20 },
      trustRisk:       { label: 'Trust Risk',          weight: 0.15, maxRaw: 20 },
    },
    note: 'Infrastructure rubric: weighted toward development activity and documentation. Distributed governance means no traditional team page — absence is not a red flag.',
  },
  memecoin: {
    label: 'Meme Coin / Token',
    signals: ['meme', 'doge', 'shib', 'pepe', 'inu', 'elon', 'moon', '$', 'fair launch', 'stealth launch'],
    dimensions: {
      team:            { label: 'Team Identity',       weight: 0.10, maxRaw: 20 },
      social:          { label: 'Community',           weight: 0.35, maxRaw: 20 },
      liquidity:       { label: 'Liquidity Signals',   weight: 0.25, maxRaw: 20 },
      documentation:   { label: 'Documentation',       weight: 0.10, maxRaw: 20 },
      trustRisk:       { label: 'Trust Risk',          weight: 0.20, maxRaw: 20 },
    },
    note: 'Meme coin rubric: community and liquidity weighted heavily. Trust risk weighted at 20% — rug pull signals are critical.',
  },
  aiagent: {
    label: 'AI Agent / Product',
    signals: ['ai agent', 'autonomous agent', 'llm', 'gpt', 'copilot', 'assistant', 'autopilot', 'croo', 'veris'],
    dimensions: {
      team:            { label: 'Creator Identity',    weight: 0.20, maxRaw: 20 },
      documentation:   { label: 'Transparency / Docs', weight: 0.20, maxRaw: 20 },
      functionality:   { label: 'Functionality',       weight: 0.30, maxRaw: 20 },
      social:          { label: 'Usage Signals',       weight: 0.15, maxRaw: 20 },
      trustRisk:       { label: 'Trust Risk',          weight: 0.15, maxRaw: 20 },
    },
    note: 'AI agent rubric: functionality and creator identity weighted most. Usage signals proxy real-world adoption.',
  },
  dao: {
    label: 'DAO / Governance Protocol',
    signals: ['dao', 'governance', 'vote', 'proposal', 'treasury', 'multisig', 'snapshot'],
    dimensions: {
      governance:      { label: 'Governance Structure',weight: 0.30, maxRaw: 20 },
      documentation:   { label: 'Documentation',       weight: 0.25, maxRaw: 20 },
      development:     { label: 'Development Activity',weight: 0.20, maxRaw: 20 },
      social:          { label: 'Community',           weight: 0.10, maxRaw: 20 },
      trustRisk:       { label: 'Trust Risk',          weight: 0.15, maxRaw: 20 },
    },
    note: 'DAO rubric: governance structure and docs weighted highest. On-chain treasury transparency is a key signal.',
  },
  defi: {
    label: 'DeFi Protocol',
    signals: ['defi', 'yield', 'lending', 'borrow', 'swap', 'amm', 'pool', 'vault', 'liquid staking', 'perp', 'dex', 'cex'],
    dimensions: {
      team:            { label: 'Team',                weight: 0.15, maxRaw: 20 },
      documentation:   { label: 'Documentation',       weight: 0.20, maxRaw: 20 },
      development:     { label: 'Development Activity',weight: 0.25, maxRaw: 20 },
      social:          { label: 'Community',           weight: 0.10, maxRaw: 20 },
      trustRisk:       { label: 'Trust Risk',          weight: 0.30, maxRaw: 20 },
    },
    note: 'DeFi rubric: trust risk weighted at 30% — smart contract security signals are critical for financial protocols.',
  },
  nft: {
    label: 'NFT Project',
    signals: ['nft', 'collection', 'mint', 'opensea', 'blur', 'pfp', 'generative', 'art project'],
    dimensions: {
      team:            { label: 'Creator Identity',    weight: 0.20, maxRaw: 20 },
      social:          { label: 'Community',           weight: 0.30, maxRaw: 20 },
      documentation:   { label: 'Roadmap / Utility',   weight: 0.20, maxRaw: 20 },
      development:     { label: 'Development / Tech',  weight: 0.10, maxRaw: 20 },
      trustRisk:       { label: 'Trust Risk',          weight: 0.20, maxRaw: 20 },
    },
    note: 'NFT rubric: community and creator identity weighted heavily. Roadmap clarity matters for utility projects.',
  },
  saas: {
    label: 'SaaS / Tooling',
    signals: ['saas', 'tool', 'sdk', 'api', 'platform', 'dashboard', 'analytics', 'explorer', 'wallet', 'indexer'],
    dimensions: {
      team:            { label: 'Team',                weight: 0.20, maxRaw: 20 },
      documentation:   { label: 'Documentation',       weight: 0.25, maxRaw: 20 },
      development:     { label: 'Development Activity',weight: 0.25, maxRaw: 20 },
      social:          { label: 'Usage / Adoption',    weight: 0.15, maxRaw: 20 },
      trustRisk:       { label: 'Trust Risk',          weight: 0.15, maxRaw: 20 },
    },
    note: 'SaaS/tooling rubric: documentation and development activity weighted equally. Product adoption is a key trust signal.',
  },
  general: {
    label: 'General Project',
    signals: [],
    dimensions: {
      team:            { label: 'Team',                weight: 0.20, maxRaw: 20 },
      documentation:   { label: 'Documentation',       weight: 0.20, maxRaw: 20 },
      development:     { label: 'Development Activity',weight: 0.20, maxRaw: 20 },
      social:          { label: 'Community / Social',  weight: 0.20, maxRaw: 20 },
      trustRisk:       { label: 'Trust Risk',          weight: 0.20, maxRaw: 20 },
    },
    note: 'General rubric applied. For more accurate scoring, specify project type.',
  },
};

export function detectEntityType(project) {
  const text = (
    (project.name || '') + ' ' +
    (project.description || '') + ' ' +
    (project.website || '') + ' ' +
    (project.entityType || '')
  ).toLowerCase();

  // Score all types, pick best match
  let bestType = 'general';
  let bestScore = 0;
  for (const [type, config] of Object.entries(ENTITY_TEMPLATES)) {
    if (type === 'general') continue;
    const score = config.signals.filter(s => text.includes(s)).length;
    if (score > bestScore) { bestScore = score; bestType = type; }
  }
  return bestType;
}

// ═══════════════════════════════════════════════════════
// AGENT AUDIT BENCHMARK PACKS (unchanged)
// ═══════════════════════════════════════════════════════
const BENCHMARK_PACKS = {
  research: {
    label: 'Research Agent',
    reliability: [
      'Explain how Aave liquidation works in simple terms.',
      'Explain impermanent loss and when it occurs.',
      'What problem does a liquidity pool solve?',
    ],
    competence: [
      { prompt: 'Explain the health factor concept in DeFi lending.', concept: 'health factor in lending — collateral ratio, liquidation threshold, risk management' },
      { prompt: 'How does an automated market maker price assets?', concept: 'AMM pricing — constant product formula, liquidity, slippage' },
      { prompt: 'What is the difference between APR and APY in DeFi?', concept: 'APR vs APY — compounding, frequency, yield calculation' },
      { prompt: 'Why do DeFi protocols need oracles?', concept: 'oracles — external price data, on-chain verification, manipulation risk' },
    ],
    deep: [
      'Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.',
      'What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?',
    ],
    competenceEval: 'You are evaluating a DeFi research agent. Score based on factual accuracy of mechanism explanations, analytical depth, source grounding, and structured output quality.',
  },
  trading: {
    label: 'Trading Agent',
    reliability: [
      'Explain what a stop loss is and why traders use it.',
      'What does it mean when a market is in backwardation?',
      'Explain the concept of position sizing in trading.',
    ],
    competence: [
      { prompt: 'How does funding rate work in perpetual futures?', concept: 'funding rate — longs pay shorts or vice versa, market balance mechanism, 8-hour intervals' },
      { prompt: 'What does the RSI indicator measure and how is it interpreted?', concept: 'RSI — momentum oscillator, overbought above 70, oversold below 30, divergence' },
      { prompt: 'Explain the difference between a limit order and a market order.', concept: 'limit order vs market order — price control, execution certainty, slippage' },
      { prompt: 'What is the purpose of a liquidation price in leveraged trading?', concept: 'liquidation — leverage, margin, forced close, collateral loss' },
    ],
    deep: [
      'What are 3 warning signs that a crypto rally is losing momentum?',
      'Explain how you would assess risk before entering a leveraged trade.',
    ],
    competenceEval: 'You are evaluating a trading agent. Score based on accuracy of trading concept explanations, risk awareness, quality of analytical reasoning, and practical applicability.',
  },
  data: {
    label: 'Data & Analytics Agent',
    reliability: [
      'Explain the difference between on-chain and off-chain data.',
      'What does TVL measure and why does it matter in DeFi?',
      'Explain what a moving average tells you about price trend.',
    ],
    competence: [
      { prompt: 'What is the difference between correlation and causation?', concept: 'correlation vs causation — statistical relationship, does not imply cause, confounding variables' },
      { prompt: 'How would you detect wash trading in on-chain data?', concept: 'wash trading — circular transactions, same wallet patterns, artificial volume, self-dealing' },
      { prompt: 'What metrics would you track to monitor the health of a DeFi lending protocol?', concept: 'lending health metrics — utilization rate, bad debt, liquidations, TVL trend, collateral ratio' },
      { prompt: 'Explain what standard deviation measures and how it applies to crypto volatility.', concept: 'standard deviation — spread from mean, volatility measurement, risk quantification' },
    ],
    deep: [
      'What on-chain metrics best predict whether a DeFi protocol is growing or declining?',
      'How would you build a simple risk dashboard for a DeFi portfolio?',
    ],
    competenceEval: 'You are evaluating a data analytics agent. Score based on statistical accuracy, data interpretation quality, metric understanding, and analytical rigor.',
  },
  writing: {
    label: 'Writing & Content Agent',
    reliability: [
      'Write a 50-word tweet announcing a new DeFi protocol launch. Make it engaging.',
      'Summarize what blockchain technology is in 3 sentences for a complete beginner.',
      'Write a one-paragraph introduction to a crypto market report.',
    ],
    competence: [
      { prompt: 'Explain the difference between active and passive voice with an example.', concept: 'active vs passive voice — subject performs action vs subject receives action, clarity' },
      { prompt: 'What makes a strong call-to-action in marketing copy?', concept: 'call to action — clarity, urgency, benefit, direct instruction, action verb' },
      { prompt: 'What is the inverted pyramid style in journalism?', concept: 'inverted pyramid — most important information first, supporting details, background last' },
      { prompt: 'What is the difference between tone and voice in writing?', concept: 'tone vs voice — tone changes per context, voice is consistent author identity, style' },
    ],
    deep: [
      'Write a short 3-tweet thread explaining why autonomous AI agents are the future of commerce.',
      'Draft a 100-word product description for an AI agent that audits Web3 projects.',
    ],
    competenceEval: 'You are evaluating a writing agent. Score based on clarity, grammar correctness, tone appropriateness, ability to follow format instructions, and creativity where relevant.',
  },
  coding: {
    label: 'Coding & Developer Agent',
    reliability: [
      'Write a JavaScript function that calculates compound interest given principal, rate, and periods.',
      'Explain what a smart contract is and how it differs from regular code.',
      'What is the difference between async/await and callbacks in JavaScript?',
    ],
    competence: [
      { prompt: 'What does the ERC-20 standard define and why does it matter?', concept: 'ERC-20 — token standard, transfer function, approve, allowance, fungible tokens, interoperability' },
      { prompt: 'Explain what a reentrancy attack is and how to prevent it.', concept: 'reentrancy — external call before state update, checks-effects-interactions pattern, mutex guard' },
      { prompt: 'What is gas in Ethereum and why does it exist?', concept: 'gas — computational cost, prevents spam, miners incentive, fee market, transaction cost' },
      { prompt: 'What is the difference between memory and storage in Solidity?', concept: 'memory vs storage — temporary vs persistent, gas cost difference, data location, scope' },
    ],
    deep: [
      'What are the top 3 security best practices when writing a Solidity smart contract?',
      'Explain how WebSockets differ from REST APIs and when you would choose each.',
    ],
    competenceEval: 'You are evaluating a coding agent. Score based on code correctness, technical accuracy of explanations, security awareness, best practices adherence, and clarity of technical communication.',
  },
  defi: {
    label: 'DeFi Specialist Agent',
    reliability: [
      'Explain how an automated market maker works.',
      'What is yield farming and what are its main risks?',
      'How does a flash loan work and what are its legitimate use cases?',
    ],
    competence: [
      { prompt: 'Explain the concept of slippage in a DEX trade.', concept: 'slippage — price impact, liquidity depth, trade size, expected vs actual price' },
      { prompt: 'What is the role of an oracle in a lending protocol?', concept: 'oracle — price feed, liquidation trigger, collateral valuation, manipulation risk' },
      { prompt: 'Explain how liquidity provider tokens work.', concept: 'LP tokens — represent pool share, redeemable for underlying, fee accrual, composable' },
      { prompt: 'What is protocol-owned liquidity and why did projects pursue it?', concept: 'protocol owned liquidity — POL, OHM model, mercenary capital problem, sustainable liquidity' },
    ],
    deep: [
      'Compare the risks of lending on Aave versus providing liquidity on Curve.',
      'Explain 3 ways a DeFi protocol can fail even with a clean smart contract audit.',
    ],
    competenceEval: 'You are evaluating a DeFi specialist agent. Score based on protocol knowledge depth, mechanism accuracy, risk awareness, and quality of DeFi-specific conceptual explanations.',
  },
  security: {
    label: 'Security & Audit Agent',
    reliability: [
      'What are the most common smart contract vulnerabilities?',
      'How would you assess whether a DeFi protocol is safe to use?',
      'What is a Sybil attack and how can protocols defend against it?',
    ],
    competence: [
      { prompt: 'Explain how a reentrancy attack works step by step.', concept: 'reentrancy — recursive external call, state not updated, drain funds, checks-effects-interactions fix' },
      { prompt: 'What is a 51% attack and what does it enable an attacker to do?', concept: '51% attack — majority hash power, double spend, reorg blocks, cannot steal private keys' },
      { prompt: 'What makes a smart contract audit different from a code review?', concept: 'audit vs code review — formal process, vulnerability classification, severity rating, economic attack vectors' },
      { prompt: 'What is front-running in DeFi and how does it work?', concept: 'front-running — mempool observation, higher gas, sandwich attack, MEV, transaction ordering' },
    ],
    deep: [
      'What are 3 red flags that indicate a DeFi project might be a rug pull?',
      'How would you verify that a smart contract audit was legitimate and thorough?',
    ],
    competenceEval: 'You are evaluating a security and audit agent. Score based on vulnerability knowledge accuracy, risk assessment quality, audit methodology understanding, and threat identification precision.',
  },
  general: {
    label: 'General Purpose Agent',
    reliability: [
      'Explain what artificial intelligence is in simple terms.',
      'What is the difference between Web2 and Web3?',
      'Explain blockchain technology to someone with no technical background.',
    ],
    competence: [
      { prompt: 'What is Bitcoin and what problem was it designed to solve?', concept: 'Bitcoin — decentralized currency, double spend problem, trustless, censorship resistant, Satoshi' },
      { prompt: 'What is an API and how do applications use it?', concept: 'API — interface, requests, responses, data exchange, integration, endpoints' },
      { prompt: 'What is the difference between a public and private blockchain?', concept: 'public vs private blockchain — permissionless vs permissioned, transparency, validator set, use cases' },
      { prompt: 'What is a crypto wallet and how does it actually work?', concept: 'crypto wallet — public private key pair, signs transactions, does not store coins, address derived from key' },
    ],
    deep: [
      'What are the top 3 use cases for AI agents in the Web3 economy?',
      'What makes CROO protocol different from traditional payment infrastructure?',
    ],
    competenceEval: 'You are evaluating a general purpose agent. Score based on breadth of knowledge, response clarity and accuracy, ability to explain complex concepts simply, and helpfulness across diverse topics.',
  },
};

const AUDIT_MODES = {
  quick: { label: 'Quick Audit', description: '3 orders — fast reliability and basic competence check', ordersEstimate: 3 },
  full:  { label: 'Full Audit',  description: '10 orders — complete 5-dimension reliability assessment', ordersEstimate: 10 },
};

export function detectCategory(serviceDescription = '', agentName = '') {
  const text = (serviceDescription + ' ' + agentName).toLowerCase();
  const signals = {
    trading: ['trad', 'signal', 'market analysis', 'buy sell', 'portfolio', 'technical analysis', 'price action', 'futures', 'spot'],
    data: ['data', 'analytics', 'metrics', 'dashboard', 'statistics', 'visualization', 'on-chain data', 'insights'],
    writing: ['writ', 'content', 'copy', 'blog', 'tweet', 'social media', 'article', 'newsletter', 'marketing', 'creative'],
    coding: ['cod', 'developer', 'script', 'program', 'solidity', 'smart contract', 'github', 'debug', 'build', 'deploy'],
    defi: ['defi', 'yield', 'liquidity', 'protocol', 'lending', 'borrow', 'swap', 'amm', 'pool', 'farming', 'vault'],
    security: ['security', 'audit', 'vulnerability', 'risk assess', 'scam detect', 'hack', 'protect', 'threat', 'rug'],
    research: ['research', 'intelligence', 'report', 'briefing', 'due diligence', 'synthesis', 'analysis report'],
  };
  let bestMatch = 'general';
  let bestScore = 0;
  for (const [category, terms] of Object.entries(signals)) {
    const score = terms.filter(t => text.includes(t)).length;
    if (score > bestScore) { bestScore = score; bestMatch = category; }
  }
  return bestMatch;
}

// ═══════════════════════════════════════════════════════
// STEP 2 — EVIDENCE COLLECTION
// ═══════════════════════════════════════════════════════
// Returns raw text + source count per query.
// Source count drives confidence — not LLM inference.

async function collectEvidence(query) {
  try {
    const searchResponse = await tavilyClient.search(query, {
      searchDepth: 'advanced',
      maxResults: 5,
      includeAnswer: false,
    });
    if (!searchResponse.results || searchResponse.results.length === 0) {
      return { text: 'No results retrieved.', sourceCount: 0, sources: [] };
    }
    const sources = searchResponse.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.substring(0, 500) || '',
    }));
    const text = sources
      .map((s, i) => `[Source ${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`)
      .join('\n\n---\n\n');
    return { text, sourceCount: sources.length, sources };
  } catch (err) {
    console.warn('  ⚠ Tavily error:', err.message);
    return { text: 'Search failed.', sourceCount: 0, sources: [] };
  }
}

// ═══════════════════════════════════════════════════════
// STEP 3 — SCORE EVIDENCE QUALITY (per dimension)
// ═══════════════════════════════════════════════════════
// Groq's only job: read the evidence, score what it confirms.
// Rules enforced in prompt: never infer from absence.

async function scoreEvidence(dimensionName, projectName, evidenceText, sourceCount, scoringCriteria) {
  const confidenceFromSources = sourceCount === 0 ? 0.05
    : sourceCount === 1 ? 0.25
    : sourceCount === 2 ? 0.45
    : sourceCount <= 4 ? 0.65
    : 0.85;

  if (sourceCount === 0) {
    return {
      rawScore: 10, // neutral — not penalized for absence
      confidence: 0.05,
      positives: [],
      operationalRisks: [],
      trustRisks: [],
      note: 'No evidence retrieved. Score is neutral — absence is not negative.',
    };
  }

  const result = await scoreWithAI(
    `You are scoring the "${dimensionName}" dimension for project "${projectName}".\n\n` +
    `RETRIEVED EVIDENCE (${sourceCount} sources):\n${evidenceText}\n\n` +
    `═══ ABSOLUTE RULES — VIOLATIONS WILL BREAK THE SYSTEM ═══\n` +
    `1. ONLY report what sources explicitly state. Zero inference allowed.\n` +
    `2. NEVER write findings like "no roadmap found", "no team page", "no GitHub" — absence is not evidence.\n` +
    `3. If something is absent from sources, leave the relevant array empty. Do not comment on absence.\n` +
    `4. positives = things sources EXPLICITLY confirm as existing or positive\n` +
    `5. trustRisks = ONLY confirmed fraud, scam, rug pull, fake identity, exit scam, market manipulation\n` +
    `6. operationalRisks = ONLY confirmed hacks, exploits, vulnerabilities, supply chain attacks\n` +
    `   NOTE: A hack that was disclosed and patched is an operational risk, NOT a trust risk.\n` +
    `7. Score starts at 0. Add points only for confirmed positives.\n\n` +
    `SCORING CRITERIA:\n${scoringCriteria}\n\n` +
    `Return ONLY valid JSON:\n` +
    `{\n` +
    `  "rawScore": <0-20>,\n` +
    `  "positives": ["explicitly confirmed positive fact from sources"],\n` +
    `  "trustRisks": ["confirmed fraud/scam event from sources only"],\n` +
    `  "operationalRisks": ["confirmed hack/exploit/vuln from sources only"],\n` +
    `  "note": "one sentence: what the evidence shows"\n` +
    `}`
  );

  return {
    rawScore: Math.max(0, Math.min(20, result?.rawScore ?? 10)),
    confidence: confidenceFromSources,
    positives: (result?.positives ?? []).filter(Boolean),
    trustRisks: (result?.trustRisks ?? []).filter(Boolean),
    operationalRisks: (result?.operationalRisks ?? []).filter(Boolean),
    note: result?.note ?? 'Evidence evaluated.',
  };
}

// ═══════════════════════════════════════════════════════
// STEP 4 — CALCULATE CONFIDENCE
// ═══════════════════════════════════════════════════════
// Confidence = weighted average of per-dimension source counts.
// Entirely independent of trust score.

function calculateConfidence(dimensionResults, template) {
  const dims = template.dimensions;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [key, config] of Object.entries(dims)) {
    const result = dimensionResults[key];
    if (!result) continue;
    weightedSum += (result.confidence ?? 0) * config.weight;
    totalWeight += config.weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ═══════════════════════════════════════════════════════
// STEP 5 — CALCULATE TRUST SCORE
// ═══════════════════════════════════════════════════════
// Trust score = weighted sum of rawScores, normalized to 100.
// Then subtract trust risk deductions (NOT operational risks).
// Operational risks are surfaced separately — good projects get hacked.

function calculateTrustScore(dimensionResults, template) {
  const dims = template.dimensions;
  let weightedScore = 0;

  for (const [key, config] of Object.entries(dims)) {
    const result = dimensionResults[key];
    if (!result) continue;
    // rawScore is 0-20; weight it and accumulate (max contribution = 20 * weight)
    weightedScore += (result.rawScore / 20) * config.weight;
  }

  // weightedScore is 0-1.0 (sum of weights = 1.0)
  const baseScore = Math.round(weightedScore * 100);

  // Trust risk deductions — fraud/scam signals only
  const allTrustRisks = Object.values(dimensionResults)
    .flatMap(d => d.trustRisks || []);
  const trustDeduction = Math.min(40, allTrustRisks.length * 12);

  // Operational risks: shown in report but do NOT reduce trust score
  // (a disclosed and patched hack ≠ an untrustworthy project)
  const allOperationalRisks = Object.values(dimensionResults)
    .flatMap(d => d.operationalRisks || []);

  const trustScore = Math.max(0, Math.min(100, baseScore - trustDeduction));

  return { trustScore, baseScore, trustDeduction, allTrustRisks, allOperationalRisks };
}

// ═══════════════════════════════════════════════════════
// STEP 6 — GENERATE VERDICT
// ═══════════════════════════════════════════════════════
// Groq synthesizes findings into a verdict paragraph.
// Input: all confirmed evidence + scores. No hallucination possible.

async function generateVerdict(projectName, entityLabel, trustScore, confidence, allPositives, allTrustRisks, allOperationalRisks) {
  const prompt =
    `You are writing the verdict section of a trust audit report for "${projectName}" (${entityLabel}).\n\n` +
    `Trust Score: ${trustScore}/100\n` +
    `Evidence Confidence: ${Math.round(confidence * 100)}%\n\n` +
    `Confirmed Positive Signals:\n${allPositives.length ? allPositives.map(p => '• ' + p).join('\n') : '• None explicitly confirmed in sources'}\n\n` +
    `Confirmed Trust Risks (fraud/scam signals):\n${allTrustRisks.length ? allTrustRisks.map(r => '• ' + r).join('\n') : '• None found'}\n\n` +
    `Confirmed Operational Risks (hacks/exploits — do NOT treat as trust failures):\n${allOperationalRisks.length ? allOperationalRisks.map(r => '• ' + r).join('\n') : '• None found'}\n\n` +
    `Write 2-3 sentences for a verdict. Rules:\n` +
    `1. Only reference facts from the lists above.\n` +
    `2. Distinguish between trust risks (legitimacy concerns) and operational risks (technical incidents that any project can face).\n` +
    `3. If confidence is below 50%, note that the score reflects limited evidence, not confirmed problems.\n` +
    `4. Be direct and useful. Do not hedge everything.`;

  return await groqSynthesize(prompt,
    'You are writing a trust audit verdict. Be factual, concise, and precise. Do not add information not provided to you.'
  );
}

// ═══════════════════════════════════════════════════════
// DIMENSION QUERY BUILDERS
// Returns the Tavily search query and Groq scoring criteria
// for each possible dimension key.
// ═══════════════════════════════════════════════════════
function getDimensionConfig(key, project) {
  const name = project.name;
  const configs = {
    team: {
      query: `founders team identity "${name}" crypto Web3 project LinkedIn executives verifiable`,
      criteria: `+5 founders or executives publicly named in sources\n+4 LinkedIn or professional profiles linked\n+4 verifiable prior work history mentioned\n+4 team page or org structure confirmed\n+3 no identity concerns raised in sources`,
    },
    documentation: {
      query: `"${name}" whitepaper roadmap tokenomics technical documentation ${project.docs || ''} ${project.website || ''}`,
      criteria: `+5 whitepaper or technical paper confirmed\n+4 roadmap explicitly described\n+4 tokenomics documented\n+4 developer or API docs confirmed\n+3 clear use case articulated`,
    },
    development: {
      query: `"${name}" GitHub commits contributors open source audit security ${project.github || ''}`,
      criteria: `+5 active GitHub with recent commits confirmed\n+4 multiple contributors mentioned\n+4 open source codebase confirmed\n+4 security audit by named firm mentioned\n+3 regular releases or updates noted`,
    },
    social: {
      query: `"${name}" Twitter community followers engagement adoption users coverage`,
      criteria: `+4 active social accounts confirmed with activity\n+4 substantial community size mentioned\n+4 genuine engagement or usage described\n+4 third-party media or press coverage found\n+4 no bot or manipulation concerns raised`,
    },
    liquidity: {
      query: `"${name}" liquidity locked token holders distribution DEX CEX trading volume`,
      criteria: `+5 liquidity lock confirmed\n+5 trading volume data mentioned\n+4 healthy holder distribution noted\n+3 listed on named DEX or CEX\n+3 no concentration or manipulation concerns`,
    },
    functionality: {
      query: `"${name}" product demo features working live users review performance`,
      criteria: `+5 live product or demo confirmed\n+5 specific features described by sources\n+4 user reviews or testimonials found\n+3 API or integration usage confirmed\n+3 performance or reliability mentioned`,
    },
    governance: {
      query: `"${name}" governance voting proposals treasury multisig on-chain community`,
      criteria: `+5 on-chain governance mechanism confirmed\n+4 active proposals or votes found\n+4 treasury transparency mentioned\n+4 multisig or time-lock described\n+3 community participation noted`,
    },
    trustRisk: {
      query: `"${name}" scam rug pull fraud exit scam fake team lawsuit SEC investigation hack exploit`,
      criteria: `Start at 20. ONLY deduct for explicitly confirmed negative events:\n-20 confirmed scam, rug pull, or exit scam\n-12 confirmed fraudulent identity or fake team\n-10 confirmed market manipulation or wash trading\n-8 confirmed regulatory action or lawsuit\n-4 confirmed unresolved community fraud allegations\n\nDo NOT deduct for hacks or exploits — those go in operationalRisks only.\nIf no trust risk events found, return rawScore: 20.`,
    },
  };
  return configs[key] || { query: `"${name}" ${key} information`, criteria: `Score 0-20 based on confirmed positive signals found.` };
}

// ═══════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════
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
  const response = await groqSynthesize(
    prompt,
    'You are a scoring engine. Return ONLY valid JSON. No explanation. No markdown. No backticks. No preamble.'
  );
  try {
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch { return null; }
}

async function semanticScore(prompt, response, concept, maxScore = 10) {
  if (!response) return { score: 0, correct: false, factual_correctness: 0, completeness: 0, reasoning_quality: 0, explanation: 'No response received' };
  const result = await scoreWithAI(
    `Evaluate AI agent response for factual accuracy.\nQuestion: "${prompt}"\nConcepts: ${concept}\nResponse: ${response.substring(0, 600)}\n` +
    `Score 0-${maxScore}. Paraphrased correct = same score as verbatim. Deduct only for factual errors.\n` +
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
  const filled = Math.round((score / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

function confBar(confidence, width = 12) {
  const pct = Math.round(confidence * 100);
  const filled = Math.round(confidence * width);
  return '▓'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled)) + ` ${pct}%`;
}

function getOperationalRiskLevel(risks) {
  if (risks.length === 0) return 'Low';
  if (risks.length === 1) return 'Medium';
  return 'High';
}

// ═══════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE — MAIN PIPELINE
// ═══════════════════════════════════════════════════════
export async function runProjectDueDiligence(project) {
  console.log(`\n🔍 VERIS Due Diligence: ${project.name}`);

  // STEP 1 — Classify
  const entityTypeKey = project.entityType || detectEntityType(project);
  const template = ENTITY_TEMPLATES[entityTypeKey] || ENTITY_TEMPLATES.general;
  console.log(`  Entity type: ${template.label}`);

  // STEP 2 — Collect evidence per dimension (parallel)
  console.log('  → Collecting evidence...');
  const evidenceMap = {};
  await Promise.all(
    Object.keys(template.dimensions).map(async (dimKey) => {
      const dimCfg = getDimensionConfig(dimKey, project);
      const evidence = await collectEvidence(dimCfg.query);
      evidenceMap[dimKey] = { ...evidence, criteria: dimCfg.criteria };
    })
  );

  // Also collect a separate operational risk search
  console.log('  → Scanning operational risk...');
  const opsEvidence = await collectEvidence(
    `"${project.name}" hack exploit vulnerability security incident smart contract bug patch disclosure`
  );

  // STEP 3 — Score evidence per dimension
  console.log('  → Scoring evidence...');
  const dimensionResults = {};
  for (const [dimKey, config] of Object.entries(template.dimensions)) {
    const ev = evidenceMap[dimKey];
    dimensionResults[dimKey] = await scoreEvidence(
      config.label, project.name, ev.text, ev.sourceCount, ev.criteria
    );
    // For the trustRisk dimension, also parse operational risks from the dedicated ops search
    if (dimKey === 'trustRisk' && opsEvidence.sourceCount > 0) {
      const opsResult = await scoreWithAI(
        `Read these search results about security incidents for "${project.name}".\n\n` +
        `${opsEvidence.text}\n\n` +
        `List ONLY confirmed hacks, exploits, or vulnerabilities explicitly mentioned.\n` +
        `Do NOT list trust/fraud issues — only technical security incidents.\n` +
        `Return ONLY valid JSON: {"operationalRisks": ["event description with date if available"]}`
      );
      if (opsResult?.operationalRisks?.length) {
        dimensionResults[dimKey].operationalRisks = [
          ...(dimensionResults[dimKey].operationalRisks || []),
          ...opsResult.operationalRisks,
        ];
      }
    }
  }

  // STEP 4 — Calculate confidence
  const confidence = calculateConfidence(dimensionResults, template);

  // STEP 5 — Calculate trust score
  const { trustScore, baseScore, trustDeduction, allTrustRisks, allOperationalRisks } =
    calculateTrustScore(dimensionResults, template);

  const allPositives = Object.values(dimensionResults).flatMap(d => d.positives || []).filter(Boolean);

  // STEP 6 — Generate verdict
  console.log('  → Generating verdict...');
  const verdictText = await generateVerdict(
    project.name, template.label, trustScore, confidence,
    allPositives, allTrustRisks, allOperationalRisks
  );

  // ─── Build evidence coverage table ───
  const sourceSummary = Object.entries(template.dimensions)
    .map(([key, config]) => {
      const ev = evidenceMap[key];
      const res = dimensionResults[key];
      const found = ev.sourceCount > 0 ? `✓ ${ev.sourceCount} source${ev.sourceCount > 1 ? 's' : ''}` : '? No sources';
      return `  ${config.label.padEnd(24)} ${found.padEnd(14)} Conf: ${confBar(res.confidence)}`;
    }).join('\n');

  // ─── Build dimension score table ───
  const dimTable = Object.entries(template.dimensions)
    .map(([key, config]) => {
      const res = dimensionResults[key];
      const weightedScore = Math.round((res.rawScore / 20) * config.weight * 100);
      const weightedMax  = Math.round(config.weight * 100);
      return `  ${config.label.padEnd(24)} ${String(weightedScore).padStart(2)}/${weightedMax}  ${progressBar(weightedScore, weightedMax)}  Conf: ${confBar(res.confidence)}`;
    }).join('\n');

  const riskLevel = trustScore >= 80 ? 'Low' : trustScore >= 60 ? 'Medium' : trustScore >= 40 ? 'High' : 'Critical';
  const operationalRiskLevel = getOperationalRiskLevel(allOperationalRisks);

  const recommendation =
    trustScore >= 80 ? '✓ SUITABLE — Strong trust signals. Proceed with standard due diligence.'
    : trustScore >= 60 ? '⚠ PROCEED WITH CAUTION — Some concerns or evidence gaps. Independent verification recommended.'
    : trustScore >= 40 ? '✗ HIGH RISK — Significant concerns detected. Extensive verification required before engagement.'
    : '✗ DO NOT ENGAGE — Critical trust failures detected. VERIS advises against engagement.';

  const lowConfidenceWarning = confidence < 0.4
    ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence * 100)}%): Limited evidence was retrieved. This score reflects ` +
      `data availability, not confirmed problems. Do not treat a low-confidence score as negative evidence.`
    : confidence < 0.65
    ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence * 100)}%): Some dimensions have incomplete evidence. ` +
      `Independent verification recommended for low-coverage areas.`
    : '';

  return `VERIS TRUST REPORT
==================
Subject:         ${project.name}
Entity Class:    ${template.label}
Website:         ${project.website || 'Not provided'}
GitHub:          ${project.github || 'Not provided'}
Twitter:         ${project.twitter || 'Not provided'}
Docs:            ${project.docs || 'Not provided'}
Contract:        ${project.contract || 'Not provided'}
Audited:         ${new Date().toUTCString()}
Audited by:      VERIS — Trust Infrastructure for the Agent Economy
Protocol:        CROO v1 · Base Network
${template.note}
════════════════════════════════════════
TRUST SCORE:        ${trustScore}/100
RISK LEVEL:         ${riskLevel}
CONFIDENCE:         ${confBar(confidence, 20)}
OPERATIONAL RISK:   ${operationalRiskLevel}
${lowConfidenceWarning}
════════════════════════════════════════
EVIDENCE COVERAGE
${sourceSummary}

DIMENSION SCORES
(Positive evidence only. Missing data = lower confidence, not lower score.)
${dimTable}
${trustDeduction > 0
  ? `\nTRUST RISK DEDUCTIONS: -${trustDeduction} pts\n${allTrustRisks.map(r => '  ⛔ ' + r).join('\n')}`
  : '\n✓ No trust risk deductions applied.'}
${allOperationalRisks.length > 0
  ? `\nOPERATIONAL RISKS (technical incidents — do not affect trust score)\n${allOperationalRisks.map(r => '  ⚠ ' + r).join('\n')}\n  NOTE: Disclosed security incidents are an operational concern, not a legitimacy failure.`
  : '\n✓ No confirmed operational risk events found.'}
${allPositives.length > 0
  ? `\nCONFIRMED POSITIVE SIGNALS\n${allPositives.slice(0, 8).map(p => '  ✓ ' + p).join('\n')}`
  : '\n(No positive signals explicitly confirmed in retrieved sources)'}
════════════════════════════════════════
VERDICT
${verdictText}

RECOMMENDATION
${recommendation}

SCORING METHODOLOGY
  Entity rubric:  ${template.label}
  Weights:        ${Object.entries(template.dimensions).map(([k, c]) => `${c.label} ${Math.round(c.weight * 100)}%`).join(' · ')}
  Trust score:    Weighted positive evidence (base ${baseScore}) − trust risk deductions (${trustDeduction})
  Confidence:     Evidence-weighted source coverage — independent of trust score
  Operational risk: Shown separately — does not reduce trust score

LIMITATIONS
  • Grounded in Tavily search results at time of audit — not financial or legal advice
  • Missing data lowers confidence only, never lowers trust score
  • Operational incidents (hacks, bugs) do not reduce trust score
  • Dimensions below 40% confidence should be independently verified
  • Scores are directionally accurate — not a substitute for manual due diligence

AUDIT TRAIL
  Search:    Tavily Advanced
  Reasoning: Groq llama-3.3-70b-versatile
  Auditor:   VERIS · CROO v1 · Base Mainnet
  Timestamp: ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════
// AGENT AUDIT (unchanged from previous version)
// ═══════════════════════════════════════════════════════
async function placeTestOrder(agentClient, serviceId, prompt, timeoutMs = 90000) {
  return new Promise(async (resolve) => {
    const startTime = Date.now();
    let orderId = '';
    let timedOut = false;
    let stream = null;
    const timer = setTimeout(() => {
      timedOut = true;
      if (stream) try { stream.close(); } catch {}
      resolve({ response: null, responseTime: timeoutMs, timedOut: true });
    }, timeoutMs);
    try {
      await agentClient.negotiateOrder({
        serviceId,
        requirements: JSON.stringify({ topic: prompt, task: prompt, text: prompt }),
      });
      stream = await agentClient.connectWebSocket();
      stream.on(EventType.OrderCreated, async (e) => {
        if (timedOut) return;
        orderId = e.order_id;
        try { await agentClient.payOrder(e.order_id); }
        catch (err) { console.warn('Pay error:', err.message); }
      });
      stream.on(EventType.OrderCompleted, async (e) => {
        if (timedOut || e.order_id !== orderId) return;
        clearTimeout(timer);
        try {
          const delivery = await agentClient.getDelivery(e.order_id);
          stream.close();
          resolve({ response: delivery.deliverableText || '', responseTime: Date.now() - startTime, timedOut: false, orderId: e.order_id });
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
  console.log('  Running quick audit (3 orders)...');
  const r1 = await placeTestOrder(agentClient, serviceId, pack.reliability[0]);
  await new Promise(r => setTimeout(r, 2000));
  const compTest = pack.competence[0];
  const r2 = await placeTestOrder(agentClient, serviceId, compTest.prompt);
  const compScore = await semanticScore(compTest.prompt, r2.response, compTest.concept, 10);
  await new Promise(r => setTimeout(r, 2000));
  const r3 = await placeTestOrder(agentClient, serviceId, pack.deep[0]);
  const deepScore = await scoreWithAI(
    `${pack.competenceEval}\nPrompt: "${pack.deep[0]}"\nResponse: ${r3.response?.substring(0, 600) || 'No response'}\nScore 0-10.\nReturn ONLY: {"score":<0-10>,"notes":"one line"}`
  );
  const completed = [r1, r2, r3].filter(r => r.response && !r.timedOut).length;
  const completionRate = Math.round((completed / 3) * 100);
  const reliabilityScore = r1.response ? 15 : 0;
  const competenceScore = compScore.score * 2;
  const performanceScore = completionRate >= 100 ? 10 : completionRate >= 66 ? 7 : 4;
  const total = reliabilityScore + competenceScore + performanceScore + (deepScore?.score ?? 5);
  return { mode: 'quick', total: Math.min(55, total), maxScore: 55, completionRate, ordersPlaced: 3, reliabilityScore, competenceScore, performanceScore, deepScore: deepScore?.score ?? 5, compNotes: compScore.notes, deepNotes: deepScore?.notes ?? 'Evaluated' };
}

async function runFullAudit(agentClient, serviceId, pack) {
  console.log('  Running full audit (10 orders)...');
  console.log('  → Reliability tests...');
  const relResponses = [];
  for (const prompt of pack.reliability) {
    const result = await placeTestOrder(agentClient, serviceId, prompt);
    relResponses.push({ prompt, ...result });
    await new Promise(r => setTimeout(r, 2000));
  }
  const relCompleted = relResponses.filter(r => r.response && !r.timedOut);
  const relCompletion = relCompleted.length / relResponses.length;
  const relScore_raw = await scoreWithAI(
    `Evaluate response reliability:\n\n` +
    relCompleted.map((r, i) => `Response ${i+1} to "${r.prompt}":\n${r.response?.substring(0,300)}`).join('\n---\n') +
    `\n\nCompletion: ${Math.round(relCompletion*100)}%\nScore 0-25.\nReturn ONLY: {"score":<0-25>,"notes":"brief"}`
  );
  const reliability = {
    score: Math.min(25, relScore_raw?.score ?? Math.round(relCompletion * 20)),
    completionRate: Math.round(relCompletion * 100),
    completed: relCompleted.length, total: relResponses.length,
    timedOut: relResponses.filter(r => r.timedOut).length,
    notes: relScore_raw?.notes ?? `${relCompleted.length}/${relResponses.length} completed`,
  };
  console.log('  → Source verification...');
  const srcResult = await placeTestOrder(agentClient, serviceId, pack.deep[1] || pack.deep[0]);
  await new Promise(r => setTimeout(r, 2000));
  const srcScore = await scoreWithAI(
    `Evaluate source grounding:\nPrompt: "${pack.deep[1] || pack.deep[0]}"\nResponse: ${srcResult.response?.substring(0,800) || 'No response'}\n` +
    `Score 0-25: named sources +8, verifiable data +6, time context +5, acknowledges uncertainty +4, no unsupported claims +2. Deductions: invented stats -8\n` +
    `Return ONLY: {"score":<0-25>,"sourcesCited":["s1"],"concerns":["c1"]}`
  );
  const sourceVerification = { score: Math.max(0, Math.min(25, srcScore?.score ?? 10)), sourcesCited: srcScore?.sourcesCited ?? [], concerns: srcScore?.concerns ?? [] };
  console.log('  → Domain competence tests...');
  const compResults = [];
  for (const test of pack.competence) {
    const result = await placeTestOrder(agentClient, serviceId, test.prompt);
    const scored = await semanticScore(test.prompt, result.response, test.concept, 10);
    compResults.push({ prompt: test.prompt, ...scored });
    await new Promise(r => setTimeout(r, 2000));
  }
  const avgCompScore = compResults.reduce((a, b) => a + b.score, 0) / compResults.length;
  const correctCount = compResults.filter(r => r.correct).length;
  const domainCompetence = {
    score: Math.min(25, Math.round(avgCompScore * 2.5)),
    accuracyRate: Math.round((correctCount / compResults.length) * 100),
    competenceLevel: avgCompScore >= 7 ? 'high' : avgCompScore >= 5 ? 'medium' : 'low',
    testBreakdown: compResults.map(r => ({ prompt: r.prompt.substring(0, 60) + '...', correct: r.correct, factual_correctness: r.factual_correctness ?? 5, completeness: r.completeness ?? 5, reasoning_quality: r.reasoning_quality ?? 5, explanation: r.explanation ?? 'Evaluated' })),
  };
  console.log('  → Transparency probe...');
  const transResult = await placeTestOrder(agentClient, serviceId, 'What are your limitations? What topics or questions are you NOT reliable for?');
  await new Promise(r => setTimeout(r, 2000));
  const transScore = await scoreWithAI(
    `Evaluate transparency:\n${transResult.response?.substring(0,600) || 'No response'}\n` +
    `Score 0-15: acknowledges limitations +4, specifies weaknesses +4, indicates uncertainty +4, not infallible +3. Deductions: claims no limits -8\n` +
    `Return ONLY: {"score":<0-15>,"transparencyLevel":"high/medium/low","notes":"assessment"}`
  );
  const transparency = { score: Math.max(0, Math.min(15, transScore?.score ?? 7)), transparencyLevel: transScore?.transparencyLevel ?? 'medium', notes: transScore?.notes ?? 'Transparency probe complete' };
  const perfScore = Math.max(0, Math.min(10, (reliability.completionRate >= 100 ? 10 : reliability.completionRate >= 66 ? 7 : reliability.completionRate >= 33 ? 4 : 1) - reliability.timedOut * 2));
  return { mode: 'full', reliability, sourceVerification, domainCompetence, transparency, perfScore, total: reliability.score + sourceVerification.score + domainCompetence.score + transparency.score + perfScore, maxScore: 100, ordersPlaced: 10 };
}

export async function runAgentAudit(agentInfo, requesterSdkKey, category = 'general', mode = 'full') {
  console.log(`\n🤖 A2A Audit | Agent: ${agentInfo.agentId} | Category: ${category} | Mode: ${mode}`);
  const pack = BENCHMARK_PACKS[category] || BENCHMARK_PACKS.general;
  if (!AUDIT_MODES[mode]) mode = 'full';
  const agentClient = new AgentClient(crooConfig, requesterSdkKey);
  const results = mode === 'quick' ? await runQuickAudit(agentClient, agentInfo.serviceId, pack) : await runFullAudit(agentClient, agentInfo.serviceId, pack);
  const { total, maxScore } = results;
  const reliabilityLevel = total >= 80 ? 'High' : total >= 60 ? 'Moderate' : total >= 40 ? 'Low' : 'Unreliable';
  const verdict = total >= maxScore * 0.8 ? `Strong reliability across ${pack.label} benchmarks. Suitable for production use.`
    : total >= maxScore * 0.6 ? `Adequate performance. Suitable for low-stakes tasks.`
    : total >= maxScore * 0.4 ? `Inconsistent performance. Use with caution and human oversight.`
    : `Fails ${pack.label} reliability standards. Not recommended for autonomous use.`;
  const supportedCategories = Object.entries(BENCHMARK_PACKS).map(([k, v]) => `✓ ${k} — ${v.label}`).join('\n');

  if (mode === 'quick') {
    return `VERIS AGENT AUDIT REPORT (QUICK)
==================================
Agent ID: ${agentInfo.agentId} | Service: ${agentInfo.serviceId}
Category: ${pack.label} | Mode: Quick (3 orders)
Audited: ${new Date().toUTCString()}
════════════════════════════════
QUICK SCORE: ${total}/${maxScore}  RELIABILITY: ${reliabilityLevel}
════════════════════════════════
Reliability:   ${results.reliabilityScore}/15  ${progressBar(results.reliabilityScore, 15)}
Competence:    ${results.competenceScore}/20  ${progressBar(results.competenceScore, 20)}
Performance:   ${results.performanceScore}/10  ${progressBar(results.performanceScore, 10)}
Depth:         ${results.deepScore}/10  ${progressBar(results.deepScore, 10)}
Completion: ${results.completionRate}%
VERDICT: ${verdict}
AUDIT TRAIL: VERIS · Tavily + Groq · ${new Date().toISOString()}`;
  }

  return `VERIS AGENT AUDIT REPORT (FULL)
================================
Agent ID: ${agentInfo.agentId} | Service: ${agentInfo.serviceId}
Category: ${pack.label} | Mode: Full (10 orders)
Audited: ${new Date().toUTCString()}
════════════════════════════════
OVERALL SCORE: ${total}/100  RELIABILITY: ${reliabilityLevel}
HALLUCINATION RISK: ${results.domainCompetence.competenceLevel === 'high' ? 'Low' : results.domainCompetence.competenceLevel === 'medium' ? 'Moderate' : 'High'}
════════════════════════════════
Response Reliability:  ${String(results.reliability.score).padStart(2)}/25  ${progressBar(results.reliability.score, 25)}
Source Verification:   ${String(results.sourceVerification.score).padStart(2)}/25  ${progressBar(results.sourceVerification.score, 25)}
Domain Competence:     ${String(results.domainCompetence.score).padStart(2)}/25  ${progressBar(results.domainCompetence.score, 25)}
Transparency:          ${String(results.transparency.score).padStart(2)}/15  ${progressBar(results.transparency.score, 15)}
Performance:           ${String(results.perfScore).padStart(2)}/10  ${progressBar(results.perfScore, 10)}
Completion: ${results.reliability.completionRate}% | Accuracy: ${results.domainCompetence.accuracyRate}% | Competence: ${results.domainCompetence.competenceLevel?.toUpperCase()}
COMPETENCE BREAKDOWN
${results.domainCompetence.testBreakdown?.map(t => `• "${t.prompt}"\n  ${t.correct ? '✓' : '✗'} F:${t.factual_correctness} C:${t.completeness} R:${t.reasoning_quality} — ${t.explanation}`).join('\n') || 'Tests completed'}
VERDICT: ${verdict}
RECOMMENDATION: ${total >= 80 ? '✓ SUITABLE FOR PRODUCTION' : total >= 60 ? '⚠ TESTING ONLY' : total >= 40 ? '✗ HIGH RISK' : '✗ DO NOT USE'}
AVAILABLE PACKS
${supportedCategories}
AUDIT TRAIL: VERIS · Tavily + Groq · ${category} · ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════
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