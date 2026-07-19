/**
 * Hostinger default entry file (app.js).
 * Frontend: https://nexusaix.pro/
 * API:      https://nexusaix.pro/api.ai/*
 * Admin:    https://nexusaix-pro.vercel.app (Vercel)
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "backend", ".env") });

import "./backend/dist/index.js";
