console.log("SWFL app booted");

// === CONFIG ===
const SUPABASE_URL = "https://kkmxxabpfttaaflxihpj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrbXh4YWJwZnR0YWFmbHhpaHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1MDkzMjksImV4cCI6MjA3MjA4NTMyOX0.GzseBIOcZ4RwrsrqQ4liYCWd2NdC_YDJIEca1tFy3_s";
const SHARED_APP_KEY = "A2MPSWFL";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Active filter for SWFL pills
let CURRENT_FILTER = 'today';

// === IDENTITY (full name or initials) ===
(function ensureIdentity() {
  let whoVal = localStorage.getItem('who');
  if (!whoVal) {
    const entered = (prompt("Enter your name or initials (how you want it stamped)") || "").trim();
    if (!entered) { alert("Required"); return ensureIdentity(); }
    whoVal = entered.slice(0,32);
    localStorage.setItem('who', whoVal);
  }
  const badge = document.getElementById('whoami');
  if (badge) badge.textContent = `You: ${whoVal}`;
})();
function who(){ return localStorage.getItem('who') || ''; }

// === DOM READY ===
document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  const tabs = document.querySelectorAll('.tab');
  const panels = {
    todo: document.getElementById('tab-todo'),
    cbl: document.getElementById('tab-cbl'),
    acct: document.getElementById('tab-acct'),
    notes: document.getElementById('tab-notes'),
    completed: document.getElementById('tab-completed')
  };
  function show(tabKey){
    Object.values(panels).forEach(p => p.classList.remove('active'));
    panels[tabKey].classList.add('active');
    if (tabKey === 'completed') loadCompleted({ reset:true });
  }
  tabs.forEach(btn => btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    show(btn.dataset.tab);
  }));
  show('todo');

  // SWFL filter pills
  const pills = document.querySelectorAll('#tab-todo .pill');
  pills.forEach(p => p.addEventListener('click', () => {
    pills.forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    CURRENT_FILTER = p.dataset.filter;
    loadTodos(CURRENT_FILTER);
  }));

  // SWFL recurrence pickers
  document.getElementById('recurrence').addEventListener('change', (e) => {
    const v = e.target.value;
    document.getElementById('customDays').style.display = (v === 'custom') ? '' : 'none';
    document.getElementById('dtRow').style.display     = (v === 'custom' || v === 'oneoff') ? '' : 'none';
    document.getElementById('weekRow').style.display   = (v === 'weekly')  ? '' : 'none';
    document.getElementById('monthRow').style.display  = (v === 'monthly') ? '' : 'none';
  });

  // CBL/Axonify form toggles
  const typeSel = document.getElementById('cblType');
  typeSel.addEventListener('change', () => {
    const isAx = typeSel.value === 'Axonify';
    document.getElementById('cblDueRow').style.display = isAx ? 'none' : '';
    document.getElementById('axSeedRow').style.display = isAx ? '' : 'none';
  });

  // Forms
  document.getElementById('newTaskForm')?.addEventListener('submit', onAddSWFL);
  document.getElementById('cblForm')?.addEventListener('submit', onAddCBL);
  document.getElementById('acctForm')?.addEventListener('submit', onAddAcct);
  document.getElementById('notePost')?.addEventListener('click', (e)=>{ e.preventDefault(); onAddNote(e); });
  document.getElementById('noteForm')?.addEventListener('submit', onAddNote);

  // Completed tab
  document.getElementById('completedRefresh')?.addEventListener('click', () => loadCompleted({ reset:true }));
  document.getElementById('completedMore')?.addEventListener('click', () => loadCompleted());

  // Initial load + realtime
  loadAll();
  subscribeRealtime();
});

// === DATE HELPERS (5 AM working day) ===
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(5,0,0,0);
  if (d.getHours() < 5) x.setDate(x.getDate() - 1);
  return x;
}
function endOfDay(d) { const s = startOfDay(d); const e = new Date(s); e.setDate(e.getDate()+1); e.setMilliseconds(-1); return e; }

// Walmart week Sat–Fri (5am boundary)
function startOfWeekSat(d){
  const s = startOfDay(d);
  const back = (s.getDay() + 1) % 7; // Sat=6 -> 0 back, Sun=0 -> 1, Mon=1 -> 2...
  s.setDate(s.getDate() - back);
  return s;
}
function endOfWeekSat(d){ const s = startOfWeekSat(d); const e = new Date(s); e.setDate(e.getDate()+7); e.setMilliseconds(-1); return e; }

