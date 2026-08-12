// api/send-reminder
import { NextResponse } from "next/server";
import { getTodaysReminders } from "@/lib/reminder";
import { generateReminderText } from "@/lib/ai";
import { sendToFonnte } from "@/lib/fonnte";
import { GROUP_IDS } from "@/lib/groups";

export async function GET(req) {
  // Protect endpoint so only Vercel Cron (or you) can trigger it.
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional ?date=YYYY-MM-DD to test reminders for a specific day
  // (endpoint is already protected by CRON_SECRET above)
  const { searchParams } = new URL(req.url);
  const testDate = searchParams.get("date");
  const now = testDate ? new Date(`${testDate}T12:00:00+08:00`) : new Date();

  const grouped = getTodaysReminders(now);
  const divisiWithReminders = Object.keys(grouped);

  if (divisiWithReminders.length === 0) {
    return NextResponse.json({
      message: "Tidak ada deadline yang perlu diingatkan hari ini",
      sent: [],
    });
  }

  const results = [];

  for (const divisi of divisiWithReminders) {
    const tasks = grouped[divisi];
    const groupId = GROUP_IDS[divisi];

    if (!groupId) {
      results.push({ divisi, status: "skipped", reason: "group id not found" });
      continue;
    }

    try {
      const message = await generateReminderText(divisi, tasks);
      const fonnteResult = await sendToFonnte(groupId, message);

      results.push({
        divisi,
        status: "sent",
        task_count: tasks.length,
        task_ids: tasks.map((t) => t.id),
        message,
        fonnte_response: fonnteResult,
      });
    } catch (err) {
      results.push({
        divisi,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ success: true, results });
}
