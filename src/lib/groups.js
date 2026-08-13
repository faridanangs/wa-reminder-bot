// Ganti true/false ini buat pindah mode. TRUE = semua divisi ke satu grup test.
// FALSE = pakai grup asli per divisi (production).
const USE_TEST_GROUP = true;

const PRODUCTION_GROUP_IDS = {
  Humkes: "120363425848765391@g.us",
  Perkam: "120363409780546177@g.us",
  Konsumsi: "120363428149058688@g.us",
  Acara: "120363425462901731@g.us",
  PDD: "120363426269393564@g.us",
  "Panitia Inti": "120363426942319380@g.us",
  "Panitia Umum": "120363411110781619@g.us",
  "Inti Kece": "120363427718026519@g.us",
};

const TEST_GROUP_ID = "120363432331143179@g.us";

export const GROUP_IDS = USE_TEST_GROUP
  ? Object.fromEntries(
      Object.keys(PRODUCTION_GROUP_IDS).map((divisi) => [
        divisi,
        TEST_GROUP_ID,
      ]),
    )
  : PRODUCTION_GROUP_IDS;

// text untuk testing: node src/scripts/test-prod-interval.js --url=https://wa-reminder-bot-eight.vercel.app/api/send-reminder --interval=1 --count=5
