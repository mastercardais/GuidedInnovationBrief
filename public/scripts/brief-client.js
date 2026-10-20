/* ---------- the brief this page is for ---------- */
const BID=location.pathname.split('/')[2]||'';

async function api(path,body,opt={}){
  const r=await fetch(`/api/briefs/${BID}${path?'/'+path:''}`,{method:opt.method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,keepalive:!!opt.keepalive});
  let j={}; try{ j=await r.json(); }catch{}
  if(!r.ok) throw new Error(j.error||`Something went wrong (${r.status})`);
  return j;
}
