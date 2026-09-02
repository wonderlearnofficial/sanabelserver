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
    return { error: "Missing school/organization name" };
  }
  const organization = adminOrganizationId !== null
    ? await Organization.findByPk(adminOrganizationId)
    : await Organization.findOne({ where: { name: orgName } });
  if (!organization) {
    return { error: "Organization does not exist" };
  }
  if (
    adminOrganizationId !== null &&
    orgName &&
    organization.name.trim().toLowerCase() !== orgName
  ) {
    return { error: "School admins cannot import classes into another organization" };
  }

  const gradeName = String(gradeInput || "").trim().toLowerCase();
  if (!gradeName) {
    return { error: "Missing grade name" };
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
    return { error: "Grade does not exist in this organization" };
  }

  const className = String(classInput || "").trim();
  if (!className) {
    return { error: "Missing class name" };
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
    return { error: "Existing class belongs to a different grade" };
  }

  return { organization, classRecord, gradeRecord };
}
