import io
import os
from contextlib import asynccontextmanager

import torch
import torch.nn.functional as F
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageOps
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

MODEL_ID = os.getenv("MODEL_ID", "ZhengPeng7/BiRefNet_512x512")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
model = None


def load_model():
    global model
    if model is None:
        model = AutoModelForImageSegmentation.from_pretrained(
            MODEL_ID,
            trust_remote_code=True,
            torch_dtype=torch.float32,
        )
        model.to(DEVICE)
        model.eval()
    return model


transform = transforms.Compose([
    transforms.Resize((512, 512), interpolation=transforms.InterpolationMode.BILINEAR),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield


app = FastAPI(title="PlantStudio Background Removal", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "device": DEVICE}


@app.post("/remove-background")
async def remove_background(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Image file required")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds 20 MB")

    try:
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode image: {exc}")

    original_size = image.size
    tensor = transform(image).unsqueeze(0).to(DEVICE)

    try:
        with torch.inference_mode():
            output = load_model()(tensor)
            if isinstance(output, (list, tuple)):
                pred = output[-1]
            elif hasattr(output, "logits"):
                pred = output.logits
            else:
                pred = output
            if isinstance(pred, (list, tuple)):
                pred = pred[-1]
            if pred.ndim == 3:
                pred = pred.unsqueeze(1)
            mask = torch.sigmoid(pred)
            mask = F.interpolate(mask, size=(original_size[1], original_size[0]), mode="bilinear", align_corners=False)
            mask = mask[0, 0].detach().float().cpu()

        # Conservative matte: preserve uncertain foreground rather than clipping fingers/stems.
        mask = torch.clamp((mask - 0.02) / 0.96, 0, 1)
        alpha = Image.fromarray((mask.numpy() * 255).astype("uint8"), mode="L")

        rgba = image.convert("RGBA")
        rgba.putalpha(alpha)
        out = io.BytesIO()
        rgba.save(out, format="PNG", optimize=False)
        return Response(content=out.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}")
