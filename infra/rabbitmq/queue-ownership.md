# RabbitMQ Queue Ownership

Exchange: `wedge.direct` (메인) / `wedge.dlq` (실패 보관)

| Queue | Producer | Consumer | DLQ | 비고 |
|---|---|---|---|---|
| `discovery.execute.request` | Spring | Node Runner | `discovery.execute.dlq` | |
| `discovery.evaluate.request` | Spring | FastAPI Analyzer | `discovery.evaluate.dlq` | 문서상 "Spring 또는 FastAPI" — 초안에서 FastAPI로 확정 |
| `run.execute.request` | Spring | Node Runner | `run.execute.dlq` | |
| `agent.execute.request` | Spring | Node Runner Agent | `agent.execute.dlq` | AgentTask / replay_hints |
| `analysis.request` | Spring | FastAPI Analyzer | `analysis.dlq` | |
| `report.export.request` | Spring | export worker | `report.export.dlq` | optional |
