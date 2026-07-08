import type { Request } from "express";

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].split(",")[0].trim();
  }
  return req.socket.remoteAddress?.replace("::ffff:", "") || "unknown";
}

export function getDeviceFingerprintFromRequest(req: Request): string {
  const header = req.headers["x-device-fingerprint"];
  if (typeof header === "string") return header.trim();
  const body = req.body?.deviceFingerprint;
  if (typeof body === "string") return body.trim();
  return "";
}

export function getUserAgentFromRequest(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 512) : "";
}
