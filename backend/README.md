# Nexus AI — Backend (Render)

API-only. No landing / frontend / admin static files.

Folder map (serial): see [STRUCTURE.md](./STRUCTURE.md).  
Edit `src/` (TypeScript). `dist/` is build output only — do not edit.

## Local

```bash
npm install
npm run dev
```

- http://localhost:7777/ → endpoint list (JSON)
- http://localhost:7777/health

`.env` keys for CORS: `FRONTEND_URL`, `ADMIN_URL`

## Render

Root: `backend` · Build: `npm install --include=dev && npm run build` · Start: `npm start` · Health: `/health`
