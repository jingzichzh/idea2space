import json
import logging
import os
import re
from typing import Any

from dotenv import load_dotenv
from huggingface_hub import InferenceClient

from backend.services.hf_catalog import catalog_as_prompt_context

load_dotenv()

logger = logging.getLogger(__name__)

PROMPT_VERSION = "v2"
MIN_TRANSCRIPT_DETAIL_CHARS = 80

ALLOWED_NODE_TYPES = {
    "input",
    "hf_model",
    "hf_inference",
    "frontend",
    "backend",
    "data",
    "deployment",
    "agent",
    "guardrail",
}


def generate_architecture_from_transcript(transcript: str) -> dict[str, Any]:
    cleaned_transcript = transcript.strip()
    logger.info("Architecture generation requested; transcript length: %s", len(cleaned_transcript))
    logger.info("Architecture prompt version: %s", PROMPT_VERSION)

    hf_token = os.getenv("HF_TOKEN")
    llm_model = os.getenv("LLM_MODEL", "").strip()
    logger.info("HF_TOKEN configured: %s", bool(hf_token))
    logger.info("LLM_MODEL configured: %s", bool(llm_model))
    logger.info("LLM_MODEL name: %s", llm_model or "<missing>")

    if not cleaned_transcript:
        return fallback_response("empty transcript", cleaned_transcript)

    if not hf_token:
        return fallback_response("HF_TOKEN missing", cleaned_transcript)

    if not llm_model:
        return fallback_response("LLM_MODEL missing", cleaned_transcript)

    try:
        client = InferenceClient(token=hf_token)
        completion = request_chat_completion(client, llm_model, cleaned_transcript)
        raw_content = extract_completion_text(completion)
        architecture = parse_architecture_json(raw_content)
        logger.info("Architecture nodes generated: %s", len(architecture["nodes"]))
        logger.info("Architecture edges generated: %s", len(architecture["edges"]))
        logger.info("Architecture generation source: hf_llm")
        return {"type": "architecture", "source": "hf_llm", "architecture": architecture}
    except Exception as error:
        logger.warning("Architecture generation fallback: %s", error)
        return fallback_response(str(error), cleaned_transcript)


def build_messages(transcript: str) -> list[dict[str, str]]:
    catalog_context = catalog_as_prompt_context()
    schema = """
{
  "summary": "string",
  "recommended_stack": ["string"],
  "nodes": [
    {
      "id": "string",
      "label": "string",
      "type": "input | hf_model | hf_inference | frontend | backend | data | deployment | agent | guardrail",
      "hf_component": "string",
      "role": "string",
      "why": "string",
      "confidence": 0.0
    }
  ],
  "edges": [
    {
      "source": "string",
      "target": "string",
      "label": "string"
    }
  ],
  "assumptions": ["string"],
  "next_steps": ["string"]
}
"""
    return [
        {
            "role": "system",
            "content": (
                "You are a senior Hugging Face solution architect for non-engineer builders. "
                "Turn product transcripts into practical first-version Hugging Face Space architectures. "
                "Prioritize Hugging Face-native components and simple deployable demos. "
                "Return strict JSON only. Do not include markdown, comments, prose, or code fences."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Hugging Face ecosystem catalog:\n{catalog_context}\n\n"
                f"Required JSON shape:\n{schema}\n\n"
                "Architecture decision guide:\n"
                "- If the user mentions voice/audio, include ASR with a Hugging Face Whisper model and an audio input node.\n"
                "- If the user mentions image/photo/visual, include a Hugging Face vision model.\n"
                "- If the user mentions documents/knowledge base/search, include embeddings, Sentence Transformers, a dataset, and retrieval.\n"
                "- If the user mentions chatbot/copilot/assistant, include an LLM plus prompt orchestration.\n"
                "- If the user mentions real-time, include WebSocket streaming or incremental UI updates.\n"
                "- If the user mentions deployment/demo, include Hugging Face Spaces or Docker Spaces.\n"
                "- If the user mentions saving user data, include a lightweight optional storage layer.\n"
                "- Use smolagents only when agentic tool orchestration is useful.\n"
                "- Use a vector database only when retrieval, memory, or long-term knowledge is clearly required.\n\n"
                "Hugging Face-first rules:\n"
                "- Prefer Hugging Face Spaces, Models, Datasets, Inference Providers, Inference Endpoints, Hub, Transformers, Sentence Transformers, Gradio, custom React frontend, FastAPI backend, and Space Secrets.\n"
                "- Do not recommend AWS, Firebase, Supabase, Pinecone, LangChain, Kubernetes, or complex cloud infrastructure unless the transcript clearly requires them.\n"
                "- Keep the first version suitable for a Hugging Face Space demo.\n"
                "- Make recommendations specific to the transcript, not generic.\n"
                "- Include 6 to 10 compact graph nodes.\n"
                "- Use stable kebab-case node ids.\n"
                "- Ensure every edge source and target matches a node id.\n"
                "- Use allowed node types only.\n"
                "- Each node must include id, label, type, hf_component, role, why, and confidence between 0 and 1.\n"
                "- Each edge must include source, target, and label.\n"
                "- Write for a non-engineer builder: useful, concrete, and short.\n"
                "- If the transcript is underspecified, still generate a reasonable architecture and add an assumption.\n\n"
                f"Transcript:\n{transcript}"
            ),
        },
    ]


