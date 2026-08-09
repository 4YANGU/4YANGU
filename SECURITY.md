# StoYangu security notes

## Controls already implemented
- Every private API verifies the Supabase access token server-side.
- Founder-only routes verify the `founder` database role.
- Owner product operations verify that the product belongs to the owner's assigned store.
- Service-role credentials are server-only and never referenced by browser code.
- Supabase Row Level Security limits direct client reads.
- Uploaded images are size-limited, MIME-limited and validated by binary file signatures. SVG/HTML uploads are rejected.
- Design JSON never uses `dangerouslySetInnerHTML`, never executes scripts and sanitizes URLs/CSS values.
- Public forms and analytics endpoints are rate-limited using hashed IP identifiers.
- Daily cron routes require `CRON_SECRET`.
- Push subscriptions are tied to authenticated users and store IDs.
- Product photo count is checked by both UI and API.
- Security headers disable MIME sniffing and unnecessary browser capabilities.
- The downloadable archive excludes `.env`, the live `vercel.json`, `.vercel`, database credentials and build caches.

## Owner responsibilities
- Keep the GitHub repository private.
- Never paste `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY` or `CRON_SECRET` into source files or screenshots.
- Enable two-factor authentication on GitHub, Vercel, Supabase and the domain registrar.
- Give each person their own account; do not share the founder password.
- Remove staff access immediately when they leave.
- Review Supabase Auth users, Vercel team members and GitHub collaborators monthly.
- Turn on Supabase backups before storing real business data.
- Rotate all secrets immediately if a private repository or dashboard is accidentally made public.
- Keep dependencies updated and review Dependabot alerts.

No internet application can honestly be guaranteed impossible to attack. These controls substantially reduce risk, but ongoing updates, backups, access reviews and secret hygiene remain required....
