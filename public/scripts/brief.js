/* The Innovation Brief, client side.

   Ported from prototype/innovation-brief.html (18 Sep). The interaction code (navigation, frameView,
   editIn, trio, pills, lines, the slider, the teaser deck, the playback) is the prototype's, kept as
   close to verbatim as the port allowed, because every one of those behaviours was argued over and
   tested. What changed:

   - Nothing is canned. Every AI-written option comes from the server, generated from what this client
     has said so far, in four stages (frame, question, story, directions). See STAGES.
   - Regenerate asks the model for one new option, instead of cycling a fixed list.
   - Documents are really uploaded and read; findings come back from the model.
   - "Talk it through" is a real voice call (GPT-Live over WebRTC), or a typed chat when voice is off.
   - Dictation records and transcribes on the server.
   - Answers autosave to the server, so a client can close the tab and come back to the same link.
   - The retired library screens (This or That, Pre-mortem, Plot It and the rest) stay in the
     prototype. This build is the flow. */

/* ---------- helpers (prototype) ---------- */
const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>[...el.querySelectorAll(s)];
const h=(s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const P={
 regen:'<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/>',
 edit:'<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
 check:'<path d="m5 12 5 5 9-10"/>',flag:'<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
 mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
 mute:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 11 5.7M12 18v3M4 4l16 16"/>',
 stop:'<rect x="7" y="7" width="10" height="10" rx="2"/>',send:'<path d="M4 12 20 4l-4 16-4-7-8-1Z"/>',
 phone:'<path d="M3.2 14.6c4.9-4.4 12.7-4.4 17.6 0 .5.5.5 1.2 0 1.7l-1.6 1.6c-.4.4-1 .5-1.5.2l-2.3-1.3a1.2 1.2 0 0 1-.6-1v-1.9a11 11 0 0 0-5.6 0v1.9c0 .4-.2.8-.6 1l-2.3 1.3c-.5.3-1.1.2-1.5-.2l-1.6-1.6c-.5-.5-.5-1.2 0-1.7Z"/>',
 speaker:'<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11"/>',
 speakeroff:'<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
 kbd:'<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
 x:'<path d="M6 6l12 12M18 6 6 18"/>',upload:'<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
 doc:'<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'
};
const ic=(n)=>`<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const words=(t)=>h(t).split(' ').map((w,i)=>`<span class="wd" style="--i:${i}">${w}</span>`).join(' ');
const REGEN='Regenerate', EDIT='Edit';
const tipI=(icon,label,attrs='',cls='',pos='')=>`<span class="tipw"><button class="gicon ${cls}" type="button" aria-label="${h(label)}" ${attrs}>${ic(icon)}</button><span class="tip ${pos}" aria-hidden="true">${h(label)}</span></span>`;
const setWarm=(w)=>document.documentElement.style.setProperty('--w',clamp(w,0,1));

let BRIEF={client:'',contact:''}, CFG={voice:false,images:false,dictation:false};
const first=()=>String(BRIEF.contact||'').trim().split(/\s+/)[0]||'there';

async function api(path,body,opt={}){
  const r=await fetch(`/api/briefs/${BID}${path?'/'+path:''}`,{method:opt.method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,keepalive:!!opt.keepalive});
  let j={}; try{ j=await r.json(); }catch{}
  if(!r.ok) throw new Error(j.error||`Something went wrong (${r.status})`);
  return j;
}

/* A quiet message at the bottom of the screen, for the failures a screen can't show itself. */
let toastT=0;
function toast(msg){
  let t=$('#toast'); if(!t){ t=document.createElement('div'); t.id='toast'; t.className='toast'; t.setAttribute('role','status'); document.body.append(t); }
  t.textContent=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),5200);
}

const MARKS=[["Unsure","We haven't looked into this. It's a hunch at best."],["We think so","Experience or conversations point this way, but we haven't tested it."],["We know this","We've done research and have data supporting this view."]];
const band=(v)=>v<34?0:v<67?1:2;
const WORTH=['Under $5m','$5–20m','$20m+','Not sure'];
const GC={first:'linear-gradient(160deg,#FFF7EC,#FFE8D4)',u:'linear-gradient(160deg,#FFEADF,#FFD2BD)',f:'linear-gradient(160deg,#F0EAFB,#DDD2F4)',e:'linear-gradient(160deg,#FFF3DC,#F9DDB2)',w:'linear-gradient(160deg,#E8F4EF,#CFE7DD)',end:'linear-gradient(160deg,#FFFFFF,#FFE4D4)'};
const TGRAD=['linear-gradient(160deg,#FFE3D1,#F6C9B0)','linear-gradient(160deg,#F1E6FA,#DFCFF2)','linear-gradient(160deg,#FFF0D8,#F5D9AE)','linear-gradient(160deg,#E7F2EE,#CFE5DC)'];
const PGRAD='linear-gradient(135deg,#FFE3D1,#F6D9EC 55%,#FFF1DE)';

/* ---------- answers ----------
   Every AI-written slot keeps the versions it has had (`alts`) and which one is showing (`alt`), so
   regenerate can add a version and a refresh comes back to the same one. `ed` holds the client's own
   rewrite of a slot, which always wins. */
const slots=(n)=>Array.from({length:n},()=>[]);
const A={
 meta:{view:''},
 docs:{files:[],none:false,open:false,list:null},
 dump:{mode:0,text:'',msgs:[]},
 cust:{alts:[],alt:0,ed:null},
 custout:{alts:slots(3),alt:[0,0,0],ed:{},own:[],sel:[]},
 conf:{alts:slots(3),alt:[0,0,0],ed:{},val:[50,50,50],touched:[false,false,false],seen:[false,false,false]},
 hmw:{alts:slots(3),alt:[0,0,0],ed:{},own:null,sel:null},
 win:{alts:slots(6),alt:[0,0,0,0,0,0],ed:{},own:[],sel:[],flag:-1},
 press:{alts:[],alt:0,ed:{}},
 worth:{sel:null},
 con:{alts:slots(4),alt:[0,0,0,0],ed:{},own:[],sel:[],flag:-1},
 more:{text:''},
 invite:{people:[{name:'',email:''}]},
 tr:{alts:slots(4),alt:[0,0,0,0],ed:{},r:[-1,-1,-1,-1],own:[]},
 gen:{}
};
const cur=(m,i)=>{const a=m.alts[i]||[]; return a[clamp(m.alt[i]??0,0,a.length-1)]??'';};
const hmwOpt=(i)=>cur(A.hmw,i);
const hmwText=()=>{const m=A.hmw; if(m.sel==='own') return m.own||''; const i=typeof m.sel==='number'?m.sel:0; return m.ed[i]??hmwOpt(i);};
const confText=(i)=>A.conf.ed[i]??cur(A.conf,i);
const custText=()=>A.cust.ed??(A.cust.alts[A.cust.alt]||'');
const coItems=()=>[...[0,1,2].map(i=>A.custout.ed[i]??cur(A.custout,i)),...A.custout.own];
const coPicked=()=>A.custout.sel.map(i=>coItems()[i]).filter(Boolean);
const conItems=()=>[...[0,1,2,3].map(i=>A.con.ed[i]??cur(A.con,i)),...A.con.own];
const conPicked=()=>A.con.sel.map(i=>conItems()[i]).filter(Boolean);
const conFlagged=()=>A.con.flag>-1?conItems()[A.con.flag]:null;
const winItems=()=>[...[0,1,2,3,4,5].map(i=>A.win.ed[i]??cur(A.win,i)),...A.win.own];
const winPicked=()=>A.win.sel.map(i=>winItems()[i]).filter(Boolean);
const winFlagged=()=>A.win.flag>-1?winItems()[A.win.flag]:null;
const worthText=()=>A.worth.sel==null?null:WORTH[A.worth.sel];
const story=()=>A.press.alts[A.press.alt]||null;
const teaser=(i)=>({...(cur(A.tr,i)||{title:'',line:''}),...(A.tr.ed[i]||{})});
const tTitle=(i)=>teaser(i).title;

/* ---------- images: painted on the server, shown when they land ---------- */
const imgURL=(k)=>`/api/briefs/${BID}/img/${k}`;
const IMG={};
function preload(k){
  if(!k) return Promise.resolve(false);
  if(IMG[k]) return IMG[k].p;
  const e={state:'wait'}; e.p=new Promise(res=>{ const im=new Image(); im.onload=()=>{e.state='ok'; res(true); paintImages();}; im.onerror=()=>{e.state='err'; res(false);}; im.src=imgURL(k); });
  IMG[k]=e; return e.p;
}
const ready=(k)=>k&&IMG[k]?.state==='ok';
const teaserBg=(i)=>{const k=teaser(i).image; preload(k); return ready(k)?`url(${imgURL(k)}), ${TGRAD[i]}`:TGRAD[i];};
const photoBg=()=>{const k=story()?.image||earlyPhotoKey; preload(k); return ready(k)?`url(${imgURL(k)}), ${PGRAD}`:PGRAD;};
// Anything on screen waiting for an image gets it the moment it arrives, with no re-render.
function paintImages(){
  $$('.tcard[data-t]').forEach(c=>{ const bg=teaserBg(+c.dataset.t); if(c.style.backgroundImage!==bg){ c.style.backgroundImage=bg; c.classList.add('imgin'); } });
  $$('.clip .photo').forEach(p=>{ const bg=photoBg(); if(p.style.backgroundImage!==bg){ p.style.backgroundImage=bg; p.classList.add('imgin'); } });
}

/* ---------- facts: the plain picture of the answers the server writes prompts from ---------- */
function facts(){
  const f={docs:!A.docs.none&&A.docs.files.length>0};
  if(f.docs&&A.docs.list) f.findings=A.docs.list;
  if(A.dump.text.trim()) f.dump=A.dump.text.trim();
  if(A.dump.msgs.length) f.transcript=A.dump.msgs.filter(m=>m.text?.trim()).map(m=>({who:m.who,text:m.text.trim()}));
  if(A.gen.frame){
    if(custText()) f.customer=custText();
    f.changes=coPicked(); f.changesOffered=coItems();
    f.confidence=[0,1,2].map(i=>({text:confText(i),band:A.conf.val[i]!=null&&(A.conf.seen[i]||A.conf.touched[i])?MARKS[band(A.conf.val[i])][0]:null}));
  }
  if(A.gen.question){
    if(A.hmw.sel!=null){ f.question=hmwText(); f.questionOthers=[0,1,2].filter(i=>i!==A.hmw.sel).map(i=>A.hmw.ed[i]??hmwOpt(i)); }
    f.businessValue={picked:winPicked(),priority:winFlagged()};
    f.concerns={picked:conPicked(),biggest:conFlagged()};
  }
  const s=story(); if(s&&A.gen.story) f.story={when:s.when,dateline:s.dateline,headline:A.press.ed[0]??s.headline,body:A.press.ed[1]??s.body,quote:A.press.ed[2]??s.quote,attr:`${s.attribution}, ${BRIEF.client}`,image:s.image||null};
  if(A.gen.directions){
    const by=(k)=>[0,1,2,3].filter(i=>A.tr.r[i]===k).map(tTitle);
    const concepts=[0,1,2,3].map(i=>{const t=teaser(i); return {title:t.title,line:t.line,image:t.image||null,rating:['loved','maybe','no'][A.tr.r[i]]||null};});
    f.directions={loved:by(0),maybe:by(1),no:by(2),own:A.tr.own,concepts};
  }
  if(A.more.text.trim()) f.anythingElse=A.more.text.trim();
  f.invited=A.invite.people.filter(p=>p.name.trim()||p.email.trim());
  return f;
}

/* ---------- generation stages ----------
   Each stage runs when the client leaves the screen before it (so it's usually ready on arrival) and
   again on arrival if it isn't. A stage is keyed by the answers it was written from: if those change
   before the client has touched its screens, it's rewritten; once they've made choices there, it's kept
   and regenerate is theirs to use. */
const STAGES={
 frame:{wait:'Reading what you told us…',
  key:()=>JSON.stringify([!A.docs.none&&A.docs.list,A.dump.text.trim(),A.dump.msgs.map(m=>m.text)]),
  touched:()=>A.cust.ed!=null||A.cust.alt>0||A.custout.sel.length>0||A.conf.touched.some(Boolean),
  apply:(r)=>{
   Object.assign(A.cust,{alts:r.customer.slice(0,1).concat(r.customer.slice(1)),alt:0,ed:null});
   Object.assign(A.custout,{alts:r.changes.map(x=>[x]),alt:[0,0,0],ed:{},own:[]}); A.custout.sel.length=0;
   Object.assign(A.conf,{alts:r.confidence.map(x=>[x]),alt:[0,0,0],ed:{},val:[50,50,50],touched:[false,false,false],seen:[false,false,false]});
  }},
 question:{wait:'Drafting a few ways to frame it…',
  key:()=>JSON.stringify([custText(),coPicked(),[0,1,2].map(i=>A.conf.val[i]==null?null:band(A.conf.val[i]))]),
  touched:()=>A.hmw.sel!=null||A.win.sel.length>0||A.con.sel.length>0,
  apply:(r)=>{
   Object.assign(A.hmw,{alts:r.hmw.map(x=>[x]),alt:[0,0,0],ed:{},own:null,sel:null});
   Object.assign(A.win,{alts:r.businessValue.map(x=>[x]),alt:[0,0,0,0,0,0],ed:{},own:[],flag:-1}); A.win.sel.length=0;
   Object.assign(A.con,{alts:r.concerns.map(x=>[x]),alt:[0,0,0,0],ed:{},own:[],flag:-1}); A.con.sel.length=0;
  }},
 story:{wait:'Writing the story…',
  key:()=>JSON.stringify([A.hmw.sel,hmwText(),winPicked(),winFlagged()]),
  touched:()=>A.press.alt>0||Object.keys(A.press.ed).length>0,
  apply:(r)=>{ A.press.alts=[r]; A.press.alt=0; A.press.ed={}; preload(r.image); }},
 directions:{wait:'Sketching some early directions…',
  key:()=>JSON.stringify([A.hmw.sel,hmwText(),winPicked(),winFlagged()]),
  touched:()=>A.tr.r.some(x=>x>-1)||A.tr.alt.some(x=>x>0),
  apply:(r)=>{ A.tr.alts=r.map(x=>[x]); A.tr.alt=[0,0,0,0]; A.tr.ed={}; A.tr.r=[-1,-1,-1,-1]; r.forEach(x=>preload(x.image)); }},
};
const pending={};
const isReady=(st)=>{const g=A.gen[st]; return !!g&&(g.key===STAGES[st].key()||STAGES[st].touched());};
function ensure(st){
  if(isReady(st)) return Promise.resolve();
  const key=STAGES[st].key();
  if(pending[st]?.key===key) return pending[st].p;
  // One chain with a trailing catch: if apply() throws on a malformed reply, the pending entry must still
  // clear, or every "Try again" gets the same rejected promise back.
  const p=api(`gen/${st}`,{facts:facts()}).then(r=>{
    if(pending[st]?.p!==p) return pending[st]?.p; // superseded by a newer request
    STAGES[st].apply(r); A.gen[st]={key}; delete pending[st]; saveSoon();
  }).catch(e=>{ if(pending[st]?.p===p) delete pending[st]; throw e; });
  pending[st]={key,p};
  return p;
}
const prefetch=(st)=>ensure(st).catch(()=>{});
/* Screens that need a stage call this. It draws a waiting state, generates, then re-renders the same
   screen (only if the client is still on it). */
function needs(el,st,draw){
  if(isReady(st)) return draw();
  const box=document.createElement('div'); box.className='genwait rise'; box.style.setProperty('--d','.4s');
  box.innerHTML=`<div class="bar"></div><div class="bar"></div><div class="bar"></div><p>${h(STAGES[st].wait)}</p>`;
  el.append(box);
  const v=S.view;
  ensure(st).then(()=>{ if(S.view===v&&el.isConnected) render(); },e=>{
    if(!el.isConnected) return;
    box.className='generr'; box.innerHTML=`<p>We couldn't put this together just now.</p><button class="gbtn" type="button">Try again</button>`;
    $('button',box).onclick=()=>{ box.remove(); needs(el,st,draw); };
    console.error(e);
  });
}
async function regenText(kind,current,others){
  const r=await api('gen/regen',{kind,current,others:others.filter(Boolean),facts:facts()});
  return r.text;
}
const pushAlt=(m,i,v)=>{ m.alts[i].push(v); m.alt[i]=m.alts[i].length-1; delete m.ed[i]; };

