# Put StoYangu live under your own accounts

Follow these steps in order. Do not put passwords or Supabase keys inside `vercel.json`.

## 1. Download and unzip
1. Log in as founder.
2. Press **Download source**.
3. Unzip `stoyangu-source.zip`.

## 2. Create your private GitHub repository
1. Create a GitHub account and turn on two-factor authentication.
2. Create a new repository called `stoyangu`.
3. Choose **Private**.
4. Upload everything inside the unzipped `stoyangu` folder.
5. Commit the upload.

## 3. Create Supabase
1. Create a new Supabase project.
2. Open **SQL Editor**.
3. Copy everything from `supabase/setup.sql`, paste it into SQL Editor and run it once.
4. Open **Authentication → Users** and create your founder email and password.
5. Copy the founder User UID.
6. Run the small founder-profile insert shown at the bottom of `supabase/setup.sql`, replacing the example UID, email and name.

## 4. Create Vercel and link Supabase automatically
1. Sign in to Vercel using GitHub.
2. Import your private `stoyangu` repository.
3. Leave the framework as Vite, build command as `npm run build`, and output folder as `dist`.
4. Open Vercel **Integrations** and install the official Supabase integration.
5. Select your Supabase organization and project, then connect it to the Vercel project.
6. The integration creates the Supabase environment settings automatically.
7. Do not add Supabase values to `vercel.json`. The included file deliberately has no environment section.
8. Deploy or redeploy once after connecting the integration.

## 5. Confirm login before doing anything else
1. Open the deployed site.
2. Log in with the founder email and password created in Supabase.
3. Confirm the Founder Dashboard shows stores, applications and analytics.
4. Create one test owner and store through the Founder Dashboard.
5. Log out, then log in with the test owner details.
6. Confirm Manage My Store loads products and analytics.

If login fails, first check that the Vercel Supabase integration is connected to the correct Vercel project and correct Supabase project. Do not solve it by pasting duplicate Supabase keys into `vercel.json`.

## 6. Add push notifications after login works
Supabase does not automatically generate web-push keys. Generate VAPID keys using the command in `SETUP-GUIDE.md`, then add only these four values in Vercel:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `CRON_SECRET`

Redeploy once. Test Chrome installation, the welcome notification, a custom notification and the 7:30 PM daily update.

## 7. Connect the domain
1. In Vercel, add the main domain and its `www` version.
2. Add the wildcard form `*.yourdomain.com` for seller storefronts.
3. Follow Vercel's DNS instructions exactly.
4. The app detects standard custom domains automatically. Do not add domain values to `vercel.json`.

## 8. Search Console
1. Add the domain in Google Search Console as a Domain property.
2. Verify it using Google's DNS TXT record.
3. Submit the `sitemap.xml` file.
4. Request indexing for the homepage and an example store.

Keep GitHub private, keep two-factor authentication enabled and never send the Supabase service-role key to a developer over chat.
