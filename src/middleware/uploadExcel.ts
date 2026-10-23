import multer from "multer";
import path from "path";
import { Request } from "express";

// Every active upload endpoint is a spreadsheet (Excel/CSV) roster/grade import.
// Bound the size, allow a single file, and reject anything that isn't a
// spreadsheet by both extension and MIME type. Rejected files never reach disk.
const MAX_UPLOAD_BYTES =
  Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024; // 5 MB

const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

// Kept intentionally permissive on MIME because browsers/OSes are inconsistent
// (xlsx often arrives as octet-stream). The strict extension allowlist above is
// the primary gate that blocks executables/scripts (.exe/.php/.js/.html/...).
const ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/octet-stream",
];

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req: Request, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const extOk = ALLOWED_EXTENSIONS.includes(ext);
    const mimeOk = ALLOWED_MIME_TYPES.includes(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    const err: any = new Error("Only Excel/CSV files are allowed");
    err.status = 400;
    return cb(err);
  },
});

export default upload;

/**
 * Maps a multer error to a client error with a message that says exactly what
 * was wrong with the upload. Returns null for anything that is not a multer
 * error. Used by the central error handler, which otherwise answers 500.
 */
export const describeUploadError = (
  err: any,
): { status: number; code: string; message: string } | null => {
  if (!(err instanceof multer.MulterError)) return null;
  const limitMb = Math.round((MAX_UPLOAD_BYTES / (1024 * 1024)) * 10) / 10;
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return {
        status: 413,
        code: "FILE_TOO_LARGE",
        message: `The file is too large. The size limit is ${limitMb} MB.`,
      };
    case "LIMIT_FILE_COUNT":
      return {
        status: 400,
        code: "TOO_MANY_FILES",
        message: "Upload one file per request.",
      };
    case "LIMIT_UNEXPECTED_FILE":
      return {
        status: 400,
        code: "UNEXPECTED_FILE_FIELD",
        message: `Unexpected file field "${err.field ?? ""}". Send the spreadsheet in the "file" field.`,
      };
    default:
      return {
        status: 400,
        code: err.code || "UPLOAD_REJECTED",
        message: `The upload was rejected: ${err.message}`,
      };
  }
};
