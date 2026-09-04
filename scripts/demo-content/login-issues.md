---
title: Troubleshooting Login Issues
tags: [support, auth, troubleshooting]
---

# Troubleshooting Login Issues

Roughly 80% of login tickets are one of the first three causes below. Work them
in order before escalating.

## 1. Magic link expired

Links are valid for 60 minutes and single-use. A link that was previewed by a
corporate email scanner is already consumed. Fix: send a fresh link and ask the
customer to open it in the same browser they will use the app in.

## 2. Wrong workspace

A customer with access to multiple workspaces who signs in from a bookmark can
land on the wrong one and see an empty state, which reads as "my data is gone".
Confirm the workspace slug in the URL before investigating data loss.

## 3. Clock skew

Tokens fail validation when the device clock is off by more than 5 minutes.
Common on freshly imaged laptops. Fix: enable automatic time sync.

## Escalate when

The customer's account exists, the link is fresh, the workspace is right, and
sign-in still fails. Attach the request ID from the error page.
