-- Mutabaah Yaumiah - Supabase schema (hierarki akun + 3 role)
-- Jalankan di Supabase SQL Editor (sekali, berurutan).

-- 1) Profil pengguna + role + relasi pengelola (created_by)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  role text not null default 'user' check (role in ('super_admin', 'admin', 'user')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

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

-- 2b) Item tugas tambahan (dibuat oleh admin/super_admin untuk bawahan)
-- creator_role = 'super_admin' -> berlaku untuk semua user
-- creator_role = 'admin'       -> berlaku untuk user yang dibuat (dikelola) admin tersebut
create table if not exists public.custom_items (
  id bigint generated always as identity primary key,
  label text not null check (char_length(trim(label)) > 0),
  created_by uuid not null references public.profiles(id) on delete cascade,
  creator_role text not null check (creator_role in ('admin', 'super_admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists custom_items_created_by_idx on public.custom_items (created_by);
create index if not exists custom_items_active_idx on public.custom_items (is_active);

-- 2c) Konfigurasi item bawaan (dikelola super_admin)
create table if not exists public.base_item_settings (
  key text primary key check (key in ('prayer_count', 'quran_pages', 'dzikir', 'sedekah')),
  label text not null check (char_length(trim(label)) > 0),
  is_active boolean not null default true,
  sort_order int not null,
  updated_at timestamptz not null default now()
);

insert into public.base_item_settings (key, label, is_active, sort_order) values
  ('prayer_count', 'Salat wajib', true, 1),
  ('quran_pages', 'Tilawah Al-Qur''an', true, 2),
  ('dzikir', 'Dzikir pagi & petang', true, 3),
  ('sedekah', 'Sedekah atau berbagi', true, 4)
on conflict (key) do nothing;

-- 3) Profil otomatis saat auth.users dibuat
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, created_by)
  values (
    new.id,
    new.email,
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

-- custom_items: item tugas tambahan
-- Baca: super_admin semua; pembuat item miliknya; admin/user bisa baca item aktif super_admin (untuk rekap & pengisian);
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

-- base_item_settings: konfigurasi item bawaan (global)
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
--    Password : MutabaahSuper#2026
--    Centang "Auto Confirm User" jika tersedia.
-- 2. Jalankan perintah berikut untuk menjadikan akun tersebut super admin:
--    update public.profiles
--    set role = 'super_admin', created_by = null
--    where email = 'superadmin@mutabaah.id';
-- 3. Login di aplikasi dengan kredensial di atas. Segera ganti password di
--    Supabase Dashboard (Authentication > Users) setelah login pertama bila diperlukan.
