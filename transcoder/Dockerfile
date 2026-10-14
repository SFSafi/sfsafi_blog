FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home transcoder && mkdir /data && chown transcoder /data
WORKDIR /app
COPY --chmod=644 service.py ./
USER transcoder
ENV TRANSCODER_DATA=/data TRANSCODER_HOST=0.0.0.0 PORT=8090
EXPOSE 8090
CMD ["python", "service.py"]
