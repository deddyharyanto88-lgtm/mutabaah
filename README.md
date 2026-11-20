# Mutabaah Yaumiah

Aplikasi pencatatan amalan harian (mutabaah) berbasis web, terhubung ke **Supabase** (auth + database) dan siap deploy di **Vercel**.

## Fitur

- Login dengan akun yang dibuat oleh admin/super admin (tidak ada pendaftaran publik)
- Pencatatan amalan harian per akun: item bawaan (salat wajib, tilawah, dzikir, sedekah — label/aktif/urut dapat diatur super admin, tipe input khusus tetap), **item tugas tambahan** (dari admin/super admin), dan catatan refleksi
- Navigasi tanggal & progres harian (berdasarkan item aktif)
- Ringkasan 7 hari terakhir milik sendiri: total mingguan + grafik per item aktif (numerik/checklist bawaan & tugas tambahan)
- Unduh/output ringkasan 7 hari (CSV) untuk akun sendiri
- Ganti nama profil (user/admin/super admin, untuk akunnya sendiri)
- Admin/super admin dapat menambahkan item tugas/isian tambahan untuk bawahan (sesuai otorisasi), mengubah nama, serta mengaktifkan/nonaktifkan/menghapusnya
- Super admin dapat mengelola **item bawaan** global (ubah label, aktif/nonaktif, dan urutan) — tipe input khusus tetap
- 3 tingkat akses/role dengan hierarki pengelolaan akun: **user**, **admin**, **super_admin**
- Data tersimpan di Supabase (Postgres) dengan Row Level Security (RLS)
- Tampilan responsif

## Role & Hak Akses

| Role | Hak akses |
| --- | --- |
| `user` | Mengisi mutabaah miliknya sendiri (item bawaan aktif + item tugas tambahan yang ditetapkan untuknya), melihat ringkasan/grafik 7 hari milik sendiri, mengunduh (output) CSV milik sendiri, dan mengganti nama profilnya. |
| `admin` | Semua hak `user` + membuat akun (ID/email & password) untuk **user** di bawahnya + **menambah/mengelola item tugas tambahan** untuk user di bawah otorisasinya (termasuk mengubah nama item yang dibuatnya) + melihat rekap mutabaah **hanya user yang dikelolanya** (7 hari terakhir, mengikuti item aktif) dan mengunduh rekapnya. |
| `super_admin` | Semua hak `user` + membuat akun (ID/email & password) untuk **admin** dan **user** + **mengelola item bawaan** global (label/aktif/nonaktif/urutan, tipe khusus tetap) + **menambah/mengelola semua item tugas tambahan** (termasuk mengubah nama) yang berlaku sesuai cakupan pembuat + melihat rekap **semua user** di bawah admin dan super admin (7 hari terakhir, mengikuti item aktif) dan mengunduh rekapnya + mengelola/mengubah role pengguna. |

- **Item bawaan**: salat wajib (0–5), tilawah (halaman), dzikir, sedekah. Super admin dapat mengubah label, status aktif, dan urutan tampil; tipe input/perilaku khusus tetap (tidak dapat diubah menjadi tipe lain). Item checklist baru tetap ditambahkan lewat *Item tugas tambahan*.
- **Item nonaktif** (bawaan maupun tugas tambahan): disembunyikan dari form pengisian dan **tidak dihitung** dalam target/progres/ringkasan/grafik/rekap & CSV. **Data historis yang tersimpan tetap ada** dan akan tampil/terhitung kembali bila item diaktifkan.
- **Item tugas tambahan**: item yang dibuat `super_admin` berlaku untuk semua `user`; item yang dibuat `admin` berlaku untuk `user` yang dikelolanya (`created_by` = admin tersebut). Item aktif muncul sebagai checklist pada mutabaah user terkait dan ikut dihitung dalam progres, ringkasan/grafik, serta rekap. Label item dapat diubah oleh pembuatnya atau oleh super admin.
- Akun baru selalu dikaitkan ke pembuatnya (`created_by`). `admin` hanya dapat melihat/merekap user yang ia buat (berada di bawahnya). `super_admin` dapat merekap seluruh `user` (baik yang dikelola admin maupun yang dibuat langsung oleh super admin).
- Pembuatan akun dilakukan lewat **Supabase Edge Function** (`create-user`) agar pembuatan user/password aman (tidak mengekspos service role key di client). Hak akses data tetap ditegakkan oleh RLS di database.

## Kredensial Super Admin Awal (untuk Anda)

Buat **1 akun super admin** pertama di Supabase, lalu promosikan menjadi `super_admin`:

1. Buka **Supabase Dashboard → Authentication → Users → Add user → Create new user**
   - **Email (ID):** `superadmin@mutabaah.id`
   - **Password:** `MutabaahSuper#2026`
   - Centang **Auto Confirm User** (jika tersedia)
