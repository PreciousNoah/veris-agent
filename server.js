import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pkg from '@croo-network/sdk';
const { AgentClient, EventType, DeliverableType } = pkg;
import { runVERIS, handleCompare, getTrustReceipts, supabase, getCachedZeruResult, setCachedZeruResult, fetchZeruEnrichment } from './veris.js'; 
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json({ strict: false }));
app.use(express.text({ type: '*/*' }));

const config = {
  baseURL: process.env.CROO_API_URL,
  wsURL:   process.env.CROO_WS_URL,
  rpcURL:  'https://mainnet.base.org',
  logger:  { debug:()=>{}, info:console.log, warn:console.warn, error:console.error },
};

const RENDER_URL = process.env.RENDER_EXTERNAL_URL
  || process.env.RAILWAY_STATIC_URL
  || 'https://veris-agent-production.up.railway.app';

let credentials = {};
try {
  credentials = JSON.parse(fs.readFileSync('veris-credentials.json', 'utf8'));
} catch {
  console.warn('veris-credentials.json not found — using env vars only');
}

const PROVIDER_SDK_KEY  = process.env.CROO_API_KEY        || credentials.sdkKey;
const REQUESTER_SDK_KEY = process.env.CROO_REQUESTER_SDK_KEY;
const STORE_SDK_KEY     = process.env.CROO_STORE_SDK_KEY;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════
// INPUT TYPE DETECTION
// ════════════════════════════════════════════════════════════════════

function detectInputType(input) {
  if (!input) return { type: 'unknown', label: 'Unknown input', hint: '' };
  const s = input.trim();

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return { type: 'uuid', label: 'CROO Agent ID (UUID)', hint: 'Running agent due diligence.' };
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(s)) {
    return { type: 'evm_address', label: 'EVM Wallet / Contract Address', hint: 'Running project due diligence on this address.' };
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && !s.includes(' ')) {
    return { type: 'solana_address', label: 'Solana Address', hint: 'Running project due diligence on this address.' };
  }
  if (/github\.com\//i.test(s)) {
    return { type: 'github', label: 'GitHub Repository', hint: 'Running project due diligence using this repository.' };
  }
  if (/^https?:\/\//i.test(s) || /^www\./i.test(s)) {
    return { type: 'url', label: 'Website URL', hint: 'Running project due diligence on this website.' };
  }
  if (/agent\.croo\.network/i.test(s)) {
    return { type: 'croo_url', label: 'CROO Agent Store URL', hint: 'Running agent due diligence.' };
  }
  if (/\bagent\b|\bbot\b|\bai\b|\bauto/i.test(s)) {
    return { type: 'agent_name', label: 'Agent Name', hint: 'Running agent due diligence.' };
  }
  return { type: 'project_name', label: 'Project Name', hint: 'Running project due diligence.' };
}

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

function parseBody(body) {
  if (!body) return null;
  if (typeof body === 'object') return body;
  try { return JSON.parse(body); } catch { return null; }
}

