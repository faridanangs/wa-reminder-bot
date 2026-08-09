/**
 * Script buat TES endpoint yang UDAH DI-DEPLOY ke Vercel, secara berkala.
 * Ini BUKAN lewat Vercel Cron (Hobby plan gak bisa jalan lebih dari 1x/hari),
 * tapi manggil URL production-mu langsung dari sini tiap N menit.
 *
 * Cocok buat liat hasil AI-generate + kirim Fonnte ke grup Tes1/Tes2
 * SEBELUM kamu aktifin cron asli & buka ke grup divisi beneran.
 *
 * Cara pakai:
 *   node scripts/test-prod-interval.js --url=https://xxx.vercel.app/api/cron/reminder
 *   node scripts/test-prod-interval.js --url=https://xxx.vercel.app/api/cron/reminder --interval=1
 *   node scripts/test-prod-interval.js --url=https://xxx.vercel.app/api/cron/reminder --count=5
 *
 * WAJIB set CRON_SECRET di .env lokal, sama persis dengan yang di Vercel env vars.
 */

import "dotenv/config";

const args = process.argv.slice(2);

const urlArg = args.find((a) => a.startsWith("--url="));
if (!urlArg) {
  console.log("❌ Wajib kasih --url=https://your-app.vercel.app/api/cron/reminder\n");
  process.exit(1);
}
const url = urlArg.split("=")[1];

const intervalArg = args.find((a) => a.startsWith("--interval="));
const intervalMinutes = intervalArg ? Number(intervalArg.split("=")[1]) : 1;

const countArg = args.find((a) => a.startsWith("--count="));
const maxCount = countArg ? Number(countArg.split("=")[1]) : null;

const dateArg = args.find((a) => a.startsWith("--date="));
const testDate = dateArg ? dateArg.split("=")[1] : null;

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.log("❌ CRON_SECRET tidak ditemukan di .env lokal. Samakan dengan Vercel env vars.\n");
  process.exit(1);
}

const finalUrl = testDate ? `${url}?date=${testDate}` : url;

console.log(`\n🔁 Tes endpoint production tiap ${intervalMinutes} menit`);
console.log(`   URL: ${finalUrl}`);
console.log(`   Batas: ${maxCount ? `${maxCount}x lalu berhenti` : "tanpa batas (Ctrl+C buat stop)"}\n`);

let counter = 0;

async function hitEndpoint() {
  counter++;
  const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
  console.log(`--- Panggilan #${counter} (${waktu} WITA) ---`);

  try {
    const res = await fetch(finalUrl, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = await res.json();
    console.log(`   Status: ${res.status}`);
    console.log("   Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(`   ❌ Gagal hit endpoint: ${err.message}`);
  }
  console.log("");

  if (maxCount && counter >= maxCount) {
    console.log(`Selesai. Sudah hit ${counter}x sesuai batas --count.\n`);
    process.exit(0);
  }
}

hitEndpoint();
const timer = setInterval(hitEndpoint, intervalMinutes * 60 * 1000);

process.on("SIGINT", () => {
  clearInterval(timer);
  console.log(`\n🛑 Dihentikan manual. Total sudah hit: ${counter}x.\n`);
  process.exit(0);
});