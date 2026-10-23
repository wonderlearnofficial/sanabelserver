import { Request, Response, NextFunction } from "express";
import * as XLSX from "xlsx";
import logger from "../config/logger";
import fs from "fs";
import path from "path";
import { setImportRowNumber } from "../helpers/importRow";

declare global {
  namespace Express {
    interface Request {
      processedData?: Record<string, any>;
      sheetNames?: string[];
      /** Header row of the imported sheet, as written in the file. */
      importHeaders?: string[];
    }
  }
}

const removeUploadedFile = (filePath?: string) => {
  if (!filePath) return;
  fs.unlink(filePath, (error) => {
    if (error && error.code !== "ENOENT") {
      logger.warn("Could not remove processed upload", { error });
    }
  });
};

/** A file the importer refuses; always a 400 with a specific code. */
export class SpreadsheetFileError extends Error {
  status = 400;
  constructor(public code: string, message: string) {
    super(message);
    this.name = "SpreadsheetFileError";
  }
}

const INVALID_MESSAGE =
  "The uploaded file is not a valid spreadsheet. Upload an .xlsx, .xls or .csv file.";
const invalidFile = () => new SpreadsheetFileError("INVALID_SPREADSHEET", INVALID_MESSAGE);
const emptyFile = () => new SpreadsheetFileError("FILE_EMPTY", "The uploaded file is empty.");

const startsWith = (buffer: Buffer, bytes: number[]) =>
  buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // .xlsx (OOXML zip)
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // .xls (BIFF)
const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

/** Text files never contain NUL bytes (UTF-16 is detected by its BOM first). */
const looksLikeText = (buffer: Buffer) => !buffer.subarray(0, 65536).includes(0);

/**
 * Decodes CSV/text bytes. UTF-8 (with or without a BOM) first, so Arabic sent
 * by the admin wizard (UTF-8, no BOM) survives; then UTF-16 with a BOM (Excel
 * "Unicode Text"); then Windows-1256, the code page Excel uses for "CSV" on
 * Arabic Windows.
 */
export const decodeCsvText = (buffer: Buffer): string => {
  if (startsWith(buffer, UTF16LE_BOM)) return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  if (startsWith(buffer, UTF16BE_BOM)) return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  const body = startsWith(buffer, [0xef, 0xbb, 0xbf]) ? buffer.subarray(3) : buffer;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    try {
      return new TextDecoder("windows-1256").decode(body);
    } catch {
      return body.toString("latin1");
    }
  }
};

/**
 * Reads and validates an uploaded spreadsheet. Throws SpreadsheetFileError for
 * an empty file, a non-spreadsheet (e.g. a PDF renamed .xlsx) or a corrupt one.
 *
 * CSV is parsed as raw text: no number/date coercion and, crucially, no formula
 * evaluation, so `=HYPERLINK(...)` is kept verbatim and its commas never shift
 * columns.
 */
