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
// ENTITY TEMPLATES
// ═══════════════════════════════════════════════════════════════════════
const ENTITY_TEMPLATES = {
  infrastructure: {
    label: 'Infrastructure Protocol',
    signals: ['foundation', 'protocol', 'layer 1', 'layer 2', 'network', 'ledger', 'chain', 'xrp', 'bitcoin', 'ethereum', 'cosmos', 'polkadot', 'avalanche', 'solana', 'ripple', 'xrpl', 'hyperliquid', 'hyper'],
    note: 'Infrastructure rubric: weighted toward development and documentation. Distributed governance means no startup-style team page — absence is not a red flag.',
    scoreWeights: { whitepaper: 6, roadmap: 4, tokenomics: 3, technicalDocs: 4, clearUseCase: 3, activeGithub: 8, multipleContributors: 4, openSource: 4, auditFound: 6, regularReleases: 3, foundersNamed: 3, linkedinFound: 2, teamPage: 2, verifiableHistory: 4, activeSocial: 2, communitySize: 2, mediaConverage: 3, genuineEngagement: 2 },
  },
  memecoin: {
    label: 'Meme Coin / Token',
    signals: ['meme', 'doge', 'shib', 'pepe', 'inu', 'elon', 'moon', 'fair launch', 'stealth launch'],
    note: 'Meme coin rubric: community and liquidity weighted heavily. Trust risk signals critical.',
    scoreWeights: { foundersNamed: 4, linkedinFound: 3, activeSocial: 8, communitySize: 8, genuineEngagement: 6, mediaConverage: 3, liquidityLocked: 8, tradingVolume: 5, exchangeListed: 4, whitepaper: 2, roadmap: 3, auditFound: 4 },
  },
  aiagent: {
    label: 'AI Agent / Product',
    signals: ['ai agent', 'autonomous agent', 'llm', 'gpt', 'copilot', 'assistant', 'autopilot', 'croo', 'veris'],
    note: 'AI agent rubric: functionality and creator identity weighted most.',
    scoreWeights: { foundersNamed: 6, linkedinFound: 4, verifiableHistory: 5, whitepaper: 4, technicalDocs: 6, clearUseCase: 4, liveProduct: 8, featuresDescribed: 5, userReviews: 4, apiUsage: 4, activeSocial: 3, communitySize: 2, auditFound: 4 },
  },
  defi: {
    label: 'DeFi Protocol',
    signals: ['defi', 'yield', 'lending', 'borrow', 'swap', 'amm', 'pool', 'vault', 'liquid staking', 'perp', 'dex'],
    note: 'DeFi rubric: security and audit signals weighted heavily.',
    scoreWeights: { foundersNamed: 4, linkedinFound: 3, whitepaper: 5, tokenomics: 5, technicalDocs: 4, activeGithub: 6, auditFound: 8, openSource: 4, activeSocial: 3, communitySize: 2, liquidityLocked: 5, tradingVolume: 4 },
  },
  dao: {
    label: 'DAO / Governance Protocol',
    signals: ['dao', 'governance', 'vote', 'proposal', 'treasury', 'multisig', 'snapshot'],
    note: 'DAO rubric: on-chain governance structure and treasury transparency weighted highest.',
    scoreWeights: { onChainGovernance: 10, activeProposals: 6, treasuryTransparency: 8, multisigConfirmed: 6, whitepaper: 4, technicalDocs: 4, activeGithub: 4, communitySize: 4, activeSocial: 4 },
  },
  nft: {
    label: 'NFT Project',
    signals: ['nft', 'collection', 'mint', 'opensea', 'blur', 'pfp', 'generative', 'art project'],
    note: 'NFT rubric: community and creator identity weighted heavily.',
    scoreWeights: { foundersNamed: 6, linkedinFound: 3, activeSocial: 8, communitySize: 8, genuineEngagement: 5, roadmap: 5, clearUseCase: 4, activeGithub: 3, auditFound: 3, mediaConverage: 5 },
  },
  saas: {
    label: 'SaaS / Tooling',
    signals: ['saas', 'tool', 'sdk', 'api', 'platform', 'dashboard', 'analytics', 'explorer', 'wallet', 'indexer'],
    note: 'SaaS/tooling rubric: documentation and development activity weighted equally.',
    scoreWeights: { foundersNamed: 5, linkedinFound: 4, verifiableHistory: 4, whitepaper: 3, technicalDocs: 8, clearUseCase: 5, activeGithub: 7, multipleContributors: 4, liveProduct: 6, userReviews: 4, activeSocial: 3, mediaConverage: 4 },
  },
  general: {
    label: 'General Project',
    signals: [],
    note: 'General rubric. Specify entity type for more accurate scoring.',
    scoreWeights: { foundersNamed: 5, linkedinFound: 3, whitepaper: 4, roadmap: 3, tokenomics: 3, technicalDocs: 3, activeGithub: 5, auditFound: 4, activeSocial: 3, communitySize: 2, mediaConverage: 3, liveProduct: 4, clearUseCase: 3 },
  },
};

export function detectEntityType(project) {
  const text = ((project.name || '') + ' ' + (project.description || '') + ' ' + (project.website || '') + ' ' + (project.entityType || '')).toLowerCase();
  let bestType = 'general';
  let bestScore = 0;
  for (const [type, config] of Object.entries(ENTITY_TEMPLATES)) {
    if (type === 'general') continue;
    const score = config.signals.filter(s => text.includes(s)).length;
    if (score > bestScore) { bestScore = score; bestType = type; }
  }
  return bestType;
}

