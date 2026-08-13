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
 *
 * PENTING: ini murni regex, TIDAK lewat LLM sama sekali. Tujuannya supaya kalau
 * user kasih teks literal (mis. "gunakan text ini \"...\""), isinya BENAR-BENAR
 * disalin byte-per-byte -- termasuk emoji, markdown WhatsApp (*bold*, _italic_),
 * dan line break -- tanpa risiko "ditulis ulang" oleh model generatif.
 *
 * Support tanda kutip lurus ("...") dan smart quotes ("...") yang kadang muncul
 * dari auto-correct keyboard HP. Greedy match -> ambil dari kutip PERTAMA sampai
 * kutip TERAKHIR (asumsi: cuma ada satu blok pesan literal per command).
 *
 * Return null kalau tidak ketemu kutipan.
 */
function extractQuotedLiteral(rawText) {
  const straight = rawText.match(/"([\s\S]+)"/);
  if (straight) return { fullMatch: straight[0], content: straight[1] };

  const curly = rawText.match(/“([\s\S]+)”/);
  if (curly) return { fullMatch: curly[0], content: curly[1] };

  return null;
}

/**
 * Classifier + parser. Dua intent, DUA-DUANYA bisa send_now ATAU dijadwalkan:
 *
 * - "custom": isi pesan ditentukan user sendiri (atau disusun ulang AI dari command).
 * - "deadline_mepet": isi pesan disusun otomatis dari data tugas per divisi
 *   (pesan = null di sini, di-generate belakangan oleh generateReminderText).
 *
 * Satu command bisa punya BEBERAPA "assignment" (kelompok divisi+tanggal+jam) --
 * misal "humkes jam 1, acara jam 2" jadi DUA assignment terpisah, masing-masing
 * dengan target_dates/target_times sendiri. Ini supaya tiap divisi dijadwalkan
 * di jam yang benar-benar dimaksud, bukan cartesian product semua divisi x semua jam.
 *
 * Return: { intent, send_now, schedules: [{ divisi: string[], target_dates: string[], target_times: string[] }], pesan }
 * atau null kalau command tidak valid.
 */