/* ---------- block registry (prototype) ---------- */
const BL={};
const block=(o)=>BL[o.id]=o;
const stepsOf=(id)=>{const b=BL[id]; return typeof b.steps==='function'?b.steps():(b.steps||1);};

const S={view:null,hist:[],plan:['welcome'],why:{},skipped:{}};
const stage=$('#stage'), backBtn=$('#backBtn');
const FLOW=['welcome','docs','dump','cust','custout','confintro','conf','hmw','win','pressintro','press','concerns','teasersintro','teasers','anything','team','end','sent'];
const EST=FLOW.length-1;
// What each screen hands to the next: the stage its successors will need, started as it's left.
const AFTER={dump:['frame'],custout:['frame'],conf:['question'],hmw:['question'],win:['story','directions']};
// Start the editorial photo as soon as the call ends, while the rest of the brief is being built.
let earlyPhotoKey=null, earlyPhotoStarted=false;
function prefetchPhoto(){
  if(earlyPhotoStarted) return;
  earlyPhotoStarted=true;
  api('gen/photo',{facts:facts()}).then(r=>{ if(r.image){ earlyPhotoKey=r.image; preload(r.image); } }).catch(()=>{});
}
const clip=(t,n=70)=>{t=String(t).trim().replace(/[.?!]+$/,''); return t.length>n?t.slice(0,n).replace(/\s+\S*$/,'')+'…':t;};
function planNext(id){ const n=FLOW[FLOW.indexOf(id)+1]; return n?{id:n,nodeck:true}:null; }

/* ---------- navigation (prototype) ---------- */
let busy=false;
async function go(v,isBack){
  if(busy) return; busy=true;
  const curEl=$('.view',stage);
  if(S.view) BL[S.view.b].leave?.();
  if(!isBack&&S.view) S.hist.push(S.view);
  if(curEl){
    curEl.classList.add(isBack?'out-back':'out');
    document.body.classList.add('thinking');
    await wait(RM?40:isBack?360:560);
    document.body.classList.remove('thinking');
  }
  S.view=v; render(); busy=false;
}
async function next(){
  const v=S.view; if(busy) return;
  if(v.s<stepsOf(v.b)-1) return go({b:v.b,s:v.s+1});
  (AFTER[v.b]||[]).forEach(prefetch);
  const n=planNext(v.b); if(!n) return;
  S.plan=S.plan.slice(0,S.plan.indexOf(v.b)+1).concat(n.id);
  go({b:n.id,s:0});
}
/* Some blocks animate their own step change (the teaser deck), so fading the whole view out and
   rebuilding it would read as a page reload. This advances the step and leaves the DOM alone. */
function stepInPlace(){
  const v=S.view;
  if(busy||!v||v.s>=stepsOf(v.b)-1) return false;
  S.hist.push({b:v.b,s:v.s});
  S.view={b:v.b,s:v.s+1};
  const el=$('.view',stage); if(el) el.dataset.s=S.view.s;
  chrome(); syncURL(); saveSoon();
  return true;
}
function back(){ if(!S.hist.length||busy) return; go(S.hist.pop(),true); }
function skip(){
  const v=S.view; if(!v||busy) return;
  S.skipped[v.b+'-'+v.s]=true; BL[v.b].skip?.(v.s);
  next();
}
backBtn.onclick=back;

let negReady=false, speakT=0;
function setLive(on){
  const r=document.documentElement;
  if(r.classList.contains('live')===on) return;
  r.classList.toggle('live',on); r.classList.remove('speaking'); clearTimeout(speakT);
  if(!negReady) return;
  const c=on?'live-in':'live-out'; r.classList.add(c); setTimeout(()=>r.classList.remove(c),on?1000:700);
}
function setNegative(on){ document.documentElement.classList.toggle('negative',on); }

/* The address bar names the screen, and the answers live on the server, so a refresh (or coming back
   to the link next week) resumes where the client was. */
function viewSlug(){
  const v=S.view; if(!v||v.b==='welcome') return '';
  return v.b+(stepsOf(v.b)>1?'-'+(v.s+1):'');
}
function syncURL(){
  try{ const q=viewSlug(), u=new URL(location.href); if(q) u.searchParams.set('view',q); else u.searchParams.delete('view'); history.replaceState(null,'',u); }catch(e){}
}
let saveT=0, locked=false;
function saveState(keepalive){
  if(locked||!BID) return;
  clearTimeout(saveT); A.meta.view=viewSlug();
  const body={answers:A,facts:facts()};
  // Browsers refuse keepalive bodies over 64 KB (a long transcript gets there), so big ones go as a normal request.
  if(keepalive&&JSON.stringify(body).length>60000) keepalive=false;
  api('state',body,{method:'PUT',keepalive}).catch(()=>{});
}
const saveSoon=()=>{ if(locked) return; clearTimeout(saveT); saveT=setTimeout(saveState,700); };

