import { Router } from "express";
import type { LicenseTier } from "../types/license.js";
import {
  createLicense,
  deleteLicense,
  generateLicenseKey,
  getAllLicenses,
  getDailyLimitForTier,
  getDeviceBindings,
  resetLicenseDevice,
  updateLicense,
} from "../services/licenseStore.js";

const router = Router();
const VALID_TIERS: LicenseTier[] = ["basic", "pro", "premium", "regular"];
function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "siamxx";
}

function requireAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const provided = String(req.headers["x-admin-password"] ?? "");
  if (!provided || provided !== getAdminPassword()) {
    return res.status(401).json({ error: "Invalid admin password." });
  }
  return next();
}

router.use(requireAdmin);

router.get("/", async (_req, res) => {
  try {
    const licenses = await getAllLicenses();
    return res.json({ licenses });
  } catch (error: unknown) {
    console.error("Admin list licenses error:", error);
    return res.status(500).json({ error: "Failed to load licenses." });
  }
});

router.post("/generate-key", (_req, res) => {
  return res.json({ key: generateLicenseKey() });
});

router.post("/", async (req, res) => {
  try {
    const {
      key,
      tier,
      holderTelegram,
      holderName,
      note,
      dailyLimit,
      deviceLimit,
    } = req.body ?? {};

    const tierValue = tier as LicenseTier;
    if (!VALID_TIERS.includes(tierValue)) {
      return res.status(400).json({ error: "Invalid tier." });
    }

    const telegramRaw = String(holderTelegram ?? holderName ?? "").trim();
    if (!telegramRaw) {
      return res.status(400).json({ error: "Username is required." });
    }

    const parsedDailyLimit = Number(dailyLimit);
    const parsedDeviceLimit = Number(deviceLimit);

    const license = await createLicense({
      key: key ? String(key) : generateLicenseKey(),
      tier: tierValue,
      dailyLimit: Number.isFinite(parsedDailyLimit) ? parsedDailyLimit : getDailyLimitForTier(tierValue),
      deviceLimit: Number.isFinite(parsedDeviceLimit) ? parsedDeviceLimit : 1,
      holderName: telegramRaw.replace(/^@/, ""),
      holderEmail: "",
      holderTelegram: telegramRaw,
      note: String(note ?? ""),
      status: "active",
    });

    return res.status(201).json({ license });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create license.";
    console.error("Admin create license error:", error);
    return res.status(400).json({ error: message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const {
      status,
      note,
      tier,
      holderTelegram,
      holderName,
      dailyLimit,
      deviceLimit,
    } = req.body ?? {};

    const patch: Record<string, unknown> = {};

    if (status === "active" || status === "blocked") patch.status = status;
    if (typeof note === "string") patch.note = note;

    if (tier && VALID_TIERS.includes(tier as LicenseTier)) {
      patch.tier = tier as LicenseTier;
    }

    const telegramRaw = String(holderTelegram ?? holderName ?? "").trim();
    if (telegramRaw) {
      patch.holderTelegram = telegramRaw;
      patch.holderName = telegramRaw.replace(/^@/, "");
    }

    if (dailyLimit !== undefined && dailyLimit !== null && dailyLimit !== "") {
      const parsedDailyLimit = Number(dailyLimit);
      if (Number.isFinite(parsedDailyLimit)) {
        patch.dailyLimit = parsedDailyLimit;
      }
    }

    if (deviceLimit !== undefined && deviceLimit !== null && deviceLimit !== "") {
      const parsedDeviceLimit = Number(deviceLimit);
      if (Number.isFinite(parsedDeviceLimit)) {
        patch.deviceLimit = parsedDeviceLimit;
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No valid fields to update." });
    }

    const license = await updateLicense(req.params.id, patch);
    if (!license) {
      return res.status(404).json({ error: "License not found." });
    }
    return res.json({ license });
  } catch (error: unknown) {
    console.error("Admin update license error:", error);
    return res.status(500).json({ error: "Failed to update license." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const ok = await deleteLicense(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: "License not found." });
    }
    return res.json({ success: true });
  } catch (error: unknown) {
    console.error("Admin delete license error:", error);
    return res.status(500).json({ error: "Failed to delete license." });
  }
});

router.post("/:id/reset-device", async (req, res) => {
  try {
    const license = await resetLicenseDevice(req.params.id);
    if (!license) {
      return res.status(404).json({ error: "License not found." });
    }
    return res.json({ license });
  } catch (error: unknown) {
    console.error("Admin reset device error:", error);
    return res.status(500).json({ error: "Failed to reset device binding." });
  }
});

export default router;
