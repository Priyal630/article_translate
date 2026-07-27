import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from IndicTransToolkit.processor import IndicProcessor

# ----------------------------------------------------
# Configuration
# ----------------------------------------------------
MODEL_PATH = Path(__file__).parent.resolve()

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

print(f"Using device: {DEVICE}")
print(f"Model path : {MODEL_PATH}")

# ----------------------------------------------------
# Load tokenizer
# ----------------------------------------------------
print("Loading tokenizer...")

tokenizer = AutoTokenizer.from_pretrained(
    MODEL_PATH,
    trust_remote_code=True,
    local_files_only=True,
)

print("✓ Tokenizer loaded")

# ----------------------------------------------------
# Load model
# ----------------------------------------------------
print("Loading model...")

model = AutoModelForSeq2SeqLM.from_pretrained(
    MODEL_PATH,
    trust_remote_code=True,
    local_files_only=True,
).to(DEVICE)

model.eval()

print("✓ Model loaded")

# ----------------------------------------------------
# Initialize processor
# ----------------------------------------------------
ip = IndicProcessor(inference=True)

# ----------------------------------------------------
# Translation settings
# ----------------------------------------------------
src_lang = "eng_Latn"
tgt_lang = "hin_Deva"

sentences = [
    "Hello! How are you?",
    "My name is Yash.",
    "Artificial Intelligence is transforming the world."
]

# ----------------------------------------------------
# Preprocess
# ----------------------------------------------------
processed = ip.preprocess_batch(
    sentences,
    src_lang=src_lang,
    tgt_lang=tgt_lang,
)

inputs = tokenizer(
    processed,
    return_tensors="pt",
    padding=True,
    truncation=True,
).to(DEVICE)

# ----------------------------------------------------
# Generate
# ----------------------------------------------------
with torch.no_grad():
    generated = model.generate(
        **inputs,
        max_length=256,
        num_beams=5,
    )

# ----------------------------------------------------
# Decode
# ----------------------------------------------------
decoded = tokenizer.batch_decode(
    generated,
    skip_special_tokens=True,
)

translations = ip.postprocess_batch(
    decoded,
    lang=tgt_lang,
)

# ----------------------------------------------------
# Results
# ----------------------------------------------------
print("\n==========================")
print("Translation Results")
print("==========================\n")

for src, tgt in zip(sentences, translations):
    print(f"English : {src}")
    print(f"Hindi   : {tgt}")
    print("-" * 60)