function startOfMonth5(d){ const s = startOfDay(d); s.setDate(1); return s; }
function endOfMonth5(d){ const s = startOfMonth5(d); const e = new Date(s); e.setMonth(e.getMonth()+1); e.setMilliseconds(-1); return e; }

// Walmart fiscal year start (first Sat on/after Feb 1)
function walmartFiscalYearStart(date){
  const y = date.getFullYear();
  let fy = new Date(y, 1, 1, 5, 0, 0, 0); // Feb 1 @ 5:00
  while (fy.getDay() !== 6) fy.setDate(fy.getDate()+1); // roll to Sat
  if (startOfWeekSat(date) < fy) {
    fy = new Date(y-1, 1, 1, 5, 0, 0, 0);
    while (fy.getDay() !== 6) fy.setDate(fy.getDate()+1);
  }
  return fy;
}
function walmartWeekNumber(date){
  const weekStart = startOfWeekSat(date);
  const fyStart   = walmartFiscalYearStart(date);
  const diffMs    = weekStart - fyStart;
  return Math.floor(diffMs / (7*24*60*60*1000)) + 1;
}

// Month display
function monthLabel(date){ return date.toLocaleString(undefined, { month:'short', year:'numeric' }); }

// Custom (daily-picked-days) next occurrence
function nextCustom(fromISO, activeDaysCSV){
  const base = new Date(fromISO);
  const hours = base.getHours(), mins = base.getMinutes();
  const active = (activeDaysCSV||'').split(',').map(s=>s.trim()).filter(Boolean);
  if (!active.length) return null;
  for (let i=0;i<14;i++){
    const cand = new Date();
    cand.setDate(cand.getDate()+i);
    const dow = DOW[cand.getDay()];
    if (active.includes(dow)){
      cand.setHours(hours, mins, 0, 0);
      if (cand.getTime() > Date.now()) return cand;
    }
  }
  return null;
}

// === ORDER PERSIST HELPERS ===
async function persistOrder(table, listEl){
  const rows = Array.from(listEl.querySelectorAll('li.card[data-id]'));
  const updates = rows.map((li, idx) => ({ id: Number(li.dataset.id), SortOrder: (idx+1)*10 }));
  for (const u of updates){
    await sb.from(table).update({ SortOrder: u.SortOrder, AppKey: SHARED_APP_KEY }).eq('id', u.id);
  }
}
async function persistSwflOrder(listEl){ return persistOrder('TaskInstances', listEl); }

// === AUTO-REFRESH WINDOWS & DAILY PURGE ===
async function refreshCadenceWindows(){
  const now = new Date();
  const weekS  = startOfWeekSat(now);
  const monthS = startOfMonth5(now);
  const dayS   = startOfDay(now);

  // Weekly/Monthly (SWFL): reset for new window if previously Done
  const { data: swfl, error: swflErr } = await sb.from('TaskInstances')
    .select('*').eq('AppKey', SHARED_APP_KEY).in('Recurrence', ['weekly','monthly']);
  if (!swflErr && swfl) {
    for (const row of swfl){
      if (row.Status === 'Done' && row.CompletedAt){
        if (row.Recurrence === 'weekly' && new Date(row.CompletedAt) < weekS){
          const nextDue = new Date(weekS);
          const orig = new Date(row.DueDateTime);
          nextDue.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
          await sb.from('TaskInstances').update({
            Status:'Not Started', CompletedByInitials:null, CompletedAt:null,
            DueDateTime: nextDue.toISOString(), AppKey: SHARED_APP_KEY
          }).eq('id', row.id);
        }
        if (row.Recurrence === 'monthly' && new Date(row.CompletedAt) < monthS){
          const nextDue = new Date(monthS);
          const orig = new Date(row.DueDateTime);
          nextDue.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
          await sb.from('TaskInstances').update({
            Status:'Not Started', CompletedByInitials:null, CompletedAt:null,
            DueDateTime: nextDue.toISOString(), AppKey: SHARED_APP_KEY
          }).eq('id', row.id);
        }
      }
    }
  }

  // Custom (daily-picked-days): if completed before today's 5am, clear stamp
  {
    const { data: customDone, error: cErr } = await sb.from('TaskInstances')
      .select('id, CompletedAt')
      .eq('AppKey', SHARED_APP_KEY)
      .eq('Recurrence', 'custom')
      .eq('Status', 'Done')
      .lt('CompletedAt', dayS.toISOString());
    if (!cErr && customDone && customDone.length){
      const ids = customDone.map(r => r.id);
      await sb.from('TaskInstances').update({
        Status: 'Not Started',
        CompletedByInitials: null,
        CompletedAt: null,
        AppKey: SHARED_APP_KEY
      }).in('id', ids);
    }
  }

  // CBL / Accountabilities — purge any completed before today’s 5:00 AM
  for (const t of ['CBL','Accountabilities']){
    await sb.from(t)
      .delete().lt('CompletedAt', dayS.toISOString())
      .eq('Status','Done').eq('AppKey', SHARED_APP_KEY);
  }
}

