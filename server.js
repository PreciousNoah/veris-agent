import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pkg from '@croo-network/sdk';
const { AgentClient, EventType, DeliverableType } = pkg;
import { runVERIS, handleCompare, getTrustReceipts, supabase, runProjectDueDiligence } from './veris.js';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

const config = {
  baseURL: process.env.CROO_API_URL,
  wsURL: process.env.CROO_WS_URL,
  rpcURL: 'https://mainnet.base.org',
  logger: { debug:()=>{}, info:console.log, warn:console.warn, error:console.error },
};

const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://veris-agent.onrender.com';

let credentials = {};
try {
  credentials = JSON.parse(fs.readFileSync('veris-credentials.json', 'utf8'));
} catch {
  console.warn('veris-credentials.json not found');
}

const PROVIDER_SDK_KEY  = process.env.CROO_API_KEY || credentials.sdkKey;
const REQUESTER_SDK_KEY = process.env.CROO_REQUESTER_SDK_KEY;
const STORE_SDK_KEY     = process.env.CROO_STORE_SDK_KEY;

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════
// CACHE HELPERS
// ════════════════════════════════════════════════════════════════════

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
  } catch {
    return null;
  }
}

function parseScoreFromReport(report) {
  if (!report) return null;
  const m = report.match(/LEGITIMACY:\s+(\d+)\/100/i) ||
            report.match(/OVERALL SCORE:\s*(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

function parseConfidenceFromReport(report) {
  if (!report) return null;
  const m = report.match(/CONFIDENCE:\s+[▓░]+\s+(\d+)%/);
  return m ? parseInt(m[1]) : null;
}

function parseRiskFromReport(report) {
  if (!report) return 'Unknown';
  const m = report.match(/RECOMMENDATION:\s+[^\s]+\s+([A-Z ]+)\s+\[Band/);
  return m ? m[1].trim() : 'Unknown';
}

function parseSignalsFromReport(report) {
  if (!report) return { verified: 0, total: 0 };
  const m = report.match(/SIGNAL COVERAGE:\s+(\d+)\/(\d+)/i) ||
            report.match(/(\d+)\/(\d+) signals/i);
  return m ? { verified: parseInt(m[1]), total: parseInt(m[2]) } : { verified: 0, total: 0 };
}

function parseIncidentsFromReport(report) {
  if (!report) return [];
  const incidents = [];
  const hardMatch = report.match(/⛔ HARD TRUST EVENT[^\n]*\n([\s\S]*?)(?:══|$)/);
  if (hardMatch) {
    const lines = hardMatch[1].split('\n').filter(l => l.trim().startsWith('Confirmed') || l.includes('label:'));
    incidents.push(...lines.map(l => l.trim()).filter(Boolean));
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
// ════════════════════════════════════════════════════════════════════

async function requireApiKey(req, res, next) {
  // Skip auth if no Supabase (dev mode) or if table doesn't exist yet
  if (!supabase) return next();

  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'API key required. Pass X-Api-Key header or ?api_key= query param.' });

  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key', key)
      .single();

    if (error || !data) return res.status(403).json({ error: 'Invalid API key.' });

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
      return res.status(429).json({ error: `Daily limit of ${limit} requests reached.` });
    }

    // Increment usage (fire-and-forget)
    supabase.from('api_keys')
      .update({ requests_today: data.requests_today + 1 })
      .eq('key', key)
      .then(() => {});

    req.apiKey = data;
    next();
  } catch {
    // If api_keys table doesn't exist yet, let through (dev / pre-setup)
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
      admin:    ['GET /receipts', 'GET /receipts/:entityId'],
    },
    network:  'Base Mainnet',
    protocol: 'CROO v1',
    agentId:  credentials.agentId || null,
  });
});

// ════════════════════════════════════════════════════════════════════
// CROO ROUTES (existing — no auth required, CROO handles that)
// ════════════════════════════════════════════════════════════════════