function render(){
  const v=S.view, el=document.createElement('section');
  setNegative(false); setLive(v.b==='dump'&&A.dump.mode===1); negReady=true;
  el.className='view'; el.dataset.b=v.b; el.dataset.s=v.s??0;
  stage.replaceChildren(el); stage.scrollTop=0;
  $('#sky').toggleAttribute('hidden',!(v.b==='end'||v.b==='sent'));
  const b=BL[v.b]; setWarm(b.warm??.6); b.render(el,v.s);
  chrome(); syncURL(); saveSoon(); frameView(el);
  const q=$('.q',el);
  if(q){ q.tabIndex=-1; q.focus({preventScroll:true}); $('#live').textContent=q.innerText.replace(/\s+/g,' '); }
}
function chrome(){
  const v=S.view, id=v.b, n=stepsOf(id);
  backBtn.disabled=!S.hist.length||id==='sent';
  const k=Math.max(0,FLOW.indexOf(id));
  const frac=id==='sent'?EST:k+(v.s+1)/n-1;
  $('#progFill').style.width=Math.min(100,Math.max(0,frac)/EST*100)+'%';
}
/* Content scrolls, never the page (prototype, verbatim). */
function frameView(el){
  const HEAD='.eyebrow,.q', FOOT='.nextslot,.row,.dhost';
  const out=(k)=>k.matches('.deck,.vhead,.vbody,.vfoot')||['absolute','fixed'].includes(getComputedStyle(k).position);
  const mk=(c,kids)=>{ const w=document.createElement('div'); w.className=c; w.append(...kids); return w; };
  const wrap=()=>{
    const body=el.querySelector(':scope>.vbody');
    if(body){
      for(const k of [...el.children]){ if(out(k)) continue;
        if(k.matches(FOOT)){ let f=el.querySelector(':scope>.vfoot'); if(!f){ f=mk('vfoot',[]); body.after(f); } f.append(k); }
        else body.append(k); }
      return;
    }
    const all=[...el.children].filter(k=>!out(k)), head=[], foot=[];
    if(!all.length) return;
    for(const k of all){ if(k.matches(HEAD)) head.push(k); else break; }
    for(let i=all.length-1;i>=0;i--){ const k=all[i]; if(head.includes(k)||!k.matches(FOOT)) break; foot.unshift(k); }
    const mid=all.filter(k=>!head.includes(k)&&!foot.includes(k));
    const mark=document.createComment(''); all[0].before(mark);
    mark.replaceWith(...[head.length&&mk('vhead',head),mk('vbody',mid),foot.length&&mk('vfoot',foot)].filter(Boolean));
  };
  const scroller=()=>el.classList.contains('scrolls')&&el.querySelector(':scope>.vbody')||el;
  const edges=()=>{ const b=scroller(); el.classList.toggle('at-top',b.scrollTop<4); el.classList.toggle('at-end',b.scrollTop+b.clientHeight>=b.scrollHeight-4); };
  const natural=()=>{
    const items=[...el.children].flatMap(k=>k.matches('.vhead,.vbody,.vfoot')?[...k.children]:[k])
      .filter(k=>getComputedStyle(k).position!=='absolute'&&getComputedStyle(k).display!=='none');
    const gap=parseFloat(getComputedStyle(el).rowGap)||0;
    return items.reduce((a,k)=>a+k.offsetHeight,0)+gap*Math.max(0,items.length-1);
  };
  const measure=()=>{
    if(el.classList.contains('chatting')){ el.classList.remove('scrolls'); return; }
    const room=parseFloat(getComputedStyle(el).maxHeight)||innerHeight, on=el.classList.contains('scrolls');
    el.classList.toggle('scrolls',natural()>room+(on?-8:1));
    edges();
  };
  let raf=0;
  const mo=new MutationObserver(()=>soon()), ro=new ResizeObserver(()=>soon());
  const soon=()=>{ if(raf) return; raf=requestAnimationFrame(()=>{ raf=0;
    if(!el.isConnected){ mo.disconnect(); ro.disconnect(); return; }
    mo.disconnect(); wrap(); mo.observe(el,{childList:true,subtree:true}); measure(); }); };
  el.addEventListener('scroll',edges,{passive:true,capture:true});
  wrap(); mo.observe(el,{childList:true,subtree:true}); ro.observe(el); ro.observe(stage);
  measure(); document.fonts?.ready.then(soon); setTimeout(soon,1300);
}
document.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse') return;
  const host=e.target.closest?.('.fhost'), prev=document.querySelector('.fhost.tapped');
  if(prev&&prev!==host) prev.classList.remove('tapped');
  host?.classList.add('tapped');
},{capture:true,passive:true});

/* The welcome ring is the flow itself, in the client's words. Never activity names. */
const ringCards=()=>{
  const c=FLOW.filter(id=>BL[id]?.card).map(id=>[BL[id].card,BL[id].group]);
  return c.map((a,i)=>`<div class="dcard" style="--a:${(i*360/c.length).toFixed(1)}deg;--bgc:${GC[a[1]]}">${h(a[0])}</div>`).join('');
};

/* ---------- shared bits (prototype) ---------- */
const canSkip=()=>{const v=S.view; return !!v&&!BL[v.b].noSkip;};
const skipB=(cls='gbtn')=>`<button class="${cls}" type="button" data-skip>Skip</button>`;
const nextBtn=(label='Next',extra='')=>`<div class="nextslot rise" style="--d:.9s">${canSkip()?skipB():''}${extra}<button class="gbtn primary" type="button" data-next>${h(label)}</button></div>`;
const bindNext=(el)=>$$('[data-next]',el).forEach(b=>b.onclick=next);
const qtools=(canRegen=true)=>`<span class="qtools ftools">${canRegen?tipI('regen',REGEN,'data-qrg'):''}${tipI('edit',EDIT,'data-qed','edit')}</span>`;
// Runs an async regenerate on one element: dims it while waiting, reports failure without losing anything.
async function busyOn(node,fn){
  if(!node||node.classList.contains('regening')) return false;
  node.classList.add('regening'); node.setAttribute('aria-busy','true');
  try{ await fn(); return true; }
  catch(e){ toast("Couldn't come up with another one just now. Try again in a moment."); console.error(e); return false; }
  finally{ node.classList.remove('regening'); node.removeAttribute('aria-busy'); }
}

/* ---------- dictation: record, then transcribe on the server ----------
   Returns {stop()}. onInterim shows progress text, onFinal the transcript, onEnd({error}) always runs. */
function listen({onInterim,onFinal,onEnd}){
  let rec=null, stream=null, stopped=false, done=false, tick=0; const t0=Date.now(), chunks=[];
  // onEnd runs exactly once, whichever of stop, a mic error or the transcript gets there first.
  const finish=(r)=>{ if(done) return; done=true; clearInterval(tick); onEnd(r); };
  const fmt=(ms)=>{const s=Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
  const ctl={stop(){ if(stopped) return; stopped=true; clearInterval(tick); if(rec&&rec.state!=='inactive') rec.stop(); else { stream?.getTracks().forEach(t=>t.stop()); finish({}); } }};
  (async()=>{
    try{ stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}}); }
    catch{ stopped=true; finish({error:"The microphone isn't available. You can type instead."}); return; }
    if(stopped){ stream.getTracks().forEach(t=>t.stop()); finish({}); return; }
    const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(m=>window.MediaRecorder?.isTypeSupported?.(m))||'';
    try{ rec=new MediaRecorder(stream,mime?{mimeType:mime}:{}); }catch{ stream.getTracks().forEach(t=>t.stop()); finish({error:"This browser can't record audio. You can type instead."}); return; }
    rec.ondataavailable=(e)=>{ if(e.data.size) chunks.push(e.data); };
    rec.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());
      onInterim('Writing that down…');
      try{
        const blob=new Blob(chunks,{type:(rec.mimeType||'audio/webm').split(';')[0]});
        const r=await fetch(`/api/briefs/${BID}/transcribe`,{method:'POST',headers:{'Content-Type':blob.type},body:blob});
        const j=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(j.error);
        if(j.text) onFinal(j.text);
        finish({});
      }catch(e){ finish({error:"That didn't come through. Try again, or type it."}); }
    };
    rec.start(1000);
    onInterim('Listening…'); tick=setInterval(()=>onInterim(`Listening… ${fmt(Date.now()-t0)}`),500);
  })();
  return ctl;
}
let micCtl=null;
const stopMic=()=>{ if(micCtl){const c=micCtl; micCtl=null; c.stop();} };

/* ---------- Welcome ---------- */
block({id:'welcome',name:'Welcome',group:'first',warm:.55,noSkip:true,
 render(el){
  el.classList.add('welcome');
  el.innerHTML=`<div class="deck" aria-hidden="true"><div class="ring">${ringCards()}</div></div>
   <h1 class="q">${words(`Hi ${first()}. We'd love to hear about the opportunity you're chasing.`)}</h1>
   <p class="sub rise" style="--d:1s">This takes about fifteen minutes, and you can skip anything you're not sure about. Your answers save as you go.</p>
   ${nextBtn("Let's begin")}`;
  bindNext(el);
 }});

/* ---------- Bring Your Docs ---------- */
const DOC_ACCEPT='.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.rtf,.odt';
const MIME={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',txt:'text/plain',md:'text/markdown',rtf:'application/rtf',odt:'application/vnd.oasis.opendocument.text'};
const mimeOf=(f)=>f.type||MIME[(f.name.split('.').pop()||'').toLowerCase()]||'application/octet-stream';
const fsize=(b)=>b>1e6?(b/1e6).toFixed(1)+' MB':Math.max(1,Math.round(b/1e3))+' KB';
const b64=(file)=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]||''); r.onerror=()=>rej(new Error("Couldn't read that file")); r.readAsDataURL(file); });
block({id:'docs',name:'Bring Your Docs',card:'What you already have',group:'first',warm:.55,
 steps:()=>A.docs.none?1:2,
 skip(s){ if(s===0){ A.docs.none=true; A.docs.open=false; } },
 render(el,s){ s===0?docsAsk(el):docsFindings(el); }});
