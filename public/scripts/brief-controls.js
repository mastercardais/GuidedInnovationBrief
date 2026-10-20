function editIn(t,o={}){
  const view=t.closest('.view'), box=o.box||t, ta=t.tagName==='TEXTAREA';
  const val=()=>ta?t.value:t.innerText, orig=ta?t.value:t.innerHTML;
  const ctl=document.createElement('span'); ctl.className='edit-ctl';
  ctl.innerHTML=tipI('check','Done','data-edone','','end')+tipI('x','Cancel','data-ecancel','','end');
  if(o.after) t.after(ctl); else (o.at||box).append(ctl);
  if(!ta) t.contentEditable='true';
  t.classList.remove('saved'); t.classList.add('editing'); box.classList.add('edit-box'); view?.classList.add('is-editing');
  if(box!==t&&box.matches('.ocard,.tcard,.pill,.onecard')) t.classList.add('in-box');
  t.focus({preventScroll:true});
  if(view?.classList.contains('scrolls')) requestAnimationFrame(()=>box.scrollIntoView({block:'nearest',behavior:RM?'auto':'smooth'}));
  if(ta) t.setSelectionRange(t.value.length,t.value.length);
  else { const r=document.createRange(); r.selectNodeContents(t); r.collapse(false); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  let fin=false;
  const end=(save)=>{
    if(fin) return; fin=true;
    const txt=val().replace(/[ \t]+\n/g,'\n').trim(), ok=save&&!!txt;
    if(!ok){ if(ta) t.value=orig; else t.innerHTML=orig; }
    if(!ta) t.contentEditable='false';
    t.classList.remove('editing','in-box'); box.classList.remove('edit-box'); view?.classList.remove('is-editing'); ctl.remove();
    t.onkeydown=null; t.onblur=null;
    if(ok) o.done?.(txt); else o.cancel?.();
    if(ok&&t.isConnected){ void t.offsetWidth; t.classList.add('saved'); }
    saveSoon();
  };
  $$('button',ctl).forEach(b=>b.onpointerdown=(e)=>e.preventDefault());
  $('[data-edone]',ctl).onclick=()=>end(true);
  $('[data-ecancel]',ctl).onclick=()=>end(false);
  t.onkeydown=(e)=>{ if(e.key==='Enter'&&!(o.multi&&e.shiftKey)){e.preventDefault(); end(true);} else if(e.key==='Escape'){e.preventDefault(); e.stopPropagation(); end(false);} };
  t.onblur=()=>setTimeout(()=>{ if(!fin&&document.activeElement!==t&&!ctl.contains(document.activeElement)) end(true); },0);
  return end;
}
function placeQT(q){
  const qt=$('.qt',q), tl=$(':scope>.ftools',q); if(!qt||!tl||!q.isConnected) return;
  const r=document.createRange(); r.selectNodeContents(qt);
  const rs=[...r.getClientRects()].filter(x=>x.width>0); if(!rs.length) return;
  const qr=q.getBoundingClientRect(), w=tl.offsetWidth||76;
  let x=Math.max(...rs.map(x=>x.right))-qr.left+6, y=Math.min(...rs.map(x=>x.top))-qr.top-24;
  const lim=Math.min(qr.width+40,innerWidth-qr.left-10)-w;
  if(x>lim) x=Math.max(0,lim);
  tl.style.left=x+'px'; tl.style.top=y+'px';
}
/* three AI-written options as cards: pick one, regenerate or edit any, or write your own.
   m: {sel, alt:[3], ed:{}, own}; opt(i) is AI card i's current text; regen(i) fetches a new one. */
function trio(host,m,opt,onChange,regen){
  const txt=(i)=>i==='own'?m.own:(m.ed[i]??opt(i));
  const card=(i)=>{const on=m.sel===i; return `<div class="ocard fhost${on?' on':''}" data-o="${i}" style="--i:${i==='own'?3:i}"><div class="opick" role="button" tabindex="0" aria-pressed="${on}"><span class="ot">${h(txt(i)??'')}</span></div><span class="ock" aria-hidden="true">${ic('check')}</span><span class="ftools">${i==='own'?'':tipI('regen',REGEN,'data-org','','end')}${tipI('edit',EDIT,'data-oed','edit','end')}</span></div>`;};
  const mark=()=>{ $$('.ocard',host).forEach(c=>{const on=String(m.sel)===c.dataset.o; c.classList.toggle('on',on); $('.opick',c).setAttribute('aria-pressed',on);}); $('.trio',host)?.classList.toggle('has-pick',m.sel!=null); onChange?.(); saveSoon(); };
  const edit=(c,i,fresh)=>{
    m.sel=i; mark();
    const ot=$('.ot',c);
    editIn(ot,{box:c,at:$(':scope>.ftools',c),
      done:(t)=>{ if(i==='own') m.own=t; else m.ed[i]=t; ot.textContent=t; mark(); },
      cancel:()=>{ if(fresh){ m.own=null; if(m.sel==='own') m.sel=null; draw(); } }});
  };
  const draw=(enter)=>{
    const ids=[0,1,2].concat(m.own!=null?['own']:[]);
    host.innerHTML=`<div class="trio${enter?' enter':''}${m.sel!=null?' has-pick':''}" style="--n:${ids.length}">${ids.map(card).join('')}</div>${m.own==null?'<button class="gbtn ghost wown" type="button" data-wown>Write your own</button>':''}`;
    $$('.ocard',host).forEach(c=>{
      const i=c.dataset.o==='own'?'own':+c.dataset.o, pk=$('.opick',c);
      const choose=()=>{ if(c.classList.contains('edit-box')||c.classList.contains('regening')) return; m.sel=i; mark(); };
      pk.onclick=choose;
      pk.onkeydown=(e)=>{ if(c.classList.contains('edit-box')) return; if(e.key==='Enter'||e.key===' '){e.preventDefault(); choose();} };
      $('[data-org]',c)?.addEventListener('click',()=>busyOn(c,async()=>{ await regen(i); const ot=$('.ot',c); ot.textContent=txt(i); ot.classList.remove('swapin'); void ot.offsetWidth; ot.classList.add('swapin'); mark(); }));
      $('[data-oed]',c).addEventListener('click',()=>{ if(!$('.ot',c).isContentEditable) edit(c,i,false); });
    });
    $('[data-wown]',host)?.addEventListener('click',()=>{ m.own=''; draw(); edit($('.ocard[data-o="own"]',host),'own',true); });
    onChange?.();
  };
  draw(true); setTimeout(()=>$('.trio',host)?.classList.remove('enter'),1500);
}
// an AI-written question you can regenerate or edit in place
function bindQ(el,{get,set,regen}){
  const qt=$('.qt',el), q=qt.closest('.q'), place=()=>placeQT(q);
  q.classList.add('fhost'); requestAnimationFrame(place); setTimeout(place,1300);
  qt.addEventListener('input',place);
  $('[data-qrg]',el)?.addEventListener('click',()=>busyOn(q,async()=>{ await regen(); qt.innerHTML=words(get()); requestAnimationFrame(place); setTimeout(place,1300); }));
  $('[data-qed]',el)?.addEventListener('click',()=>{
    if(qt.isContentEditable) return;
    qt.textContent=get();
    editIn(qt,{box:q,at:$(':scope>.ftools',q),done:(t)=>{set(t); qt.textContent=get(); place();}});
  });
}

/* glass slider (prototype) */
const vt=(v)=>`${MARKS[band(v)][0]}, ${Math.round(v)} out of 100`;
function gslider(host,{value,label,onChange,fresh}){
  host.innerHTML=`<div class="gslider${value==null?' unset':''}${fresh?' fresh':''}" style="--v:${value??50}">
   <div class="track" role="slider" tabindex="0" aria-label="${h(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value??50)}" aria-valuetext="${value==null?'Not answered':vt(value)}"><div class="fill"></div><div class="knob"></div></div>
   <div class="marks">${MARKS.map(([m,t],k)=>`<span class="mark${value!=null&&band(value)===k?' on':''}">${h(m)}<span class="tipw"><button class="info" type="button" aria-label="${h(m)}: ${h(t)}">i</button><span class="tip ${k===0?'start':k===2?'end':''}" aria-hidden="true"><b>${h(m)}</b>${h(t)}</span></span></span>`).join('')}</div></div>`;
  const g=$('.gslider',host), tr=$('.track',host);
  let v=value;
  const set=(nv)=>{
    v=clamp(nv,0,100); g.classList.remove('unset','fresh'); g.style.setProperty('--v',v);
    tr.setAttribute('aria-valuenow',Math.round(v)); tr.setAttribute('aria-valuetext',vt(v));
    $$('.mark',g).forEach((m,k)=>m.classList.toggle('on',band(v)===k));
    setWarm(.12+v/100*.88); onChange(v);
  };
  const fromX=(x)=>{const r=tr.getBoundingClientRect(); return (x-r.left-32)/(r.width-64)*100;};
  tr.onpointerdown=(e)=>{tr.setPointerCapture(e.pointerId); set(fromX(e.clientX));};
  tr.onpointermove=(e)=>{if(!tr.hasPointerCapture(e.pointerId)) return; g.classList.add('drag'); set(fromX(e.clientX));};
  tr.onpointerup=tr.onpointercancel=()=>{ g.classList.remove('drag'); saveSoon(); };
  tr.onkeydown=(e)=>{
    const st=e.shiftKey?10:2, d={ArrowLeft:-st,ArrowDown:-st,ArrowRight:st,ArrowUp:st,PageDown:-10,PageUp:10}[e.key];
    if(d!=null){e.preventDefault(); set((v??50)+d);}
    else if(e.key==='Home'){e.preventDefault(); set(0);}
    else if(e.key==='End'){e.preventDefault(); set(100);}
  };
  $$('.info',g).forEach(b=>b.onclick=(e)=>{e.stopPropagation(); const w=b.parentElement, was=w.classList.contains('open'); $$('.tipw.open').forEach(x=>x.classList.remove('open')); w.classList.toggle('open',!was);});
  if(v!=null) setWarm(.12+v/100*.88);
}

/* pills (prototype): pick up to max. o.big turns on tick-many-then-mark-one. onRegen may be async. */
function pills(host,o){
  /* o.big.ask nudges: once they've picked their full set (or tried to move on) without marking one,
     the flag on their first pick opens its tooltip and asks (Jon, 21 Sep). */
  let forced=false;
  const nudging=()=>!!o.big?.ask&&o.big.get()<0&&o.sel.length>0&&(forced||o.sel.length>=o.max);
  const mark=(pop=-1)=>{
    const nudgeAt=nudging()?o.sel[0]:-1;
    $$('.pill[data-i]',host).forEach(p=>{const i=+p.dataset.i, k=o.sel.indexOf(i), n=$('.n',p);
      p.classList.toggle('on',k>-1); $('.pick',p)?.setAttribute('aria-pressed',k>-1);
      n.innerHTML=o.ordered&&k>-1?String(k+1):(o.big&&k>-1?ic('check'):'');
      const mk=$('[data-mk]',p);
      if(mk){ const on=o.big.get()===i, w=o.big.label.toLowerCase();
        mk.setAttribute('aria-pressed',on);
        const txt=i===nudgeAt?o.big.ask:on?`Your ${w}`:`Mark as your ${w}`;
        mk.setAttribute('aria-label',txt); mk.nextElementSibling.textContent=txt;
        mk.parentElement.classList.toggle('ask',i===nudgeAt); /* every pick pulses; one tooltip is enough */ mk.classList.toggle('nudge',nudgeAt>-1&&k>-1); }
      if(i===pop){n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop');}});
    o.onChange?.(); saveSoon();
  };
  const draw=(fresh=-1)=>{
    const it=o.items();
    host.innerHTML=it.map((t,i)=>`<div class="pill fhost${i===fresh?' swap':''}" data-i="${i}"><span class="n" aria-hidden="true"></span><button class="pick" type="button" aria-pressed="false">${h(t)}</button>${o.big?`<span class="tipw"><button class="markb" type="button" data-mk="${i}" aria-pressed="false">${ic('flag')}</button><span class="tip end" aria-hidden="true"></span></span>`:''}<span class="ftools">${i<o.nAI?tipI('regen',REGEN,'data-rg','','end'):''}${tipI('edit',EDIT,'data-ed','edit','end')}</span></div>`).join('')
      +`<div class="pill add"><span class="n" aria-hidden="true"></span><input type="text" placeholder="${h(o.addPh)}" aria-label="${h(o.addPh)}"></div>`;
    $$('.pill[data-i]',host).forEach(p=>{
      const i=+p.dataset.i;
      const nope=()=>{p.classList.remove('nope'); void p.offsetWidth; p.classList.add('nope');};
      // The circle is part of the pick, not decoration: it was dead to clicks.
      $('.n',p).onclick=()=>$('.pick',p)?.click?.();
      $('.pick',p).onclick=()=>{
        if(p.classList.contains('regening')) return;
        const k=o.sel.indexOf(i);
        if(k>-1){ o.sel.splice(k,1); if(o.big?.get()===i) o.big.set(-1); }
        else if(o.sel.length>=o.max){ if(o.max===1) o.sel.splice(0,1,i); else return nope(); }
        else o.sel.push(i);
        mark(k>-1?-1:i);
      };
      $('[data-mk]',p)?.addEventListener('click',()=>{
        if(o.big.get()===i){ o.big.set(-1); forced=false; }
        else {
          if(!o.sel.includes(i)){ if(o.sel.length>=o.max) return nope(); o.sel.push(i); }
          o.big.set(i);
        }
        mark();
      });
      $('[data-rg]',p)?.addEventListener('click',()=>busyOn(p,async()=>{ await o.onRegen(i); const pk=$('.pick',p); pk.textContent=o.items()[i]; pk.classList.remove('swapin'); void pk.offsetWidth; pk.classList.add('swapin'); mark(); }));
      $('[data-ed]',p).addEventListener('click',()=>{
        const pk=$('.pick',p); if(!pk||pk.tagName!=='BUTTON') return;
        const sp=document.createElement('span'); sp.className='pick'; sp.setAttribute('role','textbox'); sp.setAttribute('aria-label','Edit option'); sp.textContent=pk.textContent;
        pk.replaceWith(sp);
        editIn(sp,{box:p,at:$(':scope>.ftools',p),done:(t)=>{o.onEdit(i,t); draw(); $(`.pill[data-i="${i}"]`,host)?.classList.add('saved');},cancel:()=>draw()});
      });
    });
    const inp=$('.pill.add input',host);
    inp.onkeydown=(e)=>{if(e.key==='Enter'&&inp.value.trim()){o.onAdd(inp.value.trim()); const last=o.items().length-1; draw(last); mark(o.sel.includes(last)?last:-1); $('.pill.add input',host).focus();}};
    mark();
  };
  host.classList.add('enter'); draw(); setTimeout(()=>host.classList.remove('enter'),1400);
  draw.nudge=()=>{ forced=true; mark(); const t=$('.markb.nudge',host)?.closest('.pill'); if(t){t.classList.remove('nope'); void t.offsetWidth; t.classList.add('nope');} };
  return draw;
}

/* lines (prototype): statements you can edit, add to, and regenerate (AI) or remove (from their docs) */
function lines(host,o){
  const draw=(swap=-1,saved=-1)=>{
    const it=o.items();
    host.innerHTML=it.map((t,i)=>`<div class="line fhost${i===swap?' swap':''}${i===saved?' saved':''}" style="--i:${i}" data-i="${i}">${o.lead?o.lead(i):''}<span class="lt">${h(t)}</span>${o.tail?o.tail(i):''}<span class="ftools">${o.onDel?tipI('x','Remove','data-del','','end'):i<o.nAI?tipI('regen',REGEN,'data-rg','','end'):''}${tipI('edit',EDIT,'data-ed','edit','end')}</span></div>`).join('')
      +(o.addPh?`<div class="line add" style="--i:${it.length}"><input type="text" placeholder="${h(o.addPh)}" aria-label="${h(o.addPh)}"></div>`:'');
    $$('.line[data-i]',host).forEach(ln=>{
      const i=+ln.dataset.i, lt=$('.lt',ln);
      $('[data-rg]',ln)?.addEventListener('click',()=>busyOn(ln,async()=>{ await o.onRegen(i); draw(i); saveSoon(); }));
      $('[data-del]',ln)?.addEventListener('click',async()=>{
        ln.classList.add('gone'); await wait(RM?0:260);
        const tok=o.onDel(i); draw(); saveSoon();
        if(!o.onUndo) return;
        const u=document.createElement('div'); u.className='line undo';
        u.innerHTML=`<span class="lt">Removed</span><button class="gbtn ghost" type="button">Undo</button>`;
        host.insertBefore(u,host.children[i]||null);
        $('button',u).onclick=()=>{o.onUndo(tok); draw(-1,tok.i); saveSoon();};
        setTimeout(()=>u.remove(),5000);
      });
      $('[data-ed]',ln).onclick=()=>{ if(!lt.isContentEditable) editIn(lt,{box:ln,at:$(':scope>.ftools',ln),done:(t)=>{o.onEdit(i,t); draw(-1,i);}}); };
      o.bindLead?.(ln,i,draw);
    });
    const inp=$('.line.add input',host);
    if(inp) inp.onkeydown=(e)=>{if(e.key==='Enter'&&inp.value.trim()){o.onAdd(inp.value.trim()); draw(); saveSoon(); $('.line.add input',host).focus();}};
  };
  draw(); setTimeout(()=>host.classList.add('settled'),1500);
  return draw;
}
