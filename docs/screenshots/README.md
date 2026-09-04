# README screenshots

The root README embeds five images from this directory. They are **not committed yet** — until they are, those five embeds render as broken images.

| File | Route | Should show |
| --- | --- | --- |
| `workspace.png` | `/` with a document open | Space tree on the left, rendered document in the centre, chat panel on the right — the three-pane layout in one frame |
| `chat-citations.png` | `/chat/<id>` | A completed answer with inline numbered citations and the source list beneath, so the citation-to-source link is visible |
| `search.png` | `/search?q=…` | Results spanning more than one space, with matched snippets, so hybrid retrieval is legible |
| `admin-access.png` | `/admin/access` | The user × space role matrix with a few different roles set |
| `settings-tokens.png` | `/settings` | The MCP endpoint URL and the access-token list (mint a throwaway token, or crop the reveal) |

## Generating them without exposing real documents

`npm run seed:demo` creates three synthetic spaces (Engineering, Support, Handbook), eight documents from `scripts/demo-content/`, and a demo user, `demo@northwind.example`. You must supply `DEMO_PASSWORD` — the script has no default, so it can't quietly create a known-credential user in a project you didn't mean to point it at.

The demo user is deliberately **not** an admin. `getAccessibleSpaces()` grants admins every space ([`src/lib/auth.ts`](../../src/lib/auth.ts)), so capturing while signed in as an admin puts your real space names in the sidebar. Signed in as the non-admin demo user, the sidebar contains only the three demo spaces.

```bash
DEMO_PASSWORD=$(openssl rand -base64 18) npm run seed:demo   # note the password it prints
npm run dev
# sign in at /login as demo@northwind.example, capture the five shots above
npm run seed:demo -- --purge
```

`--purge` deletes the demo spaces and their documents, chunks, and storage objects, then the demo user.

Two caveats on `admin-access.png`: it requires an admin, and the access matrix lists **every** user and space. Either capture it against a database with nothing but demo data in it, or crop to the demo rows.

## Capture settings

Use a viewport around 1600×1000 so the three-pane layout doesn't collapse to its mobile arrangement, and keep one colour scheme across all five so the README reads as one product. Check that no real email address is visible in the top bar before committing.

> This seed script has been typechecked but never executed end-to-end — the database it was written against was deleted before it could run. Expect to debug it on first use.
