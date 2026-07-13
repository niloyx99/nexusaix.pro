# Nexus AI

| App | Host | Folder | Needs in env |
|---|---|---|---|
| Frontend | Hostinger | `frontend/` | `VITE_BACKEND_URL` |
| Backend | Render | `backend/` | `FRONTEND_URL`, `ADMIN_URL` |
| Admin | Vercel | `admin/` | `VITE_BACKEND_URL` |

## Local (current `.env`)

```bash
npm run install:all
npm run dev
```

- Backend API: http://localhost:7777 → try `/` or `/health`
- Frontend: http://localhost:8889/app/
- Admin: http://localhost:8890/

## Deploy checklist

**Render (backend)** — set:
- `FRONTEND_URL=https://nexusaix.pro`
- `ADMIN_URL=https://nexusaix-pro.vercel.app`
- `BACKEND_URL=https://nexusaix-pro-backend.onrender.com`
- secrets: `MONGODB_URI`, `OPENROUTER_API_KEY`, `ADMIN_PASSWORD`

**Vercel (admin)** — Root = `admin`, set:
- `VITE_BACKEND_URL=https://nexusaix-pro-backend.onrender.com`

**Hostinger (frontend)** — build with:
- `VITE_BACKEND_URL=https://nexusaix-pro-backend.onrender.com`

Opening the backend URL should show JSON endpoints, not a landing page.
