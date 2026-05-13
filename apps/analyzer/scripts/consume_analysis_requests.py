from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.workers import AnalysisConsumerConfig, AnalysisRequestConsumer
from app.observability.metrics import start_metrics_server_from_env


if __name__ == "__main__":
    start_metrics_server_from_env()
    AnalysisRequestConsumer(config=AnalysisConsumerConfig.from_env()).start()
