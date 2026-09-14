import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ strict: false }));

const AGENT_ID = '350048';
const BSC_MAINNET_CHAIN_ID = 56;
const AGENT_WALLET = '0x6df5698866AAeaa56B6cdE076070Ae986779d084';
const AGENT_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

function publicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

async function audit(input) {
  const requirements = input?.requirements || input;
  if (!requirements?.name && !requirements?.agentId) throw new Error('A project name or agentId is required.');
  if (!process.env.GROQ_API_KEY || !process.env.TAVILY_API_KEY) {
    throw new Error('VERIS Fresh requires GROQ_API_KEY and TAVILY_API_KEY to run audits.');
  }
  const { runVERIS } = await import('../../veris.js');
  return { report: await runVERIS(requirements) };
}

app.get('/', (req, res) => res.json({
  status: 'VERIS Fresh online',
  version: 'fresh-render-1',
  role: 'Trust verification and due diligence',
  network: 'BSC Mainnet',
  protocol: 'ERC-8004 / A2A',
  agentId: AGENT_ID,
  wallet: AGENT_WALLET,
  endpoint: publicBaseUrl(req),
  endpoints: {
    audit: 'POST /audit',
    compare: 'POST /compare',
    agentCard: 'GET /.well-known/agent-card.json',
    registration: 'GET /.well-known/agent-registration.json',
  },
  identity: { erc8004: AGENT_ID, mode: 'fresh-independent' },
}));

app.get('/.well-known/agent-card.json', (req, res) => {
  const baseUrl = publicBaseUrl(req);
  res.json({
    name: 'VERIS Fresh',
    description: 'Project and agent due diligence with trust reports.',
    url: baseUrl,
    version: '1.0.0',
    protocolVersion: '0.3.0',
    preferredTransport: 'JSONRPC',
    capabilities: { streaming: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    identity: {
      standard: 'ERC-8004', chainId: BSC_MAINNET_CHAIN_ID, agentId: Number(AGENT_ID),
      wallet: AGENT_WALLET, agentURI: `${baseUrl}/.well-known/agent-registration.json`,
    },
    skills: [
      { id: 'trust-audit', name: 'Trust audit', description: 'Audits a project or agent.' },
      { id: 'trust-compare', name: 'Trust comparison', description: 'Compares two or more projects.' },
    ],
  });
});

app.get('/.well-known/agent-registration.json', (req, res) => {
  const baseUrl = publicBaseUrl(req);
  res.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'VERIS Fresh',
    description: 'Independent BSC Mainnet VERIS trust verification and due diligence agent.',
    services: [
      { name: 'web', endpoint: baseUrl },
      { name: 'A2A', endpoint: `${baseUrl}/.well-known/agent-card.json`, version: '0.3.0' },
    ],
    active: true,
    agentWallet: `eip155:${BSC_MAINNET_CHAIN_ID}:${AGENT_WALLET}`,
    registrations: [{
      agentId: Number(AGENT_ID),
      agentRegistry: `eip155:${BSC_MAINNET_CHAIN_ID}:${AGENT_REGISTRY}`,
    }],
  });
});
app.post('/audit', async (req, res) => { try { res.json(await audit(req.body)); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/compare', async (req, res) => {
  try {
    const agents = req.body?.agents;
    if (!Array.isArray(agents) || agents.length < 2) throw new Error('agents must contain at least two entries.');
    if (!process.env.GROQ_API_KEY || !process.env.TAVILY_API_KEY) throw new Error('VERIS Fresh requires GROQ_API_KEY and TAVILY_API_KEY.');
    const { handleCompare } = await import('../../veris.js');
    res.json({ report: await handleCompare(agents) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const port = Number(process.env.PORT || 3101);
app.listen(port, () => { console.log(`VERIS Fresh listening on ${port}`); });