app.post('/audit', async (req, res) => {
  const { requirements } = req.body;
  if (!requirements) return res.status(400).json({ error: 'requirements object needed' });
  try {
    const report = await runVERIS(requirements, REQUESTER_SDK_KEY);
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/compare', async (req, res) => {
  const { agents } = req.body;
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
// Consumed by: ZERU research agent, third-party agents, A2A calls
// Returns structured JSON trust score — not a text report
// ════════════════════════════════════════════════════════════════════

app.get('/trust/:entityName', requireApiKey, async (req, res) => {
  const entityName = req.params.entityName.trim();
  const entityType = req.query.type || 'project'; // 'project' | 'agent'
  const forceRefresh = req.query.refresh === 'true';

  // 1. Check cache first
  if (!forceRefresh) {
    const cached = await getCachedReceipt(entityName);
    if (cached) {
      return res.json(receiptToTrustJSON(cached, true));
    }
  }

  // 2. Run full pipeline
  try {
    const requirements = entityType === 'agent'
      ? { type: 'agent', agentName: entityName }
      : { type: 'project', name: entityName };

    const report = await runVERIS(requirements, REQUESTER_SDK_KEY);

    const score      = parseScoreFromReport(report);
    const confidence = parseConfidenceFromReport(report);
    const riskLevel  = parseRiskFromReport(report);
    const signals    = parseSignalsFromReport(report);
    const incidents  = parseIncidentsFromReport(report);

    // Derive recommendation label from report
    const recMatch = report.match(/RECOMMENDATION:\s+[^\s]+\s+([A-Z ]+)\s+\[Band/);
    const recommendation = recMatch ? recMatch[1].trim() : riskLevel;

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
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// EVIDENCE API  —  GET /evidence/:entityName
// The most valuable endpoint for A2A composability.
// Returns raw structured evidence so consuming agents can build
// their own scoring models on top of VERIS data.
// ════════════════════════════════════════════════════════════════════

app.get('/evidence/:entityName', requireApiKey, async (req, res) => {
  const entityName = req.params.entityName.trim();
  const forceRefresh = req.query.refresh === 'true';

  // 1. Check Supabase for cached raw_evidence
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
    } catch {
      // Cache miss — proceed to pipeline
    }
  }

  // 2. Run pipeline and return structured evidence
  try {
    // We run runProjectDueDiligence directly so we can intercept raw evidence
    // The report is still saved to Supabase via saveTrustReceipt inside the pipeline
    const report = await runVERIS(
      { type: 'project', name: entityName },
      REQUESTER_SDK_KEY
    );

    // Extract structured evidence fields from the report text
    // (full raw_evidence is stored in Supabase by saveTrustReceipt if columns exist)
    const signals = parseSignalsFromReport(report);

    // Parse key evidence blocks from formatted report
    const githubMatch    = report.match(/Active GitHub[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const auditMatch     = report.match(/Security audit found[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const whitepaperMatch= report.match(/Whitepaper found[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const foundedMatch   = report.match(/Founded:\s+(\d{4})/);
    const founderMatch   = report.match(/Founders publicly named[^\n]*\n\s+└─ (https?:\/\/[^\s]+)/);
    const openSourceMatch= report.match(/\+\s*\d+\s+Open source confirmed/);
    const liveMatch      = report.match(/\+\s*\d+\s+Live product confirmed/);
    const incidentLines  = parseIncidentsFromReport(report);

    res.json({
      entity: entityName,
      evidence: {
        github:         githubMatch    ? [githubMatch[1]]    : null,
        whitepaper:     whitepaperMatch? [whitepaperMatch[1]]: null,
        audit:          auditMatch     ? [auditMatch[1]]     : null,
        founders:       founderMatch   ? [founderMatch[1]]   : [],
        founded:        foundedMatch   ? parseInt(foundedMatch[1]) : null,
        openSource:     !!openSourceMatch,
        liveProduct:    !!liveMatch,
        incidents:      incidentLines,
      },
      signalCoverage: {
        verified: signals.verified,
        total:    signals.total,
        pct:      signals.total > 0
                    ? Math.round((signals.verified / signals.total) * 100)
                    : 0,
      },
      // Full report available if consuming agent needs it
      reportAvailable: true,
      cached:    false,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// A2A DEMO ROUTE  —  GET /a2a/demo
// Proof-of-concept: VERIS consuming a research agent's output
// and combining it with its own trust score.
// Replace ZERU_API_URL env var with your research agent's endpoint.
// ════════════════════════════════════════════════════════════════════

app.get('/a2a/demo/:entityName', requireApiKey, async (req, res) => {
  const entityName = req.params.entityName.trim();
  const zeruUrl    = process.env.ZERU_API_URL;

  const result = {
    entity:   entityName,
    veris:    null,
    research: null,
    combined: null,
    error:    null,
  };

  // 1. VERIS trust score (cached if available)
  try {
    const cached = await getCachedReceipt(entityName);
    if (cached) {
      result.veris = receiptToTrustJSON(cached, true);
    } else {
      const report = await runVERIS(
        { type: 'project', name: entityName },
        REQUESTER_SDK_KEY
      );
      result.veris = {
        trustScore:     parseScoreFromReport(report),
        confidence:     parseConfidenceFromReport(report),
        riskLevel:      parseRiskFromReport(report),
        signalsVerified:parseSignalsFromReport(report).verified,
        cached:         false,
      };
    }
  } catch (err) {
    result.error = `VERIS error: ${err.message}`;
  }

  // 2. ZERU research (if configured)
  if (zeruUrl) {
    try {
      const zeruRes = await fetch(
        `${zeruUrl}/research/${encodeURIComponent(entityName)}`,
        { headers: { 'X-Api-Key': process.env.ZERU_API_KEY || '' }, signal: AbortSignal.timeout(30000) }
      );
      if (zeruRes.ok) {
        result.research = await zeruRes.json();
      }
    } catch (err) {
      result.research = { error: `ZERU unavailable: ${err.message}` };
    }
  } else {
    result.research = { note: 'Set ZERU_API_URL env var to enable research agent composability' };
  }

  // 3. Combined signal — VERIS trust + ZERU research
  if (result.veris && result.research && !result.research.error) {
    result.combined = {
      entity:         entityName,
      trustScore:     result.veris.trustScore,
      researchRisks:  result.research.risks || [],
      compositeSignal: result.veris.trustScore !== null
        ? (result.veris.trustScore >= 65 ? 'Proceed with diligence' : 'High caution advised')
        : 'Insufficient data',
      dataSources:    ['VERIS Trust Engine', 'ZERU Research Agent'],
      timestamp:      new Date().toISOString(),
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
    console.log('📋 Full order:', JSON.stringify(order, null, 2));

    const rawRequirement =
      order.requirement     ||
      order.requirements    ||
      order.requirementText ||
      order.input           ||
      order.data            ||
      '';

    console.log('📋 Raw requirement:', rawRequirement);

    let requirements = {};
    if (rawRequirement) {
      try {
        requirements = typeof rawRequirement === 'string'
          ? JSON.parse(rawRequirement)
          : rawRequirement;
      } catch {
        requirements = { type: 'project', name: String(rawRequirement).trim() };
      }
    }

    if (!requirements.type) requirements.type = 'project';
    if (requirements.type === 'project' && !requirements.name) {
      requirements.name = String(rawRequirement || 'Unknown').trim();
    }

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
// PROVIDER LISTENER
// ════════════════════════════════════════════════════════════════════

const activeConnections = new Set();
let reconnectAttempts   = 0;

async function startProvider(sdkKey, label) {
  if (!sdkKey) { console.log(`No SDK key for ${label} — skipping`); return; }
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

    stream.on('error', (err) => console.error(`${label} error:`, err.message));
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