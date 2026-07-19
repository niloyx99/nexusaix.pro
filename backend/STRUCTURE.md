# Backend folder map (serial)

## TypeScript vs JavaScript

| Folder | What it is |
|--------|------------|
| `src/` | **Source** — you edit here (TypeScript `.ts`) |
| `dist/` | **Build output** — `npm run build` creates this (JavaScript `.js`). Do not edit. Auto-deleted from git via `.gitignore`. |

`npm run start` runs `dist/`. `npm run dev` runs `src/` directly via `tsx`.

---

## `src/` — 8 folders only

```
src/
  1. index.ts          ← app start (Express server)
  2. config/           ← settings (CORS, paths, allowed pairs)
  3. db/               ← MongoDB connect + JSON migrate
  4. routes/           ← HTTP API endpoints (thin)
  5. market/           ← live candles (VPS Quotex API)
  6. analysis/         ← signal brain (chart + rules + AI)
  7. signals/          ← future signals + win/loss checker
  8. news/             ← forex news + news analysis
  9. license/          ← license keys + usage limits
 10. utils/            ← small helpers
```

### What each folder does

1. **`index.ts`** — boots server, mounts routes, starts polling.
2. **`config/`** — `allowedMarkets`, CORS origins, API path prefix.
3. **`db/`** — Mongo connection; one-time JSON → Mongo migrate.
4. **`routes/`** — one file per API area (`analyze`, `signals`, `licenses`, …).
5. **`market/`** — fetch/normalize candles from VPS; snapshot cache; chart analytics storage.
6. **`analysis/`** — fusion analysis, SMC/intelligence, LMP, trade setup gates, OpenRouter/Gemini.
7. **`signals/`** — scheduled future signals + binary outcome checker.
8. **`news/`** — calendar fetch + batch news analysis.
9. **`license/`** — license types + store (validate, usage, devices).
10. **`utils/`** — client IP / user-agent helpers.

### Flow (request → answer)

```
routes/analyze  →  analysis/fusionAnalysis  →  market/marketDataClient
                                           →  analysis/marketIntelligence
                                           →  analysis/tradeSetupRules
```

---

## Root (keep)

- `package.json` — scripts & deps
- `tsconfig.json` — TypeScript config
- `.env` — secrets (never commit)
- `data/` — local JSON fallbacks (if used)
- `STRUCTURE.md` — this file