// === LOADERS ===
async function loadAll(){
  await refreshCadenceWindows();
  await Promise.all([loadTodos('today'), loadCBL(), loadAcct(), loadNotes()]);
}

async function loadTodos(filter){
  const list = document.getElementById('todoList');
  if (!list) return;
  list.innerHTML = "";

  const { data, error } = await sb.from('TaskInstances')
    .select('*')
    .eq('AppKey', SHARED_APP_KEY)
    .order('SortOrder', { ascending: true, nullsFirst: true })
    .order('DueDateTime', { ascending: true });
  if (error) { console.error('TaskInstances select error:', error); return; }

  const now    = new Date();
  const dayS   = startOfDay(now).getTime();
  const dayE   = endOfDay(now).getTime();
  const weekS  = startOfWeekSat(now).getTime();  // Walmart week
  const weekE  = endOfWeekSat(now).getTime();
  const monthS = startOfMonth5(now).getTime();
  const monthE = endOfMonth5(now).getTime();

  const filtered = (data||[]).filter(row => {
    const dueTs   = row.DueDateTime ? new Date(row.DueDateTime).getTime() : 0;
    const compTs  = row.CompletedAt ? new Date(row.CompletedAt).getTime() : 0;

    if (filter === 'today') {
      const dueToday    = dueTs >= dayS && dueTs <= dayE;
      const wkWindow    = row.Recurrence === 'weekly'  && dueTs >= weekS  && dueTs <= weekE;   // keep even if Done
      const moWindow    = row.Recurrence === 'monthly' && dueTs >= monthS && dueTs <= monthE;  // keep even if Done

      // keep custom visible today if due today OR completed today
      const customToday = row.Recurrence === 'custom' && (
        (dueTs >= dayS && dueTs <= dayE) ||
        (row.Status === 'Done' && compTs >= dayS && compTs <= dayE)
      );

      return dueToday || wkWindow || moWindow || customToday;
    }

    if (filter === 'weekly')  return row.Recurrence === 'weekly';
    if (filter === 'monthly') return row.Recurrence === 'monthly';
    return true;
  });

  if (!filtered.length){
    const li = document.createElement('li'); li.className='card';
    li.innerHTML = `<div><div class="title">No items match this view</div>
                    <div class="meta">Add a task or switch filters.</div></div>`;
    list.appendChild(li);
  } else {
    renderList(filtered, list, 'SWFL');
  }

  // Drag-sort for SWFL
  if (!list._sortableInit && window.Sortable){
    list._sortableInit = true;
    Sortable.create(list, {
      handle: '.drag-handle',
      animation: 150,
      onEnd: async ()=>{ await persistSwflOrder(list); }
    });
  }
}

