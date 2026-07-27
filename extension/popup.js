const DEFAULT_SERVER = "http://localhost:8000";

const FALLBACK_LANGS = [
  { code: "eng_Latn", name: "English" },
  { code: "hin_Deva", name: "Hindi" },
  { code: "ben_Beng", name: "Bengali" },
  { code: "guj_Gujr", name: "Gujarati" },
  { code: "kan_Knda", name: "Kannada" },
  { code: "mal_Mlym", name: "Malayalam" },
  { code: "mar_Deva", name: "Marathi" },
  { code: "pan_Guru", name: "Punjabi" },
  { code: "tam_Taml", name: "Tamil" },
  { code: "tel_Telu", name: "Telugu" },
  { code: "urd_Arab", name: "Urdu" }
];

const srcSelect = document.getElementById("srcLang");
const tgtSelect = document.getElementById("tgtLang");
const translateBtn = document.getElementById("translateBtn");
const restoreBtn = document.getElementById("restoreBtn");
const statusEl = document.getElementById("status");
const serverInput = document.getElementById("serverUrl");
const saveServerBtn = document.getElementById("saveServerBtn");
const serverStatusEl = document.getElementById("serverStatus");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? ` status--${kind}` : "");
}

function populateSelects(langs, preferredSrc, preferredTgt) {
  srcSelect.innerHTML = "";
  tgtSelect.innerHTML = "";
  langs.forEach(({ code, name }) => {
    const o1 = document.createElement("option");
    o1.value = code;
    o1.textContent = name;
    srcSelect.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = code;
    o2.textContent = name;
    tgtSelect.appendChild(o2);
  });
  srcSelect.value = preferredSrc && langs.some(l => l.code === preferredSrc) ? preferredSrc : "eng_Latn";
  tgtSelect.value = preferredTgt && langs.some(l => l.code === preferredTgt) ? preferredTgt : "hin_Deva";
}

async function loadLanguages(serverUrl, preferredSrc, preferredTgt) {
  try {
    const res = await fetch(`${serverUrl}/languages`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const langs = Array.isArray(data.languages) ? data.languages : [];
    if (langs.length && typeof langs[0] === "object") {
      populateSelects(langs, preferredSrc, preferredTgt);
    } else {
      populateSelects(FALLBACK_LANGS, preferredSrc, preferredTgt);
    }
    serverStatusEl.textContent = "Connected";
    serverStatusEl.className = "server-status server-status--ok";
  } catch {
    populateSelects(FALLBACK_LANGS, preferredSrc, preferredTgt);
    serverStatusEl.textContent = "Server unreachable — using defaults";
    serverStatusEl.className = "server-status server-status--error";
  }
}

async function init() {
  const stored = await chrome.storage.local.get(["serverUrl", "srcLang", "tgtLang"]);
  const serverUrl = stored.serverUrl || DEFAULT_SERVER;
  serverInput.value = serverUrl;
  await loadLanguages(serverUrl, stored.srcLang, stored.tgtLang);
}

saveServerBtn.addEventListener("click", async () => {
  const url = serverInput.value.trim().replace(/\/$/, "");
  if (!url) return;
  await chrome.storage.local.set({ serverUrl: url });
  setStatus("Server URL saved", "ok");
  loadLanguages(url, srcSelect.value, tgtSelect.value);
});

srcSelect.addEventListener("change", () => chrome.storage.local.set({ srcLang: srcSelect.value }));
tgtSelect.addEventListener("change", () => chrome.storage.local.set({ tgtLang: tgtSelect.value }));

translateBtn.addEventListener("click", async () => {
  if (srcSelect.value === tgtSelect.value) {
    setStatus("Source and target languages must differ", "error");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const serverUrl = serverInput.value.trim().replace(/\/$/, "") || DEFAULT_SERVER;

  translateBtn.disabled = true;
  setStatus("Translating page…");

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "TRANSLATE_PAGE",
      payload: { srcLang: srcSelect.value, tgtLang: tgtSelect.value, serverUrl }
    });

    if (response?.status === "done") {
      setStatus(`Translated ${response.count} text blocks`, "ok");
    } else if (response?.status === "no_text") {
      setStatus("No translatable text found on this page", "error");
    } else if (response?.status === "already_running") {
      setStatus("Already translating — please wait", "");
    } else if (response?.status === "error") {
      setStatus(`Error: ${response.error}`, "error");
    } else {
      setStatus("Translation finished", "ok");
    }
  } catch {
    setStatus("Could not reach page — reload it, then try again", "error");
  } finally {
    translateBtn.disabled = false;
  }
});

restoreBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "RESTORE_PAGE" });
    if (response?.status === "restored") {
      setStatus("Original text restored", "ok");
    } else {
      setStatus("Nothing to restore", "");
    }
  } catch {
    setStatus("Could not reach page — reload it, then try again", "error");
  }
});

init();
