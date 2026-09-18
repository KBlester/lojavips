import { getAdminCredentials, setAdminCredentials, hashPassword, verifyPassword, signSession, cookie, json, requireAdmin } from './_lib.mjs';

export default async req=>{
  if(req.method==='GET'){
    const creds=await getAdminCredentials();
    const session=requireAdmin(req);
    return json({setupRequired:!creds,authenticated:!!session,username:session?.username||null});
  }
  if(req.method!=='POST') return json({error:'Método não permitido'},405);
  const body=await req.json().catch(()=>({}));
  const creds=await getAdminCredentials();
  if(body.action==='setup'){
    if(creds) return json({error:'O administrador já foi configurado.'},409);
    const username=String(body.username||'').trim();const password=String(body.password||'');const confirmation=String(body.confirmation||'');
    if(username.length<3) return json({error:'Usuário deve ter pelo menos 3 caracteres.'},400);
    if(password.length<8) return json({error:'A senha deve ter pelo menos 8 caracteres.'},400);
    if(password!==confirmation) return json({error:'As senhas não coincidem.'},400);
    const hashed=hashPassword(password);await setAdminCredentials({username, ...hashed,createdAt:new Date().toISOString()});
    const token=signSession({role:'admin',username,exp:Date.now()+8*60*60*1000});
    return new Response(JSON.stringify({ok:true,authenticated:true,token}),{status:200,headers:{'content-type':'application/json; charset=utf-8','Set-Cookie':cookie('sapucaia_session',token,{maxAge:8*60*60})}});
  }
  if(body.action==='logout') return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json; charset=utf-8','Set-Cookie':cookie('sapucaia_session','',{maxAge:0})}});
  if(body.action==='change-credentials'){
    const session=requireAdmin(req); if(!session)return json({error:'Não autorizado'},401);
    const current=await getAdminCredentials();
    if(!verifyPassword(body.currentPassword,current))return json({error:'Senha atual inválida.'},401);
    const username=String(body.username||current.username).trim();const nextPassword=String(body.newPassword||'');
    if(username.length<3||nextPassword.length<8||nextPassword!==String(body.confirmation||''))return json({error:'Dados das novas credenciais inválidos.'},400);
    const next={username,...hashPassword(nextPassword),updatedAt:new Date().toISOString()};await setAdminCredentials(next);
    const token=signSession({role:'admin',username,exp:Date.now()+8*60*60*1000});
    return new Response(JSON.stringify({ok:true,token}),{status:200,headers:{'content-type':'application/json; charset=utf-8','Set-Cookie':cookie('sapucaia_session',token,{maxAge:8*60*60})}});
  }
  const username=String(body.username||'').trim();const password=String(body.password||'');
  if(!creds)return json({error:'Primeiro acesso necessário.'},409);
  if(username!==creds.username||!verifyPassword(password,creds))return json({error:'Usuário ou senha inválidos.'},401);
  const token=signSession({role:'admin',username,exp:Date.now()+8*60*60*1000});
  return new Response(JSON.stringify({ok:true,authenticated:true,token}),{status:200,headers:{'content-type':'application/json; charset=utf-8','Set-Cookie':cookie('sapucaia_session',token,{maxAge:8*60*60})}});
};