async function getCachedReceipt(entityId) {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from('trust_receipts')
      .select('*')
      .eq('entity_id', entityId.toLowerCase().trim())
      .gte('created_at', new Date(Date.now() - CACHE_TTL_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data || null;
  } catch { return null; }
}

function parseScoreFromReport(report) {
  if (!report) return null;
  const m = report.match(/LEGITIMACY:\s+(\d+)\/100/i)
         || report.match(/OVERALL SCORE:\s*(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

function parseConfidenceFromReport(report) {
  if (!report) return null;
  const m = report.match(/CONFIDENCE:\s+[▓░]+\s+(\d+)%/);
  return m ? parseInt(m[1]) : null;
}

function parseRecommendationFromReport(report) {
  if (!report) return 'Unknown';
  const m = report.match(/RECOMMENDATION:\s+[^\s]+\s+([A-Z ]+)\s+\[Band/);
  return m ? m[1].trim() : 'Unknown';
}

function parseSignalsFromReport(report) {
  if (!report) return { verified: 0, total: 0 };
  const patterns = [
    /SIGNAL COVERAGE:\s+(\d+)\/(\d+)/i,
    /(\d+)\/(\d+)\s+signals\s+verifiable/i,
    /(\d+)\/(\d+) signals/i,
    /Signals:\s+(\d+)\/(\d+)/i,
    /signals_verified['":\s]+(\d+)[^}]*signals_total['":\s]+(\d+)/i,
  ];
  for (const p of patterns) {
    const m = report.match(p);
    if (m) return { verified: parseInt(m[1]), total: parseInt(m[2]) };
  }
  const yesCount = (report.match(/^\s+\+\s*\d+\s+/gm) || []).length;
  return { verified: yesCount, total: yesCount > 0 ? 27 : 0 };
}

function parseIncidentsFromReport(report) {
  if (!report) return [];
  const incidents = [];
  if (report.includes('⛔ HARD TRUST EVENT') || report.includes('CRITICAL RISK')) {
    const section = report.match(/⛔ HARD TRUST EVENT[^\n]*\n([\s\S]*?)(?:══|RECOMMENDATION)/);
    if (section) {
      section[1].split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('Confirmed') || l.includes('label:') || l.match(/[A-Z].*fraud|scam|rug|conviction/i))
        .forEach(l => incidents.push(l));
    }
  }
  return incidents;
}

function receiptToTrustJSON(receipt, cached = true) {
  return {
    entity:          receipt.entity_name,
    entityId:        receipt.entity_id,
    entityType:      receipt.entity_type,
    trustScore:      receipt.score,
    confidence:      receipt.confidence || null,
    riskLevel:       receipt.risk_level,
    recommendation:  receipt.recommendation || receipt.risk_level,
    signalsVerified: receipt.signals_verified,
    signalsTotal:    receipt.signals_total,
    incidents:       receipt.incidents || [],
    lastAudited:     receipt.created_at,
    cached,
  };
}

// ════════════════════════════════════════════════════════════════════
// INSUFFICIENT DATA EXPLANATION
// ════════════════════════════════════════════════════════════════════

function buildInsufficientDataBlock(entityName, inputType, entityType) {
  const SEP = '══════════════════════════════════════════════';
  const isAgent = entityType === 'agent';

  const whatWeMissed = isAgent
    ? [
        'Agent listing on CROO store',
        'Service description (30+ characters)',
        'Pricing and SLA configuration',
        'Public web presence or GitHub',
        'Reachable endpoint URL',
      ]
    : [
        'Founders or team publicly named',
        'Official website or documentation',
        'GitHub repository',
        'Whitepaper or technical docs',
        'Live product confirmation',
      ];

  const howToHelp = isAgent
    ? [
        'Provide the CROO agent ID (UUID format)',
        'Add the agent endpoint URL for live testing',
        'Ensure the agent is listed and online on CROO store',
        'Add a service description of 30+ characters to the listing',
      ]
    : [
        'Provide the official website URL (e.g. https://yourproject.xyz)',
        'Provide the GitHub repository URL',
        'Provide the Twitter/X handle',
        'Use the full project name as it appears publicly',
      ];

  const inputNote = inputType && inputType.type !== 'project_name' && inputType.type !== 'agent_name'
    ? `\nInput detected as: ${inputType.label}. ${inputType.hint}`
    : '';

  return `
${SEP}
⚠  VERIS COULD NOT SCORE THIS ENTITY
${SEP}
Entity:  ${entityName}${inputNote}

VERIS ran a full search across multiple sources but could not
confirm enough signals to produce a reliable trust score.

This does NOT mean the entity is illegitimate.
It means there is insufficient publicly verifiable evidence.

EVIDENCE GAPS DETECTED
${whatWeMissed.map(s => `  ✗ ${s}`).join('\n')}

HOW TO GET A BETTER RESULT
${howToHelp.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}

WHAT HAPPENS NEXT
  Submit again with the additional information above.
  VERIS will re-run the full evidence pipeline.
  Scores are only produced when evidence meets the minimum
  confidence threshold — not scored means not penalized.
${SEP}`;
}

// ════════════════════════════════════════════════════════════════════
// RICHER FINAL REASONING
// ════════════════════════════════════════════════════════════════════

function buildReasoningBlock(report) {
  const legitimacy   = report.match(/LEGITIMACY:\s+(\d+)\/100/)?.[1];
  const maturity     = report.match(/MATURITY:\s+(\d+)\/100/)?.[1];
  const confidence   = report.match(/CONFIDENCE:.*?(\d+)%/)?.[1];
  const identity     = report.match(/Identity:\s+(\d+)\/100/)?.[1];
  const transparency = report.match(/Transparency:\s+(\d+)\/100/)?.[1];
  const verification = report.match(/Verification:\s+(\d+)\/100/)?.[1];
  const reputation   = report.match(/Reputation:\s+(\d+)\/100/)?.[1];

  if (!legitimacy) return '';

  const lines = [];
  const dims = [
    { name: 'Identity',     score: parseInt(identity     || '0') },
    { name: 'Transparency', score: parseInt(transparency || '0') },
    { name: 'Verification', score: parseInt(verification || '0') },
    { name: 'Reputation',   score: parseInt(reputation   || '0') },
  ];

  lines.push('SCORE EXPLANATION');
  lines.push('');

  for (const d of dims) {
    if (d.score >= 75) {
      lines.push(`  ${d.name} (${d.score}/100) — Strong. Multiple confirmed signals with official sources.`);
    } else if (d.score >= 50) {
      lines.push(`  ${d.name} (${d.score}/100) — Partial. Some signals confirmed but gaps remain.`);
    } else if (d.score >= 25) {
      lines.push(`  ${d.name} (${d.score}/100) — Weak. Most signals in this dimension could not be verified.`);
    } else {
      lines.push(`  ${d.name} (${d.score}/100) — Minimal. Little to no verifiable evidence in this dimension.`);
    }
  }

  lines.push('');

  const conf = parseInt(confidence || '0');
  if (conf >= 80) {
    lines.push(`  Confidence (${conf}%) — High. Strong multi-source agreement across official and media sources.`);
  } else if (conf >= 60) {
    lines.push(`  Confidence (${conf}%) — Moderate. Reasonable evidence base, but some areas have limited coverage.`);
  } else if (conf >= 40) {
    lines.push(`  Confidence (${conf}%) — Low. Limited sources found. Score should be treated as provisional.`);
  } else {
    lines.push(`  Confidence (${conf}%) — Very low. Minimal evidence. Re-run with a website or GitHub URL for better results.`);
  }

  const weakDims = dims.filter(d => d.score < 50);
  if (weakDims.length > 0) {
    lines.push('');
    lines.push('  WHY THE SCORE IS NOT HIGHER');
    for (const d of weakDims) {
      if (d.name === 'Identity') {
        lines.push('    → Founders and team could not be publicly identified from available sources.');
      } else if (d.name === 'Transparency') {
        lines.push('    → Whitepaper, roadmap, or technical documentation could not be confirmed.');
      } else if (d.name === 'Verification') {
        lines.push('    → Open source code, GitHub activity, or security audit could not be verified.');
      } else if (d.name === 'Reputation') {
        lines.push('    → Project longevity, media coverage, or community signals were insufficient.');
      }
    }
  }

  if (weakDims.length > 0 || conf < 60) {
    lines.push('');
    lines.push('  HOW TO IMPROVE THIS SCORE');
    if (dims.find(d => d.name === 'Identity' && d.score < 50)) {
      lines.push('    1. Provide the official website with a team page.');
    }
    if (dims.find(d => d.name === 'Verification' && d.score < 50)) {
      lines.push('    2. Provide the GitHub repository URL.');
    }
    if (conf < 60) {
      lines.push('    3. Re-run with the official URL — more sources produce higher confidence.');
    }
  }

  const SEP = '══════════════════════════════════════════════';
  return `
${SEP}
${lines.join('\n')}
${SEP}`;
}

// ════════════════════════════════════════════════════════════════════
// API KEY MIDDLEWARE
// ════════════════════════════════════════════════════════════════════

async function requireApiKey(req, res, next) {
  if (!supabase) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) {
    return res.status(401).json({
      error: 'API key required. Pass X-Api-Key header or ?api_key= query param.',
    });
  }
  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key', key)
      .single();
    if (error || !data) {
      return res.status(403).json({ error: 'Invalid API key.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (data.last_reset !== today) {
      await supabase.from('api_keys')
        .update({ requests_today: 0, last_reset: today })
        .eq('key', key);
      data.requests_today = 0;
    }
    const limit = data.daily_limit || 100;
    if (data.requests_today >= limit) {
      return res.status(429).json({ error: `Daily limit of ${limit} reached.` });
    }
    supabase.from('api_keys')
      .update({ requests_today: data.requests_today + 1 })
      .eq('key', key)
      .then(() => {});
    req.apiKey = data;
    next();
  } catch {
    console.warn('api_keys table not found — skipping auth.');
    next();
  }
}

// ════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.json({
    status:       'VERIS online',
    version:      'v3',
    capabilities: [
      'project-due-diligence',
      'agent-due-diligence',
      'trust-compare',
      'trust-receipts',
      'trust-api',
      'evidence-api',
      'a2a-composability',
    ],
    endpoints: {
      croo:     ['POST /audit', 'POST /compare'],
      trust:    [
        'GET /trust/:entityName',
        'GET /trust/:entityName?type=agent&agentId=&endpointUrl=',
        'GET /compare/projects?a=Aave&b=Compound&c=MakerDAO',
      ],
      evidence: ['GET /evidence/:entityName'],
      receipts: [
        'GET /receipts',
        'GET /receipts/summary',
        'GET /receipts/:entityId',
      ],
      a2a: ['GET /a2a/demo/:entityName'],
    },
    network:  'Base Mainnet',
    protocol: 'CROO v1',
    agentId:  credentials.agentId || null,
  });
});

// ════════════════════════════════════════════════════════════════════
// CROO ROUTES
// ════════════════════════════════════════════════════════════════════

app.post('/audit', async (req, res) => {
  const body = parseBody(req.body);
  let requirements = body?.requirements;
  if (!requirements && body && typeof body === 'object') {
    requirements = body;
  }
  if (!requirements && typeof req.body === 'string' && req.body.trim()) {
    requirements = { type: 'project', name: req.body.trim() };
  }
  if (!requirements) {
    return res.status(400).json({ error: 'requirements object needed' });
  }
  try {
    let report = await runVERIS(requirements, REQUESTER_SDK_KEY);

    if (report.includes('N/A (Insufficient Evidence)') || report.includes('INSUFFICIENT DATA')) {
      const inputType = detectInputType(requirements.name || requirements.agentId || '');
      report += buildInsufficientDataBlock(
        requirements.name || requirements.agentId || 'Unknown',
        inputType,
        requirements.type || 'project'
      );
    } else {
      report += buildReasoningBlock(report);
    }

    if (requirements.type === 'project' && requirements.name) {
      const zeruResult = await fetchZeruEnrichment(requirements.name);
      report += buildEnrichmentBlock(zeruResult, requirements.name);
      const scoreMatch = report.match(/LEGITIMACY:\s+(\d+)\/100/i);
      const confMatch  = report.match(/CONFIDENCE:.*?(\d+)%/);
      const trustScore = scoreMatch ? parseInt(scoreMatch[1]) : null;
      const confidence = confMatch  ? parseInt(confMatch[1])  : 50;
      const incidents = parseIncidentsFromReport(report);
      const sentinelResult = await fetchSentinelDecision(trustScore, confidence, zeruResult, incidents);
      report += buildSentinelBlock(sentinelResult, trustScore);
    }

    res.json({ report });
  } catch (err) {
    console.error('/audit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/compare', async (req, res) => {
  const body   = parseBody(req.body);
  const agents = body?.agents;
  if (!Array.isArray(agents) || agents.length < 2) {
    return res.status(400).json({ error: 'Compare requires at least 2 agents in an "agents" array' });
  }
  try {
    const report = await handleCompare(agents, REQUESTER_SDK_KEY);
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/compare/projects', requireApiKey, async (req, res) => {
  const names = [req.query.a, req.query.b, req.query.c, req.query.d, req.query.e]
    .filter(Boolean)
    .map(n => n.trim());
  if (names.length < 2) {
    return res.status(400).json({ error: 'Pass at least ?a=ProjectA&b=ProjectB' });
  }
  console.log(`\n⚖️ VERIS Project Compare: ${names.join(' vs ')}`);
  const results = await Promise.all(names.map(async (name) => {
    try {
      const cached = await getCachedReceipt(name);
      if (cached) {
        const derivedRisk = (() => {
          const s = cached.score;
          if (cached.entity_type === 'agent') {
            if (s >= 76) return 'Trusted';
            if (s >= 56) return 'Established';
            if (s >= 36) return 'Emerging';
            if (s >= 16) return 'Unverified';
            return 'Critical';
          }
          if (s >= 80) return 'Low';
          if (s >= 65) return 'Low-Medium';
          if (s >= 50) return 'Medium';
          if (s >= 30) return 'High';
          if (s <= 5)  return 'Critical';
          return 'High';
        })();
        const derivedRec = (() => {
          const s = cached.score;
          if (!s) return 'Unknown';
          if (s >= 85) return 'STRONGLY TRUSTED';
          if (s >= 80) return 'TRUSTED';
          if (s >= 65) return 'GENERALLY LEGITIMATE';
          if (s >= 50) return 'MIXED SIGNALS';
          if (s >= 30) return 'HIGH RISK';
          if (s <= 5)  return 'CRITICAL RISK';
          return 'HIGH RISK';
        })();
        return {
          entity:          cached.entity_name,
          trustScore:      cached.score,
          riskLevel:       derivedRisk,
          recommendation:  derivedRec,
          signalsVerified: cached.signals_verified,
          signalsTotal:    cached.signals_total,
          confidence:      cached.confidence || null,
          cached:          true,
          error:           null,
        };
      }
      const report         = await runVERIS({ type: 'project', name }, REQUESTER_SDK_KEY);
      const score          = parseScoreFromReport(report);
      const signals        = parseSignalsFromReport(report);
      const recommendation = parseRecommendationFromReport(report);
      const incidents      = parseIncidentsFromReport(report);
      let riskLevel = 'Unknown';
      if (score !== null) {
        if (score >= 80)      riskLevel = 'Low';
        else if (score >= 65) riskLevel = 'Low-Medium';
        else if (score >= 50) riskLevel = 'Medium';
        else if (score >= 30) riskLevel = 'High';
        else                  riskLevel = 'Critical';
      }
      if (incidents.length > 0) riskLevel = 'Critical';
      return {
        entity:          name,
        trustScore:      score,
        riskLevel,
        recommendation,
        signalsVerified: signals.verified,
        signalsTotal:    signals.total,
        confidence:      parseConfidenceFromReport(report),
        cached:          false,
        error:           null,
      };
    } catch (err) {
      return { entity: name, trustScore: null, riskLevel: 'Error', error: err.message };
    }
  }));
  const ranked = [...results]
    .filter(r => r.trustScore !== null)
    .sort((a, b) => b.trustScore - a.trustScore);
  const best  = ranked[0] || null;
  const worst = ranked[ranked.length - 1] || null;
  let verdict = 'Insufficient data to compare.';
  if (best && best.trustScore >= 65) {
    verdict = `${best.entity} has the strongest verifiable trust signals (${best.trustScore}/100). `;
    if (worst && worst.trustScore < best.trustScore - 20) {
      verdict += `${worst.entity} shows significantly weaker signals (${worst.trustScore}/100) — independent verification recommended before use.`;
    } else {
      verdict += `All compared entities show acceptable trust signals.`;
    }
  } else if (best) {
    verdict = `All compared entities have limited verifiable signals. Strongest: ${best.entity} (${best.trustScore}/100). Proceed with caution across the board.`;
  }
  res.json({
    compared:  names,
    results:   ranked,
    best:      best?.entity || null,
    verdict,
    timestamp: new Date().toISOString(),
  });
});

app.get('/receipts', async (req, res) => {
  if (!supabase) return res.json({ receipts: [], note: 'Supabase not configured' });
  try {
    const { data, error } = await supabase
      .from('trust_receipts')
      .select('id, entity_type, entity_name, score, risk_level, signals_verified, signals_total, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const clean = (name) => {
      if (!name) return false;
      if (name.startsWith('{')) return false;
      if (name.startsWith('"')) return false;
      if (name.length > 80) return false;
      if (name.includes('\\')) return false;
      if (name.includes('"type"')) return false;
      if (name.includes('requirements')) return false;
      return true;
    };
    const receipts = (data || []).filter(r => clean(r.entity_name));
    res.json({ receipts, count: receipts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/receipts/summary', async (req, res) => {
  if (!supabase) return res.json({ entities: [], note: 'Supabase not configured' });
  try {
    const { data, error } = await supabase
      .from('trust_receipts')
      .select('entity_type, entity_name, score, risk_level, signals_verified, signals_total, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const isCleanName = (name) => {
      if (!name) return false;
      if (name.startsWith('{')) return false;
      if (name.startsWith('"')) return false;
      if (name.length > 60)  return false;
      if (name.includes('\\')) return false;
      if (name.includes('type')) return false;
      return true;
    };
    const deriveRisk = (score, stored, type) => {
      if (stored && stored !== 'Unknown' && stored !== 'unknown') return stored;
      if (score === null || score === undefined) return 'Unknown';
      if (type === 'agent') {
        if (score >= 76) return 'Trusted';
        if (score >= 56) return 'Established';
        if (score >= 36) return 'Emerging';
        if (score >= 16) return 'Unverified';
        return 'Critical';
      }
      if (score >= 80) return 'Low';
      if (score >= 65) return 'Low-Medium';
      if (score >= 50) return 'Medium';
      if (score >= 30) return 'High';
      if (score <= 5)  return 'Critical';
      return 'High';
    };
    const seen = new Map();
    for (const row of (data || [])) {
      if (!isCleanName(row.entity_name)) continue;
      if (!seen.has(row.entity_name)) seen.set(row.entity_name, row);
    }
    const entities = [...seen.values()].sort((a, b) => {
      if (a.entity_type !== b.entity_type) return a.entity_type === 'project' ? -1 : 1;
      return (b.score || 0) - (a.score || 0);
    });
    res.json({
      totalEntitiesAudited: entities.length,
      lastUpdated:          entities[0]?.created_at || null,
      auditor:              'VERIS — Trust Infrastructure for the Agent Economy',
      protocol:             'CROO v1 · Base Network',
      entities: entities.map(e => ({
        name:            e.entity_name,
        type:            e.entity_type,
        trustScore:      e.score,
        riskLevel:       deriveRisk(e.score, e.risk_level, e.entity_type),
        signalsVerified: e.signals_verified,
        signalsTotal:    e.signals_total,
        lastAudited:     e.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/receipts/:entityId', async (req, res) => {
  try {
    if (!supabase) return res.json({ entityId: req.params.entityId, receipts: [], count: 0 });
    const { data, error } = await supabase
      .from('trust_receipts')
      .select('id, entity_type, entity_name, score, risk_level, signals_verified, signals_total, report, created_at')
      .eq('entity_id', req.params.entityId.toLowerCase().trim())
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    res.json({ entityId: req.params.entityId, receipts: data || [], count: data?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// TRUST API
// ════════════════════════════════════════════════════════════════════

app.get('/trust/:entityName', requireApiKey, async (req, res) => {
  const entityName   = req.params.entityName.trim();
  const entityType   = req.query.type || 'project';
  const forceRefresh = req.query.refresh === 'true';
  if (entityType === 'agent') {
    try {
      const agentId = req.query.agentId || entityName;
      const report  = await runVERIS({
        type:               'agent',
        agentId,
        agentName:          entityName,
        serviceId:          req.query.serviceId || null,
        endpointUrl:        req.query.endpointUrl || null,
        serviceDescription: req.query.description || null,
        category:           req.query.category || 'general',
      }, REQUESTER_SDK_KEY);
      const overallMatch  = report.match(/OVERALL SCORE:\s+(\d+)\/100/);
      const confMatch     = report.match(/CONFIDENCE:\s+(High|Medium|Low)/i);
      const coverageMatch = report.match(/SIGNAL COVERAGE:\s+(\d+)\/(\d+)/);
      const l1Match       = report.match(/LAYER 1[^\d]*(\d+)\/100/);
      const l2Match       = report.match(/LAYER 2[^\d]*(\d+)\/100/);
      const l3Match       = report.match(/LAYER 3[^\d]*(\d+)\/100/);
      const layerScores = {
        metadata: l1Match ? parseInt(l1Match[1]) : null,
        web:      l2Match ? parseInt(l2Match[1]) : null,
        live:     l3Match ? parseInt(l3Match[1]) : null,
      };
      const trustScore = overallMatch ? parseInt(overallMatch[1]) : null;
      return res.json({
        entity:          entityName,
        entityId:        agentId,
        entityType:      'agent',
        trustScore,
        confidence:      confMatch ? confMatch[1] : 'Low',
        trustBand:       deriveAgentRiskLevel(trustScore, layerScores),
        riskLevel:       deriveAgentRiskLevel(trustScore, layerScores),
        recommendation:  deriveAgentRecommendation(trustScore, layerScores),
        signalsVerified: coverageMatch ? parseInt(coverageMatch[1]) : 0,
        signalsTotal:    coverageMatch ? parseInt(coverageMatch[2]) : 15,
        layerScores,
        agentTrustModel: {
          bands: '0-15 Critical | 16-35 Unverified | 36-55 Emerging | 56-75 Established | 76-100 Trusted',
          note: 'Agent scores reflect ecosystem maturity. A new agent with a working endpoint is Emerging, not Critical.',
        },
        incidents:   [],
        lastAudited: new Date().toISOString(),
        cached:      false,
      });
    } catch (err) {
      console.error('/trust agent error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }
  if (!forceRefresh) {
    const cached = await getCachedReceipt(entityName);
    if (cached) return res.json(receiptToTrustJSON(cached, true));
  }
  try {
    const report         = await runVERIS({ type: 'project', name: entityName }, REQUESTER_SDK_KEY);
    const score          = parseScoreFromReport(report);
    const confidence     = parseConfidenceFromReport(report);
    const recommendation = parseRecommendationFromReport(report);
    const signals        = parseSignalsFromReport(report);
    const incidents      = parseIncidentsFromReport(report);
    let riskLevel = 'Unknown';
    if (score !== null) {
      if (score >= 70)      riskLevel = 'Low';
      else if (score >= 55) riskLevel = 'Low-Medium';
      else if (score >= 40) riskLevel = 'Medium';
      else if (score >= 20) riskLevel = 'High';
      else                  riskLevel = 'Critical';
    }
    if (incidents.length > 0) riskLevel = 'Critical';
    res.json({
      entity:          entityName,
      entityId:        entityName.toLowerCase().trim(),
      entityType:      'project',
      trustScore:      score,
      confidence,
      riskLevel,
      recommendation,
      signalsVerified: signals.verified,
      signalsTotal:    signals.total,
      incidents,
      lastAudited:     new Date().toISOString(),
      cached:          false,
    });
  } catch (err) {
    console.error('/trust error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// AGENT TRUST MODEL
// ════════════════════════════════════════════════════════════════════

function deriveAgentRiskLevel(score, layerScores) {
  if (score === null) return 'Unknown';
  const liveWorking = (layerScores?.live     || 0) > 0;
  const webWorking  = (layerScores?.web      || 0) > 0;
  const metaWorking = (layerScores?.metadata || 0) > 0;
  if (score >= 76) return 'Trusted';
  if (score >= 56) return 'Established';
  if (score >= 36 || (liveWorking && score >= 20)) return 'Emerging';
  if (score >= 16 || webWorking || metaWorking)    return 'Unverified';
  return 'Critical';
}

function deriveAgentRecommendation(score, layerScores) {
  const level = deriveAgentRiskLevel(score, layerScores);
  switch (level) {
    case 'Trusted':      return 'SUITABLE FOR PRODUCTION';
    case 'Established':  return 'GENERALLY SUITABLE';
    case 'Emerging':     return 'PROCEED WITH CAUTION';
    case 'Unverified':   return 'LIMITED VERIFICATION';
    case 'Critical':     return 'HIGH RISK';
    default:             return 'INSUFFICIENT DATA';
  }
}

// ════════════════════════════════════════════════════════════════════
// EVIDENCE API
// ════════════════════════════════════════════════════════════════════

app.get('/evidence/:entityName', requireApiKey, async (req, res) => {
  const entityName   = req.params.entityName.trim();
  const forceRefresh = req.query.refresh === 'true';
  if (!forceRefresh && supabase) {
    try {
      const { data } = await supabase
        .from('trust_receipts')
        .select('raw_evidence, structured_signals, entity_name, created_at')
        .eq('entity_id', entityName.toLowerCase().trim())
        .gte('created_at', new Date(Date.now() - CACHE_TTL_MS).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (data?.raw_evidence) {
        return res.json({
          entity:    data.entity_name,
          evidence:  data.raw_evidence,
          signals:   data.structured_signals || null,
          cached:    true,
          timestamp: data.created_at,
        });
      }
    } catch { /* cache miss */ }
  }
  try {
    const report         = await runVERIS({ type: 'project', name: entityName }, REQUESTER_SDK_KEY);
    const signals        = parseSignalsFromReport(report);
    const githubMatch    = report.match(/Active GitHub[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const auditMatch     = report.match(/Security audit found[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const whitepaperMatch= report.match(/Whitepaper found[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const foundedMatch   = report.match(/Founded:\s+(\d{4})/);
    const incidents      = parseIncidentsFromReport(report);
    res.json({
      entity: entityName,
      evidence: {
        github:      githubMatch      ? [githubMatch[1]]      : null,
        whitepaper:  whitepaperMatch  ? [whitepaperMatch[1]]  : null,
        audit:       auditMatch       ? [auditMatch[1]]       : null,
        founded:     foundedMatch     ? parseInt(foundedMatch[1]) : null,
        openSource:  report.includes('Open source confirmed'),
        liveProduct: report.includes('Live product confirmed'),
        incidents,
      },
      signalCoverage: {
        verified: signals.verified,
        total:    signals.total,
        pct:      signals.total > 0 ? Math.round((signals.verified / signals.total) * 100) : 0,
      },
      cached:    false,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('/evidence error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// A2A DEMO
// ════════════════════════════════════════════════════════════════════

app.get('/a2a/demo/:entityName', requireApiKey, async (req, res) => {
  const entityName = req.params.entityName.trim();
  const zeruUrl    = process.env.ZERU_API_URL;
  const result = { entity: entityName, veris: null, research: null, combined: null };
  try {
    const report = await runVERIS({ type: 'project', name: entityName }, REQUESTER_SDK_KEY);
    result.veris = {
      trustScore:      parseScoreFromReport(report),
      confidence:      parseConfidenceFromReport(report),
      recommendation:  parseRecommendationFromReport(report),
      signalsVerified: parseSignalsFromReport(report).verified,
      signalsTotal:    parseSignalsFromReport(report).total,
      incidents:       parseIncidentsFromReport(report),
      cached:          false,
    };
  } catch (err) {
    result.veris = { error: err.message };
  }
  if (zeruUrl) {
    try {
      const zeruRes = await fetch(`${zeruUrl}/research/${encodeURIComponent(entityName)}`, {
        headers: { 'X-Api-Key': process.env.ZERU_API_KEY || '' },
        signal:  AbortSignal.timeout(30000),
      });
      result.research = zeruRes.ok ? await zeruRes.json() : { error: `ZERU returned ${zeruRes.status}` };
    } catch (err) {
      result.research = { error: `ZERU unavailable: ${err.message}` };
    }
  } else {
    result.research = { note: 'Set ZERU_API_URL env var to enable A2A composability demo' };
  }
  if (result.veris?.trustScore !== null && result.veris?.trustScore !== undefined) {
    const score = result.veris.trustScore;
    result.combined = {
      entity:          entityName,
      trustScore:      score,
      researchRisks:   result.research?.risks || [],
      compositeSignal: score >= 65 ? 'Proceed with standard diligence'
                     : score >= 30 ? 'High caution — verify independently'
                     : 'Do not engage — critical risk signals detected',
      dataSources:     ['VERIS Trust Engine', zeruUrl ? 'ZERU Research Agent' : 'ZERU not connected'],
      timestamp:       new Date().toISOString(),
    };
  }
  res.json(result);
});

// ════════════════════════════════════════════════════════════════════
// A2A ENRICHMENT FUNCTIONS
// ════════════════════════════════════════════════════════════════════

async function fetchZeruEnrichment(entityName) {
  // Check cache first
  const cached = getCachedZeruResult(entityName);
  if (cached) return cached;

  const zeruUrl = process.env.ZERU_API_URL;
  if (!zeruUrl) return { available: false, reason: 'ZERU_API_URL not configured' };
  try {
    const res = await fetch(
      `${zeruUrl}/research/${encodeURIComponent(entityName)}`,
      {
        headers: { 'X-Api-Key': process.env.ZERU_API_KEY || '' },
        signal:  AbortSignal.timeout(20000),
      }
    );
    if (!res.ok) return { available: false, reason: `ZERU returned ${res.status}` };
    const data = await res.json();
    const result = { available: true, data };
    setCachedZeruResult(entityName, result);
    return result;
  } catch (err) {
    return { available: false, reason: err.name === 'TimeoutError' ? 'ZERU timed out' : err.message };
  }
}

async function fetchSentinelDecision(trustScore, confidence, zeruResult, incidents = []) {
  const sentinelUrl = process.env.SENTINEL_API_URL;
  if (!sentinelUrl) return { available: false, reason: 'SENTINEL_API_URL not configured' };
  const sentiment   = zeruResult?.data?.sentiment || 'neutral';
  const riskFactors = zeruResult?.data?.risks     || [];

  const serializedIncidents = (incidents || []).map(i => {
    if (typeof i === 'string') return i;
    if (i && typeof i === 'object') {
      return i.label || i.text || i.description || i.message || JSON.stringify(i);
    }
    return String(i);
  });

  const serializedRisks = (riskFactors || []).map(r => {
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object') {
      return r.label || r.description || r.text || JSON.stringify(r);
    }
    return String(r);
  });

  try {
    const res = await fetch(`${sentinelUrl}/decide`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ trustScore, confidence, sentiment, riskFactors: serializedRisks, incidents: serializedIncidents }),
      signal:  AbortSignal.timeout(15000),
    });
    if (!res.ok) return { available: false, reason: `SENTINEL returned ${res.status}` };
    const data = await res.json();
    return { available: true, data };
  } catch (err) {
    return { available: false, reason: err.name === 'TimeoutError' ? 'SENTINEL timed out' : err.message };
  }
}

function buildEnrichmentBlock(zeruResult, entityName) {
  const SEP = '══════════════════════════════════════════════';
  if (!zeruResult.available) {
    return `

${SEP}
[2] ZERU — Research Intelligence
   Status: Unavailable (${zeruResult.reason})
   Note:   VERIS trust report above remains valid.
${SEP}`;
  }
  const d = zeruResult.data;
  const risksText = (d.risks || [])
    .filter(r => r && r.includes('%'))
    .slice(0, 5).map(r => `  • ${r}`).join('\n')
    || (d.risks || []).slice(0, 4).map(r => `  • ${r}`).join('\n')
    || '  • None identified';
  const summary = (d.summary || 'No summary available')
    .trim()
    .substring(0, 400)
    + ((d.summary || '').length > 400 ? '...' : '');
  return `

${SEP}
[2] ZERU — Research Intelligence
    Source: ZERU Research Agent · ${new Date().toISOString().slice(0, 10)}
${SEP}
MARKET SUMMARY
${summary}

KEY RISKS IDENTIFIED
${risksText}

SENTIMENT: ${(d.sentiment || 'neutral').toUpperCase()}
${SEP}
on the CROO network — demonstrating agent-to-agent composability.`;
}

function buildSentinelBlock(sentinelResult, trustScore = null) {
  const SEP = '══════════════════════════════════════════════';
  if (!sentinelResult.available) {
    return `

${SEP}
[3] SENTINEL — Compliance Decision
    Status: Unavailable (${sentinelResult.reason})
${SEP}
A2A CONTRIBUTORS
  [1] VERIS    — Trust Verification & Scoring    OK
  [2] ZERU     — Research & Intelligence         OK
  [3] SENTINEL — Compliance Decision             UNAVAILABLE
${SEP}`;
  }
  const d = sentinelResult.data;
  const symbol = {
    'PROCEED':              '✅',
    'PROCEED WITH CAUTION': '⚠️',
    'HIGH RISK':            '🔴',
    'AVOID':                '⛔',
    'INSUFFICIENT DATA':    '❓',
  }[d.verdict] || '—';
  const actions = (d.recommendedActions || [])
    .map(a => `  ✓ ${a}`).join('\n') || '  ✓ See reasoning above';

  let displayedTrustScore = d.inputs?.trustScore ?? trustScore ?? 'N/A';
  
  if (displayedTrustScore === 'N/A' && d.reason) {
    const scoreMatch = d.reason.match(/Trust score\s*\((\d+)\/100/i);
    if (scoreMatch) {
      displayedTrustScore = parseInt(scoreMatch[1]);
    }
  }

  return `

${SEP}
[3] SENTINEL — Compliance Decision
    Source: SENTINEL Decision Intelligence Agent
${SEP}
VERDICT:  ${symbol}  ${d.verdict}

  Trust Score:       ${displayedTrustScore}/100
  Compliance Score:  ${d.complianceScore ?? 'N/A'}/100
  Risk Class:        ${d.riskClass}
  Confidence:        ${d.confidence}
  Review Period:     ${d.reviewPeriod}
${SEP}
REASONING
${d.reason}
${SEP}
RECOMMENDED ACTIONS
${actions}
${SEP}
A2A CONTRIBUTORS
  [1] VERIS    — Trust Verification & Scoring
  [2] ZERU     — Research & Intelligence
  [3] SENTINEL — Compliance Decision  <-- (this step)

  Three autonomous agents cooperating on CROO · Base Mainnet
${SEP}`;
}

// ════════════════════════════════════════════════════════════════════
// CROO ORDER HANDLER
// ════════════════════════════════════════════════════════════════════

async function handleOrder(provider, orderId) {
  try {
    const order = await provider.getOrder(orderId);
    console.log('📋 Order received:', orderId);

    const rawRequirement =
      order.requirement     ||
      order.requirements    ||
      order.requirementText ||
      order.input           ||
      order.data            ||
      '';

    let requirements = {};
    if (rawRequirement) {
      let parsed = parseBody(rawRequirement);

      let unwrapDepth = 0;
      while (parsed && typeof parsed === 'object' && unwrapDepth < 5) {
        if (parsed.type && !Array.isArray(parsed.entities)) break;
        if (parsed.entityType && parsed.entityId) break;
        if (Array.isArray(parsed.agents)) break;
        if (Array.isArray(parsed.entities) && parsed.entities.length >= 2) break;

        if (parsed.name && typeof parsed.name === 'string' && parsed.name.includes('"entities"')) {
          try {
            const inner = JSON.parse(parsed.name);
            if (inner && typeof inner === 'object') {
              parsed = inner;
              unwrapDepth++;
              continue;
            }
          } catch {}
        }

        if (typeof parsed.text === 'string') {
          const inner = parseBody(parsed.text);
          if (inner && typeof inner === 'object') { parsed = inner; unwrapDepth++; continue; }
        }

        if (parsed.requirements && typeof parsed.requirements === 'object') {
          parsed = parsed.requirements; unwrapDepth++; continue;
        }

        if (typeof parsed.requirements === 'string') {
          const inner = parseBody(parsed.requirements);
          if (inner && typeof inner === 'object') { parsed = inner; unwrapDepth++; continue; }
        }

        break;
      }

      if (unwrapDepth > 0) {
        console.log(`  📦 Unwrapped ${unwrapDepth} layer(s) of CROO wrapping`);
      }

      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.agents)) {
        requirements = parsed;

      } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entities) && parsed.entities.length >= 2) {
        requirements = {
          agents: parsed.entities.map(e => {
            if (typeof e === 'string') {
              return {
                agentId: e,
                agentName: e,
                endpointUrl: null,
                serviceDescription: null,
                category: 'general',
                website: null,
              };
            }
            return {
              agentId: e.name || e.agentId || e.id || 'unknown',
              agentName: e.name || e.agentName || e.agentId || 'Unknown',
              endpointUrl: e.endpointUrl || null,
              serviceDescription: e.serviceDescription || e.description || null,
              category: e.category || parsed.category || 'general',
              website: e.website || null,
            };
          }),
        };
        console.log(`  📊 Normalised entities[] compare: ${requirements.agents.map(a => a.agentName).join(' vs ')}`);

      } else if (parsed && typeof parsed === 'object' && parsed.entityType && parsed.entityId) {
        requirements = parsed;

      } else if (parsed && typeof parsed === 'object' && parsed.type) {
        requirements = parsed;

      } else if (parsed && typeof parsed === 'object' && parsed.name) {
        requirements = { type: 'project', ...parsed };

      } else {
        const inputType = detectInputType(String(rawRequirement).trim());
        if (inputType.type === 'uuid') {
          requirements = { type: 'agent', agentId: String(rawRequirement).trim() };
        } else {
          requirements = { type: 'project', name: String(rawRequirement).trim() };
        }
      }
    }

    if (!requirements.type) requirements.type = 'project';
    if (requirements.type === 'project' && !requirements.name) {
      requirements.name = String(rawRequirement || 'Unknown').trim();
    }

    console.log('📋 Parsed requirements:', JSON.stringify(requirements));

    const inputIdentifier = requirements.name || requirements.agentId || requirements.entityId || '';
    const inputType = detectInputType(inputIdentifier);
    console.log(`  🔍 Input detected as: ${inputType.label}`);

    let report = '';

    if (Array.isArray(requirements.agents) && requirements.agents.length >= 2) {
      const isProjectCompare = requirements.agents.every(a => {
        const id = a.agentId || '';
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        return !isUUID && (a.website || !id.includes('-'));
      });

      if (isProjectCompare) {
        console.log(`  📊 Project Compare (from receipts): ${requirements.agents.map(a => a.agentName).join(' vs ')}`);
        
        // Look up receipts for each entity — NO fresh audits
        const projectResults = await Promise.all(requirements.agents.map(async (agent) => {
          const name = (agent.agentName || agent.agentId || '').toLowerCase().trim();
          if (!name) return { name: agent.agentName || 'Unknown', score: null, rec: 'Unknown', sigs: { verified: 0, total: 0 }, error: null, isInsufficient: true, note: 'No entity name provided' };
          
          try {
            const receipts = await getTrustReceipts(name, 1);
            if (!receipts || receipts.length === 0) {
              return { name: agent.agentName, score: null, rec: 'Unknown', sigs: { verified: 0, total: 0 }, error: null, isInsufficient: true, note: 'Not yet audited — run a VERIS trust audit first' };
            }
            const latest = receipts[0];
            const score = latest.score;
            const sigs = { verified: latest.signals_verified || 0, total: latest.signals_total || 0 };
            
            // Derive recommendation from score
            let rec = 'Unknown';
            if (score !== null) {
              if (score >= 85) rec = 'STRONGLY TRUSTED';
              else if (score >= 80) rec = 'TRUSTED';
              else if (score >= 65) rec = 'GENERALLY LEGITIMATE';
              else if (score >= 50) rec = 'MIXED SIGNALS';
              else if (score >= 30) rec = 'HIGH RISK';
              else rec = 'CRITICAL RISK';
            }
            
            return { name: agent.agentName, score, rec, sigs, error: null, isInsufficient: false, lastAudited: latest.created_at };
          } catch (err) {
            return { name: agent.agentName, score: null, rec: 'Error', sigs: { verified: 0, total: 0 }, error: err.message, isInsufficient: true };
          }
        }));

        // Sort: scored entities first (desc), then insufficient/not-yet-audited, then errors
        const ranked = [...projectResults].sort((a, b) => {
          if (a.error && !b.error) return 1;
          if (!a.error && b.error) return -1;
          if (a.isInsufficient && !b.isInsufficient) return 1;
          if (!a.isInsufficient && b.isInsufficient) return -1;
          if (a.score === null && b.score !== null) return 1;
          if (a.score !== null && b.score === null) return -1;
          return (b.score || 0) - (a.score || 0);
        });

        const best   = ranked.find(r => r.score !== null && !r.isInsufficient);
        const SEP    = '══════════════════════════════════════════════';
        const rows   = ranked.map((r, i) => {
          if (r.error) {
            return `  ${i + 1}. ${r.name.padEnd(20)} ERROR     ${r.error}`;
          }
          if (r.isInsufficient) {
            return `  ${i + 1}. ${r.name.padEnd(20)} N/A       ${r.note || 'Insufficient Data'}`;
          }
          const age = r.lastAudited ? `  (audited ${new Date(r.lastAudited).toLocaleDateString('en-GB')})` : '';
          return `  ${i + 1}. ${r.name.padEnd(20)} ${String(r.score + '/100').padStart(7)}  ${r.rec}  (${r.sigs.verified}/${r.sigs.total} signals)${age}`;
        }).join('\n');

        const allScored = projectResults.filter(r => r.score !== null);
        const insufficientCount = projectResults.filter(r => r.isInsufficient).length;

        let verdict = '';
        if (allScored.length === 0) {
          verdict = 'No projects have been audited yet. Run individual VERIS trust audits first, then compare.';
        } else if (best) {
          verdict = best.score >= 65
            ? `${best.name} has the strongest trust signals (${best.score}/100).`
            : `All compared projects have limited signals. Strongest: ${best.name} (${best.score}/100). Proceed with caution.`;
        }

        if (insufficientCount > 0) {
          verdict += ` ${insufficientCount} project${insufficientCount > 1 ? 's' : ''} ${insufficientCount === 1 ? 'has' : 'have'} not been audited yet. Run a VERIS trust audit for each to see their scores here.`;
        }

        report = `VERIS PROJECT TRUST COMPARE
${SEP}
Compared:  ${projectResults.map(r => r.name).join(', ')}
Queried:   ${new Date().toUTCString()}
Audited by: VERIS — Trust Infrastructure for the Agent Economy
${SEP}
RANKING  (from existing audit receipts)

${rows}

${SEP}
RECOMMENDATION
  ${verdict}
${SEP}
NOTE
  Scores are from the latest audit receipt for each project.
  Run a fresh VERIS trust audit to update any score before comparing.
${SEP}
AUDIT TRAIL
  Auditor: VERIS · CROO v1 · Base Mainnet
  Projects compared: ${projectResults.length}
  Timestamp: ${new Date().toISOString()}
${SEP}`;

      } else {
        console.log(`  📊 Agent Trust Compare: ${requirements.agents.length} agents`);
        report = await handleCompare(requirements.agents, REQUESTER_SDK_KEY);
      }

    } else if (requirements.entityId && requirements.entityType) {
      console.log(`  🗄️ Trust Receipt History: ${requirements.entityType} / ${requirements.entityId}`);

      const receipts = await getTrustReceipts(requirements.entityId.toLowerCase().trim());

      if (!receipts || receipts.length === 0) {
        report = `VERIS TRUST RECEIPT HISTORY
══════════════════════════════════════════════
Entity:     ${requirements.entityId}
Type:       ${requirements.entityType}
Queried:    ${new Date().toISOString()}
══════════════════════════════════════════════
This entity has not yet been audited by VERIS.

Run a trust audit first to generate the first receipt.
Once audited, VERIS will track score changes over time —
showing whether trust is improving, declining, or stable.

HOW TO GET STARTED
  1. Place a VERIS trust audit order for this entity.
  2. Wait for the audit report to be delivered.
  3. Place this Trust Receipt History order again
     to see the score trend.
══════════════════════════════════════════════
Auditor: VERIS · CROO v1 · Base Mainnet`;
      } else {
        const latest = receipts[0];
        const oldest = receipts[receipts.length - 1];
        const diff   = receipts.length > 1 ? (latest.score ?? 0) - (oldest.score ?? 0) : 0;
        const trend  = receipts.length > 1
          ? diff > 0  ? `↑ Improving (+${diff} points since first audit)`
          : diff < 0  ? `↓ Declining (${diff} points since first audit)`
          : '→ Stable (no change since first audit)'
          : 'Only one audit on record — run again later to see trend';

        const scoreHistory = receipts
          .map((r, i) =>
            `  ${i + 1}. ${new Date(r.created_at).toLocaleDateString('en-GB')} — ` +
            `Score: ${r.score ?? 'N/A'}/100  ` +
            `Risk: ${r.risk_level || 'Unknown'}  ` +
            `Signals: ${r.signals_verified || 0}/${r.signals_total || 0}`
          )
          .join('\n');

        report = `VERIS TRUST RECEIPT HISTORY
══════════════════════════════════════════════
Entity:     ${latest.entity_name || requirements.entityId}
Type:       ${requirements.entityType}
Audits:     ${receipts.length} on record
Queried:    ${new Date().toISOString()}
══════════════════════════════════════════════
LATEST SCORE
  Score:      ${latest.score ?? 'N/A'}/100
  Risk Level: ${latest.risk_level || 'Unknown'}
  Signals:    ${latest.signals_verified || 0}/${latest.signals_total || 0} verified
  Date:       ${new Date(latest.created_at).toLocaleString('en-GB')}
══════════════════════════════════════════════
SCORE TREND
  ${trend}
  Earliest:   ${oldest.score ?? 'N/A'}/100  (${new Date(oldest.created_at).toLocaleDateString('en-GB')})
  Latest:     ${latest.score ?? 'N/A'}/100  (${new Date(latest.created_at).toLocaleDateString('en-GB')})
${receipts.length > 1 ? `  Change:     ${diff > 0 ? '+' : ''}${diff} points across ${receipts.length} audits\n` : ''}══════════════════════════════════════════════
AUDIT HISTORY  (newest first)
${scoreHistory}
══════════════════════════════════════════════
WHAT THIS MEANS
  ${diff > 5  ? 'Trust signals have strengthened over time. Positive trajectory.' :
    diff < -5 ? 'Trust signals have weakened. Review latest report for details.' :
    receipts.length > 1 ? 'Trust score has remained consistent across audits.' :
    'First audit complete. Re-audit later to establish a trend.'}

  Re-audit recommended: ${
    diff < -5 ? 'As soon as possible — declining signals detected.' :
    latest.score && latest.score < 50 ? 'Soon — score is in the High Risk range.' :
    '30 days to track continued trend.'
  }
══════════════════════════════════════════════
Auditor: VERIS · CROO v1 · Base Mainnet`;
      }

    } else {
      // ── STANDARD TRUST AUDIT ──────────────────────────────────────
      if (!requirements.type) requirements.type = 'project';
      if (requirements.type === 'project' && !requirements.name) {
        requirements.name = String(rawRequirement || 'Unknown').trim();
      }

      report = await runVERIS(requirements, REQUESTER_SDK_KEY);

      if (report.includes('N/A (Insufficient Evidence)') || report.includes('INSUFFICIENT DATA')) {
        report += buildInsufficientDataBlock(
          requirements.name || requirements.agentId || 'Unknown',
          inputType,
          requirements.type
        );
      } else {
        report += buildReasoningBlock(report);
      }

      if (requirements.type === 'project' && requirements.name) {
        console.log(`  🔗 A2A: calling ZERU for ${requirements.name}...`);
        const zeruResult = await fetchZeruEnrichment(requirements.name);
        console.log(`  🔗 ZERU: ${zeruResult.available ? 'responded' : zeruResult.reason}`);
        report += buildEnrichmentBlock(zeruResult, requirements.name);

        console.log(`  🔗 A2A: calling SENTINEL...`);
        const scoreMatch    = report.match(/LEGITIMACY:\s+(\d+)\/100/i);
        const confMatch     = report.match(/CONFIDENCE:.*?(\d+)%/);
        const trustScore    = scoreMatch ? parseInt(scoreMatch[1]) : null;
        const confidence    = confMatch  ? parseInt(confMatch[1])  : 50;
        const incidents = parseIncidentsFromReport(report);
        const sentinelResult = await fetchSentinelDecision(trustScore, confidence, zeruResult, incidents);
        console.log(`  🔗 SENTINEL: ${sentinelResult.available ? sentinelResult.data?.verdict : sentinelResult.reason}`);
        report += buildSentinelBlock(sentinelResult, trustScore);
      }
    }

    const delivery = await provider.deliverOrder(orderId, {
      deliverableType: DeliverableType.Text,
      deliverableText: report,
    });
    console.log('📦 Delivered:', delivery.txHash);
  } catch (err) {
    console.error('Order handling error:', err.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// PROVIDER LISTENER
// ════════════════════════════════════════════════════════════════════

const activeConnections = new Set();
let reconnectAttempts   = 0;

async function startProvider(sdkKey, label) {
  if (!sdkKey)                       { console.log(`No SDK key for ${label} — skipping`); return; }
  if (activeConnections.has(sdkKey)) { console.log(`${label} already connected — skipping`); return; }
  activeConnections.add(sdkKey);
  try {
    console.log(`Starting ${label} provider...`);
    const provider = new AgentClient(config, sdkKey);
    const stream   = await provider.connectWebSocket();
    reconnectAttempts = 0;
    console.log(`✅ ${label} WebSocket connected`);
    stream.on(EventType.NegotiationCreated, async (e) => {
      console.log(`📨 ${label} negotiation:`, e.negotiation_id);
      try {
        const result = await provider.acceptNegotiation(e.negotiation_id);
        console.log('✅ Accepted, order:', result.order.orderId);
      } catch (err) { console.error('Accept error:', err.message); }
    });
    stream.on(EventType.OrderPaid, async (e) => {
      console.log(`💰 ${label} payment received:`, e.order_id);
      await handleOrder(provider, e.order_id);
    });
    stream.on(EventType.OrderCompleted, (e) => {
      console.log(`🎉 ${label} order settled:`, e.order_id);
    });
    stream.on('close', () => {
      activeConnections.delete(sdkKey);
      reconnectAttempts++;
      const delay = Math.min(5000 * reconnectAttempts, 30000);
      console.log(`${label} closed — reconnecting in ${delay / 1000}s`);
      setTimeout(() => startProvider(sdkKey, label), delay);
    });
    stream.on('error', (err) => console.error(`${label} WS error:`, err.message));
  } catch (err) {
    activeConnections.delete(sdkKey);
    reconnectAttempts++;
    const delay = Math.min(5000 * reconnectAttempts, 30000);
    console.error(`${label} failed: ${err.message} — retrying in ${delay / 1000}s`);
    setTimeout(() => startProvider(sdkKey, label), delay);
  }
}

// ════════════════════════════════════════════════════════════════════
// KEEP-ALIVE
// ════════════════════════════════════════════════════════════════════

setInterval(async () => {
  try   { await fetch(RENDER_URL); console.log('✅ Keep-alive ping'); }
  catch (e) { console.log('Keep-alive failed:', e.message); }
}, 14 * 60 * 1000);

// ════════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`VERIS backend running on port ${PORT}`);
  await startProvider(PROVIDER_SDK_KEY, 'VERIS Provider');
  if (STORE_SDK_KEY && STORE_SDK_KEY !== PROVIDER_SDK_KEY) {
    await startProvider(STORE_SDK_KEY, 'Agent Store');
  }
});
