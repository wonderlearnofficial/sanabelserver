# Error Log Task List

Generated: 2026-08-15
Sources: `server/logs/error.log` and `server/logs/combined.log`

> The local logs are historical and currently stop at 2026-08-10 18:59 UTC.
> Items dated in July must be reproduced before they are treated as active
> production bugs. Counts can include both the controller error and its matching
> HTTP 500 response.

## Snapshot

- `error.log`: 30,924 bytes
- `combined.log`: 14,034,701 bytes
- Most recent confirmed failure: `SequelizeConnectionRefusedError`
- Error types found:
  - 25 `SequelizeConnectionRefusedError`
  - 23 `SequelizeDatabaseError`
  - 12 `SequelizeAssociationError`
  - 8 `SequelizeForeignKeyConstraintError`
  - 3 `SequelizeUniqueConstraintError`
  - 1 `SequelizeAccessDeniedError`

## Fix pass status — 2026-08-15

- Implemented database-gated startup, `/health/live`, `/health/ready`, and
  migrations-only production startup. Live database/deployment verification is
  still required for ERR-001 through ERR-003.
- Standardized direct user/organization associations and verified model
  initialization is idempotent. Live endpoint smoke tests remain for ERR-005.
- Added strict relationship-ID validation and transactions to admin student/user
  updates. Production-like integration coverage remains for ERR-004 and ERR-006.
- Hardened OTP delivery failures and parent connection validation. Successful
  provider/database integration tests remain for ERR-009 and ERR-010.
- Completed the local implementation and automated checks for ERR-007,
  ERR-008, and ERR-011.

## P0 — Do First

### [ ] ERR-001 — Restore and verify database connectivity

**Evidence:** Six connection-refused failures were logged on 2026-08-10 between
18:45 and 18:59 UTC; 25 exist across the full log. The server printed that it
was running even when the database connection failed.

**Work:**

- Verify the deployed database host, port, username, password, TLS settings,
  firewall rules, and database service health.
- Make application readiness depend on a successful database connection.
- Ensure startup exits or reports an unhealthy readiness status if the database
  cannot be reached.

**Done when:** Ten consecutive restarts connect successfully, protected API
requests work, and no connection-refused error is logged.

**Likely area:** `server/src/config/db_connection.ts`, server startup, deployment
environment variables.

### [ ] ERR-002 — Obtain current deployment logs

**Evidence:** Local logs stop on 2026-08-10, five days before this report, so
they cannot confirm the current production state.

**Work:**

- Confirm where production stdout/stderr and application logs are retained.
- Download or connect the latest deployment logs.
- Re-run this checklist against at least the latest 24 hours of traffic.

**Done when:** The team can search current logs by timestamp, endpoint, status,
and deployment version.

## P1 — High Priority Regression Checks

### [ ] ERR-003 — Verify startup migrations against a production-like schema

**Evidence:** Ten historical schema-sync failures attempted `ALTER TABLE` on
`Parents`, `Teachers`, and `Users`. One grade seed/migration also failed.

**Current-code note:** The code now avoids `sync({ alter: true })` and includes
foreign-key cleanup migrations, so this may already be fixed.

**Work:**

- Start the current server against a copy of the production schema.
- Run all pending migrations explicitly.
- Confirm normal application startup performs no automatic `ALTER TABLE`.
- Confirm grade and tree seed routines are idempotent.

**Done when:** Two consecutive deployments make no schema changes after the
first migration run and all startup seed operations succeed.

**Likely area:** `server/src/config/db_connection.ts`,
`server/database/migrations/`.

### [ ] ERR-004 — Regression-test admin student/user relationship updates

**Evidence:** Six updates to `/admin/users/54` failed because `classId=0`
violated `students_ibfk_10`. Other historical updates failed on invalid foreign
keys.

**Current-code note:** Current handlers convert empty class/organization values
to `null` and validate referenced records, but automated coverage is missing.

**Work:**

- Test `classId` and `organizationId` values of `null`, `""`, `0`, missing,
  valid, nonexistent, and belonging to a different organization.
- Return `400` for invalid relationships instead of leaking a database `500`.
- Apply user and role-specific updates in one transaction so partial updates
  cannot remain after a failure.

**Done when:** Every case has an integration test and no foreign-key failure is
produced by either admin update endpoint.

**Likely area:** `server/src/controllers/adminController.ts` (`updateStudent`,
`updateUser`).

