# Supabase registration rollout

The production GitHub repository currently deploys `application-source.tar`: its Dockerfile extracts the archive before building. The local development checkout contains the extracted `app`, `server`, `public`, `scripts`, and `tests` directories. Regenerate the archive from the reviewed source for each browser upload and upload matching package.json and package-lock.json. Never put environment secrets or customer data in the archive.

Railway Free/Trial/Hobby blocks outbound SMTP. Configure `BREVO_API_KEY` and a verified `MAIL_FROM` there to send legacy/owner password recovery over HTTPS. Supabase uses the separately configured Brevo SMTP key for its own authentication emails. A successful Supabase email does not prove Railway delivery; test both paths.

## Required configuration

- `SUPABASE_URL`: project API origin.
- `SUPABASE_PUBLISHABLE_KEY`: publishable key only; no service-role key is required.
- `SUPABASE_AUTH_ENABLED=false` until the checks below are complete.
- `APP_ORIGIN=https://alkunt-app-production.up.railway.app`.
- Supabase Site URL: `https://alkunt-app-production.up.railway.app`.
- Supabase Redirect URL: `https://alkunt-app-production.up.railway.app/auth/confirm` (exact URL).
- Supabase Email provider enabled, email confirmations required, custom SMTP configured and tested using a mailbox controlled by the owner.

The default confirmation template works through its standard confirmation URL and the fragment callback. Custom SMTP templates may also use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. Editing templates is not required.

## Compatibility and security

- Existing SQLite accounts and their IDs/password hashes/sessions/grants are preserved. The owner always uses local authentication.
- A verified Supabase user never takes over an existing local account merely by matching its email. An explicit, separately authenticated account-linking process would be required for that migration.
- New remote accounts are materialized locally only after server-side verification with Supabase, including an `email_confirmed_at` check.
- Local profiles and an owner notification are created atomically. Repeated confirmations do not duplicate the notification. New users are always customers regardless of user metadata.
- A linked account requires remote authentication; it cannot use its randomly generated local placeholder password. Remote-authenticated local sessions last at most one hour, with no remote refresh tokens stored in the browser or SQLite.
- No new Postgres tables, public RLS policies, paid services, or additional access keys are introduced.
- Confirmation tokens are removed from the browser address and are never used as local account identifiers.

## Tests and rollout

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:http`.
Deploy first with the feature flag false and verify the old login and deployment health. Only after SMTP and redirect checks should the flag be switched to true. Complete a real registration with a controlled, unused email, follow the confirmation link, and verify the customer profile, in-app owner notification, and push delivery record. Provider-side SMTP and delivery cannot be replaced by mock unit tests.

Rollback: set the feature flag false to stop Supabase operations; do not drop the `supabase_accounts` mapping or reset SQLite data. Legacy logins remain available. Already-linked users need the provider re-enabled to sign in again.

## Account recovery, passwords and audience notifications

- Every local account, including the owner, can request a 30-minute one-time password reset email. Reset tokens are hashed in SQLite; successful resets revoke existing local sessions. Accounts linked to Supabase use its recovery flow.
- Local-account recovery requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and MAIL_FROM (or SMTP_FROM); RESEND_API_KEY plus MAIL_FROM is an alternative. Configure these privately in Railway, not Git or chat. Configuring SMTP inside Supabase alone does not configure application mail for legacy accounts.
- Supabase also needs the exact recovery redirect URL: https://alkunt-app-production.up.railway.app/auth/recovery. No paid plan is required by the code.
- The account page lets the owner and each customer change their password after supplying the current password. Previous local sessions are revoked while the current browser receives a new session. Purchases and roles are unchanged.
- The phone account view embeds email/password sign-in, registration and recovery; the obsolete ChatGPT sign-in label is removed.
- Published content in every catalog type produces one public announcement. Draft/scheduled-unpublished/archived content is not exposed. Scheduled publications are announced on the next platform request after becoming public. The owner and customers receive private message acknowledgments/replies in their accounts.
- Browser/device push is opt-in. Visitors and signed-in users can subscribe through the notifications panel. VAPID variables and a supported secure browser are required. Permission cannot be granted on behalf of visitors. Private message content is never broadcast to guests.
- Tests cover owner/customer recovery, token expiry/reuse, session revocation, preserved grants, current-password verification, generic recovery responses, publication/duplicate rules, device ownership, guest visibility and private replies. SMTP delivery and browser push acceptance require separately configured external services and user consent; unit tests do not claim real delivery.
