// import { OpenAI } from "openai";

// const ai = new OpenAI({
//   baseURL: "https://api.groq.com/openai/v1",
//   apiKey: process.env.AI_API_KEY,
// });

// /**
//  * Generate a single, friendly WhatsApp reminder message that bundles
//  * all tasks due for a divisi today, instead of sending one message per task.
//  */
// export async function generateReminderText(divisi, tasks) {
//   const taskList = tasks
//     .map((t) => {
//       let label;
//       if (t.is_overdue) label = `sudah lewat ${Math.abs(t.days_remaining)} hari`;
//       else if (t.is_today) label = "deadline HARI INI";
//       else if (t.days_remaining === 1) label = "deadline BESOK";
//       else label = `${t.days_remaining} hari lagi`;

//       const picInfo = t.pic ? ` (PJ: ${t.pic})` : "";
//       return `- ${t.tugas}${picInfo} — ${label} (${t.deadline_date})`;
//     })
//     .join("\n");

//   const prompt = `Kamu adalah asisten panitia workshop yang membuat pesan reminder WhatsApp untuk grup divisi "${divisi}" pada acara Workshop GCC 2026.

// Berikut daftar deadline yang perlu diingatkan hari ini:
// ${taskList}

// Buat SATU pesan WhatsApp yang:
// - Menggabungkan semua deadline di atas jadi satu pesan (jangan dipisah)
// - Bahasa santai tapi tetap sopan dan jelas, gaya anak organisasi/panitia kampus Indonesia
// - Pakai emoji secukupnya, jangan berlebihan
// - Kalau ada deadline yang "HARI INI" atau "sudah lewat", beri penekanan/urgensi lebih tapi tetap positif dan memotivasi (jangan bikin orang merasa disalahkan)
// - Jangan terlalu panjang, maksimal sekitar 100-150 kata
// - Jangan pakai format markdown (**bold** dsb tidak akan tampil di WhatsApp, gunakan *bold* ala WhatsApp jika perlu)
// - Tutup dengan kalimat yang encouraging, bukan menekan

// Balas HANYA dengan isi pesannya saja, tanpa preamble atau penjelasan tambahan.`;

//   const response = await ai.chat.completions.create({
//     model: "llama-3.3-70b-versatile",
//     messages: [{ role: "user", content: prompt }],
//     temperature: 0.4,
//     max_tokens: 600,
//   });

//   const text = response.choices[0]?.message?.content;
//   return text ? text.trim() : "";
// }

import { OpenAI } from "openai";

const ai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.AI_API_KEY,
});

/**
 * Generate a single, friendly WhatsApp reminder message that bundles
 * all tasks due for a divisi today, instead of sending one message per task.
 */
export async function generateReminderText(divisi, tasks) {
  const taskList = tasks
    .map((t) => {
      let label;
      if (t.is_overdue)
        label = `lewat dari deadline ${t.days_overdue} hari (${t.deadline_date})`;
      else if (t.is_today) label = "deadline HARI INI";
      else if (t.days_remaining === 1) label = "deadline BESOK";
      else label = `${t.days_remaining} hari lagi (${t.deadline_date})`;

      const picInfo = t.pic ? ` (PJ: ${t.pic})` : "";
      return `- ${t.tugas}${picInfo} — ${label}`;
    })
    .join("\n");

  const prompt = `Kamu adalah asisten panitia workshop yang membuat pesan reminder WhatsApp untuk grup divisi "${divisi}" pada acara Workshop GCC 2026.

Berikut daftar deadline yang perlu diingatkan hari ini:
${taskList}

Buat SATU pesan WhatsApp yang:
- Menggabungkan semua deadline di atas jadi satu pesan (jangan dipisah)
- Gaya nulisnya kayak orang beneran ngetik cepat di WA ke temen se-organisasi, BUKAN kayak template pesan otomatis. To the point, nggak muter-muter, nggak sok formal, nggak juga terlalu berusaha "menyemangati"
- Pakai emoji secukupnya (2-4 total), jangan taruh emoji di akhir tiap kalimat — cukup 1-2 titik yang emang perlu penekanan
- DILARANG pakai kalimat penutup generic seperti "Semangat!", "Gaskan!", "Kita pasti bisa", atau variasi template motivasi lain di akhir pesan. Kalau mau nutup, buat kalimat yang related langsung ke konteks task-nya (misal ngingetin due date terakhir, atau nawarin bantu kalau ada kendala) — bukan penutup yang bisa ditempel ke pesan apa aja
- DILARANG nambahin alasan/justifikasi kenapa tugas itu penting (misal "karena kita butuh ini untuk tahap berikutnya") kecuali itu emang ada di data. Fokus ke fakta: apa tugasnya, siapa PIC-nya, statusnya gimana
- Untuk deadline "HARI INI"/"BESOK": langsung sebutkan urgent-nya, tanpa berputar-putar, cukup sekali bilang bukan diulang-ulang dengan kata berbeda ("kelarin hari ini ya... gaskan sekarang juga... jangan sampai kelewat" — ini KEBANYAKAN, pilih SATU cara bilang urgent aja)
- Untuk item "lewat dari deadline": state fakta (lewat berapa hari) + minta update sekali, singkat, tanpa berasumsi belum dikerjakan. Jangan pakai kalimat pemanis atau permintaan maaf
- Kalau ada beberapa task dengan status beda-beda, susun singkat per task (boleh pakai baris baru per item), jangan digabung jadi satu kalimat panjang berbelit
- Total maksimal 60-100 kata — LEBIH PENDEK dari draft biasa, karena tiap kalimat harus mengandung informasi baru, bukan pengulangan
- Jangan pakai markdown (**bold**), pakai *bold* ala WhatsApp kalau perlu untuk nama tugas atau kata kunci status

Balas HANYA dengan isi pesannya saja, tanpa preamble atau penjelasan tambahan.`;

  const response = await ai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.6,
    max_tokens: 400,
  });

  const text = response.choices[0]?.message?.content;
  return text ? text.trim() : "";
}
