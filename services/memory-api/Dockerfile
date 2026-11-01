FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.10.6 /uv /bin/uv
RUN useradd --create-home --uid 10001 continuum
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --extra local-model --no-dev
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
RUN mkdir /data && chown -R continuum:continuum /app /data
USER continuum
ENV CONTINUUM_DATA_DIR=/data
EXPOSE 8000
CMD [".venv/bin/uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
