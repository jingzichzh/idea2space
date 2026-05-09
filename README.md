# idea2space

## Local Development

Phase 3 supports real Hugging Face ASR when `HF_TOKEN` is set. If `HF_TOKEN` is missing or ASR fails, the backend keeps returning mock transcript segments.

Create a local `.env` file from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Set your Hugging Face token in `.env`:

```text
HF_TOKEN=your_hugging_face_token
ASR_MODEL=openai/whisper-large-v3
```

Do not commit `.env`.

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
