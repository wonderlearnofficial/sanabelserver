import { Request, Response } from "express";
import logger from "../config/logger";
import Organization from "../models/oraganization.model";
import { getImportField } from "../helpers/importFieldLookup";
 // Corrected typo in model import

// Row-based bulk import (one row per organization name), distinct from the
// legacy sheet-names-as-org-names createOrganizationByExcel below — kept for
// backward compatibility, but this is the endpoint the admin Import Wizard
// actually drives, since a row-based CSV is what a generic wizard can build.
const importOrganizations = async (req: Request, res: Response) => {
  const processedData: any = req.processedData;
  const successfulEntries: any[] = [];
  const failedEntries: any[] = [];

  try {
    for (const sheet in processedData) {
      const all_data = processedData[sheet];
      for (const data of all_data) {
        try {
          const nameInput = getImportField(data, "name", "Name", "OrganizationName", "school", "School");
          const orgName = String(nameInput || "").trim().toLowerCase();
          if (!orgName) {
            failedEntries.push({ row: data, error: "Missing organization name" });
            continue;
          }

          let organization = await Organization.findOne({ where: { name: orgName } });
          const alreadyExisted = !!organization;
          if (!organization) {
            organization = await Organization.create({ name: orgName });
          }

          successfulEntries.push({
            row: data,
            message: alreadyExisted ? "Organization already existed" : "Organization created",
            organizationId: organization.id,
          });
        } catch (error) {
          failedEntries.push({
            row: data,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    res.json({
      message: "Organization import completed",
      successCount: successfulEntries.length,
      failureCount: failedEntries.length,
      successfulEntries,
      failedEntries,
    });
  } catch (error) {
    logger.error("Error processing Excel file (organization import):", { error });
    res.status(500).json({ message: "Internal server error", error });
  }
};

const createOrganizationByExcel = async (req: Request, res: Response) => {
  const schoolNames = req.sheetNames;

  if (!schoolNames) {
    return res.status(401).json({ data: "not found names" });
  }

  // Convert all school names to lowercase
  for (let name of schoolNames) {
    const lowerCaseName = name.trim().toLowerCase();  // Ensuring school name is in lowercase

    const schoolExist = await Organization.findOne({
      where: { name: lowerCaseName },
    });

    if (schoolExist) {
      continue;  // Skip if the organization already exists
    } else {
      await Organization.create({ name: lowerCaseName });  // Create new organization with lowercase name
    }
  }

  return res.status(200).json({ data: "the data added successfully" });
};

export { createOrganizationByExcel, importOrganizations };