async function loadCBL(){
  const list = document.getElementById('cblList'); if (!list) return;
  list.innerHTML="";

  const { data, error } = await sb.from('CBL')
    .select('*').eq('AppKey', SHARED_APP_KEY)
    .order('SortOrder', { ascending:true, nullsFirst:true })
    .order('id', { ascending:false });
  if (error) { console.error(error); return; }

  (data||[]).forEach(r=>{
    const li=document.createElement('li'); li.className='card'; li.style.position='relative';
    li.dataset.id = r.id;

    const left=document.createElement('div');

    const handle = document.createElement('span'); handle.className='drag-handle'; handle.textContent='≡';
    left.appendChild(handle);

    const title=document.createElement('div'); title.className='title';
    title.textContent = `${(r.Person||'—')} • ${r.Type || 'CBL'}`;
    const meta=document.createElement('div'); meta.className='meta';
    if (r.Type === 'Axonify') {
      const last = r.LastDone ? new Date(r.LastDone) : null;
      const days = last ? Math.floor((Date.now() - last.getTime())/86400000) : 0;
      meta.textContent = `${days} / 30 days since last${last ? ` • last ${last.toLocaleDateString()}` : ''}` +
        (r.Status==='Done' && r.CompletedAt ? ` • ✓ ${r.CompletedByInitials} @ ${new Date(r.CompletedAt).toLocaleTimeString()}` : '');
    } else {
      const due = r.DueBy ? new Date(r.DueBy) : null;
      meta.textContent = `${due ? `Due ${due.toLocaleString()}` : 'No due'}` +
        (r.Status==='Done' && r.CompletedAt ? ` • ✓ ${r.CompletedByInitials} @ ${new Date(r.CompletedAt).toLocaleTimeString()}` : '');
    }
    left.appendChild(title); left.appendChild(meta);

    const right=document.createElement('div');
    const btn=document.createElement('button');
    if (r.Status==='Done'){ btn.textContent='Undo'; btn.className='btn undo'; btn.onclick=()=>reopenItem('CBL', r.id); }
    else { btn.textContent='Complete'; btn.className='btn complete'; btn.onclick=()=>completeItem('CBL', r.id); }
    right.appendChild(btn);

    const kebab = makeKebabMenu(()=>deleteItem('CBL', r.id));
    li.appendChild(kebab);

    li.appendChild(left); li.appendChild(right);
    list.appendChild(li);
  });

  // Drag-sort for CBL
  if (!list._sortableInit && window.Sortable){
    list._sortableInit = true;
    Sortable.create(list, {
      handle: '.drag-handle',
      animation: 150,
      onEnd: async ()=>{ await persistOrder('CBL', list); }
    });
  }
}

async function loadAcct(){
  const list = document.getElementById('acctList'); if (!list) return;
  list.innerHTML="";

  const { data, error } = await sb.from('Accountabilities')
    .select('*').eq('AppKey', SHARED_APP_KEY)
    .order('SortOrder', { ascending:true, nullsFirst:true })
    .order('id',{ascending:false});
  if (error) { console.error(error); return; }

  (data||[]).forEach(r=>{
    const li=document.createElement('li'); li.className='card'; li.style.position='relative';
    li.dataset.id = r.id;

    const left=document.createElement('div');

    const handle = document.createElement('span'); handle.className='drag-handle'; handle.textContent='≡';
    left.appendChild(handle);

    const title=document.createElement('div'); title.className='title';
    title.textContent = `${r.Person || '—'} • ${r.Type || '—'}`;

    const meta=document.createElement('div'); meta.className='meta';
    const stamp = (r.Status==='Done' && r.CompletedAt)
      ? ` ✓ ${r.CompletedByInitials} @ ${new Date(r.CompletedAt).toLocaleTimeString()}`
      : '';
    meta.textContent = (r.Status==='Done' ? 'Completed' : 'Open') + stamp;

    left.appendChild(title); left.appendChild(meta);

    const right=document.createElement('div');
    const btn=document.createElement('button');
    if (r.Status==='Done'){ btn.textContent='Undo'; btn.className='btn undo'; btn.onclick=()=>reopenItem('Accountabilities', r.id); }
    else { btn.textContent='Complete'; btn.className='btn complete'; btn.onclick=()=>completeItem('Accountabilities', r.id); }
    right.appendChild(btn);

    const kebab = makeKebabMenu(()=>deleteItem('Accountabilities', r.id));
    li.appendChild(kebab);

    li.appendChild(left); li.appendChild(right);
    list.appendChild(li);
  });

  // Drag-sort for Accountabilities
  if (!list._sortableInit && window.Sortable){
    list._sortableInit = true;
    Sortable.create(list, {
      handle: '.drag-handle',
      animation: 150,
      onEnd: async ()=>{ await persistOrder('Accountabilities', list); }
    });
  }
}

