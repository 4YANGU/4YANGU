# StoYangu per-store Android APK — plain-English setup

This archive adds **source code and automation**, not an already-built APK. The first APK is produced in your GitHub Actions after the setup below. Every store gets the same app named **StoYangu**; its icon and launch splash use that store's uploaded logo. Each store uses a different Android package based on its permanent store ID. All stores use the **same signing key**. The APK opens your hosted Vercel site, so web updates appear after Vercel deploys them without reinstalling the APK. To update the baked-in logo, splash or native sharing code, tap **Build app** again and install the newly signed APK.

## Do these steps in order

### 1. Add the files to GitHub

1. Open your GitHub repository `4YANGU/4YANGU` and extract this ZIP into the repository's top level, replacing matching files. Keep the hidden `.github/workflows/build-store-apk.yml` folder: it contains the build automation.
2. Commit and push every changed file to the repository's default branch. Make sure `package.json`, `package-lock.json`, `capacitor.config.ts`, `scripts/`, `android-native/`, `api/store-apk.js`, and `.github/workflows/build-store-apk.yml` appear on GitHub. Do **not** upload `node_modules`, `.env`, a signing key or passwords.
3. On GitHub, open **Actions**. If a green **I understand my workflows, go ahead and enable them** button appears, click it. In **Settings → Actions → General**, allow GitHub Actions to run for this repository.

### 2. Add the database table and APK bucket

1. Open the Supabase project used by your **live** StoYangu site. Click **SQL Editor → New query**.
2. Open `supabase/migrations/202609280017_app001.sql` from this ZIP, copy all its text into SQL Editor, and click **Run**. This creates `store_apks` and the public Storage bucket `store-apks`. It does not change owners, passwords, orders or products.
3. In **Table Editor**, confirm `store_apks` exists. In **Storage**, confirm `store-apks` exists. Do not upload the APK yourself: GitHub Actions will upload it after building.
4. If an earlier update was not installed, first run the older migration files documented in `WOYOYO-016-INSTALL.txt` from your previous ZIP.

### 3. Create and safely store ONE Android signing key

1. Install a JDK that includes `keytool` (for example, JDK 17). Open Terminal (Mac/Linux), Command Prompt or PowerShell (Windows).
2. In a private folder on your computer, run exactly: `keytool -genkeypair -keystore stoyangu-release.jks -alias stoyangu -keyalg RSA -keysize 3072 -validity 10000`.
3. When prompted, create a long password and save it in your password manager. When prompted for the key password, press Enter to use the same password. Complete the name prompts. Keep `stoyangu-release.jks` and the password forever: you need **the same key** to update installed APKs. Never put the `.jks` file in GitHub.
4. Convert the file to one line of Base64 text. Mac: run `base64 -i stoyangu-release.jks | tr -d '\n'`. Linux: run `base64 -w 0 stoyangu-release.jks`. Windows PowerShell: run `[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path './stoyangu-release.jks')))`. Copy the entire output, without adding spaces.

### 4. Set GitHub Actions secrets

1. In GitHub open **4YANGU/4YANGU → Settings → Secrets and variables → Actions → New repository secret**. Add each **name exactly** as written below, pasting the corresponding value, then click **Add secret**. Repeat for each row. Secrets never go into a source file.

| Secret name to type | Value to paste |
| --- | --- |
| `APK_KEYSTORE_BASE64` | The complete one-line Base64 output from step 3. |
| `APK_KEY_ALIAS` | `stoyangu` |
| `APK_KEYSTORE_PASSWORD` | Your keystore password from step 3. |
| `APK_KEY_PASSWORD` | The same password, because you pressed Enter to reuse it. |
| `STOYANGU_LIVE_URL` | The exact **HTTPS origin** of your live Vercel site, e.g. `https://YOUR-LIVE-DOMAIN.vercel.app` (no `/owner` and no trailing slash). Find it under **Vercel → your live project → Settings → Domains**. Do not paste this example; paste your actual domain. |
| `SUPABASE_URL` | From your live Supabase project: **Project Settings → API → Project URL**. This must be the same project your live Vercel site uses. |
| `SUPABASE_SERVICE_ROLE_KEY` | From that same Supabase project: **Project Settings → API Keys → service_role (secret)**. Copy the secret key, **not** the anon/publishable key. This must stay in GitHub Actions secrets, never in frontend files. |

2. If your Supabase dashboard calls the privileged key `sb_secret_...` instead of `service_role`, use that secret key. Confirm it belongs to the same project as `SUPABASE_URL`.

### 5. Let your Vercel site request GitHub builds

1. On GitHub open **Settings (your account, top-right) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Select yourself as resource owner, allow only repository `4YANGU/4YANGU`, and under **Repository permissions** set **Actions: Read and write** and **Contents: Read-only**. Generate the token and copy it once.
2. Open **Vercel → your live StoYangu project → Settings → Environment Variables → Add New**. Enter the exact name `STOYANGU_GITHUB_TOKEN`; paste the token as its value; select Production (and Preview if you also want preview builds); save. Never put it in `.env`, `vercel.json`, or the ZIP.
3. If your GitHub default branch is **not** `main`, add a second Vercel environment variable named `STOYANGU_GITHUB_REF` whose value is your actual default branch name (shown on the repo's branch dropdown). The workflow file must also exist on the default branch.
4. `STOYANGU_GITHUB_REPO` defaults to `4YANGU/4YANGU`. If you moved the repo, add that exact Vercel variable with `OWNER/REPO` as its value.
5. In Vercel click **Deployments →** open the latest deployment's **⋯ → Redeploy** so the new variables and code are live. Make sure your live site is deployed from this GitHub repository or set it to auto-deploy on pushes under **Project Settings → Git → Connected Git Repository**. Otherwise a GitHub push will not update the website inside installed APKs.

### 6. Make your first store APK

1. Log into the live site as the founder, open the client's **Manage store** page, and make sure the store has a real logo. If not, edit the store's details, upload a logo, and save.
2. At the top tap **Build app**. The download symbol becomes a looping circle while GitHub runs. If the build fails, the page shows an error and you can retry. On GitHub see **Actions → Build a store's signed StoYangu Android app** for the job log.
3. When the symbol changes to **Download APK**, tap it on an Android phone. Allow installation from your browser when Android asks, then install. Sign in with that store owner's account. The APK is saved in **Supabase Storage → store-apks**, and the dashboard serves that store's APK URL only after the signed build uploads successfully.
4. For another client, open **that client's** Manage store page, upload their logo, tap **Build app**, and repeat. All apps use the same signing key. To replace a store's icon, update the logo and tap Build app again; owners install the new APK to get the new baked-in icon/splash. Ordinary website changes require only a Vercel deployment.

## WhatsApp and important limits

In the Android APK, tapping Post uploads the seller's video, copies the complete caption to the clipboard, and sends Android's native **ACTION_SEND** intent directly to WhatsApp (or WhatsApp Business). The video and caption are supplied in the intent; WhatsApp decides how its send screen looks. The seller must still tap **My status** and confirm. WhatsApp may omit text on Status, so the caption is in the clipboard for paste. A website or Android intent cannot silently publish Status or guarantee that My status is preselected. Outside the Android APK, posting continues to open the normal phone share sheet.

The app uses your **live remote website**, not a bundled React copy. It needs an internet connection. A GitHub ZIP on its own does not update the site: commit/push it, let Vercel deploy, then reopen the installed app. Android binary changes (logo, splash or native plugin) require a new APK build and installation. Do not claim the APK was tested until the GitHub build has succeeded and you have opened it on an actual Android phone.
