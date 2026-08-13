import { NextResponse } from "next/server";
import { isSenderAllowed } from "@/lib/whitelist";
import { parseScheduleCommand, toUnixTimestampWITA, generateReminderText } from "@/lib/ai";
import { sendToFonnte } from "@/lib/fonnte";
import { GROUP_IDS } from "@/lib/groups";
import { getTodaysReminders } from "@/lib/reminder"; // sesuaikan path kalau lokasi file lo beda

export const maxDuration = 30;

const TRIGGER_REGEX = /^(hello|hallo|halo|alo|allo|hey|pe|p|oy|oi)[\s,]*babu/i;
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
  const nameSender = payload.name

  if (!actualSender || !isSenderAllowed(actualSender)) {
    sendToFonnte(replyTarget, `sorry yeee ${nameSender}, yang bisa perintah aku cuman anggota paling inti😉`)
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

  try {
    const parsed = await parseScheduleCommand(text);
    if (!parsed) {
      await sendToFonnte(
        replyTarget,
        "Waduh, aku nggak paham maksud command-nya 🙏 Coba format: 'hello bot, ingetin [divisi] [tanggal/hari] jam [waktu] buat [tugas]', tambahin 'sekarang' buat kirim langsung, atau 'hello bot kirim/ingetin deadline mepet untuk [divisi] [jam/tanggal opsional]'."
      );
      return NextResponse.json({ ok: true, parsed: false });
    }

    const { intent, send_now, schedules, pesan } = parsed;

    // Gabungin semua divisi yang muncul di seluruh assignment -- dipakai buat validasi grup
    // dan generate pesan sekali per divisi (bukan per assignment, biar gak digenerate dobel).
    const unionDivisi = [...new Set(schedules.flatMap((s) => s.divisi))];

    const missingGroup = unionDivisi.find((d) => !GROUP_IDS[d]);
    if (missingGroup) {
      await sendToFonnte(replyTarget, `Divisi "${missingGroup}" nggak ketemu di daftar grup 🙏`);
      return NextResponse.json({ ok: true, error: "unknown divisi" });
    }

    const divisiLabel =
      unionDivisi.length === Object.keys(GROUP_IDS).length ? "semua divisi" : unionDivisi.join(", ");

    // Resolve isi pesan per divisi.
    // "custom" → semua divisi pakai pesan yang sama (dari user).
    // "deadline_mepet" → tiap divisi punya pesan sendiri, disusun AI dari data
    // tugas SAAT COMMAND DIPROSES. Kalau dijadwalkan, isi pesan tetap dari data
    // sekarang, bukan data pada saat pesan benar-benar terkirim nanti.
    const messageByDivisi = {}; // divisi -> string | null (null = skip, tidak ada deadline mepet)
    const genErrors = {};       // divisi -> error string

    if (intent === "custom") {
      for (const divisi of unionDivisi) messageByDivisi[divisi] = pesan;
    } else {
      const remindersByDivisi = getTodaysReminders();
      for (const divisi of unionDivisi) {
        const tasks = remindersByDivisi[divisi] || [];
        if (tasks.length === 0) {
          messageByDivisi[divisi] = null;
          continue;
        }
        try {
          messageByDivisi[divisi] = await generateReminderText(divisi, tasks);
        } catch (err) {
          console.error("generateReminderText failed:", divisi, err);
          genErrors[divisi] = String(err);
        }
        await sleep(150); // jaga rate limit Groq kalau divisi yang diminta banyak
      }
    }

    const skippedDivisi = unionDivisi.filter((d) => messageByDivisi[d] === null);
    const failedGenDivisi = Object.keys(genErrors);
    const sendableDivisi = new Set(unionDivisi.filter((d) => messageByDivisi[d]));

    if (sendableDivisi.size === 0) {
      let msg =
        intent === "deadline_mepet"
          ? "Nggak ada deadline yang mepet buat divisi yang diminta 👍"
          : "Nggak ada divisi yang bisa diproses 🙏";
      if (failedGenDivisi.length > 0) {
        msg += `\n\n⚠️ Gagal nyusun pesan buat: ${failedGenDivisi.join(", ")}, coba lagi.`;
      }
      await sendToFonnte(replyTarget, msg);
      return NextResponse.json({ ok: true, intent, skipped: skippedDivisi, failed_generation: failedGenDivisi });
    }

    // --- Kirim langsung sekarang, tanpa schedule ---
    if (send_now) {
      const results = [];
      for (const divisi of sendableDivisi) {
        try {
          const result = await sendToFonnte(GROUP_IDS[divisi], messageByDivisi[divisi]);
          results.push({ divisi, ok: true, result });
        } catch (err) {
          console.error("send-now job failed:", divisi, err);
          results.push({ divisi, ok: false, error: String(err) });
        }
        await sleep(250);
      }

      const successCount = results.filter((r) => r.ok).length;
      const failCount = results.length - successCount;
      const sentLabel = results.filter((r) => r.ok).map((r) => r.divisi).join(", ") || "-";

      let confirmText =
        intent === "deadline_mepet"
          ? `Siap tuan, rangkuman deadline mepet udah dikirim ke: *${sentLabel}* ✅`
          : `Siap tuan, pesan buat *${divisiLabel}* udah dikirim sekarang ✅`;

      if (skippedDivisi.length > 0) confirmText += `\n\nGak ada deadline mepet buat: ${skippedDivisi.join(", ")}.`;
      if (failedGenDivisi.length > 0) confirmText += `\n\n⚠️ Gagal nyusun pesan buat: ${failedGenDivisi.join(", ")}.`;
      if (failCount > 0) confirmText += `\n\n⚠️ ${failCount} grup gagal dikirim, coba ulangi command-nya.`;

      await sendToFonnte(replyTarget, confirmText);
      return NextResponse.json({ ok: true, intent, sent_now: successCount, failed: failCount, jobs: results });
    }

    // --- Terjadwal: tiap assignment (schedules[i]) punya divisi x tanggal x jam SENDIRI.
    // TIDAK cartesian-product lintas assignment -- itu penyebab bug lama (semua divisi
    // ketimpa jam divisi lain).
    const nowSec = Math.floor(Date.now() / 1000);
    const seen = new Set();
    const jobs = [];
    for (const { divisi: blockDivisi, target_dates: dates, target_times: times } of schedules) {
      for (const divisi of blockDivisi) {
        if (!sendableDivisi.has(divisi)) continue; // skip divisi yang emang gak ada yang perlu diingetin
        for (const date of dates) {
          for (const time of times) {
            const schedule = toUnixTimestampWITA(date, time);
            if (schedule <= nowSec) continue;

            // Dedupe key WAJIB pakai nama divisi, BUKAN groupId -- di dev, beberapa divisi
            // sengaja diarahkan ke satu grup test yang sama (lib/groups.js), jadi groupId
            // doang gak cukup buat bedain job antar divisi (ini yang bikin job "ketelen").
            const dedupeKey = `${divisi}|${schedule}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            jobs.push({ divisi, date, time, schedule, groupId: GROUP_IDS[divisi], pesan: messageByDivisi[divisi] });
          }
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

    // Ringkasan per divisi, biar akurat walau tiap divisi punya jam beda-beda.
    const scheduledByDivisi = {};
    for (const job of results.filter((r) => r.ok)) {
      if (!scheduledByDivisi[job.divisi]) scheduledByDivisi[job.divisi] = [];
      scheduledByDivisi[job.divisi].push(`${job.date} ${job.time}`);
    }
    const scheduleLines = Object.entries(scheduledByDivisi)
      .map(([divisi, times]) => `• ${divisi}: ${times.join(", ")} WITA`)
      .join("\n");

    let confirmText =
      intent === "deadline_mepet"
        ? `Siap tuan, ${successCount} reminder rangkuman deadline mepet udah dijadwalin:\n${scheduleLines}`
        : `Siap tuan, ${successCount} reminder udah dijadwalin:\n${scheduleLines}`;

    if (skippedDivisi.length > 0) confirmText += `\n\nGak ada deadline mepet buat: ${skippedDivisi.join(", ")}.`;
    if (failedGenDivisi.length > 0) confirmText += `\n\n⚠️ Gagal nyusun pesan buat: ${failedGenDivisi.join(", ")}.`;
    if (failCount > 0) confirmText += `\n\n⚠️ ${failCount} reminder gagal dijadwalin, coba ulangi command-nya.`;

    await sendToFonnte(replyTarget, confirmText);

    return NextResponse.json({ ok: true, intent, scheduled: successCount, failed: failCount, jobs: results });
  } catch (err) {
    console.error("schedule command error:", err);
    await sendToFonnte(replyTarget, "Waduh, ada error pas proses command-nya, coba lagi bentar ya 🙏").catch(() => {});
    return NextResponse.json({ ok: false, error: "internal error" });
  }
}