import { NextResponse } from "next/server";
import { isSenderAllowed } from "@/lib/whitelist";
import { parseScheduleCommand, toUnixTimestampWITA } from "@/lib/ai";
import { sendToFonnte } from "@/lib/fonnte";
import { GROUP_IDS } from "@/lib/groups";

const TRIGGER_REGEX = /^hello\s*bot/i;

// export async function POST(req) {
//   const payload = await req.json();

//   // Sesuaikan field ini sama payload asli Fonnte webhook — verifikasi
//   // dulu 1x kirim manual sebelum diandalkan, format bisa beda per versi API.
//   const sender = payload.sender;
//   const text = (payload.message || "").trim();

//   if (!sender || !isSenderAllowed(sender)) {
//     // Diam saja — jangan kasih tau ke pengirim liar bahwa endpoint ini "hidup".
//     return NextResponse.json({ ok: true, ignored: true });
//   }

//   if (!TRIGGER_REGEX.test(text)) {
//     return NextResponse.json({ ok: true, ignored: true });
//   }

//   const parsed = await parseScheduleCommand(text);
//   if (!parsed) {
//     await sendToFonnte(
//       sender,
//       "Waduh, aku nggak paham maksud command-nya 🙏 Coba format: 'hello bot, ingetin [divisi] jam [waktu] buat [tugas]'"
//     );
//     return NextResponse.json({ ok: true, parsed: false });
//   }

//   const groupId = GROUP_IDS[parsed.divisi];
//   if (!groupId) {
//     await sendToFonnte(sender, `Divisi "${parsed.divisi}" nggak ketemu di daftar grup 🙏`);
//     return NextResponse.json({ ok: true, error: "unknown divisi" });
//   }

//   const schedule = toUnixTimestampWITA(parsed.target_date, parsed.target_time);

//   const result = await sendToFonnte(groupId, parsed.pesan, { schedule });

//   // Konfirmasi balik ke pengirim (bukan ke grup) biar dia yakin request-nya kepasang.
//   await sendToFonnte(
//     sender,
//     `Sip, reminder buat *${parsed.divisi}* udah dijadwalin ${parsed.target_date} jam ${parsed.target_time} WITA ✅`
//   );

//   return NextResponse.json({ ok: true, scheduled: true, schedule, fonnte_response: result });
// }

export async function POST(req) {
  const payload = await req.json();
  console.log("FONNTE WEBHOOK PAYLOAD:", JSON.stringify(payload, null, 2));
  return NextResponse.json({ ok: true });
}