import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.schemas import TranscriptMessage
from backend.services.asr import transcribe_audio
from backend.services.mock_transcriber import MockTranscriber

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="idea2space Phase 3 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/transcribe")
async def transcribe(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("WebSocket connected: /ws/transcribe")
    transcriber = MockTranscriber()
    audio_buffer = bytearray()

    try:
        while True:
            audio_chunk = await websocket.receive_bytes()
            audio_buffer.extend(audio_chunk)
            logger.info(
                "Audio chunk received: %s bytes; buffered session audio: %s bytes",
                len(audio_chunk),
                len(audio_buffer),
            )

            fallback = transcriber.transcribe_chunk(audio_chunk)
            asr_result = transcribe_audio(bytes(audio_buffer), fallback_text=fallback.text)
            transcript = TranscriptMessage(
                text=asr_result["text"],
                is_final=False,
                source=asr_result["source"],
            )
            logger.info("Transcript source: %s", transcript.source)
            await websocket.send_json(transcript.model_dump())

            status = transcriber.generation_status()
            if status is not None:
                await websocket.send_json(status.model_dump())
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: /ws/transcribe")
        return
