import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pkg from '@croo-network/sdk';
const { AgentClient, EventType, DeliverableType } = pkg;
import { runVERIS } from './veris.js';
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

// Load credentials
let credentials = {};
try {
  credentials = JSON.parse(fs.readFileSync('veris-credentials.json', 'utf8'));
} catch {
  console.warn('veris-credentials.json not found — run setup.js first');
}

const PROVIDER_SDK_KEY = process.env.CROO_API_KEY || credentials.sdkKey;
const REQUESTER_SDK_KEY = process.env.CROO_REQUESTER_SDK_KEY;
const STORE_SDK_KEY = process.env.CROO_STORE_SDK_KEY;
const SERVICE_ID = credentials.serviceId;

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'VERIS online',
    version: 'v1',
    capabilities: ['project-due-diligence', 'agent-audit'],
    network: 'Base Mainnet',
    protocol: 'CROO v1',
    agentId: credentials.agentId,
  });
});

// Manual test endpoint
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

// CROO order handler
async function handleOrder(provider, orderId) {
  try {
    const order = await provider.getOrder(orderId);
    const requirements = JSON.parse(order.requirement || '{}');
    console.log('📋 Requirements:', requirements);

    const report = await runVERIS(requirements, REQUESTER_SDK_KEY);

    const delivery = await provider.deliverOrder(orderId, {
      deliverableType: DeliverableType.Text,
      deliverableText: report,
    });
    console.log('📦 Delivered:', delivery.txHash);
  } catch (err) {
    console.error('Order handling error:', err.message);
  }
}

// Provider listener with auto-reconnect
let reconnectAttempts = 0;

const activeConnections = new Set();

async function startProvider(sdkKey, label) {
  if (!sdkKey) {
    console.log(`No SDK key for ${label} — skipping`);
    return;
  }
  if (activeConnections.has(sdkKey)) {
    console.log(`${label} already connected — skipping duplicate`);
    return;
  }
  activeConnections.add(sdkKey);
  try {
    console.log(`Starting ${label} provider...`);
    const provider = new AgentClient(config, sdkKey);
    const stream = await provider.connectWebSocket();
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
      reconnectAttempts++;
      const delay = Math.min(5000 * reconnectAttempts, 30000);
      console.log(`${label} WebSocket closed — reconnecting in ${delay/1000}s`);
      setTimeout(() => startProvider(sdkKey, label), delay);
    });

    stream.on('error', (err) => console.error(`${label} error:`, err.message));

  } catch (err) {
    reconnectAttempts++;
    const delay = Math.min(5000 * reconnectAttempts, 30000);
    console.error(`${label} failed: ${err.message} — retrying in ${delay/1000}s`);
    setTimeout(() => startProvider(sdkKey, label), delay);
  }
}

// Keep-alive
setInterval(async () => {
  try {
    await fetch(RENDER_URL);
    console.log('✅ Keep-alive ping');
  } catch (e) { console.log('Keep-alive failed:', e.message); }
}, 14 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`✅ VERIS backend running on port ${PORT}`);
  await startProvider(PROVIDER_SDK_KEY, 'VERIS Provider');
});