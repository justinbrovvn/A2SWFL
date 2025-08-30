-- Base tables
create table if not exists public."TaskInstances" (
  id bigserial primary key,
  "Title" text not null,
  "DueDateTime" timestamptz not null,
  "Status" text not null default 'Not Started',
  "CompletedByInitials" text,
  "CompletedAt" timestamptz,
  "Category" text,
  "Assignees" text,
  "Recurrence" text default 'none',
  "AppKey" text,
  "created_at" timestamptz default now()
);

create table if not exists public."CBL" (
  id bigserial primary key,
  "Title" text not null,
  "DueDateTime" timestamptz,
  "Status" text not null default 'Not Started',
  "CompletedByInitials" text,
  "CompletedAt" timestamptz,
  "Category" text,
  "Assignees" text,
  "AppKey" text,
  "created_at" timestamptz default now()
);

create table if not exists public."Accountabilities" (
  id bigserial primary key,
  "Person" text not null,
  "FocusArea" text not null,
  "Target" text not null,
  "WeekOf" text not null,
  "AppKey" text,
  "created_at" timestamptz default now()
);

create table if not exists public."Notes" (
  id bigserial primary key,
  "Text" text not null,
  "CreatedByInitials" text,
  "CreatedOn" timestamptz not null default now(),
  "AppKey" text
);

create table if not exists public."CompletionLog" (
  id bigserial primary key,
  "ItemType" text not null, -- 'SWFL' | 'CBL'
  "ItemId" bigint not null,
  "Action" text not null,   -- 'Completed' | 'Reopened' | 'Deleted'
  "ByInitials" text,
  "At" timestamptz not null default now(),
  "AppKey" text
);

-- Enable RLS
alter table public."TaskInstances" enable row level security;
alter table public."CBL" enable row level security;
alter table public."Accountabilities" enable row level security;
alter table public."Notes" enable row level security;
alter table public."CompletionLog" enable row level security;

-- Policies: reads open; writes require matching AppKey
create policy taskinstances_select on public."TaskInstances" for select using (true);
create policy cbl_select on public."CBL" for select using (true);
create policy accountabilities_select on public."Accountabilities" for select using (true);
create policy notes_select on public."Notes" for select using (true);
create policy complog_select on public."CompletionLog" for select using (true);

-- Replace CHANGE_ME_SHARED_KEY with your passphrase (and match it in app.js)
create policy taskinstances_insert on public."TaskInstances" for insert with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy taskinstances_update on public."TaskInstances" for update using (true) with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy taskinstances_delete on public."TaskInstances" for delete using ("AppKey" = 'CHANGE_ME_SHARED_KEY');

create policy cbl_insert on public."CBL" for insert with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy cbl_update on public."CBL" for update using (true) with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy cbl_delete on public."CBL" for delete using ("AppKey" = 'CHANGE_ME_SHARED_KEY');

create policy accountabilities_insert on public."Accountabilities" for insert with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy accountabilities_update on public."Accountabilities" for update using (true) with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy accountabilities_delete on public."Accountabilities" for delete using ("AppKey" = 'CHANGE_ME_SHARED_KEY');

create policy notes_insert on public."Notes" for insert with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy notes_update on public."Notes" for update using (true) with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy notes_delete on public."Notes" for delete using ("AppKey" = 'CHANGE_ME_SHARED_KEY');

create policy complog_insert on public."CompletionLog" for insert with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy complog_update on public."CompletionLog" for update using (true) with check ("AppKey" = 'CHANGE_ME_SHARED_KEY');
create policy complog_delete on public."CompletionLog" for delete using ("AppKey" = 'CHANGE_ME_SHARED_KEY');
