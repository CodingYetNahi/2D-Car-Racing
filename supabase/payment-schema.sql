-- Run only in the dedicated Supabase project used by 2D-Car-Racing.
-- All payment data stays service-role only. The public browser never receives
-- the service-role key and cannot read these tables through the Data API.

create table if not exists public.racing_payment_runs (
  id uuid primary key default gen_random_uuid(),
  state text not null default 'playing' check (state in ('playing', 'ordering', 'awaiting_payment', 'closed')),
  pending_order_id text unique,
  pending_amount_paise integer check (pending_amount_paise is null or pending_amount_paise >= 100),
  pending_product_code text check (pending_product_code is null or pending_product_code in ('day', 'week')),
  terms_version text,
  adult_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe upgrades for projects that applied the earlier pay-per-crash schema.
alter table public.racing_payment_runs add column if not exists pending_product_code text;
alter table public.racing_payment_runs add column if not exists terms_version text;
alter table public.racing_payment_runs add column if not exists adult_confirmed_at timestamptz;

create table if not exists public.racing_entitlements (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  product_code text not null check (product_code in ('day', 'week')),
  status text not null default 'active' check (status in ('active', 'revoked', 'refunded')),
  expires_at timestamptz not null,
  continues_used integer not null default 0 check (continues_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.racing_payments (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.racing_payment_runs(id) on delete restrict,
  order_id text not null unique,
  payment_id text unique,
  product_code text not null check (product_code in ('day', 'week')),
  amount_paise integer not null check (amount_paise in (2900, 9900)),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'pending' check (status in ('pending', 'captured', 'paid', 'failed', 'refunded')),
  terms_version text not null,
  adult_confirmed_at timestamptz not null,
  entitlement_id uuid unique references public.racing_entitlements(id) on delete restrict,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.racing_payments add column if not exists product_code text;
alter table public.racing_payments add column if not exists terms_version text;
alter table public.racing_payments add column if not exists adult_confirmed_at timestamptz;
alter table public.racing_payments add column if not exists entitlement_id uuid references public.racing_entitlements(id) on delete restrict;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'racing_payments' and column_name = 'crash_number'
  ) then
    alter table public.racing_payments alter column crash_number drop not null;
  end if;
end;
$$;
alter table public.racing_payments drop constraint if exists racing_payments_run_id_crash_number_key;
alter table public.racing_payments drop constraint if exists racing_payments_status_check;
alter table public.racing_payments add constraint racing_payments_status_check check (status in ('pending', 'captured', 'paid', 'failed', 'refunded'));

create table if not exists public.racing_rate_limits (
  client_key text not null check (length(client_key) = 64),
  action text not null check (length(action) between 1 and 40),
  bucket timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (client_key, action, bucket)
);

alter table public.racing_payment_runs enable row level security;
alter table public.racing_payments enable row level security;
alter table public.racing_entitlements enable row level security;
alter table public.racing_rate_limits enable row level security;

revoke all on table public.racing_payment_runs, public.racing_payments, public.racing_entitlements, public.racing_rate_limits from public, anon, authenticated;
grant all on table public.racing_payment_runs, public.racing_payments, public.racing_entitlements, public.racing_rate_limits to service_role;
grant usage, select on sequence public.racing_payments_id_seq to service_role;

create index if not exists racing_payments_run_id_idx on public.racing_payments(run_id);
create index if not exists racing_payments_payment_id_idx on public.racing_payments(payment_id);
create index if not exists racing_entitlements_expiry_idx on public.racing_entitlements(status, expires_at);
create index if not exists racing_rate_limits_bucket_idx on public.racing_rate_limits(bucket);

create or replace function public.consume_racing_rate_limit(
  p_client_key text,
  p_action text,
  p_bucket timestamptz,
  p_max_requests integer
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
begin
  if length(p_client_key) <> 64 or length(p_action) not between 1 and 40 or p_max_requests < 1 then
    raise exception 'invalid rate-limit input';
  end if;

  insert into public.racing_rate_limits(client_key, action, bucket, request_count)
  values (p_client_key, p_action, p_bucket, 1)
  on conflict (client_key, action, bucket)
  do update set request_count = public.racing_rate_limits.request_count + 1
  returning request_count into current_count;

  return current_count <= p_max_requests;
end;
$$;

create or replace function public.record_racing_order(
  p_run_id uuid,
  p_order_id text,
  p_product_code text,
  p_amount_paise integer,
  p_terms_version text
) returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  confirmed_at timestamptz;
begin
  if (p_product_code = 'day' and p_amount_paise <> 2900) or (p_product_code = 'week' and p_amount_paise <> 9900) then
    raise exception 'server price mismatch';
  end if;

  select adult_confirmed_at into confirmed_at
  from public.racing_payment_runs
  where id = p_run_id and state = 'ordering' and pending_product_code = p_product_code
  for update;
  if confirmed_at is null then raise exception 'run is not ready for an order'; end if;

  insert into public.racing_payments(run_id, order_id, product_code, amount_paise, currency, status, terms_version, adult_confirmed_at)
  values (p_run_id, p_order_id, p_product_code, p_amount_paise, 'INR', 'pending', p_terms_version, confirmed_at);

  update public.racing_payment_runs
  set state = 'awaiting_payment', pending_order_id = p_order_id, pending_amount_paise = p_amount_paise, updated_at = now()
  where id = p_run_id and state = 'ordering';
  if not found then raise exception 'run state changed'; end if;
end;
$$;

create or replace function public.complete_racing_payment(
  p_run_id uuid,
  p_order_id text,
  p_payment_id text,
  p_token_hash text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  payment_row public.racing_payments%rowtype;
  new_entitlement_id uuid;
begin
  select * into payment_row from public.racing_payments
  where run_id = p_run_id and order_id = p_order_id
  for update;
  if p_expires_at <= now() or length(p_token_hash) <> 64 then raise exception 'invalid entitlement'; end if;

  if payment_row.status = 'paid' and payment_row.payment_id = p_payment_id and payment_row.entitlement_id is not null then
    update public.racing_entitlements
    set token_hash = p_token_hash, updated_at = now()
    where id = payment_row.entitlement_id and status = 'active' and expires_at > now();
    if not found then raise exception 'existing entitlement is not active'; end if;
    return payment_row.entitlement_id;
  end if;

  if payment_row.id is null or payment_row.status not in ('pending', 'captured') then raise exception 'payment cannot be completed'; end if;

  insert into public.racing_entitlements(token_hash, product_code, expires_at)
  values (p_token_hash, payment_row.product_code, p_expires_at)
  returning id into new_entitlement_id;

  update public.racing_payments
  set status = 'paid', payment_id = p_payment_id, paid_at = now(), entitlement_id = new_entitlement_id
  where id = payment_row.id;

  update public.racing_payment_runs
  set state = 'playing', pending_order_id = null, pending_amount_paise = null, pending_product_code = null, updated_at = now()
  where id = p_run_id and pending_order_id = p_order_id;

  return new_entitlement_id;
end;
$$;

create or replace function public.rotate_racing_entitlement_token(p_entitlement_id uuid, p_token_hash text)
returns table(product_code text, expires_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if length(p_token_hash) <> 64 then raise exception 'invalid token hash'; end if;
  return query
  update public.racing_entitlements
  set token_hash = p_token_hash, updated_at = now()
  where id = p_entitlement_id and status = 'active' and racing_entitlements.expires_at > now()
  returning racing_entitlements.product_code, racing_entitlements.expires_at;
end;
$$;

create or replace function public.consume_racing_entitlement(p_token_hash text)
returns table(id uuid, product_code text, expires_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if length(p_token_hash) <> 64 then raise exception 'invalid token hash'; end if;
  return query
  update public.racing_entitlements
  set continues_used = continues_used + 1, updated_at = now()
  where token_hash = p_token_hash and status = 'active' and racing_entitlements.expires_at > now()
  returning racing_entitlements.id, racing_entitlements.product_code, racing_entitlements.expires_at;
end;
$$;

revoke execute on function public.consume_racing_rate_limit(text, text, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.record_racing_order(uuid, text, text, integer, text) from public, anon, authenticated;
revoke execute on function public.complete_racing_payment(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.rotate_racing_entitlement_token(uuid, text) from public, anon, authenticated;
revoke execute on function public.consume_racing_entitlement(text) from public, anon, authenticated;
grant execute on function public.consume_racing_rate_limit(text, text, timestamptz, integer) to service_role;
grant execute on function public.record_racing_order(uuid, text, text, integer, text) to service_role;
grant execute on function public.complete_racing_payment(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.rotate_racing_entitlement_token(uuid, text) to service_role;
grant execute on function public.consume_racing_entitlement(text) to service_role;
