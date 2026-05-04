# Analyzer

FastAPI worker responsible for feature extraction, model inference, and Why/Nudge analysis.

## GMS report explanation

Analyzer can call GMS after the deterministic Rule Engine builds JudgeResult and before the Spring completed callback is sent. GMS is used only to polish report text. Rule-owned fields such as `stage`, `severity`, `confidence`, `priority_score`, and `evidence_refs` remain unchanged.

Configure it in `apps/analyzer/.env`:

```bash
ANALYZER_GMS_ENABLED=true
ANALYZER_GMS_API_KEY=your-gms-key
ANALYZER_GMS_MODEL=gpt-4.1-nano
ANALYZER_GMS_BASE_URL=https://gms.ssafy.io/gmsapi
ANALYZER_GMS_OPENAI_RESPONSES_PATH=api.openai.com/v1/responses
ANALYZER_GMS_TIMEOUT_SECONDS=20
```

If `ANALYZER_GMS_ENABLED` is not `true`, or if GMS fails, Analyzer sends the original deterministic Rule Engine result.