async function loadNotes(){
  const list = document.getElementById('notesList'); if (!list) return;
  list.innerHTML="";

  const { data, error } = await sb.from('Notes')
    .select('*').eq('AppKey', SHARED_APP_KEY)
    .order('SortOrder', { ascending:true, nullsFirst:true })
    .order('CreatedOn',{ascending:false});
  if (error) { console.error(error); return; }

  (data||[]).forEach(r=>{
    const li=document.createElement('li'); li.className='card'; li.style.position='relative';
    li.dataset.id = r.id;

    const left=document.createElement('div');

    const handle = document.createElement('span'); handle.className='drag-handle'; handle.textContent='≡';
    left.appendChild(handle);

    const when=new Date(r.CreatedOn).toLocaleString();
    const title=document.createElement('div'); title.className='title'; title.textContent = r.Text;
    const meta=document.createElement('div'); meta.className='meta';
    meta.textContent = `by ${r.CreatedByInitials||'—'} • ${when}`;

    left.appendChild(title); left.appendChild(meta);

    const right = document.createElement('div'); // no complete/undo for notes
    const kebab = makeKebabMenu(()=>deleteItem('Notes', r.id));
    li.appendChild(kebab);

    li.appendChild(left); li.appendChild(right);
    list.appendChild(li);
  });

  // Drag-sort for Notes
  if (!list._sortableInit && window.Sortable){
    list._sortableInit = true;
    Sortable.create(list, {
      handle: '.drag-handle',
      animation: 150,
      onEnd: async ()=>{ await persistOrder('Notes', list); }
    });
  }
}

// === COMPLETED (SWFL ONLY) ===
let completedPage = 0;
const COMPLETED_PAGE_SIZE = 50;
function formatWhen(ts){ try { return new Date(ts).toLocaleString(); } catch { return ts || ""; } }

async function loadCompleted({ reset=false } = {}){
  const list = document.getElementById('completedList'); if (!list) return;
  const moreBtn = document.getElementById('completedMore');
  if (reset) { completedPage = 0; list.innerHTML = ""; if (moreBtn) moreBtn.style.display = 'none'; }

  const from = completedPage * COMPLETED_PAGE_SIZE;
  const to   = from + COMPLETED_PAGE_SIZE - 1;

  const { data, error, count } = await sb.from('CompletionLog')
    .select('id, ItemType, Action, ByInitials, LoggedAt, CompletedAt', { count: 'exact' })
    .eq('AppKey', SHARED_APP_KEY).eq('ItemType', 'SWFL')
    .order('LoggedAt', { ascending:false, nullsFirst:false })
    .order('CompletedAt',{ ascending:false, nullsFirst:false })
    .range(from, to);
  if (error) { console.error('Completed query error:', error); return; }

  if (completedPage === 0 && (!data || data.length === 0)) {
    const empty = document.createElement('li'); empty.className='card';
    empty.innerHTML = `<div><div class="title">No SWFL completions yet</div>
                       <div class="meta">Finish a SWFL item and it’ll appear here.</div></div>`;
    list.appendChild(empty); if (moreBtn) moreBtn.style.display='none'; return;
  }

  (data||[]).forEach(row=>{
    const when = row.LoggedAt || row.CompletedAt;
    const li=document.createElement('li'); li.className='card completed';
    li.innerHTML = `<div><div class="title">SWFL • ${row.Action}</div>
                    <div class="meta">by ${row.ByInitials||'—'} • ${formatWhen(when)}</div></div>`;
    list.appendChild(li);
  });

  completedPage++;
  if (moreBtn){
    if (count !== null && completedPage * COMPLETED_PAGE_SIZE >= count) moreBtn.style.display='none';
    else moreBtn.style.display='';
  }
}

// === UI HELPERS ===
function makeKebabMenu(onDelete){
  const wrap = document.createElement('div'); wrap.className = 'kebab';
  const btn = document.createElement('button'); btn.type='button'; btn.title='More'; btn.textContent='⋯';
  const menu = document.createElement('div'); menu.className='card-menu';
  const del = document.createElement('button'); del.className='danger'; del.textContent='Delete';
  del.onclick = (e)=>{ e.stopPropagation(); menu.classList.remove('open'); onDelete(); };
  menu.appendChild(del); wrap.appendChild(btn); wrap.appendChild(menu);
  btn.onclick = (e)=>{ e.stopPropagation(); menu.classList.toggle('open'); };
  document.addEventListener('click', (e)=>{ if (!wrap.contains(e.target)) menu.classList.remove('open'); });
  return wrap;
}

