# Admin API — authorization contract

Authoritative for what each kind of admin may call, and what the response means.
Written for the standalone `admin/` frontend; the frontend's route guards and
navigation must mirror this, but **this document describes where access is
actually enforced.** Hiding a page is not a control.

Every route below is mounted under `/admin` and runs
`authenticateToken` → `checkAdmin` first. `checkAdmin` resolves the acting
admin's scope from the `Admins` table on **every request** and puts it on
`req.adminOrganizationId`; handlers read it through `getAdminScope(req)`.

---

## 1. Role model

| Condition | Scope |
|---|---|
| `Users.role = 'Admin'` and `Admins.organizationId IS NULL` | **Super Admin** — platform-wide |
| `Users.role = 'Admin'` and `Admins.organizationId IS NOT NULL` | **School Admin** — that organization only |

`isSuperAdmin` is derived from `organizationId`. It is not a column and is never
read from the request.

### A School Admin has no grade and no class

Their authority is `Admins.organizationId`. They administer many grades and many
classes and belong to none of them.

A School Admin with `organizationId = 11`, no `gradeId` and no `classId` is a
**correctly configured account**. No endpoint asks for an admin's own grade or
class, none reports one as missing, and no scope is ever derived from
`gradeId`, `classId`, `Teacher.classId`, `Student.classId` or a parent link.
Grades and classes are records they manage.

---

## 2. Global routes — Super Admin only

`requireSuperAdmin` follows `checkAdmin`. A School Admin, Teacher, Parent or
Student receives **403**.

| Route | Purpose |
|---|---|
| `GET /admin/analytics/overview` | platform counts, missions, approvals |
| `GET /admin/analytics/completions` | paginated completion feed |
| `GET /admin/analytics/missions` | mission ranking |
| `GET /admin/analytics/users` | engagement |
| `GET /admin/analytics/organizations` | per-school comparison |
| `GET /admin/analytics/approvals` | approval funnel |
| `GET /admin/analytics/assignments` | teacher/parent assignments |
| `GET /admin/analytics/dashboard` | operational rollup |
| `GET /admin/analytics/activity` | recent platform events |
| `GET /admin/analytics/emails` | transactional email telemetry |
| `GET /admin/analytics/imports` | global import telemetry |
| `GET /admin/analytics/data-quality` | structural consistency |
| `GET /admin/analytics/system-health` | server, database, API metrics |
| `GET /admin/data-quality` | platform warning counters |
| `GET /admin/data-quality/detail` | drill-down by issue |
| `GET /admin/app-version` · `PUT /admin/app-version` | platform release config |
| `POST /admin/organizations` | create a school |
| `PATCH /admin/organizations/:id` · `DELETE /admin/organizations/:id` | rename / remove a school |

Creating, renaming and deleting a school is platform management, so those three
carry `requireSuperAdmin` at the route. Reading a school does not — see below.

---

## 3. School-scoped routes — both kinds of admin

No `requireSuperAdmin`. The handler scopes the query from
`Admins.organizationId`, which is what lets one endpoint serve both kinds
without leaking between schools. A Super Admin gets the same shape computed
globally.

| Route | School Admin sees |
|---|---|
| `GET /admin/me` | own identity and scope |
| `GET /admin/stats` | own school's population |
| `GET /admin/school-dashboard` | own school's activity |
| `GET /admin/school-data-quality` | own school's warnings |
| `GET /admin/import-analytics` | own school's import batches |
| `GET /admin/students` (+ `:id`, PATCH, DELETE) | own school's students |
| `GET /admin/teachers` | own school's teachers |
| `GET /admin/parents` | parents linked to own school's students |
| `GET /admin/users` (+ POST, PATCH, DELETE, reset-password) | own school's students and teachers, plus their parents. **Never an Admin row.** |
| `GET /admin/classes` (+ POST, PATCH, DELETE) | own school's classes |
| `GET /admin/grades` (+ POST, PATCH, DELETE) | own school's grades **plus shared grades** (`organizationId IS NULL`), which every school may use |
| `POST /admin/grades/import` | imports into own school |
| `GET /admin/scores` · `GET /admin/history` | own school's students |
| `GET /admin/organizations` | **only their own organization** — a one-row list |
| `GET /admin/organizations/:id` | own organization; any other id is refused |
| `POST /admin/impersonation` | own school's students only |

### Scope cannot be widened from the request

For a School Admin the server **overwrites** the organization after reading the
query string, so `?organizationId=` and `body.organizationId` change nothing.
Creates force `effectiveOrganizationId = scope`. Proven against a live database
in `tests/analytics.integration.test.js`.

`POST /admin/users` additionally refuses a School Admin creating a `role: Admin`
account (403).

### Refusal codes are deliberate

| Code | Meaning |
|---|---|
| **404** | The record exists but belongs to another school. The message is identical to a genuinely missing record, so probing an id cannot confirm it is real. |
| **403** | The action is unavailable to a School Admin whatever the id: editing a shared grade, moving a record between schools, managing organizations, creating an Admin. |

Both are refusals. The frontend should treat either as "not yours" and must not
present 404 here as "deleted".

---

## 4. Counting units — name them in the UI

Three counts mean something narrower than their obvious reading. Presenting them
without the qualifier overstates activity.

