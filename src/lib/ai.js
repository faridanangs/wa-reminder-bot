import { OpenAI } from "openai";
import { GROUP_IDS } from "./groups";

const ai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.AI_API_KEY,
});

const STATIC_DISCLAIMER =
  '\n\n_"Jika jobdesnya udah beres pesannya abaikan saja gaess, botnya berhenti ngingetin setelah 3 hari dari deadline_"';

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

0. WAJIB DIBUKA dengan sapaan hangat ke tim divisi, contoh gaya (jangan disalin persis, variasikan): "Halo, teman-teman divisi ${divisi}! 👋" atau "Hai tim ${divisi}~". Jangan langsung nyemplung ke daftar deadline tanpa sapaan.

1. NADA: Ramah tapi tegas — hangat kayak ngomong ke teman satu tim, tapi tetap jelas dan lugas soal apa yang perlu dilakukan, BUKAN pesan yang datar/dingin/kaku kayak notifikasi sistem. Hindari dua ekstrem:
   - Terlalu kaku/dingin: jangan seperti memo formal, surat dinas, atau notifikasi otomatis tanpa rasa.
   - Terlalu lembek: jangan basa-basi panjang, emoji bertumpuk, atau kalimat penyemangat berlebihan sampai terkesan tidak niat/genit.
   Target: kayak teman yang beneran perhatian ke progres tim, TAPI juga jelas ngasih tau ini penting dan perlu ditindaklanjuti — bukan sekadar info lewat.

2. UNTUK TUGAS OVERDUE / DEADLINE HARI INI: Sampaikan dengan bingkai ajakan & solutif, JANGAN dengan nada menyalahkan atau mempertanyakan.
   - Hindari kalimat seperti "kenapa belum selesai", "kok belum dikerjain", "harusnya sudah kelar".
   - Gunakan bingkai maju ke depan, contoh arah kalimat: ajak segera diselesaikan, tawarkan bantuan, atau tanya kendala — tanpa menyudutkan siapa pun. Tegas boleh, tapi tegas ke ARAH TINDAKAN, bukan tegas menyalahkan.

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
 * Cari blok teks yang diapit tanda kutip di command mentah user.
 * Murni regex, TIDAK lewat LLM -- supaya teks literal disalin byte-per-byte,
 * termasuk emoji, markdown WhatsApp, dan line break.
 */
function extractQuotedLiteral(rawText) {
  const straight = rawText.match(/"([\s\S]+)"/);
  if (straight) return { fullMatch: straight[0], content: straight[1] };

  const curly = rawText.match(/“([\s\S]+)”/);
  if (curly) return { fullMatch: curly[0], content: curly[1] };

  return null;
}

/**
 * Classifier + parser. SATU command bisa punya BEBERAPA "assignment"
 * (kelompok divisi+jadwal+intent), dan tiap assignment BEBAS punya intent
 * sendiri -- "custom" atau "deadline_mepet" -- jadi satu command BOLEH
 * campur keduanya (misal: "humkes jam 1 soal deadline mepet, terus jam 3
 * ingetin panitia umum soal rapat").
 *
 * Return:
 * {
 *   send_now: boolean,
 *   schedules: [{
 *     intent: "custom" | "deadline_mepet",
 *     divisi: string[],
 *     target_dates: string[],   // [] kalau send_now
 *     target_times: string[],   // [] kalau send_now
 *     pesan: string | null,     // isi wajib kalau intent "custom", null kalau "deadline_mepet"
 *   }]
 * }
 * atau null kalau command tidak valid/tidak dikenali.
 */
