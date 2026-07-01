import { Request, Response } from "express";
import logger from "../config/logger";
import Organization from "../models/oraganization.model";
 // Corrected typo in model import

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

export { createOrganizationByExcel };
