# API Server

Spring Boot service for REST API, internal callbacks, WebSocket delivery, auth, orchestration, and MCP integration.

## Artifact content storage

The API serves artifact content through `/api/runs/{runId}/artifacts/{artifactId}/content`.

Default filesystem mode reads files from `WEDGE_ARTIFACT_LOCAL_ROOT`:

```bash
WEDGE_ARTIFACT_STORAGE=filesystem
WEDGE_ARTIFACT_LOCAL_ROOT=../runner/.runner-artifacts
```

MinIO/S3 mode reads the artifact object using the stored `s3_bucket` and `s3_key` metadata:

```bash
WEDGE_ARTIFACT_STORAGE=s3
WEDGE_ARTIFACT_BUCKET=wedge-artifacts
WEDGE_ARTIFACT_S3_ENDPOINT=http://localhost:9000
WEDGE_ARTIFACT_S3_REGION=us-east-1
WEDGE_ARTIFACT_S3_ACCESS_KEY_ID=<MINIO_ROOT_USER>
WEDGE_ARTIFACT_S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
WEDGE_ARTIFACT_S3_FORCE_PATH_STYLE=true
```