export async function parseScheduleCommand(rawText) {
  const validDivisi = Object.keys(GROUP_IDS);
  const now = new Date();

  const quoted = extractQuotedLiteral(rawText);
  const literalPesan = quoted ? quoted.content : null;
  const textForAI = quoted ? rawText.replace(quoted.fullMatch, "[PESAN_LITERAL]") : rawText;

  const nowWITA = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);

  const nowDayNameWITA = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Makassar",
    weekday: "long",
  }).format(now);

  const prompt = `Kamu adalah classifier + parser command untuk bot WhatsApp panitia. User bisa minta SATU ATAU LEBIH hal sekaligus dalam satu pesan -- tiap permintaan jadi satu "assignment" dengan intent-nya SENDIRI:

A) intent "custom" — isi pesan, target divisi, dan kapan dikirim ditentukan user sendiri.

B) intent "deadline_mepet" — rangkuman deadline yang MEPET/DEKET/HAMPIR JATUH TEMPO buat divisi tertentu (kata kunci semacam "deadline mepet", "deadline yang deket", "kasih tau soal deadline"), TANPA isi pesan dari user -- pesan disusun otomatis dari data tugas oleh sistem, bukan tugas kamu.

PENTING: SATU command BOLEH campur kedua intent di assignment yang berbeda. Contoh: "humkes jam 1 soal deadline mepet, terus jam 3 ingetin panitia umum soal rapat" -> assignment pertama intent "deadline_mepet" buat Humkes jam 13:00, assignment kedua intent "custom" buat Panitia Umum jam 15:00 dengan pesan soal rapat. JANGAN paksa semua assignment pakai intent yang sama kalau usernya jelas minta dua hal berbeda.

Waktu sekarang (WITA): ${nowWITA}, hari ${nowDayNameWITA}.

Divisi yang valid HANYA: ${validDivisi.join(", ")}

Pesan dari user:
"${textForAI}"

CATATAN KHUSUS soal placeholder [PESAN_LITERAL] (kalau muncul di pesan user di atas):
- Itu artinya user SUDAH nulis pesan final sendiri di command aslinya (ditandai kutip), dan pesan itu WAJIB dipakai APA ADANYA -- kamu TIDAK PERLU dan TIDAK BOLEH menyusun ulang isinya.
- Assignment yang berkaitan dengan [PESAN_LITERAL] WAJIB intent "custom", dan field "pesan"-nya cukup isi string "[PESAN_LITERAL]" saja (nanti digantikan otomatis oleh sistem, bukan tugas kamu).
- Fokus kamu tetap cuma nentuin divisi, jadwal, dan assignment lain (kalau ada) dari sisa instruksi di command.

PENTING — SATU COMMAND BISA PUNYA BEBERAPA "ASSIGNMENT" (kelompok intent+divisi+tanggal+jam):
- Kalau beberapa divisi disebut, SEMUA pakai tanggal/jam SAMA, DAN intent-nya SAMA -> itu SATU assignment, divisi-divisinya digabung dalam satu array.
- Kalau tiap divisi (atau kelompok divisi) punya tanggal/jam BEDA, ATAU intent-nya BEDA (custom vs deadline_mepet) -> WAJIB dipecah jadi assignment TERPISAH. JANGAN digabung jadi satu array besar -- itu bakal bikin jadwal/intent yang salah ke divisi yang salah.

ATURAN KHUSUS PASANGAN BERURUTAN (kalau divisi & jam disebut sebagai DUA LIST SEJAJAR, misal "jam A dan jam B kirim ke divisi X dan Y"):
- Kalau ada N divisi disebut berurutan (dipisah "dan"/koma) DAN ada N jam disebut berurutan dengan N SAMA PERSIS di kedua list, DAN TIDAK ADA kata yang menandakan semua divisi dapat SEMUA jam yang sama (seperti "keduanya", "semuanya di jam yang sama") -> ARTINYA PASANGAN BERURUTAN 1-ke-1 berdasarkan urutan penyebutan (divisi ke-i berpasangan dengan jam ke-i), TIDAK PEDULI list jam disebut sebelum atau sesudah list divisi. WAJIB dipecah jadi N assignment terpisah.
- Kalau jumlah divisi dan jam TIDAK sama, ATAU ada kata yang menandakan semua dapat jam yang sama -> BUKAN pasangan, satu assignment dengan semua divisi + semua jam (tiap divisi dapat SEMUA jam itu).

Contoh PASANGAN (2 divisi, 2 jam, sejajar, intent sama, asumsi hari ini "2026-08-13"):
Command: "jam 2:15 dan jam 2:16 kirim ke divisi perkam dan konsum, isinya cek logistik"
assignments: [
  { "intent": "custom", "divisi": ["Perkam"], "target_dates": ["2026-08-13"], "target_times": ["14:15"], "pesan": "Halo, teman-teman divisi Perkam! 👋 Yuk dicek logistiknya ya, biar persiapannya makin matang 🙏" },
  { "intent": "custom", "divisi": ["Konsumsi"], "target_dates": ["2026-08-13"], "target_times": ["14:16"], "pesan": "Halo, teman-teman divisi Konsumsi! 👋 Yuk dicek logistiknya ya, biar persiapannya makin matang 🙏" }
]

Contoh CAMPUR INTENT (asumsi hari ini "2026-08-13"):
Command: "humkes jam 1 soal deadline mepet, terus jam 3 ingetin panitia umum soal rapat evaluasi"
assignments: [
  { "intent": "deadline_mepet", "divisi": ["Humkes"], "target_dates": ["2026-08-13"], "target_times": ["13:00"], "pesan": null },
  { "intent": "custom", "divisi": ["Panitia Umum"], "target_dates": ["2026-08-13"], "target_times": ["15:00"], "pesan": "Halo, teman-teman Panitia Umum! 👋 Ada rapat evaluasi yang perlu diingetin nih, jangan lupa hadir ya. Kalau ada kendala boleh diomongin di sini 🙏" }
]

Contoh BUKAN pasangan (ada kata "keduanya" -> shared time, tetap satu assignment):
Command: "acara dan pdd besok jam 9 dan jam 2, keduanya dapat kedua jam itu, soal deadline mepet"
assignments: [
  { "intent": "deadline_mepet", "divisi": ["Acara", "PDD"], "target_dates": ["2026-08-14"], "target_times": ["09:00", "14:00"], "pesan": null }
]

Contoh INTERVAL TANGGAL (asumsi hari ini "2026-08-13"):
Command: "hello babu, mulai dari tgl 16-24 agustus setiap jam 12 siang dan setiap 2 hari ingatkan grup panitia umum untuk sebar pamflet pendaftaran"
assignments: [
  { "intent": "custom", "divisi": ["Panitia Umum"], "target_dates": ["2026-08-16","2026-08-18","2026-08-20","2026-08-22","2026-08-24"], "target_times": ["12:00"], "pesan": "Halo, Panitia Umum! 👋 Mulai tanggal 16 sampai 24 Agustus, yuk bantu sebar pamflet pendaftaran peserta ya. Makasih buat yang udah gerak duluan! 🙏" }
]

ATURAN UMUM (berlaku untuk semua assignment):
- DIVISI — cocokkan nama yang disebut user (termasuk singkatan/typo/tidak lengkap, misal "konsum" → "Konsumsi", "acr"/"acara" → "Acara") ke SALAH SATU nama persis di daftar valid, case-insensitive. "semua divisi"/"seluruh divisi" → string literal "ALL" (khusus kalau memang SEMUA divisi dapat perlakuan sama). Kalau tidak bisa dicocokkan ke satu pun nama valid → valid: false.
- send_now — berlaku untuk SELURUH command (bukan per-assignment): true kalau user minta dikirim SEKARANG/LANGSUNG/SAAT INI JUGA tanpa nyebut tanggal/jam. false kalau ADA tanggal/jam spesifik disebut buat nanti (termasuk "nanti jam ..." — itu berarti dijadwalkan, BUKAN sekarang).
  - PENGECUALIAN PENTING (baca teliti): kalau user menyebut kata "sekarang"/"langsung"/"saat ini juga" DAN semua jam yang disebutkan di command ini ada DALAM RADIUS ±10 MENIT dari waktu sekarang (${nowWITA}) -> jam itu BUKAN instruksi jadwal, itu cuma user nyebutin "jam segini nih sekarang" sebagai konteks/timestamp. WAJIB set send_now: true, dan ABAIKAN jam tsb sebagai target_time (assignment terkait cukup isi target_dates/target_times array kosong []).
    Contoh: waktu sekarang 08:31, command "sekarang ingetin Humkes jam 8:33 soal deadline mepet" -> send_now: true (8:33 cuma 2 menit dari sekarang, itu referensi "saat ini", BUKAN jadwal buat besok/nanti).
  - Kalau jam yang disebut jaraknya JAUH dari waktu sekarang (lebih dari ±10 menit, baik lebih cepat maupun lebih lambat) -> itu TETAP instruksi jadwal beneran (send_now: false) meskipun ada kata "sekarang" di command (kata "sekarang" di kasus ini biasanya cuma basa-basi pembuka kalimat, bukan penentu waktu kirim) -- ikuti aturan target_dates/target_times normal di bawah.
  - Jam yang disebut sebagai bagian dari ISI PESAN (misal "rapat evaluasi jam 4 sore besok" -- itu jam acara/rapatnya, BUKAN jam kapan reminder ini harus dikirim) TIDAK dihitung dalam pengecualian ini dan TIDAK jadi target_time -- itu cuma konten pesan biasa.
- Kalau send_now: true → target_dates dan target_times tiap assignment boleh array kosong [].
- Kalau send_now: false → tiap assignment WAJIB isi target_dates & target_times:
  - target_dates: array YYYY-MM-DD, urut menaik, mencakup SEMUA hari yang dimaksud (bukan cuma awal & akhir). Satu hari/tidak disebut tanggal tapi ada jam → 1 tanggal (hari ini kalau jam belum lewat, besok kalau sudah lewat, atau sesuai kata "besok"/"hari ini" eksplisit). Rentang nama hari → cari kemunculan hari itu PERTAMA pada/setelah besok sampai hari akhir. Rentang tanggal eksplisit → semua tanggal inklusif. Kalau rentang tanggal itu DISERTAI kata "setiap N hari"/"tiap N hari" (interval) → JANGAN ambil semua tanggal inklusif, tapi LOMPAT per N hari mulai dari tanggal awal (tanggal awal WAJIB ikut), lanjut +N, +2N, dst, selama TIDAK MELEWATI tanggal akhir (kalau lompatan pas kena tanggal akhir, ikut disertakan; kalau lompatan berikutnya lewat dari tanggal akhir, berhenti sebelum itu). Ambigu total → valid: false.
  - target_times: array HH:mm (24 jam), urut menaik, semua jam yang disebut untuk assignment itu. Konversi format 12 jam (AM/PM) ke 24 jam.

ATURAN KHUSUS intent "custom" — pesan (WAJIB diisi per assignment):
- Susun SATU pesan WhatsApp LENGKAP yang berdiri sendiri (orang yang belum baca command aslinya tetap paham) — JANGAN cuma menyalin potongan/ekor kalimat mentah.
- Kalau assignment ini berkaitan dengan [PESAN_LITERAL] → isi "pesan" cukup string "[PESAN_LITERAL]" (lihat CATATAN KHUSUS di atas).
- Kalau tidak, susun dengan struktur: (1) sapaan hangat ke divisi/panitia terkait sesuai konteks, misal "Halo, teman-teman divisi Konsumsi! 👋" atau "Halo, teman-teman Panitia Inti! 👋"; (2) kalimat jelas & lengkap soal apa yang perlu dilakukan (tulis ulang natural, perbaiki typo, JANGAN dipotong jadi fragmen); (3) nada ramah tapi tegas — jelas perlu ditindaklanjuti, tanpa kesan menyuruh kasar.

ATURAN KHUSUS intent "deadline_mepet":
- "pesan" WAJIB null — tidak dipakai, isi pesan disusun otomatis dari data tugas oleh sistem.

Balas HANYA JSON (tanpa markdown, tanpa penjelasan):
{
  "valid": boolean,
  "send_now": boolean,
  "assignments": [
    {
      "intent": "custom" | "deadline_mepet",
      "divisi": string[] | "ALL",
      "target_dates": string[],
      "target_times": string[],
      "pesan": string | null
    }
  ]
}`;

  const response = await ai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 1000,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    if (!parsed.valid) return null;
    if (!Array.isArray(parsed.assignments) || parsed.assignments.length === 0) return null;

    const sendNow = parsed.send_now === true;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

    const resolveDivisi = (d) => {
      if (d === "ALL") return validDivisi;
      if (Array.isArray(d) && d.length > 0) {
        const list = [...new Set(d)];
        if (!list.every((x) => validDivisi.includes(x))) return null;
        return list;
      }
      return null;
    };

    const schedules = [];
    for (const a of parsed.assignments) {
      if (a.intent !== "custom" && a.intent !== "deadline_mepet") return null;

      const divisiList = resolveDivisi(a.divisi);
      if (!divisiList) return null;

      let pesan = null;
      if (a.intent === "custom") {
        pesan = a.pesan;
        if (pesan === "[PESAN_LITERAL]") {
          if (!literalPesan) return null; // AI referensiin literal tapi nggak ketemu kutipan aslinya -> inkonsisten
          pesan = literalPesan;
        }
        if (!pesan) return null;
      }

      let dates = [];
      let times = [];
      if (!sendNow) {
        dates = [...new Set(a.target_dates || [])];
        if (dates.length === 0 || !dates.every((d) => dateRegex.test(d))) return null;
        dates.sort();

        times = [...new Set(a.target_times || [])];
        if (times.length === 0 || !times.every((t) => timeRegex.test(t))) return null;
        times.sort();
      }

      schedules.push({ intent: a.intent, divisi: divisiList, target_dates: dates, target_times: times, pesan });
    }

    return { send_now: sendNow, schedules };
  } catch {
    return null;
  }
}

export function toUnixTimestampWITA(dateStr, timeStr) {
  // WITA = UTC+8, no DST.
  const isoUTC = `${dateStr}T${timeStr}:00+08:00`;
  return Math.floor(new Date(isoUTC).getTime() / 1000);
}