function renderList(rows, container, type){
  container.innerHTML = "";
  (rows||[]).forEach(r=>{
    const li=document.createElement('li'); li.className='card'; li.style.position='relative';
    if (type === 'SWFL'){ li.dataset.id = r.id; } // needed for drag sort

    const left=document.createElement('div');

    // drag handle
    const handle = document.createElement('span'); handle.className='drag-handle'; handle.textContent='≡';
    left.appendChild(handle);

    const title=document.createElement('div'); title.className='title'; title.textContent=r.Title || '(untitled)';
    const meta=document.createElement('div'); meta.className='meta';

    const due = r.DueDateTime ? new Date(r.DueDateTime) : null;

    const bits = [];

    if (r.Recurrence === 'weekly') {
      if (due) bits.push(`WK ${walmartWeekNumber(due)}`);
    } else if (r.Recurrence === 'monthly') {
      if (due) bits.push(monthLabel(due));
    } else if (r.Recurrence === 'custom') {
      // hide active days completely → only show stamp if completed
    } else {
      if (due) bits.push(due.toLocaleString());
    }

    if (r.Status === 'Done' && r.CompletedByInitials) {
      const t = r.CompletedAt ? new Date(r.CompletedAt).toLocaleTimeString() : '';
      bits.push(`✓ ${r.CompletedByInitials} @ ${t}`);
    }

    meta.textContent = bits.join(' • ');

    left.appendChild(title); left.appendChild(meta);

    const right=document.createElement('div');
    const actionBtn=document.createElement('button');
    if (r.Status==='Done'){
      actionBtn.textContent='Undo'; actionBtn.className='btn undo'; actionBtn.onclick=()=>reopenItem('SWFL',r.id);
    } else {
      actionBtn.textContent='Complete'; actionBtn.className='btn complete'; actionBtn.onclick=()=>completeItem('SWFL',r.id);
    }
    right.appendChild(actionBtn);

    const kebab = makeKebabMenu(()=>deleteItem('SWFL', r.id));
    li.appendChild(kebab);

    li.appendChild(left); li.appendChild(right);
    container.appendChild(li);
  });
}

// === ACTIONS ===
async function completeItem(type, id){
  if (type === 'SWFL') {
    const { data: row, error: getErr } = await sb.from('TaskInstances').select('*').eq('id', id).single();
    if (getErr || !row){ alert(getErr?.message || 'Task not found'); return; }
    let logAction = 'Completed';

    if (row.Recurrence === 'weekly' || row.Recurrence === 'monthly') {
      const { error: updErr } = await sb.from('TaskInstances').update({
        Status:'Done', CompletedByInitials:who(), CompletedAt:new Date().toISOString(), AppKey:SHARED_APP_KEY
      }).eq('id', id);
      if (updErr){ alert(updErr.message); console.error(updErr); return; }
      logAction = 'Completed(kept-in-window)';

    } else if (row.Recurrence === 'custom') {
      // keep visible today + stamp, move DueDateTime to next active day
      const nextDue = nextCustom(row.DueDateTime, row.ActiveDays);
      const { error: updErr } = await sb.from('TaskInstances').update({
        Status:'Done',
        CompletedByInitials: who(),
        CompletedAt: new Date().toISOString(),
        DueDateTime: nextDue ? nextDue.toISOString() : row.DueDateTime,
        AppKey: SHARED_APP_KEY
      }).eq('id', id);
      if (updErr){ alert(updErr.message); console.error(updErr); return; }
      logAction = 'Completed(visible-today)';

    } else {
      // one-off
      const { error: finErr } = await sb.from('TaskInstances').update({
        Status:'Done', CompletedByInitials:who(), CompletedAt:new Date().toISOString(), AppKey:SHARED_APP_KEY
      }).eq('id', id);
      if (finErr){ alert(finErr.message); console.error(finErr); return; }
    }

    await sb.from('CompletionLog').insert([{
      ItemType:'SWFL', ItemId:id, Action:logAction, ByInitials:who(),
      AppKey:SHARED_APP_KEY, LoggedAt:new Date().toISOString()
    }]);

    loadTodos(CURRENT_FILTER);
    loadCompleted({ reset:true });
    return;
  }

  if (type === 'CBL') {
    const { data: row } = await sb.from('CBL').select('*').eq('id', id).single();
    const patch = {
      Status:'Done',
      CompletedByInitials: who(),
      CompletedAt: new Date().toISOString(),
      AppKey: SHARED_APP_KEY
    };
    if (row?.Type === 'Axonify') patch.LastDone = new Date().toISOString();

    const { error: updErr } = await sb.from('CBL').update(patch).eq('id', id);
    if (updErr){ alert(updErr.message); console.error(updErr); return; }

    await sb.from('CompletionLog').insert([{
      ItemType:'CBL', ItemId:id, Action:'Completed(keep-until-5am)',
      ByInitials:who(), AppKey:SHARED_APP_KEY, LoggedAt:new Date().toISOString()
    }]);

    loadCBL();
    return;
  }

  // Accountabilities
  const { error: updErr } = await sb.from('Accountabilities').update({
    Status:'Done', CompletedByInitials:who(), CompletedAt:new Date().toISOString(), AppKey:SHARED_APP_KEY
  }).eq('id', id);
  if (updErr){ alert(updErr.message); console.error(updErr); return; }
  await sb.from('CompletionLog').insert([{
    ItemType:'Accountabilities', ItemId:id, Action:'Completed(keep-until-5am)', ByInitials:who(),
    AppKey:SHARED_APP_KEY, LoggedAt:new Date().toISOString()
  }]);
  loadAcct();
}

