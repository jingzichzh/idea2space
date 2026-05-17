import logging
import os
from typing import Any

from dotenv import load_dotenv
from huggingface_hub import InferenceClient

load_dotenv()

logger = logging.getLogger(__name__)

DEFAULT_ASR_MODEL = "openai/whisper-large-v3"
MIN_AUDIO_BYTES = 16_000


def transcribe_audio(audio_bytes: bytes, fallback_text: str = "mock transcript segment") -> dict[str, str]:
    audio_length = len(audio_bytes)
    hf_token = os.getenv("HF_TOKEN")
    model = os.getenv("ASR_MODEL", DEFAULT_ASR_MODEL)
    is_production = is_hugging_face_space()

    logger.info(
        "ASR_REQUEST audio_bytes=%s min_audio_bytes=%s hf_token_exists=%s asr_model=%s production=%s",
        audio_length,
        MIN_AUDIO_BYTES,
        bool(hf_token),
        model,
        is_production,
    )

    if audio_length < MIN_AUDIO_BYTES:
        logger.info(
            "ASR_PENDING audio too small audio_bytes=%s min_audio_bytes=%s",
            audio_length,
            MIN_AUDIO_BYTES,
        )
        if is_production:
            return {"text": "", "source": "pending"}
        return {"text": "", "source": "pending"}

    if not hf_token:
        message = "HF_TOKEN is missing; configure it in Hugging Face Space secrets."
        logger.warning("ASR_ERROR %s", message)
        if is_production:
            return {"text": message, "source": "error"}
        logger.info("ASR local mock fallback: HF_TOKEN is missing")
        return {"text": fallback_text, "source": "mock"}

    try:
        client = InferenceClient(token=hf_token)
        result = client.automatic_speech_recognition(audio_bytes, model=model)
        text = extract_text(result)

        if not text:
            logger.info("ASR_EMPTY_RESPONSE Hugging Face returned empty text")
            return {"text": "", "source": "hf_asr"}

        return {"text": text, "source": "hf_asr"}
    except Exception as error:
        logger.warning(
            "ASR_EXCEPTION type=%s message=%s audio_bytes=%s asr_model=%s",
            type(error).__name__,
            str(error),
            audio_length,
            model,
        )
        if is_production:
            return {
                "text": f"Hugging Face ASR failed ({type(error).__name__}): {error}",
                "source": "error",
            }
        logger.info("ASR local mock fallback: Hugging Face ASR request failed")
        return {"text": fallback_text, "source": "mock"}


def extract_text(result: Any) -> str:
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()

    return str(getattr(result, "text", "")).strip()


def is_hugging_face_space() -> bool:
    return bool(os.getenv("SPACE_ID") or os.getenv("SPACE_HOST"))
