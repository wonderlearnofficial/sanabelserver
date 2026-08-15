export class InvalidOptionalIdError extends Error {
  constructor(public readonly field: string) {
    super(`${field} must be a positive integer, null, or an empty value`);
    this.name = "InvalidOptionalIdError";
  }
}

/**
 * Normalizes optional relationship IDs received from JSON/forms.
 * `undefined` means "leave unchanged" while null/empty means "clear it".
 */
export const parseOptionalPositiveId = (
  value: unknown,
  field: string,
): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidOptionalIdError(field);
  }

  return parsed;
};
