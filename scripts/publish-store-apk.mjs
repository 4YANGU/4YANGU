import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const storeId = Number(process.env.STORE_ID);
const slug = String(process.env.STORE_SLUG || '').replace(/[^a-z0-9-]/gi, '').slice(0, 64);
if (!Number.isSafeInteger(storeId) || storeId < 1 || !slug) throw new Error('Store inputs are missing.');
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const failed = process.argv.includes('--failed');
if (failed) {
  const { error } = await client.from('store_apks').update({ status: 'failed', error: 'The Android build failed. Check the GitHub Actions job log, then tap Build app again.', updated_at: new Date().toISOString() }).eq('store_id', storeId);
  if (error) throw error;
  console.log(`Marked store ${storeId} build as failed.`);
} else {
  const apk = 'android/app/build/outputs/apk/release/app-release.apk';
  const contents = await fs.readFile(apk);
  const path = `stores/${storeId}/${slug}/stoyangu-${slug}-${process.env.GITHUB_RUN_NUMBER}.apk`;
  const { error: uploadError } = await client.storage.from('store-apks').upload(path, contents, { contentType: 'application/vnd.android.package-archive', upsert: true, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data: url } = client.storage.from('store-apks').getPublicUrl(path);
  const { error: saveError } = await client.from('store_apks').update({ status: 'ready', apk_url: url.publicUrl, error: null, version_code: Number(process.env.GITHUB_RUN_NUMBER), updated_at: new Date().toISOString() }).eq('store_id', storeId);
  if (saveError) throw saveError;
  console.log(`Uploaded signed StoYangu APK for store ${storeId}.`);
}