function docsAsk(el){
  const d=A.docs, ASK='Got decks, board papers or research you can share?', DROP='Drop them in.';
  el.innerHTML=`<h1 class="q md">${words(d.open?DROP:ASK)}</h1><div class="dhost"></div>`;
  const host=$('.dhost',el);
  if(d.open) return docsUpload(host);
  host.innerHTML=`<div class="nextslot rise" style="--d:.8s"><button class="gbtn" type="button" data-no>No, skip</button><button class="gbtn primary" type="button" data-yes>Yes</button></div>`;
  $('[data-no]',host).onclick=()=>{d.none=true; next();};
  $('[data-yes]',host).onclick=()=>{d.open=true; $('.q',el).innerHTML=words(DROP); docsUpload(host); $('.drop',host).focus({preventScroll:true});};
}
let uploads=0;
function docsUpload(el){
  const d=A.docs; d.none=false;
  el.innerHTML=`<label class="drop rise" style="--d:.1s" tabindex="0"><input type="file" multiple hidden accept="${DOC_ACCEPT}">${ic('upload')}<span><span class="link">Choose files</span> or drag them here</span></label>
   <p class="hint rise" style="--d:.3s">PDFs, Word, PowerPoint or Excel, up to 25 MB each. Only Digital Labs sees them.</p>
   <div class="files"></div>
   <div class="nextslot rise" style="--d:.45s"><button class="gbtn primary" type="button" data-next>Read them</button></div>`;
  const fl=$('.files',el), nb=$('[data-next]',el), drop=$('.drop',el), fi=$('input',drop);
  const draw=()=>{
    fl.innerHTML=d.files.map((f,i)=>`<div class="file${f.up?' up':''}" style="--i:${i}">${ic('doc')}<span>${h(f.name)} <small>${f.up?'Uploading…':h(fsize(f.size))}</small></span>${f.up?'':tipI('x','Remove',`data-rm="${i}"`)}</div>`).join('');
    $$('[data-rm]',fl).forEach(b=>b.onclick=async()=>{ const f=d.files[+b.dataset.rm]; d.files.splice(+b.dataset.rm,1); d.list=null; draw(); saveSoon(); if(f?.id) api(`docs/${f.id}`,null,{method:'DELETE'}).catch(()=>{}); });
    nb.disabled=uploads>0;
    nb.textContent=uploads>0?'Uploading…':d.files.length?'Read them':"I don't have any";
  };
  const add=async(files)=>{
    for(const file of [...files]){
      if(file.size>25e6){ toast(`${file.name} is over 25 MB, so we can't read it here.`); continue; }
      if(d.files.length>=10){ toast('Ten documents is the limit.'); break; }
      const row={id:null,name:file.name,size:file.size,up:true}; d.files.push(row); uploads++; draw();
      try{ const r=await api('docs',{name:file.name,mime:mimeOf(file),data:await b64(file)}); Object.assign(row,{id:r.id,up:false}); delete row.up; d.list=null; }
      catch(e){ d.files.splice(d.files.indexOf(row),1); toast(`${file.name}: ${e.message}`); }
      uploads--; draw(); saveSoon();
    }
  };
  fi.onchange=(e)=>{ add(e.target.files); fi.value=''; };
  drop.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault(); fi.click();}};
  drop.ondragover=(e)=>{e.preventDefault(); drop.classList.add('over');};
  drop.ondragleave=()=>drop.classList.remove('over');
  drop.ondrop=(e)=>{e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files);};
  nb.onclick=async()=>{
    if(uploads) return;
    if(!d.files.length){ d.none=true; return next(); }
    if(d.list){ return next(); }
    fl.classList.add('reading'); nb.disabled=true; nb.textContent='Reading…';
    const slow=setTimeout(()=>{ if(nb.isConnected) nb.textContent='Still reading. Big files take a minute…'; },9000);
    try{ const r=await api('read',{}); d.list=r.findings.slice(); saveSoon(); next(); }
    catch(e){ toast("We couldn't read those just now. Try again, or skip this step."); console.error(e); fl.classList.remove('reading'); nb.disabled=false; nb.textContent='Read them'; }
    finally{ clearTimeout(slow); }
  };
  draw();
}
function docsFindings(el){
  const d=A.docs;
  el.innerHTML=`<h1 class="q md">${words("Here's what stood out. Fix anything we got wrong.")}</h1><div class="lines"></div>${nextBtn('Looks right')}`;
  const host=$('.lines',el);
  const show=()=>{
    lines(host,{
      items:()=>d.list, nAI:0, addPh:'Add something we missed',
      onEdit:(i,t)=>{d.list[i]=t;},
      onAdd:(t)=>d.list.push(t),
      onDel:(i)=>({i,t:d.list.splice(i,1)[0]}),
      onUndo:(u)=>d.list.splice(u.i,0,u.t)});
  };
  bindNext(el);
  if(d.list) return show();
  host.outerHTML='<div class="genwait"><div class="bar"></div><div class="bar"></div><div class="bar"></div><p>Reading your documents…</p></div>';
  api('read',{}).then(r=>{ d.list=r.findings.slice(); if(el.isConnected) render(); }).catch(()=>{ const w=$('.genwait',el); if(w) w.outerHTML='<div class="generr"><p>We couldn\'t read your documents just now. You can skip this and carry on.</p></div>'; });
}

/* ---------- The Messy Version ---------- */
block({id:'dump',name:'The Messy Version',card:'The Messy Version',group:'first',warm:.62,
 leave(){ stopMic(); call?.hangup(); },
 render(el){ dumpStep(el); }});
/* Two ways in (Jon, 18 Sep): write it down, or talk it through. The call is the one we'd rather they
   took, so it reads as an offer with its own orb and glow, not a peer segment. */
function dumpStep(el){
  if(A.dump.mode!==1) A.dump.mode=0;
  el.innerHTML=`<h1 class="q md">${words("In your own words tell us what's going on.")}</h1>
   <div class="modes rise" style="--d:.45s" role="group" aria-label="How to tell us">
    <button type="button" class="modebtn" data-m="0">${ic('kbd')}<span class="lab">Write it down<small>${CFG.dictation?'Type or dictate':'Type it out'}</small></span></button>
    <button type="button" class="modebtn call" data-m="1"><span class="callorb" aria-hidden="true">${ic('phone')}</span><span class="lab">Talk it through<small>${CFG.voice?'A two-minute call':'A two-minute chat'}</small></span></button>
   </div>
   <div class="bodyhost rise" style="--d:.6s"></div>
   ${nextBtn('Next')}`;
  const host=$('.bodyhost',el);
  const mode=(fromClick)=>{
    $$('[data-m]',el).forEach(b=>b.setAttribute('aria-pressed',+b.dataset.m===A.dump.mode));
    stopMic(); call?.hangup(); el.classList.toggle('chatting',A.dump.mode===1); setLive(A.dump.mode===1);
    if(A.dump.mode===1) dumpChat(host,{autostart:fromClick,toText:()=>{A.dump.mode=0; mode();}});
    else dumpSend(host);
    saveSoon();
  };
  $$('[data-m]',el).forEach(b=>b.onclick=()=>{ const m=+b.dataset.m; if(m===A.dump.mode&&m===1) return; A.dump.mode=m; mode(true);});
  mode(false); bindNext(el);
}
const docNote=()=>A.docs.none||!A.docs.files.length?'':`<span>${ic('doc')} ${A.docs.files.length} document${A.docs.files.length>1?'s':''} read</span>`;
function dumpSend(host){
  host.innerHTML=`<div class="composer"><div class="field" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Tell us what's going on" data-ph="Start anywhere. What changed recently? What have you already tried?"></div>
   <div class="ctools"><div class="grow">${docNote()}</div>${CFG.dictation?`<button class="orb" type="button" aria-label="Start talking">${ic('mic')}</button>`:''}</div></div>`;
  const f=$('.field',host), orb=$('.orb',host), comp=$('.composer',host), grow=$('.grow',host);
  f.textContent=A.dump.text;
  f.oninput=()=>{A.dump.text=f.innerText;};
  if(!orb) return;
  orb.onclick=()=>{
    if(micCtl) return stopMic();
    comp.classList.add('live'); orb.classList.add('live'); orb.innerHTML=ic('stop'); orb.setAttribute('aria-label','Stop talking');
    const im=document.createElement('span'); im.className='interim';
    if(A.dump.text&&!/\s$/.test(A.dump.text)) A.dump.text+=' ';
    const paint=()=>{f.textContent=A.dump.text; f.append(im); f.scrollTop=f.scrollHeight;};
    paint(); f.contentEditable='false';
    micCtl=listen({
      onInterim:(t)=>{im.textContent=t; f.scrollTop=f.scrollHeight;},
      onFinal:(t)=>{A.dump.text+=t.trim()+' '; im.textContent=''; paint(); saveSoon();},
      onEnd:(r)=>{micCtl=null; im.remove(); f.textContent=A.dump.text; f.contentEditable='true'; comp.classList.remove('live'); orb.classList.remove('live'); orb.innerHTML=ic('mic'); orb.setAttribute('aria-label','Start talking');
        if(r?.error) grow.innerHTML=docNote()+`<span>${h(r.error)}</span>`;}});
  };
}

/* ---------- Talk it through: a real call, or a typed chat when voice is off ----------
   The call is GPT-Live over WebRTC. The server creates the session (the key and the interviewer's
   instructions never reach the browser), the browser carries the audio, and the data channel carries
   both speakers' transcripts, which become the client's "own words" for every later prompt. */
