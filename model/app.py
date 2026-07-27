"""
FastAPI service for IndicTrans2 translation model.

Run with:
    uvicorn server:app --host 0.0.0.0 --port 8000

(inside your activated venv — use `python -m uvicorn ...` if `uvicorn`
 on PATH resolves to a different Python install)
"""

import torch
from pathlib import Path
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from IndicTransToolkit.processor import IndicProcessor

# ----------------------------------------------------
# Configuration
# ----------------------------------------------------
MODEL_PATH = Path(__file__).parent.resolve()
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# FLORES-200 style codes used by IndicTrans2, mapped to display names.
# Trim/extend this dict to match the languages your checkpoint actually supports.
LANGUAGE_NAMES = {
    "eng_Latn": "English",
    "hin_Deva": "Hindi",
    "ben_Beng": "Bengali",
    "guj_Gujr": "Gujarati",
    "kan_Knda": "Kannada",
    "mal_Mlym": "Malayalam",
    "mar_Deva": "Marathi",
    "npi_Deva": "Nepali",
    "ory_Orya": "Odia",
    "pan_Guru": "Punjabi",
    "san_Deva": "Sanskrit",
    "tam_Taml": "Tamil",
    "tel_Telu": "Telugu",
    "urd_Arab": "Urdu",
    "asm_Beng": "Assamese",
    "kas_Arab": "Kashmiri (Arabic)",
    "kas_Deva": "Kashmiri (Devanagari)",
    "kok_Deva": "Konkani",
    "mai_Deva": "Maithili",
    "mni_Beng": "Manipuri (Bengali)",
    "mni_Mtei": "Manipuri (Meitei)",
    "sat_Olck": "Santali",
    "snd_Arab": "Sindhi (Arabic)",
    "snd_Deva": "Sindhi (Devanagari)",
    "brx_Deva": "Bodo",
    "doi_Deva": "Dogri",
}
SUPPORTED_LANGS = set(LANGUAGE_NAMES)

# Globals populated at startup
tokenizer = None
model = None
ip = None


# ----------------------------------------------------
# Model loading
# ----------------------------------------------------
def load_model():
    global tokenizer, model, ip

    print(f"Using device: {DEVICE}")
    print(f"Model path : {MODEL_PATH}")

    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_PATH,
        trust_remote_code=True,
        local_files_only=True,
    )
    print("Tokenizer loaded")

    print("Loading model...")
    model = AutoModelForSeq2SeqLM.from_pretrained(
        MODEL_PATH,
        trust_remote_code=True,
        local_files_only=True,
    ).to(DEVICE)
    model.eval()
    print("Model loaded")

    ip = IndicProcessor(inference=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield


app = FastAPI(
    title="IndicTrans2 Translation API",
    description="Translate text between English and Indic languages using IndicTrans2.",
    version="1.0.0",
    lifespan=lifespan,
)

# ----------------------------------------------------
# CORS — required for the browser extension (and popup/background pages)
# to call this server. Permissive because this is a local dev server;
# tighten allow_origins if you ever expose this beyond localhost.
# ----------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------
# Request / Response schemas
# ----------------------------------------------------
class TranslateRequest(BaseModel):
    sentences: List[str] = Field(..., min_length=1, description="List of sentences to translate")
    src_lang: str = Field(..., description="Source language code, e.g. 'eng_Latn'")
    tgt_lang: str = Field(..., description="Target language code, e.g. 'hin_Deva'")
    max_length: int = Field(256, ge=1, le=1024)
    num_beams: int = Field(5, ge=1, le=10)


class TranslationPair(BaseModel):
    source: str
    translation: str


class TranslateResponse(BaseModel):
    src_lang: str
    tgt_lang: str
    results: List[TranslationPair]


class LanguageInfo(BaseModel):
    code: str
    name: str


class LanguagesResponse(BaseModel):
    languages: List[LanguageInfo]


# ----------------------------------------------------
# Endpoints
# ----------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "model_loaded": model is not None}


@app.get("/languages", response_model=LanguagesResponse)
def languages():
    """Return supported language codes with display names, for populating a UI dropdown."""
    return {
        "languages": [
            {"code": code, "name": name}
            for code, name in sorted(LANGUAGE_NAMES.items(), key=lambda kv: kv[1])
        ]
    }


@app.post("/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    if model is None or tokenizer is None or ip is None:
        raise HTTPException(status_code=503, detail="Model is not loaded yet")

    if req.src_lang not in SUPPORTED_LANGS:
        raise HTTPException(status_code=400, detail=f"Unsupported src_lang: {req.src_lang}")
    if req.tgt_lang not in SUPPORTED_LANGS:
        raise HTTPException(status_code=400, detail=f"Unsupported tgt_lang: {req.tgt_lang}")
    if req.src_lang == req.tgt_lang:
        raise HTTPException(status_code=400, detail="src_lang and tgt_lang must differ")

    try:
        processed = ip.preprocess_batch(
            req.sentences,
            src_lang=req.src_lang,
            tgt_lang=req.tgt_lang,
        )

        inputs = tokenizer(
            processed,
            return_tensors="pt",
            padding=True,
            truncation=True,
        ).to(DEVICE)

        with torch.no_grad():
            generated = model.generate(
                **inputs,
                max_length=req.max_length,
                num_beams=req.num_beams,
            )

        decoded = tokenizer.batch_decode(
            generated,
            skip_special_tokens=True,
        )

        translations = ip.postprocess_batch(
            decoded,
            lang=req.tgt_lang,
        )

        results = [
            TranslationPair(source=src, translation=tgt)
            for src, tgt in zip(req.sentences, translations)
        ]

        return TranslateResponse(
            src_lang=req.src_lang,
            tgt_lang=req.tgt_lang,
            results=results,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")