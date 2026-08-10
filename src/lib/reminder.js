import { createRequire } from "module";
const require = createRequire(import.meta.url);
const deadlines = require("./deadlines.json");

// Berapa hari setelah deadline lewat, reminder masih dikirim.
// Setelah ini, task dianggap "selesai diingatkan" dan tidak di-follow-up lagi.
const OVERDUE_GRACE_DAYS = 3;

/**
 * Format a Date object as YYYY-MM-DD in a given IANA timezone.
 * Default: Asia/Makassar (WITA, UTC+8) since panitia berbasis Mataram.
 */
function toDateStringInTZ(date, timeZone = "Asia/Makassar") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date); // en-CA locale outputs YYYY-MM-DD
}

function daysBetween(a, b) {
  const dateA = new Date(a + "T00:00:00Z");
  const dateB = new Date(b + "T00:00:00Z");
  return Math.round((dateB.getTime() - dateA.getTime()) / 86400000);
}


export function getTodaysReminders(now = new Date()) {
  const todayStr = toDateStringInTZ(now);
  const grouped = {};

  for (const task of deadlines) {

    if (task.completed) continue;

    const daysRemaining = daysBetween(todayStr, task.deadline_date);
    const withinStart = todayStr >= task.reminder_start_date;
    const withinGrace = daysRemaining >= -OVERDUE_GRACE_DAYS;

    if (!withinStart || !withinGrace) continue;

    const enriched = {
      ...task,
      days_remaining: daysRemaining,
      is_today: daysRemaining === 0,
      is_overdue: daysRemaining < 0,
      days_overdue: daysRemaining < 0 ? Math.abs(daysRemaining) : 0,
    };

    if (!grouped[task.divisi]) grouped[task.divisi] = [];
    grouped[task.divisi].push(enriched);
  }

  return grouped;
}

export function getAllDeadlines() {
  return deadlines;
}