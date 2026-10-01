-- StoYangu Daraja STK Push payments for KES 200 / 14-day upkeep.
-- Run once in Supabase Dashboard → SQL Editor → New query. Safe to re-run.
-- Payment records are private; all writes and callback processing use the
-- server-side Supabase service role. Sandbox successes are test-only and never
-- change billing. A validated production callback updates billing in the same
-- database transaction, so duplicate callbacks cannot double-credit.

create table if not exists public.mpesa_payments (
  id bigserial primary key,
  store_id integer not null references public.stores(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  phone text not null check (phone ~ '^254[17][0-9]{8}$'),
  amount integer not null default 200 check (amount = 200),
  account_reference text not null unique,
  merchant_request_id text,
  checkout_request_id text unique,
  billing_period integer not null default 0 check (billing_period >= 0),
  grant_until timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'sandbox_paid', 'failed', 'expired', 'review')),
  result_code integer,
  result_description text not null default '',
  receipt_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_mpesa_payments_store_created
  on public.mpesa_payments(store_id, created_at desc);
create unique index if not exists idx_mpesa_payments_one_pending_per_store
  on public.mpesa_payments(store_id) where status = 'pending';
create unique index if not exists idx_mpesa_payments_receipt_unique
  on public.mpesa_payments(receipt_number)
  where receipt_number is not null and receipt_number <> '';

alter table public.mpesa_payments enable row level security;
revoke all on table public.mpesa_payments from anon, authenticated;
grant all on table public.mpesa_payments to service_role;
revoke all on sequence public.mpesa_payments_id_seq from anon, authenticated;
grant usage, select on sequence public.mpesa_payments_id_seq to service_role;

create or replace function public.stoyangu_mpesa_process_callback(
  p_checkout_request_id text,
  p_merchant_request_id text,
  p_result_code integer,
  p_result_description text,
  p_amount bigint,
  p_phone text,
  p_receipt_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_row public.mpesa_payments%rowtype;
  callback_description text := left(coalesce(p_result_description, ''), 300);
  callback_receipt text := nullif(trim(coalesce(p_receipt_number, '')), '');
begin
  select *
    into payment_row
    from public.mpesa_payments
   where checkout_request_id = nullif(trim(coalesce(p_checkout_request_id, '')), '')
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_found', 'duplicate', false);
  end if;

  if payment_row.status = 'paid' then
    return jsonb_build_object('ok', true, 'status', 'paid', 'duplicate', true);
  end if;

  if payment_row.status not in ('pending', 'expired') then
    return jsonb_build_object('ok', true, 'status', payment_row.status, 'duplicate', true);
  end if;

  if payment_row.merchant_request_id is distinct from nullif(trim(coalesce(p_merchant_request_id, '')), '') then
    update public.mpesa_payments
       set status = 'review',
           result_code = p_result_code,
           result_description = 'The callback request identifiers did not match.',
           updated_at = now(),
           completed_at = now()
     where id = payment_row.id;
    return jsonb_build_object('ok', false, 'status', 'review', 'duplicate', false);
  end if;

  if p_result_code is distinct from 0 then
    update public.mpesa_payments
       set status = 'failed',
           result_code = p_result_code,
           result_description = callback_description,
           updated_at = now(),
           completed_at = now()
     where id = payment_row.id;
    return jsonb_build_object('ok', true, 'status', 'failed', 'duplicate', false);
  end if;

  if p_amount is distinct from payment_row.amount::bigint
     or p_phone is distinct from payment_row.phone
     or callback_receipt is null then
    update public.mpesa_payments
       set status = 'review',
           result_code = p_result_code,
           result_description = 'The callback amount, phone number or receipt did not match.',
           updated_at = now(),
           completed_at = now()
     where id = payment_row.id;
    return jsonb_build_object('ok', false, 'status', 'review', 'duplicate', false);
  end if;

  if payment_row.environment = 'sandbox' then
    update public.mpesa_payments
       set status = 'sandbox_paid',
           result_code = p_result_code,
           result_description = callback_description,
           receipt_number = callback_receipt,
           updated_at = now(),
           completed_at = now()
     where id = payment_row.id;
    return jsonb_build_object('ok', true, 'status', 'sandbox_paid', 'duplicate', false);
  end if;

  update public.mpesa_payments
     set status = 'paid',
         result_code = p_result_code,
         result_description = callback_description,
         receipt_number = callback_receipt,
         updated_at = now(),
         completed_at = now()
   where id = payment_row.id;

  update public.stores
     set billing_paid_until = case
           when billing_paid_until is null or billing_paid_until < payment_row.grant_until
             then payment_row.grant_until
           else billing_paid_until + interval '14 days'
         end,
         updated_at = now()
   where id = payment_row.store_id;

  return jsonb_build_object('ok', true, 'status', 'paid', 'duplicate', false);
end;
$$;

revoke all on function public.stoyangu_mpesa_process_callback(text, text, integer, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.stoyangu_mpesa_process_callback(text, text, integer, text, bigint, text, text)
  to service_role;
