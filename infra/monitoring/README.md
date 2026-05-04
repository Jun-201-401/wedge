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

## Grafana Provisioning

Grafana automatically loads the Prometheus data source from:

```text
infra/monitoring/grafana/provisioning/datasources/prometheus.yml
```

The data source uses `access: proxy`, so browsers do not connect to
Prometheus directly. Grafana reaches Prometheus through the internal Compose
network at `http://prometheus:9090`.

## Version Pinning

Images are pinned to explicit versions instead of `latest`.

- `prom/node-exporter:v1.11.1`
- `ghcr.io/google/cadvisor:0.56.2`
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

## Local and Production Notes

The monitoring stack is written as a common baseline for local Docker Desktop
and Linux EC2. Because Docker Desktop does not expose the host exactly like a
native Linux server, local host metrics can represent the Docker Desktop Linux
VM rather than the full Windows host.

For production EC2, the same stack observes the Linux host and Docker
containers directly. If stricter Linux-only mount propagation is needed later,
add a production override instead of making the common file Linux-only.

## Environment

Copy the example file and set a real Grafana admin password before starting
the monitoring stack.

```bash
cp .env.monitoring.example .env.monitoring
```

Replace `GRAFANA_ADMIN_PASSWORD=change-me` with a private team password before
running Grafana.

Required variables:

- `GRAFANA_ADMIN_USER`: Grafana administrator username
- `GRAFANA_ADMIN_PASSWORD`: Grafana administrator password
- `GRAFANA_PORT`: host port bound to `127.0.0.1`
- `PROMETHEUS_PORT`: host port bound to `127.0.0.1`
- `PROMETHEUS_RETENTION_TIME`: Prometheus local retention period

Do not commit `.env.monitoring`. Only `.env.monitoring.example` is tracked.

Start monitoring:

```bash
docker compose --env-file .env.monitoring -f compose.monitoring.yaml up -d
```

## Retention

Prometheus keeps local metrics for 7 days by default.

Override it when needed:

```bash
PROMETHEUS_RETENTION_TIME=15d docker compose --env-file .env.monitoring -f compose.monitoring.yaml up -d
```
