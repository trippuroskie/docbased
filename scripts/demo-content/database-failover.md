---
title: Database Failover
tags: [runbook, postgres, database]
---

# Database Failover

Promoting the standby is a one-way door. Once promoted, the old primary must be
rebuilt from a base backup — it cannot rejoin as a standby.

## When to fail over

Fail over when the primary is unreachable for more than 90 seconds **and** the
standby replay lag is under 5 seconds. If lag exceeds 30 seconds, wait: you will
lose more data by promoting than by waiting for the primary to recover.

```sql
-- Check replay lag on the standby, in seconds
select extract(epoch from (now() - pg_last_xact_replay_timestamp())) as lag_seconds;
```

## Procedure

1. Confirm the primary is genuinely down, not partitioned from you alone.
2. Freeze writes at the application layer to avoid a split brain.
3. Promote the standby and repoint the connection pooler.
4. Verify the new primary accepts writes before unfreezing.

## After promotion

Rebuild a fresh standby the same day. Running without one converts the next
single failure into an outage. Escalation path is in [[Incident Response Runbook]].
