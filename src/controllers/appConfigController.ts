import { Request, Response } from "express";
import AppConfig from "../models/app-config.model";
import logger from "../config/logger";

/**
 * Public endpoint: Get app version info & update requirements for a given platform.
 * GET /app/version?platform=android | ios | web
 */
export const getAppVersion = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawPlatform = ((req.query.platform as string) || "android").toLowerCase();
    const platform = rawPlatform.includes("ios") ? "ios" : "android";

    const [platformConfig, globalConfig] = await Promise.all([
      AppConfig.findOne({ where: { platform } }),
      AppConfig.findOne({ where: { platform: "global" } }),
    ]);

    const isGlobalMaintenance = globalConfig?.maintenanceMode ?? false;

    if (!platformConfig) {
      res.status(200).json({
        success: true,
        platform,
        latestVersion: "1.0.0",
        minRequiredVersion: "1.0.0",
        forceUpdate: false,
        storeUrl: "",
        releaseNotes: {
          ar: "تحديث جديد متوفر.",
          en: "A new update is available.",
        },
        maintenanceMode: isGlobalMaintenance,
      });
      return;
    }

    res.status(200).json({
      success: true,
      platform: platformConfig.platform,
      latestVersion: platformConfig.latestVersion,
      minRequiredVersion: platformConfig.minRequiredVersion,
      forceUpdate: Boolean(platformConfig.forceUpdate),
      storeUrl: platformConfig.storeUrl,
      releaseNotes: {
        ar: platformConfig.releaseNotesAr || "تحديث جديد متوفر.",
        en: platformConfig.releaseNotesEn || "A new update is available.",
      },
      maintenanceMode: Boolean(platformConfig.maintenanceMode || isGlobalMaintenance),
    });
  } catch (error: any) {
    logger.error("Error fetching app version config:", { error: error?.message });
    res.status(500).json({
      success: false,
      message: "Failed to retrieve app version information",
    });
  }
};

/**
 * Admin endpoint: List all platform configurations.
 * GET /admin/app-version
 */
export const getAdminAppConfigs = async (_req: Request, res: Response): Promise<void> => {
  try {
    const configs = await AppConfig.findAll({
      order: [["platform", "ASC"]],
    });

    res.status(200).json({
      success: true,
      configs,
    });
  } catch (error: any) {
    logger.error("Error fetching admin app configs:", { error: error?.message });
    res.status(500).json({
      success: false,
      message: "Failed to retrieve app configurations",
    });
  }
};

/**
 * Admin endpoint: Update or bulk-update app configuration.
 * PUT /admin/app-version
 */
export const updateAdminAppConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body;

    if (Array.isArray(payload)) {
      // Bulk update
      for (const item of payload) {
        if (!item.platform) continue;
        await AppConfig.upsert({
          platform: item.platform.toLowerCase(),
          latestVersion: item.latestVersion ?? "1.0.0",
          minRequiredVersion: item.minRequiredVersion ?? "1.0.0",
          forceUpdate: Boolean(item.forceUpdate),
          storeUrl: item.storeUrl ?? "",
          releaseNotesAr: item.releaseNotesAr ?? "",
          releaseNotesEn: item.releaseNotesEn ?? "",
          maintenanceMode: Boolean(item.maintenanceMode),
        });
      }
    } else if (payload && payload.platform) {
      // Single platform update
      await AppConfig.upsert({
        platform: payload.platform.toLowerCase(),
        latestVersion: payload.latestVersion ?? "1.0.0",
        minRequiredVersion: payload.minRequiredVersion ?? "1.0.0",
        forceUpdate: Boolean(payload.forceUpdate),
        storeUrl: payload.storeUrl ?? "",
        releaseNotesAr: payload.releaseNotesAr ?? "",
        releaseNotesEn: payload.releaseNotesEn ?? "",
        maintenanceMode: Boolean(payload.maintenanceMode),
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Invalid configuration payload. Platform is required.",
      });
      return;
    }

    const updatedConfigs = await AppConfig.findAll({
      order: [["platform", "ASC"]],
    });

    res.status(200).json({
      success: true,
      message: "App configuration updated successfully",
      configs: updatedConfigs,
    });
  } catch (error: any) {
    logger.error("Error updating admin app config:", { error: error?.message });
    res.status(500).json({
      success: false,
      message: "Failed to update app configuration",
    });
  }
};
