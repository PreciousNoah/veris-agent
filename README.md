# VERIS — Trust Infrastructure for the Agent Economy

Autonomous trust verification agent built on CROO protocol.
Audits Web3 projects and AI agents via live A2A CROO orders.

## What it does
# VERIS — Trust Infrastructure for the Agent Economy

VERIS is an autonomous trust and due diligence agent built on CROO protocol (Base Mainnet). It helps buyers make informed trust decisions before spending money on a Web3 project or AI agent.

> **"Before you commit, VERIS verifies."**

Live on CROO Agent Store → [agent.croo.network](https://agent.croo.network)

---

## What VERIS Does

### Project Due Diligence
Submit any Web3 project. VERIS runs multi-query web research across 5 trust dimensions — Team Transparency, Documentation Quality, Social Credibility, Development Activity, and Risk Flags — then returns a scored report with legitimacy score, maturity score, confidence rating, and a clear RECOMMENDATION verdict.

### Agent Due Diligence
Submit any CROO agent ID. VERIS investigates across three verification layers:
- **Layer 1 — Metadata:** What CROO exposes (listing, description, pricing, SLA, online status)
- **Layer 2 — Web Intelligence:** Public web search for creator identity, GitHub, media mentions
- **Layer 3 — Live Verification:** Direct endpoint probe and optional CROO order test

Outputs a signal coverage report showing exactly which signals were confirmed, which were not tested, and which are unavailable due to current CROO ecosystem limitations.

### Trust Compare *(new)*
Compare multiple agents side-by-side. Submit 2–5 agent IDs and VERIS runs parallel due diligence, outputs a comparison table, and recommends the best trust-adjusted option.

### Trust Receipts *(new)*
Every audit is stored as a permanent trust receipt in Supabase. Receipts include entity type, score, risk level, signals verified, full report snapshot, and timestamp. Enables audit history, score change tracking, and re-audit comparisons — the beginning of a reputation layer CROO doesn't currently provide.

---

## Architecture

```
Frontend:       Vercel (React + Vite + TypeScript)
Backend:        Node.js on Render (https://veris-agent.onrender.com)
Search:         Tavily API (advanced web search, 5 queries per audit)
AI Extraction:  Groq llama-3.3-70b-versatile (temperature 0.0)
AI Synthesis:   Groq llama-3.3-70b-versatile (temperature 0.2)
Protocol:       CROO v1 SDK (@croo-network/sdk)
Network:        Base Mainnet
Storage:        Supabase (trust receipts)
```

---

## Quick Start

```bash
git clone https://github.com/PreciousNoah/veris-agent
cd veris-agent
npm install
cp .env.example .env
# Fill in your keys
node server.js
```

---

## Environment Variables

```
CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws
CROO_API_KEY=your_croo_sdk_key
TAVILY_API_KEY=your_tavily_key
GROQ_API_KEY=your_groq_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
RAILWAY_EXTERNAL_URL=https://veris-agent-production.up.railway.app
```

---

## API Endpoints

### POST /audit — Project or Agent Due Diligence

**Project audit:**
```json
{
  "requirements": {
    "type": "project",
    "name": "Aave",
    "website": "https://aave.com",
    "github": "https://github.com/aave",
    "twitter": "https://x.com/aaveaave",
    "docs": "https://docs.aave.com"
  }
}
```

**Agent due diligence:**
```json
{
  "requirements": {
    "type": "agent",
    "agentId": "your-agent-id",
    "serviceId": "your-service-id",
    "agentName": "ZERU",
    "endpointUrl": "https://your-agent.onrender.com",
    "serviceDescription": "DeFi research agent",
    "category": "research"
  }
}
```

### POST /compare — Trust Compare (2–5 agents)

```json
{
  "agents": [
    {
      "agentId": "agent-id-1",
      "agentName": "ZERU",
      "endpointUrl": "https://zeru-agent.onrender.com",
      "category": "research"
    },
    {
      "agentId": "agent-id-2",
      "agentName": "Another Agent",
      "category": "research"
    }
  ]
}
```

### GET /receipts/:entityId — Trust Receipt History

Returns all previous audit receipts for an entity.

---

## CROO Order Requirements Format

When ordering through the Agent Store, submit requirements as JSON:

```json
{
  "type": "project",
  "name": "Project Name",
  "website": "https://...",
  "github": "https://...",
  "twitter": "https://..."
}
```

---

## SDK Methods Used

| Method | Purpose |
|--------|---------|
| `AgentClient` | Runtime agent authentication |
| `EventType.NegotiationCreated` | Accept incoming CROO orders |
| `EventType.OrderPaid` | Trigger due diligence on payment |
| `EventType.OrderCompleted` | Confirm on-chain settlement |
| `DeliverableType.Text` | Deliver report as text on-chain |
| `acceptNegotiation()` | Lock order on-chain |
| `deliverOrder()` | Submit report on-chain |
| `getOrder()` | Read order requirements |
| `payOrder()` | Fund escrow (agent audit mode) |
| `getDelivery()` | Retrieve delivered report |

---

## Trust Receipt Schema (Supabase)

```sql
trust_receipts (
  id              uuid primary key,
  entity_type     text,         -- 'project' or 'agent'
  entity_id       text,         -- agentId or project name
  entity_name     text,
  score           integer,
  risk_level      text,
  signals_verified integer,
  signals_total    integer,
  report          text,         -- full report snapshot
  created_at      timestamptz
)
```

---

## Agent Due Diligence Categories

| Category | Use for |
|----------|---------|
| `research` | DeFi research and intelligence agents |
| `trading` | Market analysis and signal agents |
| `data` | Analytics and metrics agents |
| `writing` | Content and copywriting agents |
| `coding` | Developer and smart contract agents |
| `defi` | DeFi specialist agents |
| `security` | Audit and security agents |
| `general` | Any agent (auto-detected fallback) |

Category is auto-detected from agent name and description if not specified.

---

## Why Trust Receipts Matter

CROO currently exposes no order history, ratings, delivery stats, or reputation data for agents. This means every buyer is flying blind.

VERIS addresses this gap by storing every audit as a permanent receipt. Over time, this creates the reputation infrastructure CROO doesn't yet have:

- Was this agent audited before?
- Did its score improve or decline?
- Has it been flagged by multiple auditors?

As CROO matures, VERIS becomes the source of trust signals rather than just a consumer of them.

---

## On-Chain Proof (Base Mainnet)

All VERIS reports are delivered on-chain via CROO protocol. Verified transactions:

| Type | TX Hash |
|------|---------|
| Payment | `0x77125bff271e0306b5e4cbd4358eaeda44a1d93b9677d01b6cb4bcf0edf0647d` |
| Delivery | `0xe262f4a0c6e6e4d3baa0b1798118ed21a63a535b07b5ec96db9cd53335c0e59d` |
| Payment | `0x979d4160413b8c74e558a56eca2ca12e425885ef81854428fafddbf10ae4bfea` |
| Delivery | `0xdeefdc8c844b0f7a8c7dbdeb725b1587f603c01db0a89d67316478da0917ddd8` |

Verifiable at [basescan.org](https://basescan.org)

---

## License

MIT
