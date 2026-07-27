// background.js — MV3 service worker. Performs the actual fetch to the
// local FastAPI server so requests aren't subject to each page's CSP.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRANSLATE_BATCH") {
    const { sentences, srcLang, tgtLang, serverUrl } = message.payload;

    fetch(`${serverUrl}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sentences,
        src_lang: srcLang,
        tgt_lang: tgtLang
      })
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        sendResponse({
          ok: true,
          translations: data.results.map((r) => r.translation)
        });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });

    return true; // keep the message channel open for the async response
  }
});
