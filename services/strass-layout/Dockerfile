FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/strass-layout

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY strass_layout/ strass_layout/
COPY app.py .
COPY models/stardist/ models/stardist/

RUN pip download --no-deps -d /tmp/dl face_recognition_models==0.3.0 \
    && mkdir /tmp/dl/x \
    && tar -xzf /tmp/dl/face_recognition_models-0.3.0.tar.gz -C /tmp/dl/x \
    && cp /tmp/dl/x/face_recognition_models-0.3.0/face_recognition_models/models/shape_predictor_68_face_landmarks.dat models/ \
    && echo "fbdc2cb80eb9aa7a758672cbfdda32ba6300efe9b6e6c7a299ff7e736b11b92f  models/shape_predictor_68_face_landmarks.dat" | sha256sum -c - \
    && rm -rf /tmp/dl

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
