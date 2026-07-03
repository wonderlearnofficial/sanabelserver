// Uploads a school-provided Excel roster (students or teachers) to the
// (now-fixed) bulk-import endpoints. Uses only Node's built-in fetch/
// FormData (Node 18+) — no extra npm packages needed.
//
// Usage:
//   node upload-camp-roster.js students path/to/roster.xlsx
//   node upload-camp-roster.js teachers path/to/roster.xlsx
//
// Optional env vars (defaults shown):
//   API_BASE=http://localhost:5000
//   ADMIN_EMAIL=admin@sanabel.local
//   ADMIN_PASSWORD=ChangeMe123!
//
// To upload against the live production server instead of local dev, set
// API_BASE to the Railway URL before running, e.g. (PowerShell):
//   $env:API_BASE="https://your-app.up.railway.app"; node upload-camp-roster.js students roster.xlsx
//
// The roster's columns can be named EITHER way (case-insensitive):
//   firstName / FirstName, lastName / LastName, email / Email,
//   grade / Grade, school / OrganizationName, class / ClassName
// The Organization ("school") and Class will be auto-created if they don't
// already exist. Every imported account gets the password "changeme123" —
// students/teachers can change it later from their profile.

const fs = require("fs");
const path = require("path");

const API_BASE = process.env.API_BASE || "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@sanabel.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe123!";

async function main() {
  const [, , kind, filePath] = process.argv;

  if (!kind || !["students", "teachers"].includes(kind) || !filePath) {
    console.error("Usage: node upload-camp-roster.js <students|teachers> <path-to-excel-file>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`Logging in as admin at ${API_BASE} ...`);
  const loginRes = await fetch(`${API_BASE}/users/login`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) {
    console.error("Admin login failed:", JSON.stringify(loginJson, null, 2));
    process.exit(1);
  }
  const token = loginJson.data.user.token;
  console.log("Login OK.");

  const endpoint = kind === "students" ? "/students/add-student" : "/teachers/add-teacher";

  const fileBuffer = fs.readFileSync(resolvedPath);
  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), path.basename(resolvedPath));

  console.log(`Uploading ${resolvedPath} to ${endpoint} ...`);
  const uploadRes = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const result = await uploadRes.json();

  if (!uploadRes.ok) {
    console.error("Upload failed:", JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const { successCount, failureCount, successfulEntries, failedEntries } = result;
  console.log(`\nDone: ${successCount} created, ${failureCount} failed.\n`);

  if (successfulEntries?.length) {
    console.log("Created:");
    successfulEntries.forEach((e) => {
      const row = e.row;
      console.log(`  - ${row.firstName || row.FirstName} ${row.lastName || row.LastName} <${row.email || row.Email}>`);
    });
  }

  if (failedEntries?.length) {
    console.log("\nFAILED rows (fix these and re-run just for them):");
    failedEntries.forEach((e) => {
      console.log(`  - ${JSON.stringify(e.row)} -> ${e.error}`);
    });
  }

  console.log("\nEvery created account's password is: changeme123");
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
