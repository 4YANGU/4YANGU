import { randomBytes } from 'node:crypto';
import supabase from '../lib/db-client.js';
import { BILLING_PERIOD_DAYS, billingPeriod, managementLocked } from '../lib/billing.js';

const PAYMENT_AMOUNT_KES = 200;
const STALE_REQUEST_MS = 5 * 60 * 1000;
const EARLY_PAYMENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

let cachedAccessToken = '';
let cachedAccessTokenUntil = 0;
let cachedTokenEnvironment = '';

function normalizeMpesaPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  return /^254[17]\d{8}$/.test(digits) ? digits : '';
}

function darajaEnvironment() {
  const value = String(process.env.DARAJA_ENV || 'sandbox').trim().toLowerCase();
  if (value !== 'sandbox' && value !== 'production') throw new Error('DARAJA_ENV must be sandbox or production.');
  return value;
}

function darajaBaseUrl(environment) {
  return environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

function getDarajaConfig() {
  const environment = darajaEnvironment();
  const consumerKey = String(process.env.DARAJA_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.DARAJA_CONSUMER_SECRET || '').trim();
  const shortcode = String(process.env.DARAJA_SHORTCODE || '').trim();
  const passkey = String(process.env.DARAJA_PASSKEY || '').trim();
  const callbackUrl = String(process.env.DARAJA_CALLBACK_URL || '').trim();

  if (!consumerKey || !consumerSecret || !/^\d{5,12}$/.test(shortcode) || !passkey || !callbackUrl) {
    throw new Error('Daraja server configuration is incomplete.');
  }
  let parsedCallback;
  try { parsedCallback = new URL(callbackUrl); } catch { throw new Error('Daraja callback URL is invalid.'); }
  if (parsedCallback.protocol !== 'https:') throw new Error('Daraja callback URL must use HTTPS.');

  return { environment, consumerKey, consumerSecret, shortcode, passkey, callbackUrl, baseUrl: darajaBaseUrl(environment) };
}

function darajaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

async function darajaAccessToken(config) {
  const now = Date.now();
  if (cachedAccessToken && cachedTokenEnvironment === config.environment && cachedAccessTokenUntil > now + 30_000) {
    return cachedAccessToken;
  }

  const authorization = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const response = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    method: 'GET',
    headers: { Authorization: `Basic ${authorization}` },
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok || !payload.access_token) throw new Error('Daraja authentication failed. Check the sandbox credentials in Vercel.');

  const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
  cachedAccessToken = String(payload.access_token);
  cachedTokenEnvironment = config.environment;
  cachedAccessTokenUntil = now + Math.max(30, expiresIn - 60) * 1000;
  return cachedAccessToken;
}

async function ownerContext(req) {
  const authorization = String(req.headers?.authorization || '');
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: { status: 401, message: 'Please log in again.' } };

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { error: { status: 401, message: 'Your session has expired. Please log in again.' } };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, role, store_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { error: { status: 403, message: 'An active store-owner account is required.' } };
  if (profile.role !== 'owner' || !profile.store_id) return { error: { status: 403, message: 'Only the store owner can request an M-Pesa payment.' } };

  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('id', profile.store_id)
    .maybeSingle();
  if (storeError) throw storeError;
  if (!store || !store.is_active) return { error: { status: 404, message: 'The store is not available for payment.' } };

  return { user, profile, store };
}

function readMetadata(callback) {
  const items = callback?.CallbackMetadata?.Item;
  if (!Array.isArray(items)) return {};
  return Object.fromEntries(items
    .filter((item) => item && typeof item.Name === 'string')
    .map((item) => [item.Name, item.Value]));
}

