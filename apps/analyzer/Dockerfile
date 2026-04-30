FROM python:3.13-slim

# This Dockerfile expects the repository root as the build context.
# The same image can run either the FastAPI server or the MQ worker by
# overriding the container command in Docker Compose.

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/apps/analyzer

COPY apps/analyzer/pyproject.toml ./

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -c "import tomllib; deps = tomllib.load(open('pyproject.toml', 'rb'))['project']['dependencies']; open('/tmp/requirements.txt', 'w', encoding='utf-8').write('\n'.join(deps) + '\n')" \
    && python -m pip install --no-cache-dir -r /tmp/requirements.txt

COPY apps/analyzer/app ./app
COPY apps/analyzer/scripts ./scripts
COPY packages/contracts/examples /app/packages/contracts/examples
COPY packages/contracts/schemas /app/packages/contracts/schemas

RUN useradd --system --create-home --uid 10001 wedge

USER wedge

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
