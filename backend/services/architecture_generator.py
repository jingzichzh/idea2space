import json
import logging
import os
import re
from typing import Any

from dotenv import load_dotenv
from huggingface_hub import InferenceClient

from backend.services.hf_asset_search import search_hf_assets
from backend.services.hf_catalog import asset_catalog_as_prompt_context, catalog_as_prompt_context, load_hf_asset_catalog

load_dotenv()

logger = logging.getLogger(__name__)

PROMPT_VERSION = "v3-assets"
MIN_TRANSCRIPT_DETAIL_CHARS = 80
ASSET_TYPES = {"space", "model", "dataset", "doc", "tool"}
USE_MODES = {"fork", "reference", "connect_as_tool", "use_model", "dataset_source"}
CONFIDENCE_LABELS = {"high", "medium", "low"}
ASSET_SOURCES = {"hf_hub_search", "curated_catalog"}

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
    product_brief = parse_product_brief(cleaned_transcript)
    logger.info("Parsed product brief: %s", json.dumps(product_brief, ensure_ascii=True))

    hf_token = os.getenv("HF_TOKEN")
    llm_model = os.getenv("LLM_MODEL", "").strip()
    logger.info("HF_TOKEN configured: %s", bool(hf_token))
    logger.info("LLM_MODEL configured: %s", bool(llm_model))
    logger.info("LLM_MODEL name: %s", llm_model or "<missing>")

    hf_asset_search_results = search_hf_assets(cleaned_transcript) if cleaned_transcript else {"spaces": [], "models": [], "datasets": []}

    if not cleaned_transcript:
        return fallback_response("empty transcript", cleaned_transcript, hf_asset_search_results)

    if not hf_token:
        return fallback_response("HF_TOKEN missing", cleaned_transcript, hf_asset_search_results)

    if not llm_model:
        return fallback_response("LLM_MODEL missing", cleaned_transcript, hf_asset_search_results)

    try:
        client = InferenceClient(token=hf_token)
        completion = request_chat_completion(client, llm_model, cleaned_transcript, hf_asset_search_results, product_brief)
        raw_content = extract_completion_text(completion)
        architecture = parse_architecture_json(raw_content, cleaned_transcript, hf_asset_search_results, product_brief)
        logger.info("Architecture nodes generated: %s", len(architecture["nodes"]))
        logger.info("Architecture edges generated: %s", len(architecture["edges"]))
        logger.info("Architecture generation source: hf_llm")
        return {"type": "architecture", "source": "hf_llm", "prompt_version": PROMPT_VERSION, "architecture": architecture}
    except Exception as error:
        logger.warning("Architecture generation fallback: %s", error)
        return fallback_response(str(error), cleaned_transcript, hf_asset_search_results)


