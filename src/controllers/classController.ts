import { Request, Response } from "express";
import Organization from "../models/oraganization.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";
import logger from "../config/logger";
import { getImportField } from "../helpers/importFieldLookup";
import { resolveOrgClassGrade } from "../helpers/resolveOrgClassGrade";

// Row-based bulk import (one row per class), distinct from the legacy
// second-row-header + "/"/"&"-split createClassByExcel below — kept for
// backward compatibility, but this is the endpoint the admin Import Wizard
// actually drives. Reuses the same org/class/grade auto-create logic already
// proven in studentController.ts's addStudent, via the shared helper.
const importClasses = async (req: Request, res: Response) => {
  const processedData: any = req.processedData;
  const successfulEntries: any[] = [];
  const failedEntries: any[] = [];

  try {
    for (const sheet in processedData) {
      const all_data = processedData[sheet];
      for (const data of all_data) {
        try {
          const classInput = getImportField(data, "classname", "className", "class", "Class");
          const orgInput = getImportField(data, "school", "School", "OrganizationName", "organizationName");
          const gradeInput = getImportField(data, "grade", "Grade");

          const result = await resolveOrgClassGrade({ orgInput, classInput, gradeInput });
          if ("error" in result) {
            failedEntries.push({ row: data, error: result.error });
            continue;
          }

          successfulEntries.push({
            row: data,
            message: "Class resolved successfully",
            classId: result.classRecord.id,
            organizationId: result.organization.id,
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
      message: "Class import completed",
      successCount: successfulEntries.length,
      failureCount: failedEntries.length,
      successfulEntries,
      failedEntries,
    });
  } catch (error) {
    logger.error("Error processing Excel file (class import):", { error });
    res.status(500).json({ message: "Internal server error", error });
  }
};

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
          const grade = row["grade"];
          let classNames = row["names of classes"];

          if (!grade || !classNames) {
            logger.warn(`Missing grade or class names in row:`, { row });
            continue;
          }


          const gradeName = String(grade).trim().toLowerCase();
          const [gradeRecord] = await Grade.findOrCreate({
            where: { name: gradeName },
            defaults: { name: gradeName }
          });

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
                gradeId: gradeRecord.id,
                organizationId: organization.id,
              },
            });

            if (existing) {
              logger.info(`Class "${className}" already exists in grade "${gradeName}" for school "${schoolName}". Skipping.`);
              continue;
            }


            try {
              await Class.create({
                classname: className.trim().toLowerCase(),
                classdescrption: "Description not provided",
                gradeId: gradeRecord.id,
                grade: gradeRecord.name,
                organizationId: organization.id,
              });
              logger.info(`Created class "${className}" in grade "${gradeName}" for "${schoolName}"`);
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
export { createClassByExcel, importClasses };
