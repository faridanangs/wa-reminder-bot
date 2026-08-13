import { NextResponse } from "next/server";
import { isSenderAllowed } from "@/lib/whitelist";
import {
  parseScheduleCommand,
  toUnixTimestampWITA,
  generateReminderText,
} from "@/lib/ai";
import { sendToFonnte } from "@/lib/fonnte";
import { GROUP_IDS } from "@/lib/groups";
import { getTodaysReminders } from "@/lib/reminder"; // sesuaikan path kalau lokasi file lo beda

export const maxDuration = 30;

const TRIGGER_REGEX = /^(hello|hallo|hay|oi|halo)[\s,]*babu/i;
const MAX_TOTAL_SCHEDULES = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const recentlyProcessed = new Map();
const DEDUPE_TTL_MS = 2 * 60 * 1000;

function isDuplicateEvent(key) {
  const now = Date.now();
  for (const [k, ts] of recentlyProcessed) {
    if (now - ts > DEDUPE_TTL_MS) recentlyProcessed.delete(k);
  }
  if (recentlyProcessed.has(key)) return true;
  recentlyProcessed.set(key, now);
  return false;
}

// Command cuma trigger doang (+ kata basa-basi kayak "tolong"/"dong") tanpa instruksi nyata
// -> kirim panduan pemakaian, JANGAN dilempar ke AI classifier (hemat token, dan lebih
// jelas buat user daripada balesan "aku nggak paham command-nya").
const AFTER_TRIGGER_EMPTY_REGEX = /^[\s,.!]*(tolong|dong|please|woy|oi|ya)?[\s,.!]*$/i;

function buildHelpText() {
  const divisiList = Object.keys(GROUP_IDS).join(", ");
  return `*Cara pakai bot ini* 🤖 (awali pesan dengan "hello babu" / "hallo babu" / "hay babu" / "oi babu")

*1. Pesan custom ke divisi/grup:*
"hello babu, ingetin divisi acara untuk surpey lokasi tempat acara workshopnya sekarang"
"hello babu, besok jam 9 pagi ingetin divisi acara dan pdd untuk submit TOR"

*2. Rangkuman deadline mepet (otomatis dari data tugas):*
"hello babu, kirim deadline mepet buat humkes sekarang"
"hello babu, jam 3 sore ingetin semua divisi soal deadline mepet"

*3. Jam beda-beda per divisi dalam satu command:*
"hay babu tolong ingetin divisi humkes terkait deadline yang mepet nanti jam 21:00 PM, divisi acara jam 21:02 PM, divisi pdd jam 21:02 PM, divisi konsum jam 21:03 PM, divisi perkam jam 21:04 PM"

*4. Boleh campur deadline mepet & custom dalam satu command:*
"hello babu, tolong ingetin divisi humkes terkait deadline yang mepet nanti jam 21:00 PM, divisi acara jam 21:02 PM, terus besok jam 3 sore ingetin panitia umum soal rapat mingguan"

*5. Teks pesan sendiri persis (apit tanda kutip):*
hello babu, kirim ke panitia umum besok jam 12 siang dengan pesan ini "isi pesan lo di sini"

*6. Memiliki rentang waktu atau pesan yang berulang:*
'oi babu, nanti rentang jam 21:00 - 21:08,  dan setiap 2 menit ingatkan grup panitia inti untuk rapat dan gunakan text ini "isi textnya"'
'oi babu, mulai dari tgl 16 - 24 agustus setiap jam 12 siang kirim pesan ke grup panitia umum untuk membantu menyebar pamplet pendaftaran peserta'
'oi babu, mulai dari tgl 16 - 24 agustus setiap jam 12 siang dan 2 hari sekali kirim pesan ke grup panitia umum untuk membantu menyebar pamplet pendaftaran peserta'

Tambahin kata "sekarang" buat kirim langsung, atau kasih tanggal/jam buat dijadwalin.

Grup yang tersedia: ${divisiList}`;
}

