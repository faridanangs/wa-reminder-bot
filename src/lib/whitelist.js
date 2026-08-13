// ALLOWED_SENDERS env var: comma-separated, format 62xxxxxxxxxx (no +, no spaces)
const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.trim().replace(/^["']|["']$/g, "")) // buang kutip nyasar di awal/akhir tiap nomor
  .filter(Boolean);

export function isSenderAllowed(sender) {
  const normalized = sender.replace(/\D/g, "");
  return ALLOWED_SENDERS.includes(normalized);
}