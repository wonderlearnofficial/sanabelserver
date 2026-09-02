import Class from "../models/class.model";
import Grade from "../models/grade.model";
import Organization from "../models/oraganization.model";

export class RelationshipValidationError extends Error {
  status = 422;

  constructor(message: string) {
    super(message);
    this.name = "RelationshipValidationError";
  }
}

interface ResolveStudentRelationshipsInput {
  organizationId: number | null;
  classId: number | null;
  gradeId: number | null;
  transaction?: any;
}

/**
 * Resolves the duplicated Student relationship fields as one unit.
 *
 * A selected Class is authoritative for its Organization and, when present,
 * its Grade. Shared Grades (organizationId = null) are valid in every school;
 * school Grades are valid only in their own Organization.
 */
export async function resolveStudentRelationships({
  organizationId,
  classId,
  gradeId,
  transaction,
}: ResolveStudentRelationshipsInput) {
  let resolvedOrganizationId = organizationId;
  let resolvedGradeId = gradeId;
  let targetClass: Class | null = null;

  if (classId !== null) {
    targetClass = await Class.findByPk(classId, { transaction });
    if (!targetClass) {
      throw new RelationshipValidationError("Target class does not exist");
    }

    if (
      resolvedOrganizationId !== null &&
      targetClass.organizationId !== resolvedOrganizationId
    ) {
      throw new RelationshipValidationError(
        "Target class does not belong to the selected organization",
      );
    }
    resolvedOrganizationId = targetClass.organizationId ?? null;

    if (
      resolvedGradeId !== null &&
      targetClass.gradeId != null &&
      targetClass.gradeId !== resolvedGradeId
    ) {
      throw new RelationshipValidationError(
        "Target class does not belong to the selected grade",
      );
    }
    if (resolvedGradeId === null && targetClass.gradeId != null) {
      resolvedGradeId = targetClass.gradeId;
    }
  }

  if (resolvedOrganizationId !== null) {
    const organization = await Organization.findByPk(resolvedOrganizationId, {
      transaction,
    });
    if (!organization) {
      throw new RelationshipValidationError(
        "Target organization does not exist",
      );
    }
  }

  let gradeRecord: Grade | null = null;
  if (resolvedGradeId !== null) {
    gradeRecord = await Grade.findByPk(resolvedGradeId, { transaction });
    if (!gradeRecord) {
      throw new RelationshipValidationError("Target grade does not exist");
    }
    if (
      gradeRecord.organizationId != null &&
      gradeRecord.organizationId !== resolvedOrganizationId
    ) {
      throw new RelationshipValidationError(
        "Target grade does not belong to the selected organization",
      );
    }
  }

  return {
    organizationId: resolvedOrganizationId,
    classId,
    gradeId: resolvedGradeId,
    gradeName: gradeRecord?.name ?? (targetClass?.grade as string | null) ?? null,
  };
}

export async function validateGradeForOrganization(
  gradeId: number,
  organizationId: number,
  transaction?: any,
) {
  const gradeRecord = await Grade.findByPk(gradeId, { transaction });
  if (!gradeRecord) {
    throw new RelationshipValidationError("Target grade does not exist");
  }
  if (
    gradeRecord.organizationId != null &&
    gradeRecord.organizationId !== organizationId
  ) {
    throw new RelationshipValidationError(
      "Target grade does not belong to the selected organization",
    );
  }
  return gradeRecord;
}
