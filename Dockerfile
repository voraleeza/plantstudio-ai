FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    PORT=8000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY inference/requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && \
    pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1 && \
    pip install -r /app/requirements.txt

COPY inference/app.py /app/app.py

RUN python - <<'PY'
from transformers import AutoModelForImageSegmentation
AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet_512x512', trust_remote_code=True)
print('BiRefNet model cached')
PY

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
