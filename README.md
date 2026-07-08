# Nexus AI — Monorepo

| Folder | Host | Root Directory |
|---|---|---|
| `backend/` | Render | `backend` |
| `frontend/` | Vercel | `frontend` |
| `admin/` | Vercel | `admin` |

## Backend API (Render)

- URL: `https://nexus-ai-ll9o.onrender.com`
- Health: `/api/health`
- Env: see `backend/.env.example`

## Frontend (Vercel)

- Root Directory: **`frontend`**
- Build: `npm run build`
- Output: `dist`
- `.env`: `VITE_BACKEND_URL=https://nexus-ai-ll9o.onrender.com`

## Admin (Vercel)

- Root Directory: **`admin`**
- Build: `npm run build`
- Output: `dist`
- `.env`: `VITE_BACKEND_URL=https://nexus-ai-ll9o.onrender.com`

After Vercel deploy, add frontend/admin URLs to backend `CORS_ORIGINS` on Render.
