# Nexus AI — Backend API

API-only server. Frontend and admin are **hosted separately** and connect via `VITE_BACKEND_URL`.

## Local run

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

API: `http://localhost:7777`  
Health: `http://localhost:7777/api/health`

## Connect frontend & admin (local)

In each app's `.env`:

```env
VITE_BACKEND_URL=http://localhost:7777
```

Backend `.env` must list their origins in `CORS_ORIGINS`:

```env
CORS_ORIGINS=http://localhost:8889,http://localhost:8890
FRONTEND_URL=http://localhost:8889
ADMIN_URL=http://localhost:8890
```

## Render deploy

1. Push this repo (backend only on GitHub)
2. Render → Blueprint → `render.yaml` → set env vars
3. Set `BACKEND_URL` to your Render URL
4. Set `CORS_ORIGINS`, `FRONTEND_URL`, `ADMIN_URL` to your hosted frontend/admin URLs

## Frontend / admin hosting (separate)

Build as static sites (Vite). Set at build time:

```env
VITE_BACKEND_URL=https://your-backend.onrender.com
```

Render static site build command:

```bash
npm install && npm run build
```

Publish the `dist/` folder.
