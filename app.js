/* =========================================================
   クッキングクエスト  app.js
   - IndexedDB に写真＋テキストを自動保存
   - ダッシュボード / 記録フォーム / 発表スライド / 印刷PDF / 書き出し
   ========================================================= */
(function(){
'use strict';

/* ---------------- 小さなユーティリティ ---------------- */
const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nl2br = s => esc(s).replace(/\n/g,'<br>');
const todayStr = ()=>{const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const fmtDate = s => { if(!s) return ''; const d=new Date(s+'T00:00:00'); if(isNaN(d)) return s;
  const w=['日','月','火','水','木','金','土'][d.getDay()]; return `${d.getMonth()+1}月${d.getDate()}日(${w})`; };

/* ---------------- IndexedDB ラッパ ---------------- */
const DB = (()=>{
  let db=null;
  const open = ()=>new Promise((res,rej)=>{
    const r = indexedDB.open('cooking-quest',1);
    r.onupgradeneeded = e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('entries')) d.createObjectStore('entries',{keyPath:'id'});
      if(!d.objectStoreNames.contains('meta'))    d.createObjectStore('meta',{keyPath:'k'});
    };
    r.onsuccess=e=>{db=e.target.result;res(db);};
    r.onerror =e=>rej(e.target.error);
  });
  const tx=(store,mode)=>db.transaction(store,mode).objectStore(store);
  const p =req=>new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});
  return {
    init:open,
    allEntries:()=>p(tx('entries','readonly').getAll()),
    putEntry:e=>p(tx('entries','readwrite').put(e)),
    delEntry:id=>p(tx('entries','readwrite').delete(id)),
    clearEntries:()=>p(tx('entries','readwrite').clear()),
    getMeta:k=>p(tx('meta','readonly').get(k)).then(r=>r?r.v:undefined),
    setMeta:(k,v)=>p(tx('meta','readwrite').put({k,v})),
  };
})();

/* ---------------- ストア（クラウド優先／ローカル予備） ---------------- */
let store = null;               // boot でクラウド or ローカルを割り当て
const dbAdapter = {             // Supabase未設定時のフォールバック（IndexedDB）
  allEntries:  ()=>DB.allEntries(),
  putEntry:    (e)=>DB.putEntry(e).then(()=>e),
  delEntry:    (id)=>DB.delEntry(id),
  clearEntries:()=>DB.clearEntries(),
  getSettings: ()=>DB.getMeta('settings'),
  setSettings: (s)=>DB.setMeta('settings',s),
};

/* ---------------- 状態 ---------------- */
const state = {
  entries: [],          // {id,day,date,title,ingredients,steps,note,stars,yum,photos:[dataURL],createdAt}
  editingId: null,
  draftPhotos: [],
  settings: {
    name:'陸斗', grade:'3-1',
    title:'2026年夏休み自由研究: クッキングクエスト🔥',
    url:'https://lanikai-kenji.github.io/cooking-quest/present.html',
    goal:20, sound:1, intro:'', summary:''
  },
};

