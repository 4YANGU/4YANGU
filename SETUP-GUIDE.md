# StoYangu ownership and launch guide for a non-technical owner

This package is a clean copy of the complete application. It intentionally contains **no live passwords or secret keys**. Follow the steps in order. Do not hire anyone who asks you to send them your service-role key or account password over WhatsApp.

## What you need
1. A GitHub account, which stores your code.
2. A Supabase account, which stores users, shops, products, statistics and photos.
3. A Vercel account, which runs the website and API.
4. A domain from a registrar such as Namecheap, Cloudflare or Truehost.
5. A bank card for paid plans when the free plans are no longer enough.

Use one business email address that you control for all four accounts. Turn on two-factor authentication everywhere.

---

## Part 1: Download this app

1. Log in as the StoYangu founder.
2. On the Founder Dashboard, press **Download source** at the top. There is also a **Download app** item in the left menu.
3. Your browser downloads `stoyangu-source.zip`.
4. Open your Downloads folder and extract/unzip it.
5. You should see folders named `src`, `api`, `public`, `supabase`, plus `package.json` and this guide.

The package excludes all live secrets. That is intentional and protects you.

---

## Part 2: Put the code in your own private GitHub repository

### Easiest browser method
1. Sign in to GitHub.
2. Press the **+** button and choose **New repository**.
3. Name it `stoyangu`.
4. Select **Private**. Never make the real business repository public.
5. Do not add a README or template. Create the repository.
6. Press **uploading an existing file**.
7. Open the unzipped package on your computer, select everything inside it, and drag it into the GitHub upload page.
8. Wait for every file to finish. Add the message `Initial StoYangu app` and press **Commit changes**.

If the browser refuses a folder, install GitHub Desktop, choose **Add existing repository**, select the unzipped folder, then Publish Repository with **Keep this code private** checked.

Never upload `.env`, a Supabase service-role key, VAPID private key or cron secret.

---

## Part 3: Create your own Supabase project

1. Sign in to Supabase and press **New project**.
2. Choose your organization, a nearby region, a strong database password, and create the project.
3. Save that database password in a password manager.
4. Open **SQL Editor**, press **New query**.
5. In the downloaded package open `supabase/setup.sql` with any text editor.
6. Copy everything, paste it into Supabase SQL Editor and press **Run**. It creates all tables, indexes, security policies and the photo bucket.
7. Open **Authentication → Users → Add user → Create new user**.
8. Add your founder email and a strong unique password. Turn on auto-confirm if shown.
9. Open that user and copy the long **User UID**.
10. Return to SQL Editor and run this after replacing all three capitalized values:

```sql
insert into public.profiles(user_id,email,full_name,role,store_id)
values ('PASTE-USER-UID','YOUR-EMAIL','YOUR-NAME','founder',null);
```

11. Open **Project Settings → API**. Keep this page open. You need:
   - Project URL
   - Publishable/anon key
   - Secret service-role key

The service-role key is as powerful as the database owner. Never put it in GitHub or browser code.

### Moving existing StoYangu data
The source zip contains code, not private customer data. To move current real data, use Supabase table export/backups and Storage downloads. Import in this order: stores, products, product_images, profiles, then operational tables. Auth users need a supported Supabase Auth migration. For a real migration with live customers, use a trusted Supabase specialist under a written confidentiality agreement and rotate credentials when they finish.

---

## Part 4: Generate notification keys

GitHub can provide a temporary browser terminal:
1. In your private repository press **Code → Codespaces → Create codespace**.
2. Wait for it to open.
3. In the terminal at the bottom run:

```bash
npm install
npx web-push generate-vapid-keys
```

4. It prints a public key and private key. Save both in your password manager. Do not commit them.
5. Create another random secret at least 32 characters long in your password manager. Call it `CRON_SECRET`.

---

## Part 5: Deploy through your own Vercel account

1. Sign in to Vercel using GitHub.
2. Press **Add New → Project** and import your private `stoyangu` repository.
3. Framework should be **Vite**. Build command is `npm run build`; output directory is `dist`.
4. Open the Vercel **Integrations** marketplace and add the official Supabase integration.
5. Choose your Supabase organization and connect your new Supabase project to this Vercel project.
6. The integration automatically fills the Supabase URL, publishable key and server key. Do not copy those values into `vercel.json` and do not create duplicate Supabase variables manually.
7. Press **Deploy**. If the project was already deployed before linking Supabase, press **Redeploy** once.
8. After deployment, open the temporary Vercel address and log in with the founder account you created.

The downloadable `vercel.json` contains routes, security headers and schedules only. It contains no environment values, so it cannot override the Vercel and Supabase connection.

