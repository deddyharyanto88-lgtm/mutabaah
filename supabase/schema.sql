-- Mutabaah Yaumiah - Supabase schema (hierarki akun + 3 role)
-- Jalankan di Supabase SQL Editor (sekali, berurutan).

-- 1) Profil pengguna + role + relasi pengelola (created_by)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null,
  email text,
  full_name text not null default '',
  role text not null default 'user' check (role in ('super_admin', 'admin', 'user')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Upgrade profil lama: gunakan UUID yang sudah ada sebagai ID login awal.
alter table public.profiles add column if not exists login_id text;
update public.profiles set login_id = id::text where login_id is null;
alter table public.profiles alter column login_id set not null;
update public.profiles set email = lower(trim(email)) where email is not null;
create unique index if not exists profiles_login_id_lower_key on public.profiles (lower(login_id));
create unique index if not exists profiles_email_lower_key on public.profiles (lower(email)) where email is not null;

-- upgrade aman: tambahkan kolom created_by jika tabel sudah ada tanpa kolom ini
alter table public.profiles add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- 2) Entri mutabaah harian per pengguna
create table if not exists public.mutabaah_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_date date not null,
  prayer_count int not null default 0 check (prayer_count between 0 and 5),
  quran_pages int not null default 0 check (quran_pages >= 0),
  dzikir boolean not null default false,
  sedekah boolean not null default false,
  notes text not null default '',
  custom_checks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

-- upgrade aman: tambahkan kolom custom_checks jika tabel sudah ada
alter table public.mutabaah_entries add column if not exists custom_checks jsonb not null default '{}'::jsonb;

create index if not exists mutabaah_entries_user_date_idx on public.mutabaah_entries (user_id, entry_date desc);
create index if not exists mutabaah_entries_date_idx on public.mutabaah_entries (entry_date desc);
create index if not exists profiles_created_by_idx on public.profiles (created_by);

-- 2b) Item isian yang dibuat oleh admin/super_admin sesuai cakupan role
-- creator_role = 'super_admin' -> berlaku untuk semua user
-- creator_role = 'admin'       -> berlaku untuk user yang dibuat (dikelola) admin tersebut
create table if not exists public.custom_items (
  id bigint generated always as identity primary key,
  label text not null check (char_length(trim(label)) > 0),
  input_type text not null default 'check'
    constraint custom_items_input_type_allowed check (input_type in ('check', 'number', 'text')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  creator_role text not null check (creator_role in ('admin', 'super_admin')),
  is_active boolean not null default true,
  is_deleted boolean not null default false,
  legacy_key text,
  sort_order numeric,
  created_at timestamptz not null default now()
);

-- Upgrade aman: item lama tetap menggunakan checklist.
alter table public.custom_items
  add column if not exists input_type text not null default 'check';
alter table public.custom_items
  add column if not exists legacy_key text;
alter table public.custom_items
  add column if not exists is_deleted boolean not null default false;
alter table public.custom_items
  add column if not exists sort_order numeric;
create unique index if not exists custom_items_legacy_key_key
  on public.custom_items (legacy_key);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'custom_items_input_type_allowed'
      and conrelid = 'public.custom_items'::regclass
  ) then
    alter table public.custom_items
      add constraint custom_items_input_type_allowed
      check (input_type in ('check', 'number', 'text'));
  end if;
end;
$$;

create index if not exists custom_items_created_by_idx on public.custom_items (created_by);
create index if not exists custom_items_active_idx on public.custom_items (is_active);

-- 2c) Data lama untuk konversi empat item sebelumnya ke item isian
create table if not exists public.base_item_settings (
  key text primary key check (key in ('prayer_count', 'quran_pages', 'dzikir', 'sedekah')),
  label text not null check (char_length(trim(label)) > 0),
  is_active boolean not null default true,
  is_deleted boolean not null default false,
  sort_order int not null,
  updated_at timestamptz not null default now()
);

-- Retain prior deletion state during conversion to editable item rows.
alter table public.base_item_settings
  add column if not exists is_deleted boolean not null default false;

