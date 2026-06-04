# VERIS — Trust Infrastructure for the Agent Economy

Autonomous trust verification agent built on CROO protocol.
Audits Web3 projects and AI agents via live A2A CROO orders.

## What it does

**Project Due Diligence** — Submit any Web3 project. VERIS searches 
the web across 5 trust dimensions and returns a scored report /100 
with risk level and RECOMMENDATION verdict.

**Agent Reliability Audit** — Submit any CROO agent ID. VERIS places 
live CROO orders against the target agent, scores performance across 
5 dimensions using LLM-based semantic evaluation, and delivers a 
reliability report on-chain.

## Quick Start

\`\`\`bash
git clone https://github.com/YOURUSERNAME/veris-agent
cd veris-agent
npm install
cp .env.example .env
# Fill in your keys
node server.js
\`\`\`

## Environment Variables

\`\`\`
CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws
CROO_API_KEY=your_croo_sdk_key
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
\`\`\`

## How to Order an Audit

Place a CROO order with JSON requirements:

**Project audit:**
\`\`\`json
{
  "type": "project",
  "name": "Project Name",
  "website": "https://...",
  "github": "https://...",
  "twitter": "https://..."
}
\`\`\`

**Agent audit (quick):**
\`\`\`json
{
  "type": "agent",
  "agentId": "agent-id",
  "serviceId": "service-id",
  "mode": "quick",
  "category": "research"
}
\`\`\`

**Agent audit (full):**
\`\`\`json
{
  "type": "agent",
  "agentId": "agent-id",
  "serviceId": "service-id",
  "mode": "full",
  "category": "research"
}
\`\`\`

## SDK Methods Used

- `AgentClient` — runtime agent authentication
- `EventType.NegotiationCreated` — accept incoming orders
- `EventType.OrderPaid` — trigger audit on payment
- `EventType.OrderCompleted` — confirm settlement
- `DeliverableType.Text` — deliver report as text
- `acceptNegotiation()` — lock order on-chain
- `payOrder()` — fund escrow (agent audit mode)
- `deliverOrder()` — submit report on-chain
- `getOrder()` — read order requirements
- `getDelivery()` — retrieve delivered report

## Benchmark Categories

| Category | Use for |
|----------|---------|
| research | DeFi research and intelligence agents |
| trading | Market analysis and signal agents |
| data | Analytics and metrics agents |
| writing | Content and copywriting agents |
| coding | Developer and smart contract agents |
| defi | DeFi specialist agents |
| security | Audit and security agents |
| general | Any agent (fallback) |

## Architecture

- Backend: Node.js on Render
- Primary AI: Gemini 2.0 Flash with Google Search grounding
- Fallback AI: Groq Llama 3.3 70B
- Protocol: CROO v1 on Base Mainnet
- Scoring: LLM-based semantic evaluation

## License

MIT