let call=null;
function dumpChat(host,o={}){
  const d=A.dump; d.msgs??=[];
  const voice=CFG.voice&&!d.typed;
  host.innerHTML=`<div class="lchat">
   <div class="lhead rise" style="--d:.45s">${tipI('kbd','Type it in one go instead','data-totext','','start')}<span class="lpill"><i aria-hidden="true"></i>Innovation Brief</span><span></span></div>
   <div class="lthread" aria-live="polite"></div>
   <div class="lstatus rise" style="--d:.75s"><span class="lchip"></span></div>
   <div class="lctl rise" style="--d:.85s">${tipI('phone',voice?'End the call and carry on':'End the chat and carry on','data-end','lround lend ready','start')}<span class="grow"></span><button class="lround lmic" type="button" aria-pressed="false" aria-label="${voice?'Mute':'Talk'}">${ic('mic')}</button>${voice?`<button class="lround lspk" type="button" aria-pressed="true" aria-label="Speaker on">${ic('speaker')}</button>`:''}</div>
   <div class="lbar rise" style="--d:.95s"><input type="text" aria-label="Your reply"><button class="gicon lsend" type="button" aria-label="Send">${ic('send')}</button></div>
  </div>`;
  const th=$('.lthread',host), inp=$('input',host), sendB=$('.lsend',host), mic=$('.lmic',host), spk=$('.lspk',host), chip=$('.lchip',host), endB=$('[data-end]',host);
  let st='idle', wrapped=false;
  const status=(k,msg)=>{ st=k; chip.dataset.s=k;
    chip.innerHTML={think:'<span class="sp" aria-hidden="true"></span>Thinking',connect:'<span class="sp" aria-hidden="true"></span>Connecting',
      speak:'<span class="ldot" aria-hidden="true"></span>Speaking',listen:'<span class="ldot" aria-hidden="true"></span>Listening',
      done:`${ic('check')}${voice?'Call ended':'Done'}`,err:h(msg||'Something went wrong')}[k]||'';
    if(k==='idle'||k==='done'||k==='err'){ chip.innerHTML+=` <button class="gbtn ghost lstart" type="button">${d.msgs.length?(voice?'Talk some more':'Keep going'):(voice?'Start the call':'Start')}</button>`; $('.lstart',chip).onclick=start; }
    const live=k==='listen'||k==='speak'||k==='think';
    inp.disabled=!live&&!(k==='done'&&!voice); sendB.disabled=inp.disabled; mic.disabled=!live&&!(!voice&&k==='done');
    inp.placeholder=voice?(live?'Or type something to add':"The call isn't running"):(k==='done'?'Add anything else, or end the chat':'Type a reply, or tap the mic');
    endB.classList.add('ready');
    // Before anyone has spoken, the thread says what's happening instead of sitting empty.
    const w=$('.lwait',th);
    if(!d.msgs.length){
      const line=k==='connect'?'Connecting you now…':k==='listen'||k==='speak'?"Say hello whenever you're ready.":k==='err'?'':voice?"When you're ready, start the call. It's two or three minutes, and you can type instead at any point.":'';
      if(w) w.textContent=line; else if(line){ const e=document.createElement('div'); e.className='lmsg ai now lwait'; e.textContent=line; th.append(e); }
    } else w?.remove();
  };
  const node=(m)=>{ const b=document.createElement('div'); b.className='lmsg '+(m.who==='ai'?'ai':'me'); b.textContent=m.text; return b; };
  const markNow=()=>{ const ais=$$('.lmsg.ai',th); ais.forEach((x,i)=>x.classList.toggle('now',i===ais.length-1)); };
  const pin=()=>{ if(th.isConnected) th.scrollTop=th.scrollHeight; };
  const add=(m)=>{ $('.lwait',th)?.remove(); const n=node(m); th.append(n); markNow(); th.scrollTo({top:th.scrollHeight,behavior:RM?'auto':'smooth'}); return n; };
  const speaking=()=>{ const r=document.documentElement; r.classList.add('speaking'); clearTimeout(speakT); speakT=setTimeout(()=>{ r.classList.remove('speaking'); if(st==='speak') status('listen'); },RM?0:1400); };
  th.replaceChildren(...d.msgs.map(node)); markNow(); requestAnimationFrame(pin); setTimeout(pin,700);

  /* typed chat: the server's text model plays the interviewer */
  const typedTurn=async()=>{
    status('think');
    try{
      const r=await api('gen/chat',{messages:d.msgs,facts:facts()});
      if(!th.isConnected) return;
      d.msgs.push({who:'ai',text:r.reply}); add({who:'ai',text:r.reply}); speaking(); saveSoon();
      status(r.done?'done':'listen');
    }catch(e){ if(th.isConnected) status('err',"That didn't go through."); }
  };
  const typedSend=(t)=>{ t=t.trim(); if(!t) return; d.msgs.push({who:'client',text:t}); add({who:'client',text:t}); saveSoon(); typedTurn(); };

  /* voice: one bubble per speaker turn, grown by transcript deltas */
  let turn=null;
  // A listening noise ("mm", "right") while the client is mid-thought isn't a turn: when they carry on,
  // it's dropped and their bubble keeps growing, rather than their sentence splitting in two.
  const BACKCHANNEL=/^\s*(m+-?h?m+|h?m+|uh-huh|yeah|yep|right|ok(ay)?|sure|got it|i see)[.!,…]*\s*$/i;
  let prevClient=null;
  const delta=(who,txt)=>{
    if(!txt) return;
    if(who==='client'&&turn?.who==='ai'&&prevClient&&d.msgs[d.msgs.indexOf(turn.m)-1]===prevClient.m&&BACKCHANNEL.test(turn.m.text)){
      d.msgs.splice(d.msgs.indexOf(turn.m),1); turn.el.remove(); markNow(); turn=prevClient;
    }
    if(!turn||turn.who!==who){ if(turn?.who==='client') prevClient=turn; const m={who,text:''}; d.msgs.push(m); turn={who,m,el:add(m)}; }
    turn.m.text+=txt; turn.el.textContent=turn.m.text.trimStart(); pin();
    if(who==='ai'){ speaking(); if(st==='listen') status('speak'); }
    saveSoon();
  };
  const start=async()=>{
    if(!voice){ if(!d.msgs.length) return typedTurn(); status('listen'); inp.focus(); return; }
    call?.hangup(); wrapped=false; turn=null;
    status('connect');
    const me=liveCall({
      onStarted:()=>{ if(th.isConnected&&call===me) status('listen'); },
      onDelta:(who,t)=>{ if(th.isConnected&&call===me) delta(who,t); },
      onWrap:()=>{ wrapped=true; endB.classList.add('ready'); },
      onEnded:(err)=>{ const mine=!call||call===me; if(call===me) call=null; if(!th.isConnected||!mine) return; turn=null; saveSoon();
        if(err==='mic'){ d.typed=true; toast("Your microphone isn't available, so let's type it instead."); dumpChat(host,{autostart:true,toText:o.toText}); return; }
        status(err?'err':'done',err?'The call dropped. You can try again, or type instead.':''); },
    });
    call=me;
    try{ await me.ready; }
    catch(e){ console.error(e); if(th.isConnected&&!call) status('err',"We couldn't start the call. Try again, or type instead."); }
  };
  const send=()=>{
    const t=inp.value.trim(); if(!t) return; inp.value='';
    if(voice){ if(!call) return; const m={who:'client',text:t}; d.msgs.push(m); add(m); turn=null; call.typed(t); saveSoon(); }
    else typedSend(t);
  };
  sendB.onclick=send;
  inp.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } };
  mic.onclick=()=>{
    if(voice){ if(!call) return; const muted=mic.getAttribute('aria-pressed')!=='true'; call.mute(muted); mic.setAttribute('aria-pressed',muted); mic.innerHTML=ic(muted?'mute':'mic'); mic.setAttribute('aria-label',muted?'Unmute':'Mute'); mic.classList.toggle('muted',muted); return; }
    if(micCtl) return stopMic();
    mic.classList.add('live'); mic.innerHTML=ic('stop'); mic.setAttribute('aria-label','Stop talking');
    micCtl=listen({onInterim:(t)=>{inp.placeholder=t;},onFinal:(t)=>{inp.value=(inp.value+' '+t).trim();},
      onEnd:(r)=>{micCtl=null; mic.classList.remove('live'); mic.innerHTML=ic('mic'); mic.setAttribute('aria-label','Talk'); if(r?.error) toast(r.error); else if(inp.value.trim()) send(); status(st);}});
  };
  spk?.addEventListener('click',()=>{ const on=spk.getAttribute('aria-pressed')!=='true'; spk.setAttribute('aria-pressed',on); spk.innerHTML=ic(on?'speaker':'speakeroff'); spk.setAttribute('aria-label',on?'Speaker on':'Speaker off'); call?.speaker(on); });
  endB.onclick=async()=>{ stopMic(); if(call){ status('think'); chip.innerHTML='<span class="sp" aria-hidden="true"></span>Wrapping up'; await call.hangup(); } prefetchPhoto(); next(); };
  $('[data-totext]',host).onclick=()=>{ stopMic(); call?.hangup(); o.toText?.(); };
  status(d.msgs.length?'done':'idle');
  if(d.msgs.length) status(voice?'done':'listen');
  if(o.autostart&&!d.msgs.length) start();
}

/* The call itself. Returns a handle straight away, so End, Back or "Type it instead" can hang up at any
   point, including the several seconds of mic permission, ICE gathering and the session POST. (The first
   version only returned once connected, so a client who left mid-connect got a call that started on a
   screen they'd already gone from, mic open.) `ready` resolves when the offer is answered; everything
   after arrives through the callbacks, and onEnded fires exactly once. */
function liveCall({onStarted,onDelta,onWrap,onEnded}){
  let mic=null, pc=null, dc=null, audio=null, started=false, closed=false, ended=false, closing=null, spoke=false, heard=false, n=0;
  const timers=[];
  const end=(why)=>{ if(ended) return; ended=true; onEnded(why); };
  const cleanup=()=>{ if(closed) return; closed=true; timers.forEach(clearTimeout); mic?.getTracks().forEach(t=>t.stop()); try{dc?.close();}catch{} try{pc?.close();}catch{} if(audio) audio.srcObject=null; };
  const sendEv=(ev)=>{ if(dc?.readyState==='open') dc.send(JSON.stringify({event_id:`c${++n}`,...ev})); };
  const handle={
    typed:(t)=>sendEv({type:'session.instructions.append',delegation_id:null,content:`The client typed this instead of saying it: "${t.slice(0,1500)}". Respond to it naturally, as if they had said it.`}),
    mute:(m)=>{ mic?.getAudioTracks().forEach(t=>t.enabled=!m); sendEv({type:m?'session.input_audio.mute':'session.input_audio.unmute'}); },
    speaker:(on)=>{ if(audio) audio.muted=!on; },
    // Graceful close: ask for session.closed (final usage), give it a few seconds, then drop.
    hangup:()=>new Promise(res=>{
      if(closed){ end(null); return res(); }
      if(!started||dc?.readyState!=='open'){ cleanup(); end(null); return res(); }
      closing=res; sendEv({type:'session.close'});
      setTimeout(()=>{ cleanup(); end(null); res(); },4000);
    }),
  };
  handle.ready=(async()=>{
    try{ mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}); }
    catch{ closed=true; end('mic'); return; }
    if(closed){ mic.getTracks().forEach(t=>t.stop()); return; } // hung up while the permission prompt was open
    // Use Google's public STUN so we gather reflexive (public IP) candidates.
    // Azure's ice_servers come back with the session answer; we can't use them for the initial gather,
    // but public STUN is enough to get a reachable candidate for the Azure side to connect to.
    pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]}); audio=new Audio(); audio.autoplay=true; window.__livePC=pc;
    pc.addEventListener('track',(e)=>{ audio.srcObject=new MediaStream([e.track]); audio.play().catch(()=>{}); });
    mic.getAudioTracks().forEach(t=>pc.addTrack(t,mic));
    dc=pc.createDataChannel('oai-events');
    dc.addEventListener('message',({data})=>{
      let ev; try{ ev=JSON.parse(data); }catch{ return; }
      // A short ring of event types, for diagnosing a call from the console (window.__live).
      (window.__live??=[]).push(ev.type); if(window.__live.length>400) window.__live.shift();
      switch(ev.type){
        case 'session.started': {
          started=true; onStarted();
          // Client delegation has no response.create command. Commentary is the documented way to
          // give GPT-Live something to say; asking it to greet in instructions alone waits for VAD,
          // so the client's first sentence can trigger and get swallowed by the opening turn.
          const greet=`Hi ${first()}, thanks for hopping on. This chat will take about two or three minutes, so our team can hear it in your own words${A.docs.files.length&&!A.docs.none?'. I’ve read the documents you shared':''}. What problem are you hoping to solve, or what opportunity are you chasing?`;
          sendEv({type:'session.commentary.append',delegation_id:null,content:greet});
          timers.push(setTimeout(()=>sendEv({type:'session.instructions.append',delegation_id:null,content:'About two and a half minutes have passed. Ask at most one more question, then wrap up as your instructions say.'}),150_000));
          timers.push(setTimeout(()=>{ onWrap(); sendEv({type:'session.instructions.append',delegation_id:null,content:'Time is up. Thank them warmly now, say you will play back what you heard on the next screen, and ask them to press the end call button to finish.'}); },240_000));
          break; }
        case 'session.input_transcript.delta': heard=true; onDelta('client',ev.delta); break;
        case 'session.output_transcript.delta': spoke=true; onDelta('ai',ev.delta); break;
        case 'session.delegation.created': // it shouldn't delegate; if it does, give it nothing to wait for
          sendEv({type:'session.thinking.append',delegation_id:ev.delegation?.id??null,content:'There is nothing to look up. Carry on the conversation from what the client has said.'}); break;
        case 'session.closed': closing?.(); cleanup(); end(null); break;
        case 'error': console.warn('live error',ev.error||ev); break;
      }
    });
    dc.addEventListener('close',()=>{ if(!closed){ cleanup(); end(started?null:'drop'); } });
    try{
      const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
      if(pc.iceGatheringState!=='complete') await new Promise(res=>{ const t=setTimeout(res,4000); pc.addEventListener('icegatheringstatechange',()=>{ if(pc.iceGatheringState==='complete'){ clearTimeout(t); res(); } }); });
      if(closed) return;
      const r=await api('voice',{sdp:pc.localDescription.sdp,facts:facts()});
      if(closed) return; // hung up while the session was being created; the server session times out unused
      pc.addEventListener('connectionstatechange',()=>console.log('[live] PC state:',pc.connectionState));
      pc.addEventListener('iceconnectionstatechange',()=>console.log('[live] ICE state:',pc.iceConnectionState));
      if(r.iceServers?.length){ console.log('[live] adding Azure ICE servers:',r.iceServers.length); try{ pc.setConfiguration({iceServers:r.iceServers}); }catch(e){ console.warn('[live] setConfiguration failed:',e.message); } }
      await pc.setRemoteDescription({type:'answer',sdp:r.sdp});
    }catch(e){ cleanup(); end('drop'); throw e; }
  })();
  return handle;
}

