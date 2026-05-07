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

## MCP local verification

The API server includes a Spring AI MCP WebMVC adapter. It is disabled by default and should be enabled only for local or internal verification until the production OAuth/OIDC policy is implemented.

Required local environment values:

```bash
WEDGE_MCP_SERVER_ENABLED=true
WEDGE_MCP_SERVICE_TOKEN=wedge-local-dev-mcp-service-token
```

The Streamable HTTP endpoint is:

```text
POST /mcp
```

Requests must include the MCP service token:

```text
Authorization: Bearer <WEDGE_MCP_SERVICE_TOKEN>
```

Minimal verification flow:

```text
initialize
notifications/initialized
tools/list
tools/call get_run_status
```

Example `tools/call` request body:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_run_status",
    "arguments": {
      "runId": "ed1e0dcc-b595-40d8-914f-d1cb4d69bfdc"
    }
  }
}
```

Verified local result:

```text
health: UP
initialize: HTTP 200
tools/list: HTTP 200, get_run_status present
tools/call get_run_status: HTTP 200, isError=false
```

This service-token policy is for internal spike verification only. Production exposure requires OAuth/OIDC or an equivalent MCP client identity and scope policy.