export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // `sender` = ID chat asal (group id kalau dari grup, nomor pengirim kalau DM) -> dipakai buat BALAS.
  // `member` = nomor pribadi orang yang beneran ngetik pesan (cuma ada kalau pesan dari grup) -> dipakai buat CEK WHITELIST.
  const actualSender = payload.member || payload.sender;
  const replyTarget = payload.sender;
  const text = (payload.message || "").trim();

  if (!actualSender || !isSenderAllowed(actualSender)) {
    console.log("ignored: sender not allowed ->", actualSender);
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (!TRIGGER_REGEX.test(text)) {
    console.log("ignored: trigger not matched ->", JSON.stringify(text));
    return NextResponse.json({ ok: true, ignored: true });
  }

  const eventKey = `${actualSender}:${text}:${payload.timestamp || ""}`;
  if (isDuplicateEvent(eventKey)) {
    console.log("ignored: duplicate webhook event ->", eventKey);
    return NextResponse.json({ ok: true, ignored: true, duplicate: true });
  }

  const afterTrigger = text.replace(TRIGGER_REGEX, "");
  if (AFTER_TRIGGER_EMPTY_REGEX.test(afterTrigger)) {
    await sendToFonnte(replyTarget, buildHelpText()).catch(() => {});
    return NextResponse.json({ ok: true, help: true });
  }

  try {
    const parsed = await parseScheduleCommand(text);
    if (!parsed) {
      await sendToFonnte(
        replyTarget,
        "Waduh, aku nggak paham maksud command-nya 🙏 Ketik 'hello babu' aja (tanpa instruksi lain) buat liat panduan pemakaian."
      );
      return NextResponse.json({ ok: true, parsed: false });
    }

    const { send_now, schedules } = parsed;

    const unionDivisi = [...new Set(schedules.flatMap((s) => s.divisi))];
    const missingGroup = unionDivisi.find((d) => !GROUP_IDS[d]);
    if (missingGroup) {
      await sendToFonnte(replyTarget, `Divisi "${missingGroup}" nggak ketemu di daftar grup 🙏`);
      return NextResponse.json({ ok: true, error: "unknown divisi" });
    }

    // Generate teks deadline_mepet sekali per divisi (bukan per assignment), biar gak
    // manggil AI dobel kalau divisi yang sama kebetulan muncul di >1 assignment.
    const deadlineMepetDivisi = [
      ...new Set(schedules.filter((s) => s.intent === "deadline_mepet").flatMap((s) => s.divisi)),
    ];
    const deadlineMepetMessage = {}; // divisi -> string | null
    const genErrors = {}; // divisi -> error string

    if (deadlineMepetDivisi.length > 0) {
      const remindersByDivisi = getTodaysReminders();
      for (const divisi of deadlineMepetDivisi) {
        const tasks = remindersByDivisi[divisi] || [];
        if (tasks.length === 0) {
          deadlineMepetMessage[divisi] = null;
          continue;
        }
        try {
          deadlineMepetMessage[divisi] = await generateReminderText(divisi, tasks);
        } catch (err) {
          console.error("generateReminderText failed:", divisi, err);
          genErrors[divisi] = String(err);
        }
        await sleep(150);
      }
    }

    // Ratakan tiap assignment jadi entry per-divisi dengan pesan sudah di-resolve
    // (custom -> pesan dari assignment; deadline_mepet -> hasil generate di atas).
    const entries = [];
    for (const s of schedules) {
      for (const divisi of s.divisi) {
        const message = s.intent === "custom" ? s.pesan : deadlineMepetMessage[divisi];
        entries.push({ divisi, intent: s.intent, message, target_dates: s.target_dates, target_times: s.target_times });
      }
    }

    const sendableEntries = entries.filter((e) => e.message);
    const skippedDivisi = [
      ...new Set(entries.filter((e) => !e.message && e.intent === "deadline_mepet").map((e) => e.divisi)),
    ];
    const failedGenDivisi = Object.keys(genErrors);

    if (sendableEntries.length === 0) {
      let msg = "Nggak ada yang bisa diproses 🙏";
      if (skippedDivisi.length > 0) msg += `\n\nGak ada deadline mepet buat: ${skippedDivisi.join(", ")}.`;
      if (failedGenDivisi.length > 0) msg += `\n\n⚠️ Gagal nyusun pesan buat: ${failedGenDivisi.join(", ")}, coba lagi.`;
      await sendToFonnte(replyTarget, msg);
      return NextResponse.json({ ok: true, skipped: skippedDivisi, failed_generation: failedGenDivisi });
    }

    // --- Kirim langsung sekarang, tanpa schedule ---
    if (send_now) {
      const results = [];
      const sentDivisi = new Set();
      for (const e of sendableEntries) {
        if (sentDivisi.has(e.divisi)) continue; // hindari kirim dobel kalau divisi sama muncul di >1 assignment
        sentDivisi.add(e.divisi);
        try {
          const result = await sendToFonnte(GROUP_IDS[e.divisi], e.message);
          results.push({ divisi: e.divisi, ok: true, result });
        } catch (err) {
          console.error("send-now job failed:", e.divisi, err);
          results.push({ divisi: e.divisi, ok: false, error: String(err) });
        }
        await sleep(250);
      }

      const successCount = results.filter((r) => r.ok).length;
      const failCount = results.length - successCount;
      const sentLabel = results.filter((r) => r.ok).map((r) => r.divisi).join(", ") || "-";

      let confirmText = `Siap tuan, pesan udah dikirim ke: *${sentLabel}* ✅`;
      if (skippedDivisi.length > 0) confirmText += `\n\nGak ada deadline mepet buat: ${skippedDivisi.join(", ")}.`;
      if (failedGenDivisi.length > 0) confirmText += `\n\n⚠️ Gagal nyusun pesan buat: ${failedGenDivisi.join(", ")}.`;
      if (failCount > 0) confirmText += `\n\n⚠️ ${failCount} grup gagal dikirim, coba ulangi command-nya.`;

      await sendToFonnte(replyTarget, confirmText);
      return NextResponse.json({ ok: true, sent_now: successCount, failed: failCount, jobs: results });
    }

    // --- Terjadwal ---
    const nowSec = Math.floor(Date.now() / 1000);
    const seen = new Set();
    const jobs = [];
    for (const e of sendableEntries) {
      for (const date of e.target_dates) {
        for (const time of e.target_times) {
          const schedule = toUnixTimestampWITA(date, time);
          if (schedule <= nowSec) continue;

          // Dedupe key pakai nama divisi (bukan groupId) -- di dev, beberapa divisi
          // sengaja diarahkan ke satu grup test yang sama (lihat lib/groups.js).
          const dedupeKey = `${e.divisi}|${schedule}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          jobs.push({ divisi: e.divisi, date, time, schedule, groupId: GROUP_IDS[e.divisi], pesan: e.message });
        }
      }
    }

    if (jobs.length === 0) {
      await sendToFonnte(replyTarget, "Semua tanggal/jam yang diminta udah lewat ya 🙏 Coba kasih jadwal yang masih ke depan, atau tambahin kata 'sekarang' kalau mau langsung dikirim.");
      return NextResponse.json({ ok: true, error: "all schedules in the past" });
    }

    if (jobs.length > MAX_TOTAL_SCHEDULES) {
      await sendToFonnte(
        replyTarget,
        `Kombinasi divisi x tanggal x jam-nya kebanyakan (${jobs.length} reminder) 🙏 Coba pecah jadi beberapa command biar aman.`
      );
      return NextResponse.json({ ok: true, error: "too many schedules" });
    }

    const results = [];
    for (const job of jobs) {
      try {
        const result = await sendToFonnte(job.groupId, job.pesan, { schedule: job.schedule });
        results.push({ ...job, ok: true, result });
      } catch (err) {
        console.error("send job failed:", job, err);
        results.push({ ...job, ok: false, error: String(err) });
      }
      await sleep(250);
    }

    const successCount = results.filter((r) => r.ok).length;
    const failCount = results.length - successCount;

    const scheduledByDivisi = {};
    for (const job of results.filter((r) => r.ok)) {
      if (!scheduledByDivisi[job.divisi]) scheduledByDivisi[job.divisi] = [];
      scheduledByDivisi[job.divisi].push(`${job.date} ${job.time}`);
    }
    const scheduleLines = Object.entries(scheduledByDivisi)
      .map(([divisi, times]) => `• ${divisi}: ${times.join(", ")} WITA`)
      .join("\n");

    let confirmText = `Siap tuan, ${successCount} reminder udah dijadwalin:\n${scheduleLines}`;
    if (skippedDivisi.length > 0) confirmText += `\n\nGak ada deadline mepet buat: ${skippedDivisi.join(", ")}.`;
    if (failedGenDivisi.length > 0) confirmText += `\n\n⚠️ Gagal nyusun pesan buat: ${failedGenDivisi.join(", ")}.`;
    if (failCount > 0) confirmText += `\n\n⚠️ ${failCount} reminder gagal dijadwalin, coba ulangi command-nya.`;

    await sendToFonnte(replyTarget, confirmText);

    return NextResponse.json({ ok: true, scheduled: successCount, failed: failCount, jobs: results });
  } catch (err) {
    console.error("schedule command error:", err);
    await sendToFonnte(replyTarget, "Waduh, ada error pas proses command-nya, coba lagi bentar ya 🙏").catch(() => {});
    return NextResponse.json({ ok: false, error: "internal error" });
  }
}