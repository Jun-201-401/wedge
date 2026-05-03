# Wedge Monitoring

This directory contains monitoring configuration that is operated separately
from the Wedge application stack. The same baseline can be used for local
development checks and production EC2 monitoring.

## Compose Separation

- `compose.dev.yaml` runs the local Wedge application stack.
- `compose.prod.yaml` runs the production Wedge application stack.
- `compose.monitoring.yaml` runs the monitoring stack.

Keeping the monitoring stack separate makes it possible to restart or change
Prometheus and Grafana without recreating application containers.

## Stack

- `node-exporter`: host CPU, memory, disk, and network metrics
- `cAdvisor`: Docker container resource metrics
- `Prometheus`: metrics scraping and short-term retention
- `Grafana`: dashboards backed by Prometheus

## Version Pinning

Images are pinned to explicit versions instead of `latest`.

- `prom/node-exporter:v1.11.1`
- `ghcr.io/google/cadvisor:v0.56.2`
- `prom/prometheus:v3.5.1`
- `grafana/grafana:13.0.1`

Prometheus uses the current 3.5.x long-term support line. Grafana uses the
official `grafana/grafana` image repository.

## Access

Prometheus and Grafana are bound to `127.0.0.1` by default.

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

The exporters are not published to the host. Prometheus reaches them through
the Compose network.

## Retention

Prometheus keeps local metrics for 7 days by default.

Override it when needed:

```bash
PROMETHEUS_RETENTION_TIME=15d docker compose -f compose.monitoring.yaml up -d
```
