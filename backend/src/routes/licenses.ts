import { Router, type Request, type Response, type NextFunction } from "express";
import {
  validateLicense,
  findLicenseByKey,
  getRemainingUsage,
  getDeviceBindings,
  registerDeviceForLicense,
  normalizeKey,
  isUnlimitedDaily,
  formatDailyLimit,
} from "../services/licenseStore.js";
import {
  getClientIp,
  getDeviceFingerprintFromRequest,
  getUserAgentFromRequest,
} from "../utils/clientInfo.js";

const router = Router();

router.post("/validate", async (req, res) => {
  try {
    const { key, telegram } = req.body ?? {};
    const deviceFingerprint = getDeviceFingerprintFromRequest(req);
    const result = await validateLicense({
      key: String(key ?? ""),
      telegram: String(telegram ?? ""),
      deviceFingerprint,
      ip: getClientIp(req),
      userAgent: getUserAgentFromRequest(req),
    });

    if (!result.valid) {
      return res.status(401).json(result);
    }

    return res.json(result);
  } catch (error: unknown) {
    console.error("License validate error:", error);
    return res.status(500).json({
      valid: false,
      message: "License validation failed.",
    });
  }
});

router.get("/status", async (req, res) => {
  try {
    const key = String(req.headers["x-license-key"] ?? req.query.key ?? "");
    if (!key) {
      return res.status(400).json({ error: "License key required." });
    }

    const license = await findLicenseByKey(key);
    if (!license) {
      return res.status(404).json({ error: "License not found." });
    }

    if (license.status === "blocked") {
      return res.status(403).json({ error: "License is blocked." });
    }

    const fingerprint = getDeviceFingerprintFromRequest(req);
    let currentLicense = license;
    const bindings = getDeviceBindings(currentLicense);

    if (fingerprint && fingerprint.length >= 12) {
      const known = bindings.some((b) => b.fingerprint === fingerprint);
      if (!known && bindings.length > 0) {
        const deviceLimit = currentLicense.deviceLimit ?? 1;
        if (deviceLimit >= 0 && bindings.length >= deviceLimit) {
          return res.status(403).json({
            error: `Device limit reached (${deviceLimit} devices). Contact admin to reset.`,
            code: "DEVICE_MISMATCH",
          });
        }
        currentLicense = await registerDeviceForLicense(currentLicense, {
          fingerprint,
          ip: getClientIp(req),
          userAgent: getUserAgentFromRequest(req),
          boundAt: new Date().toISOString(),
        });
      } else if (!known && bindings.length === 0) {
        currentLicense = await registerDeviceForLicense(currentLicense, {
          fingerprint,
          ip: getClientIp(req),
          userAgent: getUserAgentFromRequest(req),
          boundAt: new Date().toISOString(),
        });
      }
    } else if (getDeviceBindings(currentLicense).length > 0) {
      return res.status(403).json({
        error: "Device fingerprint missing. Please refresh and try again.",
        code: "DEVICE_MISMATCH",
      });
    }

    const usage = await getRemainingUsage(currentLicense.key, currentLicense.dailyLimit);
    const devicesUsed = getDeviceBindings(currentLicense).length;

    return res.json({
      key: currentLicense.key,
      tier: currentLicense.tier,
      dailyLimit: currentLicense.dailyLimit,
      deviceLimit: currentLicense.deviceLimit ?? 1,
      devicesUsed,
      holderName: currentLicense.holderName,
      status: currentLicense.status,
      createdAt: currentLicense.createdAt,
      usage,
      unlimitedDaily: isUnlimitedDaily(currentLicense.dailyLimit),
      dailyLimitLabel: formatDailyLimit(currentLicense.dailyLimit),
      deviceBound: devicesUsed > 0,
    });
  } catch (error: unknown) {
    console.error("License status error:", error);
    return res.status(500).json({ error: "Failed to read license status." });
  }
});

export function getLicenseKeyFromRequest(req: Request): string {
  const header = req.headers["x-license-key"];
  if (typeof header === "string" && header.trim()) {
    return normalizeKey(header);
  }
  const bodyKey = req.body?.licenseKey;
  if (typeof bodyKey === "string" && bodyKey.trim()) {
    return normalizeKey(bodyKey);
  }
  return "";
}

/** Validates license + daily limit without consuming scans (chart analyze charges only on success). */
export async function requireValidatedLicense(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const key = getLicenseKeyFromRequest(req);
    if (!key) {
      res.status(401).json({ error: "License key required.", code: "LICENSE_REQUIRED" });
      return;
    }

    const { validateLicenseForRequest } = await import("../services/licenseStore.js");
    const { getDeviceFingerprintFromRequest } = await import("../utils/clientInfo.js");
    const fingerprint = getDeviceFingerprintFromRequest(req);
    const { license, usage } = await validateLicenseForRequest(key, fingerprint);
    res.locals.license = license;
    res.locals.licenseUsage = usage;
    next();
  } catch (error: unknown) {
    const err = error as Error & { status?: number; usage?: unknown; code?: string };
    const status = err.status ?? 500;
    res.status(status).json({
      error: err.message || "License check failed.",
      code:
        err.code ??
        (status === 429 ? "DAILY_LIMIT" : status === 403 ? "LICENSE_BLOCKED" : "LICENSE_ERROR"),
      usage: err.usage,
    });
  }
}

export async function requireActiveLicense(
  req: Request,
  res: Response,
  next: NextFunction,
  incrementBy = 1
): Promise<void> {
  try {
    const key = getLicenseKeyFromRequest(req);
    if (!key) {
      res.status(401).json({ error: "License key required.", code: "LICENSE_REQUIRED" });
      return;
    }

    const { assertLicenseForRequest } = await import("../services/licenseStore.js");
    const { getDeviceFingerprintFromRequest } = await import("../utils/clientInfo.js");
    const fingerprint = getDeviceFingerprintFromRequest(req);
    const { license, usage } = await assertLicenseForRequest(key, incrementBy, fingerprint);
    res.locals.license = license;
    res.locals.licenseUsage = usage;
    next();
  } catch (error: unknown) {
    const err = error as Error & { status?: number; usage?: unknown; code?: string };
    const status = err.status ?? 500;
    res.status(status).json({
      error: err.message || "License check failed.",
      code:
        err.code ??
        (status === 429 ? "DAILY_LIMIT" : status === 403 ? "LICENSE_BLOCKED" : "LICENSE_ERROR"),
      usage: err.usage,
    });
  }
}

export default router;
