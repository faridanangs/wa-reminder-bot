# GCC 2026 — Auto Reminder Deadline Panitia

Sistem serverless (Next.js) yang otomatis kirim reminder deadline harian ke
grup WhatsApp tiap divisi panitia, lewat Fonnte (paket **free**, text only).

## Cara kerja singkat

1. Vercel Cron trigger `GET /api/send-reminder` tiap hari jam **12:00 WITA**.
2. Endpoint cek `lib/deadlines.json` → cari task yang hari ini masuk window
   reminder (`reminder_start_date` s/d `deadline_date`).
3. Task-task yang ketemu di-**group per divisi**, lalu di-generate jadi
   **satu pesan gabungan** per divisi pakai Claude API (bukan kirim
   satu-satu per task — biar gak spam).
4. Pesan dikirim ke grup WA masing-masing divisi lewat Fonnte.
5. Kalau hari ini gak ada task yang masuk window → grup itu gak dapat pesan
   sama sekali (silent, gak ganggu).

## Setup

```bash
npm install
cp .env.example .env.local
# isi FONNTE_TOKEN, ANTHROPIC_API_KEY, CRON_SECRET di .env.local
```

### Isi environment variable

- `FONNTE_TOKEN` — token device dari dashboard [fonnte.com](https://fonnte.com)
- `ANTHROPIC_API_KEY` — dari [console.anthropic.com](https://console.anthropic.com)
- `CRON_SECRET` — string acak bebas, buat proteksi endpoint dari trigger sembarangan

### Deploy ke Vercel

1. Push project ini ke GitHub repo.
2. Import repo di [vercel.com](https://vercel.com).
3. Set environment variables di Vercel dashboard (sama seperti `.env.local`).
4. Vercel otomatis baca `vercel.json` dan aktifkan cron-nya.

## Testing manual (sebelum deploy / sebelum yakin jadwalnya benar)

Endpoint bisa dites manual dengan curl, termasuk simulasi tanggal tertentu
lewat query param `?date=YYYY-MM-DD` (berguna buat ngecek reminder yang
jatuh di masa depan tanpa nunggu tanggalnya beneran tiba):

```bash
curl "https://your-app.vercel.app/api/send-reminder?date=2026-08-09" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Response akan menunjukkan divisi mana yang dapat reminder, task apa saja,
dan isi pesan yang di-generate — **tanpa perlu nunggu cron jalan beneran**.

⚠️ Perhatian: memanggil endpoint ini (dengan atau tanpa `?date=`) akan
BENERAN mengirim pesan WA kalau ada task yang masuk window hari itu. Kalau
cuma mau lihat hasil tanpa kirim pesan sungguhan, komen dulu baris
`sendToFonnte(...)` di `app/api/send-reminder/route.ts` saat testing.

## Update / tambah deadline baru

Edit langsung `lib/deadlines.json`. Format tiap item:

```json
{
  "id": "divisi-01",
  "divisi": "NamaDivisi",
  "tugas": "Deskripsi tugas",
  "pic": "Nama PJ (opsional, boleh kosong)",
  "start_date": "YYYY-MM-DD",
  "deadline_date": "YYYY-MM-DD",
  "duration_days": 7,
  "reminder_start_date": "YYYY-MM-DD"
}
```

`reminder_start_date` dihitung dengan rumus: reminder mulai begitu ~30%
durasi tugas sudah berjalan (mundur dari deadline), dibatasi minimal 2 hari
dan maksimal 10 hari sebelum deadline. Kalau nambah task baru manual, hitung
`reminder_start_date`-nya pakai rumus ini atau minta bantuan buat hitungin.

## Keterbatasan (Fonnte free plan)

- ❌ Tidak bisa kirim gambar/attachment (perlu upgrade ke paket
  super/advanced/ultra kalau butuh ini nanti)
- ❌ Tidak bisa mention/tag orang tertentu atau `@all` (API Fonnte gak
  punya parameter ini sama sekali, di semua paket)
- ✅ Kirim teks ke grup — gratis, unlimited waktu, cukup buat use case ini

## Struktur file

```
app/api/send-reminder/route.ts   ← endpoint yang dipanggil cron
lib/deadlines.json               ← data semua deadline (edit di sini kalau ada perubahan)
lib/groups.ts                    ← mapping divisi -> WA Group ID
lib/reminder.ts                  ← logic cek & group reminder harian
lib/ai.ts                        ← generate teks pesan pakai Claude
lib/fonnte.ts                    ← kirim pesan ke Fonnte
vercel.json                      ← jadwal cron (12:00 WITA / 04:00 UTC)
```
