# Mutabaah Yaumiah

Aplikasi pencatatan amalan harian (mutabaah) berbasis web, terhubung ke **Supabase** (auth + database) dan siap deploy di **Vercel**.

## Fitur

- Login menggunakan ID atau email dan kata sandi; tidak ada pendaftaran publik
- Pencatatan amalan harian per akun melalui satu kategori **item isian** (checklist, angka, daftar pilihan, atau teks) dan catatan refleksi
- Navigasi tanggal & progres harian (berdasarkan item aktif)
- Ringkasan 7 hari terakhir milik sendiri: total mingguan + grafik per item isian aktif
- Unduh/output ringkasan 7 hari (CSV) untuk akun sendiri
- Admin dapat mengganti ID login dan/atau mereset kata sandi user yang dikelolanya; super admin dapat melakukannya untuk akun user/admin
- Admin dapat menghapus user yang dikelolanya; super admin dapat menghapus akun user/admin
- Super admin dapat memindahkan user dari satu admin ke admin lain tanpa menghapus riwayat mutabaahnya
- Admin/super admin dapat menambah, mengubah nama, mengaktifkan/nonaktifkan, dan menghapus item isian sesuai cakupan role
- Admin/super admin dapat mengubah urutan item amalan dengan tombol naik/turun tanpa mengubah nilai historis
- 3 tingkat akses/role dengan hierarki pengelolaan akun: **user**, **admin**, **super_admin**
- Data tersimpan di Supabase (Postgres) dengan Row Level Security (RLS)
- Tampilan responsif

## Role & Hak Akses

Semua item amalan dikelola sebagai satu kategori **Item isian**. Admin dapat mengelola item untuk user di bawahnya; super admin dapat mengelola item global maupun item lain. Item dapat diubah namanya, dinonaktifkan, atau dihapus lunak dan dipulihkan tanpa menghapus nilai historis.

| Role | Hak akses |
| --- | --- |
| `user` | Mengisi item isian yang berlaku untuknya, melihat ringkasan/grafik 7 hari milik sendiri, dan mengunduh CSV milik sendiri. |
| `admin` | Semua hak `user` + membuat akun user di bawahnya + mengubah ID login/kata sandi dan menghapus user yang dikelolanya + menambah/mengelola item isian untuk user di bawah otorisasinya + melihat dan mengunduh rekap user yang dikelolanya. |
| `super_admin` | Semua hak `user` + membuat akun admin/user + mengelola akun dan role + memindahkan user antar-admin + menambah/mengelola item isian global atau item buatan admin + melihat dan mengunduh rekap semua user. |

- **Item isian**: item `super_admin` berlaku untuk semua user; item `admin` berlaku untuk user yang dikelolanya (`created_by` = admin tersebut). Jenis input dapat berupa checklist, angka, daftar pilihan (opsi ditentukan saat membuat item), atau teks. Pembuat dan super admin dapat mengubah nama, mengaktifkan/nonaktifkan, menghapus, atau memulihkan item. Penghapusan bersifat lunak; nilai historis tetap tersimpan. Nilai harian disimpan pada `custom_checks`.
- **Migrasi item lama**: empat item yang sebelumnya bawaan (salat wajib, tilawah, dzikir, sedekah) dikonversi menjadi item isian. Jalankan ulang `supabase/schema.sql` setelah bootstrap super admin untuk membuat item konversi dan memindahkan data historisnya. Sebelum migrasi dijalankan, formulir tetap menampilkan dan menyimpan item bawaan beserta nilai lamanya.
- Akun baru selalu dikaitkan ke pembuatnya (`created_by`). `admin` hanya dapat melihat/merekap user yang ia buat (berada di bawahnya). `super_admin` dapat merekap seluruh `user` (baik yang dikelola admin maupun yang dibuat langsung oleh super admin).
- Pemindahan user mengganti `created_by` ke admin tujuan; akun dan seluruh entri mutabaah user tetap sama. Penghapusan user menghapus akun autentikasi dan data terkait. Jika admin dihapus, user yang dikelolanya tidak ikut dihapus dan perlu dipindahkan ke admin lain oleh super admin.
- ID login harus unik, 3–32 karakter (huruf, angka, titik, garis bawah, atau tanda hubung). Email opsional dan bisa ditambahkan pemilik akun di pengaturan profil. Login ID/email diproses lewat **Supabase Edge Function** (`login`), sedangkan pembuatan dan pengelolaan akun lewat `create-user` dan `manage-user`; service role key tidak terekspos di client.

## Kredensial Super Admin Awal (untuk Anda)

Buat **1 akun super admin** pertama di Supabase, lalu promosikan menjadi `super_admin`:

