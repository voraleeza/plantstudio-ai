import * as ort from 'onnxruntime-node';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const config={maxDuration:300};

const PLANT_URL='https://huggingface.co/SacredNoir/isnet-general-use-onnx/resolve/main/isnet-general-use-q8.onnx';
const HUMAN_URL='https://huggingface.co/onnx-community/mediapipe_selfie_segmentation-web/resolve/main/onnx/model.onnx';
const PLANT_PATH=path.join(os.tmpdir(),'isnet-general-use-q8.onnx');
const HUMAN_PATH=path.join(os.tmpdir(),'mediapipe-selfie.onnx');
const PS=1024, HS=256;
let plantSessionPromise=null, humanSessionPromise=null;

async function ensureFile(url,p,minSize){
  try{const st=await fs.stat(p);if(st.size>minSize)return p}catch{}
  const r=await fetch(url);if(!r.ok)throw new Error(`Model download failed (${r.status})`);
  await fs.writeFile(p,Buffer.from(await r.arrayBuffer()));
  return p;
}
async function getPlantSession(){
  if(!plantSessionPromise)plantSessionPromise=(async()=>ort.InferenceSession.create(await ensureFile(PLANT_URL,PLANT_PATH,40000000),{executionProviders:['cpu'],graphOptimizationLevel:'all',intraOpNumThreads:1,interOpNumThreads:1}))().catch(e=>{plantSessionPromise=null;throw e});
  return plantSessionPromise;
}
async function getHumanSession(){
  if(!humanSessionPromise)humanSessionPromise=(async()=>ort.InferenceSession.create(await ensureFile(HUMAN_URL,HUMAN_PATH,150000),{executionProviders:['cpu'],graphOptimizationLevel:'all',intraOpNumThreads:1,interOpNumThreads:1}))().catch(e=>{humanSessionPromise=null;throw e});
  return humanSessionPromise;
}
function resizeRGBA(src,sw,sh,size){
  const out=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++){const sy=Math.min(sh-1,Math.max(0,Math.round((y+.5)*sh/size-.5)));for(let x=0;x<size;x++){const sx=Math.min(sw-1,Math.max(0,Math.round((x+.5)*sw/size-.5))),si=(sy*sw+sx)*4,di=(y*size+x)*4;out[di]=src[si];out[di+1]=src[si+1];out[di+2]=src[si+2];out[di+3]=255}}
  return out;
}
function plantInput(rgba){
  const n=PS*PS,d=new Float32Array(3*n);
  for(let i=0;i<n;i++){const p=i*4;d[i]=(rgba[p]-128)/256;d[n+i]=(rgba[p+1]-128)/256;d[2*n+i]=(rgba[p+2]-128)/256}
  return new ort.Tensor('float32',d,[1,3,PS,PS]);
}
function humanInput(rgba){
  const d=new Uint8Array(HS*HS*3);
  for(let i=0,j=0;i<rgba.length;i+=4){d[j++]=rgba[i];d[j++]=rgba[i+1];d[j++]=rgba[i+2]}
  return new ort.Tensor('uint8',d,[1,HS,HS,3]);
}
function sigmoid(v){return 1/(1+Math.exp(-v))}
function normalizeOutput(out,size){
  const raw=out.data,count=size*size,off=Math.max(0,raw.length-count),m=new Float32Array(count);
  let min=Infinity,max=-Infinity;
  for(let i=0;i<count;i++){const v=Number(raw[off+i]);if(v<min)min=v;if(v>max)max=v}
  for(let i=0;i<count;i++){let v=Number(raw[off+i]);if(min<0||max>1)v=sigmoid(v);m[i]=Math.max(0,Math.min(1,v))}
  return m;
}
function sample(m,mw,mh,x,y,ow,oh){
  const fx=Math.max(0,Math.min(mw-1,(x+.5)*mw/ow-.5)),fy=Math.max(0,Math.min(mh-1,(y+.5)*mh/oh-.5)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(mw-1,x0+1),y1=Math.min(mh-1,y0+1),dx=fx-x0,dy=fy-y0,a=m[y0*mw+x0]*(1-dx)+m[y0*mw+x1]*dx,b=m[y1*mw+x0]*(1-dx)+m[y1*mw+x1]*dx;return a*(1-dy)+b*dy;
}
function dilateBinary(src,w,h,iterations){
  let a=new Uint8Array(src),b=new Uint8Array(src.length);
  for(let it=0;it<iterations;it++){b.fill(0);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(a[i]){b[i]=1;continue}let hit=0;for(let yy=-1;yy<=1&&!hit;yy++)for(let xx=-1;xx<=1;xx++){const nx=x+xx,ny=y+yy;if(nx>=0&&ny>=0&&nx<w&&ny<h&&a[ny*w+nx]){hit=1;break}}b[i]=hit}const t=a;a=b;b=t}
  return a;
}
function composeMasks(plant,human){
  const plantLow=new Uint8Array(HS*HS);
  for(let y=0;y<HS;y++)for(let x=0;x<HS;x++){const p=sample(plant,PS,PS,x,y,HS,HS);plantLow[y*HS+x]=p>.12?1:0}
  const near=dilateBinary(plantLow,HS,HS,14);
  let touching=0,humanPixels=0;
  for(let i=0;i<human.length;i++){if(human[i]>.32){humanPixels++;if(near[i])touching++}}
  const useHuman=humanPixels>20&&touching>=4;
  if(!useHuman)return {mask:plant,useHuman:false,touching};
  const merged=new Float32Array(PS*PS);
  for(let y=0;y<PS;y++)for(let x=0;x<PS;x++){
    const i=y*PS+x,p=plant[i],h=sample(human,HS,HS,x,y,PS,PS);
    const hp=h<.18?0:h>.72?1:(h-.18)/.54;
    merged[i]=Math.max(p,hp);
  }
  return {mask:merged,useHuman:true,touching};
}
async function removeBackground(buffer){
  const dec=jpeg.decode(buffer,{useTArray:true,formatAsRGBA:true});
  if(!dec?.data?.length)throw new Error('Could not decode JPEG upload');
  const [plantSession,humanSession]=await Promise.all([getPlantSession(),getHumanSession()]);
  const plantRGBA=resizeRGBA(dec.data,dec.width,dec.height,PS);
  const humanRGBA=resizeRGBA(dec.data,dec.width,dec.height,HS);
  const [plantOuts,humanOuts]=await Promise.all([
    plantSession.run({[plantSession.inputNames[0]]:plantInput(plantRGBA)}),
    humanSession.run({[humanSession.inputNames[0]]:humanInput(humanRGBA)})
  ]);
  const plantOut=plantOuts[plantSession.outputNames[0]],humanOut=humanOuts[humanSession.outputNames[0]];
  if(!plantOut?.data?.length)throw new Error('No plant/object mask returned');
  if(!humanOut?.data?.length)throw new Error('No human mask returned');
  const plant=normalizeOutput(plantOut,PS);
  const human=normalizeOutput(humanOut,HS);
  const {mask,useHuman,touching}=composeMasks(plant,human);
  const expanded=new Float32Array(mask);
  for(let y=1;y<PS-1;y++)for(let x=1;x<PS-1;x++){
    const i=y*PS+x;if(mask[i]>=.16)continue;let near=0;
    for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)near=Math.max(near,mask[(y+yy)*PS+x+xx]);
    if(near>.40)expanded[i]=Math.max(mask[i],near*.78);
  }
  const png=new PNG({width:dec.width,height:dec.height});
  for(let y=0;y<dec.height;y++)for(let x=0;x<dec.width;x++){
    const i=(y*dec.width+x)*4;png.data[i]=dec.data[i];png.data[i+1]=dec.data[i+1];png.data[i+2]=dec.data[i+2];
    let a=sample(expanded,PS,PS,x,y,dec.width,dec.height);a=Math.max(0,Math.min(1,(a-.035)/.91));png.data[i+3]=Math.round(a*255);
  }
  return {png:PNG.sync.write(png),useHuman,touching};
}

export default async function handler(req,res){
  if(req.method==='GET')return res.status(200).json({ok:true,engine:'Perfect Background Remover',ready:true});
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  try{
    const {image}=req.body||{};if(!image||typeof image!=='string')return res.status(400).json({error:'Missing image data'});
    const b=Buffer.from(image.includes(',')?image.split(',').pop():image,'base64');if(!b.length)return res.status(400).json({error:'Empty image'});
    const {png,useHuman,touching}=await removeBackground(b);
    res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','no-store');res.setHeader('X-PlantStudio-Human-Preserved',useHuman?'1':'0');res.setHeader('X-PlantStudio-Human-Touching',String(touching));
    return res.status(200).send(png);
  }catch(e){console.error('Perfect Background Remover failed:',e);return res.status(500).json({error:e?.message||'Background removal failed'})}
}
