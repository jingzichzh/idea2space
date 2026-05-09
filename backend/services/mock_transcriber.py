from backend.schemas import GenerationStatusMessage, TranscriptMessage


MOCK_SEGMENTS = [
    "I want to build a voice first product studio",
    "where founders describe an idea out loud",
    "and the system turns it into architecture",
    "with a transcript, services, and a roadmap",
]


class MockTranscriber:
    def __init__(self) -> None:
        self.chunk_count = 0

    def transcribe_chunk(self, audio_chunk: bytes) -> TranscriptMessage:
        self.chunk_count += 1
        segment = MOCK_SEGMENTS[(self.chunk_count - 1) % len(MOCK_SEGMENTS)]
        return TranscriptMessage(text=segment)

    def generation_status(self) -> GenerationStatusMessage | None:
        if self.chunk_count > 0 and self.chunk_count % 4 == 0:
            return GenerationStatusMessage(status="generating_architecture")
        return None
