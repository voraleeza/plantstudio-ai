export default async (request) => {
  const apiKey = globalThis.Netlify?.env?.get?.("PHOTOROOM_API_KEY") || globalThis.process?.env?.PHOTOROOM_API_KEY;

  if (request.method === "GET") {
    return new Response(JSON.stringify({ ok: true, keyConfigured: Boolean(apiKey) }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "PHOTOROOM_API_KEY is not configured in Netlify environment variables." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const imageBytes = await request.arrayBuffer();
    if (!imageBytes.byteLength) {
      return new Response(JSON.stringify({ error: "No image received." }), { status: 400, headers: { "content-type": "application/json" } });
    }

    if (imageBytes.byteLength > 3.5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Temporary PhotoRoom upload is still too large. Please retry with the latest PlantStudio build." }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }

    const inputType = request.headers.get("content-type") || "image/jpeg";
    const encodedName = request.headers.get("x-file-name") || "plant-photo.jpg";
    let fileName = "plant-photo.jpg";
    try { fileName = decodeURIComponent(encodedName); } catch { fileName = encodedName; }

    const formData = new FormData();
    formData.append("image_file", new Blob([imageBytes], { type: inputType }), fileName);
    formData.append("format", "png");
    formData.append("channels", "rgba");
    formData.append("size", "hd");
    formData.append("crop", "false");

    const photoRoomResponse = await fetch("https://sdk.photoroom.com/v1/segment", {
      method: "POST",
      headers: { "x-api-key": apiKey, Accept: "image/png, application/json" },
      body: formData,
    });

    if (!photoRoomResponse.ok) {
      const contentType = photoRoomResponse.headers.get("content-type") || "";
      let detail = "";
      if (contentType.includes("application/json")) {
        try {
          const json = await photoRoomResponse.json();
          detail = json?.message || json?.error || JSON.stringify(json).slice(0, 500);
        } catch {}
      } else {
        try { detail = (await photoRoomResponse.text()).slice(0, 500); } catch {}
      }
      const friendly = photoRoomResponse.status === 402
        ? "PhotoRoom API quota/payment is required."
        : photoRoomResponse.status === 403
        ? "PhotoRoom rejected the API key or API access."
        : `PhotoRoom returned ${photoRoomResponse.status}.`;
      return new Response(JSON.stringify({ error: detail ? `${friendly} ${detail}` : friendly }), {
        status: photoRoomResponse.status,
        headers: { "content-type": "application/json" },
      });
    }

    const result = await photoRoomResponse.arrayBuffer();
    return new Response(result, {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("PhotoRoom function error:", error);
    return new Response(JSON.stringify({ error: "Background removal failed on the server. Please try again." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
