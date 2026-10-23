/** Organization membership requires approval, even before class placement.
 * A legacy class without an organization is inconsistent: fail closed for
 * completion without silently repairing the student's relationships.
 */
export const requiresMissionApproval = (student: {
  organizationId?: number | null;
  classId?: number | null;
}): boolean => student.organizationId != null || student.classId != null;
