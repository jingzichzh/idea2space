import logging
import os
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.schemas import GenerateArchitectureRequest, TranscriptMessage
from backend.services.architecture_generator import generate_architecture_from_transcript
from backend.services.asr import DEFAULT_ASR_MODEL, transcribe_audio
from backend.services.mock_transcriber import MockTranscriber

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="idea2space Phase 4 API")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/generate-architecture")
def generate_architecture(request: GenerateArchitectureRequest) -> dict:
    return generate_architecture_from_transcript(request.transcript)


@app.get("/api/debug-env")
def debug_env() -> dict[str, bool | str]:
    return {
        "hf_token_present": bool(os.getenv("HF_TOKEN")),
        "asr_model": os.getenv("ASR_MODEL", DEFAULT_ASR_MODEL),
        "llm_model_present": bool(os.getenv("LLM_MODEL")),
        "app_env": os.getenv("APP_ENV") or os.getenv("ENV") or ("production" if os.getenv("SPACE_ID") or os.getenv("SPACE_HOST") else "local"),
    }


@app.websocket("/ws/transcribe")
async def transcribe(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("WS_TRANSCRIBE_CONNECTED")
    logger.info("WebSocket connected: /ws/transcribe")
    transcriber = MockTranscriber()
    audio_buffer = bytearray()
    last_hf_transcript = ""

    try:
        while True:
            audio_chunk = await websocket.receive_bytes()
            audio_buffer.extend(audio_chunk)
            logger.info(
                "WS_AUDIO_CHUNK_RECEIVED bytes=%s buffered_audio_bytes=%s",
                len(audio_chunk),
                len(audio_buffer),
            )
            logger.info(
                "Audio chunk received: %s bytes; buffered session audio: %s bytes",
                len(audio_chunk),
                len(audio_buffer),
            )

            fallback = transcriber.transcribe_chunk(audio_chunk)
            logger.info("WS_ASR_CALL buffered_audio_bytes=%s", len(audio_buffer))
            asr_result = transcribe_audio(bytes(audio_buffer), fallback_text=fallback.text)
            if asr_result["source"] == "pending" or not asr_result["text"].strip():
                logger.info(
                    "WS_TRANSCRIPT_SKIPPED source=%s buffered_audio_bytes=%s",
                    asr_result["source"],
                    len(audio_buffer),
                )
                continue

            if asr_result["source"] == "error":
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": asr_result["text"],
                    }
                )
                logger.info("WS_ASR_ERROR_SENT chars=%s", len(asr_result["text"]))
                continue

            transcript_text = asr_result["text"]
            if asr_result["source"] == "hf_asr":
                transcript_text = transcript_delta(last_hf_transcript, transcript_text)
                last_hf_transcript = asr_result["text"]
                if not transcript_text:
                    logger.info("WS_TRANSCRIPT_SKIPPED empty_hf_delta")
                    continue

            transcript = TranscriptMessage(
                text=transcript_text,
                is_final=False,
                source=asr_result["source"],
            )
            logger.info("Transcript source: %s", transcript.source)
            await websocket.send_json(transcript.model_dump())
            logger.info(
                "WS_TRANSCRIPT_SENT source=%s chars=%s",
                transcript.source,
                len(transcript.text),
            )
    except WebSocketDisconnect:
        logger.info("WS_TRANSCRIBE_DISCONNECTED")
        logger.info("WebSocket disconnected: /ws/transcribe")
        return


def transcript_delta(previous: str, current: str) -> str:
    previous = previous.strip()
    current = current.strip()
    if not previous:
        return current

    if current.startswith(previous):
        return current[len(previous):].strip()

    return current


if FRONTEND_DIST.exists():

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str) -> FileResponse:
        requested_path = FRONTEND_DIST / full_path
        if full_path and requested_path.is_file():
            return FileResponse(requested_path)

        return FileResponse(FRONTEND_DIST / "index.html")