/* ---------------- ピクセルアート（ドラクエ風ドット絵） ---------------- */
// コック帽スライム（ログイン画面）
const SPRITE_SLIME = {
  pix:[
    "................",
    ".....oooooo.....",
    "....oWWWWWWo....",
    "...oWWWWWWWWo...",
    "...oWWWWWWWWo...",
    "...oWWWWWWWWo...",
    "...oggggggggo...",
    "..obbbbbbbbbbo..",
    ".obhhbbbbbbbbbo.",
    ".obheebbbbeebbo.",
    ".obbepbbbbpebbo.",
    ".obbbbbbbbbbbbo.",
    ".obbbmbbbbmbbbo.",
    ".obbbbmmmmbbbbo.",
    "obbbbbbbbbbbbbbo",
    ".oooooooooooooo.",
  ],
  pal:{ o:'#0d294a', b:'#33a1ee', h:'#8fd6ff', W:'#ffffff', g:'#c9d4e4', e:'#ffffff', p:'#0d294a', m:'#0d294a' }
};
// ドラクエ勇者（ヘッダー）：とんがり帽・剣・チュニック
const SPRITE_HERO = {
  pix:[
    "......oo.....a..",
    ".....okko....A..",
    "....okkkko...A..",
    "...okkkkkko..A..",
    "...okkggkkko.A..",
    "...okkkkkkkoyyy.",
    "...ossssssso.b..",
    "...osessseso.b..",
    "...ossSSSsso.y..",
    "...ottttttto....",
    "..otTtttttTto...",
    "..ottttttttto...",
    "..obbbbbbbbbo...",
    "..ottttttttto...",
    "....tt...tt.....",
    "....oo...oo.....",
  ],
  pal:{
    o:'#0e1a33', k:'#3b6fd6', g:'#ffd23f', y:'#ffd23f',
    s:'#ffd0a6', S:'#e0a074', e:'#0e1a33',
    t:'#2747a6', T:'#5578d6', d:'#1b2f70', b:'#8a5a2c',
    a:'#c7cfdb', A:'#ffffff'
  }
};
function buildSpriteSVG(sprite, cell){
  const N=sprite.pix.length; let rects='';
  for(let y=0;y<sprite.pix.length;y++){
    const row=sprite.pix[y];
    for(let x=0;x<row.length;x++){
      const col=sprite.pal[row[x]]; if(!col) continue;
      rects+=`<rect x="${x*cell}" y="${y*cell}" width="${cell}" height="${cell}" fill="${col}"/>`;
    }
  }
  return `<svg class="pixel-sprite" viewBox="0 0 ${16*cell} ${N*cell}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}
function renderPixelLogo(){
  const el = document.getElementById('login-logo');
  if(el) el.innerHTML = buildSpriteSVG(SPRITE_SLIME, 6);
}
function renderHeroLogo(){
  const el = document.getElementById('brand-logo');
  if(el) el.innerHTML = buildSpriteSVG(SPRITE_HERO, 6);
}

/* ---------------- ログイン（超簡易・あいことば方式） ---------------- */
const PASSWORD = 'rikuto';
function isAuthed(){ try{ return sessionStorage.getItem('cq_auth')==='1'; }catch(e){ return false; } }
function doLogin(){
  const v=$('#login-pass').value;
  if(v===PASSWORD){
    try{ sessionStorage.setItem('cq_auth','1'); }catch(e){}
    $('#login').classList.add('hidden');
    $('#login-pass').value='';
    afterLogin();
  }else{
    const err=$('#login-err'); err.textContent='あいことばが ちがうよ！ もう一回';
    err.classList.remove('shake'); void err.offsetWidth; err.classList.add('shake');
    $('#login-pass').select();
  }
}

/* ---------------- 効果音（Web Audio・ファイル不要） ---------------- */
const SFX = (()=>{
  let ctx=null;
  const ac = ()=> ctx || (ctx = new (window.AudioContext||window.webkitAudioContext)());
  const beep=(freq,dur,type='sine',when=0,gain=.12)=>{
    if(!state.settings.sound) return;
    try{
      const c=ac(); const o=c.createOscillator(); const g=c.createGain();
      o.type=type; o.frequency.value=freq; o.connect(g); g.connect(c.destination);
      const t=c.currentTime+when; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+.01);
      g.gain.exponentialRampToValueAtTime(.0001,t+dur); o.start(t); o.stop(t+dur);
    }catch(e){}
  };
  return {
    click:()=>beep(520,.08,'triangle'),
    save :()=>{beep(660,.1,'triangle');beep(880,.12,'triangle',.09);beep(1180,.16,'sine',.18);},
    levelup:()=>{[523,659,784,1046].forEach((f,i)=>beep(f,.2,'sine',i*.12,.14));},
    nav:()=>beep(440,.05,'sine',0,.08),
  };
})();

/* ---------------- トースト ---------------- */
let toastT;
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ---------------- 紙吹雪 ---------------- */
function confetti(){
  const cv=$('#confetti'); const ctx=cv.getContext('2d');
  cv.width=innerWidth; cv.height=innerHeight; cv.style.display='block';
  const colors=['#ff6a2b','#ffd23f','#39e08b','#37b6ff','#ff2e63','#8a5cff'];
  const N=140, parts=[];
  for(let i=0;i<N;i++) parts.push({
    x:Math.random()*cv.width, y:-20-Math.random()*cv.height*0.3,
    r:6+Math.random()*8, c:colors[i%colors.length],
    vy:3+Math.random()*4, vx:-2+Math.random()*4, rot:Math.random()*6, vr:-.2+Math.random()*.4
  });
  let frame=0;
  (function loop(){
    frame++; ctx.clearRect(0,0,cv.width,cv.height);
    parts.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr; p.vy+=0.03;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillStyle=p.c;
      ctx.fillRect(-p.r/2,-p.r/2,p.r,p.r*0.6); ctx.restore();
    });
    if(frame<160) requestAnimationFrame(loop);
    else { cv.style.display='none'; ctx.clearRect(0,0,cv.width,cv.height); }
  })();
}

/* ---------------- レベル計算 ---------------- */
const LEVELS = [
  {min:0 , name:'みならいシェフ'},
  {min:3 , name:'かけだしシェフ'},
  {min:6 , name:'まちのシェフ'},
  {min:10, name:'いちりゅうシェフ'},
  {min:15, name:'てんさいシェフ'},
  {min:20, name:'でんせつのシェフ'},
];
function levelOf(cleared){
  let lv=1,cur=LEVELS[0];
  for(let i=0;i<LEVELS.length;i++){ if(cleared>=LEVELS[i].min){lv=i+1;cur=LEVELS[i];} }
  const next=LEVELS[lv] || null;
  return {lv, name:cur.name, next};
}

/* ---------------- 画面切りかえ ---------------- */
function show(view){
  $$('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  $$('.wrap > .view').forEach(v=>v.classList.toggle('active', v.id===(view==='print'?'print-view':view)));
  if(view==='dash') renderDash();
  if(view==='print') renderReport();
  if(view==='recipes') renderRecipes();
  SFX.nav();
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ---------------- ダッシュボード描画 ---------------- */
function renderDash(){
  const s=state.settings;
  $('#hero-name').textContent = s.name || 'きみ';
  $('#hero-title').textContent = s.title || 'クッキングクエスト';
  $('#brand-sub').textContent = s.title || 'クッキングクエスト';
  const goal = s.goal||20;
  const done = state.entries.length;
  const cleared = Math.min(done, goal);
  $('#ring-goal').textContent = goal;
  $('#ring-num').textContent = done;

  // リング
  const R=64, C=2*Math.PI*R;
  const ring=$('#ring-fg'); ring.setAttribute('stroke-dasharray',C.toFixed(1));
  const ratio=Math.min(done/goal,1);
  ring.setAttribute('stroke-dashoffset',(C*(1-ratio)).toFixed(1));

  // レベル & XP
  const lv=levelOf(cleared);
  $('#lvl-name').textContent = `Lv.${lv.lv} ${lv.name}`;
  const xp = done*100;
  $('#xp-text').textContent = `${xp} XP`;
  let fillRatio;
  if(lv.next){ const span=lv.next.min-LEVELS[lv.lv-1].min; fillRatio=(cleared-LEVELS[lv.lv-1].min)/span; }
  else fillRatio=1;
  $('#xpfill').style.width = Math.max(4,Math.min(1,fillRatio)*100)+'%';

  // メダル
  const milestones=[
    {n:1 ,em:'🥚',t:'スタート'},
    {n:5 ,em:'🍳',t:'5日'},
    {n:10,em:'🍚',t:'10日'},
    {n:15,em:'🍜',t:'15日'},
    {n:20,em:'🏆',t:'20日'},
  ];
  $('#badges').innerHTML = milestones.map(m=>
    `<div class="medal ${done>=m.n?'on':''}"><div class="em">${m.em}</div><div>${m.t}</div></div>`
  ).join('');

  // カレンダーグリッド
  const byDay={}; state.entries.forEach(e=>{ byDay[e.day]=e; });
  const maxDay = Math.max(goal, ...state.entries.map(e=>e.day||0), 0);
  let html='';
  for(let d=1; d<=maxDay; d++){
    const e=byDay[d];
    if(e){
      const ph=e.photos&&e.photos[0];
      html+=`<div class="daycell done" data-edit="${e.id}">
        <div class="dn">${d}日目</div>
        <div class="cleared">クリア!</div>
        ${ph?`<img src="${ph}" alt="">`:''}
        <div class="cap">${esc(e.title||'（タイトルなし）')}</div>
      </div>`;
    }else{
      html+=`<div class="daycell" data-new="${d}">
        <div class="dn">${d}日目</div>
        <div class="plus">＋</div>
      </div>`;
    }
  }
  $('#grid-days').innerHTML = html;
}

/* ---------------- 写真：リサイズして dataURL 化 ---------------- */
function fileToResizedDataURL(file, maxSide=1600, quality=0.85){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      let {width:w,height:h}=img;
      const scale=Math.min(1, maxSide/Math.max(w,h));
      w=Math.round(w*scale); h=Math.round(h*scale);
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      const ctx=cv.getContext('2d'); ctx.drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      try{ resolve(cv.toDataURL('image/jpeg',quality)); }catch(e){ reject(e); }
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('画像を読めませんでした'));};
    img.src=url;
  });
}
async function addPhotoFiles(files){
  const list=[...files].filter(f=>f.type.startsWith('image/'));
  if(!list.length) return;
  toast(`写真を読みこみ中…（${list.length}枚）`);
  for(const f of list){
    try{ const d=await fileToResizedDataURL(f); state.draftPhotos.push(d); }
    catch(e){ console.error(e); toast('1枚読みこめませんでした'); }
  }
  renderDraftPhotos();
  SFX.click();
}
function renderDraftPhotos(){
  const box=$('#photos');
  box.innerHTML = state.draftPhotos.map((d,i)=>`
    <div class="thumb">
      <img src="${d}" alt="">
      <button class="del" data-del="${i}" title="消す">✕</button>
      <div class="mv">
        <button data-mv="${i}:-1" title="まえへ">‹</button>
        <button data-mv="${i}:1" title="うしろへ">›</button>
      </div>
    </div>`).join('');
}

/* ---------------- 星 ---------------- */
let draftStars=5;
function renderStars(){ $$('#stars span').forEach(s=>s.classList.toggle('on', +s.dataset.v<=draftStars)); }

/* ---------------- フォーム：新規/編集 ---------------- */
function openNewEntry(day){
  state.editingId=null; state.draftPhotos=[]; draftStars=5;
  const nextDay = day || (state.entries.length? Math.max(...state.entries.map(e=>e.day))+1 : 1);
  $('#f-day').value=nextDay;
  $('#f-date').value=todayStr();
  $('#f-title').value=''; $('#f-ing').value=''; $('#f-steps').value=''; $('#f-note').value='';
  $('#f-yum').value='😋 おいしい';
  $('#entry-head').textContent='きょうの おひるごはんを記録しよう';
  $('#entry-delete').style.display='none';
  $('#entry-cancel').style.display='none';
  renderDraftPhotos(); renderStars();
  show('entry');
}
function openEditEntry(id){
  const e=state.entries.find(x=>x.id===id); if(!e) return;
  state.editingId=id; state.draftPhotos=[...(e.photos||[])]; draftStars=e.stars||5;
  $('#f-day').value=e.day; $('#f-date').value=e.date||todayStr();
  $('#f-title').value=e.title||''; $('#f-ing').value=e.ingredients||'';
  $('#f-steps').value=e.steps||''; $('#f-note').value=e.note||'';
  $('#f-yum').value=e.yum||'😋 おいしい';
  $('#entry-head').textContent=`${e.day}日目 を なおす`;
  $('#entry-delete').style.display='inline-block';
  $('#entry-cancel').style.display='inline-block';
  renderDraftPhotos(); renderStars();
  show('entry');
}
async function saveEntry(){
  const day=parseInt($('#f-day').value,10)||1;
  const title=$('#f-title').value.trim();
  if(!title && state.draftPhotos.length===0){
    toast('タイトルか写真を1つは入れてね！'); return;
  }
  // 同じ日が既にある（別ID）なら上書き確認
  const dup = state.entries.find(e=>e.day===day && e.id!==state.editingId);
  if(dup && !state.editingId){
    const ok = await confirmModal(`${day}日目 はもうあるよ`,'その日を上書き（なおす）しますか？');
    if(!ok) return;
    state.editingId=dup.id;
  }
  const entry = {
    id: state.editingId || ('e_'+day+'_'+performance.now().toString(36).replace('.','')),
    day, date:$('#f-date').value||todayStr(),
    title, ingredients:$('#f-ing').value, steps:$('#f-steps').value, note:$('#f-note').value,
    stars:draftStars, yum:$('#f-yum').value, photos:[...state.draftPhotos],
    createdAt: (state.entries.find(e=>e.id===state.editingId)||{}).createdAt || Date.now(),
  };
  const wasNew = !state.editingId;
  const beforeCleared = Math.min(state.entries.length, state.settings.goal);

  const saveBtn=$('#save-entry'); const oldLabel=saveBtn.textContent;
  saveBtn.disabled=true; saveBtn.textContent='☁️ ほぞん中…';
  let saved;
  try{ saved = await store.putEntry(entry); }
  catch(err){ console.error(err); saveBtn.disabled=false; saveBtn.textContent=oldLabel;
    toast('保存に失敗しました…ネットせつぞくを確認してね'); return; }
  saveBtn.disabled=false; saveBtn.textContent=oldLabel;
  const idx=state.entries.findIndex(e=>e.id===saved.id);
  if(idx>=0) state.entries[idx]=saved; else state.entries.push(saved);
  state.entries.sort((a,b)=>a.day-b.day);

  SFX.save(); confetti();
  const afterCleared = Math.min(state.entries.length, state.settings.goal);
  const beforeLv=levelOf(beforeCleared).lv, afterLv=levelOf(afterCleared).lv;

  if(wasNew && afterLv>beforeLv){ levelUp(afterCleared); }
  else if(afterCleared>=state.settings.goal && wasNew){ levelUp(afterCleared,true); }
  else { toast(wasNew?'クリア！記録したよ 🔥':'なおしたよ ✏️'); }

  state.editingId=null; state.draftPhotos=[];
  show('dash');
}
function levelUp(cleared, goalDone){
  const lv=levelOf(cleared);
  SFX.levelup(); confetti();
  const box=$('#levelup');
  if(goalDone){
    $('#lu-title').textContent='ミッション コンプリート！！';
    $('#lu-sub').innerHTML=`${state.settings.goal}日間 やりきった！<br>きみは <b>でんせつのシェフ</b> だ！🏆🎉`;
    $('#levelup .em').textContent='🏆';
  }else{
    $('#lu-title').textContent=`レベルアップ！ Lv.${lv.lv}`;
    $('#lu-sub').innerHTML=`「<b>${lv.name}</b>」になった！<br>この調子でつづけよう 🔥`;
    $('#levelup .em').textContent='🎉';
  }
  box.classList.add('show');
  setTimeout(()=>box.classList.remove('show'),2600);
  box.onclick=()=>box.classList.remove('show');
}

/* ---------------- 削除確認モーダル ---------------- */
function confirmModal(title, body){
  return new Promise(res=>{
    const m=$('#modal'); $('#m-title').textContent=title; $('#m-body').innerHTML=`<p class="muted">${esc(body)}</p>`;
    m.classList.add('show');
    const done=v=>{ m.classList.remove('show'); $('#m-ok').onclick=null; $('#m-cancel').onclick=null; res(v); };
    $('#m-ok').onclick=()=>done(true); $('#m-cancel').onclick=()=>done(false);
  });
}

/* ================= 発表スライド ================= */
let slideIdx=0, slideEls=[];
function buildSlides(){
  const s=state.settings;
  const wrap=$('#slides'); wrap.innerHTML='';
  const entries=[...state.entries].sort((a,b)=>a.day-b.day);

  // 表紙
  const cover=document.createElement('div');
  cover.className='slide cover-slide';
  cover.innerHTML=`
    <div class="plate">🍽️</div>
    <div class="kicker">じゆうけんきゅう / COOKING QUEST</div>
    <h1>${esc(s.title||'20日間 おひるごはんチャレンジ')}</h1>
    <div class="meta" style="justify-content:center">
      <div class="box"><b>なまえ</b> ${esc(s.name||'')}</div>
      <div class="box"><b>クラス</b> ${esc(s.grade||'')}</div>
      <div class="box"><b>クリア</b> ${entries.length}日</div>
    </div>`;
  wrap.appendChild(cover);

  // はじめに
  if(s.intro && s.intro.trim()){
    const intro=document.createElement('div'); intro.className='slide';
    intro.innerHTML=`<div class="kicker">はじめに</div><h1>なぜ やろうと思ったか 💡</h1>
      <div class="meta"><div class="box" style="font-size:clamp(18px,3.4vmin,34px);line-height:1.6">${nl2br(s.intro)}</div></div>`;
    wrap.appendChild(intro);
  }

  // 各日
  entries.forEach(e=>{
    const sl=document.createElement('div'); sl.className='slide';
    const photos=(e.photos||[]).slice(0,4);
    let grid='1fr'; if(photos.length===2)grid='1fr 1fr'; if(photos.length===3)grid='2fr 1fr'; if(photos.length>=4)grid='1fr 1fr';
    const photoHTML = photos.length
      ? `<div class="big-photos" style="grid-template-columns:${grid}">${photos.map(p=>`<img src="${p}">`).join('')}</div>`
      : `<div class="big-photos" style="place-items:center;font-size:12vmin">🍽️</div>`;
    const stars='⭐'.repeat(e.stars||0);
    sl.innerHTML=`
      <div class="kicker">${e.day}日目 ・ ${esc(fmtDate(e.date))}</div>
      <h1>${esc(e.title||'（タイトルなし）')}</h1>
      ${photoHTML}
      <div class="meta">
        ${e.ingredients?`<div class="box"><b>材料</b> ${esc((e.ingredients||'').split('\n').filter(Boolean).join('、'))}</div>`:''}
        ${e.yum?`<div class="box">${esc(e.yum)}</div>`:''}
        ${stars?`<div class="box">${stars}</div>`:''}
        ${e.note?`<div class="box"><b>ひとこと</b> ${esc(e.note)}</div>`:''}
      </div>`;
    wrap.appendChild(sl);
  });

  // まとめ
  if(s.summary && s.summary.trim()){
    const sum=document.createElement('div'); sum.className='slide';
    sum.innerHTML=`<div class="kicker">まとめ</div><h1>やってみて わかったこと 🏁</h1>
      <div class="meta"><div class="box" style="font-size:clamp(18px,3.4vmin,34px);line-height:1.6">${nl2br(s.summary)}</div></div>`;
    wrap.appendChild(sum);
  }

  // 最後：ありがとう
  const end=document.createElement('div'); end.className='slide cover-slide';
  end.innerHTML=`<div class="plate">🎉</div><h1>おわり</h1>
    <div class="kicker">みてくれて ありがとう！</div>
    <div class="meta" style="justify-content:center"><div class="box">${esc(s.name||'')} の 自由研究</div></div>`;
  wrap.appendChild(end);

  slideEls=$$('.slide',wrap);
}
function startPresent(){
  buildSlides(); slideIdx=0; $('#present-view').classList.add('active'); goSlide(0);
}
function goSlide(i){
  if(i<0)i=0; if(i>=slideEls.length)i=slideEls.length-1;
  slideEls.forEach((el,n)=>el.classList.toggle('show',n===i));
  slideIdx=i;
  $('#pv-pageno').textContent=`${i+1} / ${slideEls.length}`;
  $('#pv-prog i').style.width=((i+1)/slideEls.length*100)+'%';
  SFX.nav();
}
function exitPresent(){ $('#present-view').classList.remove('active'); if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); }

/* ================= 印刷レポート ================= */
const PAPER = { // mm  portrait W x H
  A4:[210,297], A3:[297,420], A5:[148,210], B5:[182,257], B4:[257,364],
  Letter:[216,279], Legal:[216,356], Hagaki:[100,148], L:[89,127]
};
function applyPageStyle(){
  const size=$('#p-size').value, orient=$('#p-orient').value;
  let [w,h]=PAPER[size]||PAPER.A4; if(orient==='landscape')[w,h]=[h,w];
  $('#page-style').textContent=`@page{ size:${w}mm ${h}mm; margin:0; }`;
  return {w,h};
}
function starStr(n){ return '★'.repeat(n||0)+'☆'.repeat(Math.max(0,5-(n||0))); }

/* ヘッダーの「共有QR」を表示 */
function openShareQR(){
  const url = (store===Cloud) ? Cloud.shareUrl() : location.href.split('#')[0];
  $('#qr-url').value = url;
  const img = makeQR(url);
  $('#qr-img-box').innerHTML = img
    ? `<img src="${img}" alt="共有QRコード">`
    : '<p class="muted">QRを作れませんでした</p>';
  $('#qr-modal').classList.add('show');
  SFX.click();
}

/* QRコードを dataURL（GIF）で作る。ライブラリが無ければ null */
function makeQR(text){
  if(!text || typeof qrcode==='undefined') return null;
  try{ const qr=qrcode(0,'M'); qr.addData(text); qr.make(); return qr.createDataURL(6,4); }
  catch(e){ console.warn('QR失敗',e); return null; }
}

function dayPageHTML(e, dim){
  const photos=e.photos||[];
  let grid='1fr', rows='1fr';
  const n=Math.min(photos.length,4);
  if(n===2){grid='1fr 1fr';} if(n===3){grid='1fr 1fr';rows='1fr 1fr';} if(n>=4){grid='1fr 1fr';rows='1fr 1fr';}
  const ph = n
    ? `<div class="p-photos" style="grid-template-columns:${grid};grid-auto-rows:1fr;flex:1;min-height:0">
        ${photos.slice(0,4).map((p,i)=>`<img src="${p}" ${n===3&&i===0?'style="grid-row:span 2"':''}>`).join('')}
       </div>`
    : `<div class="p-photos" style="flex:1;place-items:center;display:grid;font-size:30mm">🍽️</div>`;
  const ings=(e.ingredients||'').split('\n').map(x=>x.trim()).filter(Boolean);
  return `
   <div class="pad">
     <div class="p-head"><div class="dnum">${e.day}日目</div><div class="pdate">${esc(fmtDate(e.date))}</div></div>
     <h3 class="p-title">${esc(e.title||'（タイトルなし）')}</h3>
     ${ph}
     <div class="p-body">
       <div class="p-block">
         <h4>🧂 使った材料</h4>
         ${ings.length?`<ul>${ings.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:`<div class="txt muted">—</div>`}
       </div>
       <div class="p-block">
         <h4>👨‍🍳 作りかた・くふう</h4>
         <div class="txt">${esc(e.steps||'—')}</div>
       </div>
       <div class="p-block" style="grid-column:1/-1">
         <h4>💬 かんそう</h4>
         <div class="txt">${esc(e.note||'—')}</div>
       </div>
     </div>
     <div class="p-foot">
       <span class="stars-print">できばえ ${starStr(e.stars)}　${esc(e.yum||'')}</span>
       <span>${esc(state.settings.name||'')}</span>
     </div>
   </div>`;
}
function compactDayHTML(e){
  const ph=(e.photos||[])[0];
  const ings=(e.ingredients||'').split('\n').map(x=>x.trim()).filter(Boolean);
  return `<div style="display:flex;gap:5mm;padding:4mm 0;border-bottom:1.5px dashed #ffd7b8;flex:1;min-height:0">
    <div style="flex:0 0 46%;border-radius:3mm;overflow:hidden;background:#f4f4f4;display:grid;place-items:center">
      ${ph?`<img src="${ph}" style="width:100%;height:100%;object-fit:cover">`:`<div style="font-size:20mm">🍽️</div>`}
    </div>
    <div style="flex:1;display:flex;flex-direction:column;min-width:0">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <b style="color:#ff5a1f;font-size:5mm">${e.day}日目</b><span style="color:#777;font-size:3.4mm">${esc(fmtDate(e.date))}</span>
      </div>
      <div style="font-size:6mm;font-weight:900;margin:1mm 0 2mm">${esc(e.title||'')}</div>
      <div style="font-size:3.4mm;color:#333;line-height:1.5"><b>材料：</b>${esc(ings.join('、')||'—')}</div>
      <div style="font-size:3.4mm;color:#333;line-height:1.5;margin-top:1mm"><b>感想：</b>${esc(e.note||'—')}</div>
      <div style="margin-top:auto;color:#ff8f1f;font-size:3.6mm">${starStr(e.stars)} ${esc(e.yum||'')}</div>
    </div>
  </div>`;
}
function renderReport(){
  const s=state.settings;
  const {w,h}=applyPageStyle();
  const layout=$('#p-layout').value;
  const withCover=$('#p-cover').value==='1';
  const withDocs=$('#p-docs').value==='1';
  const withQR=$('#p-qr').value==='1';
  // クラウド接続時は「発表ページ＋ワークスペースID」を自動で飛び先に
  const qrUrl=(store===Cloud) ? Cloud.presentUrl() : (s.url||'').trim();
  const qrImg=(withQR && qrUrl) ? makeQR(qrUrl) : null;
  const entries=[...state.entries].sort((a,b)=>a.day-b.day);
  const paperStyle=`width:${w}mm;height:${h}mm`;
  let html='';

  if(withCover){
    html+=`<div class="paper cover" style="${paperStyle}">
      <div class="frame"></div><div class="frame2"></div>
      <div class="pad">
        <div class="plate">🍳</div>
        <div class="sub">じゆうけんきゅう</div>
        <div class="maintitle">${esc(s.title||'クッキングクエスト')}</div>
        <div class="sub">🔥 ${entries.length}日 クリア！ 🔥</div>
        <div class="byline">なまえ　<b>${esc(s.name||'　　　　')}</b><br>${esc(s.grade||'')}</div>
        ${qrImg?`<div class="qr-box"><img src="${qrImg}" alt="発表ページQR"><div class="cap">📱 スマホ・iPadで読みとると<br>発表（スライド）がはじまるよ！</div></div>`:''}
      </div>
    </div>`;
  }
  if(withDocs && s.intro && s.intro.trim()){
    html+=`<div class="paper doc" style="${paperStyle}"><div class="pad">
      <div class="doc-h">💡 はじめに</div>
      <div class="doc-body">${esc(s.intro)}</div>
      <div class="doc-list">
        <div class="it"><span class="n">目標</span><span>${esc(s.title||'')}（${s.goal||20}日間）</span></div>
        <div class="it"><span class="n">名前</span><span>${esc(s.name||'')} ・ ${esc(s.grade||'')}</span></div>
      </div>
    </div></div>`;
  }

  if(!entries.length){
    html+=`<div class="paper" style="${paperStyle}"><div class="pad" style="place-items:center;display:grid">
      <div style="text-align:center;color:#999"><div style="font-size:30mm">🍽️</div>まだ記録がありません。<br>「記録する」から入れてね。</div>
    </div></div>`;
  }else if(layout==='compact'){
    for(let i=0;i<entries.length;i+=2){
      html+=`<div class="paper" style="${paperStyle}"><div class="pad">
        <div class="p-head"><div class="dnum" style="font-size:5mm">${esc(s.title||'おひるごはん記録')}</div><div class="pdate">${esc(s.name||'')}</div></div>
        ${compactDayHTML(entries[i])}
        ${entries[i+1]?compactDayHTML(entries[i+1]):''}
      </div></div>`;
    }
  }else{
    entries.forEach(e=>{ html+=`<div class="paper" style="${paperStyle}">${dayPageHTML(e)}</div>`; });
  }

  if(withDocs && s.summary && s.summary.trim()){
    html+=`<div class="paper doc" style="${paperStyle}"><div class="pad">
      <div class="doc-h">🏁 まとめ・わかったこと</div>
      <div class="doc-body">${esc(s.summary)}</div>
      <div class="doc-list">
        <div class="it"><span class="n">合計</span><span>${entries.length}日間 つくった！</span></div>
        <div class="it"><span class="n">シェフ</span><span>${esc(levelOf(Math.min(entries.length,s.goal)).name)}</span></div>
      </div>
      <div style="margin-top:auto;text-align:right;color:#999;font-size:3.4mm">${esc(s.name||'')} ・ ${esc(s.grade||'')}</div>
    </div></div>`;
  }

  $('#report').innerHTML=html;

  // プレビューを枠内にフィット（横幅に合わせて縮小）
  const scroller=$('#preview-scroller');
  const avail = scroller.clientWidth-48;
  const pxW = w*96/25.4; // mm→px
  const scale = Math.min(1, avail/pxW);
  $$('#report .paper').forEach(p=>{
    p.style.transformOrigin='top center';
    p.style.transform=`scale(${scale})`;
    p.style.marginBottom = (h*96/25.4*scale - h*96/25.4) + 20 + 'px';
  });
}

/* ================= 書き出し ================= */
function download(filename, text, mime='application/octet-stream'){
  const blob=new Blob([text],{type:mime});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function exportJSON(){
  const data={ app:'cooking-quest', version:1, exportedAt:new Date().toISOString(),
    settings:state.settings, entries:state.entries };
  const name=(state.settings.name||'クッキングクエスト').replace(/[\\/:*?"<>|]/g,'');
  download(`${name}_バックアップ.json`, JSON.stringify(data), 'application/json');
  toast('バックアップを書き出したよ 📦');
}
async function importJSON(file){
  try{
    const txt=await file.text(); const data=JSON.parse(txt);
    if(!data.entries) throw new Error('形式がちがうみたい');
    const ok=await confirmModal('データを読みこむ',`いまのデータを、読みこんだデータに置きかえます。よいですか？（${data.entries.length}日分）`);
    if(!ok) return;
    toast('読みこみ中…（写真アップロード）');
    await store.clearEntries();
    for(const e of data.entries) await store.putEntry(e);
    if(data.settings){ state.settings={...state.settings,...data.settings}; await store.setSettings(state.settings); }
    state.entries=(await store.allEntries()).sort((a,b)=>a.day-b.day);
    fillSettingsForm();
    toast('読みこんだよ！ ✅'); show('dash');
  }catch(e){ console.error(e); toast('読みこめませんでした…'); }
}
function exportSite(){
  // 完成した発表サイトを1枚のHTMLに（写真も内包）
  const s=state.settings;
  const entries=[...state.entries].sort((a,b)=>a.day-b.day);
  const dataJSON=JSON.stringify({settings:s,entries}).replace(/</g,'\\u003c');
  const title=esc(s.title||'20日間 おひるごはんチャレンジ');
  // 関数リプレーサで $ などの特殊文字を安全に埋め込む
  const html = SITE_TEMPLATE.replace('__DATA__', ()=>dataJSON)
                            .replace(/__TITLE__/g, ()=>title);
  // オフライン用のバックアップ（クラウド不要で開ける自己完結HTML）
  const nm=(s.name||'クッキングクエスト').replace(/[\\/:*?"<>|]/g,'');
  download(`${nm}_発表バックアップ.html`, html, 'text/html');
  toast('発表バックアップを書き出したよ（オフライン用）🌐');
}

/* ================= レシピ図鑑 ================= */
let recipeCat = 'all';
function renderRecipes(){
  if(typeof RECIPES==='undefined' || typeof RECIPE_CATS==='undefined') return;
  $('#recipe-count').textContent = RECIPES.length+'品';
  const cats = Object.keys(RECIPE_CATS);
  let chips = `<span class="chip catchip ${recipeCat==='all'?'on':''}" data-cat="all">🍽️ ぜんぶ</span>`;
  chips += cats.map(k=>{const c=RECIPE_CATS[k]; return `<span class="chip catchip ${recipeCat===k?'on':''}" data-cat="${k}">${c.emoji} ${c.name}</span>`;}).join('');
  $('#recipe-cats').innerHTML = chips;
  const PH = window.RECIPE_PHOTOS||{};
  const list = RECIPES.filter(r=> recipeCat==='all' || r.c===recipeCat);
  $('#recipe-grid').innerHTML = list.map(r=>{
    const cat = RECIPE_CATS[r.c]||{name:'',emoji:'',g:['#555','#333']};
    const [c1,c2]=cat.g;
    const ph = PH[r.id];
    const photo = ph ? `<img class="photo" src="${esc(ph.img)}" alt="${esc(r.n)}" loading="lazy">` : '';
    const sparks = ph ? '' : `<div class="spark" style="top:13%;left:13%">✨</div><div class="spark" style="bottom:15%;right:12%;font-size:12px">⭐</div>`;
    return `<div class="recipe-card" data-recipe="${r.id}">
      <div class="recipe-poster" style="background:linear-gradient(140deg,${c1},${c2})">
        ${photo}${sparks}
        <span class="lv">${'★'.repeat(r.lv)}</span>
        <span class="time">⏱️${r.t}分</span>
        <span class="catbadge">${cat.emoji} ${esc(cat.name)}</span>
        <div class="dish">${r.e}</div>
      </div>
      <div class="recipe-info">
        <div class="name">${esc(r.n)}</div>
        <div class="nick">${esc(r.nick)}</div>
      </div>
    </div>`;
  }).join('');
  renderRecipeCredits();
}
function renderRecipeCredits(){
  const box=$('#recipe-credits'); if(!box) return;
  const PH=window.RECIPE_PHOTOS||{};
  const byId={}; RECIPES.forEach(r=>byId[r.id]=r);
  const rows=Object.keys(PH).sort().map(id=>{
    const p=PH[id], r=byId[id]; if(!r) return '';
    const lic=esc((p.license||'')+(p.version?' '+p.version:''));
    const by=p.creator?`／作者: ${esc(p.creator)}`:'';
    const src=p.src?`　<a href="${esc(p.src)}" target="_blank" rel="noopener">出典</a>`:'';
    return `<div><span class="cn">${esc(r.n)}</span> — 「${esc(p.title||'')}」${by}（${lic}）${src}</div>`;
  }).join('');
  box.innerHTML = `<details><summary>📷 写真のクレジット（フリー素材・${Object.keys(PH).length}枚）</summary>
    <div class="clist">
      <p>料理写真は Openverse 経由で取得したフリー素材（CC0・パブリックドメイン・CC-BY 等）です。各写真の題名・作者・ライセンス・出典は以下のとおり。</p>
      ${rows}
    </div></details>`;
}
function openRecipe(id){
  const r = RECIPES.find(x=>x.id===id); if(!r) return;
  const cat = RECIPE_CATS[r.c]||{name:'',emoji:'',g:['#555','#333']};
  const [c1,c2]=cat.g;
  const ing = r.ing.map(i=>`<div class="it">${esc(i)}</div>`).join('');
  const steps = r.st.map(s=>{const i=s.indexOf('|'); const e=s.slice(0,i), t=s.slice(i+1);
    return `<div class="rd-step"><div class="no"></div><div class="se">${e}</div><div class="st">${esc(t)}</div></div>`;}).join('');
  const ph = (window.RECIPE_PHOTOS||{})[r.id];
  const heroPhoto = ph ? `<img class="photo" src="${esc(ph.img)}" alt="${esc(r.n)}">` : '';
  const heroSp = ph ? '' : `<div class="sp" style="top:18%;left:12%">✨</div><div class="sp" style="bottom:14%;right:12%">⭐</div>`;
  $('#recipe-detail-body').innerHTML = `
    <div class="rd-hero" style="background:linear-gradient(140deg,${c1},${c2})">
      ${heroPhoto}
      <button class="close" id="rd-close" aria-label="とじる">✕</button>
      ${heroSp}
      <div class="dish">${r.e}</div>
    </div>
    <div class="rd-body">
      <h3>${esc(r.n)}</h3>
      <div class="nick">${esc(r.nick)}</div>
      <div class="rd-meta">
        <span class="m">⏱️ ${r.t}分</span>
        <span class="m">むずかしさ ${'★'.repeat(r.lv)}${'☆'.repeat(3-r.lv)}</span>
        <span class="m">👦 ${r.sv}人分</span>
        <span class="m">${cat.emoji} ${esc(cat.name)}</span>
      </div>
      <div class="rd-sec"><h4>🧂 材料（ざいりょう）</h4><div class="rd-ing">${ing}</div></div>
      <div class="rd-sec"><h4>👨‍🍳 作り方</h4><div class="rd-steps">${steps}</div></div>
      ${r.tip?`<div class="rd-sec"><h4>💡 コツ</h4><div class="rd-tip">${esc(r.tip)}</div></div>`:''}
      ${r.help?`<div class="rd-help">⚠️ ${esc(r.help)}</div>`:''}
      <button class="btn big" id="rd-use" style="margin-top:18px">✍️ この料理で記録する</button>
    </div>`;
  const bg=$('#recipe-detail'); bg.classList.add('show'); bg.scrollTop=0;
  $('#rd-close').onclick = closeRecipe;
  $('#rd-use').onclick = ()=>useRecipe(r);
}
function closeRecipe(){ $('#recipe-detail').classList.remove('show'); }
function useRecipe(r){
  closeRecipe();
  openNewEntry();
  $('#f-title').value = r.n;
  $('#f-ing').value = r.ing.join('\n');
  $('#f-steps').value = r.st.map(s=>{const i=s.indexOf('|'); return s.slice(i+1);}).join('\n');
  toast('レシピを記録フォームに写したよ！ 作って写真をとろう📸');
}

/* ================= 設定フォーム ================= */
function fillSettingsForm(){
  const s=state.settings;
  $('#s-name').value=s.name||''; $('#s-grade').value=s.grade||'';
  $('#s-title').value=s.title||''; $('#s-goal').value=s.goal||20;
  $('#s-url').value=s.url||'';
  $('#s-sound').value=String(s.sound?1:0);
  $('#s-intro').value=s.intro||''; $('#s-summary').value=s.summary||'';
}
async function saveSettings(){
  state.settings={
    name:$('#s-name').value.trim(), grade:$('#s-grade').value.trim(),
    title:$('#s-title').value.trim()||'クッキングクエスト',
    url:$('#s-url').value.trim(),
    goal:parseInt($('#s-goal').value,10)||20,
    sound:$('#s-sound').value==='1'?1:0,
    intro:$('#s-intro').value, summary:$('#s-summary').value,
  };
  try{ await store.setSettings(state.settings); }catch(e){ console.error(e); toast('保存に失敗…ネットを確認してね'); return; }
  toast('ほぞんしたよ 💾'); SFX.save();
  renderDash();
}

/* ================= デモ & リセット ================= */
async function loadDemo(){
  const ok=await confirmModal('デモを入れる','サンプルの3日分を入れます（いまのデータに追加）。よいですか？');
  if(!ok) return;
  // 1x1 のダミー画像（色ちがい）
  const dummy=(c)=>{const cv=document.createElement('canvas');cv.width=cv.height=400;const x=cv.getContext('2d');
    x.fillStyle=c;x.fillRect(0,0,400,400);x.fillStyle='rgba(255,255,255,.9)';x.font='bold 180px sans-serif';
    x.textAlign='center';x.textBaseline='middle';x.fillText('🍳',200,210);return cv.toDataURL('image/jpeg',.8);};
  const demos=[
    {day:1,title:'オムライス火山もり',ingredients:'たまご 2こ\nごはん 1ぱい\nケチャップ\nたまねぎ',steps:'たまねぎを切って炒めた。\nごはんとケチャップをまぜた。\n卵をふわふわに焼いた。',note:'とろとろにできて自分でもびっくり！',stars:5,yum:'🤤 ぜっぴん！',photos:[dummy('#ff6a2b')]},
    {day:2,title:'ぼくの最強チャーハン',ingredients:'ごはん\nたまご\nネギ\nハム\nしょうゆ',steps:'強火で一気に炒めた。\nパラパラになるよう頑張った。',note:'火かげんがむずかしかった。',stars:4,yum:'😋 おいしい',photos:[dummy('#ffb020')]},
    {day:3,title:'たまごサンド タワー',ingredients:'食パン\nゆでたまご 2こ\nマヨネーズ',steps:'たまごをつぶしてマヨとまぜた。\nパンにはさんで切った。',note:'高くつみ上げたらかっこよくなった！',stars:5,yum:'🤤 ぜっぴん！',photos:[dummy('#39e08b')]},
  ];
  const base=state.entries.length? Math.max(...state.entries.map(e=>e.day)) : 0;
  for(let i=0;i<demos.length;i++){
    const d=demos[i]; const day=base+d.day;
    const e={id:'demo_'+day+'_'+i,day,date:todayStr(),...d};
    const se=await store.putEntry(e); state.entries.push(se);
  }
  state.entries.sort((a,b)=>a.day-b.day);
  toast('デモを入れたよ 🧪'); show('dash');
}
async function resetAll(){
  const ok=await confirmModal('全部リセット','ほんとうに ぜんぶ消しますか？（もとに戻せません）');
  if(!ok) return;
  await store.clearEntries(); state.entries=[];
  toast('リセットしたよ'); show('dash');
}

/* ================= イベント配線 ================= */
function wire(){
  // ログイン
  $('#login-btn').addEventListener('click',doLogin);
  $('#login-pass').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
  $('#login-toggle').addEventListener('change',e=>{ $('#login-pass').type = e.target.checked?'text':'password'; });

  // ヘッダーの共有QR
  $('#header-qr').addEventListener('click', openShareQR);
  $('#qr-close').addEventListener('click', ()=>$('#qr-modal').classList.remove('show'));
  $('#qr-modal').addEventListener('click', e=>{ if(e.target.id==='qr-modal') $('#qr-modal').classList.remove('show'); });
  $('#qr-copy').addEventListener('click', ()=>{
    const el=$('#qr-url'); el.select();
    const done=()=>{ toast('URLをコピーしたよ📋 ほかの端末でひらいてね'); SFX.click(); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(el.value).then(done,done);
    else { try{document.execCommand('copy');}catch(e){} done(); }
  });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && $('#qr-modal').classList.contains('show')) $('#qr-modal').classList.remove('show'); });

  // ナビ
  $('#nav').addEventListener('click',e=>{
    const b=e.target.closest('button[data-view]'); if(!b) return;
    // 「記録する」を押したら、まだ入力中でなければ新しい記録を用意
    if(b.dataset.view==='entry' && !$('#entry').classList.contains('active')){ openNewEntry(); }
    else show(b.dataset.view);
  });

  // ダッシュボード：セルクリック
  $('#grid-days').addEventListener('click',e=>{
    const cell=e.target.closest('.daycell'); if(!cell)return;
    if(cell.dataset.edit) openEditEntry(cell.dataset.edit);
    else if(cell.dataset.new) openNewEntry(+cell.dataset.new);
  });
  $('#quick-add').addEventListener('click',()=>openNewEntry());

  // レシピ図鑑
  $('#recipe-cats').addEventListener('click',e=>{
    const c=e.target.closest('[data-cat]'); if(!c)return;
    recipeCat=c.dataset.cat; renderRecipes(); SFX.click();
  });
  $('#recipe-grid').addEventListener('click',e=>{
    const card=e.target.closest('[data-recipe]'); if(!card)return;
    openRecipe(card.dataset.recipe); SFX.click();
  });
  $('#recipe-detail').addEventListener('click',e=>{ if(e.target.id==='recipe-detail') closeRecipe(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && $('#recipe-detail').classList.contains('show')) closeRecipe(); });

  // フォーム：写真
  const dz=$('#dropzone'), fileInput=$('#f-photo');
  dz.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',e=>{addPhotoFiles(e.target.files);fileInput.value='';});
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag');}));
  dz.addEventListener('drop',e=>{ if(e.dataTransfer.files.length) addPhotoFiles(e.dataTransfer.files); });
  // ページ全体でもドロップ受け（フォーム表示中）
  window.addEventListener('dragover',e=>e.preventDefault());
  window.addEventListener('drop',e=>{ if($('#entry').classList.contains('active')&&e.dataTransfer.files.length){e.preventDefault();addPhotoFiles(e.dataTransfer.files);} });

  $('#photos').addEventListener('click',e=>{
    const del=e.target.closest('[data-del]'); const mv=e.target.closest('[data-mv]');
    if(del){ state.draftPhotos.splice(+del.dataset.del,1); renderDraftPhotos(); SFX.click(); }
    else if(mv){ const [i,d]=mv.dataset.mv.split(':').map(Number); const j=i+d;
      if(j>=0&&j<state.draftPhotos.length){ const a=state.draftPhotos; [a[i],a[j]]=[a[j],a[i]]; renderDraftPhotos(); } }
  });

  // 星
  $('#stars').addEventListener('click',e=>{const s=e.target.closest('span[data-v]');if(s){draftStars=+s.dataset.v;renderStars();SFX.click();}});

  // 保存・削除・キャンセル
  $('#save-entry').addEventListener('click',saveEntry);
  $('#entry-cancel').addEventListener('click',()=>{state.editingId=null;state.draftPhotos=[];show('dash');});
  $('#entry-delete').addEventListener('click',async()=>{
    if(!state.editingId)return;
    const ok=await confirmModal('この日を消す','この日の記録を消しますか？');
    if(!ok)return;
    await store.delEntry(state.editingId);
    state.entries=state.entries.filter(e=>e.id!==state.editingId);
    state.editingId=null; toast('消したよ'); show('dash');
  });

  // 発表
  $('#start-present').addEventListener('click',startPresent);
  $('#pv-prev').addEventListener('click',()=>goSlide(slideIdx-1));
  $('#pv-next').addEventListener('click',()=>goSlide(slideIdx+1));
  $('#pv-exit').addEventListener('click',exitPresent);
  $('#pv-full').addEventListener('click',()=>{ const el=$('#present-view');
    if(!document.fullscreenElement) el.requestFullscreen&&el.requestFullscreen().catch(()=>{}); else document.exitFullscreen(); });
  document.addEventListener('keydown',e=>{
    if(!$('#present-view').classList.contains('active'))return;
    if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();goSlide(slideIdx+1);}
    else if(e.key==='ArrowLeft'){goSlide(slideIdx-1);}
    else if(e.key==='Escape'){exitPresent();}
    else if(e.key==='f'||e.key==='F'){$('#pv-full').click();}
  });
  // スワイプ
  let tx0=null;
  $('#present-view').addEventListener('touchstart',e=>tx0=e.touches[0].clientX,{passive:true});
  $('#present-view').addEventListener('touchend',e=>{ if(tx0==null)return; const dx=e.changedTouches[0].clientX-tx0;
    if(Math.abs(dx)>50) goSlide(slideIdx+(dx<0?1:-1)); tx0=null; });

  // 印刷
  ['#p-size','#p-orient','#p-layout','#p-cover','#p-docs','#p-qr'].forEach(sel=>$(sel).addEventListener('change',renderReport));
  $('#do-print').addEventListener('click',()=>{ applyPageStyle(); setTimeout(()=>window.print(),120); });
  window.addEventListener('resize',()=>{ if($('#print-view').classList.contains('active')) renderReport(); });

  // 設定・書き出し
  $('#save-settings').addEventListener('click',saveSettings);
  $('#copy-url').addEventListener('click',()=>{
    const el=$('#share-url'); el.select();
    const done=()=>{ toast('URLをコピーしたよ📋 ほかの端末でひらいてね'); SFX.click(); };
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(el.value).then(done,()=>{document.execCommand('copy');done();}); }
    else { try{document.execCommand('copy');}catch(e){} done(); }
  });
  $('#export-json').addEventListener('click',exportJSON);
  $('#import-json').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',e=>{ if(e.target.files[0]) importJSON(e.target.files[0]); e.target.value=''; });
  $('#export-site').addEventListener('click',exportSite);
  $('#load-demo').addEventListener('click',loadDemo);
  $('#reset-all').addEventListener('click',resetAll);
}

/* ================= 起動 ================= */
async function boot(){
  renderPixelLogo();
  renderHeroLogo();
  const cloudOK = (window.Cloud && Cloud.configured() && Cloud.init());
  store = cloudOK ? Cloud : dbAdapter;
  try{
    if(!cloudOK) await DB.init();               // ローカル予備のみ初期化
    const savedSettings = await store.getSettings();
    if(savedSettings) state.settings={...state.settings,...savedSettings};
    else if(cloudOK){ try{ await store.setSettings(state.settings); }catch(e){} } // 初期設定をクラウドに種まき（発表ページ用）
    state.entries=(await store.allEntries()).sort((a,b)=>a.day-b.day);
  }catch(e){
    console.error('データ読み込み失敗',e);
    toast(cloudOK?'クラウドに接続できませんでした…ネットを確認':'保存機能が使えないかも');
  }
  fillSettingsForm();
  updateShareUrl();
  wire();
  renderDash();
  applyPageStyle();
  // すでにログイン済みならログイン画面をスキップ
  if(isAuthed()){ $('#login').classList.add('hidden'); afterLogin(); }
  else setTimeout(()=>{ try{ $('#login-pass').focus(); }catch(e){} },100);
}
// ログイン後（クラウドが空なら、この端末のローカル記録の引っ越しを提案）
let migrateChecked=false;
async function afterLogin(){
  if(migrateChecked) return; migrateChecked=true;
  if(store!==Cloud) return;
  if(state.entries.length>0) return;
  try{ localStorage.getItem('cq_ws'); }catch(e){}
  let local=[];
  try{ await DB.init(); local=await DB.allEntries(); }catch(e){}
  if(!local.length) return;
  const ok=await confirmModal('クラウドへ引っ越し',`この端末に ${local.length}日分 の記録があります。クラウドに移して、ほかの端末でも見られるようにしますか？`);
  if(!ok) return;
  toast('引っ越し中…写真をアップロード中');
  for(const e of local){ try{ await Cloud.putEntry(e); }catch(err){ console.error(err); } }
  try{ const ls=await DB.getMeta('settings'); if(ls) state.settings={...state.settings,...ls}; await Cloud.setSettings(state.settings); }catch(e){}
  state.entries=(await Cloud.allEntries()).sort((a,b)=>a.day-b.day);
  fillSettingsForm(); renderDash();
  toast('引っ越し完了！🎉 このURLをほかの端末でも開いてね');
}
function updateShareUrl(){
  const el=$('#share-url'); if(!el) return;
  if(store===Cloud){
    el.value = Cloud.shareUrl();
    const n=$('#ws-note'); if(n) n.textContent = 'ワークスペースID: '+Cloud.getWs()+'（このIDが同じ端末どうしで共有されます）';
  }else{
    el.value = '（クラウド未設定：この端末だけに保存されています）';
  }
}
document.addEventListener('DOMContentLoaded',boot);

/* ================= 発表サイト テンプレート ================= */
const SITE_TEMPLATE = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>__TITLE__</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="icon" href="favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,"Hiragino Maru Gothic ProN","Yu Gothic",sans-serif;background:#0b1020;color:#eef2ff;overflow:hidden}
#s{position:fixed;inset:0}
.sl{position:absolute;inset:0;display:none;flex-direction:column;padding:4vmin 5vmin 96px;overflow:hidden}
.sl.on{display:flex;animation:in .5s cubic-bezier(.2,.9,.2,1) both}
@keyframes in{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:none}}
.k{color:#ffd23f;font-weight:900;letter-spacing:2px;font-size:clamp(14px,2.4vmin,22px)}
h1{font-size:clamp(30px,7vmin,74px);margin:.2em 0;line-height:1.05}
.ph{flex:1;display:grid;gap:2vmin;min-height:0}
.ph img{width:100%;height:100%;object-fit:cover;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.6)}
.m{display:flex;flex-wrap:wrap;gap:2vmin;margin-top:2vmin;font-size:clamp(15px,2.6vmin,26px)}
.m .b{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:1.4vmin 2vmin}
.m .b b{color:#ffd23f}
.cover{align-items:center;justify-content:center;text-align:center;background:radial-gradient(800px 500px at 50% 0%,rgba(255,106,43,.35),transparent 60%)}
.plate{font-size:clamp(70px,18vmin,200px);animation:spin 14s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.bar{position:absolute;inset:auto 0 0 0;display:flex;gap:14px;align-items:center;padding:14px 20px;background:linear-gradient(0deg,rgba(0,0,0,.6),transparent)}
.bar button{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;border-radius:12px;padding:10px 16px;font-weight:900;font-size:16px;cursor:pointer}
.prog{flex:1;height:8px;border-radius:6px;background:rgba(255,255,255,.15);overflow:hidden}
.prog i{display:block;height:100%;background:linear-gradient(90deg,#ffb020,#ff2e63);width:0;transition:.4s}
.no{font-weight:900;min-width:64px;text-align:center}
</style></head><body>
<div id="s"></div>
<div class="bar"><button onclick="go(i-1)">←</button><div class="no" id="no"></div><div class="prog"><i id="pi"></i></div><button onclick="fs()">⛶</button><button onclick="go(i+1)">→</button></div>
<script>
const D=__DATA__;
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nl=s=>esc(s).replace(/\\n/g,'<br>');
const fd=s=>{if(!s)return'';const d=new Date(s+'T00:00:00');if(isNaN(d))return s;const w=['日','月','火','水','木','金','土'][d.getDay()];return (d.getMonth()+1)+'月'+d.getDate()+'日('+w+')';};
const S=D.settings,E=D.entries.slice().sort((a,b)=>a.day-b.day);
let slides=[];
slides.push('<div class="sl cover"><div class="plate">🍽️</div><div class="k">じゆうけんきゅう / COOKING QUEST</div><h1>'+esc(S.title||'')+'</h1><div class="m" style="justify-content:center"><div class="b"><b>なまえ</b> '+esc(S.name||'')+'</div><div class="b"><b>クラス</b> '+esc(S.grade||'')+'</div><div class="b"><b>クリア</b> '+E.length+'日</div></div></div>');
if(S.intro&&S.intro.trim())slides.push('<div class="sl"><div class="k">はじめに</div><h1>なぜ やろうと思ったか 💡</h1><div class="m"><div class="b" style="font-size:clamp(18px,3.4vmin,34px);line-height:1.6">'+nl(S.intro)+'</div></div></div>');
E.forEach(e=>{const p=(e.photos||[]).slice(0,4);let g='1fr';if(p.length===2)g='1fr 1fr';if(p.length===3)g='2fr 1fr';if(p.length>=4)g='1fr 1fr';
const ph=p.length?'<div class="ph" style="grid-template-columns:'+g+'">'+p.map(x=>'<img src="'+x+'">').join('')+'</div>':'<div class="ph" style="place-items:center;font-size:12vmin">🍽️</div>';
const st='⭐'.repeat(e.stars||0);
slides.push('<div class="sl"><div class="k">'+e.day+'日目 ・ '+esc(fd(e.date))+'</div><h1>'+esc(e.title||'')+'</h1>'+ph+'<div class="m">'+(e.ingredients?'<div class="b"><b>材料</b> '+esc((e.ingredients||'').split("\\n").filter(Boolean).join("、"))+'</div>':'')+(e.yum?'<div class="b">'+esc(e.yum)+'</div>':'')+(st?'<div class="b">'+st+'</div>':'')+(e.note?'<div class="b"><b>ひとこと</b> '+esc(e.note)+'</div>':'')+'</div></div>');});
if(S.summary&&S.summary.trim())slides.push('<div class="sl"><div class="k">まとめ</div><h1>やってみて わかったこと 🏁</h1><div class="m"><div class="b" style="font-size:clamp(18px,3.4vmin,34px);line-height:1.6">'+nl(S.summary)+'</div></div></div>');
slides.push('<div class="sl cover"><div class="plate">🎉</div><h1>おわり</h1><div class="k">みてくれて ありがとう！</div></div>');
document.getElementById('s').innerHTML=slides.join('');
const els=[...document.querySelectorAll('.sl')];let i=0;
function go(n){i=Math.max(0,Math.min(els.length-1,n));els.forEach((el,k)=>el.classList.toggle('on',k===i));document.getElementById('no').textContent=(i+1)+' / '+els.length;document.getElementById('pi').style.width=((i+1)/els.length*100)+'%';}
function fs(){if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen();}
addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();go(i+1);}else if(e.key==='ArrowLeft')go(i-1);else if(e.key==='f')fs();});
let tx=null;addEventListener('touchstart',e=>tx=e.touches[0].clientX,{passive:true});addEventListener('touchend',e=>{if(tx==null)return;const dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>50)go(i+(dx<0?1:-1));tx=null;});
go(0);
<\/script></body></html>`;

})();
