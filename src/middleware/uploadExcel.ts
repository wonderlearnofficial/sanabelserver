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
