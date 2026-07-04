import Organization from "../models/oraganization.model";
import Class from "../models/class.model";
import Grade from "../models/grade.model";

interface ResolveParams {
  orgInput: any;
  classInput: any;
  gradeInput: any;
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
}: ResolveParams): Promise<ResolveResult | ResolveError> {
  const orgName = String(orgInput || "").trim().toLowerCase();
  if (!orgName) {
    return { error: "Missing school/organization name" };
  }
  let organization = await Organization.findOne({ where: { name: orgName } });
  if (!organization) {
    organization = await Organization.create({ name: orgName });
  }

  const gradeName = String(gradeInput || "").trim().toLowerCase();
  let gradeRecord = gradeName ? await Grade.findOne({ where: { name: gradeName } }) : null;
  if (!gradeRecord && gradeName) {
    gradeRecord = await Grade.create({ name: gradeName });
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
  }

  return { organization, classRecord, gradeRecord };
}
