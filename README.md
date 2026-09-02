# Sanabel server

Express + TypeScript API backed by Sequelize and MySQL/MariaDB. The repository-wide
architecture, roles, security boundaries, and gameplay model are documented in
[`../SANABEL_ROLE_USER_CASE_REFERENCE.md`](../SANABEL_ROLE_USER_CASE_REFERENCE.md).

## Setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

`.env.example` is the authoritative list of server environment variable names.
Keep real database, JWT/refresh, email, admin bootstrap, and VAPID values out of
documentation and version control.

## Commands

```powershell
npm run build
npm test
npm run migrate
```

`npm test` builds before running the Node test suite. The real database Solo User
gameplay integration tests are opt-in:

```powershell
$env:RUN_GAMEPLAY_INTEGRATION = 'true'
npm test
```

The Super Admin analytics integration tests are opt-in as well, and refuse to run
against anything but a loopback database:

```powershell
$env:RUN_ANALYTICS_INTEGRATION = 'true'
npm test
```

Production `npm start` runs migrations and then starts `dist/index.js`. Use
`sequelize-cli` migrations for schema evolution. `DB_SYNC_ON_STARTUP` only controls
non-altering startup sync and should normally be disabled in production.

## Administrator bootstrap

`seedAdmin` runs on every application start, so it is written to be safe against
live data. It creates a missing administrator account, but **never modifies an
existing one** — not the password, role, organization scope, or access flags. A
missing account is created only when its password is supplied through an
environment variable, or when the database holds no administrator at all.

To reset a managed administrator password deliberately, set that account's
password variable and `ADMIN_SEED_FORCE_RESET=true` for a single start, then
remove the flag. The reset also invalidates that account's outstanding tokens.
Passwords are never logged.

## Database

Current deployed state, admin scope rules, the analytics API, and the
normalization roadmap are documented in
[`../docs/DATABASE_V2_DESIGN.md`](../docs/DATABASE_V2_DESIGN.md) — section 0 is
the current production truth.
