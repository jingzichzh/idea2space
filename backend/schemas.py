from pydantic import BaseModel


class TranscriptMessage(BaseModel):
    type: str = "transcript"
    text: str
    is_final: bool = False
    source: str = "mock"


class GenerationStatusMessage(BaseModel):
    type: str = "generation_status"
    status: str
