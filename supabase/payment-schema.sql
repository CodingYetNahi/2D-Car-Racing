-- Run this only in the dedicated Supabase project used by 2D-Car-Racing.
-- These tables are intentionally service-role only. The public browser must not
-- read or write payment state directly.

create table if not exists public.racing_payment_runs (
  id uuid primary key default gen_random_uuid(),
  crash_number integer not null default 0 check (crash_number >= 0),
  state text not null default 'playing' check (state in ('playing', 'ordering', 'awaiting_payment', 'closed')),
  pending_order_id text unique,
  pending_amount_paise integer check (pending_amount_paise is null or pending_amount_paise >= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.racing_payments (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.racing_payment_runs(id) on delete cascade,
  crash_number integer not null check (crash_number >= 1),
  order_id text not null unique,
  payment_id text unique,
  amount_paise integer not null check (amount_paise >= 100),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (run_id, crash_number)
);

alter table public.racing_payment_runs enable row level security;
alter table public.racing_payments enable row level security;

revoke all on table public.racing_payment_runs from anon, authenticated;
revoke all on table public.racing_payments from anon, authenticated;
grant all on table public.racing_payment_runs to service_role;
grant all on table public.racing_payments to service_role;

grant usage, select on sequence public.racing_payments_id_seq to service_role;

create index if not exists racing_payments_run_id_idx on public.racing_payments(run_id);
create index if not exists racing_payments_payment_id_idx on public.racing_payments(payment_id);
