// Accept whatever header casing/naming a school's export happens to use
// (e.g. "firstName"/"school"/"class") in addition to our original
// FirstName/OrganizationName/ClassName convention, instead of failing every
// row because of a naming mismatch.
export const getImportField = (row: Record<string, any>, ...names: string[]) => {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
      return row[name];
    }
  }
  const keys = Object.keys(row);
  for (const name of names) {
    const match = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (match && row[match] !== undefined && row[match] !== null && row[match] !== "") {
      return row[match];
    }
  }
  return null;
};

// Bulk imports (school-provided rosters) can't be relied on to email
// successfully in real time, so every imported account shares one known
// onboarding password that students change on first login. The value is
// sourced from the environment so it is not hardcoded in source control;
// the literal fallback only applies to local development.
export const DEFAULT_IMPORT_PASSWORD =
  process.env.DEFAULT_IMPORT_PASSWORD || "changeme123";
