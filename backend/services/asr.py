import logging
import os
from typing import Any

from dotenv import load_dotenv
from huggingface_hub import InferenceClient

load_dotenv()

logger = logging.getLogger(__name__)

DEFAULT_ASR_MODEL = "openai/whisper-large-v3"
MIN_AUDIO_BYTES = 1024


def transcribe_audio(audio_bytes: bytes, fallback_text: str = "mock transcript segment") -> dict[str, str]:
    if len(audio_bytes) < MIN_AUDIO_BYTES:
        logger.info("ASR fallback: audio chunk too small (%s bytes)", len(audio_bytes))
        return {"text": fallback_text, "source": "mock"}

    hf_token = os.getenv("HF_TOKEN")
    if not hf_token:
        logger.info("ASR fallback: HF_TOKEN is missing")
        return {"text": fallback_text, "source": "mock"}

    model = os.getenv("ASR_MODEL", DEFAULT_ASR_MODEL)

    try:
        client = InferenceClient(token=hf_token)
        result = client.automatic_speech_recognition(audio_bytes, model=model)
        text = extract_text(result)

        if not text:
            logger.info("ASR fallback: Hugging Face returned empty text")
            return {"text": fallback_text, "source": "mock"}

        return {"text": text, "source": "hf_asr"}
    except Exception as error:
        logger.warning("ASR fallback: Hugging Face ASR request failed: %s", error)
        return {"text": fallback_text, "source": "mock"}


def extract_text(result: Any) -> str:
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()

    return str(getattr(result, "text", "")).strip()
