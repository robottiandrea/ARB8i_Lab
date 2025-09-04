(function(){
  const META_SOURCES = ['./Doodles_all_metadata.json'];
  let metaReady=false, metaIndex=null;
  let doodleIndex=null, triedDoodleIndex=false;

  function ipfsToHttps(u){
    if(!u) return u;
    if(u.startsWith('ipfs://')){
      const hash = u.replace('ipfs://','').replace(/^ipfs\//,'');
      return `https://dweb.link/ipfs/${hash}`;
    }
    return u;
  }
  function pickId(obj, fallback){ return obj?.id ?? obj?.tokenId ?? obj?.token_id ?? obj?.index ?? fallback ?? null; }
  function pickImage(obj){ return obj?.image ?? obj?.image_url ?? obj?.imageUrl ?? null; }

  async function ensureMetaIndex(){
    if(metaReady) return;
    for(const src of META_SOURCES){
      try{
        const r = await fetch(src, {cache:'no-store'}); if(!r.ok) continue;
        const data = await r.json(); const map = new Map();
        if(Array.isArray(data)){
          for(const it of data){ const id=pickId(it); const img=pickImage(it);
            if(id!=null && img) map.set(String(id), ipfsToHttps(String(img))); }
        }else if(data && typeof data==='object'){
          for(const [k,v] of Object.entries(data)){
            const id=pickId(v,k); const img=(typeof v==='string')?v:pickImage(v);
            if(id!=null && img) map.set(String(id), ipfsToHttps(String(img)));
          }
        }
        if(map.size){ metaIndex = map; metaReady = true; return; }
      }catch{}
    }
    metaIndex = null; metaReady = true;
  }
  async function ensureDoodleIndex(){
    if(triedDoodleIndex) return;
    triedDoodleIndex = true;
    try{ const r=await fetch('./doodles/index.json',{cache:'no-store'});
         if(r.ok) doodleIndex = await r.json(); }catch{}
  }
  async function buildCandidateUrls(id){
    const urls=[]; const key = String(id);
    await ensureMetaIndex();
    if(metaIndex && metaIndex.has(key)) urls.push(metaIndex.get(key));
    await ensureDoodleIndex();
    if(doodleIndex && doodleIndex[key]) urls.push(String(doodleIndex[key]));
    urls.push(`./doodles/thumbs/${key}.png`,`./doodles/thumbs/${key}.jpg`,
              `./doodles/${key}.png`,`./doodles/${key}.jpg`);
    return urls;
  }
  function tryLoadIntoPreview(previewEl, id, url){
    return new Promise(resolve=>{
      const img = new Image(); img.decoding='async'; img.alt=`Anteprima Doodle #${id}`;
      img.onload = ()=>{ if(previewEl.dataset.id===String(id)){ previewEl.innerHTML=''; previewEl.appendChild(img); resolve(true);} else resolve(false); };
      img.onerror = ()=> resolve(false);
      img.src = url;
    });
  }

  function normalizeId(v, max=99999){
    const s = String(v||'').trim().replace(/\D+/g,'');
    if(s==='') return {value:'', valid:false, empty:true};
    const n = parseInt(s,10);
    if(Number.isFinite(n) && n>=0 && n<=max) return {value:String(n), valid:true, empty:false};
    return {value:s, valid:false, empty:false};
  }

  /* ==== “Input con X” automatico per tutti gli .id-input ==== */
  function ensureId(el){
    if(!el.id) el.id = 'ocid_' + Math.random().toString(36).slice(2,8);
    return el.id;
  }
  function wrapInInputClear(el){
    const p = el.parentElement;
    if(p && p.classList && p.classList.contains('input-clear')) return p;
    const w = document.createElement('div');
    w.className = 'input-clear';
    if(p){ p.insertBefore(w, el); w.appendChild(el); }
    return w;
  }
  function addClearToInput(input, afterClear){
    if(!input) return;
    const id = ensureId(input);
    const wrap = wrapInInputClear(input);
    if(wrap.querySelector(`.clear-btn[data-clear-for="${id}"]`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'clear-btn';
    btn.setAttribute('data-clear-for', id);
    btn.setAttribute('aria-label', 'Pulisci');
    wrap.appendChild(btn);

    const toggle = () => btn.classList.toggle('show', !!input.value);
    input.addEventListener('input', toggle);

    btn.addEventListener('click', () => {
      input.value = '';
      // Hook globale (facoltativo per le pagine)
      if (typeof window.OC?.onIdCleared === 'function'){
        try { window.OC.onIdCleared(input); } catch(_){}
      }
      if (typeof afterClear === 'function'){
        try { afterClear(); } catch(_){}
      }
      input.dispatchEvent(new Event('input', { bubbles:true }));
      input.focus();
      toggle();
    });

    toggle();
  }
  function autoClearInputs(selector='.id-input'){
    document.querySelectorAll(selector).forEach(el => addClearToInput(el));
  }

  // Retro-compat con Trait Viewer (se lo usi lì)
  function wireClear(inputId, afterClear){
    const inp = document.getElementById(inputId);
    if(!inp) return;
    addClearToInput(inp, afterClear);
  }

  /* ==== Mini-anteprima Doodle e controllo unico ==== */
  function createIdPreview({input, preview, defaultId='8929', max=99999}){
    async function apply(id){
      if(!preview) return;
      const val = (id||id===0) ? String(id) : '';
      if(!val){ return reset(); }
      preview.style.display='block';
      preview.dataset.id = val;
      preview.classList.add('loading');
      preview.innerHTML = `<span class="id-badge">#${val}</span>`;
      const urls = await buildCandidateUrls(val);
      for(const url of urls){ if(preview.dataset.id!==val) return; const ok = await tryLoadIntoPreview(preview, val, url); if(ok) break; }
      preview.classList.remove('loading');
    }
    function reset(){ return apply(defaultId); }

    if(input){
      input.addEventListener('input', ()=>{
        const s = input.value.replace(/\D+/g,'');
        if(s!==input.value) input.value = s;
        if(s===''){ reset(); return; }
        const n = parseInt(s,10);
        if(Number.isFinite(n) && n>=0 && n<=max) apply(n);
      });
    }
    reset();
    return { apply, reset };
  }

  /* ==== Inizializzatore “tutto in uno” per l’ID ==== */
  function initIdControl(opts){
    const {
      input,            // CSS selector o HTMLElement dell’input
      preview,          // CSS selector o HTMLElement della mini-anteprima (opzionale)
      button,           // CSS selector o HTMLElement del bottone Apply (opzionale)
      defaultId='8929',
      max=99999,
      onApply,          // callback(id) quando clicchi il bottone o Enter con ID valido
      onValidChange,    // callback(boolean) ogni volta che cambia la validità
      onClear           // callback() quando si clicca la X
    } = opts || {};

    const inputEl  = typeof input==='string'  ? document.querySelector(input)  : input;
    const previewEl= typeof preview==='string'? document.querySelector(preview): preview;
    const buttonEl = typeof button==='string' ? document.querySelector(button) : button;

    if(!inputEl) return null;

    // X automatica + hook onClear
    addClearToInput(inputEl, ()=>{ if(typeof onClear==='function') onClear(); });

    // anteprima condivisa
    const prevCtrl = previewEl ? createIdPreview({ input: inputEl, preview: previewEl, defaultId, max }) : null;

    // validazione + stato bottone
    const setValidity = ()=>{
      const st = normalizeId(inputEl.value, max);
      if(buttonEl) buttonEl.disabled = !st.valid;
      if(typeof onValidChange==='function') onValidChange(!!st.valid, st);
      return st;
    };
    inputEl.addEventListener('input', setValidity);
    inputEl.addEventListener('keydown', e=>{
      if(e.key==='Enter' && onApply){
        const st = normalizeId(inputEl.value, max);
        if(st.valid){ e.preventDefault(); onApply(st.value); }
      }
    });
    if(buttonEl && onApply){
      buttonEl.addEventListener('click', ()=>{
        const st = normalizeId(inputEl.value, max);
        if(st.valid) onApply(st.value);
      });
    }

    // prima valutazione
    setValidity();

    return {
      get value(){ const st=normalizeId(inputEl.value, max); return st.valid?st.value:null; },
      set value(v){ inputEl.value = (v==null ? '' : String(v)); inputEl.dispatchEvent(new Event('input',{bubbles:true})); },
      resetPreview(){ prevCtrl?.reset?.(); },
      applyPreview(id){ prevCtrl?.apply?.(id); }
    };
  }

  // API esposte
  window.OC = Object.assign(window.OC||{}, {
    normalizeId,
    wireClear,              // compat
    addClearToInput,        // opzionale
    autoClearInputs,        // X auto per tutti gli .id-input
    createIdPreview,        // opzionale
    initIdControl           // ← usa questa nei file pagina
  });

  // X automatica su tutti gli .id-input presenti
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => autoClearInputs());
  } else {
    autoClearInputs();
  }
})();