1. Buka **Supabase Dashboard → Authentication → Users → Add user → Create new user**
   - **Email awal:** `superadmin@mutabaah.id`
   - **Password:** buat kata sandi acak dan unik (minimal 12 karakter), lalu simpan di pengelola kata sandi
   - Centang **Auto Confirm User** (jika tersedia)
2. Buka **SQL Editor** dan jalankan:
   ```sql
   update public.profiles
   set role = 'super_admin', created_by = null
   where email = 'superadmin@mutabaah.id';
   ```
3. Login dengan email awal dan password di atas. ID login awalnya adalah UUID profil (`profiles.login_id`); ganti kata sandi lewat Supabase Dashboard jika diperlukan.

> Catatan: kredensial di atas adalah kredensial awal yang disiapkan untuk Anda; pastikan Anda yang menjalankan langkah pembuatan di project Supabase Anda dan simpan/amankan perubahannya.

## Setup Supabase

1. Buat project di [Supabase](https://supabase.com).
2. Buka **SQL Editor** dan jalankan isi file [`supabase/schema.sql`](supabase/schema.sql) untuk membuat tabel, trigger, fungsi/hierarki role, dan kebijakan RLS. Setelah membuat dan mempromosikan super admin pertama, jalankan ulang schema agar item lama dikonversi dan data historis dipindahkan ke item isian (aman/idempoten). Untuk project yang sudah memakai aplikasi, jalankan ulang schema agar kolom dan validasi opsi dropdown tersedia.
3. Buka **Project Settings → API** dan salin **Project URL** serta **anon/public key**.
4. Isi konfigurasi di [`supabase-config.js`](supabase-config.js):
   ```js
   export const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
   export const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
   ```
5. Deploy Edge Functions login, pembuatan akun, reset kredensial, dan pengelolaan akun:
   - Install & login [Supabase CLI](https://supabase.com/docs/guides/cli), lalu tautkan project:
     ```bash
     supabase login
     supabase link --project-ref <PROJECT_REF>
     supabase functions deploy create-user --no-verify-jwt
     supabase functions deploy login --no-verify-jwt
     supabase functions deploy reset-user-credentials --no-verify-jwt
     supabase functions deploy manage-user --no-verify-jwt
     ```
   - Function berada di [`supabase/functions/create-user/index.ts`](supabase/functions/create-user/index.ts), [`supabase/functions/login/index.ts`](supabase/functions/login/index.ts), [`supabase/functions/reset-user-credentials/index.ts`](supabase/functions/reset-user-credentials/index.ts), dan [`supabase/functions/manage-user/index.ts`](supabase/functions/manage-user/index.ts). `create-user` memverifikasi role pemanggil lalu membuat akun; `login` menerjemahkan ID/email ke akun autentikasi dan memvalidasi password; `reset-user-credentials` memverifikasi role serta cakupan pengelolaan sebelum mengubah ID dan/atau kata sandi; `manage-user` memverifikasi otorisasi sebelum menghapus akun atau memindahkan user. Gunakan `--no-verify-jwt`; function memvalidasi Authorization/role sendiri dan login memang tersedia sebelum autentikasi.
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

> Catatan: ini situs statis tanpa bundler, jadi environment variable Vercel tidak otomatis disuntikkan ke `supabase-config.js`. Isi nilai langsung di file tersebut. Edge Functions `create-user` dan `login` di-deploy ke Supabase (bukan ke Vercel).

## Struktur Data

- `profiles`: profil pengguna (`id`, `login_id`, `email` opsional, `full_name`, `role` = `user`/`admin`/`super_admin`, `created_by`, `created_at`). `created_by` menyimpan siapa yang membuat/mengelola akun (hierarki). Upgrade schema mengisi ID login akun lama dengan UUID profilnya.
- `mutabaah_entries`: entri harian per pengguna (`entry_date`, `notes`, `custom_checks`), unik per `(user_id, entry_date)`. Item isian menyimpan checklist, angka, pilihan, atau teks di `custom_checks`.
- `custom_items`: semua item isian (`label`, `input_type`, `options`, `created_by`, `creator_role`, `is_active`, `is_deleted`, `sort_order`). Opsi dropdown disimpan dalam `options`; `sort_order` hanya mengatur posisi tampilan; `legacy_key` menandai item hasil konversi empat item lama.
- Kolom lama pada `mutabaah_entries` dan tabel `base_item_settings` tetap dipakai sebagai kompatibilitas agar empat item bawaan dan nilainya tetap tampil sebelum migrasi selesai. Setelah item dikonversi, nilai harian disimpan pada `custom_checks`; kolom lama tetap dipertahankan.

Lihat definisi lengkap, helper hierarki, dan kebijakan RLS di [`supabase/schema.sql`](supabase/schema.sql).
