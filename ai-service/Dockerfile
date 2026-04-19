FROM python:3.11-slim

WORKDIR /app

# Default: lightweight algo generator. Set GENERATOR=amt for AMT model.
ARG GENERATOR=algo

RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# Always need websockets
RUN pip install --no-cache-dir websockets

# Heavy deps only for AMT mode
RUN if [ "$GENERATOR" = "amt" ]; then \
      pip install --no-cache-dir --default-timeout=300 \
        torch --index-url https://download.pytorch.org/whl/cpu && \
      pip install --no-cache-dir --default-timeout=300 \
        transformers numpy tqdm mido \
        "anticipation @ git+https://github.com/jthickstun/anticipation.git"; \
    fi

COPY app/ app/

ENV PYTHONUNBUFFERED=1
ENV GENERATOR=${GENERATOR}
CMD ["python", "-m", "app.main"]