/* ---------- Customer Snapshot: who ---------- */
block({id:'cust',name:'Customer Snapshot',card:'Who it is about',group:'u',warm:.5,
 render(el){
  el.innerHTML=`<h1 class="q md">${words("Who are the customers you're thinking about?")}</h1>`;
  needs(el,'frame',()=>{
   el.insertAdjacentHTML('beforeend',`<div class="onecard fhost rise" style="--d:.5s"><span class="ot">${h(custText())}</span><span class="ftools">${tipI('regen',REGEN,'data-rg','','end')}${tipI('edit',EDIT,'data-ed','edit','end')}</span></div>${nextBtn('Looks right')}`);
   const card=$('.onecard',el), ot=$('.ot',card);
   $('[data-rg]',card).onclick=()=>busyOn(card,async()=>{
     const t=await regenText('customer',custText(),A.cust.alts.filter(x=>x!==custText()));
     A.cust.alts.push(t); A.cust.alt=A.cust.alts.length-1; A.cust.ed=null;
     ot.textContent=custText(); ot.classList.remove('swapin'); void ot.offsetWidth; ot.classList.add('swapin'); saveSoon(); });
   $('[data-ed]',card).onclick=()=>{ if(!ot.isContentEditable) editIn(ot,{box:card,at:$(':scope>.ftools',card),done:(x)=>{A.cust.ed=x; ot.textContent=custText();}}); };
   bindNext(el);
  });
 }});

/* ---------- What changes for them (multi-select, Jon 17 Sep) ---------- */
block({id:'custout',name:'What changes for them',card:'What changes',group:'u',warm:.7,
 skip(){A.custout.sel.length=0;},
 render(el){
  el.innerHTML=`<h1 class="q md">${words('If this works, what changes for them?')}</h1>`;
  needs(el,'frame',()=>{
   el.insertAdjacentHTML('beforeend',`<div class="lines"></div>${nextBtn('Next')}`);
   const m=A.custout;
   lines($('.lines',el),{
    items:coItems, nAI:3, addPh:'Add your own',
    onRegen:async(i)=>{ const t=await regenText('change',coItems()[i],coItems()); pushAlt(m,i,t); const k=m.sel.indexOf(i); if(k>-1) m.sel.splice(k,1); },
    onEdit:(i,x)=>{ if(i<3) m.ed[i]=x; else m.own[i-3]=x; },
    onAdd:(x)=>{ m.own.push(x); m.sel.push(2+m.own.length); },
    lead:(i)=>`<button class="check" type="button" data-tick="${i}" aria-pressed="${m.sel.includes(i)}" aria-label="Pick this one">${ic('check')}</button>`,
    bindLead:(ln,i,redraw)=>{ $('[data-tick]',ln).onclick=()=>{ const k=m.sel.indexOf(i); if(k>-1) m.sel.splice(k,1); else m.sel.push(i); redraw(); saveSoon(); }; }});
   bindNext(el);
  });
 }});

/* ---------- Confidence: an activity intro first (Jon, 21 Sep) ----------
   The sliders ask a different kind of question, so they get a heads-up. No card of its own, so the
   welcome ring doesn't count it twice. */
/* The groundwork prototype's activity intro: the ring of cards, one drawn, then the ask. */
/* wait: the stage the next screen needs. The button spins with its label until that's written, so the
   client reads the intro instead of watching a loading screen (Jon, 21 Sep). */
const intro=(id,{card,small,group,title,sub,wait})=>block({id,name:`${card} intro`,group,warm:.5,noSkip:true,
 render(el){
  el.classList.add('deckview');
  el.innerHTML=`<div class="deck" aria-hidden="true"><div class="ring">${ringCards()}</div></div>
   <div class="drawn" style="--bgc:${GC[group]}"><h2>${h(card)}</h2><small>${h(small)}</small></div>
   <h1 class="q md">${words(title)}</h1>
   <p class="sub rise" style="--d:1.1s">${h(sub)}</p>
   <div class="nextslot rise" style="--d:1.3s"><button class="gbtn primary" type="button" data-next>Let's go</button></div>`;
  bindNext(el);
  if(!wait||isReady(wait.stage)) return;
  const b=$('[data-next]',el), v=S.view;
  b.disabled=true; b.classList.add('working'); b.innerHTML=`<span class="spin" aria-hidden="true"></span>${h(wait.label)}`;
  // On failure it lets them through anyway: the next screen has its own "Try again".
  ensure(wait.stage).catch(()=>{}).finally(()=>{ if(S.view!==v||!el.isConnected) return;
    b.disabled=false; b.classList.remove('working'); b.textContent="Let's go"; });
 }});
intro('confintro',{card:'Hunch or fact?',small:'Three statements',group:'u',
 title:"Next, we'll ask how sure you are about a few things.",
 sub:'It helps us see what you already know, and what might need more research or care.'});

/* ---------- Confidence Sliders ---------- */
block({id:'conf',name:'Confidence',card:'Hunch or fact?',group:'u',warm:.4,steps:3,
 skip(s){A.conf.val[s]=null;},
 render(el,s){
  // The eyebrow stays on every statement, so the question never goes missing (Jon, 21 Sep).
  el.innerHTML=`<p class="eyebrow${s===0?' rise':''}" style="--d:.05s">How sure are you of this? <span class="of">${s+1} of 3</span></p>`;
  needs(el,'frame',()=>{
   A.conf.seen[s]=true; if(A.conf.val[s]==null) A.conf.val[s]=50;
   el.insertAdjacentHTML('beforeend',`<h1 class="q"><span class="qt">${words(confText(s))}</span>${qtools()}</h1>
    <div class="shost rise" style="--d:.7s"></div>
    ${nextBtn('Next')}`);
   const sh=$('.shost',el);
   const draw=()=>gslider(sh,{value:A.conf.val[s],label:confText(s),fresh:!A.conf.touched[s],
     onChange:(v)=>{A.conf.val[s]=v; A.conf.touched[s]=true;}});
   bindQ(el,{get:()=>confText(s),set:(t)=>{A.conf.ed[s]=t; saveSoon();},regen:async()=>{
     const t=await regenText('confidence',confText(s),[0,1,2].map(confText));
     pushAlt(A.conf,s,t); A.conf.val[s]=50; A.conf.touched[s]=false; draw(); saveSoon(); }});
   draw(); bindNext(el);
  });
 }});

/* ---------- How Might We: pick one of three (Jon, 17 Sep) ---------- */
block({id:'hmw',name:'How Might We',card:'The challenge',group:'f',warm:.6,
 render(el){
  el.innerHTML=`<h1 class="q md">${words('Which best represents your challenge?')}</h1>`;
  needs(el,'question',()=>{
   el.insertAdjacentHTML('beforeend',`<div class="triohost"></div>${nextBtn('Next')}`);
   const nb=$('[data-next]',el);
   trio($('.triohost',el),A.hmw,hmwOpt,()=>{nb.disabled=A.hmw.sel==null;},
     async(i)=>{ const t=await regenText('hmw',A.hmw.ed[i]??hmwOpt(i),[0,1,2].map(k=>A.hmw.ed[k]??hmwOpt(k))); pushAlt(A.hmw,i,t); });
   bindNext(el);
  });
 }});

/* ---------- Business value: pick three, mark the highest priority ---------- */
block({id:'win',name:'Business value',card:'Business value',group:'f',warm:.75,
 // Emptied in place, never reassigned: pills() holds this array by reference.
 skip(){A.win.sel.length=0; A.win.flag=-1;},
 render(el){
  el.innerHTML=`<h1 class="q md">${words('What would solving this create for your business? Pick your top three.')}</h1>`;
  needs(el,'question',()=>{
   const w=A.win;
   el.insertAdjacentHTML('beforeend',`<p class="sub rise" style="--d:1s">Then flag the most important business value <span class="flagi" aria-hidden="true">${ic('flag')}</span></p><div class="pills"></div>${nextBtn('Next')}`);
   const nb=$('[data-next]',el), owes=()=>w.sel.length>0&&w.flag<0;
   const pl=pills($('.pills',el),{onChange:()=>nb.classList.toggle('owes',owes()),
    items:winItems, sel:w.sel, max:3, nAI:6, addPh:'Add your own',
    big:{label:'Top business value', ask:'Select the most important business value', get:()=>w.flag, set:(i)=>{w.flag=i;}},
    onRegen:async(i)=>{ const t=await regenText('businessValue',winItems()[i],winItems()); pushAlt(w,i,t); const k=w.sel.indexOf(i); if(k>-1) w.sel.splice(k,1); if(w.flag===i) w.flag=-1; },
    onEdit:(i,x)=>{ if(i<6) w.ed[i]=x; else w.own[i-6]=x; },
    onAdd:(x)=>{ w.own.push(x); if(w.sel.length<3) w.sel.push(5+w.own.length); }});
   // Started answering means finish it: picks need a priority before Next. Skip still leaves blank.
   bindNext(el); nb.onclick=()=>owes()?pl.nudge():next();
  });
 }});

intro('pressintro',{card:'Front page',small:'Two years from now',group:'f',
 title:"Let's jump ahead two years. It worked.",
 sub:"We're writing the news story about your priority coming true. Change any line that doesn't sound right.",
 wait:{stage:'story',label:'Writing your story…'}});

/* ---------- The story: one article off the back of what winning looks like ---------- */
const pressT=(k)=>{const s=story(); return A.press.ed[k]??[s?.headline,s?.body,s?.quote][k]??'';};
block({id:'press',name:'Future Press Release',card:'The day it works',group:'f',warm:.85,
 render(el){
  const when=()=>story()?.when||'Two years from now';
  el.innerHTML=`<h1 class="q md pressbold">${words(isReady('story')?`${when()}. It worked. Here's the story.`:"It worked. Here's the story.")}</h1><p class="sub rise" style="--d:.6s;margin-top:calc(clamp(18px,3.4vh,38px) * -0.7)">Click any line to rewrite it, or regenerate the whole thing.</p>`;
  needs(el,'story',()=>{
   const s=story();
   el.insertAdjacentHTML('beforeend',`<div class="flipper rise" style="--d:.5s"><article class="clip fhost">
    <div class="dl"><span>${h(s.dateline)}</span></div>
    <div class="ctl ftools">${tipI('regen',REGEN,'data-prg','','end')}${tipI('edit',EDIT,'data-ped','edit','end')}</div>
    <h2 data-k="0" aria-label="Headline">${h(pressT(0))}</h2>
    <div class="photo" style="background-image:${photoBg()}" role="img" aria-label="A photograph to go with the story"></div>
    <p data-k="1" aria-label="Story">${h(pressT(1))}</p>
    <p class="quote"><span data-k="2" aria-label="Quote">${h(pressT(2))}</span><span class="by">${h(s.attribution)}, ${h(BRIEF.client)}</span></p>
   </article></div>
   ${nextBtn('Next')}`);
   const edK=(x)=>{ if(x.isContentEditable) return; editIn(x,{box:x,at:$('.clip .ctl',el),multi:x.dataset.k==='1',done:(t)=>{A.press.ed[+x.dataset.k]=t;}}); };
   $$('[data-k]',el).forEach(x=>{x.tabIndex=0; x.addEventListener('click',()=>edK(x)); x.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!x.isContentEditable){e.preventDefault(); edK(x);}});});
   $('[data-prg]',el).onclick=()=>busyOn($('.clip',el),async()=>{
     const r=await api('gen/story',{facts:facts()});
     A.press.alts.push(r); A.press.alt=A.press.alts.length-1; A.press.ed={}; preload(r.image);
     $$('[data-k]',el).forEach(x=>{x.textContent=pressT(+x.dataset.k); x.classList.remove('swap'); void x.offsetWidth; x.classList.add('swap');});
     $('.clip .dl span',el).textContent=r.dateline; $('.clip .by',el).textContent=`${r.attribution}, ${BRIEF.client}`; $('.clip .photo',el).style.backgroundImage=photoBg(); saveSoon(); });
   $('[data-ped]',el).onclick=()=>edK($('h2[data-k]',el));
   bindNext(el);
  });
 }});

