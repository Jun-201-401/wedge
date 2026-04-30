from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class MockSpringCallbackHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        payload = json.loads(body.decode("utf-8")) if body else {}
        judge_result = payload.get("judgeResult") or {}
        issues = judge_result.get("issues") or []

        print("\n=== CALLBACK RECEIVED ===", flush=True)
        print(f"path: {self.path}", flush=True)
        print(f"X-Worker-Id: {self.headers.get('X-Worker-Id')}", flush=True)
        print(f"X-Event-Id: {self.headers.get('X-Event-Id')}", flush=True)
        print(f"X-Signature: {self.headers.get('X-Signature')}", flush=True)
        print(f"analysisJobId: {payload.get('analysisJobId')}", flush=True)
        print(f"runId: {payload.get('runId')}", flush=True)
        print(f"judge issues: {[issue.get('criterion_id') for issue in issues]}", flush=True)
        print(f"summary: {judge_result.get('summary')}", flush=True)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(
            json.dumps(
                {
                    "data": {
                        "analysisJobId": payload.get("analysisJobId"),
                        "runId": payload.get("runId"),
                        "status": "COMPLETED",
                    }
                }
            ).encode("utf-8")
        )

    def log_message(self, format: str, *args: object) -> None:
        return


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 18080), MockSpringCallbackHandler)
    print("mock Spring callback server: http://127.0.0.1:18080", flush=True)
    server.serve_forever()
