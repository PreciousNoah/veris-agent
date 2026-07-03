# VERIS — Trust Infrastructure for the Agent Economy

> "Before you commit, VERIS verifies."

VERIS is an autonomous three-agent due diligence system built on CROO protocol (Base Mainnet). It audits Web3 projects and AI agents, delivering verified trust scores, research intelligence, and compliance decisions — entirely through agent-to-agent workflows.

**Live on CROO Agent Store → [agent.croo.network](https://agent.croo.network)**

---

## Current Status

| | |
|---|---|
| ✅ | 3 autonomous agents deployed (VERIS, ZERU, SENTINEL) |
| ✅ | Live on CROO Agent Store |
| ✅ | Real Base Mainnet transactions confirmed |
| ✅ | Agent-to-agent (A2A) workflow operational |
| ✅ | Project due diligence operational |
| ✅ | Agent due diligence operational |
| ✅ | Trust receipt system operational |
| ✅ | Public HTTP Trust API operational |
| ✅ | SENTINEL compliance decisions operational |

|  |  |
|---|---|
| **Total Agents** | 3 (VERIS · ZERU · SENTINEL) |
| **Network** | Base Mainnet |
| **Protocol** | CROO v1 |
| **Status** | Production Demo |

---

## The Three-Agent System

VERIS is not a single agent. It is a due diligence network composed of three cooperating autonomous agents:

```
Buyer Order (CROO)
       ↓
   VERIS — Trust Verification & Scoring
       ↓
    ZERU — Research Intelligence
       ↓
  SENTINEL — Compliance Decision
       ↓
  Combined Report Delivered On-Chain
```

| Agent | Role | Deployed |
|---|---|---|
| **VERIS** | Trust verification, legitimacy scoring, evidence collection | Railway |
| **ZERU** | Market research, risk intelligence, sentiment analysis | Render |
| **SENTINEL** | Compliance decision engine, recommended actions, review periods | Render |

Every audit placed through CROO automatically triggers all three agents. The buyer receives one unified report containing trust analysis, research enrichment, and a final compliance verdict.

---

## Why VERIS Matters

As the agent economy grows, trust becomes infrastructure.

Today, every CROO buyer is flying blind. There are no ratings, no order history, no reputation signals, no audit trails. A buyer hiring an agent for the first time has no way to know whether it will deliver, whether the creator is identifiable, or whether the agent has a track record of quality.

VERIS addresses this gap by combining research, verification, and compliance decisions into a single autonomous workflow — and storing every audit as a permanent trust receipt that compounds in value over time.

VERIS is designed to become trust infrastructure for the agent economy — the layer every agent and buyer can depend on.

---

## What VERIS Does

### Project Due Diligence
Submit any Web3 project. VERIS runs multi-query web research across 4 trust dimensions:

- **Identity** — Founders, team, LinkedIn, verifiable track record
- **Transparency** — Whitepaper, technical docs, roadmap, tokenomics, governance
- **Verification** — GitHub activity, open source status, security audits, live product
- **Reputation** — Media coverage, fraud history, community signals

Returns a scored report with legitimacy score (0–100), maturity score (0–100), confidence rating, signal-by-signal evidence breakdown with source URLs, and a clear RECOMMENDATION verdict.

### Agent Due Diligence
Submit any CROO agent ID. VERIS investigates across three verification layers:

- **Layer 1 — Metadata**: Agent listing, description, pricing, SLA, online status
- **Layer 2 — Web Intelligence**: Creator identity, GitHub, media mentions, web presence
- **Layer 3 — Live Verification**: Direct endpoint probe and response quality testing

Outputs a trust band classification: `Critical | Unverified | Emerging | Established | Trusted`

### Trust Compare
Compare multiple previously audited projects or agents side-by-side. Submit 2–5 entities and VERIS compares existing trust reports, ranks entities by trust score, highlights changes, and recommends the strongest option. 

### ZERU Research Enrichment (A2A)
Every project audit is automatically enriched by ZERU, a second autonomous agent. ZERU provides:
- Market context and TVL analysis
- Risk factor identification and weighting
- Competitive positioning
- Sentiment scoring (positive / neutral / negative)

### SENTINEL Compliance Decision (A2A)
After VERIS scores and ZERU researches, SENTINEL produces a final compliance decision:

- **Verdict**: `PROCEED | PROCEED WITH CAUTION | HIGH RISK | AVOID | INSUFFICIENT DATA`
- **Compliance Score**: Calculated from trust score, adjusted for sentiment, confidence, and weighted risk penalties
- **Compliance Score Breakdown**: Line-by-line audit trail showing exactly how the score was derived
- **Recommended Actions**: Operational steps (limit exposure, schedule re-audit, do not integrate, etc.)
- **Review Period**: How long until re-assessment is recommended, with reasoning
- **Override System**: Hard trust events (confirmed fraud, criminal conviction, sanctions) automatically override all scores to AVOID regardless of other signals

### Trust Receipts
Every audit is stored as a permanent trust receipt. Receipts include entity type, trust score, risk level, signals verified, full report snapshot, and timestamp — building a reputation layer CROO doesn't natively provide.

---

## A2A Composability

VERIS demonstrates real agent-to-agent commerce on CROO — not simulated, not mocked. Every project audit triggers a live multi-agent workflow:

```
1. Buyer places order on CROO Agent Store
         ↓
2. VERIS accepts negotiation, receives payment
         ↓
3. VERIS runs trust verification (legitimacy, maturity, evidence)
         ↓
4. VERIS calls ZERU — requests market research and risk intelligence
         ↓
5. ZERU returns: summary, risk factors, sentiment, market context
         ↓
6. VERIS calls SENTINEL — sends trust score + ZERU signals
         ↓
7. SENTINEL returns: compliance verdict, score breakdown, recommended actions
         ↓
8. VERIS merges all three outputs into one unified report
         ↓
9. Report delivered on-chain via CROO · Trust receipt saved to Supabase
```

This creates a due diligence workflow that no single agent could provide alone. Each agent has a distinct role and cannot be replaced by either of the others.



---

## Screenshots

> Live demo at [veris-site.vercel.app](https://veris-site-rosy.vercel.app/)

### CROO Listing
![CROO Listing](screenshots/croo-listing.png)

### Audit Page
![Audit Page](screenshots/audit-page.png)

### Trust Report
![Trust Report](screenshots/trust-report.png)

### Trust Receipt
![Trust Receipt](screenshots/trust-receipt.png)

### SENTINEL Verdict
![SENTINEL Verdict](screenshots/sentinel-verdict.png)


---

## Architecture

```
Frontend:        Vercel (React + Vite + TypeScript)
Backend:         Node.js on Railway
Search:          Tavily API (advanced web search, 9 queries per audit)
AI Extraction:   Groq llama-3.3-70b-versatile (temperature 0.0)
Protocol:        CROO v1 SDK (@croo-network/sdk)
Network:         Base Mainnet
Storage:         Supabase (trust receipts + API keys)
Research Agent:  ZERU (Render)
Decision Agent:  SENTINEL (Render)
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

```bash
CROO_API_URL=https://api.croo.network
CROO_WS_URL=wss://api.croo.network/ws
CROO_API_KEY=your_croo_sdk_key
TAVILY_API_KEY=your_tavily_key
GROQ_API_KEY=your_groq_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
ZERU_API_URL=https://zeru-agent-iz16.onrender.com
SENTINEL_API_URL=https://sentinel-agent-e787.onrender.com
```

---

## API Endpoints

### Public Trust API (requires `X-Api-Key` header)

```
GET  /trust/:entityName                    — Structured JSON trust score
GET  /trust/:entityName?type=agent         — Agent trust score with layer breakdown
GET  /compare/projects?a=Aave&b=Compound    — Compare existing VERIS audit results for two previously audited projects 
GET  /evidence/:entityName                 — Raw evidence for custom scoring
GET  /a2a/demo/:entityName                 — Combined VERIS + ZERU output
GET  /receipts/summary                     — All audited entities, deduped
GET  /receipts/:entityId                   — Full receipt history for one entity
```

### CROO Order Endpoints (no auth — CROO handles that)

```
POST /audit   — Project or Agent Due Diligence
POST /compare — Compare previously audited projects or agents 
```

### CROO Order Format

```json
{
  "type": "project",
  "name": "Aave",
  "website": "https://aave.com",
  "github": "https://github.com/aave",
  "twitter": "https://x.com/aaveaave"
}
```

---

## Scoring Model

### Project Trust Score (0–100)

| Dimension | Weight | What it measures |
|---|---|---|
| Identity | 25% | Founders, team, LinkedIn, track record |
| Transparency | 25% | Docs, whitepaper, roadmap, governance |
| Verification | 35% | GitHub, audits, open source, live product |
| Reputation | 15% | Media, fraud history, community |

Hard events (confirmed fraud, criminal conviction, SEC enforcement) override all scores to 0 regardless of other signals.

### Agent Trust Bands

| Score | Band | Meaning |
|---|---|---|
| 76–100 | Trusted | All three layers confirmed |
| 56–75 | Established | Metadata + live verification |
| 36–55 | Emerging | Working endpoint, limited history |
| 16–35 | Unverified | No metadata, no live test |
| 0–15 | Critical | Failed tests or confirmed fraud |

### Ground Truth System
Known established protocols (Aave, Uniswap, MakerDAO, etc.) have calibration floors that prevent search API variance from producing anomalous scores. Known failures (FTX, Terra, SafeMoon, OneCoin, BitConnect) are pre-confirmed as Critical regardless of search results.

---

## Trust Receipt Schema (Supabase)

```sql
trust_receipts (
  id               uuid primary key,
  entity_type      text,         -- 'project' or 'agent'
  entity_id        text,         -- lowercase entity identifier
  entity_name      text,
  score            integer,
  risk_level       text,
  signals_verified integer,
  signals_total    integer,
  report           text,         -- full report snapshot
  created_at       timestamptz
)
```

---

## SDK Methods Used

| Method | Purpose |
|---|---|
| `AgentClient` | Runtime agent authentication |
| `EventType.NegotiationCreated` | Accept incoming CROO orders |
| `EventType.OrderPaid` | Trigger due diligence on payment |
| `EventType.OrderCompleted` | Confirm on-chain settlement |
| `DeliverableType.Text` | Deliver report as text on-chain |
| `acceptNegotiation()` | Lock order on-chain |
| `deliverOrder()` | Submit report on-chain |
| `getOrder()` | Read order requirements |

---

## On-Chain Proof (Base Mainnet)

All VERIS reports are delivered on-chain via CROO protocol.

| Type | TX Hash | Date |
|---|---|---|
| Payment | `0x95f32bdf3c84abcca45cf5ad63d830eae1fdbce4a0b5ed54d3ce56d2b44f1852` | 2026-06-24 |
| Payment | `0x51a5cabfaf83831a4399dc137154521a26f04deadd16be2de33dbfd6e5b31ba8` | 2026-06-24 |
| Payment | `0x3d8609fc279fcaa8f686e54751447054922c85d87c577d306eee8b2f276b2fe8` | 2026-06-23 |

Verifiable at [basescan.org](https://basescan.org)

---

## Why Trust Receipts Matter

CROO currently exposes no order history, ratings, delivery stats, or reputation data for agents. Every buyer is effectively flying blind.

VERIS addresses this gap by storing every audit as a permanent receipt. Over time this creates reputation infrastructure CROO doesn't yet have:

- Was this project or agent audited before?
- Did its score improve or decline between audits?
- Has it been flagged by multiple independent auditors?

As CROO matures, VERIS becomes a source of trust signals rather than just a consumer of them.

---

## License

MIT
