import { OpenAI } from "openai";
import { GROUP_IDS } from "./groups";


const ai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.AI_API_KEY,
});

const STATIC_DISCLAIMER =
  '\n\n_"Jika jobdesnya udah beres pesannya abaikan saja gaess, botnya berhenti ngingetin setelah 3 hari dari deadline_"';

/**
 * Generate a single, friendly WhatsApp reminder message that bundles
 * all tasks due for a divisi today, instead of sending one message per task.
 */
export async function generateReminderText(divisi, tasks) {
  const taskList = tasks
    .map((t) => {
      let label;
      if (t.is_overdue) label = `sudah lewat ${Math.abs(t.days_remaining)} hari`;
      else if (t.is_today) label = "deadline HARI INI";
      else if (t.days_remaining === 1) label = "deadline BESOK";
      else label = `${t.days_remaining} hari lagi`;

      const picInfo = t.pic ? ` (PJ: ${t.pic})` : "";
      return `- ${t.tugas}${picInfo} — ${label} (${t.deadline_date})`;
    })
    .join("\n");

  const prompt = `Kamu adalah rekan panitia divisi "${divisi}" pada Workshop GCC 2026 yang kebagian tugas ngingetin deadline ke grup WhatsApp. Posisikan diri seperti teman satu tim, BUKAN atasan yang menegur atau bot yang kaku.

Daftar deadline yang perlu disampaikan hari ini:
${taskList}

Tulis SATU pesan WhatsApp yang menggabungkan semua deadline di atas. Ikuti aturan nada berikut dengan ketat:

1. NADA: Santai-jelas ala anak organisasi kampus, tapi tidak berlebihan. Hindari dua ekstrem:
   - Terlalu kaku: jangan seperti memo formal/surat dinas.
   - Terlalu lembek: jangan basa-basi panjang, emoji bertumpuk, atau kalimat penyemangat yang berlebihan sampai terkesan tidak niat/genit.
   Target: to the point, hangat, dan terasa niat — seperti pesan dari teman yang beneran perhatian ke progres tim.

2. UNTUK TUGAS OVERDUE / DEADLINE HARI INI: Sampaikan dengan bingkai ajakan & solutif, JANGAN dengan nada menyalahkan atau mempertanyakan.
   - Hindari kalimat seperti "kenapa belum selesai", "kok belum dikerjain", "harusnya sudah kelar".
   - Gunakan bingkai maju ke depan, contoh arah kalimat: ajak segera diselesaikan, tawarkan bantuan, atau tanya kendala — tanpa menyudutkan siapa pun.

3. UNTUK PIC/PJ kalo tidak ada namanya jangan disebut: Sebutkan nama sekadar sebagai info "siapa pegang tugas ini", bukan sebagai sorotan atau tekanan di depan grup. Jangan buat kalimat yang terkesan memanggil/nge-tag seseorang secara personal untuk diminta pertanggungjawaban. Cukup informatif, natural, dan tidak dramatis.

4. JAGA PESAN TETAP RINGKAS DAN FOKUS. Pesan ini dibaca oleh seluruh anggota grup divisi, termasuk yang tidak terkait langsung ke tugas-tugas ini — jadi hindari kalimat panjang, pengulangan, atau nada urgent berlebihan yang bisa terasa mengganggu/spamm buat anggota lain. Maksimal sekitar 100-150 kata.

5. Kalau ada kendala, cukup satu kalimat singkat yang membuka ruang diskusi di grup — tidak perlu dijelaskan panjang.

6. FORMAT: Tanpa markdown (**bold** tidak akan tampil di WhatsApp) — gunakan *bold* ala WhatsApp secukupnya, jangan berlebihan. Boleh pakai emoji, tapi secukupnya (bukan tiap baris).

7. Tutup dengan satu kalimat singkat yang encouraging dan hangat — bukan menekan, bukan juga generik/klise.

Balas HANYA dengan isi pesannya saja, tanpa preamble, tanpa penjelasan tambahan, tanpa tanda kutip pembuka/penutup.`;

  const response = await ai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 600,
  });

  const text = response.choices[0]?.message?.content;
  return text ? text.trim() + STATIC_DISCLAIMER : "";
}



/**
 * Parse a freeform WA scheduling command into structured data.
 * Returns null if the message isn't a valid schedule command
 * (missing divisi, unparseable time, dst).
 */
export async function parseScheduleCommand(rawText) {
  const validDivisi = Object.keys(GROUP_IDS);

  // Kasih AI referensi waktu "sekarang" dalam WITA supaya "besok jam 12 siang"
  // bisa di-resolve dengan benar, bukan pakai UTC server.
  const nowWITA = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());

  const prompt = `Kamu adalah parser command untuk bot WhatsApp panitia. User mengirim pesan yang berisi perintah untuk menjadwalkan reminder ke grup divisi tertentu.

Waktu sekarang (WITA): ${nowWITA}

Divisi yang valid HANYA: ${validDivisi.join(", ")}

Pesan dari user:
"${rawText}"

Ekstrak informasi berikut dan balas HANYA dengan JSON (tanpa markdown, tanpa penjelasan):
{
  "valid": boolean,           // false kalau bukan command penjadwalan, divisi tidak dikenali, atau waktu tidak jelas
  "divisi": string | null,    // harus persis salah satu dari daftar valid di atas
  "target_date": string|null, // format YYYY-MM-DD, dalam WITA
  "target_time": string|null, // format HH:mm (24 jam), dalam WITA
  "pesan": string | null      // isi pesan yang harus dikirim ke grup, tulis ulang jadi kalimat WA yang natural
}`;

  const response = await ai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    max_tokens: 300,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    if (!parsed.valid || !parsed.divisi || !parsed.target_date || !parsed.target_time) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Convert a WITA date+time string into a unix timestamp (seconds).
 */
export function toUnixTimestampWITA(dateStr, timeStr) {
  // WITA = UTC+8, no DST.
  const isoUTC = `${dateStr}T${timeStr}:00+08:00`;
  return Math.floor(new Date(isoUTC).getTime() / 1000);
}