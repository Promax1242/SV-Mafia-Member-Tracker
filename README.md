# SV | Mafia Member Tracker

The original purple-and-black `index.html` UI is preserved. `portal.js` connects its forms to the Supabase `portal` Edge Function. Only the project URL and publishable key are public.

## Accounts

- Request PIR approval on the login page, then contact Leadership through a Discord PIR ticket.
- Leadership verifies Discord ownership, approves the request, and issues a one-time 24-hour code. Codes are displayed once; only their SHA-256 hashes are stored.
- Use **Set Up Account** with the approved Discord ID, code, and a 12–128 character password. This screen also redeems password reset codes.
- No Discord OAuth, bot token, SMTP provider, or paid service is required. Identity verification happens through the private PIR ticket.
- Leadership can manage members and operations, but cannot grant Leadership, manage Leadership accounts, administer roles, or publish announcements.
- Only the Developer can grant/revoke Leadership, manage their accounts/reset codes, administer roles, publish announcements, and read staff audit logs/weekly reports.
- Developer access is constrained to Discord ID `772822130236719136`, bound to an Auth UUID through an out-of-band, one-time provisioning code. Knowing the Discord ID does not grant access.
- Display roles such as Owner, Manager, and Director do not grant administrative access. Only the protected database access field does.

## Security and persistence

All application tables are in the unexposed `sv_private` schema, have RLS enabled, and grant no direct access to anonymous or authenticated clients. The public service RPC is callable only by the server's service role. The Edge Function verifies the Supabase Auth user before passing identity and session ID to the RPC; the database checks that the session still exists and that the account is active and not blacklisted or awaiting a password reset.

The internal security-definer function has a fixed empty search path and no public EXECUTE grant. It exists to enforce atomic authorization and changes across private tables. It cannot be called by browser sessions. Changes use compare-before-write in one transaction, avoiding silent overwrites from other devices. Staff identity in warnings/LOAs and audit logs is server-derived. Audit records cannot be changed through the portal.

An Auth trigger prevents direct unapproved signups and email-identity changes. Provisioning is bound to an unpredictable UUID created while claiming the code. Account creation failure releases the claim; interrupted claims deliberately fail closed and require administrator recovery. Reset codes revoke old sessions immediately. Sessions remain in browser session storage until sign-out or tab closure. Sign-out revokes the Auth session.

Member responses are visible to the member and authorized staff. Warning/LOA details, blacklists, requests, and announcements are filtered on the server. Scrim and VPL attendance both persist. Weekly CSV reports contain the latest shared records and at most the latest 5,000 audit entries; exports neutralize spreadsheet formulas. Reports are downloaded on demand, not emailed or scheduled automatically.

Public login, activation, and PIR request routes have database-backed request limits. No service-role key, administrator password, or activation code is stored in this repository. The service key is the Supabase-managed Edge runtime environment variable.

## Deployment

The project is `ygjcobdkxzroohccifvz` in the free-plan organization **SV Mafia Member Tracker**, Frankfurt (`eu-central-1`). Apply `supabase/schema.sql` only to an empty project. The live project's schema is managed through reviewed migrations; the schema file is a consolidated snapshot, not an incremental migration.

The Edge Function source is in `supabase/functions/portal/index.ts`, with its npm dependency pinned. Redeploy it through Supabase project administration; changing the repository alone does not deploy Edge Functions. GitHub Pages publishes only `index.html` and `portal.js` via `.github/workflows/pages.yml`. GitHub may require a repository administrator to enable Pages with **GitHub Actions** as source the first time.

## Validation

`tests/live-integration.py` exercises the real deployed backend with disposable, pre-approved accounts supplied through a private `SV_TEST_FIXTURES` JSON file. It never commits or prints credentials. Run against an isolated project or disposable fixtures prepared by an administrator, then remove test records and revoke test sessions. Do not rerun the provisioning tests against active user accounts.