/* ---------- Worth roughly: the only number in the brief, so it gets a screen (Jon, 18 Sep) ---------- */

/* ---------- Concerns, on a dark card (Jon, 18 Sep) ---------- */
block({id:'concerns',name:'Concerns',card:'What worries you',group:'f',warm:.35,
 skip(){A.con.sel.length=0; A.con.flag=-1;},
 render(el){
  el.classList.add('pm-dark');
  el.innerHTML=`<p class="eyebrow rise" style="--d:.05s">That was the north star. Now the pessimistic bit.</p>
   <h1 class="q md">${words('What worries you most about getting there?')}</h1>`;
  needs(el,'question',()=>{
   const c=A.con;
   el.insertAdjacentHTML('beforeend',`<p class="sub rise" style="--d:1s">Tick what applies. Mark the biggest.</p><div class="pills"></div>${nextBtn('Next')}`);
   pills($('.pills',el),{
    items:conItems, sel:c.sel, max:99, nAI:4, addPh:'Add your own',
    big:{label:'Biggest concern', get:()=>c.flag, set:(i)=>{c.flag=i;}},
    onRegen:async(i)=>{ const t=await regenText('concern',conItems()[i],conItems()); pushAlt(c,i,t); const k=c.sel.indexOf(i); if(k>-1) c.sel.splice(k,1); if(c.flag===i) c.flag=-1; },
    onEdit:(i,x)=>{ if(i<4) c.ed[i]=x; else c.own[i-4]=x; },
    onAdd:(x)=>{ c.own.push(x); c.sel.push(3+c.own.length); }});
   bindNext(el);
  });
 }});

intro('teasersintro',{card:'Early ideas',small:'Four concepts',group:'e',
 title:"Thanks for all that. We've sketched a few early ideas from what you've told us.",
 sub:"They're not proposals, just a way to find out what you're drawn to. Tell us what feels right and what doesn't."});

/* ---------- Early directions: a real card deck (prototype) ---------- */
let tKeys=null;
block({id:'teasers',name:'Early directions',card:'Early ideas',group:'e',warm:.65,steps:4,
 skip(s){A.tr.r[s]=-1;},
 leave(){ if(tKeys){ document.removeEventListener('keydown',tKeys); tKeys=null; } },
 render(el,s){
  el.innerHTML=`<p class="eyebrow rise" style="--d:.05s">${s+1} of 4</p>`;
  needs(el,'directions',()=>teaserDeck(el,s));
 }});
function teaserDeck(el,s){
  const cardHTML=(i,cls)=>{const t=teaser(i); return `<div class="tcard ${cls}${t.image?'':' noart'}" data-t="${i}" style="background-image:${teaserBg(i)}">${cls?'':'<span class="stamp s0" aria-hidden="true">Love it</span><span class="stamp s1" aria-hidden="true">Maybe</span><span class="stamp s2" aria-hidden="true">Not for us</span>'}<div class="cap"><h2>${h(t.title)}</h2><p>${h(t.line)}</p></div></div>`;};
  const backs=[s+2,s+1].filter(i=>i<4);
  el.insertAdjacentHTML('beforeend',`<div class="stack fhost rise" style="--d:.4s">${backs.map(i=>cardHTML(i,i===s+1?'back1':'back2')).join('')}${cardHTML(s,'')}<span class="ftools">${tipI('regen',REGEN,'data-trg','','end')}${tipI('edit',EDIT,'data-ted','edit','end')}</span></div>
   <div class="row teaserbtns rise" style="--d:.8s">${[[2,'Not for us','←'],[1,'Maybe','↓'],[0,'Love it','→']].map(([k,l,a])=>`<button class="gbtn${k===0?' primary':''}" type="button" data-r="${k}" aria-pressed="false">${k===2?`<span class="dir" aria-hidden="true">${a}</span>`:''}${l}${k!==2?`<span class="dir" aria-hidden="true">${a}</span>`:''}</button>`).join('')}</div>
   <div class="row rise" style="--d:1s"><button class="gbtn ghost" type="button" data-own>${A.tr.own.length?`Added (${A.tr.own.length}). Add another`:'Add your own'}</button>${skipB('gbtn ghost')}</div>`);
  const stack=$('.stack',el), eyebrow=$('.eyebrow',el), btns=$$('[data-r]',el);
  // Everything below rebinds to whichever card is on top, so promotion needs no re-render.
  const bind=(step)=>{
   const top=$('.tcard:not(.back1):not(.back2)',stack);
   if(!top) return;
   btns.forEach(b=>b.setAttribute('aria-pressed',String(A.tr.r[step]===+b.dataset.r)));
   $('[data-trg]',el).onclick=()=>busyOn(top,async()=>{
     const r=await api('gen/regen',{kind:'direction',current:tTitle(step),others:[0,1,2,3].filter(k=>k!==step).map(tTitle),facts:facts()});
     pushAlt(A.tr,step,r); A.tr.r[step]=-1; preload(r.image); top.classList.toggle('noart',!r.image);
     const t=teaser(step); top.style.backgroundImage=teaserBg(step); $('h2',top).textContent=t.title; $('p',top).textContent=t.line; top.classList.remove('swap'); void top.offsetWidth; top.classList.add('swap'); saveSoon(); });
   $('[data-ted]',el).onclick=()=>{
     const cap=$('.cap',top); if(cap.isContentEditable) return;
     editIn(cap,{box:top,at:$('.stack>.ftools',el),done:()=>{
       const tt=($('h2',cap)?.innerText||'').trim()||teaser(step).title, d=($('p',cap)?.innerText||'').trim();
       A.tr.ed[step]={title:tt,line:d}; cap.innerHTML=`<h2>${h(tt)}</h2><p>${h(d)}</p>`;}});
   };
   let gone=false, drag=null;
   const commit=async(k)=>{
     if(gone||top.classList.contains('edit-box')||top.classList.contains('regening')) return; gone=true;
     A.tr.r[step]=k; saveSoon(); stack.classList.remove('pulling'); top.classList.remove('dragging'); top.style.transform='';
     top.classList.add(['go-0','go-1','go-2'][k]); setWarm([.95,.6,.3][k]);
     if(step>=3){ await wait(RM?80:520); return next(); }
     await wait(RM?40:300);
     if(!stepInPlace()){ await wait(200); return next(); }
     top.remove();
     const b1=$('.tcard.back1',stack), b2=$('.tcard.back2',stack);
     if(b1){ b1.classList.remove('back1'); b1.innerHTML=`<span class="stamp s0" aria-hidden="true">Love it</span><span class="stamp s1" aria-hidden="true">Maybe</span><span class="stamp s2" aria-hidden="true">Not for us</span>`+b1.innerHTML; }
     if(b2) b2.classList.replace('back2','back1');
     const nb=step+3;
     if(nb<4){ stack.insertAdjacentHTML('afterbegin',cardHTML(nb,'back2')); }
     eyebrow.textContent=`${step+2} of 4`;
     bind(step+1);
   };
   btns.forEach(b=>b.onclick=()=>commit(+b.dataset.r));
   const lean=(dx,dy)=>Math.abs(dx)>=Math.abs(dy)?(dx>0?0:2):(dy>0?1:-1);
   const show=(k,amt)=>{ $$('.stamp',top).forEach((st,j)=>st.style.opacity=j===k?amt:0); btns.forEach(b=>b.classList.toggle('lean',+b.dataset.r===k&&amt>.4)); stack.style.setProperty('--pull',k<0?0:Math.min(1,amt)); };
   top.onpointerdown=(e)=>{
     if(gone||e.button>0||e.target.closest('.ftools')||top.classList.contains('edit-box')) return;
     try{ top.setPointerCapture(e.pointerId); }catch{}
     drag={x:e.clientX,y:e.clientY,t:performance.now(),dx:0,dy:0}; top.classList.add('dragging'); stack.classList.add('pulling');
   };
   top.onpointermove=(e)=>{
     if(!drag) return;
     drag.dx=e.clientX-drag.x; drag.dy=e.clientY-drag.y;
     const w=top.offsetWidth, rot=RM?0:clamp(drag.dx/w*24,-12,12), k=lean(drag.dx,drag.dy);
     top.style.transform=`translate(${drag.dx}px,${drag.dy}px) rotate(${rot}deg)`;
     show(k,k<0?0:clamp(Math.hypot(drag.dx,drag.dy)/(w*.3),0,1));
   };
   const release=()=>{
     if(!drag) return; const d=drag; drag=null;
     const w=top.offsetWidth, dist=Math.hypot(d.dx,d.dy), k=lean(d.dx,d.dy);
     const far=Math.abs(k===1?d.dy:d.dx)>w*.3, flick=dist>40&&dist/Math.max(16,performance.now()-d.t)>.7;
     if(k>-1&&(far||flick)) return commit(k);
     stack.classList.remove('pulling'); top.classList.remove('dragging'); top.classList.add('springback'); top.style.transform=''; show(-1,0);
     setTimeout(()=>top.classList.remove('springback'),600);
   };
   top.onpointerup=release; top.onpointercancel=release;
   if(tKeys) document.removeEventListener('keydown',tKeys);
   tKeys=(e)=>{ if(e.target.closest?.('input,textarea,[contenteditable="true"]')) return; const k={ArrowRight:0,ArrowDown:1,ArrowLeft:2}[e.key]; if(k==null) return; e.preventDefault(); commit(k); };
   document.addEventListener('keydown',tKeys);
  };
  bind(s);
  $('[data-own]',el).onclick=()=>{
    const row=$('[data-own]',el).parentElement;
    row.innerHTML=`<div class="ownin"><input type="text" placeholder="Name it in a few words" aria-label="Your own direction"><button class="gbtn" type="button">Add</button></div>`;
    const inp=$('input',row); inp.focus();
    const add=()=>{const tt=inp.value.trim(); if(!tt) return; A.tr.own.push(tt); inp.value=''; inp.placeholder='Added. Another?'; saveSoon();};
    $('button',row).onclick=add; inp.onkeydown=(e)=>{if(e.key==='Enter') add();};
  };
}

/* ---------- Anything else (Jon, 17 Sep: replaced the Constraint Check) ---------- */
block({id:'anything',name:'Anything else',card:'Anything else',group:'w',warm:.5,
 skip(){A.more.text='';},
 render(el){
  el.innerHTML=`<h1 class="q md">${words('Anything else we should know?')}</h1>
   <div class="composer small rise" style="--d:.5s"><div class="field" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Anything else we should know" data-ph="Anything immovable? A platform you can't touch, a decision already made, a date you're working to."></div></div>
   ${nextBtn('Next')}`;
  const f=$('.field',el);
  f.textContent=A.more.text;
  f.oninput=()=>{A.more.text=f.innerText;};
  bindNext(el);
 }});

