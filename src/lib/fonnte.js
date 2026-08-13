// Fonnte free plan = text only, no attachment/image support.

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;
const FETCH_TIMEOUT_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(err) {
  const code = err?.cause?.code;
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    err?.name === "AbortError" || // dari timeout kita sendiri
    err?.message === "fetch failed"
  );
}

export async function sendToFonnte(target, message, options = {}) {
  const body = {
    target, // group id, format: xxxxx@g.us
    message,
    countryCode: "62",
  };

  if (options.schedule) {
    body.schedule = options.schedule; // unix timestamp (seconds)
  }

  let lastErr;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          Authorization: process.env.FONNTE_TOKEN,
        },
        body: new URLSearchParams(body),
        signal: controller.signal,
      });

      const data = await res.json();
      return data;
    } catch (err) {
      lastErr = err;

      if (!isTransientNetworkError(err) || attempt === MAX_RETRIES) {
        // Error permanen (bukan network blip) atau sudah habis jatah retry
        // -> lempar ke atas, WAJIB ditangkap try/catch di pemanggil.
        throw lastErr;
      }

      console.warn(
        `sendToFonnte: network error ke ${target} (percobaan ${attempt + 1}/${MAX_RETRIES + 1}), retry...`,
        err?.cause?.code || err?.message
      );
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastErr;
}