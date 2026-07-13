# Nexus AI

| App | Host | Folder |
|---|---|---|
| Frontend (content) | Hostinger — https://nexusaix.pro | `frontend/` |
| Backend (API) | Render | `backend/` |
| Admin panel | Vercel | `admin/` |

## Connection

- **Backend** `.env`: `FRONTEND_URL` (+ later `ADMIN_URL`) for CORS
- **Frontend / Admin** `.env`: `VITE_BACKEND_URL` → Render API URL

## Local

```bash
npm run install:all
npm run dev
```

- API: http://localhost:7777  
- Frontend: http://localhost:8889/app/  
- Admin: http://localhost:8890/  
- Local CORS overrides: `backend/.env.local`

## Backend → Render

1. Connect repo, root directory = `backend` (or use `render.yaml`)
2. Set secrets: `MONGODB_URI`, `OPENROUTER_API_KEY`, `ADMIN_PASSWORD`
3. After deploy, set `BACKEND_URL` to the Render URL (e.g. `https://xxx.onrender.com`)
4. When admin is live on Vercel, set `ADMIN_URL` to that URL

Health: `GET /health`

## Admin → Vercel

1. Import repo, **Root Directory** = `admin`
2. Framework: Vite · Build: `npm run build` · Output: `dist`
3. Env (Production):
   - `VITE_BACKEND_URL` = your Render URL
   - `VITE_API_PREFIX` = `/nx-svc-k8m4t7q2w9p3`
4. After deploy, paste the Vercel URL into Render `ADMIN_URL`

## Frontend → Hostinger

Build `frontend/` with `VITE_BACKEND_URL` = Render URL, then upload `dist` (base `/app/`).
