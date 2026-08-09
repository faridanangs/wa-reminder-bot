/**
 * Script buat testing reminder system di local, SEBELUM deploy ke Vercel.
 *
 * Semua pesan (apapun divisinya) dikirim ke SATU grup "Tes" (lihat lib/groups.js),
 * bukan ke grup asli tiap divisi — jadi aman buat coba-coba tanpa nyepam panitia.
 * Tiap pesan dikasih label [SIMULASI <divisi>] biar kamu tau ini simulasi divisi mana.
 *
 * Cara pakai:
 *   node scripts/test-local.js                     -> pakai tanggal hari ini, BENERAN kirim ke grup Tes
 *   node scripts/test-local.js --date=2026-08-09    -> simulasi tanggal tertentu, BENERAN kirim
 *   node scripts/test-local.js --date=2026-08-09 --dry-run   -> cuma nge-print, TIDAK kirim ke Fonnte
 */

import "dotenv/config";
import { generateReminderText } from "../lib/ai.js"
import { sendToFonnte } from "../lib/fonnte.js"
import { GROUP_IDS } from "../lib/groups.js";
import { getTodaysReminders } from "../lib/reminder.js";

const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith("--date="));
const testDate = dateArg ? dateArg.split("=")[1] : null;
const dryRun = args.includes("--dry-run");

const now = testDate ? new Date(`${testDate}T12:00:00+08:00`) : new Date();

console.log(
  `\n🧪 Testing reminder system untuk tanggal: ${testDate || "hari ini"} (${now.toISOString()})`
);
console.log(dryRun ? "   Mode: DRY RUN (tidak kirim pesan beneran)\n" : "   Mode: KIRIM BENERAN ke grup Tes\n");

const grouped = getTodaysReminders(now);
const divisiList = Object.keys(grouped);

if (divisiList.length === 0) {
  console.log("❌ Tidak ada deadline yang perlu di-reminder di tanggal ini.\n");
  process.exit(0);
}

console.log(`✅ Ditemukan ${divisiList.length} divisi dengan reminder: ${divisiList.join(", ")}\n`);

const testTarget = GROUP_IDS.Tes;
if (!testTarget && !dryRun) {
  console.log("⚠️  GROUP_IDS.Tes tidak ditemukan di lib/groups.js — cek lagi filenya.\n");
  process.exit(1);
}

for (const divisi of divisiList) {
  const tasks = grouped[divisi];
  console.log(`--- ${divisi} (${tasks.length} task) ---`);
  tasks.forEach((t) => {
    const status = t.is_overdue
      ? `LEWAT ${Math.abs(t.days_remaining)} hari`
      : t.is_today
      ? "HARI INI"
      : `${t.days_remaining} hari lagi`;
    console.log(`   • ${t.tugas} [${status}]`);
  });

  console.log("   Generating pesan via AI...");
  let message;
  try {
    message = await generateReminderText(divisi, tasks);
  } catch (err) {
    console.log(`   ❌ Gagal generate pesan AI: ${err.message}\n`);
    continue;
  }

  console.log("\n   📝 Pesan yang di-generate:");
  console.log("   " + message.split("\n").join("\n   "));

  if (dryRun) {
    console.log("\n   🔒 [DRY RUN] Tidak dikirim ke Fonnte.\n");
    continue;
  }

  console.log(`\n   📤 Mengirim simulasi ke grup Tes...`);
  try {
    const labeledMessage = `[SIMULASI ${divisi}]\n\n${message}`;
    const result = await sendToFonnte(testTarget, labeledMessage);
    console.log("   ✅ Hasil Fonnte:", JSON.stringify(result));
  } catch (err) {
    console.log(`   ❌ Gagal kirim ke Fonnte: ${err.message}`);
  }
  console.log("\n");
}

console.log("Selesai.\n");
