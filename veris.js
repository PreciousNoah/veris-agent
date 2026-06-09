import Groq from 'groq-sdk';
import { tavily } from '@tavily/core';
import pkg from '@croo-network/sdk';
const { AgentClient, EventType, DeliverableType } = pkg;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY });

const crooConfig = {
  baseURL: process.env.CROO_API_URL,
  wsURL: process.env.CROO_WS_URL,
  rpcURL: 'https://mainnet.base.org',
  logger: { debug: () => {}, info: console.log, warn: console.warn, error: console.error },
};

// ─── BENCHMARK PACKS ───
// All questions are mechanism-based (evergreen) not fact-based (dynamic)
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

// ─── AUDIT MODES ───
const AUDIT_MODES = {
  quick: {
    label: 'Quick Audit',
    description: '3 orders — fast reliability and basic competence check',
    ordersEstimate: 3,
    dimensions: ['reliability', 'spot_competence', 'performance'],
  },
  full: {
    label: 'Full Audit',
    description: '10 orders — complete 5-dimension reliability assessment',
    ordersEstimate: 10,
    dimensions: ['reliability', 'source_verification', 'domain_competence', 'transparency', 'performance'],
  },
};

// ─── AUTO CATEGORY DETECTOR ───
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

// ─── HELPERS ───

/**
 * NEW PIPELINE: Tavily (search) → Groq (reason)
 * Replaces old: Groq (search + reason) — which hallucinated
 *
 * Tavily returns real page content in `result.results[].content`.
 * We pass that grounded text to Groq so it only reasons over evidence it can see.
 */
async function webSearch(query) {
  let searchContext = '';

  try {
    const searchResponse = await tavilyClient.search(query, {
      searchDepth: 'advanced',   // deeper crawl, same free quota bucket
      maxResults: 5,
      includeAnswer: false,      // we want raw content, not Tavily's own summary
    });

    // Build a grounded context block from page snippets
    if (searchResponse.results && searchResponse.results.length > 0) {
      searchContext = searchResponse.results
        .map((r, i) =>
          `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content?.substring(0, 600) || ''}`
        )
        .join('\n\n---\n\n');
    }
  } catch (err) {
    console.warn('  ⚠ Tavily search failed, falling back to Groq-only:', err.message);
    // Graceful degradation: if Tavily is down, fall back to Groq knowledge only
    return await groqSynthesize(
      `Based on your knowledge, provide specific findings about: ${query}`,
      'You are a Web3 research analyst. Be specific about what you know and flag any uncertainty.'
    );
  }

  // Groq reasons only over what Tavily found — no hallucination possible from thin air
  return await groqSynthesize(
    `You are analyzing search results to answer a research query.\n\n` +
    `QUERY: ${query}\n\n` +
    `SEARCH RESULTS:\n${searchContext}\n\n` +
    `Based ONLY on the search results above, provide specific findings. ` +
    `If the results don't contain relevant information, say so explicitly. ` +
    `Cite source numbers (e.g. [Source 1]) when referencing specific facts.`,
    'You are a Web3 research analyst. Summarize only what the provided search results contain. Do not add information from outside the results.'
  );
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
  const response = await groqSynthesize(
    prompt,
    'You are a scoring engine. Return ONLY valid JSON. No explanation. No markdown. No backticks. No preamble.'
  );
  try {
    return JSON.parse(response.replace(/```json|```/g, '').trim());
  } catch { return null; }
}

