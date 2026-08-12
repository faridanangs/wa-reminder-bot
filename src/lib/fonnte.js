// Fonnte free plan = text only, no attachment/image support.
export async function sendToFonnte(target, message, options = {}) {
  const body = {
    target, // group id, format: xxxxx@g.us
    message,
    countryCode: "62",
  };

  if (options.schedule) {
    body.schedule = options.schedule; // unix timestamp (seconds)
  }

  const res = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: {
      Authorization: process.env.FONNTE_TOKEN,
    },
    body: new URLSearchParams(body),
  });

  const data = await res.json();
  return data;
}