def request_chat_completion(client: InferenceClient, llm_model: str, transcript: str) -> Any:
    messages = build_messages(transcript)
    try:
        return client.chat_completion(
            model=llm_model,
            messages=messages,
            max_tokens=1800,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
    except Exception as error:
        logger.warning("LLM JSON response_format request failed, retrying plain chat completion: %s", error)
        return client.chat_completion(
            model=llm_model,
            messages=messages,
            max_tokens=1800,
            temperature=0.2,
        )


def extract_completion_text(completion: Any) -> str:
    if isinstance(completion, dict):
        return str(completion["choices"][0]["message"]["content"])

    choices = getattr(completion, "choices", [])
    if not choices:
        return ""

    message = getattr(choices[0], "message", None)
    if isinstance(message, dict):
        return str(message.get("content", "")).strip()

    return str(getattr(message, "content", "")).strip()


def parse_architecture_json(raw_content: str) -> dict[str, Any]:
    sanitization_used = False
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError as error:
        logger.warning("Architecture JSON parse error: %s", error)
        sanitization_used = True
        parsed = json.loads(extract_json_object(raw_content))

    return validate_architecture(parsed, sanitization_used=sanitization_used)


def extract_json_object(raw_content: str) -> str:
    match = re.search(r"\{.*\}", raw_content, flags=re.DOTALL)
    if not match:
        raise ValueError("LLM response did not contain a JSON object")
    return match.group(0)


def validate_architecture(architecture: Any, sanitization_used: bool = False) -> dict[str, Any]:
    if not isinstance(architecture, dict):
        raise ValueError("Architecture response is not an object")

    nodes = architecture.get("nodes")
    edges = architecture.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ValueError("Architecture response requires nodes and edges arrays")

    assumptions = ensure_string_list(architecture.get("assumptions"))
    summary = str(
        architecture.get("summary")
        or architecture.get("user_input_summary")
        or architecture.get("one_liner")
        or "A Hugging Face-native product architecture."
    ).strip()

    if len(summary) < MIN_TRANSCRIPT_DETAIL_CHARS and not assumptions:
        assumptions.append("The product idea was underspecified, so this architecture uses a practical Hugging Face Space demo baseline.")
        sanitization_used = True

    recommended_stack = ensure_recommended_stack(architecture)
    normalized_nodes = []
    node_ids = set()
    for index, node in enumerate(nodes[:10]):
        if not isinstance(node, dict):
            sanitization_used = True
            continue

        node_id = slugify(str(node.get("id") or node.get("label") or f"node-{index + 1}"))
        node_ids.add(node_id)
        node_type = str(node.get("type") or "backend")
        if node_type not in ALLOWED_NODE_TYPES:
            sanitization_used = True
            node_type = "backend"

        label = str(node.get("label") or node_id).strip()[:48]
        hf_component = str(node.get("hf_component") or node.get("hf_tag") or infer_hf_component(label, node_type)).strip()[:48]
        role = str(node.get("role") or node.get("detail") or node_type.replace("_", " ")).strip()[:120]
        why = str(node.get("why") or "Included because it supports the first Hugging Face Space demo.").strip()[:220]
        confidence = normalize_confidence(node.get("confidence"))

        if not node.get("hf_component") or not node.get("role") or not node.get("why") or node.get("confidence") is None:
            sanitization_used = True

        normalized_nodes.append(
            {
                "id": node_id,
                "label": label,
                "type": node_type,
                "hf_component": hf_component,
                "role": role,
                "why": why,
                "confidence": confidence,
                "hf_tag": hf_component[:20],
            }
        )

    normalized_edges = []
    for edge in edges:
        if not isinstance(edge, dict):
            sanitization_used = True
            continue

        source = slugify(str(edge.get("source") or ""))
        target = slugify(str(edge.get("target") or ""))
        if source in node_ids and target in node_ids and source != target:
            label = str(edge.get("label") or "flows to").strip()[:40]
            if not edge.get("label"):
                sanitization_used = True
            normalized_edges.append({"source": source, "target": target, "label": label})

    if len(normalized_nodes) < 2:
        raise ValueError("Architecture response has too few valid nodes")

    logger.info("Architecture schema sanitization used: %s", sanitization_used)
    return {
        "summary": summary,
        "recommended_stack": recommended_stack,
        "nodes": normalized_nodes,
        "edges": normalized_edges,
        "assumptions": assumptions,
        "next_steps": ensure_string_list(architecture.get("next_steps")),
        "product_name": str(architecture.get("product_name") or "Generated HF Product").strip(),
        "one_liner": summary,
        "user_input_summary": summary,
        "recommended_hf_stack": recommended_stack_to_legacy(recommended_stack),
        "roadmap": next_steps_to_roadmap(architecture.get("next_steps")),
    }


def fallback_response(reason: str, transcript: str) -> dict[str, Any]:
    logger.info("Architecture generation source: mock; fallback reason: %s", reason)
    architecture = mock_architecture(transcript)
    logger.info("Architecture nodes generated: %s", len(architecture["nodes"]))
    logger.info("Architecture edges generated: %s", len(architecture["edges"]))
    logger.info("Architecture schema sanitization used: false")
    return {
        "type": "architecture",
        "source": "mock",
        "architecture": architecture,
    }


def mock_architecture(transcript: str) -> dict[str, Any]:
    summary = transcript[:220] if transcript else "No transcript was available."
    return {
        "summary": "A Hugging Face-native demo that captures voice, transcribes intent, and renders a system architecture.",
        "recommended_stack": [
            "Hugging Face Spaces for the demo surface",
            "Whisper ASR via Hugging Face Inference Providers",
            "FastAPI backend for WebSocket and generation endpoints",
            "React Flow frontend for architecture visualization",
            "Space Secrets for HF_TOKEN and model configuration",
        ],
        "assumptions": ["The idea was underspecified or LLM generation was unavailable, so a safe HF Space demo baseline is used."],
        "next_steps": ["Confirm target user and core workflow", "Choose ASR and LLM models", "Package as a Hugging Face Docker Space"],
        "product_name": "Voice-to-HF Architecture Studio",
        "one_liner": "Turns a spoken product idea into a Hugging Face-native architecture plan.",
        "user_input_summary": summary,
        "recommended_hf_stack": [
            {
                "layer": "Input",
                "component": "Browser microphone + WebSocket",
                "hf_ecosystem": "Spaces",
                "reason": "Captures the founder's spoken product intent inside a deployable demo surface.",
            },
            {
                "layer": "ASR",
                "component": "Whisper ASR",
                "hf_ecosystem": "Models / Inference Providers",
                "reason": "Converts speech into transcript text for downstream architecture generation.",
            },
            {
                "layer": "Deployment",
                "component": "Hugging Face Docker Space",
                "hf_ecosystem": "Docker Spaces / Space Secrets",
                "reason": "Packages the frontend, backend, and private tokens into a portable demo.",
            },
        ],
        "nodes": [
            {"id": "voice-input", "label": "Voice Input", "type": "input", "hf_component": "Browser MediaRecorder", "role": "Capture spoken product idea", "why": "The workflow begins with founder voice input.", "confidence": 0.9, "hf_tag": "MIC"},
            {"id": "whisper-asr", "label": "Whisper ASR", "type": "hf_model", "hf_component": "openai/whisper-large-v3", "role": "Transcribe speech to text", "why": "Voice/audio input requires ASR before architecture generation.", "confidence": 0.95, "hf_tag": "HF ASR"},
            {"id": "idea-parser", "label": "Idea Parser", "type": "backend", "hf_component": "FastAPI", "role": "Prepare transcript for generation", "why": "Custom API logic is needed between WebSocket ASR and LLM generation.", "confidence": 0.82, "hf_tag": "API"},
            {"id": "hf-recommender", "label": "HF Recommender", "type": "backend", "hf_component": "HF ecosystem catalog", "role": "Ground recommendations in HF components", "why": "The app should produce HF-native architectures.", "confidence": 0.86, "hf_tag": "HF HUB"},
            {"id": "architecture-json", "label": "Architecture JSON", "type": "data", "hf_component": "Typed JSON schema", "role": "Represent nodes, edges, and assumptions", "why": "The frontend needs a stable graph contract.", "confidence": 0.88, "hf_tag": "SCHEMA"},
            {"id": "react-flow-canvas", "label": "React Flow Canvas", "type": "frontend", "hf_component": "Custom React frontend", "role": "Render the generated architecture", "why": "A visual graph helps non-engineers inspect the system plan.", "confidence": 0.84, "hf_tag": "UI"},
            {"id": "docker-space", "label": "HF Docker Space", "type": "deployment", "hf_component": "Docker Spaces", "role": "Deploy the demo", "why": "The first version should run as a Hugging Face Space demo.", "confidence": 0.9, "hf_tag": "SPACE"},
            {"id": "space-secrets", "label": "Space Secrets", "type": "guardrail", "hf_component": "Space environment variables", "role": "Store HF_TOKEN and model settings", "why": "Tokens must not be committed or exposed in the UI.", "confidence": 0.92, "hf_tag": "ENV"},
        ],
        "edges": [
            {"source": "voice-input", "target": "whisper-asr", "label": "audio"},
            {"source": "whisper-asr", "target": "idea-parser", "label": "transcript"},
            {"source": "idea-parser", "target": "hf-recommender", "label": "requirements"},
            {"source": "hf-recommender", "target": "architecture-json", "label": "stack"},
            {"source": "architecture-json", "target": "react-flow-canvas", "label": "graph"},
            {"source": "react-flow-canvas", "target": "docker-space", "label": "deploy"},
            {"source": "space-secrets", "target": "docker-space", "label": "env"},
        ],
        "roadmap": [
            {"phase": "Prototype", "tasks": ["Capture transcript", "Render generated graph"]},
            {"phase": "HF Integration", "tasks": ["Select models", "Add evaluation dataset", "Prepare Space secrets"]},
        ],
    }


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "node"


def normalize_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.7

    return round(max(0, min(1, confidence)), 2)


def infer_hf_component(label: str, node_type: str) -> str:
    lower_label = label.lower()
    if "space" in lower_label or node_type == "deployment":
        return "Hugging Face Spaces"
    if "asr" in lower_label or "whisper" in lower_label:
        return "Hugging Face Whisper model"
    if "dataset" in lower_label or node_type == "data":
        return "Hugging Face Datasets"
    if node_type == "hf_inference":
        return "Inference Providers"
    if node_type == "hf_model":
        return "Hugging Face Models"
    if node_type == "agent":
        return "smolagents"
    if node_type == "guardrail":
        return "Space Secrets"
    if node_type == "frontend":
        return "Gradio or custom React frontend"
    return "FastAPI / Hugging Face Hub"


def ensure_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def ensure_recommended_stack(architecture: dict[str, Any]) -> list[str]:
    if isinstance(architecture.get("recommended_stack"), list):
        return [str(item).strip() for item in architecture["recommended_stack"] if str(item).strip()]

    legacy_stack = architecture.get("recommended_hf_stack")
    if isinstance(legacy_stack, list):
        stack = []
        for item in legacy_stack:
            if isinstance(item, dict):
                component = item.get("component") or item.get("hf_ecosystem") or item.get("layer")
                if component:
                    stack.append(str(component).strip())
            elif str(item).strip():
                stack.append(str(item).strip())
        return stack

    return []


def recommended_stack_to_legacy(stack: list[str]) -> list[dict[str, str]]:
    return [
        {
            "layer": "Recommended",
            "component": item,
            "hf_ecosystem": item,
            "reason": "Selected by the architecture generator for this transcript.",
        }
        for item in stack
    ]


def next_steps_to_roadmap(value: Any) -> list[dict[str, Any]]:
    next_steps = ensure_string_list(value)
    if not next_steps:
        return []
    return [{"phase": "Next", "tasks": next_steps}]
