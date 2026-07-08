# Nexus AI Frontend

React + Vite app. API backend is hosted separately on Render.

## Environment

`.env`:
```env
VITE_BACKEND_URL=https://nexus-ai-ll9o.onrender.com
```

## Local dev

```bash
npm install
npm run dev
```

## Vercel deploy

1. Import this GitHub repo on [vercel.com](https://vercel.com)
2. Framework: **Vite**
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add env var `VITE_BACKEND_URL` (or use committed `.env`)

After deploy, add your Vercel URL to backend `CORS_ORIGINS` on Render.
