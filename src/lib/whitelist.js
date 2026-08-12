// ALLOWED_SENDERS env var: comma-separated, format 62xxxxxxxxxx (no +, no spaces)
const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isSenderAllowed(sender) {
  // Fonnte's `data.sender` biasanya format "62xxxxxxxxxx" tanpa @s.whatsapp.net,
  // tapi kadang ada varian — normalize dulu.
  const normalized = sender.replace(/\D/g, "");
  return ALLOWED_SENDERS.includes(normalized);
}