insert into public.base_item_settings (key, label, is_active, sort_order) values
  ('prayer_count', 'Salat wajib', true, 1),
  ('quran_pages', 'Tilawah Al-Qur''an', true, 2),
  ('dzikir', 'Dzikir pagi & petang', true, 3),
  ('sedekah', 'Sedekah atau berbagi', true, 4)
on conflict (key) do nothing;

-- Convert the former built-in items to ordinary editable input items.
insert into public.custom_items (label, input_type, created_by, creator_role, is_active, is_deleted, legacy_key)
select
  settings.label,
  case settings.key
    when 'prayer_count' then 'number'
    when 'quran_pages' then 'number'
    else 'check'
  end,
  owner.id,
  'super_admin',
  settings.is_active,
  settings.is_deleted,
  settings.key
from public.base_item_settings settings
cross join lateral (
  select id
  from public.profiles
  where role = 'super_admin'
  order by created_at, id
  limit 1
) owner
order by settings.sort_order, settings.key
on conflict (legacy_key) do nothing;

-- Move historical built-in values into the same JSON field used by all input items.
update public.mutabaah_entries e
set custom_checks = e.custom_checks || jsonb_build_object(
  item.id::text,
  case item.legacy_key
    when 'prayer_count' then to_jsonb(e.prayer_count)
    when 'quran_pages' then to_jsonb(e.quran_pages)
    when 'dzikir' then to_jsonb(e.dzikir)
    when 'sedekah' then to_jsonb(e.sedekah)
  end
)
from public.custom_items item
where item.legacy_key in ('prayer_count', 'quran_pages', 'dzikir', 'sedekah')
  and not (e.custom_checks ? item.id::text);

-- Urutan tampilan terpisah dari nilai amalan yang tersimpan di mutabaah_entries.
with numbered_items as (
  select id, row_number() over (order by created_at, id) * 1000 as position
  from public.custom_items
  where sort_order is null
)
update public.custom_items item
set sort_order = numbered_items.position
from numbered_items
where item.id = numbered_items.id;

alter table public.custom_items alter column sort_order set not null;

-- 3) Profil otomatis saat auth.users dibuat
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, login_id, email, full_name, role, created_by)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'login_id', new.id::text),
    case when new.email like '%@login.mutabaah.invalid' then null else new.email end,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'user',
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4) Helper role & hierarki (security definer, bypass RLS untuk evaluasi akses)
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.get_my_created_by()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select created_by from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_admin_or_super()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'super_admin')
  );
$$;

-- Baca profil: diri sendiri, super_admin (semua), atau admin (user yang dikelolanya)
create or replace function public.can_read_profile(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_id = auth.uid()
    or public.is_super_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = target_id
        and p.created_by = auth.uid()
        and public.is_admin()
    );
$$;

-- Baca entri: milik sendiri, super_admin (semua), atau admin (entri user yang dikelolanya)
create or replace function public.can_read_entry(entry_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    entry_user_id = auth.uid()
    or public.is_super_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = entry_user_id
        and p.created_by = auth.uid()
        and public.is_admin()
    );
$$;

-- 5) Row Level Security
alter table public.profiles enable row level security;
alter table public.mutabaah_entries enable row level security;
alter table public.custom_items enable row level security;
alter table public.base_item_settings enable row level security;

-- Bersihkan policy lama (jika upgrade dari schema sebelumnya)
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_select_hierarchy" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_super_admin" on public.profiles;
drop policy if exists "entries_select_own_or_admin" on public.mutabaah_entries;
drop policy if exists "entries_select_hierarchy" on public.mutabaah_entries;
drop policy if exists "entries_insert_own" on public.mutabaah_entries;
drop policy if exists "entries_update_own" on public.mutabaah_entries;
drop policy if exists "entries_delete_own" on public.mutabaah_entries;
drop policy if exists "custom_items_select" on public.custom_items;
drop policy if exists "custom_items_insert" on public.custom_items;
drop policy if exists "custom_items_update" on public.custom_items;
drop policy if exists "custom_items_delete" on public.custom_items;
drop policy if exists "base_item_settings_select" on public.base_item_settings;
drop policy if exists "base_item_settings_update" on public.base_item_settings;