async function handleStkPush(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  let config;
  try { config = getDarajaConfig(); }
  catch (error) {
    console.error('Daraja configuration error:', error.message);
    return res.status(503).json({ error: 'M-Pesa sandbox is not configured yet. Please ask StoYangu support for help.' });
  }

  const context = await ownerContext(req);
  if (context.error) return res.status(context.error.status).json({ error: context.error.message });
  const phone = normalizeMpesaPhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid Kenyan M-Pesa number, such as 0712 345 678.' });

  const now = Date.now();
  const period = billingPeriod(context.store, now);
  const paidUntil = new Date(context.store.billing_paid_until || 0).getTime();
  const sandboxMode = config.environment === 'sandbox';
  if (!sandboxMode && paidUntil > period.endsAt) {
    return res.status(409).json({ error: 'Your next 14-day period is already paid. No new payment is needed yet.' });
  }
  if (!sandboxMode && !managementLocked(context.store, now) && period.endsAt - now > EARLY_PAYMENT_WINDOW_MS) {
    return res.status(409).json({ error: 'The payment prompt is available during the final three days of your period, or once payment is due.' });
  }

  // Production billing follows the existing 14-day anchor: the trial is free,
  // and an early renewal covers the following period. Sandbox callbacks never
  // apply this grant to the store.
  const currentPeriodAlreadyCovered = period.periodNumber === 0 || paidUntil > period.startsAt;
  const grantUntil = currentPeriodAlreadyCovered
    ? period.endsAt + BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000
    : period.endsAt;

  const staleBefore = new Date(now - STALE_REQUEST_MS).toISOString();
  const { error: expireError } = await supabase
    .from('mpesa_payments')
    .update({ status: 'expired', updated_at: new Date(now).toISOString() })
    .eq('store_id', context.store.id)
    .eq('status', 'pending')
    .lt('created_at', staleBefore);
  if (expireError) throw expireError;

  const { data: outstanding, error: pendingError } = await supabase
    .from('mpesa_payments')
    .select('id')
    .eq('store_id', context.store.id)
    .eq('status', 'pending')
    .gte('created_at', staleBefore)
    .limit(1);
  if (pendingError) throw pendingError;
  if (outstanding?.length) {
    return res.status(409).json({ error: 'An M-Pesa request is already waiting for a result. Check your phone before trying again.' });
  }

  const accountReference = `SY${randomBytes(5).toString('hex').toUpperCase()}`;
  const { data: payment, error: insertError } = await supabase
    .from('mpesa_payments')
    .insert({
      store_id: context.store.id,
      owner_user_id: context.user.id,
      environment: config.environment,
      phone,
      amount: PAYMENT_AMOUNT_KES,
      account_reference: accountReference,
      status: 'pending',
      billing_period: period.periodNumber,
      grant_until: new Date(grantUntil).toISOString(),
    })
    .select('id')
    .single();
  if (insertError) {
    if (insertError.code === '23505') return res.status(409).json({ error: 'An M-Pesa request is already waiting for a result. Check your phone before trying again.' });
    throw insertError;
  }

  try {
    const accessToken = await darajaAccessToken(config);
    const timestamp = darajaTimestamp();
    const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');
    const response = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: PAYMENT_AMOUNT_KES,
        PartyA: phone,
        PartyB: config.shortcode,
        PhoneNumber: phone,
        CallBackURL: config.callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: 'STOYANGU',
      }),
    });
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok || String(payload.ResponseCode) !== '0' || !payload.CheckoutRequestID || !payload.MerchantRequestID) {
      const detail = String(payload.errorMessage || payload.ResponseDescription || '').slice(0, 300);
      await supabase.from('mpesa_payments').update({
        status: 'failed',
        result_description: detail || 'Daraja did not accept the payment request.',
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }).eq('id', payment.id).eq('status', 'pending');
      console.warn('Daraja rejected an STK request:', { status: response.status, responseCode: payload.ResponseCode || null });
      return res.status(502).json({ error: 'Safaricom could not start the M-Pesa prompt. Check the number and try again.' });
    }

    const { error: saveError } = await supabase.from('mpesa_payments').update({
      merchant_request_id: String(payload.MerchantRequestID),
      checkout_request_id: String(payload.CheckoutRequestID),
      result_description: String(payload.ResponseDescription || 'Prompt sent to the phone.').slice(0, 300),
      updated_at: new Date().toISOString(),
    }).eq('id', payment.id).eq('status', 'pending');
    if (saveError) throw saveError;

    return res.status(200).json({ paymentId: payment.id, status: 'pending' });
  } catch (error) {
    await supabase.from('mpesa_payments').update({
      status: 'failed',
      result_description: 'The payment request could not be completed. Please try again.',
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq('id', payment.id).eq('status', 'pending');
    throw error;
  }
}

async function handlePaymentInfo(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const context = await ownerContext(req);
  if (context.error) return res.status(context.error.status).json({ error: context.error.message });

  let config;
  try { config = getDarajaConfig(); }
  catch { return res.status(200).json({ configured: false, sandbox: false, paymentWindowOpen: false, nextPeriodPaid: false }); }
  const { error: tableError } = await supabase.from('mpesa_payments').select('id').limit(1);
  if (tableError) return res.status(200).json({ configured: false, sandbox: false, paymentWindowOpen: false, nextPeriodPaid: false });

  const now = Date.now();
  const period = billingPeriod(context.store, now);
  const paidUntil = new Date(context.store.billing_paid_until || 0).getTime();
  return res.status(200).json({
    configured: true,
    sandbox: config.environment === 'sandbox',
    paymentWindowOpen: managementLocked(context.store, now) || period.endsAt - now <= EARLY_PAYMENT_WINDOW_MS,
    nextPeriodPaid: paidUntil > period.endsAt,
  });
}

async function handlePaymentStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const context = await ownerContext(req);
  if (context.error) return res.status(context.error.status).json({ error: context.error.message });
  const paymentId = Number(req.query?.paymentId);
  if (!Number.isSafeInteger(paymentId) || paymentId < 1) return res.status(400).json({ error: 'Payment request not found.' });

  const { data: payment, error } = await supabase
    .from('mpesa_payments')
    .select('id, status, receipt_number, result_description')
    .eq('id', paymentId)
    .eq('store_id', context.store.id)
    .eq('owner_user_id', context.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!payment) return res.status(404).json({ error: 'Payment request not found.' });
  return res.status(200).json(payment);
}