| Field | Unit | Not |
|---|---|---|
| `ImportRuns` rows, `totalImportBatches`, `todayCount`, `monthCount` | one submitted **batch** of ≤50 rows | one uploaded file — a 200-row spreadsheet is 4 batches |
| `assignments.bySource[].items`, `status.total`, `assignmentSources` | one assignment **source row** | one distinct To-Do — an item assigned by a teacher *and* a parent is two assignments, and `status.total` equals the sum of per-source items |
| `newUsersToday/Week/Month` | **registrations** | active users — no login or session events are recorded |

`assignments` publishes `countingUnit: "assignment_source"` so the unit travels
with the payload.

---

## 5. Honesty rules the API already enforces

- **A rate is `null`, never 0, when nothing has resolved.** `approvalRate`,
  `denialRate`, `completionRate`, `errorRate`, `deliveryRate`. Render an em
  dash, not "0%".
- **Solo vs school is decided by organization, not class.**
  `overview.people.soloUsers` counts `Students.organizationId IS NULL`. An
  enrolled student with no class is a school student **and** a data-quality
  problem — not a Solo learner. (This was previously split on `classId` and
  mislabelled two of nineteen students on the local database.)
- **No delivery claims for email.** `deliveryTrackingAvailable` is `false`
  because no provider webhook exists, `totals.deliveryRate` is `null`, and
  statuses are only `send_attempted` / `send_accepted` / `send_failed`.
  Acceptance is not inbox delivery. Do not render a delivered count or a bounce
  rate.
- **`dataAvailableFrom` marks where a series begins.** Nothing before an
  instrumentation cutover is reconstructed. Show "data available from …" rather
  than a flat line back to zero.
- **`coverage: "current_process_only"`** on system health: in-memory aggregates
  for the instance that answered, reset on restart, not a historical log. A "0
  errors" reading after a deploy means "nothing measured yet".
- **`unavailableMetrics`** on overview names metrics with no stored history (XP
  issued, Snabel spent). Summarise the fact; do not print internal field names
  at an operator, and never substitute 0.

---

## 6. Data quality — two levels, two endpoints

Not one endpoint filtered in the browser. A client-side filter over a global
result set is not a scope boundary.

### `GET /admin/data-quality` — Super Admin

`schoolStudentsWithoutClass`, `schoolStudentsWithoutGrade`,
`classesWithoutTeacher`, `adminUsersWithoutAdminProfile`, `orphanedStudents`.
`GET /admin/data-quality/detail?issue=…&page=&limit=` drills down;
`issue` ∈ `school_student_no_class` | `school_student_no_grade` |
`class_no_teacher` | `admin_no_profile`.

### `GET /admin/school-data-quality` — School Admin

```
data: {
  organizationId,
  counts: {
    studentsWithoutClass, studentsWithoutGrade,
    classesWithoutTeacher, classesWithoutGrade,
    studentsWithoutUser, oldPendingApprovals,
    failedImportBatches
  },
  totalWarnings,
  staleApprovalThresholdDays,
  recentFailedImports: [{ id, entityType, totalRows, succeeded, failed, createdAt }],
  notes: { soloLearners, adminAcademics, importGranularity }
}
```

A **Super Admin receives 400** here, pointing at the global endpoint: "my
school" has no meaning for a global account, and returning the whole platform
under a per-school shape would misrepresent it.

### Never flagged, because the data is correct

- **A Solo learner** with no organization, class or grade. The school endpoint
  filters on `organizationId = scope`, so a Solo learner cannot appear in it at
  all.
- **A School Admin's own missing grade or class.** No endpoint inspects an
  admin's academic fields.

---

## 7. System health — what is safe to show

`GET /admin/analytics/system-health` (Super Admin):

`api`, `database` (connected|unavailable), `databaseLatencyMs`,
`databaseVersion`, `appliedMigrations`, `latestMigration`,
`processUptimeSeconds`, `nodeVersion`, `memory.{heapUsedMb,heapTotalMb,rssMb}`,
plus the bounded request snapshot: `requests`, `errors4xx`, `errors5xx`,
`rateLimited`, `authFailures`, `errorRate`, `averageLatencyMs`, `p95LatencyMs`,
`buckets`, `coverage`.

**Deliberately absent:** the connection string, database host or user, any
credential, request headers, tokens, an environment dump, raw SQL. A test
asserts the response contains none of the local secrets.

`authFailures` counts 401/403 on the authentication and admin surfaces only. A
429 is throttling and is reported by `rateLimited` — the two do not overlap.

Request metrics are bounded in memory: ≤180 minute buckets, ≤512 latency samples
each. No database row per request, no request bodies, no header capture.

---

## 8. Impersonation

`POST /admin/impersonation` (also `POST /admin/students/:studentId/impersonate`
and `POST /admin/impersonate-student/:studentId`, same handler).

A Super Admin may impersonate any student; a School Admin only a student in
their own organization, enforced server-side. The response is a short-lived,
single-use code, stored only as a SHA-256 hash with a 90-second TTL, recording
the acting admin and the target for audit. `POST /users/impersonation/exchange`
redeems it in the mobile client.

**No JWT and no refresh token ever appears in a URL.** Do not add one.

---

## 9. Navigation the frontend should derive from scope

Hiding these is UX; the server refuses them regardless.

**School Admin must not be offered:** any `/admin/analytics/*` page, global data
quality, system health, email activity, organization analytics, admin
management, app version, or organization create/rename/delete.

**School Admin should be offered:** dashboard, students, teachers, parents,
grades, classes, scores, history, imports, import history, and school warnings
(`/admin/school-data-quality`).
