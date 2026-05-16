import logging
import re
from typing import Any

from huggingface_hub import HfApi

logger = logging.getLogger(__name__)

STOPWORDS = {
    "about",
    "agentic",
    "build",
    "connect",
    "face",
    "hugging",
    "idea",
    "models",
    "product",
    "relevant",
    "searches",
    "space",
    "spaces",
    "transcribes",
    "users",
    "where",
    "which",
    "with",
}


def search_hf_assets(transcript: str) -> dict[str, list[dict[str, Any]]]:
    queries = build_search_queries(transcript)
    logger.info("HF asset search enabled: true")
    logger.info("HF asset search queries: %s", queries)

    if not queries:
        return {"spaces": [], "models": [], "datasets": []}

    try:
        api = HfApi()
        spaces = search_spaces(api, queries)
        models = search_models(api, queries)
    except Exception as error:
        logger.warning("HF asset search failed: %s", error)
        return {"spaces": [], "models": [], "datasets": []}

    logger.info("HF asset search spaces found: %s", len(spaces))
    logger.info("HF asset search models found: %s", len(models))
    return {"spaces": spaces, "models": models, "datasets": []}


def build_search_queries(transcript: str) -> list[str]:
    lower = transcript.lower()
    queries: list[str] = []

    if any(term in lower for term in ["voice", "audio", "speech", "microphone", "transcribe"]):
        queries.append("whisper speech transcription")

    if any(term in lower for term in ["agent", "mcp", "tool", "connect", "workflow"]):
        queries.append("MCP agent tool")

    if any(term in lower for term in ["rag", "knowledge base", "document", "pdf", "search"]):
        queries.append("RAG chatbot PDF")

    if any(term in lower for term in ["image", "photo", "vision", "visual"]):
        queries.append("vision language image analysis")

    keyword_query = transcript_keyword_query(transcript)
    if keyword_query:
        queries.append(keyword_query)

    deduped: list[str] = []
    for query in queries:
        if query not in deduped:
            deduped.append(query)
    return deduped[:5]


def transcript_keyword_query(transcript: str) -> str:
    words = [
        word
        for word in re.findall(r"[a-zA-Z][a-zA-Z0-9-]{2,}", transcript.lower())
        if word not in STOPWORDS
    ]
    ranked = sorted(set(words), key=lambda word: (-words.count(word), words.index(word)))
    return " ".join(ranked[:5])


def search_spaces(api: HfApi, queries: list[str]) -> list[dict[str, Any]]:
    spaces: list[dict[str, Any]] = []
    seen: set[str] = set()
    for query in queries:
        for raw_space in api.list_spaces(search=query, limit=5):
            normalized = normalize_hub_asset(raw_space, "space")
            if normalized and normalized["hf_id"] not in seen:
                spaces.append(normalized)
                seen.add(normalized["hf_id"])
    return spaces


def search_models(api: HfApi, queries: list[str]) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for query in queries:
        for raw_model in api.list_models(search=query, limit=5):
            normalized = normalize_hub_asset(raw_model, "model")
            if normalized and normalized["hf_id"] not in seen:
                models.append(normalized)
                seen.add(normalized["hf_id"])
    return models


def normalize_hub_asset(raw_asset: Any, asset_type: str) -> dict[str, Any] | None:
    hf_id = str(
        getattr(raw_asset, "id", None)
        or getattr(raw_asset, "modelId", None)
        or getattr(raw_asset, "name", None)
        or ""
    ).strip()
    if not hf_id:
        return None

    url = f"https://huggingface.co/spaces/{hf_id}" if asset_type == "space" else f"https://huggingface.co/{hf_id}"
    return {
        "name": hf_id,
        "type": asset_type,
        "hf_id": hf_id,
        "url": url,
        "likes": getattr(raw_asset, "likes", None),
        "downloads": getattr(raw_asset, "downloads", None),
        "tags": list(getattr(raw_asset, "tags", None) or []),
        "source": "hf_hub_search",
        "confidence": "medium",
    }
