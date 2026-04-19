# Slender image: no apt ffmpeg (pulls SDL/OpenGL/Vulkan…), no 120 MB FluidR3 full GM.
# - fluidr3mono-gm-soundfont: ~30 MB vs fluid-soundfont-gm ~120 MB
# - imageio-ffmpeg: bundled ffmpeg binary via pip (avoids 200+ apt packages)
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        fluidsynth libfluidsynth3 \
        fluidr3mono-gm-soundfont \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

ENV PYTHONUNBUFFERED=1
# Default path from fluidr3mono-gm-soundfont package (SF3 under sounds/sf3/)
ENV SOUNDFONT=/usr/share/sounds/sf3/FluidR3Mono_GM.sf3

ENTRYPOINT ["./entrypoint.sh"]
