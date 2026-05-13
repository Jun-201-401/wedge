from __future__ import annotations

import unittest
from unittest.mock import patch

from prometheus_client import generate_latest

from app.providers.gms import GMSClient, GMSClientError, GMSConfig


class FakeGMSResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def __enter__(self) -> "FakeGMSResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class GMSMetricsTest(unittest.TestCase):
    def test_gms_client_records_success_count_and_latency(self) -> None:
        config = GMSConfig(
            enabled=True,
            api_key="local-test-key",
            model="metrics-success-model",
        )
        client = GMSClient(config, feature="metrics_success_fixture")

        with patch(
            "app.providers.gms.request.urlopen",
            return_value=FakeGMSResponse(b'{"output_text":"ok"}'),
        ):
            self.assertEqual(client.generate_text(prompt="safe fixture"), "ok")

        metrics = generate_latest().decode("utf-8")
        self.assertIn(
            'wedge_ai_gms_requests_total{error_type="none",feature="metrics_success_fixture",model="metrics-success-model",service="analyzer",status="success"} 1.0',
            metrics,
        )
        self.assertIn(
            'wedge_ai_gms_request_duration_seconds_count{error_type="none",feature="metrics_success_fixture",model="metrics-success-model",service="analyzer",status="success"} 1.0',
            metrics,
        )

    def test_gms_client_records_disabled_error(self) -> None:
        config = GMSConfig(
            enabled=False,
            api_key="",
            model="metrics-disabled-model",
        )
        client = GMSClient(config, feature="metrics_disabled_fixture")

        with self.assertRaises(GMSClientError):
            client.generate_text(prompt="safe fixture")

        metrics = generate_latest().decode("utf-8")
        self.assertIn(
            'wedge_ai_gms_requests_total{error_type="disabled",feature="metrics_disabled_fixture",model="metrics-disabled-model",service="analyzer",status="error"} 1.0',
            metrics,
        )


if __name__ == "__main__":
    unittest.main()
