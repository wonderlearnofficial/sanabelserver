import Organization from "../models/oraganization.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";

interface ResolveParams {
  orgInput: any;
  classInput: any;
  gradeInput: any;
  adminOrganizationId?: number | null;
}

interface ResolveResult {
  organization: Organization;
  classRecord: Class;
  gradeRecord: Grade | null;
  error?: undefined;
}

interface ResolveError {
  error: string;
  /** Stable machine code, e.g. GRADE_REQUIRED. */
  code: string;
  /** Template column at fault: school, grade or classname. */
  column: "school" | "grade" | "classname";
  organization?: undefined;
  classRecord?: undefined;
  gradeRecord?: undefined;
}

// Shared by /class/import — mirrors the org/class/grade auto-create logic
// already proven in studentController.ts's addStudent (kept duplicated there
// deliberately; see the plan notes on not touching already-verified code).
export async function resolveOrgClassGrade({
  orgInput,
  classInput,
  gradeInput,
  adminOrganizationId = null,
}: ResolveParams): Promise<ResolveResult | ResolveError> {
  const orgName = String(orgInput || "").trim().toLowerCase();
  if (!orgName && adminOrganizationId === null) {
    return { error: "school is required", code: "ORGANIZATION_REQUIRED", column: "school" };
  }
  const organization = adminOrganizationId !== null
    ? await Organization.findByPk(adminOrganizationId)
    : await Organization.findOne({ where: { name: orgName } });
  if (!organization) {
    return { error: "school not found; create it before importing", code: "ORGANIZATION_NOT_FOUND", column: "school" };
  }
  if (
    adminOrganizationId !== null &&
    orgName &&
    organization.name.trim().toLowerCase() !== orgName
  ) {
    return { error: "school admins can import only into their own school", code: "FORBIDDEN_ORGANIZATION", column: "school" };
  }

  const gradeName = String(gradeInput || "").trim().toLowerCase();
  if (!gradeName) {
    return { error: "grade is required", code: "GRADE_REQUIRED", column: "grade" };
  }
  let gradeRecord = await Grade.findOne({
    where: { name: gradeName, organizationId: organization.id },
  });
  if (!gradeRecord) {
    gradeRecord = await Grade.findOne({
      where: { name: gradeName, organizationId: null },
    });
  }
  if (!gradeRecord) {
    return { error: "grade not found in this organization", code: "GRADE_NOT_FOUND", column: "grade" };
  }

  const className = String(classInput || "").trim();
  if (!className) {
    return { error: "classname is required", code: "REQUIRED_FIELD_MISSING", column: "classname" };
  }
  let classRecord = await Class.findOne({
    where: { organizationId: organization.id, classname: className },
  });
  if (!classRecord) {
    classRecord = await Class.create({
      classname: className,
      organizationId: organization.id,
      gradeId: gradeRecord ? gradeRecord.id : null,
      grade: gradeRecord ? gradeRecord.name : gradeName || null,
    });
  } else if (classRecord.gradeId !== gradeRecord.id) {
    return { error: "classname already exists under a different grade", code: "CLASS_GRADE_MISMATCH", column: "grade" };
  }

  return { organization, classRecord, gradeRecord };
}
