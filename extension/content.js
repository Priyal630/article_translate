// content.js — runs on every page, idle until messaged by the popup.
(function () {
  if (window.__indictransInjected) return;
  window.__indictransInjected = true;

  let translating = false;
  let statusEl = null;
  const originalTextMap = new Map(); // text node -> original text (for restore)

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT",
    "IFRAME", "CODE", "PRE", "SVG", "SELECT", "OPTION"
  ]);

  function shouldSkip(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (SKIP_TAGS.has(parent.tagName)) return true;
    if (parent.closest("#__indictrans-status")) return true;
    if (parent.isContentEditable) return true;
    const style = window.getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden") return true;
    return false;
  }

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      const text = n.nodeValue;
      if (!text || !text.trim()) continue;
      if (shouldSkip(n)) continue;
      nodes.push(n);
    }
    return nodes;
  }

  function ensureStatusEl() {
    if (statusEl && document.body.contains(statusEl)) return statusEl;
    statusEl = document.createElement("div");
    statusEl.id = "__indictrans-status";
    Object.assign(statusEl.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      zIndex: "2147483647",
      background: "#111827",
      color: "#fff",
      padding: "10px 16px",
      borderRadius: "999px",
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      fontSize: "13px",
      fontWeight: "500",
      boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      pointerEvents: "none"
    });
    document.body.appendChild(statusEl);
    return statusEl;
  }

  function showStatus(text) {
    const el = ensureStatusEl();
    el.textContent = text;
    el.style.display = "flex";
  }

  function hideStatus() {
    if (statusEl) statusEl.style.display = "none";
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function translatePage(srcLang, tgtLang, serverUrl) {
    if (translating) return { status: "already_running" };
    translating = true;
    try {
      const nodes = collectTextNodes(document.body);
      if (nodes.length === 0) {
        translating = false;
        return { status: "no_text" };
      }

      const BATCH_SIZE = 20;
      const batches = chunk(nodes, BATCH_SIZE);
      let done = 0;

      for (const batch of batches) {
        showStatus(`Translating… ${done}/${nodes.length}`);
        const sentences = batch.map((n) => n.nodeValue);

        const response = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          payload: { sentences, srcLang, tgtLang, serverUrl }
        });

        if (!response || !response.ok) {
          throw new Error(response?.error || "Translation request failed");
        }

        const translations = response.translations;
        batch.forEach((node, i) => {
          if (!originalTextMap.has(node)) originalTextMap.set(node, node.nodeValue);
          if (translations[i] != null) node.nodeValue = translations[i];
        });

        done += batch.length;
      }

      showStatus(`Translated ${nodes.length} text blocks ✓`);
      setTimeout(hideStatus, 2500);
      return { status: "done", count: nodes.length };
    } catch (err) {
      showStatus(`Error: ${err.message}`);
      setTimeout(hideStatus, 4000);
      return { status: "error", error: err.message };
    } finally {
      translating = false;
    }
  }

  function restorePage() {
    if (originalTextMap.size === 0) return { status: "nothing_to_restore" };
    originalTextMap.forEach((original, node) => {
      node.nodeValue = original;
    });
    originalTextMap.clear();
    showStatus("Restored original text ✓");
    setTimeout(hideStatus, 2000);
    return { status: "restored" };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "TRANSLATE_PAGE") {
      translatePage(message.payload.srcLang, message.payload.tgtLang, message.payload.serverUrl)
        .then(sendResponse);
      return true; // keep the message channel open for the async response
    }
    if (message.type === "RESTORE_PAGE") {
      sendResponse(restorePage());
      return false;
    }
  });
})();