async function reopenItem(type,id){
  const table = (type==='SWFL') ? 'TaskInstances' : (type==='CBL' ? 'CBL' : 'Accountabilities');
  const { error } = await sb.from(table).update({
    Status:'Not Started', CompletedByInitials:null, CompletedAt:null, AppKey:SHARED_APP_KEY
  }).eq('id',id);
  if (error){ alert(error.message); console.error(error); }
  await sb.from('CompletionLog').insert([{
    ItemType:type, ItemId:id, Action:'Reopened', ByInitials:who(),
    AppKey:SHARED_APP_KEY, LoggedAt:new Date().toISOString()
  }]);
  if (type === 'SWFL') { loadTodos(CURRENT_FILTER); loadCompleted({ reset:true }); }
  else if (type === 'CBL') loadCBL(); else loadAcct();
}

async function deleteItem(type, id){
  const table =
    type === 'SWFL' ? 'TaskInstances' :
    type === 'CBL' ? 'CBL' :
    type === 'Accountabilities' ? 'Accountabilities' :
    type === 'Notes' ? 'Notes' : null;
  if (!table) return;

  const ok = confirm(`Delete this ${type} item? This cannot be undone.`);
  if (!ok) return;

  if (type === 'SWFL') {
    await sb.from('CompletionLog').insert([{
      ItemType:'SWFL', ItemId:id, Action:'Deleted', ByInitials:who(),
      AppKey:SHARED_APP_KEY, LoggedAt:new Date().toISOString()
    }]);
  }
  const { error } = await sb.from(table).delete().eq('id', id).eq('AppKey', SHARED_APP_KEY);
  if (error){ alert(error.message); console.error(error); return; }

  if (type === 'SWFL') { loadTodos(CURRENT_FILTER); loadCompleted({ reset:true }); }
  else if (type === 'CBL') loadCBL();
  else if (type === 'Accountabilities') loadAcct();
  else if (type === 'Notes') loadNotes();
}

