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
      if (t.is_overdue) label = `lewat dari deadline ${t.days_overdue} hari (${t.deadline_date})`;
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
- Bahasa santai tapi tetap sopan dan jelas, gaya anak organisasi/panitia kampus Indonesia
- Pakai emoji secukupnya, jangan berlebihan
- Untuk deadline yang "HARI INI", beri penekanan/urgensi tapi tetap positif dan memotivasi
- PENTING untuk item yang sudah "lewat dari deadline": JANGAN berasumsi tugasnya belum dikerjakan, dan JANGAN pakai nada menyalahkan atau menegur. Bisa jadi tugas itu sebenarnya sudah selesai tapi belum di-update statusnya. Framing yang tepat adalah minta konfirmasi/update status dengan ringan, misalnya menanyakan apakah sudah selesai atau ada kendala, bukan menuduh belum dikerjakan. Contoh nada: "boleh update kabarnya kak?" bukan "kok belum selesai".
- Jangan terlalu panjang, maksimal sekitar 100-150 kata
- Jangan pakai format markdown (**bold** dsb tidak akan tampil di WhatsApp, gunakan *bold* ala WhatsApp jika perlu)
- Tutup dengan kalimat yang encouraging, bukan menekan

Balas HANYA dengan isi pesannya saja, tanpa preamble atau penjelasan tambahan.`;

  const response = await ai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 600,
  });

  const text = response.choices[0]?.message?.content;
  return text ? text.trim() : "";
}