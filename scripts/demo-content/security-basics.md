---
title: Security Basics
tags: [handbook, security, mfa]
---

# Security Basics

## Non-negotiables

1. **Hardware MFA** on email, source control, and cloud consoles. TOTP is
   acceptable elsewhere; SMS is acceptable nowhere.
2. **Password manager** for every credential. If you can recall it, it is too
   weak or reused.
3. **Full-disk encryption** on every device that touches customer data.

## Handling customer data

Never paste customer data into a third-party tool that has not been reviewed.
That includes AI assistants, pastebins, and spreadsheet add-ons. When you need
to share a record for debugging, share the record ID and let the other person
look it up.

## Reporting

Report suspected incidents immediately, even when you caused them. Self-reported
mistakes are handled as process failures, never as performance issues. The
window in which a leaked credential can be rotated cheaply is measured in
minutes.
