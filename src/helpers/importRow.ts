import * as XLSX from "xlsx";

/**
 * Shared per-row contract for every bulk importer (students, teachers,
 * parents, classes, grades, organizations).
 *
 * Failed entry:     { rowNumber, column?, code, message, email? }
 * Successful entry: { rowNumber, message, email?, emailSent?, ...ids }
 *
 * `rowNumber` is the row in the uploaded sheet, 1-based and counting the header
 * (the first data row is 2). Blank rows are skipped but still counted, so the
 * number always matches what the operator sees in Excel. `column` names the
 * offending column using the template's header name (firstName, lastName,
 * email, school, class, grade, DateOfBirth, connectCode, classname, name).
 */
export interface ImportFailure {
  rowNumber: number;
  column?: string;
  code: string;
  message: string;
  email?: string | null;
}

/** Hidden (non-enumerable) key the upload middleware puts on every parsed row. */
const ROW_NUMBER = Symbol.for("sanabel.import.rowNumber");

export const setImportRowNumber = (row: Record<string, any>, rowNumber: number) => {
  Object.defineProperty(row, ROW_NUMBER, { value: rowNumber, enumerable: false });
  return row;
};

/** Sheet row number of a parsed row; falls back to position + 2 (header = row 1). */
export const importRowNumber = (row: any, index: number): number => {
  const value = row && typeof row === "object" ? row[ROW_NUMBER] : undefined;
  return typeof value === "number" ? value : index + 2;
};

export const rowFailure = (
  rowNumber: number,
  code: string,
  message: string,
  column?: string,
  email?: string | null,
): ImportFailure => {
  const entry: ImportFailure = { rowNumber, code, message };
  if (column) entry.column = column;
  if (email !== undefined) entry.email = email || null;
  return entry;
};

/** Trimmed, lowercased email (the only stored form). */
export const normalizeImportEmail = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim().toLowerCase();

// Rejects what the model's isEmail validator would reject, so the row fails
// with a field-level message instead of a raw Sequelize error: leading/trailing
// or doubled dots in the local part, empty domain labels, no TLD.
const EMAIL_RE =
  /^(?!\.)(?!.*\.\.)[a-z0-9!#$%&'*+/=?^_`{|}~.-]+(?<!\.)@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export const isValidImportEmail = (email: string): boolean =>
  email.length <= 254 && EMAIL_RE.test(email);

const pad = (n: number) => String(n).padStart(2, "0");

const isoDate = (y: number, m: number, d: number): string | null => {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/**
 * Parses a DateOfBirth cell into YYYY-MM-DD.
 *
 * Accepts: an Excel date serial (number), a JS Date, ISO text (YYYY-MM-DD or
 * YYYY/MM/DD, optionally followed by a time) and day-first text (DD/MM/YYYY or
 * DD-MM-YYYY, the regional convention). Returns `undefined` for an empty cell
 * and `null` for a value that is present but not a real date.
 */
export const parseImportDate = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1 || value > 80000) return null;
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? isoDate(parsed.y, parsed.m, parsed.d) : null;
  }
  const text = String(value).trim();
  if (!text) return undefined;
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  if (/^\d+(\.\d+)?$/.test(text)) return parseImportDate(Number(text));
  return null;
};

const FIELD_COLUMN: Record<string, string> = {
  email: "email",
  firstName: "firstName",
  lastName: "lastName",
  dateOfBirth: "DateOfBirth",
  gender: "gender",
  name: "name",
  classname: "classname",
  connectCode: "connectCode",
};

/**
 * Turns an unexpected per-row exception into a field-level failure. Sequelize
 * validation / unique errors name the offending column; nothing else leaks the
 * raw database text.
 */
export const describeRowError = (
  rowNumber: number,
  error: any,
  email?: string | null,
): ImportFailure => {
  const item = Array.isArray(error?.errors) ? error.errors[0] : undefined;
  const path: string | undefined = item?.path ?? item?.field ?? undefined;
  const column = path ? FIELD_COLUMN[path] ?? path : undefined;
  if (error?.name === "SequelizeUniqueConstraintError") {
    return rowFailure(
      rowNumber,
      column === "email" ? "EMAIL_CONFLICT" : "DUPLICATE_VALUE",
      column ? `${column} is already in use` : "A unique value in this row is already in use",
      column,
      email,
    );
  }
  if (error?.name === "SequelizeValidationError" && column) {
    const rule = String(item?.validatorKey ?? item?.validatorName ?? "");
    const message =
      rule === "isEmail"
        ? `${column} format is invalid`
        : rule === "notEmpty" || item?.type === "notNull Violation"
          ? `${column} is required`
          : `${column} has an invalid value`;
    return rowFailure(
      rowNumber,
      rule === "isEmail" ? "INVALID_EMAIL" : "INVALID_VALUE",
      message,
      column,
      email,
    );
  }
  return rowFailure(rowNumber, "ROW_FAILED", "The row could not be saved", undefined, email);
};

/**
 * Runs `task` over `items` with at most `limit` in flight. Used to send
 * onboarding emails after the rows are written instead of one SMTP round trip
 * per row inside the import loop.
 */
export const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  });
  await Promise.all(workers);
};
