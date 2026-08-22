PlantStudio PhotoRoom v10.1

FIXES ONLY — no redesign:
1. Uploaded photo automatically goes to PhotoRoom.
2. Mobile preview is forced to fit inside the workspace.
3. PhotoRoom/Netlify Function connection is shown visibly.
4. API upload copy is compressed below Netlify Function request limits.
5. Bulk removal still processes up to two images at once.

Deploy the ENTIRE folder to the SAME Netlify project that contains
the secret PHOTOROOM_API_KEY environment variable.

After deploy, open the app. Near the Add Photos area you should see:
✅ PhotoRoom function connected

If it instead says the function is unavailable, the issue is Netlify
function deployment, not the image editor.
Vercel deployment test
