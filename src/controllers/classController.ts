import { Request, Response } from "express";
import Organization from "../models/oraganization.model";
import Class from "../models/class.model";
import logger from "../config/logger";

const createClassByExcel = async (req: Request, res: Response) => {
  try {
    const processedData = req.processedData;

    if (!processedData || typeof processedData !== "object") {
      return res.status(400).json({ message: "Processed data is missing." });
    }

    for (const schoolName in processedData) {
      if (processedData.hasOwnProperty(schoolName)) {
        const schoolData = processedData[schoolName];

        // Preprocess each row: normalize keys (lowercase & trim)
        const normalizedData = schoolData.map((row: any) => {
          const normalizedRow: Record<string, any> = {};
          for (const key in row) {
            if (row.hasOwnProperty(key)) {
              normalizedRow[key.trim().toLowerCase()] = row[key];
            }
          }
          return normalizedRow;
        });

        // Find or create the organization
        let organization = await Organization.findOne({
          where: { name: schoolName.trim().toLowerCase() },
        });

        if (!organization) {
          organization = await Organization.create({
            name: schoolName.trim().toLowerCase(),
          });
        }

        // Loop through each row
        for (const row of normalizedData) {
          const category = row["category"];
          let classNames = row["names of classes"];

          if (!category || !classNames) {
            logger.warn(`Missing category or class names in row:`, { row });
            continue;
          }


          // Normalize classNames to array if it's a string
          if (!Array.isArray(classNames)) {
            if (typeof classNames === "string") {
              classNames = classNames
                .split(/\s*(?:\/|\&|,)\s*/)
                .map((name: string) => name.trim())
                .filter(Boolean);
            } else {
              logger.warn(`Invalid classNames format:`, { classNames });
              continue;
            }

          }

          for (const className of classNames) {
            if (!className) continue;

            const existing = await Class.findOne({
              where: {
                classname: className.trim().toLowerCase(),
                category: category.trim().toLowerCase(),
                organizationId: organization.id,
              },
            });

            if (existing) {
              logger.info(`Class "${className}" already exists in category "${category}" for school "${schoolName}". Skipping.`);
              continue;
            }


            try {
              await Class.create({
                classname: className.trim().toLowerCase(),
                classdescrption: "Description not provided",
                category: category.trim().toLowerCase(),
                organizationId: organization.id,
              });
              logger.info(`Created class "${className}" in category "${category}" for "${schoolName}"`);
            } catch (err) {
              logger.error(`Failed to create class "${className}":`, { error: err });
            }

          }
        }
      }
    }

    return res.status(200).json({ message: "Classes created successfully!" });
  } catch (error) {
    logger.error("Error in createClassByExcel:", { error });
    return res.status(500).json({ message: "Server error.", error });
  }

};
export { createClassByExcel };
