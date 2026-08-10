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
- Bahasa santai gaya anak organisasi/panitia kampus, TAPI to the point dan jelas — bukan basa-basi panjang, bukan muter-muter, bukan sok formal juga
- Pakai emoji secukupnya, jangan berlebihan (2-5 emoji total)
- Untuk deadline "HARI INI" atau "BESOK": to the point, jelas bahwa ini urgent, boleh pakai kata seperti "gaskan", "kelarin hari ini ya", "jangan sampai kelewat" — tegas tapi tetap suportif, bukan mengancam
- Untuk item "lewat dari deadline": tetap tegas soal statusnya perlu di-update SEKARANG (bukan opsional, bukan "kapan-kapan boleh update"), tapi jangan menuduh belum dikerjakan. Formulanya: state fakta (sudah lewat X hari) + minta update konkret, TANPA basa-basi permintaan maaf berlebihan atau kalimat pemanis yang bikin pesannya kehilangan urgensi. Contoh nada yang benar: "udah lewat 2 hari nih, kalau udah kelar tolong kabarin, kalau masih proses juga oke tapi kabarin progressnya ya" — jelas, actionable, tapi tidak menuduh.
- Hindari kalimat pembuka/penutup yang terlalu panjang dan generic seperti "Semangat terus ya teman-teman kita pasti bisa melalui semua ini bersama-sama". Langsung ke isi, baru penutup singkat 1 kalimat yang encouraging tapi natural (bukan template motivasi).
- Jangan terlalu panjang, maksimal sekitar 80-120 kata
- Jangan pakai format markdown (**bold** dsb tidak akan tampil di WhatsApp, gunakan *bold* ala WhatsApp jika perlu untuk menandai nama tugas atau kata "HARI INI"/"lewat deadline")

Balas HANYA dengan isi pesannya saja, tanpa preamble atau penjelasan tambahan.`;

  const response = await ai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
    max_tokens: 500,
  });

  const text = response.choices[0]?.message?.content;
  return text ? text.trim() : "";
}
