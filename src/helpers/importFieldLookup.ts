// Accept whatever header casing/naming a school's export happens to use
// (e.g. "firstName", "First Name", " EMAIL ", "Grade Level", "الاسم الأول")
// instead of failing every row because of a naming mismatch.
//
// A header matches a requested field when, after normalisation (Unicode NFKC,
// Arabic diacritics/tatweel removed, lowercased, spaces/underscores/hyphens/dots
// removed), it equals the requested name or one of that field's aliases below.

const normalizeHeader = (value: string): string =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "") // Arabic harakat + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[\s_\-.:]+/g, "");

// Canonical field -> accepted header spellings (normalised on load). Kept in
// step with SANABEL_ROLE_USER_CASE_REFERENCE.md §12.
const RAW_ALIASES: Record<string, string[]> = {
  firstname: ["firstName", "first", "fname", "given name", "الاسم الأول", "الاسم الاول"],
  lastname: ["lastName", "last", "lname", "surname", "family name", "اسم العائلة", "اللقب"],
  email: ["email", "email address", "e-mail", "mail", "البريد الإلكتروني", "البريد", "الإيميل"],
  school: ["school", "school name", "organization", "organizationName", "organisation", "المدرسة", "اسم المدرسة"],
  class: ["class", "className", "classname", "class name", "section", "الفصل", "اسم الفصل"],
  grade: ["grade", "grade level", "grade name", "الصف", "المرحلة", "المستوى"],
  dateofbirth: ["dateOfBirth", "date of birth", "dob", "birth date", "birthdate", "تاريخ الميلاد"],
  gender: ["gender", "sex", "الجنس", "النوع"],
  name: ["name", "الاسم"],
  connectcode: ["connectCode", "connect code", "child connect code", "childConnectCode", "child code", "student code", "رمز الربط", "كود الربط"],
};

const FIELD_OF_ALIAS = new Map<string, string>();
for (const [field, aliases] of Object.entries(RAW_ALIASES)) {
  FIELD_OF_ALIAS.set(normalizeHeader(field), field);
  for (const alias of aliases) FIELD_OF_ALIAS.set(normalizeHeader(alias), field);
}

/** Canonical field for a header (or the normalised header if not an alias). */
export const canonicalImportField = (header: string): string => {
  const normalized = normalizeHeader(header);
  return FIELD_OF_ALIAS.get(normalized) ?? normalized;
};

const isPresent = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim() !== "";

export const getImportField = (row: Record<string, any>, ...names: string[]) => {
  if (!row || typeof row !== "object") return null;
  for (const name of names) {
    if (isPresent(row[name])) return row[name];
  }
  const wanted = new Set(names.map(canonicalImportField));
  for (const key of Object.keys(row)) {
    if (wanted.has(canonicalImportField(key)) && isPresent(row[key])) {
      return row[key];
    }
  }
  return null;
};

/** True when the file has a column for the field, whatever its spelling. */
export const hasImportColumn = (headers: string[] | undefined, name: string) =>
  !!headers?.some((h) => canonicalImportField(h) === canonicalImportField(name));
