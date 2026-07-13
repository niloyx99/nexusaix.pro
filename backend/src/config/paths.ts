/** Obfuscated route prefixes — change via env if needed. */
export const API_PREFIX = (process.env.API_PREFIX || "/nx-svc-k8m4t7q2w9p3").replace(/\/$/, "");
export const ADMIN_PATH = (process.env.ADMIN_PATH || "/nx-ctrl-p3m9k7x2w8q5").replace(/\/$/, "");
export const HEALTH_PATH = `${API_PREFIX}/sys-pulse-x7k2m9t4k2`;