Push notifications need four separate one-time secrets because Supabase cannot create web-push keys automatically. Add only `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `CRON_SECRET` in Vercel after the main website and login are working. These are notification settings, not Supabase connection settings.

Vercel reads the cron schedule from `vercel.json`: daily review generation is 7:00 PM Nairobi time, and confirmed notifications send at 7:30 PM Nairobi time.

If Vercel says your plan does not support the configured cron frequency, upgrade to the lowest plan that supports both daily jobs.

---

## Part 6: Connect your own domain and store subdomains

The app needs the main domain plus wildcard subdomains such as `lily.yourdomain.com`.

1. In Vercel open your project → **Settings → Domains**.
2. Add `yourdomain.com` and `www.yourdomain.com`.
3. Also add `*.yourdomain.com` as a wildcard domain.
4. Vercel will show DNS instructions. The easiest reliable wildcard setup is to change the domain's nameservers to the Vercel nameservers shown there.
5. In your registrar dashboard replace the old nameservers with Vercel's exact values.
6. DNS can take a few minutes or up to 48 hours.
7. The app detects normal custom domains and store subdomains automatically. No domain value is required inside `vercel.json`.
8. Redeploy once after Vercel confirms all domain records.

Do not manually create one DNS record for every shop. The wildcard handles all store slugs automatically.

---

## Part 7: Google Search Console and AI discovery

The app already provides crawlable page titles, descriptions, canonical links, Open Graph data, product and store JSON-LD, `robots.txt`, `sitemap.xml`, `llms.txt` and `ai.txt`. Public crawlers are allowed; private dashboards are blocked.

No website can force Google or an AI company to index every page. These steps give every public page the strongest legitimate opportunity to be found. Avoid anyone selling “guaranteed AI indexing” or hidden keyword tricks because those can damage your ranking.

1. Open Google Search Console and choose **Add property**.
2. Choose **Domain**, not URL prefix. Enter only `yourdomain.com`.
3. Google gives you a DNS TXT record. Add that TXT record at the company controlling your DNS, then press **Verify**.
4. In Search Console open **Sitemaps** and submit `https://yourdomain.com/sitemap.xml`.
5. Open **URL inspection**. Inspect the homepage and one real store subdomain. Press **Request indexing** for each important new page.
6. Repeat URL inspection after major content or domain changes. You do not need to request every product edit.
7. Check **Page indexing**, **HTTPS**, **Core Web Vitals** and **Enhancements** weekly during the first two months.
8. Test the homepage and a store in Google Rich Results Test. The app publishes `OnlineStore`, `Product`, `ItemList`, `Organization`, `WebSite`, `Service` and `Offer` structured data.
9. Create a Bing Webmaster Tools account, import the verified Search Console property and submit the same sitemap. Some AI search systems use Bing's index.
10. Create and fully complete a Google Business Profile for StoYangu if you have a real customer-facing location. Use the same business name, phone, domain and address everywhere.
11. Ask each store owner to link their store from Instagram, TikTok, Facebook, WhatsApp Business, Linktree and any public business profile. Real relevant links help discovery.
12. Give every store unique public wording. Include the real business name, product categories, Nairobi area served, pickup location, delivery area and contact details in its design JSON. Do not copy identical text across hundreds of stores.
13. Use accurate product names and clear original photos. Do not add hidden keywords, fake reviews or text written only for crawlers.
14. Keep active stores online. Search engines gradually remove pages that repeatedly return errors or remain offline.
15. Review Search Console monthly for manual actions, security warnings and pages that are discovered but not indexed.

AI discovery files help compliant crawlers understand the business, but AI answers are controlled by each external provider. Strong public content, structured data, a healthy search index, trusted mentions and consistent business details are the reliable long-term approach.

---

## Part 8: First live test

1. Log in as founder.
2. Create one test store and owner login.
3. Log in as that owner on an Android phone using Chrome.
4. From Manage My Store, press the store link shown under the store name.
5. Chrome should show its native StoYangu installation prompt before opening the storefront. Accept installation and notifications.
6. Confirm the welcome notification arrives.
7. Return to founder dashboard and check that store says **App + alerts ready**.
8. Add a product with seven photos, edit it, open its storefront and test WhatsApp ordering.
9. At 7 PM, review the combined daily messages. Confirm before 7:30 PM and verify they do not send immediately.
10. At 7:30 PM, verify each owner receives only their store's message.
11. Test a custom notification to one store, then to all installed owners.

Push notifications require HTTPS, valid VAPID keys, permission from the owner, and an installed/supported browser. iPhone installation must be done through Safari's Add to Home Screen flow; browser rules do not allow a website to silently grant notification permission.

---

## Part 9: Backups and safe operation

- Keep GitHub private and enable Dependabot.
- Turn on Supabase automated backups before onboarding real businesses.
- Export applications, stores and products monthly as an extra copy.
- Review GitHub collaborators, Vercel team members, Supabase team members and Auth users monthly.
- Give every staff member their own login. Never share the founder password.
- Use Vercel and Supabase logs when something fails.
- Test changes on a preview deployment before putting them into production.
- Read `SECURITY.md` before giving a developer access.

## What belongs to you after these steps
- Code: your private GitHub repository.
- Database and users: your Supabase organization.
- Website and server functions: your Vercel project.
- Domain and DNS: your registrar account.
- Product images: your Supabase Storage bucket.
- Notification keys: your password manager and Vercel environment variables.

That setup means no previous developer controls your business infrastructure. You can remove any collaborator without losing the app.
