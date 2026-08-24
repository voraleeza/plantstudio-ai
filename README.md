---
title: PlantStudio Background Removal
emoji: 🌿
colorFrom: green
colorTo: gray
sdk: docker
app_port: 8000
pinned: false
---

# PlantStudio Background Removal

Dedicated BiRefNet 512 inference service for PlantStudio AI.

Endpoints:
- `GET /health`
- `POST /remove-background` with multipart form field `file`