2. Buka **SQL Editor** dan jalankan:
   ```sql
   update public.profiles
   set role = 'super_admin', created_by = null
   where email = 'superadmin@mutabaah.id';
   ```
3. Login di aplikasi dengan kredensial di atas. (Disarankan mengganti password di **Authentication → Users** setelah login pertama bila diperlukan.)

> Catatan: kredensial di atas adalah kredensial awal yang disiapkan untuk Anda; pastikan Anda yang menjalankan langkah pembuatan di project Supabase Anda dan simpan/amankan perubahannya.

## Setup Supabase

1. Buat project di [Supabase](https://supabase.com).
2. Buka **SQL Editor** dan jalankan isi file [`supabase/schema.sql`](supabase/schema.sql) untuk membuat tabel (termasuk `base_item_settings` untuk konfigurasi item bawaan), trigger, fungsi/hierarki role, dan kebijakan RLS. Jika Anda memperbarui deployment yang sudah ada, jalankan kembali schema ini agar tabel `base_item_settings` dan policy terkait tersedia (aman/idempoten).
3. Buka **Project Settings → API** dan salin **Project URL** serta **anon/public key**.
4. Isi konfigurasi di [`supabase-config.js`](supabase-config.js):
   ```js
   export const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
   export const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
   ```
5. Deploy Edge Function pembuatan akun (wajib agar admin/super admin bisa membuat ID & password):
   - Install & login [Supabase CLI](https://supabase.com/docs/guides/cli), lalu tautkan project:
     ```bash
     supabase login
     supabase link --project-ref <PROJECT_REF>
     supabase functions deploy create-user
     ```
   - Function berada di [`supabase/functions/create-user/index.ts`](supabase/functions/create-user/index.ts). Function ini memverifikasi role pemanggil (super admin boleh buat admin/user, admin hanya boleh buat user) lalu membuat user via service role.
6. Lakukan **bootstrap super admin pertama** seperti bagian di atas.
7. (Disarankan) Matikan pendaftaran publik agar akun hanya bisa dibuat oleh admin/super admin: **Authentication → Providers → Email** → nonaktifkan "Allow new users to sign up" (sesuaikan dengan kebijakan project Anda).

## Menjalankan Lokal

Aplikasi memakai ES modules dan import Supabase dari CDN, jadi jalankan melalui server lokal (bukan buka file langsung):

```bash
python -m http.server 8000
# atau: python3 -m http.server 8000
```

Lalu buka <http://localhost:8000>.

## Deploy ke Vercel

1. Push repository ini ke GitHub/GitLab/Bitbucket.
2. Di [Vercel](https://vercel.com), **Add New Project** dan impor repository.
3. Framework preset: **Other** (static). Tidak perlu build command khusus; root berisi `index.html`.
4. Pastikan `supabase-config.js` sudah berisi URL dan anon key project Supabase yang benar (anon key aman diekspos di client; keamanan dijaga oleh RLS + edge function).
5. Deploy. Tambahkan domain Vercel Anda ke **Supabase → Authentication → URL Configuration** (Site URL / Redirect URLs) agar alur auth berjalan benar.

> Catatan: ini situs statis tanpa bundler, jadi environment variable Vercel tidak otomatis disuntikkan ke `supabase-config.js`. Isi nilai langsung di file tersebut. Edge Function `create-user` di-deploy ke Supabase (bukan ke Vercel) dengan perintah `supabase functions deploy create-user`.

## Struktur Data

- `profiles`: profil pengguna (`id`, `email`, `full_name`, `role` = `user`/`admin`/`super_admin`, `created_by`, `created_at`). `created_by` menyimpan siapa yang membuat/mengelola akun (hierarki).
- `mutabaah_entries`: entri harian per pengguna (`entry_date`, `prayer_count`, `quran_pages`, `dzikir`, `sedekah`, `notes`, `custom_checks`), unik per `(user_id, entry_date)`. Kolom bawaan menyimpan nilai historis; `custom_checks` menyimpan status checklist item tugas tambahan per item.
- `custom_items`: item tugas tambahan (`label`, `created_by`, `creator_role`, `is_active`) yang dibuat admin/super admin untuk bawahan sesuai otorisasi.
- `base_item_settings`: konfigurasi global 4 item bawaan (`key` = `prayer_count`/`quran_pages`/`dzikir`/`sedekah`, `label`, `is_active`, `sort_order`), dikelola oleh super admin. Tipe/perilaku khusus tiap key tetap.

Lihat definisi lengkap, helper hierarki, dan kebijakan RLS di [`supabase/schema.sql`](supabase/schema.sql).
