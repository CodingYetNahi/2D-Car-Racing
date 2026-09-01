create extension if not exists pgcrypto;

create table if not exists public.racing_verified_players (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 64),
  display_name text not null check (display_name ~ '^Racer-[A-Z0-9]{6}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.racing_verified_runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.racing_verified_players(id) on delete restrict,
  seed bigint not null check (seed between 1 and 4294967295),
  game_version text not null check (length(game_version) between 1 and 32),
  status text not null default 'issued' check (status in ('issued', 'verified', 'rejected', 'expired')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  verified_score integer check (verified_score is null or verified_score >= 0),
  end_tick integer check (end_tick is null or end_tick between 1 and 36000),
  input_count integer check (input_count is null or input_count between 0 and 5000)
);

create table if not exists public.racing_verified_scores (
  id bigint generated always as identity primary key,
  run_id uuid not null unique references public.racing_verified_runs(id) on delete restrict,
  player_id uuid not null references public.racing_verified_players(id) on delete restrict,
  score integer not null check (score >= 0),
  game_version text not null check (length(game_version) between 1 and 32),
  created_at timestamptz not null default now()
);

create table if not exists public.racing_verification_rate_limits (
  client_key text not null check (length(client_key) = 64),
  action text not null check (length(action) between 1 and 40),
  bucket timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (client_key, action, bucket)
);

alter table public.racing_verified_players enable row level security;
alter table public.racing_verified_runs enable row level security;
alter table public.racing_verified_scores enable row level security;
alter table public.racing_verification_rate_limits enable row level security;

revoke all on table public.racing_verified_players, public.racing_verified_runs, public.racing_verified_scores, public.racing_verification_rate_limits from public, anon, authenticated;
grant all on table public.racing_verified_players, public.racing_verified_runs, public.racing_verified_scores, public.racing_verification_rate_limits to service_role;
grant usage, select on sequence public.racing_verified_scores_id_seq to service_role;

create index if not exists racing_verified_runs_player_idx on public.racing_verified_runs(player_id, issued_at desc);
create index if not exists racing_verified_runs_expiry_idx on public.racing_verified_runs(status, expires_at);
create index if not exists racing_verified_scores_rank_idx on public.racing_verified_scores(score desc, created_at asc);
create index if not exists racing_verification_rate_bucket_idx on public.racing_verification_rate_limits(bucket);

create or replace function public.consume_racing_verification_rate_limit(
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

  insert into public.racing_verification_rate_limits(client_key, action, bucket, request_count)
  values (p_client_key, p_action, p_bucket, 1)
  on conflict (client_key, action, bucket)
  do update set request_count = public.racing_verification_rate_limits.request_count + 1
  returning request_count into current_count;

  return current_count <= p_max_requests;
end;
$$;

create or replace function public.complete_racing_verified_run(
  p_run_id uuid,
  p_player_id uuid,
  p_score integer,
  p_end_tick integer,
  p_input_count integer
) returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  selected_run public.racing_verified_runs%rowtype;
  new_score_id bigint;
begin
  if p_score < 0 or p_end_tick not between 1 and 36000 or p_input_count not between 0 and 5000 then
    raise exception 'invalid verified result';
  end if;

  select * into selected_run
  from public.racing_verified_runs
  where id = p_run_id and player_id = p_player_id
  for update;

  if selected_run.id is null or selected_run.status <> 'issued' or selected_run.expires_at <= now() then
    raise exception 'run is unavailable';
  end if;

  update public.racing_verified_runs
  set status = 'verified', submitted_at = now(), verified_score = p_score, end_tick = p_end_tick, input_count = p_input_count
  where id = p_run_id and status = 'issued';
  if not found then raise exception 'run state changed'; end if;

  insert into public.racing_verified_scores(run_id, player_id, score, game_version)
  values (p_run_id, p_player_id, p_score, selected_run.game_version)
  returning id into new_score_id;

  update public.racing_verified_players set last_seen_at = now() where id = p_player_id;
  return new_score_id;
end;
$$;

revoke execute on function public.consume_racing_verification_rate_limit(text, text, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.complete_racing_verified_run(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_racing_verification_rate_limit(text, text, timestamptz, integer) to service_role;
grant execute on function public.complete_racing_verified_run(uuid, uuid, integer, integer, integer) to service_role;

