# Analyzer

FastAPI worker responsible for feature extraction, model inference, and Why/Nudge analysis.

## GMS report explanation

Analyzer can call GMS after the deterministic Rule Engine builds JudgeResult and before the Spring completed callback is sent. GMS is used only to polish report text. Rule-owned fields such as `stage`, `severity`, `confidence`, `priority_score`, and `evidence_refs` remain unchanged.

Configure it from the repository root environment files:

```text
.env
.env.prod
.env.prod.example
```

The analyzer does not keep a separate env example under `apps/analyzer`.
Docker Compose reads the root env file and passes analyzer settings into
`analyzer-api` and `analyzer-worker`.

If `ANALYZER_GMS_ENABLED` is not `true`, or if GMS fails, Analyzer sends the original deterministic Rule Engine result.