// === FORM HANDLERS ===
async function onAddSWFL(e){
  e.preventDefault();
  const Title       = document.getElementById('title').value.trim();
  const Recurrence  = document.getElementById('recurrence').value;
  const Assignees   = document.getElementById('assignees').value.trim();
  const Category    = document.getElementById('category').value.trim();

  let DueDateTime = null;
  if (Recurrence === 'weekly') {
    // We still use the browser week picker (ISO). Any date inside the Walmart week is fine;
    // display/filter are Walmart Sat–Fri.
    const wk = document.getElementById('dueWeek').value;
    if (!wk){ alert('Pick a week'); return; }
    const [y, w] = wk.split('-W').map(Number);
    // Convert ISO week to a Monday, then slide to Saturday 5am in that same week
    const jan4 = new Date(y,0,4);
    const jan4Dow = (jan4.getDay() || 7);
    const monOfW1 = new Date(jan4);
    monOfW1.setDate(jan4.getDate() - (jan4Dow - 1));
    const mon = new Date(monOfW1);
    mon.setDate(monOfW1.getDate() + (w - 1) * 7);
    // move to Sat of that week
    const sat = new Date(mon);
    // mon.getDay()=1 => add 5 days → Sat
    sat.setDate(mon.getDate() + (6 - 1)); // 5 days ahead
    sat.setHours(5,0,0,0);
    DueDateTime = sat.toISOString();
  } else if (Recurrence === 'monthly') {
    const mo = document.getElementById('dueMonth').value;
    if (!mo){ alert('Pick a month'); return; }
    const [y,m] = mo.split('-').map(Number);
    const d = new Date(y, m-1, 1, 5,0,0,0);
    DueDateTime = d.toISOString();
  } else {
    const dt = document.getElementById('due').value;
    if (!dt){ alert('Pick a date & time'); return; }
    DueDateTime = new Date(dt).toISOString();
  }

  const ActiveDays = (Recurrence === 'custom')
    ? Array.from(document.querySelectorAll('#newTaskForm input[name="day"]:checked')).map(x=>x.value).join(',') || null
    : null;

  const { error } = await sb.from('TaskInstances').insert([{
    Title, DueDateTime, Status:'Not Started', Assignees, Category, Recurrence, ActiveDays, AppKey: SHARED_APP_KEY
  }]);
  if (error){ alert(error.message); console.error(error); return; }

  e.target.reset();
  document.getElementById('customDays').style.display = 'none';
  document.getElementById('weekRow').style.display = 'none';
  document.getElementById('monthRow').style.display = 'none';
  document.getElementById('dtRow').style.display = '';
  loadTodos(CURRENT_FILTER);
}

async function onAddCBL(e){
  e.preventDefault();
  const Person = (document.getElementById('cblPerson')?.value || '').trim();
  const Type   = document.getElementById('cblType')?.value || 'CBL';
  const DueBy  = document.getElementById('cblDueBy')?.value || null;
  const LastDoneSeed = document.getElementById('axLastDone')?.value || null;

  if (!Person) { alert('Enter name/initials'); return; }

  const row = { Person, Type, Status:'Not Started', AppKey:SHARED_APP_KEY, Title:`${Person} • ${Type}` };
  if (Type === 'CBL') row.DueBy = DueBy ? new Date(DueBy).toISOString() : null;
  if (Type === 'Axonify') row.LastDone = LastDoneSeed ? new Date(LastDoneSeed).toISOString() : null;

  const { error } = await sb.from('CBL').insert([row]);
  if (error){ alert(error.message); console.error(error); return; }

  e.target.reset();
  document.getElementById('cblDueRow').style.display = '';
  document.getElementById('axSeedRow').style.display = 'none';
  loadCBL();
}

async function onAddAcct(e){
  e.preventDefault();
  const Person = document.getElementById('acctPerson').value.trim();
  const Type   = document.getElementById('acctType').value.trim();
  if (!Person || !Type) return;
  const { error } = await sb.from('Accountabilities').insert([{ Person, Type, Status:'Not Started', AppKey: SHARED_APP_KEY }]);
  if (error){ alert(error.message); console.error(error); return; }
  e.target.reset();
  loadAcct();
}

async function onAddNote(e){
  e.preventDefault();
  const Text = document.getElementById('noteText').value.trim();
  if (!Text) return;
  const CreatedByInitials = who();
  const CreatedOn = new Date().toISOString();
  const { error } = await sb.from('Notes').insert([{ Text, CreatedByInitials, CreatedOn, AppKey:SHARED_APP_KEY }]);
  if (error){ alert(error.message); console.error(error); return; }
  document.getElementById('noteText').value = '';
  loadNotes();
}

// === REALTIME ===
function subscribeRealtime(){
  sb.channel('db-changes')
    .on('postgres_changes',{ event:'*', schema:'public', table:'TaskInstances' }, () => loadTodos(CURRENT_FILTER))
    .on('postgres_changes',{ event:'*', schema:'public', table:'CBL' }, loadCBL)
    .on('postgres_changes',{ event:'*', schema:'public', table:'Accountabilities' }, loadAcct)
    .on('postgres_changes',{ event:'*', schema:'public', table:'Notes' }, loadNotes)
    .on('postgres_changes',{ event:'*', schema:'public', table:'CompletionLog' }, () => loadCompleted({ reset:true }))
    .subscribe();

  // Re-check windows every 10 minutes (handles 5am rollover if app stays open)
  setInterval(async ()=>{
    await refreshCadenceWindows();
    loadTodos(CURRENT_FILTER);
    loadCBL();
    loadAcct();
  }, 10 * 60 * 1000);
}
