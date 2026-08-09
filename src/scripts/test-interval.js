/**
 * Script buat tes KONEKSI & PENGIRIMAN Fonnte secara berkala,
 * TANPA melibatkan AI atau data deadline asli.
 *
 * Kirim pesan simpel tiap N menit ke grup Tes (Tes1/Tes2 di lib/groups.js),
 * berguna buat mastiin device Fonnte stabil, delay/rate limit aman,
 * dan grup ID-nya bener SEBELUM nyoba kirim reminder beneran.
 *
 * Cara pakai:
 *   node scripts/test-interval.js                        -> ke Tes1, tiap 2 menit, sampe di-stop manual (Ctrl+C)
 *   node scripts/test-interval.js --target=Tes2           -> ke Tes2
 *   node scripts/test-interval.js --interval=1            -> tiap 1 menit
 *   node scripts/test-interval.js --count=5                -> berhenti otomatis setelah 5x kirim
 */

import "dotenv/config";
import { sendToFonnte } from "../lib/fonnte.js";
import { GROUP_IDS } from "../lib/groups.js";

const args = process.argv.slice(2);

const targetArg = args.find((a) => a.startsWith("--target="));
const targetName = targetArg ? targetArg.split("=")[1] : "Tes1";

const intervalArg = args.find((a) => a.startsWith("--interval="));
const intervalMinutes = intervalArg ? Number(intervalArg.split("=")[1]) : 2;

const countArg = args.find((a) => a.startsWith("--count="));
const maxCount = countArg ? Number(countArg.split("=")[1]) : null; // null = jalan terus sampe Ctrl+C

const target = GROUP_IDS[targetName];
if (!target) {
  console.log(`❌ Group "${targetName}" tidak ditemukan di lib/groups.js. Cek nama key-nya.\n`);
  process.exit(1);
}

console.log(`\n🔁 Tes interval kirim pesan ke grup: ${targetName} (${target})`);
console.log(`   Interval: tiap ${intervalMinutes} menit`);
console.log(`   Batas kirim: ${maxCount ? `${maxCount}x lalu berhenti` : "tanpa batas (stop manual pakai Ctrl+C)"}\n`);

let counter = 0;

async function kirimTes() {
  counter++;
  const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
  const message = `🔔 [TES OTOMATIS #${counter}] Ping dari sistem reminder — ${waktu} WITA.\nKalau pesan ini muncul, koneksi Fonnte & grup ID aman ✅`;

  console.log(`--- Kirim #${counter} (${waktu} WITA) ---`);
  try {
    const result = await sendToFonnte(target, message);
    console.log("   ✅ Hasil Fonnte:", JSON.stringify(result));
  } catch (err) {
    console.log(`   ❌ Gagal kirim: ${err.message}`);
  }
  console.log("");

  if (maxCount && counter >= maxCount) {
    console.log(`Selesai. Sudah kirim ${counter}x sesuai batas --count.\n`);
    process.exit(0);
  }
}

// Kirim pertama langsung, baru lanjut interval
kirimTes();
const timer = setInterval(kirimTes, intervalMinutes * 60 * 1000);

// Biar bisa di-stop rapi pakai Ctrl+C
process.on("SIGINT", () => {
  clearInterval(timer);
  console.log(`\n🛑 Dihentikan manual. Total sudah kirim: ${counter}x.\n`);
  process.exit(0);
});