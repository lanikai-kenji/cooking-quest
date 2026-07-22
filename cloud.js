/* =========================================================
   クッキングクエスト  cloud.js
   Supabase を使ったクラウド保存（全端末で同じデータを共有）
   - entries / app_settings テーブル、photos ストレージ
   - ワークスペースID(ws) を URL(#ws=...) に持たせて共有
   ========================================================= */
window.Cloud = (function(){
  'use strict';
  const cfg = window.CLOUD || {};
  let client = null, ws = null;

  const configured = ()=> !!(cfg.url && cfg.key && window.supabase);

  function hex(n){
    const a = crypto.getRandomValues(new Uint8Array(n));
    let s=''; for(const b of a) s += ('0'+b.toString(16)).slice(-2);
    return s;
  }
  function genWs(){ return 'ws-' + hex(9); }         // 推測不能な18桁ID
  function baseUrl(){ return location.href.split('#')[0]; }
  function setHash(){
    try{
      if((location.hash||'').indexOf('ws=')<0)
        history.replaceState(null,'', baseUrl()+'#ws='+ws);
    }catch(e){}
  }
  function resolveWs(){
    const m = (location.hash||'').match(/ws=([A-Za-z0-9\-]+)/);
    if(m){ ws=m[1]; try{localStorage.setItem('cq_ws',ws);}catch(e){} return; }
    try{ const s=localStorage.getItem('cq_ws'); if(s){ ws=s; setHash(); return; } }catch(e){}
    ws = genWs(); try{localStorage.setItem('cq_ws',ws);}catch(e){}
    setHash();
  }

  function init(){
    if(!configured()) return false;
    try{
      client = window.supabase.createClient(cfg.url, cfg.key, { auth:{ persistSession:false } });
      resolveWs();
      return true;
    }catch(e){ console.error('Cloud.init失敗', e); return false; }
  }

  const getWs = ()=> ws;
  const shareUrl = ()=> baseUrl().replace(/[^/]*$/, function(f){return f.indexOf('present')>=0?'index.html':f;}) + '#ws=' + ws;
  const presentUrl = ()=> baseUrl().replace(/[^/]*$/, 'present.html') + '#ws=' + ws;

  function dataURLtoBlob(d){
    const [head,b64] = d.split(',');
    const mime = (head.match(/:(.*?);/)||[])[1] || 'image/jpeg';
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return new Blob([arr], {type:mime});
  }
  async function uploadPhoto(dataUrl, entryId, i){
    const path = `${ws}/${entryId}_${i}_${hex(3)}.jpg`;
    const { error } = await client.storage.from('photos')
      .upload(path, dataURLtoBlob(dataUrl), { contentType:'image/jpeg', upsert:true });
    if(error) throw error;
    return client.storage.from('photos').getPublicUrl(path).data.publicUrl;
  }

  const rowToEntry = r => ({ id:r.id, day:r.day, date:r.date, title:r.title,
    ingredients:r.ingredients, steps:r.steps, note:r.note, stars:r.stars,
    yum:r.yum, photos:r.photos||[], createdAt:r.created_at });

  async function allEntries(){
    const { data, error } = await client.from('entries').select('*')
      .eq('ws', ws).order('day', { ascending:true });
    if(error) throw error;
    return (data||[]).map(rowToEntry);
  }
  async function putEntry(e){
    const photos = [];
    for(let i=0;i<(e.photos||[]).length;i++){
      const p = e.photos[i];
      photos.push((typeof p==='string' && p.startsWith('data:')) ? await uploadPhoto(p, e.id, i) : p);
    }
    const row = { id:e.id, ws, day:e.day, date:e.date, title:e.title,
      ingredients:e.ingredients, steps:e.steps, note:e.note, stars:e.stars,
      yum:e.yum, photos, created_at:e.createdAt||Date.now(), updated_at:Date.now() };
    const { error } = await client.from('entries').upsert(row);
    if(error) throw error;
    return rowToEntry(row);
  }
  async function delEntry(id){
    const { error } = await client.from('entries').delete().eq('ws', ws).eq('id', id);
    if(error) throw error;
    try{ // 写真のお片づけ（できれば）
      const { data } = await client.storage.from('photos').list(ws, { limit:100 });
      const rm = (data||[]).filter(o=>o.name.indexOf(id+'_')===0).map(o=>ws+'/'+o.name);
      if(rm.length) await client.storage.from('photos').remove(rm);
    }catch(e){}
  }
  async function clearEntries(){
    const { error } = await client.from('entries').delete().eq('ws', ws);
    if(error) throw error;
  }
  async function getSettings(){
    const { data, error } = await client.from('app_settings').select('data').eq('ws', ws).maybeSingle();
    if(error) throw error;
    return data ? data.data : undefined;
  }
  async function setSettings(s){
    const { error } = await client.from('app_settings').upsert({ ws, data:s, updated_at:Date.now() });
    if(error) throw error;
  }

  return { configured, init, getWs, shareUrl, presentUrl,
           allEntries, putEntry, delEntry, clearEntries, getSettings, setSettings };
})();
