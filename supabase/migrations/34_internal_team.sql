-- ============================================
-- CostPilot Phase 10.1 — Internal demo team
-- ============================================

create extension if not exists pgcrypto;
insert into public.sales_reps (
    rep_code,
    full_name,
    role,
    region,
    segment,
    active,
    capacity
)
values
    ('priya_shah', 'Priya Shah', 'sdr', 'global', 'all', true, 50),
    ('daniel_lee', 'Daniel Lee', 'ae', 'global', 'enterprise', true, 25),
    ('ethan_cole', 'Ethan Cole', 'ae', 'global', 'all', true, 25)
on conflict (rep_code) do update
set
    full_name = excluded.full_name,
    role = excluded.role,
    region = excluded.region,
    segment = excluded.segment,
    active = excluded.active,
    capacity = excluded.capacity;
create table if not exists public.internal_team (
    id               uuid primary key default gen_random_uuid(),
    team_code        text not null unique,
    full_name        text not null,
    job_title        text not null,
    department       text not null,
    email            text not null unique,
    active           boolean not null default true,
    routing_eligible boolean not null default false,
    sales_rep_id     uuid references public.sales_reps (id) on delete set null,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint internal_team_full_name_nonempty_check
        check (length(btrim(full_name)) > 0),
    constraint internal_team_job_title_nonempty_check
        check (length(btrim(job_title)) > 0),
    constraint internal_team_department_nonempty_check
        check (length(btrim(department)) > 0),
    constraint internal_team_team_code_lowercase_check
        check (team_code = lower(team_code) and team_code = regexp_replace(team_code, '[^a-z0-9_]+', '', 'g')),
    constraint internal_team_routing_sales_rep_check
        check (
            (routing_eligible = true and sales_rep_id is not null)
            or (routing_eligible = false and sales_rep_id is null)
        )
);
create unique index if not exists internal_team_sales_rep_id_unique_idx
    on public.internal_team (sales_rep_id)
    where sales_rep_id is not null;
create index if not exists internal_team_routing_active_idx
    on public.internal_team (routing_eligible, active);
drop trigger if exists internal_team_set_updated_at on public.internal_team;
create trigger internal_team_set_updated_at
    before update on public.internal_team
    for each row
    execute function public.set_updated_at();
alter table public.internal_team enable row level security;
drop policy if exists "service_role_all_internal_team" on public.internal_team;
create policy "service_role_all_internal_team"
    on public.internal_team
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.internal_team to service_role;
insert into public.internal_team (
    team_code,
    full_name,
    job_title,
    department,
    email,
    active,
    routing_eligible,
    sales_rep_id
)
values
    (
        'aisha_khan',
        'Aisha Khan',
        'Founder / CEO',
        'Executive',
        'aisha@demo.costpilot.internal',
        true,
        false,
        null
    ),
    (
        'daniel_lee',
        'Daniel Lee',
        'Head of RevOps',
        'Revenue Operations',
        'daniel@demo.costpilot.internal',
        true,
        true,
        (select id from public.sales_reps where rep_code = 'daniel_lee')
    ),
    (
        'priya_shah',
        'Priya Shah',
        'SDR / Growth',
        'Sales / Growth',
        'priya@demo.costpilot.internal',
        true,
        true,
        (select id from public.sales_reps where rep_code = 'priya_shah')
    ),
    (
        'marcus_reed',
        'Marcus Reed',
        'Customer Success Manager',
        'Customer Success',
        'marcus@demo.costpilot.internal',
        true,
        false,
        null
    ),
    (
        'sofia_chen',
        'Sofia Chen',
        'FinOps / Product Ops',
        'Product Operations',
        'sofia@demo.costpilot.internal',
        true,
        false,
        null
    ),
    (
        'ethan_cole',
        'Ethan Cole',
        'Solutions Engineer',
        'Solutions',
        'ethan@demo.costpilot.internal',
        true,
        true,
        (select id from public.sales_reps where rep_code = 'ethan_cole')
    )
on conflict (team_code) do update
set
    full_name = excluded.full_name,
    job_title = excluded.job_title,
    department = excluded.department,
    email = excluded.email,
    active = excluded.active,
    routing_eligible = excluded.routing_eligible,
    sales_rep_id = excluded.sales_rep_id;