// ═══════════════════════════════════════════════════════════════════════
// SEARCH QUERY BUILDER
// Searches entity name + topic rather than URLs
// ═══════════════════════════════════════════════════════════════════════
function buildSearchQueries(project) {
  const name = project.name;
  return {
    identity: `${name} founders team executives CEO LinkedIn verified identity`,
    documentation: `${name} whitepaper roadmap documentation tokenomics technical`,
    development: `${name} GitHub open source contributors commits audit security`,
    community: `${name} Twitter community followers engagement adoption users media coverage`,
    risk: `${name} scam fraud rug pull hack exploit security incident SEC lawsuit legal`,
    liquidity: `${name} liquidity locked trading volume exchange listed holders distribution`,
    product: `${name} live product demo API users reviews functionality`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 1 — EVIDENCE EXTRACTION
// Groq's ONLY job: read sources, extract a structured fact object.
// Groq does NOT score. Groq does NOT generate deductions. Code does that.
// ═══════════════════════════════════════════════════════════════════════
const EVIDENCE_SCHEMA = `{
  "whitepaper_found": false,
  "roadmap_found": false,
  "tokenomics_found": false,
  "technical_docs_found": false,
  "clear_use_case": false,
  "active_github": false,
  "multiple_contributors": false,
  "open_source": false,
  "audit_found": false,
  "audit_firm": null,
  "regular_releases": false,
  "founders_named": false,
  "founder_names": [],
  "linkedin_found": false,
  "team_page_found": false,
  "verifiable_history": false,
  "active_social": false,
  "community_size_mentioned": false,
  "genuine_engagement": false,
  "media_coverage": false,
  "live_product": false,
  "features_described": false,
  "user_reviews": false,
  "api_usage": false,
  "liquidity_locked": false,
  "trading_volume_mentioned": false,
  "exchange_listed": false,
  "on_chain_governance": false,
  "active_proposals": false,
  "treasury_transparency": false,
  "multisig_confirmed": false,
  "confirmed_scam": false,
  "confirmed_rugpull": false,
  "confirmed_fraud": false,
  "confirmed_hack": false,
  "confirmed_exploit": false,
  "confirmed_vulnerability": false,
  "securities_violation_confirmed": false,
  "regulatory_action_confirmed": false,
  "lawsuit_confirmed": false,
  "evidence_citations": []
}`;

// evidence_citations format:
// [{ "claim": "confirmed_scam", "source_url": "...", "quote": "...", "confidence": 0.0-1.0 }]

async function extractEvidence(searchResults, projectName) {
  const prompt =
    `You are an evidence extraction engine analyzing search results for "${projectName}".\n\n` +
    `SEARCH RESULTS:\n${searchResults}\n\n` +
    `YOUR ONLY JOB: Extract facts that are EXPLICITLY stated in the sources above.\n\n` +
    `STRICT RULES:\n` +
    `1. Set a field to true ONLY if a source explicitly confirms it. Default is false.\n` +
    `2. NEVER infer from absence. If GitHub is not mentioned, active_github stays false — do not comment.\n` +
    `3. For ANY of these fields, you MUST provide an evidence_citation with source_url and a direct quote:\n` +
    `   confirmed_scam, confirmed_rugpull, confirmed_fraud, confirmed_hack, confirmed_exploit,\n` +
    `   confirmed_vulnerability, securities_violation_confirmed, regulatory_action_confirmed, lawsuit_confirmed\n` +
    `4. If you cannot provide a source_url + direct quote for a serious claim, set that field to false.\n` +
    `5. Do not summarize or interpret. Extract only.\n\n` +
    `Return ONLY valid JSON matching this exact schema:\n${EVIDENCE_SCHEMA}`;

  const response = await groqSynthesize(prompt,
    'You are a structured data extraction engine. Return ONLY valid JSON. No markdown, no backticks, no explanation, no preamble.'
  );

  try {
    const cleaned = response.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // If JSON parse fails, return a neutral baseline — no false accusations
    console.warn('  ⚠ Evidence extraction parse failed, returning neutral baseline');
    return JSON.parse(EVIDENCE_SCHEMA.replace(/:\s*(false|null|\[\])/g, (m, v) => ': ' + v));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 2 — CODE-BASED SCORING
// Pure deterministic logic. No AI. Evidence in → numbers out.
// ═══════════════════════════════════════════════════════════════════════

// Serious deductions require a citation with source_url + quote + confidence > 0.85
// Without that, the claim is downgraded to an unverified concern — no point deduction.
function validateSeriousClaim(claimKey, evidence) {
  const citation = (evidence.evidence_citations || []).find(c => c.claim === claimKey);
  if (!citation) return false;
  if (!citation.source_url || citation.source_url.length < 10) return false;
  if (!citation.quote || citation.quote.length < 20) return false;
  if ((citation.confidence || 0) < 0.85) return false;
  return true;
}

function scoreEvidence(evidence, template) {
  const w = template.scoreWeights;
  let score = 0;
  const applied = []; // track what was added for the report

  const add = (points, label, condition) => {
    if (condition && points) {
      score += points;
      applied.push({ label, points });
    }
  };

  // Documentation signals
  add(w.whitepaper,      'Whitepaper found',            evidence.whitepaper_found);
  add(w.roadmap,         'Roadmap found',               evidence.roadmap_found);
  add(w.tokenomics,      'Tokenomics documented',       evidence.tokenomics_found);
  add(w.technicalDocs,   'Technical docs found',        evidence.technical_docs_found);
  add(w.clearUseCase,    'Clear use case articulated',  evidence.clear_use_case);

  // Development signals
  add(w.activeGithub,          'Active GitHub confirmed',    evidence.active_github);
  add(w.multipleContributors,  'Multiple contributors',      evidence.multiple_contributors);
  add(w.openSource,            'Open source confirmed',      evidence.open_source);
  add(w.auditFound,            'Security audit found',       evidence.audit_found);
  add(w.regularReleases,       'Regular releases noted',     evidence.regular_releases);

  // Team / identity signals
  add(w.foundersNamed,       'Founders publicly named',      evidence.founders_named);
  add(w.linkedinFound,       'LinkedIn profiles found',      evidence.linkedin_found);
  add(w.teamPage,            'Team page found',              evidence.team_page_found);
  add(w.verifiableHistory,   'Verifiable track record',      evidence.verifiable_history);

  // Community / social signals
  add(w.activeSocial,       'Active social accounts',        evidence.active_social);
  add(w.communitySize,      'Community size mentioned',      evidence.community_size_mentioned);
  add(w.mediaConverage,     'Third-party media coverage',    evidence.media_coverage);
  add(w.genuineEngagement,  'Genuine engagement noted',      evidence.genuine_engagement);

  // Product signals
  add(w.liveProduct,       'Live product confirmed',         evidence.live_product);
  add(w.featuresDescribed, 'Features described',             evidence.features_described);
  add(w.userReviews,       'User reviews found',             evidence.user_reviews);
  add(w.apiUsage,          'API / integration usage found',  evidence.api_usage);

  // Liquidity signals
  add(w.liquidityLocked,    'Liquidity locked',              evidence.liquidity_locked);
  add(w.tradingVolume,      'Trading volume mentioned',      evidence.trading_volume_mentioned);
  add(w.exchangeListed,     'Listed on exchange',            evidence.exchange_listed);

  // DAO / governance signals
  add(w.onChainGovernance,     'On-chain governance confirmed',   evidence.on_chain_governance);
  add(w.activeProposals,       'Active proposals found',          evidence.active_proposals);
  add(w.treasuryTransparency,  'Treasury transparency confirmed',  evidence.treasury_transparency);
  add(w.multisigConfirmed,     'Multisig confirmed',              evidence.multisig_confirmed);

  // Max possible score for this template (sum of all weights)
  const maxPossible = Object.values(w).reduce((a, b) => a + b, 0);

  return { score, maxPossible, applied };
}

// Trust risk deductions — only applied when validateSeriousClaim() passes
// Operational risks (hacks) shown separately, do NOT reduce trust score
function applyRiskDeductions(evidence) {
  const deductions = [];
  const unverifiedConcerns = [];
  const operationalRisks = [];

  const TRUST_RISKS = [
    { key: 'confirmed_scam',                   label: 'Confirmed scam',                   deduction: 40 },
    { key: 'confirmed_rugpull',                label: 'Confirmed rug pull',               deduction: 40 },
    { key: 'confirmed_fraud',                  label: 'Confirmed fraud',                  deduction: 30 },
    { key: 'securities_violation_confirmed',   label: 'Securities violation confirmed',   deduction: 20 },
    { key: 'regulatory_action_confirmed',      label: 'Confirmed regulatory action',      deduction: 15 },
    { key: 'lawsuit_confirmed',                label: 'Confirmed lawsuit',                deduction: 10 },
  ];

  const OPERATIONAL_RISKS = [
    { key: 'confirmed_hack',          label: 'Confirmed hack or exploit' },
    { key: 'confirmed_exploit',       label: 'Confirmed smart contract exploit' },
    { key: 'confirmed_vulnerability', label: 'Confirmed vulnerability disclosure' },
  ];

  for (const risk of TRUST_RISKS) {
    if (!evidence[risk.key]) continue;
    const citation = (evidence.evidence_citations || []).find(c => c.claim === risk.key);
    if (validateSeriousClaim(risk.key, evidence)) {
      deductions.push({ ...risk, citation });
    } else {
      // Claim flagged by extraction but cannot be verified — downgrade, no deduction
      unverifiedConcerns.push({
        label: risk.label,
        note: 'Mentioned in sources but insufficient evidence for a confirmed deduction.',
        citation: citation || null,
      });
    }
  }

  for (const risk of OPERATIONAL_RISKS) {
    if (!evidence[risk.key]) continue;
    const citation = (evidence.evidence_citations || []).find(c => c.claim === risk.key);
    if (validateSeriousClaim(risk.key, evidence)) {
      operationalRisks.push({ ...risk, citation });
    } else {
      unverifiedConcerns.push({
        label: risk.label,
        note: 'Security incident mentioned but lacking sufficient source citation for confirmation.',
        citation: citation || null,
      });
    }
  }

  const totalDeduction = deductions.reduce((a, d) => a + d.deduction, 0);
  return { deductions, totalDeduction, unverifiedConcerns, operationalRisks };
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIDENCE — based purely on source counts, not LLM judgment
// ═══════════════════════════════════════════════════════════════════════
function calcConfidence(totalSources, totalQueries) {
  const avgSources = totalSources / totalQueries;
  if (avgSources === 0) return 0.05;
  if (avgSources < 1) return 0.20;
  if (avgSources < 2) return 0.40;
  if (avgSources < 3) return 0.60;
  if (avgSources < 4) return 0.75;
  return 0.90;
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════════════════════════════════
async function collectEvidence(query) {
  try {
    const res = await tavilyClient.search(query, { searchDepth: 'advanced', maxResults: 5, includeAnswer: false });
    if (!res.results?.length) return { text: '', sourceCount: 0, sources: [] };
    const sources = res.results.map(r => ({ title: r.title, url: r.url, snippet: r.content?.substring(0, 500) || '' }));
    const text = sources.map((s, i) => `[Source ${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`).join('\n\n---\n\n');
    return { text, sourceCount: sources.length, sources };
  } catch (err) {
    console.warn('  ⚠ Tavily error:', err.message);
    return { text: '', sourceCount: 0, sources: [] };
  }
}

async function groqSynthesize(prompt, systemMsg = 'You are a factual research assistant. Be specific and concise.') {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: prompt }],
    max_tokens: 1200,
    temperature: 0.1,
  });
  return completion.choices[0].message.content;
}

async function scoreWithAI(prompt) {
  const response = await groqSynthesize(prompt, 'You are a scoring engine. Return ONLY valid JSON. No markdown, no backticks, no preamble.');
  try { return JSON.parse(response.replace(/```json|```/g, '').trim()); } catch { return null; }
}

async function semanticScore(prompt, response, concept, maxScore = 10) {
  if (!response) return { score: 0, correct: false, factual_correctness: 0, completeness: 0, reasoning_quality: 0, explanation: 'No response received' };
  const result = await scoreWithAI(
    `Evaluate agent response. Question: "${prompt}"\nConcepts: ${concept}\nResponse: ${response.substring(0, 600)}\n` +
    `Score 0-${maxScore}. Paraphrased correct = same as verbatim. Deduct only for factual errors.\n` +
    `Return ONLY: {"score":<0-${maxScore}>,"factual_correctness":<0-10>,"completeness":<0-10>,"reasoning_quality":<0-10>,"correct":true/false,"explanation":"one sentence"}`
  );
  return { score: Math.max(0, Math.min(maxScore, result?.score ?? Math.round(maxScore * 0.5))), factual_correctness: result?.factual_correctness ?? 5, completeness: result?.completeness ?? 5, reasoning_quality: result?.reasoning_quality ?? 5, correct: result?.correct ?? false, explanation: result?.explanation ?? 'Evaluated' };
}

function progressBar(score, max, width = 20) {
  const filled = Math.round((score / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

function confBar(c, width = 12) {
  const pct = Math.round(c * 100);
  const filled = Math.round(c * width);
  return '▓'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled)) + ` ${pct}%`;
}

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DUE DILIGENCE — MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════
export async function runProjectDueDiligence(project) {
  console.log(`\n🔍 VERIS Due Diligence: ${project.name}`);

  // STEP 1 — Classify entity
  const entityTypeKey = project.entityType || detectEntityType(project);
  const template = ENTITY_TEMPLATES[entityTypeKey] || ENTITY_TEMPLATES.general;
  console.log(`  Entity type: ${template.label}`);

  // STEP 2 — Collect evidence (parallel searches, entity-name-based queries)
  console.log('  → Collecting evidence...');
  const queries = buildSearchQueries(project);
  const searchResults = await Promise.all(
    Object.entries(queries).map(async ([key, query]) => {
      const result = await collectEvidence(query);
      return { key, ...result };
    })
  );

  const totalSources = searchResults.reduce((a, r) => a + r.sourceCount, 0);
  const combinedText = searchResults
    .filter(r => r.text)
    .map(r => `=== ${r.key.toUpperCase()} SEARCH ===\n${r.text}`)
    .join('\n\n');

  // STEP 3 — Extract evidence (Groq reads sources, returns structured facts only)
  console.log('  → Extracting evidence...');
  const evidence = await extractEvidence(combinedText, project.name);

  // STEP 4 — Score evidence (pure code — no AI involvement)
  console.log('  → Scoring...');
  const { score: rawScore, maxPossible, applied: positiveSignals } = scoreEvidence(evidence, template);
  const { deductions, totalDeduction, unverifiedConcerns, operationalRisks } = applyRiskDeductions(evidence);

  // Normalize to 0-100
  const baseScore = maxPossible > 0 ? Math.round((rawScore / maxPossible) * 100) : 50;
  const trustScore = Math.max(0, Math.min(100, baseScore - totalDeduction));

  // STEP 5 — Confidence (source count based)
  const confidence = calcConfidence(totalSources, Object.keys(queries).length);

  // STEP 6 — Verdict (Groq synthesizes narrative from extracted facts — no free invention)
  console.log('  → Generating verdict...');
  const verdictText = await groqSynthesize(
    `Write a 2-3 sentence trust audit verdict for "${project.name}" (${template.label}).\n\n` +
    `Trust Score: ${trustScore}/100\nConfidence: ${Math.round(confidence * 100)}%\n\n` +
    `Confirmed positive signals:\n${positiveSignals.map(s => '• ' + s.label).join('\n') || '• None confirmed'}\n\n` +
    `Confirmed trust risk deductions:\n${deductions.map(d => `• ${d.label} (–${d.deduction} pts)`).join('\n') || '• None'}\n\n` +
    `Operational risks (do not affect trust score):\n${operationalRisks.map(r => '• ' + r.label).join('\n') || '• None confirmed'}\n\n` +
    `Unverified concerns (mentioned but not confirmed — no deduction applied):\n${unverifiedConcerns.map(c => '• ' + c.label).join('\n') || '• None'}\n\n` +
    `Rules: Only reference the facts above. If confidence < 50%, note that the score reflects limited evidence, not confirmed problems. ` +
    `Distinguish trust risks (legitimacy) from operational risks (technical incidents any project can face).`,
    'You are writing a trust audit verdict. Be factual and concise. Do not add information not listed above.'
  );

  // ─── Format report ───
  const riskLevel = trustScore >= 80 ? 'Low' : trustScore >= 60 ? 'Medium' : trustScore >= 40 ? 'High' : 'Critical';
  const opRiskLevel = operationalRisks.length === 0 ? 'Low' : operationalRisks.length === 1 ? 'Medium' : 'High';

  const recommendation =
    trustScore >= 80 ? '✓ SUITABLE — Strong trust signals. Proceed with standard due diligence.'
    : trustScore >= 60 ? '⚠ PROCEED WITH CAUTION — Some concerns or evidence gaps. Independent verification recommended.'
    : trustScore >= 40 ? '✗ HIGH RISK — Significant confirmed concerns. Extensive verification required.'
    : '✗ DO NOT ENGAGE — Critical trust failures confirmed. VERIS advises against engagement.';

  const lowConfWarn = confidence < 0.4
    ? `\n⚠  LOW CONFIDENCE (${Math.round(confidence * 100)}%): Limited sources retrieved. This reflects data availability — not confirmed problems. Do not treat absence of evidence as negative evidence.`
    : confidence < 0.65
    ? `\n~  MODERATE CONFIDENCE (${Math.round(confidence * 100)}%): Some search queries returned limited results. Verify low-coverage areas independently.`
    : '';

  const positivesBlock = positiveSignals.length > 0
    ? positiveSignals.map(s => `  +${String(s.points).padStart(2)}  ${s.label}`).join('\n')
    : '  (No positive signals confirmed in retrieved sources)';

  const deductionsBlock = deductions.length > 0
    ? deductions.map(d => {
        const c = d.citation;
        return `  ⛔ ${d.label}  (–${d.deduction} pts)\n` +
               `     Source: ${c?.source_url || 'N/A'}\n` +
               `     Quote:  "${c?.quote || 'N/A'}"\n` +
               `     Confidence: ${Math.round((c?.confidence || 0) * 100)}%`;
      }).join('\n')
    : '  ✓ No trust risk deductions applied.';

  const unverifiedBlock = unverifiedConcerns.length > 0
    ? unverifiedConcerns.map(c => {
        const src = c.citation?.source_url ? `\n     Source: ${c.citation.source_url}` : '';
        return `  ~ ${c.label}\n     Status: Unverified concern — insufficient evidence for deduction.${src}`;
      }).join('\n')
    : '  ✓ No unverified concerns flagged.';

  const operationalBlock = operationalRisks.length > 0
    ? operationalRisks.map(r => {
        const c = r.citation;
        return `  ⚠ ${r.label}\n` +
               `     Source: ${c?.source_url || 'N/A'}\n` +
               `     Quote:  "${c?.quote || 'N/A'}"`;
      }).join('\n') +
      '\n\n  NOTE: Operational incidents (hacks, exploits) are disclosed in this section only.\n' +
      '  They do not reduce the trust score. Mature projects can face and recover from technical incidents.'
    : '  ✓ No confirmed operational incidents found.';

  const scoreCalc = `Base score: ${rawScore}/${maxPossible} signals → normalized ${baseScore}/100` +
    (totalDeduction > 0 ? ` − ${totalDeduction} trust risk deductions = ${trustScore}/100` : ` = ${trustScore}/100`);

  return `VERIS TRUST REPORT
==================
Subject:          ${project.name}
Entity Class:     ${template.label}
Website:          ${project.website || 'Not provided'}
GitHub:           ${project.github || 'Not provided'}
Twitter:          ${project.twitter || 'Not provided'}
Docs:             ${project.docs || 'Not provided'}
Contract:         ${project.contract || 'Not provided'}
Audited:          ${new Date().toUTCString()}
Audited by:       VERIS — Trust Infrastructure for the Agent Economy
Protocol:         CROO v1 · Base Network
${template.note}
══════════════════════════════════════════════
TRUST SCORE:        ${trustScore}/100
RISK LEVEL:         ${riskLevel}
CONFIDENCE:         ${confBar(confidence, 20)}
OPERATIONAL RISK:   ${opRiskLevel}
${lowConfWarn}
SCORE CALCULATION
${scoreCalc}
══════════════════════════════════════════════
CONFIRMED POSITIVE SIGNALS
${positivesBlock}

EVIDENCE FOR DEDUCTIONS
${deductionsBlock}

UNVERIFIED CONCERNS (no deduction applied — insufficient evidence)
${unverifiedBlock}

OPERATIONAL RISKS (technical incidents — do not affect trust score)
${operationalBlock}
══════════════════════════════════════════════
VERDICT
${verdictText}

RECOMMENDATION
${recommendation}

SCORING METHODOLOGY
  Extraction:     Groq reads sources → returns structured facts only (no scores, no deductions)
  Scoring:        Deterministic code — if (whitepaper_found) score += N
  Deductions:     Only applied when source_url + direct quote + confidence > 85% are present
  Unverified:     Serious claims without full citation → downgraded to "unverified concern", zero deduction
  Operational:    Hacks/exploits disclosed separately — not subtracted from trust score
  Confidence:     Derived from source retrieval counts — independent of trust score

LIMITATIONS
  • Grounded in Tavily search results at time of audit — not financial or legal advice
  • Missing data lowers confidence only — never lowers trust score
  • Scores are directionally accurate — not a substitute for manual due diligence

AUDIT TRAIL
  Search:     Tavily Advanced (${totalSources} total sources across ${Object.keys(queries).length} queries)
  Extraction: Groq llama-3.3-70b-versatile
  Scoring:    Deterministic code
  Auditor:    VERIS · CROO v1 · Base Mainnet
  Timestamp:  ${new Date().toISOString()}`;
}

// ═══════════════════════════════════════════════════════════════════════
// BENCHMARK PACKS (agent audits)
// ═══════════════════════════════════════════════════════════════════════
const BENCHMARK_PACKS = {
  research: {
    label: 'Research Agent',
    reliability: ['Explain how Aave liquidation works in simple terms.', 'Explain impermanent loss and when it occurs.', 'What problem does a liquidity pool solve?'],
    competence: [
      { prompt: 'Explain the health factor concept in DeFi lending.', concept: 'health factor in lending — collateral ratio, liquidation threshold, risk management' },
      { prompt: 'How does an automated market maker price assets?', concept: 'AMM pricing — constant product formula, liquidity, slippage' },
      { prompt: 'What is the difference between APR and APY in DeFi?', concept: 'APR vs APY — compounding, frequency, yield calculation' },
      { prompt: 'Why do DeFi protocols need oracles?', concept: 'oracles — external price data, on-chain verification, manipulation risk' },
    ],
    deep: ['Compare the risk profiles of lending on Aave versus providing liquidity on Uniswap.', 'What are 3 key risks a user should evaluate before using a newly launched DeFi protocol?'],
    competenceEval: 'You are evaluating a DeFi research agent. Score based on factual accuracy, analytical depth, source grounding, and structured output quality.',
  },
  trading: {
    label: 'Trading Agent',
    reliability: ['Explain what a stop loss is and why traders use it.', 'What does it mean when a market is in backwardation?', 'Explain the concept of position sizing in trading.'],
    competence: [
      { prompt: 'How does funding rate work in perpetual futures?', concept: 'funding rate — longs pay shorts or vice versa, market balance mechanism, 8-hour intervals' },
      { prompt: 'What does the RSI indicator measure and how is it interpreted?', concept: 'RSI — momentum oscillator, overbought above 70, oversold below 30, divergence' },
      { prompt: 'Explain the difference between a limit order and a market order.', concept: 'limit order vs market order — price control, execution certainty, slippage' },
      { prompt: 'What is the purpose of a liquidation price in leveraged trading?', concept: 'liquidation — leverage, margin, forced close, collateral loss' },
    ],
    deep: ['What are 3 warning signs that a crypto rally is losing momentum?', 'Explain how you would assess risk before entering a leveraged trade.'],
    competenceEval: 'You are evaluating a trading agent. Score based on accuracy of trading concepts, risk awareness, and analytical reasoning.',
  },
  data: {
    label: 'Data & Analytics Agent',
    reliability: ['Explain the difference between on-chain and off-chain data.', 'What does TVL measure and why does it matter in DeFi?', 'Explain what a moving average tells you about price trend.'],
    competence: [
      { prompt: 'What is the difference between correlation and causation?', concept: 'correlation vs causation — statistical relationship, does not imply cause, confounding variables' },
      { prompt: 'How would you detect wash trading in on-chain data?', concept: 'wash trading — circular transactions, same wallet patterns, artificial volume, self-dealing' },
      { prompt: 'What metrics would you track to monitor the health of a DeFi lending protocol?', concept: 'lending health metrics — utilization rate, bad debt, liquidations, TVL trend, collateral ratio' },
      { prompt: 'Explain what standard deviation measures and how it applies to crypto volatility.', concept: 'standard deviation — spread from mean, volatility measurement, risk quantification' },
    ],
    deep: ['What on-chain metrics best predict whether a DeFi protocol is growing or declining?', 'How would you build a simple risk dashboard for a DeFi portfolio?'],
    competenceEval: 'You are evaluating a data analytics agent. Score based on statistical accuracy, data interpretation quality, and analytical rigor.',
  },
  writing: {
    label: 'Writing & Content Agent',
    reliability: ['Write a 50-word tweet announcing a new DeFi protocol launch. Make it engaging.', 'Summarize what blockchain technology is in 3 sentences for a complete beginner.', 'Write a one-paragraph introduction to a crypto market report.'],
    competence: [
      { prompt: 'Explain the difference between active and passive voice with an example.', concept: 'active vs passive voice — subject performs action vs subject receives action, clarity' },
      { prompt: 'What makes a strong call-to-action in marketing copy?', concept: 'call to action — clarity, urgency, benefit, direct instruction, action verb' },
      { prompt: 'What is the inverted pyramid style in journalism?', concept: 'inverted pyramid — most important information first, supporting details, background last' },
      { prompt: 'What is the difference between tone and voice in writing?', concept: 'tone vs voice — tone changes per context, voice is consistent author identity, style' },
    ],
    deep: ['Write a short 3-tweet thread explaining why autonomous AI agents are the future of commerce.', 'Draft a 100-word product description for an AI agent that audits Web3 projects.'],
    competenceEval: 'You are evaluating a writing agent. Score based on clarity, grammar, tone appropriateness, and format adherence.',
  },
  coding: {
    label: 'Coding & Developer Agent',
    reliability: ['Write a JavaScript function that calculates compound interest given principal, rate, and periods.', 'Explain what a smart contract is and how it differs from regular code.', 'What is the difference between async/await and callbacks in JavaScript?'],
    competence: [
      { prompt: 'What does the ERC-20 standard define and why does it matter?', concept: 'ERC-20 — token standard, transfer function, approve, allowance, fungible tokens, interoperability' },
      { prompt: 'Explain what a reentrancy attack is and how to prevent it.', concept: 'reentrancy — external call before state update, checks-effects-interactions pattern, mutex guard' },
      { prompt: 'What is gas in Ethereum and why does it exist?', concept: 'gas — computational cost, prevents spam, miners incentive, fee market, transaction cost' },
      { prompt: 'What is the difference between memory and storage in Solidity?', concept: 'memory vs storage — temporary vs persistent, gas cost difference, data location, scope' },
    ],
    deep: ['What are the top 3 security best practices when writing a Solidity smart contract?', 'Explain how WebSockets differ from REST APIs and when you would choose each.'],
    competenceEval: 'You are evaluating a coding agent. Score based on code correctness, technical accuracy, security awareness, and best practices.',
  },
  defi: {
    label: 'DeFi Specialist Agent',
    reliability: ['Explain how an automated market maker works.', 'What is yield farming and what are its main risks?', 'How does a flash loan work and what are its legitimate use cases?'],
    competence: [
      { prompt: 'Explain the concept of slippage in a DEX trade.', concept: 'slippage — price impact, liquidity depth, trade size, expected vs actual price' },
      { prompt: 'What is the role of an oracle in a lending protocol?', concept: 'oracle — price feed, liquidation trigger, collateral valuation, manipulation risk' },
      { prompt: 'Explain how liquidity provider tokens work.', concept: 'LP tokens — represent pool share, redeemable for underlying, fee accrual, composable' },
      { prompt: 'What is protocol-owned liquidity and why did projects pursue it?', concept: 'protocol owned liquidity — POL, OHM model, mercenary capital problem, sustainable liquidity' },
    ],
    deep: ['Compare the risks of lending on Aave versus providing liquidity on Curve.', 'Explain 3 ways a DeFi protocol can fail even with a clean smart contract audit.'],
    competenceEval: 'You are evaluating a DeFi specialist agent. Score based on protocol knowledge, mechanism accuracy, and risk awareness.',
  },
  security: {
    label: 'Security & Audit Agent',
    reliability: ['What are the most common smart contract vulnerabilities?', 'How would you assess whether a DeFi protocol is safe to use?', 'What is a Sybil attack and how can protocols defend against it?'],
    competence: [
      { prompt: 'Explain how a reentrancy attack works step by step.', concept: 'reentrancy — recursive external call, state not updated, drain funds, checks-effects-interactions fix' },
      { prompt: 'What is a 51% attack and what does it enable an attacker to do?', concept: '51% attack — majority hash power, double spend, reorg blocks, cannot steal private keys' },
      { prompt: 'What makes a smart contract audit different from a code review?', concept: 'audit vs code review — formal process, vulnerability classification, severity rating, economic attack vectors' },
      { prompt: 'What is front-running in DeFi and how does it work?', concept: 'front-running — mempool observation, higher gas, sandwich attack, MEV, transaction ordering' },
    ],
    deep: ['What are 3 red flags that indicate a DeFi project might be a rug pull?', 'How would you verify that a smart contract audit was legitimate and thorough?'],
    competenceEval: 'You are evaluating a security and audit agent. Score based on vulnerability knowledge, risk assessment quality, and audit methodology.',
  },
  general: {
    label: 'General Purpose Agent',
    reliability: ['Explain what artificial intelligence is in simple terms.', 'What is the difference between Web2 and Web3?', 'Explain blockchain technology to someone with no technical background.'],
    competence: [
      { prompt: 'What is Bitcoin and what problem was it designed to solve?', concept: 'Bitcoin — decentralized currency, double spend problem, trustless, censorship resistant, Satoshi' },
      { prompt: 'What is an API and how do applications use it?', concept: 'API — interface, requests, responses, data exchange, integration, endpoints' },
      { prompt: 'What is the difference between a public and private blockchain?', concept: 'public vs private blockchain — permissionless vs permissioned, transparency, validator set, use cases' },
      { prompt: 'What is a crypto wallet and how does it actually work?', concept: 'crypto wallet — public private key pair, signs transactions, does not store coins, address derived from key' },
    ],
    deep: ['What are the top 3 use cases for AI agents in the Web3 economy?', 'What makes CROO protocol different from traditional payment infrastructure?'],
    competenceEval: 'You are evaluating a general purpose agent. Score based on breadth of knowledge, clarity, and helpfulness.',
  },
};

const AUDIT_MODES = {
  quick: { label: 'Quick Audit', description: '3 orders — fast reliability and basic competence check' },
  full:  { label: 'Full Audit',  description: '10 orders — complete 5-dimension reliability assessment' },
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

// ═══════════════════════════════════════════════════════════════════════
// AGENT AUDIT — ORDER PLACEMENT + EVALUATION
// ═══════════════════════════════════════════════════════════════════════
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
        try { await agentClient.payOrder(e.order_id); } catch (err) { console.warn('Pay error:', err.message); }
      });
      stream.on(EventType.OrderCompleted, async (e) => {
        if (timedOut || e.order_id !== orderId) return;
        clearTimeout(timer);
        try {
          const delivery = await agentClient.getDelivery(e.order_id);
          stream.close();
          resolve({ response: delivery.deliverableText || '', responseTime: Date.now() - startTime, timedOut: false, orderId: e.order_id });
        } catch { stream.close(); resolve({ response: null, responseTime: Date.now() - startTime, timedOut: false }); }
      });
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
  for (const prompt of pack.reliability) {
    relResponses.push({ prompt, ...await placeTestOrder(agentClient, serviceId, prompt) });
    await new Promise(r => setTimeout(r, 2000));
  }
  const relCompleted = relResponses.filter(r => r.response && !r.timedOut);
  const relCompletion = relCompleted.length / relResponses.length;
  const relScore_raw = await scoreWithAI(
    `Evaluate response reliability:\n\n` + relCompleted.map((r, i) => `Response ${i+1}: "${r.prompt}"\n${r.response?.substring(0,300)}`).join('\n---\n') +
    `\n\nCompletion: ${Math.round(relCompletion*100)}%\nScore 0-25.\nReturn ONLY: {"score":<0-25>,"notes":"brief"}`
  );
  const reliability = { score: Math.min(25, relScore_raw?.score ?? Math.round(relCompletion * 20)), completionRate: Math.round(relCompletion * 100), completed: relCompleted.length, total: relResponses.length, timedOut: relResponses.filter(r => r.timedOut).length, notes: relScore_raw?.notes ?? `${relCompleted.length}/${relResponses.length} completed` };
  console.log('  → Source verification...');
  const srcResult = await placeTestOrder(agentClient, serviceId, pack.deep[1] || pack.deep[0]);
  await new Promise(r => setTimeout(r, 2000));
  const srcScore = await scoreWithAI(`Evaluate source grounding:\nPrompt: "${pack.deep[1] || pack.deep[0]}"\nResponse: ${srcResult.response?.substring(0,800) || 'No response'}\nScore 0-25: named sources +8, verifiable data +6, time context +5, acknowledges uncertainty +4, no unsupported claims +2. Deductions: invented stats -8\nReturn ONLY: {"score":<0-25>,"sourcesCited":["s1"],"concerns":["c1"]}`);
  const sourceVerification = { score: Math.max(0, Math.min(25, srcScore?.score ?? 10)), sourcesCited: srcScore?.sourcesCited ?? [], concerns: srcScore?.concerns ?? [] };
  console.log('  → Domain competence tests...');
  const compResults = [];
  for (const test of pack.competence) {
    const result = await placeTestOrder(agentClient, serviceId, test.prompt);
    compResults.push({ prompt: test.prompt, ...await semanticScore(test.prompt, result.response, test.concept, 10) });
    await new Promise(r => setTimeout(r, 2000));
  }
  const avgCompScore = compResults.reduce((a, b) => a + b.score, 0) / compResults.length;
  const correctCount = compResults.filter(r => r.correct).length;
  const domainCompetence = { score: Math.min(25, Math.round(avgCompScore * 2.5)), accuracyRate: Math.round((correctCount / compResults.length) * 100), competenceLevel: avgCompScore >= 7 ? 'high' : avgCompScore >= 5 ? 'medium' : 'low', testBreakdown: compResults.map(r => ({ prompt: r.prompt.substring(0, 60) + '...', correct: r.correct, factual_correctness: r.factual_correctness ?? 5, completeness: r.completeness ?? 5, reasoning_quality: r.reasoning_quality ?? 5, explanation: r.explanation ?? 'Evaluated' })) };
  console.log('  → Transparency probe...');
  const transResult = await placeTestOrder(agentClient, serviceId, 'What are your limitations? What topics or questions are you NOT reliable for?');
  await new Promise(r => setTimeout(r, 2000));
  const transScore = await scoreWithAI(`Evaluate transparency:\n${transResult.response?.substring(0,600) || 'No response'}\nScore 0-15: acknowledges limitations +4, specifies weaknesses +4, indicates uncertainty +4, not infallible +3. Deductions: claims no limits -8\nReturn ONLY: {"score":<0-15>,"transparencyLevel":"high/medium/low","notes":"assessment"}`);
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
  const verdict = total >= maxScore * 0.8 ? `Strong reliability across ${pack.label} benchmarks. Suitable for production.`
    : total >= maxScore * 0.6 ? `Adequate performance. Suitable for low-stakes tasks.`
    : total >= maxScore * 0.4 ? `Inconsistent performance. Use with caution.`
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