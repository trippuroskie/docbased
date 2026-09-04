---
title: Incident Response Runbook
tags: [oncall, runbook, sev1]
---

# Incident Response Runbook

The on-call engineer owns the incident from page to postmortem. Severity is
declared in the first five minutes and can only be raised, never lowered,
without sign-off from the incident commander.

## Severity ladder

| Sev | Meaning | Page | Comms cadence |
| --- | --- | --- | --- |
| Sev1 | Checkout or auth fully down | Immediate, all hands | Every 15 min |
| Sev2 | Degraded for >10% of users | Immediate, primary only | Every 30 min |
| Sev3 | Single-tenant or cosmetic | Next business day | On resolution |

## First fifteen minutes

1. Acknowledge the page. An unacknowledged page escalates to secondary in 5 min.
2. Open an incident channel: `#inc-<yyyymmdd>-<slug>`.
3. Post the one-line impact statement. Guessing is fine; silence is not.
4. Check the deploy log before touching anything — most Sev2s are the last deploy.

## Rollback first, diagnose second

Rolling back is cheap and reversible. Root-causing under load is neither.
If the last deploy landed within the incident window, roll it back and *then*
investigate from the restored baseline.

```bash
# Identify the last known-good deployment and promote it
deploy list --env prod --limit 5
deploy promote <deployment-id> --env prod
```

## Postmortem

Blameless, written within three business days, and linked from the incident
channel. See [[Database Failover]] for the specific procedure when Postgres is
the failing component.