### [ ] ERR-005 — Smoke-test teacher and grade admin lists after migrations

**Evidence:** Five `listTeachers` failures and four `listGrades` failures were
logged. Historical SQL referenced associations/columns that did not match the
database schema.

**Current-code note:** The teacher query now uses the `Classes` association and
the grade query uses the `Organization` association, so reproduce before making
additional changes.

**Work:**

- Test `/admin/teachers?page=1&limit=25` with empty and populated data.
- Test `/admin/grades?limit=1000` with global and organization grades.
- Run the same tests against a freshly migrated database and a production-like
  database copy.

**Done when:** Both endpoints return `200` with correct totals and associations
in both database states.

### [ ] ERR-006 — Lock in correct validation responses for duplicates

**Evidence:** Historical duplicate grade and user-email writes became `500`
responses through `SequelizeUniqueConstraintError`. Invalid grade organization
IDs became foreign-key `500` responses.

**Current-code note:** Current handlers appear to return `409` for duplicates
and `400` for missing related records. This task is primarily regression
coverage.

**Work:**

- Add tests for duplicate user email, duplicate grade name within one school,
  and invalid organization ID.
- Verify the API returns `409`, `409`, and `400` respectively.
- Verify the admin UI displays the API message and does not retry repeatedly.

**Done when:** Constraint errors are predictable client errors and do not enter
`error.log` as server failures.

## P2 — Reliability and Observability

### [x] ERR-007 — Improve error serialization and request tracing

**Evidence:** Several entries contain `"error": {}` and therefore omit the
actual message and stack. Matching controller and HTTP entries cannot be tied
together reliably.

**Work:**

- Serialize `Error` fields explicitly: name, message, stack, code, SQL state,
  and safe query metadata.
- Add a request/correlation ID to request, controller, and response logs.
- Redact passwords, tokens, OTPs, email credentials, and database secrets.

**Done when:** A test exception produces one searchable trace with a useful
stack and no secrets.

**Likely area:** `server/src/config/logger.ts` and request logging middleware.

### [x] ERR-008 — Add log rotation and stop tracking runtime logs

**Evidence:** `combined.log` is already about 14 MB, logger file transports have
no rotation/retention policy, and `/logs` is not ignored by Git.

**Work:**

- Rotate files by size or date and define retention/compression limits.
- Add `/logs/` to `server/.gitignore`.
- Remove tracked runtime log files from the Git index without deleting the
  developer's local files.
- Prefer deployment stdout or a centralized logging service in production.

**Done when:** Logs cannot grow without limit and routine server execution does
not dirty the Git worktree.

### [ ] ERR-009 — Diagnose registration OTP 500 responses

**Evidence:** Seven `POST /users/send-auth` requests returned `500` on
2026-07-01. The retained entries do not expose a useful root cause.

**Work:**

- Test successful OTP creation and email delivery.
- Test database failure, mail-provider timeout, rejected credentials, and rate
  limiting separately.
- Return a safe, specific status and log the provider error with a request ID.

**Done when:** OTP integration tests pass and each failure mode is diagnosable
without exposing the OTP or credentials.

### [ ] ERR-010 — Verify parent connection and pending-request flows

**Evidence:** `/parents/connect-student-to-parent` and
`/parents/pendingRequests` each produced a historical `500`, with one error
serialized as an empty object.

**Work:**

- Test valid, invalid, expired, already-connected, and cross-organization
  connection requests.
- Test pending requests for parents with zero, one, and multiple students.

**Done when:** Expected invalid states return `4xx`, valid states return `2xx`,
and unexpected failures include traceable logs.

### [x] ERR-011 — Configure or deliberately disable push notifications

**Evidence:** Every latest server start warns that VAPID keys are missing, so
web push cannot work.

**Work:**

- Configure VAPID public/private keys in environments where push is enabled, or
  explicitly disable push initialization where it is not used.
- Add a startup configuration check that clearly reports the chosen mode.

**Done when:** Startup has no ambiguous VAPID warning and the selected push mode
is covered by a smoke test.

## Closeout

### [ ] ERR-012 — Establish a clean error baseline

- Complete or explicitly defer ERR-001 through ERR-011.
- Archive the historical July/August logs.
- Run the primary student, teacher, parent, and admin flows.
- Observe current logs for 24 hours.
- Record any new unique error as a new task with timestamp, endpoint, deployment
  commit, reproduction steps, owner, and acceptance criteria.
