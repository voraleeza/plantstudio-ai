from pathlib import Path
import re

p = Path('index.html')
s = p.read_text(encoding='utf-8')

# Replace only the historical local IMG.LY loader with the approved server remover adapter.
start = s.find("async function getAI(){")
end = s.find("function filterFor(l){", start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate getAI block')

adapter = r'''async function fileToServerJPEG(file){var src=URL.createObjectURL(file);try{var im=await imgFrom(src),max=1800,sc=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight)),w=Math.max(1,Math.round(im.naturalWidth*sc)),h=Math.max(1,Math.round(im.naturalHeight*sc)),c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.drawImage(im,0,0,w,h);return c.toDataURL('image/jpeg',.92)}finally{revoke(src)}}async function perfectRemoveBackground(file){var data=await fileToServerJPEG(file),r=await fetch('/api/remove-background',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:data})});if(!r.ok){var msg='Server returned '+r.status;try{var j=await r.json();if(j.error)msg=j.error}catch(_){ }throw new Error(msg)}var blob=await r.blob();if(!blob.type.includes('png'))throw new Error('Perfect Background Remover did not return PNG');return blob}async function getAI(){return perfectRemoveBackground}'''
s = s[:start] + adapter + s[end:]

# Replace only processAsset, preserving queue, layers, editor, refine, adjustments and exports.
start = s.find("async function processAsset(a,g){")
end = s.find("async function runQueue(){", start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate processAsset block')

processor = r'''async function processAsset(a,g){if(!a||a.cutoutURL||a.processing||g!==generation)return;a.processing=true;a.state='Removing';renderQueue();loader.classList.add('on');loaderText.textContent='Perfect Background Remover…';progressBar.style.width='18%';try{var fn=await getAI();if(g!==generation)return;var blob=await fn(a.file);if(g!==generation)return;a.cutoutURL=URL.createObjectURL(blob);a.state='Cutout ready';progressBar.style.width='92%';await makeMask(a);await fitRootToAspect(a);buildStage()}catch(e){console.error(e);a.state='Removal failed';status.textContent='Background removal failed: '+(e&&e.message?e.message:e)}finally{a.processing=false;loader.classList.remove('on');progressBar.style.width='0%';renderQueue()}}'''
s = s[:start] + processor + s[end:]

# Do not preload the former browser AI model on startup.
s = s.replace("buildStage();setTimeout(()=>getAI().catch(()=>{}),900)})();", "buildStage()})();")

# Visible build marker only; no functional UI change.
s = s.replace('>WHOLE SUBJECT EDITOR</div></header>', '>PHOTO COPY + PERFECT REMOVER</div></header>', 1)

p.write_text(s, encoding='utf-8')
print('Patched index.html for Perfect Background Remover')