export const readUploadedWorkbook = (
  file: { path: string; originalname: string },
  options: { firstSheetOnly?: boolean } = {},
): XLSX.WorkBook => {
  const buffer = fs.readFileSync(file.path);
  if (buffer.length === 0) throw emptyFile();

  const ext = path.extname(file.originalname || "").toLowerCase();
  const isZip = startsWith(buffer, ZIP);
  const isOle = startsWith(buffer, OLE2);
  const isUtf16 = startsWith(buffer, UTF16LE_BOM) || startsWith(buffer, UTF16BE_BOM);
  if (startsWith(buffer, PDF)) throw invalidFile();

  let asText: boolean;
  if (ext === ".xlsx") {
    if (!isZip) throw invalidFile();
    asText = false;
  } else if (ext === ".xls") {
    // Real BIFF, an xlsx saved with the old extension, or a text export.
    if (isZip || isOle) asText = false;
    else if (isUtf16 || looksLikeText(buffer)) asText = true;
    else throw invalidFile();
  } else {
    if (isZip || isOle || !(isUtf16 || looksLikeText(buffer))) throw invalidFile();
    asText = true;
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = asText
      ? XLSX.read(decodeCsvText(buffer), { type: "string", raw: true, ...(options.firstSheetOnly ? { sheets: 0 } : {}) })
      : XLSX.read(buffer, { type: "buffer", cellNF: true, cellFormula: false, cellHTML: false, ...(options.firstSheetOnly ? { sheets: 0 } : {}) });
  } catch {
    throw invalidFile();
  }
  if (!workbook?.SheetNames?.length || !workbook.Sheets[workbook.SheetNames[0]]) {
    throw invalidFile();
  }
  return workbook;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Date-formatted numeric cells become "YYYY-MM-DD" text (the calendar date the
 * operator sees in Excel), never the raw serial, which a DATEONLY column would
 * store as 1970-01-01. Error cells (#N/A, #REF!) become empty.
 */
const normalizeCells = (sheet: XLSX.WorkSheet) => {
  for (const address of Object.keys(sheet)) {
    if (address[0] === "!") continue;
    const cell = sheet[address] as XLSX.CellObject;
    if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z as string)) {
      const parsed = XLSX.SSF.parse_date_code(cell.v as number);
      if (parsed) {
        cell.t = "s";
        cell.v = `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
      }
    } else if (cell.t === "d" && cell.v instanceof Date) {
      const d = cell.v as Date;
      cell.t = "s";
      cell.v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    } else if (cell.t === "e") {
      cell.t = "z";
      delete cell.v;
    }
  }
};

const isBlank = (value: unknown) =>
  value === undefined || value === null || String(value).trim() === "";

/**
 * Parses the FIRST worksheet of a row-per-record import into objects keyed by
 * the header row. Fully blank rows are skipped; every row object carries its
 * sheet row number (1-based, header included) via `setImportRowNumber`.
 */
export const parseRowSheet = (workbook: XLSX.WorkBook) => {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  normalizeCells(sheet);
  const firstRow = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r : 0;
  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const headerIndex = matrix.findIndex((r) => Array.isArray(r) && r.some((c) => !isBlank(c)));
  if (headerIndex < 0) return { sheetName, headers: [] as string[], rows: [] as Record<string, any>[] };
  const headers = (matrix[headerIndex] as any[]).map((h) =>
    isBlank(h) ? "" : String(h).replace(/^﻿/, "").trim(),
  );

  const rows: Record<string, any>[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const cells = (matrix[i] as any[]) || [];
    // Fully blank = no cell at all. A cell that exists but holds only spaces
    // (or an explicit empty string) is a data row and is validated as such.
    if (cells.every((cell) => cell === null || cell === undefined)) continue;
    const row: Record<string, any> = {};
    headers.forEach((header, column) => {
      if (header) row[header] = cells[column] ?? null;
    });
    rows.push(setImportRowNumber(row, firstRow + i + 1));
  }
  return { sheetName, headers, rows };
};

const sendFileError = (res: Response, error: unknown, label: string) => {
  if (error instanceof SpreadsheetFileError) {
    return res.status(400).json({ success: false, code: error.code, message: error.message });
  }
  logger.error(`Error processing ${label} file:`, { error });
  return res.status(500).json({ success: false, message: `Failed to process the ${label} file` });
};

// Middleware to process the uploaded Excel file and extract data
// (legacy sheet-per-school format: second row is the header).
const schoolAndClassProcessMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check if a file was uploaded
    if (!req.file) {
      return res.status(400).json({ success: false, code: "FILE_REQUIRED", message: "No file uploaded. Send the spreadsheet in the \"file\" field." });
    }

    const filePath = req.file.path;
    const workbook = readUploadedWorkbook(req.file);

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
    removeUploadedFile(filePath);

    // Call the next middleware or route handler
    next();
  } catch (error) {
    removeUploadedFile(req.file?.path);
    sendFileError(res, error, "spreadsheet");
  }
};

/**
 * Row-per-record importers (students, teachers, parents, classes, grades,
 * organizations). Only the first worksheet is imported, as documented and as
 * the wizard previews. Responds 400 for a missing, empty, invalid or
 * header-only file; otherwise `req.processedData = { [sheetName]: rows }`.
 */
const processStudentMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: "FILE_REQUIRED",
        message: "No file uploaded. Send the spreadsheet in the \"file\" field.",
      });
    }

    const filePath = req.file.path;
    const workbook = readUploadedWorkbook(req.file, { firstSheetOnly: true });
    const { sheetName, headers, rows } = parseRowSheet(workbook);
    removeUploadedFile(filePath);

    if (headers.length === 0) throw emptyFile();
    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        code: "NO_DATA_ROWS",
        message: "The file has a header row but no data rows.",
      });
    }

    req.processedData = { [sheetName]: rows };
    req.sheetNames = [sheetName];
    req.importHeaders = headers;
    next();
  } catch (error) {
    removeUploadedFile(req.file?.path);
    sendFileError(res, error, "spreadsheet");
  }
};

// Teachers use the same row parser; header aliases are resolved by the
// controller through getImportField, so no extra keys are added to the rows.
const processTeacherMiddleware = processStudentMiddleware;

export {
  schoolAndClassProcessMiddleware,
  processStudentMiddleware,
  processTeacherMiddleware,
};
