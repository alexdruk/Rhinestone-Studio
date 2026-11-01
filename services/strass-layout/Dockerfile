FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/strass-layout

COPY requirements.txt requirements-nodeps.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --no-deps -r requirements-nodeps.txt

COPY strass_layout/ strass_layout/
COPY app.py .
COPY models/stardist/ models/stardist/
# IMG-026L: MediaPipe's face landmarker (Apache 2.0). The dlib model must never be in the image:
# its iBUG 300-W training data excludes commercial use.
COPY models/mediapipe/ models/mediapipe/

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