/* ---------- Invite someone else (Jon, 17 Sep) ---------- */
block({id:'team',name:'Invite someone else',card:'Another point of view',group:'w',warm:.55,
 skip(){A.invite.people=[{name:'',email:''}];},
 render(el){
  const P=A.invite.people;
  el.innerHTML=`<h1 class="q md">${words('Should someone else on your team answer these too?')}</h1>
   <p class="sub wide rise" style="--d:1s">Different perspectives are the useful part. We'll send them their own link, and you\'ll see where you disagree.</p>
   <div class="people rise" style="--d:1.2s"></div>
   ${nextBtn('Next')}`;
  const host=$('.people',el);
  const draw=(focus)=>{
   host.innerHTML=P.map((p,i)=>`<div class="prow" data-i="${i}"><input class="pname" type="text" value="${h(p.name)}" placeholder="Name" aria-label="Name"><input class="pmail" type="email" value="${h(p.email)}" placeholder="Email" aria-label="Email">${P.length>1?tipI('x','Remove',`data-rm="${i}"`,'','end'):''}</div>`).join('')
    +`<button class="gbtn ghost addp" type="button" data-addp>Add another person</button>`;
   $$('.prow',host).forEach(row=>{
    const i=+row.dataset.i;
    $('.pname',row).oninput=(e)=>{P[i].name=e.target.value;};
    $('.pmail',row).oninput=(e)=>{P[i].email=e.target.value;};
    $('[data-rm]',row)?.addEventListener('click',()=>{P.splice(i,1); draw(); saveSoon();});
   });
   $('[data-addp]',host).onclick=()=>{P.push({name:'',email:''}); draw(P.length-1);};
   if(focus!=null) $(`.prow[data-i="${focus}"] .pname`,host)?.focus();
  };
  draw(); bindNext(el);
 }});

/* ---------- Ending: the brief as a constellation (prototype) ---------- */
function drawSky(){
  const sv=$('#sky'), W=innerWidth, H=innerHeight;
  const n=Math.max(16,A.conf.val.filter(v=>v!=null).length+A.win.sel.length+A.con.sel.length+A.tr.r.filter(r=>r>-1).length+A.custout.sel.length+A.docs.files.length+(A.dump.text?2:0)+Math.min(8,A.dump.msgs.length));
  const pts=[];
  for(let i=0;i<n;i++){const a=i*2.39996+.5, rr=.8+((i*37)%23)/23*.18; pts.push([W/2+Math.cos(a)*W*.47*rr,H/2+Math.sin(a)*H*.45*rr,Math.atan2(Math.sin(a)*H,Math.cos(a)*W)]);}
  pts.sort((a,b)=>a[2]-b[2]);
  const ln=pts.map((p,i)=>{const q=pts[(i+1)%n]; return `<line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}" style="--dl:${(i*.09+.3).toFixed(2)}s"/>`;}).join('');
  const st=pts.map((p,i)=>{const big=i%4===0; return `<circle class="glow" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${big?16:10}" style="--dl:${(i*.09).toFixed(2)}s"/><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${big?4:2.6}" style="--dl:${(i*.09).toFixed(2)}s"/>`;}).join('');
  sv.setAttribute('viewBox',`0 0 ${W} ${H}`); sv.innerHTML=ln+st;
}
addEventListener('resize',()=>{ if(!$('#sky').hasAttribute('hidden')) drawSky(); });
block({id:'end',name:'Playback',card:'Everything we heard',group:'end',warm:.8,noSkip:true,
 render(el){
  const know=[],guess=[];
  if(A.gen.frame) A.conf.val.forEach((v,i)=>{ if(v==null||!(A.conf.seen[i]||A.conf.touched[i])) return; if(band(v)===2) know.push(confText(i)); else if(band(v)===0) guess.push(confText(i)); });
  const worry=A.gen.question?conFlagged():null, wf=A.gen.question?winFlagged():null;
  const pcard=(i,title,list)=>`<div class="pcard rise" style="--d:${(.72+i*.12).toFixed(2)}s"><span class="plabel">${h(title)}</span>${list.length?`<ul>${list.slice(0,3).map(x=>`<li>${h(clip(x,92))}</li>`).join('')}</ul>`:'<p class="none">Skipped. We\'ll ask on the call.</p>'}</div>`;
  el.innerHTML=`<h1 class="q md">${words("Here's what we heard.")}</h1>
   <div class="pback">
    <div class="phero rise" style="--d:.5s"><span class="plabel">The challenge</span><p>${A.hmw.sel==null?"You skipped this one, so we'll land on it together on the call.":h(hmwText())}</p></div>
    <div class="pgrid">
     ${pcard(0,wf?'Highest business value':'Business value',wf?[wf]:(A.gen.question?winPicked():[]))}
     ${pcard(1,'What you know',know)}
     ${pcard(2,"What you're guessing",guess)}
     ${pcard(3,worry?'Your biggest worry':'What worries you',worry?[worry]:(A.gen.question?conPicked():[]))}
    </div>
   </div>
   ${nextBtn('Complete brief','<button class="gbtn ghost" type="button" data-back>Change something</button>')}`;
  $('[data-back]',el).onclick=back;
  const nb=$('[data-next]',el);
  nb.onclick=async()=>{
    nb.disabled=true; nb.textContent='Finishing…';
    try{ clearTimeout(saveT); await api('send',{answers:A,facts:facts()}); locked=true; next(); }
    catch(e){ nb.disabled=false; nb.textContent='Complete brief'; toast('Something went wrong. Check your connection and try again.'); }
  };
  drawSky();
 }});
block({id:'sent',name:'Sent',group:'end',warm:1,noSkip:true,
 render(el){
  el.innerHTML=`<h1 class="q">${words("That's everything we need.")}</h1>
   <p class="sub rise" style="--d:1s">We'll be in touch within two working days.</p>
   <div class="endcards rise" style="--d:1.2s">
    <div class="ecard"><h3>Your team pack</h3><p>A deck you can take to your own team.</p><div class="ebtns"><button class="gbtn primary" type="button" data-dl>Download</button><a class="gbtn" href="/b/${h(BID)}/pack" target="_blank" rel="noopener">View</a></div></div>
    <div class="ecard"><h3>Your innovation brief</h3><p>Sent to Digital Labs.</p><span class="donechip">${ic('check')}Sent</span></div>
   </div>
   ${BRIEF.personId?'<div class="nextslot rise" style="--d:1.8s"><button class="gbtn ghost" type="button" data-again>Start a new brief</button></div>':''}
   <p class="hint dlnote" aria-live="polite"></p>`;
  const dl=$('[data-dl]',el), note=$('.dlnote',el);
  dl.onclick=async()=>{
    if(dl.disabled) return;
    const label=dl.textContent; dl.disabled=true; dl.textContent='Preparing…'; note.textContent='';
    try{
      const r=await fetch(`/b/${BID}/pack.pdf?dl=1`);
      if(r.status===501){ window.open(`/b/${BID}/pack`,'_blank','noopener'); return; }
      if(!r.ok) throw new Error();
      const a=document.createElement('a'); a.href=URL.createObjectURL(await r.blob()); a.download=`${BRIEF.client} team pack.pdf`; document.body.append(a); a.click(); a.remove();
    }catch{ note.textContent="The pack isn't quite ready. Try again in a moment."; }
    finally{ dl.disabled=false; dl.textContent=label; }
  };
  const again=$('[data-again]',el);
  if(again) again.onclick=async()=>{
    again.disabled=true; again.textContent='Creating\u2026';
    try{
      const r=await api('again',{});
      if(r.id) location.href='/b/'+r.id;
    }catch(e){ note.textContent=e.message||'Could not start a new brief.'; again.disabled=false; again.textContent='Start a new brief'; }
  };
  drawSky();
 }});

/* ---------- small global behaviour ---------- */
document.addEventListener('input',saveSoon);
addEventListener('pagehide',()=>saveState(true));
document.addEventListener('visibilitychange',()=>{ if(document.hidden) saveState(true); });
document.addEventListener('click',(e)=>{ if(e.target.closest('[data-skip]')) skip(); });
addEventListener('resize',()=>$$('.q.fhost').forEach(placeQT));
document.addEventListener('click',(e)=>{ if(!e.target.closest('.tipw')) $$('.tipw.open').forEach(x=>x.classList.remove('open')); });
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') $$('.tipw.open').forEach(x=>x.classList.remove('open')); });

/* ---------- boot ---------- */
const ALIAS={confidence:'conf',howsure:'confintro',concepts:'teasersintro',storyintro:'pressintro',customer:'cust',outcome:'custout',winning:'win',story:'press',article:'press',worries:'concerns',teaser:'teasers',anythingelse:'anything',invite:'team',playback:'end',ending:'end',chat:'dump'};
function jumpTo(id,step){
  let c='welcome';
  for(let g=0;c!==id&&g<20;g++){
    for(let k=0;k<stepsOf(c);k++) S.hist.push({b:c,s:k});
    const n=planNext(c); if(!n) break;
    S.plan.push(n.id); c=n.id;
  }
  const st=clamp(step,0,stepsOf(id)-1); for(let k=0;k<st;k++) S.hist.push({b:id,s:k}); S.view={b:id,s:st};
  render();
}
function merge(saved){
  for(const k of Object.keys(A)){
    const v=saved?.[k]; if(v==null||typeof v!=='object') continue;
    if(Array.isArray(A[k])) A[k]=v; else Object.assign(A[k],v);
  }
}
(async function boot(){
  try{ [BRIEF,CFG]=await Promise.all([api(''),fetch('/api/config').then(r=>r.json())]); }
  catch(e){
    stage.innerHTML=`<section class="view"><h1 class="q md">This link isn't working.</h1><p class="sub">${h(e.message)}. If you were sent it by Digital Labs, let them know and they'll send a fresh one.</p></section>`;
    return;
  }
  $('#clientName').textContent=BRIEF.client; document.title=`Innovation Brief · ${BRIEF.client}`;
  if(BRIEF.answers) merge(BRIEF.answers);
  // The server holds the documents; the page only holds their names.
  A.docs.files=BRIEF.docs.map(d=>({id:d.id,name:d.name,size:d.size}));
  if(A.docs.files.length&&!A.docs.list&&BRIEF.findings) A.docs.list=BRIEF.findings.slice();
  [A.press.alts[A.press.alt]?.image,...A.tr.alts.map((a,i)=>cur(A.tr,i)?.image)].forEach(preload);
  if(BRIEF.status==='sent'){ locked=true; S.view={b:'sent',s:0}; render(); return; }
  const p=new URLSearchParams(location.search).get('view')||A.meta.view;
  if(p){
    const m=p.toLowerCase().replace(/-/g,' ').trim().match(/^([a-z ]+?)(?: (\d+))?$/);
    if(m){
      let id=m[1].replace(/ /g,''), st=m[2];
      if(id==='docsupload'){ id='docs'; A.docs.open=true; }
      if(ALIAS[id]) id=ALIAS[id];
      if(BL[id]&&id!=='sent') return jumpTo(id,(+st||1)-1);
    }
  }
  S.view={b:'welcome',s:0}; render();
})();