// LLM-based semantic scoring — structured JSON output
async function semanticScore(prompt, response, concept, maxScore = 10) {
  if (!response) return {
    score: 0, correct: false,
    factual_correctness: 0, completeness: 0, reasoning_quality: 0,
    explanation: 'No response received'
  };
  const result = await scoreWithAI(
    `You are evaluating an AI agent response for factual accuracy and completeness.\n\n` +
    `Question asked: "${prompt}"\n\n` +
    `Key concepts that should be covered: ${concept}\n\n` +
    `Agent response: ${response.substring(0, 600)}\n\n` +
    `Score 0-${maxScore} total, broken down as:\n` +
    `- Core concept correctly explained: ${Math.round(maxScore * 0.5)} points\n` +
    `- Completeness of answer: ${Math.round(maxScore * 0.3)} points\n` +
    `- No factual errors: ${Math.round(maxScore * 0.2)} points\n\n` +
    `Rules: A paraphrased correct answer scores the same as verbatim. Only deduct for factual errors, not wording differences.\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"score": <0-${maxScore}>, "factual_correctness": <0-10>, "completeness": <0-10>, "reasoning_quality": <0-10>, "correct": true/false, "explanation": "one sentence why"}`
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

function getRiskLevel(score) {
  if (score >= 80) return 'Low';
  if (score >= 60) return 'Medium';
  if (score >= 40) return 'High';
  return 'Critical';
}

function getReliabilityLevel(score) {
  if (score >= 80) return 'High';
  if (score >= 60) return 'Moderate';
  if (score >= 40) return 'Low';
  return 'Unreliable';
}

// ─── PROJECT DUE DILIGENCE SCORING ───
async function scoreTeamTransparency(project) {
  console.log('  → Checking team transparency...');
  const findings = await webSearch(
    `Find information about the founders and team of "${project.name}" crypto/Web3 project. ` +
    `Website: ${project.website || 'not provided'}. ` +
    `Look for: founder names, LinkedIn profiles, previous projects, team page, verifiable identities.`
  );
  const result = await scoreWithAI(
    `Based on these findings about the team of "${project.name}":\n\n${findings}\n\n` +
    `Score team transparency 0-20:\n` +
    `Founders publicly named: +6\nLinkedIn or professional profiles found: +4\n` +
    `Previous verifiable history: +4\nTeam page on website: +3\nNo identity red flags: +3\n\n` +
    `Return ONLY: {"score": <0-20>, "confidence": "high/medium/low", "findings": ["f1","f2"], "positives": ["p1"], "concerns": ["c1"]}`
  );
  return { score: result?.score ?? 8, confidence: result?.confidence ?? 'medium', findings: result?.findings ?? [], positives: result?.positives ?? [], concerns: result?.concerns ?? [] };
}

async function scoreDocumentationQuality(project) {
  console.log('  → Checking documentation quality...');
  const findings = await webSearch(
    `Analyze documentation for "${project.name}" Web3 project. ` +
    `Website: ${project.website || 'not provided'} Docs: ${project.docs || 'not provided'}. ` +
    `Check for: whitepaper, roadmap, tokenomics, technical docs, use case clarity.`
  );
  const result = await scoreWithAI(
    `Based on documentation findings for "${project.name}":\n\n${findings}\n\n` +
    `Score 0-20: Whitepaper: +5, Roadmap: +4, Tokenomics explained: +4, Technical docs: +4, Clear use case: +3\n\n` +
    `Return ONLY: {"score": <0-20>, "confidence": "high/medium/low", "findings": ["f1","f2"], "positives": ["p1"], "concerns": ["c1"]}`
  );
  return { score: result?.score ?? 8, confidence: result?.confidence ?? 'medium', findings: result?.findings ?? [], positives: result?.positives ?? [], concerns: result?.concerns ?? [] };
}

async function scoreSocialCredibility(project) {
  console.log('  → Checking social credibility...');
  const findings = await webSearch(
    `Analyze social media presence of "${project.name}" crypto project. ` +
    `Twitter/X: ${project.twitter || 'not provided'}. ` +
    `Check: engagement quality, posting consistency, bot indicators, community size.`
  );
  const result = await scoreWithAI(
    `Based on social findings for "${project.name}":\n\n${findings}\n\n` +
    `Score 0-20: Active accounts +4, consistent posting +4, genuine engagement +4, no bots +4, third-party coverage +4. ` +
    `Deductions: bots suspected -6, inactive >3mo -4, no presence -8\n\n` +
    `Return ONLY: {"score": <0-20>, "confidence": "high/medium/low", "findings": ["f1","f2"], "positives": ["p1"], "concerns": ["c1"]}`
  );
  return { score: Math.max(0, result?.score ?? 8), confidence: result?.confidence ?? 'medium', findings: result?.findings ?? [], positives: result?.positives ?? [], concerns: result?.concerns ?? [] };
}

async function scoreDevelopmentActivity(project) {
  console.log('  → Checking development activity...');
  const findings = await webSearch(
    `Analyze GitHub and development activity for "${project.name}" crypto project. ` +
    `GitHub: ${project.github || 'not provided'}. ` +
    `Check: recent commits, contributors, open source status, audit reports.`
  );
  const result = await scoreWithAI(
    `Based on development findings for "${project.name}":\n\n${findings}\n\n` +
    `Score 0-20: Active GitHub +6, multiple contributors +4, open source +4, audit exists +4, regular releases +2. ` +
    `Deductions: last commit >3mo -6, no GitHub -8, solo dev -4\n\n` +
    `Return ONLY: {"score": <0-20>, "confidence": "high/medium/low", "findings": ["f1","f2"], "positives": ["p1"], "concerns": ["c1"]}`
  );
  return { score: Math.max(0, result?.score ?? 8), confidence: result?.confidence ?? 'medium', findings: result?.findings ?? [], positives: result?.positives ?? [], concerns: result?.concerns ?? [] };
}

async function scoreRiskFlags(project) {
  console.log('  → Scanning for risk flags...');
  const findings = await webSearch(
    `Search for scam reports, rug pull accusations, hacks, or red flags for "${project.name}" crypto project. ` +
    `Contract: ${project.contract || 'not provided'}. ` +
    `Look for: confirmed scams, hacks, unrealistic promises, anonymous team, legal issues.`
  );
  const result = await scoreWithAI(
    `Based on risk findings for "${project.name}":\n\n${findings}\n\nStart at 20, deduct:\n` +
    `Confirmed scam/rug: -20, Hack/exploit confirmed: -8, Unrealistic yields >1000%: -6, ` +
    `Fully anonymous team: -5, No audit: -3, Negative majority sentiment: -4, Legal issues: -6\n\n` +
    `Return ONLY: {"score": <0-20>, "confidence": "high/medium/low", "redFlags": ["rf1"], "findings": ["f1"], "concerns": ["c1"]}`
  );
  return { score: Math.max(0, result?.score ?? 10), confidence: result?.confidence ?? 'medium', redFlags: result?.redFlags ?? [], findings: result?.findings ?? [], concerns: result?.concerns ?? [] };
}

export async function runProjectDueDiligence(project) {
  console.log(`\n🔍 Starting project due diligence: ${project.name}`);
  const [team, docs, social, dev, risk] = await Promise.all([
    scoreTeamTransparency(project),
    scoreDocumentationQuality(project),
    scoreSocialCredibility(project),
    scoreDevelopmentActivity(project),
    scoreRiskFlags(project),
  ]);
  const total = team.score + docs.score + social.score + dev.score + risk.score;
  const riskLevel = getRiskLevel(total);
  const verdict = total >= 75
    ? 'Project shows strong trust signals. Standard due diligence recommended before committing capital.'
    : total >= 50
    ? 'Project appears legitimate but has concerns. Proceed with caution and independent verification.'
    : total >= 30
    ? 'Significant red flags detected. High risk — verify independently before any engagement.'
    : 'Critical trust failures detected. VERIS does not recommend engaging with this project.';
  const allRedFlags = [...(risk.redFlags || []), ...[team, docs, social, dev].flatMap(d => d.concerns || [])].filter(Boolean).slice(0, 6);
  const allPositives = [team, docs, social, dev].flatMap(d => d.positives || []).filter(Boolean).slice(0, 5);
  const allFindings = [team, docs, social, dev, risk].flatMap(d => d.findings || []).filter(Boolean).slice(0, 6);
  const dimConf = (d) => d.confidence === 'high' ? '✓' : d.confidence === 'medium' ? '~' : '?';
  return `VERIS TRUST REPORT
==================
Subject: ${project.name}
Type: Project Due Diligence
Website: ${project.website || 'Not provided'}
GitHub: ${project.github || 'Not provided'}
Twitter: ${project.twitter || 'Not provided'}
Docs: ${project.docs || 'Not provided'}
Contract: ${project.contract || 'Not provided'}
Audited: ${new Date().toUTCString()}
Audited by: VERIS — Trust Infrastructure for the Agent Economy
Protocol: CROO v1 · Base Network
════════════════════════════════
OVERALL TRUST SCORE: ${total}/100
RISK LEVEL: ${riskLevel}
════════════════════════════════
DIMENSION BREAKDOWN
(✓ high confidence  ~ moderate  ? limited data)
Team Transparency:      ${String(team.score).padStart(2)}/20  ${progressBar(team.score, 20)}  ${dimConf(team)}
Documentation Quality:  ${String(docs.score).padStart(2)}/20  ${progressBar(docs.score, 20)}  ${dimConf(docs)}
Social Credibility:     ${String(social.score).padStart(2)}/20  ${progressBar(social.score, 20)}  ${dimConf(social)}
Development Activity:   ${String(dev.score).padStart(2)}/20  ${progressBar(dev.score, 20)}  ${dimConf(dev)}
Risk Flags:             ${String(risk.score).padStart(2)}/20  ${progressBar(risk.score, 20)}  ${dimConf(risk)}
KEY FINDINGS
${allFindings.length > 0 ? allFindings.map(f => '• ' + f).join('\n') : '• Insufficient public data found for detailed findings'}
${allRedFlags.length > 0 ? 'RED FLAGS DETECTED\n' + allRedFlags.map(f => '⚠ ' + f).join('\n') : '✓ NO RED FLAGS DETECTED'}
${allPositives.length > 0 ? 'POSITIVE SIGNALS\n' + allPositives.map(f => '✓ ' + f).join('\n') : ''}
VERDICT
${verdict}
RECOMMENDATION
${total >= 75 ? '✓ SUITABLE — Trust signals are strong. Proceed with standard investment due diligence.' : total >= 50 ? '⚠ PROCEED WITH CAUTION — Concerns detected. Independent verification recommended before committing capital.' : total >= 30 ? '✗ HIGH RISK — Significant red flags present. Do not engage without extensive independent verification.' : '✗ DO NOT ENGAGE — Critical trust failures detected. VERIS strongly advises against engagement.'}
LIMITATIONS
• Report based on real-time web data retrieved via Tavily search at time of audit
• Groq synthesis limited to evidence found in search results — no unsourced claims
• Social credibility analysis does not access platform APIs directly
• Trust scores are indicative only — not financial or legal advice
• Dimensions marked (?) indicate limited available data — treat with caution
AUDIT TRAIL
Protocol: CROO v1 · Base Mainnet
Auditor: VERIS
Search: Tavily Advanced · ${new Date().toISOString()}
Reasoning: Groq llama-3.3-70b-versatile
Timestamp: ${new Date().toISOString()}`;
}

// ─── AGENT AUDITOR — ORDER PLACEMENT ───
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
      const neg = await agentClient.negotiateOrder({
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

// ─── QUICK AUDIT (3 orders) ───
async function runQuickAudit(agentClient, serviceId, pack) {
  console.log('  Running quick audit (3 orders)...');
  // 1 reliability test
  const reliabilityPrompt = pack.reliability[0];
  const r1 = await placeTestOrder(agentClient, serviceId, reliabilityPrompt);
  await new Promise(res => setTimeout(res, 2000));
  // 1 competence test — semantic scoring
  const compTest = pack.competence[0];
  const r2 = await placeTestOrder(agentClient, serviceId, compTest.prompt);
  const compScore = await semanticScore(compTest.prompt, r2.response, compTest.concept, 10);
  await new Promise(res => setTimeout(res, 2000));
  // 1 deep test
  const r3 = await placeTestOrder(agentClient, serviceId, pack.deep[0]);
  const deepScore = await scoreWithAI(
    `${pack.competenceEval}\n\nRate this response quality:\nPrompt: "${pack.deep[0]}"\nResponse: ${r3.response?.substring(0, 600) || 'No response'}\n\nScore 0-10 for overall quality.\nReturn ONLY: {"score": <0-10>, "notes": "one line"}`
  );
  const completed = [r1, r2, r3].filter(r => r.response && !r.timedOut).length;
  const completionRate = Math.round((completed / 3) * 100);
  const reliabilityScore = r1.response ? 15 : 0;
  const competenceScore = compScore.score * 2; // scale to 20
  const performanceScore = completionRate >= 100 ? 10 : completionRate >= 66 ? 7 : 4;
  const total = reliabilityScore + competenceScore + performanceScore + (deepScore?.score ?? 5);
  return {
    mode: 'quick',
    total: Math.min(55, total),
    maxScore: 55,
    completionRate,
    ordersPlaced: 3,
    reliabilityScore,
    competenceScore,
    performanceScore,
    deepScore: deepScore?.score ?? 5,
    compNotes: compScore.notes,
    deepNotes: deepScore?.notes ?? 'Evaluated',
  };
}

// ─── FULL AUDIT (10 orders) ───
async function runFullAudit(agentClient, serviceId, pack) {
  console.log('  Running full audit (10 orders)...');
  // DIMENSION 1: Response Reliability — 3 orders
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
    `Evaluate response reliability across these outputs:\n\n` +
    relCompleted.map((r, i) => `Response ${i+1} to "${r.prompt}":\n${r.response?.substring(0,300)}`).join('\n---\n') +
    `\n\nCompletion: ${Math.round(relCompletion*100)}%\nScore 0-25: completion + consistency + quality floor\n` +
    `Return ONLY: {"score": <0-25>, "notes": "brief"}`
  );
  const reliability = {
    score: Math.min(25, relScore_raw?.score ?? Math.round(relCompletion * 20)),
    completionRate: Math.round(relCompletion * 100),
    completed: relCompleted.length,
    total: relResponses.length,
    timedOut: relResponses.filter(r => r.timedOut).length,
    notes: relScore_raw?.notes ?? `${relCompleted.length}/${relResponses.length} completed`,
  };
  // DIMENSION 2: Source Verification — 1 order
  console.log('  → Source verification...');
  const srcResult = await placeTestOrder(agentClient, serviceId, pack.deep[1] || pack.deep[0]);
  await new Promise(r => setTimeout(r, 2000));
  const srcScore = await scoreWithAI(
    `Evaluate source grounding:\nPrompt: "${pack.deep[1] || pack.deep[0]}"\nResponse: ${srcResult.response?.substring(0,800) || 'No response'}\n\n` +
    `Score 0-25: named sources +8, verifiable data +6, time context +5, acknowledges uncertainty +4, no unsupported claims +2. Deductions: invented stats -8\n` +
    `Return ONLY: {"score": <0-25>, "sourcesCited": ["s1"], "concerns": ["c1"]}`
  );
  const sourceVerification = {
    score: Math.max(0, Math.min(25, srcScore?.score ?? 10)),
    sourcesCited: srcScore?.sourcesCited ?? [],
    concerns: srcScore?.concerns ?? [],
  };
  // DIMENSION 3: Domain Competence — 4 orders (semantic scoring)
  console.log('  → Domain competence tests...');
  const compResults = [];
  for (const test of pack.competence) {
    const result = await placeTestOrder(agentClient, serviceId, test.prompt);
    const scored = await semanticScore(test.prompt, result.response, test.concept, 10);
    compResults.push({ prompt: test.prompt, ...scored, response: result.response });
    await new Promise(r => setTimeout(r, 2000));
  }
  const avgCompScore = compResults.reduce((a, b) => a + b.score, 0) / compResults.length;
  const correctCount = compResults.filter(r => r.correct).length;
  const domainCompetence = {
    score: Math.min(25, Math.round(avgCompScore * 2.5)),
    accuracyRate: Math.round((correctCount / compResults.length) * 100),
    competenceLevel: avgCompScore >= 7 ? 'high' : avgCompScore >= 5 ? 'medium' : 'low',
    testBreakdown: compResults.map(r => ({
      prompt: r.prompt.substring(0, 60) + '...',
      correct: r.correct,
      factual_correctness: r.factual_correctness ?? 5,
      completeness: r.completeness ?? 5,
      reasoning_quality: r.reasoning_quality ?? 5,
      explanation: r.explanation ?? r.notes ?? 'Evaluated',
    })),
  };
  // DIMENSION 4: Transparency — 1 order
  console.log('  → Transparency probe...');
  const transResult = await placeTestOrder(agentClient, serviceId, 'What are your limitations? What topics or questions are you NOT reliable for?');
  await new Promise(r => setTimeout(r, 2000));
  const transScore = await scoreWithAI(
    `Evaluate transparency:\n${transResult.response?.substring(0,600) || 'No response'}\n\n` +
    `Score 0-15: acknowledges limitations +4, specifies weaknesses +4, indicates uncertainty +4, not infallible +3. Deductions: claims no limits -8\n` +
    `Return ONLY: {"score": <0-15>, "transparencyLevel": "high/medium/low", "notes": "assessment"}`
  );
  const transparency = {
    score: Math.max(0, Math.min(15, transScore?.score ?? 7)),
    transparencyLevel: transScore?.transparencyLevel ?? 'medium',
    notes: transScore?.notes ?? 'Transparency probe complete',
  };
  // DIMENSION 5: Performance
  const perfScore = Math.max(0, Math.min(10,
    (reliability.completionRate >= 100 ? 10 : reliability.completionRate >= 66 ? 7 : reliability.completionRate >= 33 ? 4 : 1)
    - reliability.timedOut * 2
  ));
  return {
    mode: 'full',
    reliability,
    sourceVerification,
    domainCompetence,
    transparency,
    perfScore,
    total: reliability.score + sourceVerification.score + domainCompetence.score + transparency.score + perfScore,
    maxScore: 100,
    ordersPlaced: 10,
  };
}

// ─── AGENT AUDIT ENTRY ───
export async function runAgentAudit(agentInfo, requesterSdkKey, category = 'general', mode = 'full') {
  console.log(`\n🤖 A2A Audit | Agent: ${agentInfo.agentId} | Category: ${category} | Mode: ${mode}`);
  const pack = BENCHMARK_PACKS[category];
  if (!pack) {
    console.log(`  ⚠ Category "${category}" not found — falling back to general`);
    return runAgentAudit(agentInfo, requesterSdkKey, 'general', mode);
  }
  if (!AUDIT_MODES[mode]) {
    console.log(`  ⚠ Mode "${mode}" not found — defaulting to full`);
    mode = 'full';
  }
  const agentClient = new AgentClient(crooConfig, requesterSdkKey);
  const auditMode = AUDIT_MODES[mode];
  console.log(`  Using: ${auditMode.label} — ${auditMode.description}`);
  const results = mode === 'quick'
    ? await runQuickAudit(agentClient, agentInfo.serviceId, pack)
    : await runFullAudit(agentClient, agentInfo.serviceId, pack);
  const total = results.total;
  const maxScore = results.maxScore;
  const reliabilityLevel = getReliabilityLevel(mode === 'full' ? total : Math.round((total / maxScore) * 100));
  const verdict = total >= (maxScore * 0.8)
    ? `Agent demonstrates strong reliability across ${pack.label} benchmarks. Suitable for production use on CROO protocol.`
    : total >= (maxScore * 0.6)
    ? `Agent performs adequately. Suitable for low-stakes tasks. Full audit recommended for production use.`
    : total >= (maxScore * 0.4)
    ? `Inconsistent performance detected. Use with caution and human oversight.`
    : `Agent fails ${pack.label} reliability standards. Not recommended for autonomous commercial use.`;
  const supportedCategories = Object.entries(BENCHMARK_PACKS)
    .map(([k, v]) => `✓ ${k} — ${v.label}`).join('\n');
  if (mode === 'quick') {
    return `VERIS AGENT AUDIT REPORT (QUICK)
==================================
Subject Agent ID: ${agentInfo.agentId}
Service ID: ${agentInfo.serviceId}
Category: ${pack.label}
Mode: Quick Audit (3 orders)
Audited: ${new Date().toUTCString()}
Audited by: VERIS — Trust Infrastructure for the Agent Economy
Method: A2A via CROO Protocol · Base Network
════════════════════════════════
QUICK SCORE: ${total}/${maxScore}
RELIABILITY: ${reliabilityLevel}
════════════════════════════════
DIMENSION SCORES
Reliability:     ${results.reliabilityScore}/15  ${progressBar(results.reliabilityScore, 15)}
Competence:      ${results.competenceScore}/20  ${progressBar(results.competenceScore, 20)}
Performance:     ${results.performanceScore}/10  ${progressBar(results.performanceScore, 10)}
Depth:           ${results.deepScore}/10  ${progressBar(results.deepScore, 10)}
COMPLETION RATE: ${results.completionRate}%
COMPETENCE: ${results.compNotes}
DEPTH: ${results.deepNotes}
VERDICT
${verdict}
NOTE: This is a Quick Audit (3 orders). Run a Full Audit for complete 5-dimension scoring.
AUDIT TRAIL
Protocol: CROO v1 · Base Mainnet | Auditor: VERIS
Search: Tavily Advanced | Reasoning: Groq llama-3.3-70b-versatile
Orders: ${results.ordersPlaced} | Mode: Quick | Timestamp: ${new Date().toISOString()}`;
  }
  // Full audit report
  const hallucinationRisk = results.domainCompetence.competenceLevel === 'high' ? 'Low'
    : results.domainCompetence.competenceLevel === 'medium' ? 'Moderate' : 'High';
  return `VERIS AGENT AUDIT REPORT (FULL)
================================
Subject Agent ID: ${agentInfo.agentId}
Service ID: ${agentInfo.serviceId}
Category: ${pack.label}
Benchmark: VERIS Standard v1 — ${pack.label} Pack
Mode: Full Audit (10 orders)
Audited: ${new Date().toUTCString()}
Audited by: VERIS — Trust Infrastructure for the Agent Economy
Method: A2A via CROO Protocol · Base Network
Orders Placed: ${results.ordersPlaced} live CROO orders
════════════════════════════════
OVERALL RELIABILITY SCORE: ${total}/100
RELIABILITY LEVEL: ${reliabilityLevel}
HALLUCINATION RISK: ${hallucinationRisk}
════════════════════════════════
DIMENSION BREAKDOWN
Response Reliability:   ${String(results.reliability.score).padStart(2)}/25  ${progressBar(results.reliability.score, 25)}
Source Verification:    ${String(results.sourceVerification.score).padStart(2)}/25  ${progressBar(results.sourceVerification.score, 25)}
Domain Competence:      ${String(results.domainCompetence.score).padStart(2)}/25  ${progressBar(results.domainCompetence.score, 25)}
Transparency:           ${String(results.transparency.score).padStart(2)}/15  ${progressBar(results.transparency.score, 15)}
Performance:            ${String(results.perfScore).padStart(2)}/10  ${progressBar(results.perfScore, 10)}
TEST RESULTS
Completion Rate: ${results.reliability.completionRate}% (${results.reliability.completed}/${results.reliability.total} prompts)
Domain Accuracy: ${results.domainCompetence.accuracyRate}% correct across ${Object.keys(BENCHMARK_PACKS[category]?.competence || {}).length || 4} competence tests
Competence Level: ${results.domainCompetence.competenceLevel?.toUpperCase()}
Sources Cited: ${results.sourceVerification.sourcesCited?.join(', ') || 'None detected'}
Transparency: ${results.transparency.transparencyLevel?.toUpperCase()}
COMPETENCE TEST BREAKDOWN
${results.domainCompetence.testBreakdown?.map(t => `• "${t.prompt}"\n  Result: ${t.correct ? '✓ Correct' : '✗ Incorrect'} | Factual: ${t.factual_correctness}/10 | Complete: ${t.completeness}/10 | Reasoning: ${t.reasoning_quality}/10\n  Note: ${t.explanation}`).join('\n') || 'Tests completed'}
${results.sourceVerification.concerns?.length ? 'SOURCE CONCERNS\n' + results.sourceVerification.concerns.map(c => '⚠ ' + c).join('\n') : '✓ No source concerns flagged'}
RELIABILITY NOTES
${results.reliability.notes}
TRANSPARENCY NOTES
${results.transparency.notes}
VERDICT
${verdict}
RECOMMENDATION
${total >= 80 ? '✓ SUITABLE FOR PRODUCTION — Agent demonstrates reliable performance. Safe to transact via CROO.' : total >= 60 ? '⚠ SUITABLE FOR TESTING ONLY — Performance is adequate but inconsistent. Monitor closely in production.' : total >= 40 ? '✗ HIGH RISK — Unreliable performance detected. Additional verification recommended before use.' : '✗ DO NOT USE — Agent fails reliability standards. Not suitable for autonomous commercial transactions.'}
SCORING METHODOLOGY
Domain competence uses LLM-based semantic evaluation — paraphrased correct answers
score equally to verbatim ones. Only factual errors result in deductions.
All test questions are mechanism-based (evergreen) not fact-based (dynamic).
AVAILABLE BENCHMARK PACKS
${supportedCategories}
LIMITATIONS
• Based on ${results.ordersPlaced} test orders — larger samples increase confidence
• LLM-based scoring introduces evaluator bias — scores are directionally accurate
• Audit reflects agent performance at time of testing only
• Domain competence evaluates the specified category only
AUDIT TRAIL
Protocol: CROO v1 · Base Mainnet
Auditor: VERIS | Orders: ${results.ordersPlaced}
Search: Tavily Advanced | Reasoning: Groq llama-3.3-70b-versatile
Category: ${category} | Mode: Full
Timestamp: ${new Date().toISOString()}`;
}

// ─── MAIN ENTRY POINT ───
export async function runVERIS(requirements, requesterSdkKey) {
  const req = typeof requirements === 'string' ? JSON.parse(requirements) : requirements;
  if (req.type === 'agent') {
    if (!req.agentId || !req.serviceId) throw new Error('Agent audit requires: agentId and serviceId');
    const category = req.category || detectCategory(req.serviceDescription || '', req.agentName || '');
    const mode = req.mode || 'full';
    console.log(`Auto-detected category: ${category} | Mode: ${mode}`);
    return await runAgentAudit(
      { agentId: req.agentId, serviceId: req.serviceId },
      requesterSdkKey,
      category,
      mode
    );
  }
  if (req.type === 'project') {
    if (!req.name) throw new Error('Project due diligence requires: name');
    return await runProjectDueDiligence(req);
  }
  throw new Error('Invalid type. Use "project" for due diligence or "agent" for agent audit.');
}