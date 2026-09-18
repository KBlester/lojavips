import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { json, requireAdmin } from './_lib.mjs';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif','image/svg+xml']);

function ext(type){
  return ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/svg+xml':'svg'})[type] || 'bin';
}

function safeName(name){ return String(name||'file').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,80); }

export default async req => {
  try {
    if(req.method==='GET'){
      const u=new URL(req.url);
      const key=u.searchParams.get('key');
      if(!key || !key.startsWith('media/')) return json({error:'Arquivo inválido.'},400);
      const blob=await getStore('sapucaia-media').get(key,{type:'blob'});
      if(!blob) return new Response('Arquivo não encontrado.',{status:404});
      return new Response(blob,{headers:{'Content-Type':blob.type||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable'}});
    }
    if(req.method!=='POST') return json({error:'Método não permitido'},405);
    if(!requireAdmin(req)) return json({error:'Não autorizado'},401);
    const form=await req.formData();
    const file=form.get('file');
    if(!file || typeof file.arrayBuffer!=='function') return json({error:'Arquivo não enviado.'},400);
    if(!ALLOWED.has(file.type)) return json({error:'Formato de imagem não permitido.'},400);
    if(Number(file.size||0)<=0 || Number(file.size)>MAX_BYTES) return json({error:'Imagem muito grande. Limite: 12 MB.'},413);
    const bytes=new Uint8Array(await file.arrayBuffer());
    const key=`media/${Date.now()}-${crypto.randomBytes(10).toString('hex')}.${ext(file.type)}`;
    await getStore('sapucaia-media').set(key,bytes,{metadata:{contentType:file.type,originalName:safeName(file.name)}});
    return json({ok:true,key,url:`/.netlify/functions/media?key=${encodeURIComponent(key)}`});
  } catch(e){
    console.error('media error',e);
    return json({error:'Não foi possível processar a imagem.'},500);
  }
};
