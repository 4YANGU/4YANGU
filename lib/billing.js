// StoYangu billing model (the "300 pack"):
// - Setup is free (KES 15,000 waived through the Video Yangu, StoYangu promo).
// - The first 30-day period is a completely free trial.
// - Every period after that costs KES 300, paid on day 30 to continue.
// - Non-payment policy: the storefront STAYS visible to customers, but the
//   owner's product management locks until the KES 300 is paid. Full
//   disabling is only ever done manually by the founder (power toggle).

const PERIOD_MS = 30 * 86400000;

export function billingPeriod(store, now = Date.now()) {
  const started = new Date(store.billing_started_at || store.created_at || now).getTime();
  const anchor = Number.isFinite(started) ? started : now;
  const periodNumber = Math.max(0, Math.floor((now - anchor) / PERIOD_MS));
  const startsAt = anchor + periodNumber * PERIOD_MS;
  return { periodNumber, startsAt, endsAt: startsAt + PERIOD_MS };
}

// True when the store is past its free first 30 days and the current period
// has not been paid for (billing_paid_until does not cover the period start).
export function managementLocked(store, now = Date.now()) {
  const period = billingPeriod(store, now);
  if (period.periodNumber === 0) return false;
  const paidUntil = new Date(store.billing_paid_until || 0).getTime();
  return !(Number.isFinite(paidUntil) && paidUntil >= period.startsAt);
}