export async function parseScheduleCommand(rawText) {
  const validDivisi = Object.keys(GROUP_IDS);
  const now = new Date();

  // Tangkap teks literal (kalau ada) SEBELUM apapun dikirim ke LLM. Ini yang
  // dipakai sebagai `pesan` final nanti -- dijamin identik dengan input user.
  const quoted = extractQuotedLiteral(rawText);
  const literalPesan = quoted ? quoted.content : null;

  // Ganti blok yang dikutip dengan placeholder supaya classifier tetap bisa baca
  // instruksi divisi/jadwal di sekitarnya, TANPA perlu "menyalin ulang" isi pesan
  // (menghindari model iseng meringkas/parafrase teks panjang di dalam prompt).
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

  const prompt = `Kamu adalah classifier + parser command untuk bot WhatsApp panitia. Ada DUA jenis command:

A) intent "custom" — user nentuin sendiri isi pesan, target divisi, dan kapan dikirim (sekarang, atau dijadwalkan buat nanti).

B) intent "deadline_mepet" — user minta bot ngirim rangkuman deadline yang MEPET/DEKET/HAMPIR JATUH TEMPO buat divisi tertentu (kata kunci semacam "deadline mepet", "deadline yang deket", "kasih tau soal deadline"), TANPA nentuin isi pesan sendiri — pesan disusun otomatis dari data tugas. Intent ini JUGA BISA dikirim sekarang ATAU dijadwalkan buat nanti, PERSIS sama aturannya kayak intent "custom".

Waktu sekarang (WITA): ${nowWITA}, hari ${nowDayNameWITA}.

Divisi yang valid HANYA: ${validDivisi.join(", ")}

Pesan dari user:
"${textForAI}"

CATATAN KHUSUS soal placeholder [PESAN_LITERAL] (kalau muncul di pesan user di atas):
- Itu artinya user SUDAH nulis pesan final sendiri di command aslinya (sudah ditandai kutip), dan pesan itu WAJIB dipakai APA ADANYA -- kamu TIDAK PERLU dan TIDAK BOLEH menyusun ulang isinya.
- Kalau [PESAN_LITERAL] muncul -> intent WAJIB "custom", dan field "pesan" di output cukup isi string "[PESAN_LITERAL]" saja (nanti akan digantikan otomatis oleh sistem dengan teks aslinya, bukan tugas kamu).
- Fokus kamu tetap cuma nentuin divisi, send_now, dan tanggal/jam dari sisa instruksi di command (di luar bagian [PESAN_LITERAL]).

PENTING — SATU COMMAND BISA PUNYA BEBERAPA "ASSIGNMENT" (kelompok divisi+tanggal+jam):
- Kalau beberapa divisi disebut dan SEMUANYA pakai tanggal/jam yang SAMA -> itu SATU assignment, divisi-divisinya digabung dalam satu array.
- Kalau tiap divisi (atau tiap kelompok divisi) punya tanggal/jam BEDA-BEDA (misal "humkes jam 1, acara jam 2, pdd jam 3") -> WAJIB dipecah jadi assignment TERPISAH per kelompok. JANGAN digabung jadi satu array divisi besar dengan satu array times besar -- itu bakal bikin SETIAP divisi dijadwalkan di SEMUA jam, bukan cuma jam yang dimaksud buat divisi itu.
- Satu assignment TIDAK PERNAH menggabungkan dua divisi yang tanggal/jamnya berbeda.

ATURAN KHUSUS PASANGAN BERURUTAN (kalau divisi & jam disebut sebagai DUA LIST SEJAJAR dalam satu kalimat, misal "jam A dan jam B kirim ke divisi X dan Y"):
- Kalau ada N divisi disebut berurutan (dipisah "dan"/koma) DAN ada N jam disebut berurutan (dipisah "dan"/koma) dengan N SAMA PERSIS di kedua list, DAN TIDAK ADA kata yang menandakan semua divisi dapat SEMUA jam yang sama (seperti "keduanya", "semuanya di jam yang sama", "masing-masing di jam-jam itu") -> ARTINYA PASANGAN BERURUTAN 1-ke-1 berdasarkan urutan penyebutan di tiap list (divisi urutan ke-i berpasangan dengan jam urutan ke-i), TIDAK PEDULI list jam disebut sebelum atau sesudah list divisi di kalimat. WAJIB dipecah jadi N assignment terpisah, masing-masing cuma 1 divisi + 1 jam itu.
- Kalau jumlah divisi dan jumlah jam TIDAK sama, ATAU ada kata yang menandakan semua dapat jam yang sama -> BUKAN pasangan, pakai aturan assignment biasa (semua divisi digabung satu assignment, semua jam jadi array target_times assignment itu -- tiap divisi dapat SEMUA jam itu).

Contoh PASANGAN (2 divisi, 2 jam, sejajar, asumsi hari ini "2026-08-13"):
Command: "jam 2:15 dan jam 2:16 kirim ke divisi perkam dan konsum"
assignments: [
  { "divisi": ["Perkam"], "target_dates": ["2026-08-13"], "target_times": ["14:15"] },
  { "divisi": ["Konsumsi"], "target_dates": ["2026-08-13"], "target_times": ["14:16"] }
]

Contoh BUKAN pasangan (ada kata "keduanya" -> shared time, tetap satu assignment):
Command: "acara dan pdd besok jam 9 dan jam 2, keduanya dapat kedua jam itu"
assignments: [
  { "divisi": ["Acara", "PDD"], "target_dates": ["2026-08-14"], "target_times": ["09:00", "14:00"] }
]

ATURAN UMUM (berlaku untuk kedua intent, per assignment):
- DIVISI — cocokkan nama yang disebut user (termasuk singkatan/typo/tidak lengkap, misal "konsum" → "Konsumsi", "acr"/"acara" → "Acara") ke SALAH SATU nama persis di daftar valid, case-insensitive. "semua divisi"/"seluruh divisi" → string literal "ALL" (khusus kalau memang SEMUA divisi dapat tanggal/jam yang sama). Kalau benar-benar tidak bisa dicocokkan ke satu pun nama valid → valid: false.
- send_now — true kalau user minta dikirim SEKARANG/LANGSUNG/SAAT INI JUGA tanpa nyebut tanggal/jam target, berlaku untuk SELURUH command. false kalau ADA tanggal/jam spesifik disebut buat nanti (termasuk kata "nanti jam ..." — itu berarti dijadwalkan, BUKAN sekarang).
- Kalau send_now: true → target_dates dan target_times tiap assignment boleh array kosong [].
- Kalau send_now: false → tiap assignment WAJIB isi target_dates & target_times:
  - target_dates: array tanggal konkret YYYY-MM-DD, urut menaik, mencakup SEMUA hari yang dimaksud untuk assignment itu (bukan cuma awal & akhir):
    - Satu hari saja / tidak disebut tanggal tapi ada jam (misal "nanti jam 12:53", "besok") → array isi 1 tanggal (hari ini kalau jamnya belum lewat, besok kalau sudah lewat, atau sesuai kata "besok"/"hari ini" yang eksplisit).
    - Rentang nama hari (misal "besok senin sampai rabu") → cari kemunculan hari itu PERTAMA yang jatuh pada/setelah besok, isi semua tanggal berurutan sampai hari akhir.
    - Rentang tanggal eksplisit (misal "tgl 25-30 agustus") → semua tanggal inklusif, tahun berjalan kalau tidak disebut.
    - Ambigu total → valid: false.
  - target_times: array jam HH:mm (24 jam), urut menaik, SEMUA jam yang disebut untuk assignment itu (bisa lebih dari satu, dipisah "dan"/koma/"&"). Konversi format 12 jam (AM/PM) ke 24 jam.

ATURAN KHUSUS intent "custom" — pesan (SATU pesan berlaku untuk SEMUA assignment dalam command ini):
- Susun SATU pesan WhatsApp LENGKAP yang siap dikirim ke grup divisi, berdiri sendiri (orang yang belum baca command aslinya harus tetap paham maksudnya) — JANGAN cuma menyalin potongan/ekor kalimat dari command mentah-mentah.
- Kalau ada placeholder [PESAN_LITERAL] → ikuti CATATAN KHUSUS di atas (isi "pesan" cukup "[PESAN_LITERAL]", skip aturan di bawah).
- Kalau TIDAK ada placeholder, susun dengan struktur:
  1) Sapaan hangat ke divisi/panitia terkait, misal "Halo, teman-teman divisi Konsumsi! 👋" atau "Halo, teman-teman panitia umum! 👋", tergantung konteknya oke, kalo panitia inti ya sapa panitia inti, dll
  2) Kalimat jelas & lengkap soal apa yang perlu dilakukan (dari isi command, tulis ulang natural, perbaiki typo, JANGAN dipotong jadi fragmen).
  3) Nada ramah tapi tegas — jelas ini perlu ditindaklanjuti, tanpa kesan menyuruh kasar.
  Contoh transformasi:
  Command: "ingetin divisi konsum untuk menyurvei lokasi tempat beli makanannya ya"
  pesan yang benar: "Halo, teman-teman divisi Konsumsi! 👋 Yuk mulai disurvei lokasi tempat beli makanan buat acara nanti. Kalau ada kendala boleh banget diomongin di sini ya 🙏"
  begitu juga dengan divisi yang lain, kamu buat sendiri textnya, okee.

ATURAN KHUSUS intent "deadline_mepet":
- pesan diabaikan, isi null — tidak dipakai, isi pesan disusun otomatis dari data tugas divisi terkait oleh fungsi lain.

Balas HANYA JSON (tanpa markdown, tanpa penjelasan):
{
  "valid": boolean,
  "intent": "custom" | "deadline_mepet",
  "send_now": boolean,
  "assignments": [
    {
      "divisi": string[] | "ALL",
      "target_dates": string[],
      "target_times": string[]
    }
  ],
  "pesan": string | null
}

Contoh assignments buat command "ingetin humkes jam 1 siang, acara jam 3 sore" (asumsi hari ini "2026-08-13"):
"assignments": [
  { "divisi": ["Humkes"], "target_dates": ["2026-08-13"], "target_times": ["13:00"] },
  { "divisi": ["Acara"], "target_dates": ["2026-08-13"], "target_times": ["15:00"] }
]

Contoh assignments buat command "ingetin acara dan pdd besok jam 9 dan jam 2 siang" (satu kelompok, jam sama buat kedua divisi):
"assignments": [
  { "divisi": ["Acara", "PDD"], "target_dates": ["2026-08-14"], "target_times": ["09:00", "14:00"] }
]`;

  const response = await ai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 900,
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    if (!parsed.valid || (parsed.intent !== "custom" && parsed.intent !== "deadline_mepet")) return null;
    if (!Array.isArray(parsed.assignments) || parsed.assignments.length === 0) return null;

    // Kalau ada teks literal dari user, paksa intent "custom" dan timpa pesan
    // hasil model dengan teks ASLI (bukan hasil generate ulang). Ini jalur
    // paling reliable karena literalPesan diambil murni via regex di atas,
    // tidak pernah melewati sampling LLM.
    if (literalPesan) {
      parsed.intent = "custom";
      parsed.pesan = literalPesan;
    }

    if (parsed.intent === "custom" && !parsed.pesan) return null;

    const resolveDivisi = (d) => {
      if (d === "ALL") return validDivisi;
      if (Array.isArray(d) && d.length > 0) {
        const list = [...new Set(d)];
        if (!list.every((x) => validDivisi.includes(x))) return null;
        return list;
      }
      return null;
    };

    if (parsed.send_now === true) {
      const allDivisi = new Set();
      for (const a of parsed.assignments) {
        const list = resolveDivisi(a.divisi);
        if (!list) return null;
        list.forEach((d) => allDivisi.add(d));
      }
      if (allDivisi.size === 0) return null;

      return {
        intent: parsed.intent,
        send_now: true,
        schedules: [{ divisi: [...allDivisi], target_dates: [], target_times: [] }],
        pesan: parsed.intent === "custom" ? parsed.pesan : null,
      };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

    const schedules = [];
    for (const a of parsed.assignments) {
      const list = resolveDivisi(a.divisi);
      if (!list) return null;

      const dates = [...new Set(a.target_dates || [])];
      if (dates.length === 0 || !dates.every((d) => dateRegex.test(d))) return null;
      dates.sort();

      const times = [...new Set(a.target_times || [])];
      if (times.length === 0 || !times.every((t) => timeRegex.test(t))) return null;
      times.sort();

      schedules.push({ divisi: list, target_dates: dates, target_times: times });
    }

    return {
      intent: parsed.intent,
      send_now: false,
      schedules,
      pesan: parsed.intent === "custom" ? parsed.pesan : null,
    };
  } catch {
    return null;
  }
}

export function toUnixTimestampWITA(dateStr, timeStr) {
  // WITA = UTC+8, no DST.
  const isoUTC = `${dateStr}T${timeStr}:00+08:00`;
  return Math.floor(new Date(isoUTC).getTime() / 1000);
}