import { Request, Response, NextFunction } from "express";
import * as XLSX from "xlsx";
import logger from "../config/logger";

declare global {
  namespace Express {
    interface Request {
      processedData?: Record<string, any>;
      sheetNames?: string[];
    }
  }
}
// Middleware to process the uploaded Excel file and extract data
const schoolAndClassProcessMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check if a file was uploaded
    if (!req.file) {
      return res.status(400).send("No file uploaded.");
    }

    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);

    // Get all sheet names
    const sheetNames = workbook.SheetNames;

    // Process each sheet using the second row as the header
    const allSheetData: Record<string, any[]> = {};
    sheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];

      // Adjust the range to skip the first row
      const options = { header: 1, range: 1 }; // 'range: 1' skips the first row
      const rawData = XLSX.utils.sheet_to_json(sheet, options);

      if (rawData.length > 0) {
        // Use the second row (index 0 in rawData) as the header
        const headers = rawData[0] as string[];
        const rows = rawData.slice(1);

        // Convert rows to objects based on the second row's headers
        const parsedData = rows.map((row: any) => {
          const rowObject: Record<string, any> = {};
          headers.forEach((header, index) => {
            // Split the 'Names of classes' if it's a string (by '/' and '&')
            if (
              header === "Names of classes" &&
              typeof row[index] === "string"
            ) {
              // Split by both '/' and '&', while trimming spaces
              rowObject[header] = row[index]
                .split(/\s*(?:\/|\&)\s*/)
                .map((className: any) => className.trim());
            } else {
              rowObject[header] = row[index];
            }
          });
          return rowObject;
        });

        allSheetData[sheetName] = parsedData;
      } else {
        allSheetData[sheetName] = [];
      }
    });

    // Add the processed data to the request object for further use in the next middleware or route
    req.processedData = allSheetData;
    req.sheetNames = sheetNames;

    // Call the next middleware or route handler
    next();
  } catch (error) {
    logger.error("Error processing file:", { error });
    res.status(500).send("Error processing file.");
  }
};

const processStudentMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    
    // Ensure a file has been uploaded
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Read the uploaded Excel file
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);

    // Store processed data for all sheets
    const allSheetData: Record<string, any[]> = {};

    // Process each sheet in the workbook
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];

      // Convert sheet data to JSON format
      const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (sheetData.length > 1) {
        // Use the first row as column headers
        const headers = sheetData[0] as string[];

        // Process rows as objects
        const rows = sheetData.slice(1).map((row: any) => {
          const rowObject: Record<string, any> = {};
          headers.forEach((header, index) => {
            if (header) {
              rowObject[header] = row[index] || null;
            }
          });
          return rowObject;
        });

        allSheetData[sheetName] = rows;
      } else {
        allSheetData[sheetName] = [];
      }
    });

    // Attach processed data to the request object
    req.processedData = allSheetData;

    // Call the next middleware
    next();
  } catch (error) {
    logger.error("Error processing Excel student file:", { error });
    res.status(500).json({ error: "Failed to process Excel file" });
  }
};


const processTeacherMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
        error: "No file provided in the request",
      });
    }
    logger.info("Processing teacher file started");
    const filePath = req.file.path;

    const workbook = XLSX.readFile(filePath);
    const allSheetData: Record<string, any[]> = {};

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const sheetData = XLSX.utils.sheet_to_json(sheet, { defval: null });

      allSheetData[sheetName] = sheetData.map((row: any) => {
        const formattedRow = { ...row };

        // Normalize fields (e.g. trim whitespace, fix formatting)
        formattedRow.FirstName = row.FirstName?.toString().trim() || null;
        formattedRow.LastName = row.LastName?.toString().trim() || null;
        formattedRow.Email = row.Email?.toString().trim() || null;
        formattedRow.DateOfBirth = row.DateOfBirth || null;
        formattedRow.Gender = row.Gender?.toString().trim() || null;
        formattedRow.OrganizationName = row.OrganizationName?.toString().trim() || null;

        return formattedRow;
      });
    });

    req.processedData = allSheetData;
    req.sheetNames = workbook.SheetNames;

    next();
  } catch (error) {
    logger.error("Error processing teacher file:", { error });
    res.status(500).json({
      success: false,
      message: "Failed to process teacher file",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {
  schoolAndClassProcessMiddleware,
  processStudentMiddleware,
  processTeacherMiddleware,
};
