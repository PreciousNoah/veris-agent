import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pkg from '@croo-network/sdk';
const { AgentClient, EventType, DeliverableType } = pkg;
import { runVERIS, handleCompare, getTrustReceipts, supabase } from './veris.js';
import fs from 'fs';

const app = express();
app.use(cors());

// FIX: parse JSON and plain text — CROO orders sometimes send raw text bodies
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

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

// Safely parse a request body that might be JSON string, JSON object,
// or plain text (all three come in from different CROO order formats)
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
  // Try all known patterns in the report
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
  // Count YES signals directly from the report as fallback
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
// API KEY MIDDLEWARE
// Skips gracefully if api_keys table doesn't exist yet
// ════════════════════════════════════════════════════════════════════

async function requireApiKey(req, res, next) {
  if (!supabase) return next(); // dev mode — no Supabase

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

    // Reset daily counter if it's a new day
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

    // Increment (fire-and-forget)
    supabase.from('api_keys')
      .update({ requests_today: data.requests_today + 1 })
      .eq('key', key)
      .then(() => {});

    req.apiKey = data;
    next();
  } catch {
    // Table doesn't exist yet — let through so tests aren't blocked
    console.warn('api_keys table not found — skipping auth. Run the Supabase migration.');
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
// CROO ROUTES — no auth, CROO handles that via SDK
// ════════════════════════════════════════════════════════════════════

app.post('/audit', async (req, res) => {
  // Handle JSON object, JSON string, or plain text body
  const body = parseBody(req.body);
  let requirements = body?.requirements;

  // If still no requirements, treat the whole body as requirements
  if (!requirements && body && typeof body === 'object') {
    requirements = body;
  }

  // Last resort: plain text body → treat as project name
  if (!requirements && typeof req.body === 'string' && req.body.trim()) {
    requirements = { type: 'project', name: req.body.trim() };
  }

  if (!requirements) {
    return res.status(400).json({ error: 'requirements object needed' });
  }

  try {
    let report = await runVERIS(requirements, REQUESTER_SDK_KEY);

    // A2A enrichment — same flow as CROO orders
    if (requirements.type === 'project' && requirements.name) {
      const zeruResult = await fetchZeruEnrichment(requirements.name);
      report += buildEnrichmentBlock(zeruResult, requirements.name);
    }

    res.json({ report });
  } catch (err) {
    console.error('/audit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /compare  (agent trust compare — existing CROO format) ──────
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

// ── GET /compare/projects?a=Aave&b=Compound  (judge-friendly) ────────
// Returns structured JSON comparison — no text report, directly readable
app.get('/compare/projects', requireApiKey, async (req, res) => {
  const names = [req.query.a, req.query.b, req.query.c, req.query.d, req.query.e]
    .filter(Boolean)
    .map(n => n.trim());

  if (names.length < 2) {
    return res.status(400).json({ error: 'Pass at least ?a=ProjectA&b=ProjectB' });
  }

  console.log(`\n⚖️ VERIS Project Compare: ${names.join(' vs ')}`);

  // Run all audits in parallel — use cache where available
  const results = await Promise.all(names.map(async (name) => {
    try {
      // Check cache first
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
      // Run fresh audit
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

  // Rank by trust score
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
    compared:   names,
    results:    ranked,
    best:       best?.entity || null,
    verdict,
    timestamp:  new Date().toISOString(),
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

    // Filter out junk entity names from old malformed CROO orders
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

// Judge-friendly summary — groups by entity, shows latest score per entity
app.get('/receipts/summary', async (req, res) => {
  if (!supabase) return res.json({ entities: [], note: 'Supabase not configured' });
  try {
    const { data, error } = await supabase
      .from('trust_receipts')
      .select('entity_type, entity_name, score, risk_level, signals_verified, signals_total, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    // Filter out junk entity names — old CROO orders where raw JSON got saved as name
    const isCleanName = (name) => {
      if (!name) return false;
      if (name.startsWith('{')) return false;       // raw JSON object
      if (name.startsWith('"')) return false;       // quoted string
      if (name.length > 60)  return false;          // suspiciously long
      if (name.includes('\\')) return false;        // escaped JSON
      if (name.includes('type')) return false;      // JSON field leaking in
      return true;
    };

    // Derive risk level from score when stored value is missing
    const deriveRisk = (score, stored, type) => {
      if (stored && stored !== 'Unknown' && stored !== 'unknown') return stored;
      if (score === null || score === undefined) return 'Unknown';
      // Agents use a separate trust model
      if (type === 'agent') {
        if (score >= 76) return 'Trusted';
        if (score >= 56) return 'Established';
        if (score >= 36) return 'Emerging';
        if (score >= 16) return 'Unverified';
        return 'Critical';
      }
      // Projects
      if (score >= 80) return 'Low';
      if (score >= 65) return 'Low-Medium';
      if (score >= 50) return 'Medium';
      if (score >= 30) return 'High';
      if (score <= 5)  return 'Critical';
      return 'High';
    };

    // Deduplicate — keep latest per entity name
    const seen = new Map();
    for (const row of (data || [])) {
      if (!isCleanName(row.entity_name)) continue;
      if (!seen.has(row.entity_name)) seen.set(row.entity_name, row);
    }

    const entities = [...seen.values()].sort((a, b) => {
      // Sort: projects by score desc, then agents
      if (a.entity_type !== b.entity_type) {
        return a.entity_type === 'project' ? -1 : 1;
      }
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
// TRUST API  —  GET /trust/:entityName
// Returns a structured JSON trust score.
// This is what ZERU and other agents consume.
// ════════════════════════════════════════════════════════════════════

app.get('/trust/:entityName', requireApiKey, async (req, res) => {
  const entityName   = req.params.entityName.trim();
  const entityType   = req.query.type || 'project';
  const forceRefresh = req.query.refresh === 'true';

  // Agent audits bypass cache — agent status changes frequently
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

      // Parse agent report metrics
      const overallMatch  = report.match(/OVERALL SCORE:\s+(\d+)\/100/);
      const confMatch     = report.match(/CONFIDENCE:\s+(High|Medium|Low)/i);
      const recMatch      = report.match(/RECOMMENDATION:\s+[^\s]+\s+([A-Z ]+)\n/);
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
        // Agent trust model — separate bands from project model
        trustBand:       deriveAgentRiskLevel(trustScore, layerScores),
        riskLevel:       deriveAgentRiskLevel(trustScore, layerScores),
        recommendation:  deriveAgentRecommendation(trustScore, layerScores),
        signalsVerified: coverageMatch ? parseInt(coverageMatch[1]) : 0,
        signalsTotal:    coverageMatch ? parseInt(coverageMatch[2]) : 15,
        layerScores,
        // Agent-specific context
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

  // Project path (unchanged)
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
// Agents are judged differently from projects.
// A new agent with a working endpoint is NOT the same as FTX.
// These bands reflect ecosystem maturity, not just raw score.
//
//  0-15   Critical      — failed live tests, or confirmed fraud
//  16-35  Unverified    — no metadata, no web presence, no live test
//  36-55  Emerging      — some signals but limited verification
//  56-75  Established   — metadata + web presence OR live verified
//  76-100 Trusted       — all three layers confirmed
// ════════════════════════════════════════════════════════════════════
function deriveAgentRiskLevel(score, layerScores) {
  if (score === null) return 'Unknown';
  const liveWorking = (layerScores?.live  || 0) > 0;
  const webWorking  = (layerScores?.web   || 0) > 0;
  const metaWorking = (layerScores?.metadata || 0) > 0;

  // If live endpoint is working, agent is at minimum Emerging
  // regardless of metadata availability
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
// EVIDENCE API  —  GET /evidence/:entityName
// Returns raw structured evidence — not a score.
// Lets other agents build their own models on top of VERIS data.
// ════════════════════════════════════════════════════════════════════

app.get('/evidence/:entityName', requireApiKey, async (req, res) => {
  const entityName   = req.params.entityName.trim();
  const forceRefresh = req.query.refresh === 'true';

  // 1. Check for cached raw_evidence in Supabase
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
    } catch { /* cache miss — fall through */ }
  }

  // 2. Run pipeline and extract evidence from report
  try {
    const report = await runVERIS(
      { type: 'project', name: entityName },
      REQUESTER_SDK_KEY
    );

    const signals        = parseSignalsFromReport(report);
    const githubMatch    = report.match(/Active GitHub[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const auditMatch     = report.match(/Security audit found[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const whitepaperMatch= report.match(/Whitepaper found[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const foundedMatch   = report.match(/Founded:\s+(\d{4})/);
    const incidents      = parseIncidentsFromReport(report);

    res.json({
      entity: entityName,
      evidence: {
        github:      githubMatch     ? [githubMatch[1]]     : null,
        whitepaper:  whitepaperMatch ? [whitepaperMatch[1]] : null,
        audit:       auditMatch      ? [auditMatch[1]]      : null,
        founded:     foundedMatch    ? parseInt(foundedMatch[1]) : null,
        openSource:  report.includes('Open source confirmed'),
        liveProduct: report.includes('Live product confirmed'),
        incidents,
      },
      signalCoverage: {
        verified: signals.verified,
        total:    signals.total,
        pct:      signals.total > 0
                    ? Math.round((signals.verified / signals.total) * 100)
                    : 0,
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
// A2A DEMO  —  GET /a2a/demo/:entityName
// Shows VERIS + ZERU working together.
// ZERU_API_URL env var points at your research agent.
// ════════════════════════════════════════════════════════════════════

app.get('/a2a/demo/:entityName', requireApiKey, async (req, res) => {
  const entityName = req.params.entityName.trim();
  const zeruUrl    = process.env.ZERU_API_URL;

  const result = { entity: entityName, veris: null, research: null, combined: null };

  // VERIS trust — force refresh so we never serve stale cached receipts
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

  // ZERU research (if configured)
  if (zeruUrl) {
    try {
      const zeruRes = await fetch(
        `${zeruUrl}/research/${encodeURIComponent(entityName)}`,
        {
          headers: { 'X-Api-Key': process.env.ZERU_API_KEY || '' },
          signal:  AbortSignal.timeout(30000),
        }
      );
      result.research = zeruRes.ok ? await zeruRes.json() : { error: `ZERU returned ${zeruRes.status}` };
    } catch (err) {
      result.research = { error: `ZERU unavailable: ${err.message}` };
    }
  } else {
    result.research = { note: 'Set ZERU_API_URL env var to enable A2A composability demo' };
  }

  // Combined signal
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
// A2A ENRICHMENT — VERIS automatically calls ZERU for every project
// audit and appends a visible research section to the delivered report.
// This is not optional/hidden — it's baked into the standard audit flow.
// ════════════════════════════════════════════════════════════════════

async function fetchZeruEnrichment(entityName) {
  const zeruUrl = process.env.ZERU_API_URL;
  if (!zeruUrl) {
    return { available: false, reason: 'ZERU_API_URL not configured' };
  }
  try {
    const res = await fetch(
      `${zeruUrl}/research/${encodeURIComponent(entityName)}`,
      {
        headers: { 'X-Api-Key': process.env.ZERU_API_KEY || '' },
        signal:  AbortSignal.timeout(20000), // 20s — fail fast rather than risk gateway 502
      }
    );
    if (!res.ok) {
      return { available: false, reason: `ZERU returned ${res.status}` };
    }
    const data = await res.json();
    return { available: true, data };
  } catch (err) {
    return { available: false, reason: err.name === 'TimeoutError' ? 'ZERU timed out (20s)' : err.message };
  }
}

function buildEnrichmentBlock(zeruResult, entityName) {
  if (!zeruResult.available) {
    return `

══════════════════════════════════════════════
A2A RESEARCH ENRICHMENT
Source: ZERU Research Agent
Status: Unavailable (${zeruResult.reason})
══════════════════════════════════════════════
DATA SOURCES
  ✓ VERIS Trust Engine
  ✗ ZERU Research Agent (unreachable)
══════════════════════════════════════════════`;
  }

  const d = zeruResult.data;
  const risksText = (d.risks || []).slice(0, 5).map(r => `  • ${r}`).join('\n') || '  • None identified';
  const compText  = (d.competitors || []).slice(0, 2).map(c => `  • ${c}`).join('\n') || '  • Not identified';

  return `

══════════════════════════════════════════════
A2A RESEARCH ENRICHMENT
Source: ZERU Research Agent
══════════════════════════════════════════════
SUMMARY
${(d.summary || 'No summary available').trim()}

KEY FINDINGS (Risks Identified)
${risksText}

MARKET CONTEXT
${compText}

SENTIMENT: ${(d.sentiment || 'neutral').toUpperCase()}
══════════════════════════════════════════════
DATA SOURCES

VERIS → Trust Analysis (legitimacy, maturity, evidence verification)
ZERU  → Research Intelligence (market context, risk signals, sentiment)

This audit was independently enriched by a second autonomous agent
on the CROO network — demonstrating agent-to-agent composability.
══════════════════════════════════════════════`;
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

      // CROO wraps payloads in layers. Known shapes observed in production:
      // Layer 1: { "text": "<json string>" }
      // Layer 2: { "requirements": { "type": "project", ... } }
      // Layer 3: { "type": "project", "name": "..." }  ← actual requirement
      // Unwrap until we hit an object with a recognizable "type" field.

      let unwrapDepth = 0;
      while (parsed && typeof parsed === 'object' && unwrapDepth < 5) {
        // If it has a type field directly, we're done
        if (parsed.type) break;

        // Unwrap { text: "<json string>" }
        if (typeof parsed.text === 'string') {
          const inner = parseBody(parsed.text);
          if (inner && typeof inner === 'object') { parsed = inner; unwrapDepth++; continue; }
        }

        // Unwrap { requirements: { type: "project", ... } }
        if (parsed.requirements && typeof parsed.requirements === 'object') {
          parsed = parsed.requirements; unwrapDepth++; continue;
        }

        // Unwrap { requirements: "<json string>" }
        if (typeof parsed.requirements === 'string') {
          const inner = parseBody(parsed.requirements);
          if (inner && typeof inner === 'object') { parsed = inner; unwrapDepth++; continue; }
        }

        // Nothing left to unwrap
        break;
      }

      if (unwrapDepth > 0) {
        console.log(`  📦 Unwrapped ${unwrapDepth} layer(s) of CROO wrapping`);
      }

      if (parsed && typeof parsed === 'object' && parsed.type) {
        requirements = parsed;
      } else if (parsed && typeof parsed === 'object' && parsed.name) {
        // Has name but no type — assume project
        requirements = { type: 'project', ...parsed };
      } else {
        // Last resort: plain text → treat as project name
        requirements = { type: 'project', name: String(rawRequirement).trim() };
      }
    }

    if (!requirements.type) requirements.type = 'project';
    if (requirements.type === 'project' && !requirements.name) {
      requirements.name = String(rawRequirement || 'Unknown').trim();
    }

    console.log('📋 Parsed requirements:', JSON.stringify(requirements));

    let report = await runVERIS(requirements, REQUESTER_SDK_KEY);

    // A2A enrichment — automatically call ZERU for project audits
    if (requirements.type === 'project' && requirements.name) {
      console.log(`  🔗 A2A: calling ZERU for research enrichment on ${requirements.name}...`);
      const zeruResult = await fetchZeruEnrichment(requirements.name);
      console.log(`  🔗 A2A: ZERU ${zeruResult.available ? 'responded' : `unavailable (${zeruResult.reason})`}`);
      report += buildEnrichmentBlock(zeruResult, requirements.name);
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
// PROVIDER LISTENER  (WebSocket to CROO)
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
// KEEP-ALIVE  (prevents Railway/Render sleeping)
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