-- profiles: baca sesuai hierarki
create policy "profiles_select_hierarchy"
  on public.profiles for select
  using (public.can_read_profile(id));

-- profiles: setiap pengguna boleh update profil sendiri (mis. ganti nama) tapi tidak boleh ubah role
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = public.get_my_role());

-- profiles: super_admin boleh update profil siapa pun (termasuk role)
create policy "profiles_update_super_admin"
  on public.profiles for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- mutabaah_entries: baca sesuai hierarki
create policy "entries_select_hierarchy"
  on public.mutabaah_entries for select
  using (public.can_read_entry(user_id));

-- mutabaah_entries: setiap pengguna kelola entri miliknya sendiri
create policy "entries_insert_own"
  on public.mutabaah_entries for insert
  with check (auth.uid() = user_id);

create policy "entries_update_own"
  on public.mutabaah_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "entries_delete_own"
  on public.mutabaah_entries for delete
  using (auth.uid() = user_id);

-- custom_items: item isian
-- Baca: super_admin semua; pembuat item miliknya; admin/user bisa baca item aktif super_admin;
--       user bisa baca item aktif admin pengelolanya.
create policy "custom_items_select"
  on public.custom_items for select
  using (
    public.is_super_admin()
    or created_by = auth.uid()
    or (is_active and creator_role = 'super_admin' and public.get_my_role() in ('user', 'admin'))
    or (is_active and creator_role = 'admin' and public.get_my_role() = 'user' and created_by = public.get_my_created_by())
  );

-- Tambah: hanya admin/super_admin, dan item harus milik & sesuai rolenya
create policy "custom_items_insert"
  on public.custom_items for insert
  with check (
    created_by = auth.uid()
    and public.is_admin_or_super()
    and creator_role = public.get_my_role()
  );

-- Ubah: pembuat atau super_admin
create policy "custom_items_update"
  on public.custom_items for update
  using (created_by = auth.uid() or public.is_super_admin())
  with check (created_by = auth.uid() or public.is_super_admin());

-- Hapus: pembuat atau super_admin
create policy "custom_items_delete"
  on public.custom_items for delete
  using (created_by = auth.uid() or public.is_super_admin());

-- base_item_settings: tabel kompatibilitas untuk konversi item lama
-- Baca: semua pengguna terautentikasi
create policy "base_item_settings_select"
  on public.base_item_settings for select
  using (auth.uid() is not null);

-- Ubah: hanya super_admin
create policy "base_item_settings_update"
  on public.base_item_settings for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- 6) BOOTSTRAP SUPER ADMIN PERTAMA
-- 1. Buat user di Supabase Dashboard > Authentication > Users > "Add user" > "Create new user"
--    Email    : superadmin@mutabaah.id
--    Password : gunakan kata sandi acak dan unik, simpan di pengelola kata sandi
--    Centang "Auto Confirm User" jika tersedia.
-- 2. Jalankan perintah berikut untuk menjadikan akun tersebut super admin (gunakan insert..on conflict
--    jika profil belum otomatis terbentuk):
--    insert into public.profiles (id, login_id, email, full_name, role, created_by)
--    select id, coalesce(raw_user_meta_data->>'login_id', id::text), email, coalesce(raw_user_meta_data->>'full_name', ''), 'super_admin', null
--    from auth.users
--    where email = 'superadmin@mutabaah.id'
--    on conflict (id) do update
--      set role = 'super_admin', created_by = null, login_id = excluded.login_id, email = excluded.email;
-- 3. Login di aplikasi dengan kredensial di atas. Segera ganti password di
--    Supabase Dashboard (Authentication > Users) setelah login pertama bila diperlukan.

-- 7) Privileges untuk akses via Supabase API (RLS tetap membatasi baris/aksi)
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table
  public.profiles,
  public.mutabaah_entries,
  public.custom_items,
  public.base_item_settings
to anon, authenticated;

grant select, insert, update on table public.profiles to service_role;

grant usage, select on all sequences in schema public to anon, authenticated;
