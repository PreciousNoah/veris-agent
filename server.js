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
    ],
    endpoints: {
      croo:     ['POST /audit', 'POST /compare', 'GET /receipts', 'GET /receipts/:entityId'],
      trust:    ['GET /trust/:entityName', 'GET /trust/:entityName?type=agent'],
      evidence: ['GET /evidence/:entityName'],
      a2a:      ['GET /a2a/demo/:entityName'],
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
    const report = await runVERIS(requirements, REQUESTER_SDK_KEY);
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

app.get('/receipts', async (req, res) => {
  if (!supabase) return res.json({ receipts: [], note: 'Supabase not configured' });
  try {
    const { data, error } = await supabase
      .from('trust_receipts')
      .select('id, entity_type, entity_name, score, risk_level, signals_verified, signals_total, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ receipts: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/receipts/:entityId', async (req, res) => {
  try {
    const receipts = await getTrustReceipts(req.params.entityId);
    res.json({ entityId: req.params.entityId, receipts });
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

  // 1. Return cached result if available
  if (!forceRefresh) {
    const cached = await getCachedReceipt(entityName);
    if (cached) return res.json(receiptToTrustJSON(cached, true));
  }

  // 2. Run full pipeline
  try {
    const requirements = entityType === 'agent'
      ? { type: 'agent', agentName: entityName }
      : { type: 'project', name: entityName };

    const report         = await runVERIS(requirements, REQUESTER_SDK_KEY);
    const score          = parseScoreFromReport(report);
    const confidence     = parseConfidenceFromReport(report);
    const recommendation = parseRecommendationFromReport(report);
    const signals        = parseSignalsFromReport(report);
    const incidents      = parseIncidentsFromReport(report);

    // Derive a simple risk level string
    let riskLevel = 'Unknown';
    if (score !== null) {
      if (score >= 80)      riskLevel = 'Low';
      else if (score >= 65) riskLevel = 'Low-Medium';
      else if (score >= 50) riskLevel = 'Medium';
      else if (score >= 30) riskLevel = 'High';
      else                  riskLevel = 'Critical';
    }
    if (incidents.length > 0) riskLevel = 'Critical';

    res.json({
      entity:          entityName,
      entityId:        entityName.toLowerCase().trim(),
      entityType,
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

  // VERIS trust (cached if available)
  try {
    const cached = await getCachedReceipt(entityName);
    if (cached) {
      result.veris = receiptToTrustJSON(cached, true);
    } else {
      const report = await runVERIS({ type: 'project', name: entityName }, REQUESTER_SDK_KEY);
      result.veris = {
        trustScore:      parseScoreFromReport(report),
        confidence:      parseConfidenceFromReport(report),
        recommendation:  parseRecommendationFromReport(report),
        signalsVerified: parseSignalsFromReport(report).verified,
        incidents:       parseIncidentsFromReport(report),
        cached:          false,
      };
    }
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
      const parsed = parseBody(rawRequirement);
      if (parsed && typeof parsed === 'object') {
        requirements = parsed;
      } else {
        // Plain text — treat as project name
        requirements = { type: 'project', name: String(rawRequirement).trim() };
      }
    }

    if (!requirements.type)                                    requirements.type = 'project';
    if (requirements.type === 'project' && !requirements.name) requirements.name = String(rawRequirement || 'Unknown').trim();

    console.log('📋 Parsed requirements:', JSON.stringify(requirements));

    const report   = await runVERIS(requirements, REQUESTER_SDK_KEY);
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
