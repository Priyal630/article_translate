# IndicTrans Webpage Translator

Translate the text of any webpage into an Indian language, in place, using a
locally hosted [IndicTrans2](https://github.com/AI4Bharat/IndicTrans2) (AI4Bharat)
model. A FastAPI server runs the model locally, and a Manifest V3 browser
extension sends the page's text to it and swaps in the translated text.

No text ever leaves your machine — the extension only talks to `localhost`.

---

## Repository structure

```
translator/
├── model/                      # model weights + tokenizer files (HuggingFace format)
│   ├── config.json
│   ├── pytorch_model.bin / model.safetensors
│   ├── tokenizer files...
│   └── server.py                # FastAPI backend (this repo)
├── extension/                   # Manifest V3 browser extension
│   ├── manifest.json
│   ├── background.js            # service worker — talks to the FastAPI server
│   ├── content.js                # runs on the page — finds text, swaps translations in
│   ├── popup.html / popup.css / popup.js   # extension UI
│   └── icons/
└── README.md
```

`server.py` expects to sit inside the same folder as the downloaded model and
tokenizer files, since it loads them with `local_files_only=True` relative to
its own path.

---

## Model architecture

**IndicTrans2** ([Gala et al., 2023](https://arxiv.org/abs/2305.16307)) is
AI4Bharat's open-source neural machine translation model — the first to
support translation across all 22 scheduled Indian languages and English.

- **Type:** Transformer encoder-decoder (seq2seq), in the same family as
  mBART/NLLB-style multilingual MT models.
- **Base checkpoints (`*-1B`):** ~1.1B parameters — 18 encoder layers, 18
  decoder layers, 1024-dim embeddings, 8192-dim feed-forward layers, 16
  attention heads, pre-normalization, GELU activations.
- **Distilled checkpoints (`*-dist-200M`):** ~211M parameters, distilled from
  the base model for roughly 5x fewer parameters and ~1.5x faster inference
  with competitive quality — better suited to a laptop/consumer GPU or CPU.
- **Directions:** separate checkpoints for English→Indic, Indic→English, and
  Indic→Indic (the last built by combining the encoder/decoder of the other
  two and fine-tuning).
- **Preprocessing:** the `IndicTransToolkit` `IndicProcessor` handles
  sentence normalization, script-aware tokenization, and postprocessing
  (detokenization, script conversion) around the raw model — always route
  inputs/outputs through it rather than the tokenizer alone.

This project uses the **English→Indic** direction by default (`eng_Latn` as
`src_lang`). Which specific checkpoint (`1B` vs `dist-200M`) is loaded depends
on whichever weights are placed in `model/`.

---

## Prerequisites

- Python 3.10 or 3.11
- Google Chrome or Microsoft Edge (for the extension)
- (Optional but recommended) an NVIDIA GPU with CUDA for faster inference —
  the server falls back to CPU automatically if none is found
- The IndicTrans2 model + tokenizer files downloaded into `model/` (from
  [HuggingFace](https://huggingface.co/ai4bharat) — e.g.
  `ai4bharat/indictrans2-en-indic-dist-200M` or `ai4bharat/indictrans2-en-indic-1B`)

---

## Setup

### 1. Create and activate a virtual environment

```powershell
cd model
python -m venv venv
venv\Scripts\activate
```

You should see `(venv)` at the start of your prompt once it's active.

### 2. Install dependencies

Install PyTorch first, matching your hardware (CPU-only vs CUDA) — get the
correct command for your setup from https://pytorch.org/get-started/locally/.
Example for CUDA 12.1:

```powershell
python -m pip install torch --index-url https://download.pytorch.org/whl/cu121
```

Then the rest:

```powershell
python -m pip install fastapi uvicorn transformers pydantic IndicTransToolkit
```

Using `python -m pip` (rather than a bare `pip`) makes sure packages install
into the *active* venv, even if another Python install is also on your PATH.

### 3. Verify the model files are in place

`model/` should directly contain the tokenizer and model weight files
(`config.json`, `tokenizer.json`/`sentencepiece` files, `model.safetensors`
or `pytorch_model.bin`, etc.) — not nested in a subfolder — since `server.py`
loads them relative to its own location.

### 4. Start the server

```powershell
python -m uvicorn server:app --host 0.0.0.0 --port 8000
```

`python -m uvicorn` guarantees uvicorn runs under the venv's Python even if a
different `uvicorn.exe` is earlier on your PATH.

On first run this loads the tokenizer and model into memory (can take a
while, especially on CPU) — wait for `Model loaded` in the console before
using the extension.

Check it's up:

```powershell
curl http://localhost:8000/health
```

Or open `http://localhost:8000/docs` for an interactive API explorer.

---

## API reference

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Reports server status, device (`cpu`/`cuda`), and whether the model is loaded |
| `/languages` | GET | Returns supported `{code, name}` language pairs |
| `/translate` | POST | Translates a batch of sentences |

**`POST /translate` body:**

```json
{
  "sentences": ["Hello! How are you?", "My name is Yash."],
  "src_lang": "eng_Latn",
  "tgt_lang": "hin_Deva",
  "max_length": 256,
  "num_beams": 5
}
```

**Response:**

```json
{
  "src_lang": "eng_Latn",
  "tgt_lang": "hin_Deva",
  "results": [
    { "source": "Hello! How are you?", "translation": "..." },
    { "source": "My name is Yash.", "translation": "..." }
  ]
}
```

CORS is open (`allow_origins=["*"]`) so the browser extension can call it —
this is intended for local development only. If you ever expose this server
beyond `localhost`, lock CORS down.

---

## Installing the extension

1. Go to `edge://extensions` (Edge) or `chrome://extensions` (Chrome).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `extension/` folder.
4. Pin the extension for easy access.

## Using it

1. Make sure `server.py` is running.
2. Open any webpage, click the extension icon.
3. Pick a **From** and **To** language (dropdown is populated live from
   `/languages`).
4. Click **Translate Page** — a small status pill in the corner shows
   progress as text is translated in batches.
5. Click **Restore Original** to revert the page to its original text.

If your server isn't on `http://localhost:8000`, open **Server settings** in
the popup and update the URL. If you point it at a host other than
`localhost`/`127.0.0.1`, also add that host to `host_permissions` in
`extension/manifest.json`, or the extension's background fetch will be
blocked.

---

## Troubleshooting

**`ModuleNotFoundError` even though the package is installed** — your `pip`
or `uvicorn` command is resolving to a different Python install than your
active venv. Run `where python` and `where pip`/`where uvicorn` — all should
point inside `model\venv\Scripts\`. Prefer `python -m pip install ...` and
`python -m uvicorn server:app ...` to sidestep PATH ordering issues entirely.

**Popup shows "Server unreachable"** — the FastAPI server isn't running, or
is on a different port than what's in the popup's Server settings.

**"Could not reach page" in the popup** — the content script hasn't loaded
into the current tab yet (common right after installing/reloading the
extension). Reload the target page, then try again.

**Translation is slow** — expected on CPU, especially with `num_beams: 5`
and the 1B checkpoint. Try the distilled `-200M` checkpoint, or lower
`num_beams` in the `/translate` request for faster (slightly lower quality)
output.

---

## Credits

Model and research by [AI4Bharat](https://ai4bharat.iitm.ac.in/) —
[IndicTrans2 paper](https://arxiv.org/abs/2305.16307) ·
[IndicTrans2 GitHub](https://github.com/AI4Bharat/IndicTrans2) ·
[IndicTransToolkit](https://github.com/VarunGumma/IndicTransToolkit).
