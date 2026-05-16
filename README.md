---
title: Idea2space
emoji: 😻
colorFrom: gray
colorTo: gray
sdk: docker
pinned: false
license: mit
short_description: "Voice to Hugging Face's system architecture and agentic prompt"
---

# idea2space

## Local Development

Phase 3 supports real Hugging Face ASR when `HF_TOKEN` is set. Phase 4 can use a Hugging Face-hosted LLM to turn the final transcript into an architecture JSON when both `HF_TOKEN` and `LLM_MODEL` are set. If ASR or architecture generation fails, the app keeps using mock fallback data.

Create a local `.env` file from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Set your Hugging Face token in `.env`:

```text
HF_TOKEN=your_hugging_face_token
ASR_MODEL=openai/whisper-large-v3
LLM_MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507
```

Do not commit `.env`.

You can change `LLM_MODEL` to another Hugging Face chat model without code changes. Leave `LLM_MODEL` empty to test the architecture mock fallback path.

Terminal 1:

```powershell
pip install -r requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 7860 --reload
```

Terminal 2:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Backend health check:

```text
http://127.0.0.1:7860/health
```

Expected response:

```json
{"status":"ok"}
```

Architecture generation fallback check:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:7860/api/generate-architecture `
  -ContentType "application/json" `
  -Body '{"transcript":"Build a voice app that turns founder ideas into Hugging Face Spaces architectures."}'
```
