---
title: Dev Environment Setup
tags: [onboarding, tooling]
---

# Dev Environment Setup

Target: a new engineer runs the test suite locally on day one.

## Prerequisites

- Node 20 or newer
- A Postgres 15 instance with the `vector` extension available
- Access to the shared staging credentials (ask your onboarding buddy)

## Steps

```bash
git clone git@github.com:northwind/platform.git
cd platform
npm install
cp .env.example .env.local   # fill in the staging values
npm run db:migrate
npm run dev
```

## Common snags

**`extension "vector" is not available`** — your Postgres was installed without
pgvector. On macOS, `brew install pgvector` then restart the server.

**Migrations hang** — you are pointed at the session-mode connection string.
Use the transaction-mode pooler port for migrations.

Architecture context lives in [[Retrieval Pipeline]].
