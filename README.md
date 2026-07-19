# Nexus AI

| App | Host | Folder | Env |
|---|---|---|---|
| Frontend | Hostinger | `frontend/` | `VITE_BACKEND_URL` |
| Backend | Render | `backend/` | `FRONTEND_URL`, `ADMIN_URL`, secrets |
| Admin | Vercel | `admin/` | `VITE_BACKEND_URL` |
| Market data | Render | separate service | `QUOTEX_MARKET_API_URL` |

## Local check

```bash
npm install
npm run install:all
npm run dev
```

| App | URL |
|---|---|
| Backend API | http://localhost:7777/health |
| Frontend | http://localhost:8889/app/ |
| Admin | http://localhost:8890/ |

Market feed (original):
```
QUOTEX_MARKET_API_URL=https://quotex-data-1n2b.onrender.com
```

Endpoints used: `/api/health`, `/api/markets/latest`, `/api/markets/otc`, `/api/markets/real`, `/last?pair=...`

## Hosting

**Render (backend)** — set:
- `FRONTEND_URL=https://nexusaix.pro,https://www.nexusaix.pro`
- `ADMIN_URL=https://nexusaix-pro.vercel.app`
- `BACKEND_URL=https://nexusaix-pro-backend.onrender.com`
- `QUOTEX_MARKET_API_URL=https://quotex-data-1n2b.onrender.com`
- secrets: `MONGODB_URI`, `OPENROUTER_API_KEY`, `ADMIN_PASSWORD`

**Vercel (admin)** / **Hostinger (frontend)**:
- `VITE_BACKEND_URL=https://nexusaix-pro-backend.onrender.com`
