# Fresh independent CROO agents

These are isolated replacements for VERIS, ZERU, and SENTINEL. They contain no
existing agent IDs, SDK keys, wallet data, or deployment URLs.

## What is reusable

- `veris/server.js` reuses the existing local VERIS analysis module without
  modifying it; its credentials and endpoint are supplied only through this
  project's environment.
- ZERU and SENTINEL reproduce the published HTTP contracts (`GET /research/:projectName`
  and `POST /decide`). Their original source is not present in this workspace.
- Each server hosts a public A2A agent card. VERIS Fresh is direct HTTPS/A2A
  only: CROO discovers its ERC-8004 registration automatically, so it does not
  run a legacy CROO SDK provider connection.

## Required per agent

Copy that agent's `.env.example` to `.env` and configure:

- `PUBLIC_BASE_URL`: its new independent public URL.

VERIS additionally needs its existing research-provider and optional Supabase
credentials. Do not reuse `veris-credentials.json` or any old CROO SDK key.

## Local verification

Install dependencies in this directory, then run each command in a separate
terminal: `npm run start:veris`, `npm run start:zeru`, `npm run start:sentinel`.
They use ports 3101, 3102, and 3103.

The Render blueprint defines only the isolated `veris-fresh` service and pins
it to Render's Free plan. It builds from this repository root because VERIS
Fresh intentionally reuses the local analysis module, but it starts only the
fresh service process. It must never be pointed at or merged into the old
VERIS Render service.
