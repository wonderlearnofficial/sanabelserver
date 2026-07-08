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
