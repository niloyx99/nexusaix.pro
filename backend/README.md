# Nexus AI — Backend (Render)

API-only. Frontend = Hostinger (`FRONTEND_URL`). Admin = Vercel (`ADMIN_URL`).

## Local

```bash
npm install
npm run dev
```

Uses `.env` + `.env.local` (local overrides).

API: http://localhost:7777 · Health: `/health`

## Render

- Root: `backend`
- Build: `npm install && npm run build`
- Start: `npm start`
- Health: `/health`

Set on Render dashboard (or Blueprint):

| Key | Notes |
|---|---|
| `FRONTEND_URL` | `https://nexusaix.pro,https://www.nexusaix.pro` |
| `ADMIN_URL` | Vercel URL (add after admin deploy) |
| `BACKEND_URL` | This service’s public URL |
| `MONGODB_URI` | Atlas connection string |
| `OPENROUTER_API_KEY` | Required |
| `ADMIN_PASSWORD` | Admin panel login |