async function handleCallback(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const callback = req.body?.Body?.stkCallback;
  if (!callback || typeof callback !== 'object') return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback body.' });

  const checkoutRequestId = String(callback.CheckoutRequestID || '').trim();
  const merchantRequestId = String(callback.MerchantRequestID || '').trim();
  const rawResultCode = callback.ResultCode;
  const resultCode = Number(rawResultCode);
  if (!checkoutRequestId || !merchantRequestId || rawResultCode === undefined || rawResultCode === null || String(rawResultCode).trim() === '' || !Number.isInteger(resultCode)) {
    return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback details.' });
  }

  const metadata = readMetadata(callback);
  const rawAmount = metadata.Amount;
  const amount = rawAmount === undefined || rawAmount === null ? null : Number(rawAmount);
  const phone = normalizeMpesaPhone(metadata.PhoneNumber);
  const receipt = String(metadata.MpesaReceiptNumber || '').trim();
  const { data, error } = await supabase.rpc('stoyangu_mpesa_process_callback', {
    p_checkout_request_id: checkoutRequestId,
    p_merchant_request_id: merchantRequestId,
    p_result_code: resultCode,
    p_result_description: String(callback.ResultDesc || '').slice(0, 300),
    p_amount: Number.isSafeInteger(amount) ? amount : null,
    p_phone: phone || null,
    p_receipt_number: receipt || null,
  });
  if (error) throw error;

  if (data?.status === 'review') console.warn('An M-Pesa callback needs manual review:', { status: data.status });
  // Daraja only needs an acknowledgement. Duplicate callbacks return the same
  // result safely; the SQL function changes billing at most once.
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received.' });
}

export async function handleDarajaRequest(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const action = String(req.query?.daraja || '');
  try {
    if (action === 'callback') return await handleCallback(req, res);
    if (action === 'stk') return await handleStkPush(req, res);
    if (action === 'payment-info') return await handlePaymentInfo(req, res);
    if (action === 'payment-status') return await handlePaymentStatus(req, res);
    return res.status(404).json({ error: 'Unknown M-Pesa action.' });
  } catch (error) {
    console.error('M-Pesa request could not be processed:', error?.message || 'Unknown error');
    if (action === 'callback') return res.status(500).json({ ResultCode: 1, ResultDesc: 'Callback could not be recorded.' });
    return res.status(500).json({ error: 'M-Pesa could not process the request. Please try again shortly.' });
  }
}