def build_messages(
    transcript: str,
    hf_asset_search_results: dict[str, list[dict[str, Any]]],
    product_brief: dict[str, Any],
) -> list[dict[str, str]]:
    catalog_context = catalog_as_prompt_context()
    asset_catalog_context = asset_catalog_as_prompt_context()
    hub_search_context = json.dumps(hf_asset_search_results, indent=2)
    product_brief_context = json.dumps(product_brief, indent=2)
    schema = """
{
  "summary": "string",
  "recommended_stack": ["string"],
  "recommended_hf_assets": [
    {
      "name": "string",
      "type": "space | model | dataset | doc | tool",
      "hf_id": "string",
      "url": "string",
      "role": "string",
      "why_relevant": "string",
      "use_mode": "fork | reference | connect_as_tool | use_model | dataset_source",
      "agent_ready": true,
      "mcp_ready": true,
      "confidence": "high | medium | low",
      "source": "hf_hub_search | curated_catalog",
      "attach_to_node_id": "string",
      "note": "string"
    }
  ],
  "nodes": [
    {
      "id": "string",
      "label": "string",
      "type": "input | hf_model | hf_inference | frontend | backend | data | deployment | agent | guardrail",
      "hf_component": "string",
      "role": "string",
      "why": "string",
      "confidence": 0.0,
      "recommended_assets": []
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
                f"Parsed product brief:\n{product_brief_context}\n\n"
                f"Real Hugging Face Hub search results from hf_hub_search:\n{hub_search_context}\n\n"
                f"Curated clickable Hugging Face asset catalog:\n{asset_catalog_context}\n\n"
                f"Required JSON shape:\n{schema}\n\n"
                "Architecture decision guide:\n"
                "- Use the parsed product brief as the primary source for product_type, target_user, inputs, outputs, existing assets, required capabilities, platform, and asset types.\n"
                "- Reflect the user's actual product, not only a generic voice-to-text pipeline.\n"
                "- If existing_assets_or_context is present, include it as an explicit node and route new capabilities into or out of it.\n"
                "- If the user wants to add speaking to an existing text generation Space, include these nodes: Existing Text Generation Space, Microphone / Audio Input, Whisper ASR, Prompt Handoff, Generated Text Output, Voice-enabled Space Deployment.\n"
                "- If the user mentions voice/audio, include ASR with a Hugging Face Whisper model and an audio input node.\n"
                "- If the user mentions image/photo/visual, include a Hugging Face vision model.\n"
                "- If the user mentions documents/knowledge base/search, include embeddings, Sentence Transformers, a dataset, and retrieval.\n"
                "- If the user mentions chatbot/copilot/assistant, include an LLM plus prompt orchestration.\n"
                "- If the user mentions real-time, include WebSocket streaming or incremental UI updates.\n"
                "- If the user mentions deployment/demo, include Hugging Face Spaces or Docker Spaces.\n"
                "- If the user mentions saving user data, include a lightweight optional storage layer.\n"
                "- Avoid Hugging Face Datasets unless the product needs persistent examples, logs, evaluation data, or dataset storage.\n"
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
                "- Each node may include recommended_assets, but every asset must also appear in top-level recommended_hf_assets.\n"
                "- Each edge must include source, target, and label.\n"
                "- Recommend concrete clickable Hugging Face assets that users can open, fork, reference, connect as tools, or use as models.\n"
                "- Prefer real assets from hf_hub_search when relevant.\n"
                "- Do not invent fake Space names.\n"
                "- If search results are weak, use the curated catalog as fallback.\n"
                "- Mark every asset source as hf_hub_search or curated_catalog.\n"
                "- If recommending an asset outside the catalog, set confidence to low and note: \"verify on Hugging Face before using.\"\n"
                "- For agent, tool, automation, workflow, connect, MCP, action, or Space-as-tool requests, prioritize MCP / agent assets first.\n"
                "- If the transcript says existing Spaces should be used as tools, recommend Spaces as Agent Tools docs and compatible Spaces.\n"
                "- If the transcript involves searching Hugging Face assets, recommend the Hugging Face MCP Server docs and dylanebert/huggingface-mcp.\n"
                "- At least one relevant asset should use connect_as_tool when the workflow is agentic or MCP-oriented.\n"
                "- Write for a non-engineer builder: useful, concrete, and short.\n"
                "- If the transcript is underspecified, still generate a reasonable architecture and add an assumption.\n\n"
                f"Transcript:\n{transcript}"
            ),
        },
    ]


def request_chat_completion(
    client: InferenceClient,
    llm_model: str,
    transcript: str,
    hf_asset_search_results: dict[str, list[dict[str, Any]]],
    product_brief: dict[str, Any],
) -> Any:
    messages = build_messages(transcript, hf_asset_search_results, product_brief)
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


def parse_architecture_json(
    raw_content: str,
    transcript: str,
    hf_asset_search_results: dict[str, list[dict[str, Any]]],
    product_brief: dict[str, Any],
) -> dict[str, Any]:
    sanitization_used = False
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError as error:
        logger.warning("Architecture JSON parse error: %s", error)
        sanitization_used = True
        parsed = json.loads(extract_json_object(raw_content))

    return validate_architecture(parsed, transcript, hf_asset_search_results, product_brief, sanitization_used=sanitization_used)


def extract_json_object(raw_content: str) -> str:
    match = re.search(r"\{.*\}", raw_content, flags=re.DOTALL)
    if not match:
        raise ValueError("LLM response did not contain a JSON object")
    return match.group(0)


def validate_architecture(
    architecture: Any,
    transcript: str,
    hf_asset_search_results: dict[str, list[dict[str, Any]]],
    product_brief: dict[str, Any],
    sanitization_used: bool = False,
) -> dict[str, Any]:
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
    recommended_assets, asset_sanitized = ensure_recommended_assets(
        architecture.get("recommended_hf_assets"),
        transcript,
        hf_asset_search_results,
        product_brief,
    )
    sanitization_used = sanitization_used or asset_sanitized
    log_recommended_asset_source_mix(recommended_assets)
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

        node_assets = attach_assets_to_node(node_id, recommended_assets)

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
                "recommended_assets": node_assets,
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

    next_steps = ensure_string_list(architecture.get("next_steps"))
    product_name = str(architecture.get("product_name") or "Generated HF Product").strip()
    roadmap = next_steps_to_roadmap(next_steps, product_brief)
    build_prompt = build_code_agent_prompt(
        transcript=transcript,
        product_brief=product_brief,
        product_name=product_name,
        summary=summary,
        nodes=normalized_nodes,
        edges=normalized_edges,
        recommended_assets=recommended_assets,
        recommended_stack=recommended_stack,
        next_steps=next_steps,
    )

    logger.info("Architecture schema sanitization used: %s", sanitization_used)
    return {
        "summary": summary,
        "recommended_stack": recommended_stack,
        "recommended_hf_assets": recommended_assets,
        "nodes": normalized_nodes,
        "edges": normalized_edges,
        "assumptions": assumptions,
        "next_steps": next_steps,
        "product_name": product_name,
        "one_liner": summary,
        "user_input_summary": summary,
        "recommended_hf_stack": recommended_stack_to_legacy(recommended_stack),
        "roadmap": roadmap,
        "build_prompt": build_prompt,
    }


def fallback_response(
    reason: str,
    transcript: str,
    hf_asset_search_results: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    logger.info("Architecture generation source: mock; fallback reason: %s", reason)
    architecture = mock_architecture(
        transcript,
        hf_asset_search_results or {"spaces": [], "models": [], "datasets": []},
        parse_product_brief(transcript),
    )
    logger.info("Architecture nodes generated: %s", len(architecture["nodes"]))
    logger.info("Architecture edges generated: %s", len(architecture["edges"]))
    logger.info("Architecture schema sanitization used: false")
    return {
        "type": "architecture",
        "source": "mock",
        "prompt_version": PROMPT_VERSION,
        "architecture": architecture,
    }


def mock_architecture(
    transcript: str,
    hf_asset_search_results: dict[str, list[dict[str, Any]]] | None = None,
    product_brief: dict[str, Any] | None = None,
) -> dict[str, Any]:
    summary = transcript[:220] if transcript else "No transcript was available."
    brief = product_brief or parse_product_brief(transcript)
    recommended_assets, _ = ensure_recommended_assets(
        [],
        transcript,
        hf_asset_search_results or {"spaces": [], "models": [], "datasets": []},
        brief,
    )
    log_recommended_asset_source_mix(recommended_assets)
    if is_existing_text_generation_voice_upgrade(brief):
        fallback_nodes = voice_upgrade_nodes()
        fallback_edges = [
            {"source": "microphone-input", "target": "whisper-asr", "label": "audio"},
            {"source": "whisper-asr", "target": "prompt-handoff", "label": "transcript"},
            {"source": "existing-text-generation-space", "target": "prompt-handoff", "label": "reuse"},
            {"source": "prompt-handoff", "target": "generated-text-output", "label": "prompt"},
            {"source": "generated-text-output", "target": "voice-enabled-space", "label": "display"},
            {"source": "voice-enabled-space", "target": "space-secrets", "label": "config"},
        ]
        recommended_stack = [
            "Existing Hugging Face text generation Space",
            "Browser microphone input",
            "Whisper ASR via Hugging Face Inference Providers",
            "Prompt handoff into the existing generation function",
            "Updated voice-enabled Hugging Face Space deployment",
        ]
        next_steps = [
            "Identify the existing text generation Space entry point",
            "Add microphone capture and Whisper transcription",
            "Pass transcribed text into the current generation function",
            "Deploy the updated voice-enabled Space",
        ]
        product_name = "Voice-enabled Text Generation Space"
        one_liner = "Adds speech input to an existing text generation Space without replacing the generation flow."
    else:
        fallback_nodes = [
        {"id": "voice-input", "label": "Voice Input", "type": "input", "hf_component": "Browser MediaRecorder", "role": "Capture spoken product idea", "why": "The workflow begins with founder voice input.", "confidence": 0.9, "hf_tag": "MIC"},
        {"id": "whisper-asr", "label": "Whisper ASR", "type": "hf_model", "hf_component": "openai/whisper-large-v3", "role": "Transcribe speech to text", "why": "Voice/audio input requires ASR before architecture generation.", "confidence": 0.95, "hf_tag": "HF ASR"},
        {"id": "idea-parser", "label": "Idea Parser", "type": "backend", "hf_component": "FastAPI", "role": "Prepare transcript for generation", "why": "Custom API logic is needed between WebSocket ASR and LLM generation.", "confidence": 0.82, "hf_tag": "API"},
        {"id": "hf-recommender", "label": "HF Recommender", "type": "backend", "hf_component": "HF ecosystem catalog", "role": "Ground recommendations in HF components", "why": "The app should produce HF-native architectures.", "confidence": 0.86, "hf_tag": "HF HUB"},
        {"id": "architecture-json", "label": "Architecture JSON", "type": "data", "hf_component": "Typed JSON schema", "role": "Represent nodes, edges, and assumptions", "why": "The frontend needs a stable graph contract.", "confidence": 0.88, "hf_tag": "SCHEMA"},
        {"id": "react-flow-canvas", "label": "React Flow Canvas", "type": "frontend", "hf_component": "Custom React frontend", "role": "Render the generated architecture", "why": "A visual graph helps non-engineers inspect the system plan.", "confidence": 0.84, "hf_tag": "UI"},
        {"id": "docker-space", "label": "HF Docker Space", "type": "deployment", "hf_component": "Docker Spaces", "role": "Deploy the demo", "why": "The first version should run as a Hugging Face Space demo.", "confidence": 0.9, "hf_tag": "SPACE"},
        {"id": "space-secrets", "label": "Space Secrets", "type": "guardrail", "hf_component": "Space environment variables", "role": "Store HF_TOKEN and model settings", "why": "Tokens must not be committed or exposed in the UI.", "confidence": 0.92, "hf_tag": "ENV"},
        ]
        fallback_edges = [
            {"source": "voice-input", "target": "whisper-asr", "label": "audio"},
            {"source": "whisper-asr", "target": "idea-parser", "label": "transcript"},
            {"source": "idea-parser", "target": "hf-recommender", "label": "requirements"},
            {"source": "hf-recommender", "target": "architecture-json", "label": "stack"},
            {"source": "architecture-json", "target": "react-flow-canvas", "label": "graph"},
            {"source": "react-flow-canvas", "target": "docker-space", "label": "deploy"},
            {"source": "space-secrets", "target": "docker-space", "label": "env"},
        ]
        recommended_stack = [
            "Hugging Face Spaces for the demo surface",
            "Whisper ASR via Hugging Face Inference Providers",
            "FastAPI backend for WebSocket and generation endpoints",
            "React Flow frontend for architecture visualization",
            "Space Secrets for HF_TOKEN and model configuration",
        ]
        next_steps = brief_next_steps(brief)
        product_name = "Voice-to-HF Architecture Studio"
        one_liner = "Turns a spoken product idea into a Hugging Face-native architecture plan."
    fallback_nodes = [{**node, "recommended_assets": attach_assets_to_node(node["id"], recommended_assets)} for node in fallback_nodes]
    build_prompt = build_code_agent_prompt(
        transcript=transcript,
        product_brief=brief,
        product_name=product_name,
        summary=one_liner,
        nodes=fallback_nodes,
        edges=fallback_edges,
        recommended_assets=recommended_assets,
        recommended_stack=recommended_stack,
        next_steps=next_steps,
    )
    return {
        "summary": one_liner,
        "recommended_stack": recommended_stack,
        "recommended_hf_assets": recommended_assets,
        "assumptions": ["The idea was underspecified or LLM generation was unavailable, so a safe HF Space demo baseline is used."],
        "next_steps": next_steps,
        "product_name": product_name,
        "one_liner": one_liner,
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
        "nodes": fallback_nodes,
        "edges": fallback_edges,
        "roadmap": next_steps_to_roadmap(next_steps, brief),
        "build_prompt": build_prompt,
    }


def build_code_agent_prompt(
    transcript: str,
    product_brief: dict[str, Any],
    product_name: str,
    summary: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    recommended_assets: list[dict[str, Any]],
    recommended_stack: list[str],
    next_steps: list[str],
) -> str:
    ui_framework = infer_build_prompt_ui_framework(nodes, recommended_stack)
    files = expected_files_for_ui_framework(ui_framework)
    env_vars = expected_env_vars(nodes, recommended_assets)
    target_user = str(product_brief.get("target_user") or "app users")
    target_platform = "Hugging Face Space"
    input_modes = ", ".join(product_brief.get("input_modes") or ["text"])
    output_modes = ", ".join(product_brief.get("output_modes") or ["app response"])
    required_capabilities = format_bullets(product_brief.get("required_capabilities") or [])
    existing_context = format_bullets(product_brief.get("existing_assets_or_context") or ["No existing asset was specified."])
    stack_lines = format_bullets(recommended_stack)
    node_lines = format_node_lines(nodes)
    edge_lines = format_edge_lines(edges)
    asset_lines = format_asset_lines(recommended_assets)
    next_step_lines = format_bullets(next_steps)
    file_lines = format_bullets(files)
    env_lines = format_bullets(env_vars)
    transcript_excerpt = transcript.strip() or "No transcript was provided."

    return "\n".join(
        [
            f"Build a minimal deployable Hugging Face Space for: {product_name}",
            "",
            "Product goal:",
            f"- {summary}",
            "",
            "Original user idea:",
            f"- {transcript_excerpt}",
            "",
            "Product brief:",
            f"- Product type: {product_brief.get('product_type') or 'Hugging Face Space app'}",
            f"- Target user: {target_user}",
            f"- Target platform: {target_platform}",
            f"- Input modes: {input_modes}",
            f"- Output modes: {output_modes}",
            "- Existing assets or context:",
            existing_context,
            "- Required capabilities:",
            required_capabilities,
            "",
            "Recommended implementation:",
            f"- UI framework: {ui_framework}",
            "- Keep the implementation minimal, readable, and deployable on Hugging Face Spaces.",
            "- Prefer Hugging Face-native models, Spaces, docs, and Space Secrets over external infrastructure.",
            "- Avoid adding datasets unless persistent examples, logs, evaluation data, or dataset storage is required.",
            "",
            "Input/output flow:",
            f"- Inputs: {input_modes}",
            f"- Outputs: {output_modes}",
            "- Architecture flow:",
            edge_lines,
            "",
            "Key architecture steps:",
            node_lines,
            "",
            "Recommended Hugging Face assets:",
            asset_lines,
            "",
            "Recommended stack:",
            stack_lines,
            "",
            "Expected files:",
            file_lines,
            "",
            "Environment variables and secrets:",
            env_lines,
            "",
            "Build steps:",
            next_step_lines,
            "",
            "Acceptance criteria:",
            "- The Space runs locally and on Hugging Face Spaces without manual code edits after secrets are configured.",
            "- The main user workflow from input to output works end to end.",
            "- Hugging Face asset links in the README point to the recommended assets above when URLs are available.",
            "- Errors are shown clearly in the UI instead of failing silently.",
            "- The implementation stays small enough for a first demo and avoids unnecessary infrastructure.",
        ]
    )


def infer_build_prompt_ui_framework(nodes: list[dict[str, Any]], recommended_stack: list[str]) -> str:
    text = " ".join(
        [
            *recommended_stack,
            *[str(node.get("label") or "") for node in nodes],
            *[str(node.get("hf_component") or "") for node in nodes],
            *[str(node.get("role") or "") for node in nodes],
        ]
    ).lower()
    if "react" in text or "react flow" in text or "custom frontend" in text:
        return "React frontend with a small FastAPI backend"
    if "gradio" in text:
        return "Gradio"
    return "Gradio for the first Space demo"


def expected_files_for_ui_framework(ui_framework: str) -> list[str]:
    if "react" in ui_framework.lower():
        return [
            "frontend/package.json",
            "frontend/src/App.tsx",
            "frontend/src/App.css",
            "backend/app.py or main.py",
            "requirements.txt",
            "README.md",
            ".env.example",
        ]
    return ["app.py", "requirements.txt", "README.md", ".env.example"]


def expected_env_vars(nodes: list[dict[str, Any]], recommended_assets: list[dict[str, Any]]) -> list[str]:
    text = " ".join(
        [
            *[str(node.get("label") or "") for node in nodes],
            *[str(node.get("hf_component") or "") for node in nodes],
            *[str(asset.get("name") or "") for asset in recommended_assets],
            *[str(asset.get("role") or "") for asset in recommended_assets],
        ]
    ).lower()
    env_vars = ["HF_TOKEN if private models, gated models, Inference Providers, or Hub writes are used"]
    if "endpoint" in text:
        env_vars.append("HF_ENDPOINT_URL if using a dedicated Inference Endpoint")
    if "model" in text or "llm" in text or "whisper" in text:
        env_vars.append("MODEL_ID or ASR_MODEL_ID for configurable model selection")
    if "mcp" in text or "agent" in text:
        env_vars.append("Any API keys required by connected tools, stored as Hugging Face Space Secrets")
    return env_vars


def format_node_lines(nodes: list[dict[str, Any]]) -> str:
    if not nodes:
        return "- Define the minimal app flow."
    return "\n".join(
        f"- {node.get('label')}: {node.get('role') or node.get('type') or 'app step'}"
        for node in nodes
    )


def format_edge_lines(edges: list[dict[str, Any]]) -> str:
    if not edges:
        return "- Connect the input, model/backend logic, UI output, and Space deployment."
    return "\n".join(
        f"- {edge.get('source')} -> {edge.get('target')}: {edge.get('label') or 'flows to'}"
        for edge in edges
    )


def format_asset_lines(assets: list[dict[str, Any]]) -> str:
    if not assets:
        return "- No concrete Hugging Face assets were available; choose the simplest relevant model or Space during implementation."
    lines = []
    for asset in assets[:8]:
        url = asset.get("url") or "verify URL on Hugging Face"
        source = asset.get("source") or "curated_catalog"
        lines.append(
            f"- {asset.get('name')} ({asset.get('type')}, {source}): {url} - {asset.get('role') or asset.get('why_relevant') or 'Reference asset'}"
        )
    return "\n".join(lines)


def format_bullets(values: list[Any]) -> str:
    cleaned = [str(value).strip() for value in values if str(value).strip()]
    if not cleaned:
        return "- Keep this section minimal for the first demo."
    return "\n".join(f"- {value}" for value in cleaned)


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


def parse_product_brief(transcript: str) -> dict[str, Any]:
    lower = transcript.lower()
    has_voice = has_any(lower, ["voice", "audio", "speech", "speak", "microphone", "transcribe", "talk"])
    has_text_generation = has_any(lower, ["text generation", "generate text", "writing", "copy", "story", "prompt"])
    has_existing_space = has_any(lower, ["i have", "existing", "my space", "current space", "already"]) and "space" in lower
    needs_search = has_any(lower, ["search", "find", "recommend", "relevant"])
    needs_agent = has_any(lower, ["agent", "mcp", "tool", "workflow", "connect"])
    needs_rag = has_any(lower, ["rag", "knowledge base", "document", "pdf", "retrieval"])
    needs_vision = has_any(lower, ["image", "photo", "vision", "visual"])
    needs_dataset = has_any(lower, ["dataset", "examples", "logs", "evaluation", "eval", "store examples", "training data"])

    input_modes = []
    if has_voice:
        input_modes.append("voice/audio")
    if has_any(lower, ["type", "typing", "text", "prompt"]) or has_text_generation:
        input_modes.append("text")
    if needs_vision:
        input_modes.append("image")
    if needs_rag:
        input_modes.append("document")

    output_modes = []
    if has_text_generation or "text" in lower:
        output_modes.append("generated text")
    if needs_search:
        output_modes.append("asset recommendations")
    if needs_vision:
        output_modes.append("visual analysis")
    if not output_modes:
        output_modes.append("interactive app response")

    required_capabilities = []
    if has_voice:
        required_capabilities.extend(["microphone capture", "speech transcription"])
    if has_existing_space:
        required_capabilities.append("reuse existing Space logic")
    if has_text_generation:
        required_capabilities.append("text generation")
    if needs_search:
        required_capabilities.append("Hugging Face Hub search")
    if needs_agent:
        required_capabilities.append("agent or MCP tool connection")
    if needs_rag:
        required_capabilities.append("retrieval over documents")
    if needs_vision:
        required_capabilities.append("image understanding")
    if needs_dataset:
        required_capabilities.append("dataset storage or evaluation data")

    recommended_asset_types = ["space", "model"]
    if needs_agent:
        recommended_asset_types.append("doc")
        recommended_asset_types.append("tool")
    if needs_dataset:
        recommended_asset_types.append("dataset")

    brief = {
        "product_type": infer_product_type(lower, has_existing_space, has_text_generation, needs_agent, needs_rag, needs_vision),
        "target_user": infer_target_user(lower),
        "input_modes": unique_strings(input_modes),
        "output_modes": unique_strings(output_modes),
        "existing_assets_or_context": infer_existing_assets(lower, has_existing_space, has_text_generation),
        "required_capabilities": unique_strings(required_capabilities),
        "target_platform": "Hugging Face Space" if "space" in lower or "hugging face" in lower else "web app",
        "recommended_hf_asset_types": unique_strings(recommended_asset_types),
    }
    return brief


def infer_product_type(
    lower: str,
    has_existing_space: bool,
    has_text_generation: bool,
    needs_agent: bool,
    needs_rag: bool,
    needs_vision: bool,
) -> str:
    if has_existing_space and has_text_generation and has_any(lower, ["speak", "voice", "audio", "microphone"]):
        return "voice upgrade for existing text generation Space"
    if needs_agent:
        return "agentic Hugging Face asset recommender"
    if needs_rag:
        return "RAG document assistant"
    if needs_vision:
        return "vision-language app"
    if has_text_generation:
        return "text generation app"
    return "Hugging Face Space app"


def infer_target_user(lower: str) -> str:
    if "founder" in lower:
        return "founders"
    if "user" in lower:
        return "end users"
    if "team" in lower:
        return "product team"
    if "developer" in lower or "builder" in lower:
        return "builders"
    return "app users"


def infer_existing_assets(lower: str, has_existing_space: bool, has_text_generation: bool) -> list[str]:
    assets = []
    if has_existing_space and has_text_generation:
        assets.append("existing text generation Space")
    elif has_existing_space:
        assets.append("existing Hugging Face Space")
    if "existing spaces" in lower:
        assets.append("existing Hugging Face Spaces")
    if "existing models" in lower:
        assets.append("existing Hugging Face Models")
    return assets


def has_any(value: str, terms: list[str]) -> bool:
    return any(term in value for term in terms)


def unique_strings(values: list[str]) -> list[str]:
    deduped = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped


def is_existing_text_generation_voice_upgrade(product_brief: dict[str, Any]) -> bool:
    return product_brief.get("product_type") == "voice upgrade for existing text generation Space"


def voice_upgrade_nodes() -> list[dict[str, Any]]:
    return [
        {"id": "existing-text-generation-space", "label": "Existing Text Generation Space", "type": "deployment", "hf_component": "Hugging Face Space", "role": "Keep the current text generation app and generation function", "why": "The user already has a text generation Space and wants to add voice input instead of replacing it.", "confidence": 0.93, "hf_tag": "EXISTING SPACE"},
        {"id": "microphone-input", "label": "Microphone / Audio Input", "type": "input", "hf_component": "Browser MediaRecorder", "role": "Capture spoken prompts from the user", "why": "The requested change is speaking instead of typing.", "confidence": 0.94, "hf_tag": "MIC"},
        {"id": "whisper-asr", "label": "Whisper ASR", "type": "hf_model", "hf_component": "openai/whisper-large-v3", "role": "Convert speech into prompt text", "why": "The existing text generator still needs text input.", "confidence": 0.95, "hf_tag": "HF ASR"},
        {"id": "prompt-handoff", "label": "Prompt Handoff", "type": "backend", "hf_component": "Existing generation function", "role": "Send the transcript into the existing text generation function", "why": "This reuses the Space's current text generation flow.", "confidence": 0.9, "hf_tag": "HANDOFF"},
        {"id": "generated-text-output", "label": "Generated Text Output", "type": "frontend", "hf_component": "Space UI output panel", "role": "Display the generated text response", "why": "The output remains generated text, only the input mode changes.", "confidence": 0.88, "hf_tag": "TEXT OUT"},
        {"id": "voice-enabled-space", "label": "Voice-enabled Space Deployment", "type": "deployment", "hf_component": "Hugging Face Space", "role": "Ship the existing Space with microphone input enabled", "why": "The final deliverable is an updated Space that supports speech input.", "confidence": 0.91, "hf_tag": "HF SPACE"},
        {"id": "space-secrets", "label": "Space Secrets", "type": "guardrail", "hf_component": "Space environment variables", "role": "Keep model tokens and endpoint settings private", "why": "Voice transcription and generation settings should stay server-side.", "confidence": 0.9, "hf_tag": "ENV"},
    ]


def brief_next_steps(product_brief: dict[str, Any]) -> list[str]:
    if is_existing_text_generation_voice_upgrade(product_brief):
        return [
            "Identify the existing text generation Space entry point",
            "Add microphone capture and Whisper transcription",
            "Pass transcribed text into the current generation function",
            "Deploy the updated voice-enabled Space",
        ]
    steps = ["Confirm the target user and core workflow"]
    if "speech transcription" in product_brief.get("required_capabilities", []):
        steps.append("Choose the Whisper ASR path")
    if "Hugging Face Hub search" in product_brief.get("required_capabilities", []):
        steps.append("Select Hub search assets to recommend")
    if "dataset" in product_brief.get("recommended_hf_asset_types", []):
        steps.append("Define what dataset storage or evaluation data is needed")
    steps.append("Package the first version as a Hugging Face Space")
    return steps


def next_steps_to_roadmap(value: Any, product_brief: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    next_steps = ensure_string_list(value)
    if not next_steps and product_brief:
        next_steps = brief_next_steps(product_brief)
    if not next_steps:
        return []
    phase = "Voice Upgrade" if product_brief and is_existing_text_generation_voice_upgrade(product_brief) else "Next"
    return [{"phase": phase, "tasks": next_steps}]


def ensure_recommended_assets(
    value: Any,
    transcript: str,
    hf_asset_search_results: dict[str, list[dict[str, Any]]],
    product_brief: dict[str, Any],
) -> tuple[list[dict[str, Any]], bool]:
    curated_assets = load_hf_asset_catalog()["assets"]
    curated_by_id = {asset["hf_id"]: {**asset, "source": "curated_catalog"} for asset in curated_assets}
    hub_assets = flatten_hub_search_assets(hf_asset_search_results)
    hub_by_id = {asset["hf_id"]: asset for asset in hub_assets}
    sanitized = False
    assets: list[dict[str, Any]] = []

    if isinstance(value, list):
        for raw_asset in value:
            if not isinstance(raw_asset, dict):
                sanitized = True
                continue

            hf_id = str(raw_asset.get("hf_id") or "").strip()
            curated = curated_by_id.get(hf_id)
            hub_asset = hub_by_id.get(hf_id)
            if hub_asset:
                asset = {**hub_asset, **raw_asset, "source": "hf_hub_search"}
            elif curated:
                asset = {**curated, **raw_asset}
                asset["source"] = "curated_catalog"
            else:
                asset = dict(raw_asset)
                asset["confidence"] = "low"
                asset["note"] = "verify on Hugging Face before using."
                asset["source"] = "curated_catalog"
                sanitized = True

            normalized = normalize_asset(asset)
            if normalized:
                assets.append(normalized)
            else:
                sanitized = True

    for hub_asset in select_hub_assets_for_brief(hub_assets, product_brief):
        if all(asset["hf_id"] != hub_asset["hf_id"] for asset in assets):
            normalized = normalize_asset(hub_asset)
            if normalized:
                assets.append(normalized)
                sanitized = True

    for curated in select_curated_assets_for_transcript(transcript, curated_assets, product_brief):
        if all(asset["hf_id"] != curated["hf_id"] for asset in assets):
            normalized = normalize_asset(curated)
            if normalized:
                assets.append(normalized)
                sanitized = True

    return assets[:12], sanitized


def normalize_asset(asset: dict[str, Any]) -> dict[str, Any] | None:
    asset_type = str(asset.get("type") or "").strip()
    use_mode = str(asset.get("use_mode") or "reference").strip()
    confidence = str(asset.get("confidence") or "medium").strip()
    source = str(asset.get("source") or "curated_catalog").strip()
    hf_id = str(asset.get("hf_id") or "").strip()
    url = str(asset.get("url") or "").strip()

    if asset_type not in ASSET_TYPES or use_mode not in USE_MODES or confidence not in CONFIDENCE_LABELS or source not in ASSET_SOURCES:
        return None

    if not url:
        url = build_asset_url(asset_type, hf_id)

    if not url.startswith("https://huggingface.co/"):
        return None

    return {
        "name": str(asset.get("name") or hf_id or "Hugging Face asset").strip()[:80],
        "type": asset_type,
        "hf_id": hf_id,
        "url": url,
        "role": str(asset.get("role") or "Reference Hugging Face asset").strip()[:160],
        "why_relevant": str(asset.get("why_relevant") or "Relevant to this Hugging Face-native workflow.").strip()[:240],
        "use_mode": use_mode,
        "agent_ready": bool(asset.get("agent_ready", False)),
        "mcp_ready": bool(asset.get("mcp_ready", False)),
        "confidence": confidence,
        "source": source,
        **({"likes": asset["likes"]} if asset.get("likes") is not None else {}),
        **({"downloads": asset["downloads"]} if asset.get("downloads") is not None else {}),
        **({"tags": asset["tags"]} if isinstance(asset.get("tags"), list) else {}),
        "attach_to_node_id": slugify(str(asset.get("attach_to_node_id") or infer_asset_node_id(asset))),
        **({"note": str(asset["note"]).strip()[:160]} if asset.get("note") else {}),
    }


def flatten_hub_search_assets(hf_asset_search_results: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    for raw_asset in [*hf_asset_search_results.get("spaces", []), *hf_asset_search_results.get("models", [])]:
        if not isinstance(raw_asset, dict):
            continue
        asset_type = str(raw_asset.get("type") or "").strip()
        use_mode = "use_model" if asset_type == "model" else infer_hub_space_use_mode(raw_asset)
        assets.append(
            {
                **raw_asset,
                "source": "hf_hub_search",
                "use_mode": raw_asset.get("use_mode") or use_mode,
                "role": raw_asset.get("role") or infer_hub_asset_role(raw_asset),
                "why_relevant": raw_asset.get("why_relevant") or "Found by live Hugging Face Hub search for this transcript.",
                "agent_ready": bool(raw_asset.get("agent_ready", False)),
                "mcp_ready": bool(raw_asset.get("mcp_ready", False)) or "mcp" in str(raw_asset.get("hf_id", "")).lower(),
                "attach_to_node_id": raw_asset.get("attach_to_node_id") or infer_asset_node_id(raw_asset),
            }
        )
    return assets


def select_hub_assets_for_brief(hub_assets: list[dict[str, Any]], product_brief: dict[str, Any]) -> list[dict[str, Any]]:
    allowed_types = set(product_brief.get("recommended_hf_asset_types") or ["space", "model"])
    spaces = [asset for asset in hub_assets if asset.get("type") == "space" and "space" in allowed_types][:4]
    models = [asset for asset in hub_assets if asset.get("type") == "model" and "model" in allowed_types][:4]
    return [*spaces, *models][:8]


def infer_hub_space_use_mode(asset: dict[str, Any]) -> str:
    text = " ".join(
        [
            str(asset.get("hf_id") or ""),
            " ".join(str(tag) for tag in asset.get("tags", []) if tag),
        ]
    ).lower()
    if "mcp" in text or "agent" in text or "tool" in text:
        return "connect_as_tool"
    return "fork"


def infer_hub_asset_role(asset: dict[str, Any]) -> str:
    hf_id = str(asset.get("hf_id") or "")
    asset_type = str(asset.get("type") or "")
    if asset_type == "model":
        return f"Use the {hf_id} model if it fits the generated architecture."
    return f"Open or fork the {hf_id} Space as a concrete reference implementation."


def select_curated_assets_for_transcript(
    transcript: str,
    curated_assets: list[dict[str, Any]],
    product_brief: dict[str, Any],
) -> list[dict[str, Any]]:
    lower = transcript.lower()
    selected_ids = {"Qwen/Qwen3-235B-A22B-Instruct-2507"}
    allowed_asset_types = set(product_brief.get("recommended_hf_asset_types") or ["space", "model", "doc", "tool"])

    if any(term in lower for term in ["voice", "audio", "speak", "speech", "transcrib", "asr"]):
        selected_ids.update({"openai/whisper-large-v3", "hf-audio/whisper-large-v3"})

    if any(term in lower for term in ["agent", "tool", "automation", "workflow", "connect", "mcp", "action"]):
        selected_ids.update(
            {
                "hub/agents-mcp",
                "hub/spaces-mcp-servers",
                "hub/spaces-agents",
                "dylanebert/huggingface-mcp",
                "Agents-MCP-Hackathon/Router-MCP",
            }
        )

    if any(term in lower for term in ["search hugging face", "search models", "search spaces", "relevant spaces", "relevant models"]):
        selected_ids.add("dylanebert/huggingface-mcp")

    if any(term in lower for term in ["document", "pdf", "knowledge", "rag", "retrieval"]):
        selected_ids.update({"not-lain/RAG-Chatbot", "sentence-transformers/all-MiniLM-L6-v2"})

    if any(term in lower for term in ["image", "photo", "visual", "vision"]):
        selected_ids.update({"akhaliq/Qwen3-VL-2B-Instruct", "huggingfacejs/doc-vis-qa"})

    selected = []
    for asset in curated_assets:
        if asset["hf_id"] in selected_ids and asset.get("type") in allowed_asset_types:
            selected.append({**asset, "source": "curated_catalog", "attach_to_node_id": infer_asset_node_id(asset)})

    return selected


def infer_asset_node_id(asset: dict[str, Any]) -> str:
    hf_id = str(asset.get("hf_id") or "").lower()
    asset_type = str(asset.get("type") or "")
    role = str(asset.get("role") or "").lower()

    if "whisper" in hf_id or "speech" in role or "transcription" in role:
        return "whisper-asr"
    if "mcp" in hf_id or "agent" in role or asset.get("mcp_ready"):
        return "hf-recommender"
    if "qwen" in hf_id and asset_type == "model":
        return "architecture-json"
    if "rag" in hf_id or "sentence-transformers" in hf_id:
        return "hf-recommender"
    if "vision" in role or "vl" in hf_id or "vis" in hf_id:
        return "hf-recommender"
    if asset_type == "space":
        return "docker-space"
    return "hf-recommender"


def attach_assets_to_node(node_id: str, assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [asset for asset in assets if asset.get("attach_to_node_id") == node_id]


def log_recommended_asset_source_mix(assets: list[dict[str, Any]]) -> None:
    mix: dict[str, int] = {}
    for asset in assets:
        source = str(asset.get("source") or "unknown")
        mix[source] = mix.get(source, 0) + 1
    logger.info("recommended assets source mix: %s", mix)


def build_asset_url(asset_type: str, hf_id: str) -> str:
    if asset_type == "space":
        return f"https://huggingface.co/spaces/{hf_id}"
    if asset_type == "dataset":
        return f"https://huggingface.co/datasets/{hf_id}"
    return f"https://huggingface.co/{hf_id}"
