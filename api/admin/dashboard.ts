import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../../lib/db.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'postdealadmin';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const channelNameCache = new Map<string, { name: string; username?: string }>();

async function resolveChannel(id: string): Promise<{ name: string; username?: string }> {
  if (channelNameCache.has(id)) return channelNameCache.get(id)!;
  if (!BOT_TOKEN || !id.match(/^-?\d+$/)) return { name: id };
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${id}`,
      { signal: AbortSignal.timeout(5000) });
    const d = await r.json() as any;
    if (d.ok && d.result?.title) {
      const info = { name: d.result.title as string, username: d.result.username as string | undefined };
      channelNameCache.set(id, info);
      return info;
    }
  } catch {}
  return { name: id };
}

function deepMerge(target: any, source: any): any {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v) && out[k] !== null && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k] ?? {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function getData() {
  const [settingsRows, postStats] = await Promise.all([
    sql`SELECT user_id, data, updated_at FROM settings ORDER BY user_id`,
    sql`
      SELECT
        SPLIT_PART(user_id, ':', 1) AS root_id,
        COUNT(*)::int AS total,
        MIN(published_at) AS first_at,
        MAX(published_at) AS last_at
      FROM published_posts
      GROUP BY SPLIT_PART(user_id, ':', 1)
    `,
  ]);

  const statsMap = new Map(postStats.map((r: any) => [String(r.root_id), r]));

  // Build blocked map from root profiles
  const blockedMap = new Map<string, boolean>();
  for (const row of settingsRows) {
    const uid = String(row.user_id);
    if (!uid.includes(':') && !uid.endsWith('_dev')) {
      const cfg = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {});
      blockedMap.set(uid, !!cfg.blocked);
    }
  }

  // Group profiles by root user
  const rootMap = new Map<string, any[]>();
  for (const row of settingsRows) {
    const uid = String(row.user_id);
    const root = uid.includes(':') ? uid.split(':')[0] : uid;
    if (uid.endsWith('_dev')) continue;
    if (!rootMap.has(root)) rootMap.set(root, []);
    rootMap.get(root)!.push(row);
  }

  const users = await Promise.all(
    Array.from(rootMap.entries()).map(async ([rootId, profiles]) => {
      const channelMap = new Map<string, any>();

      for (const profile of profiles) {
        const uid = String(profile.user_id);
        const cfg = typeof profile.data === 'string' ? JSON.parse(profile.data) : (profile.data ?? {});
        const channels: string[] = Array.isArray(cfg.channels) ? cfg.channels.filter(Boolean) : [];
        const isSecondary = uid.includes(':');

        for (const ch of channels) {
          if (!channelMap.has(ch) || isSecondary) {
            channelMap.set(ch, {
              channelId: ch,
              profileId: uid,
              attivo: !!cfg.attivo,
              oraI: cfg.oraI ?? '08:00',
              oraF: cfg.oraF ?? '22:00',
              interv: Number(cfg.interv ?? 60),
            });
          }
        }
      }

      const channelEntries = await Promise.all(
        Array.from(channelMap.values()).map(async (ch) => {
          const info = await resolveChannel(ch.channelId);
          return { ...ch, channelName: info.name, username: info.username };
        })
      );

      const stats = statsMap.get(rootId) as any;

      return {
        rootId,
        blocked: blockedMap.get(rootId) ?? false,
        channels: channelEntries,
        totalPosts: stats?.total ?? 0,
        firstAt: stats?.first_at ? new Date(stats.first_at).toISOString() : null,
        lastAt: stats?.last_at ? new Date(stats.last_at).toISOString() : null,
      };
    })
  );

  return { users, updatedAt: new Date().toISOString() };
}

function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PostDeal Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}
.header{background:#1a1d2e;border-bottom:1px solid #2d3748;padding:16px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.header h1{font-size:18px;font-weight:700;color:#fff}
.badge{background:#3b82f6;color:#fff;font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600}
.refresh-info{margin-left:auto;font-size:12px;color:#718096}
.container{padding:20px;max-width:1200px;margin:0 auto}
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:80vh}
.login-card{background:#1a1d2e;border:1px solid #2d3748;border-radius:12px;padding:32px;width:100%;max-width:340px}
.login-card h2{font-size:20px;font-weight:700;margin-bottom:20px;text-align:center}
.inp{width:100%;background:#0f1117;border:1px solid #2d3748;border-radius:8px;color:#e2e8f0;padding:10px 14px;font-size:14px;outline:none;margin-bottom:12px}
.inp:focus{border-color:#3b82f6}
.inp-sm{background:#0f1117;border:1px solid #2d3748;border-radius:6px;color:#e2e8f0;padding:7px 10px;font-size:13px;outline:none;width:100%}
.inp-sm:focus{border-color:#3b82f6}
select.inp-sm{cursor:pointer}
.btn{width:100%;background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:11px;font-size:14px;font-weight:600;cursor:pointer}
.btn:hover{background:#2563eb}
.btn-sm{background:transparent;border:1px solid #2d3748;color:#a0aec0;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.btn-sm:hover{background:#2d3748;color:#e2e8f0}
.btn-danger{border-color:#742a2a;color:#fc8181}
.btn-danger:hover{background:#3a1c1c;border-color:#fc8181;color:#fc8181}
.btn-warn{border-color:#744210;color:#f6ad55}
.btn-warn:hover{background:#3a2a1c;border-color:#f6ad55;color:#f6ad55}
.btn-green{border-color:#276749;color:#68d391}
.btn-green:hover{background:#1c3a2e;border-color:#68d391;color:#68d391}
.btn-primary-sm{background:#3b82f6;border:1px solid #3b82f6;color:#fff;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer}
.btn-primary-sm:hover{background:#2563eb}
.err{color:#fc8181;font-size:13px;margin-bottom:10px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}
.card{background:#1a1d2e;border:1px solid #2d3748;border-radius:12px;overflow:hidden}
.card.blocked-card{border-color:#742a2a}
.blocked-banner{background:#3a1c1c;border-bottom:1px solid #742a2a;padding:6px 16px;font-size:12px;font-weight:600;color:#fc8181;display:flex;align-items:center;gap:6px}
.card-head{padding:12px 16px;border-bottom:1px solid #2d3748;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.user-id{font-size:13px;font-weight:700;color:#a0aec0}
.stats{font-size:11px;color:#718096;line-height:1.6}
.card-actions{margin-left:auto;display:flex;gap:6px;align-items:center}
.ch-list{padding:8px 0}
.ch-row{padding:10px 16px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid #1e2235}
.ch-row:last-child{border-bottom:none}
.ch-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.ch-info{flex:1;min-width:0}
.ch-name{font-size:14px;font-weight:600;color:#e2e8f0}
.ch-sub{font-size:11px;color:#718096;margin-top:1px}
.ch-actions{display:flex;gap:5px;align-items:center;flex-shrink:0}
.ch-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px}
.pill{font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500}
.pill-green{background:#1c3a2e;color:#68d391}
.pill-red{background:#3a1c1c;color:#fc8181}
.pill-blue{background:#1c2a4a;color:#90cdf4}
.pill-gray{background:#2d3748;color:#a0aec0}
.meta-dates{padding:10px 16px 12px;border-top:1px solid #1e2235;display:flex;gap:16px;font-size:11px;color:#718096}
.no-ch{padding:16px;font-size:13px;color:#718096;font-style:italic}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid #2d3748;border-top-color:#3b82f6;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading{text-align:center;padding:60px;color:#718096}

/* Modal */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px}
.modal{background:#1a1d2e;border:1px solid #2d3748;border-radius:14px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.modal-head{padding:18px 20px 14px;border-bottom:1px solid #2d3748;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#1a1d2e;z-index:1}
.modal-head h3{font-size:15px;font-weight:700;color:#e2e8f0}
.modal-close{background:none;border:none;color:#718096;font-size:22px;cursor:pointer;line-height:1;padding:0 4px}
.modal-close:hover{color:#e2e8f0}
.modal-body{padding:20px}
.field-group{margin-bottom:18px}
.field-group label{display:block;font-size:12px;font-weight:600;color:#a0aec0;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.section-title{font-size:13px;font-weight:700;color:#e2e8f0;margin:20px 0 12px;padding-bottom:8px;border-bottom:1px solid #2d3748;display:flex;align-items:center;gap:6px}
.section-title:first-child{margin-top:0}
.toggle-row{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.toggle-label{font-size:13px;color:#e2e8f0}
.toggle{position:relative;width:40px;height:22px;cursor:pointer;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0;position:absolute}
.toggle-slider{position:absolute;inset:0;background:#2d3748;border-radius:11px;transition:.2s}
.toggle input:checked+.toggle-slider{background:#3b82f6}
.toggle-slider:before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
.toggle input:checked+.toggle-slider:before{transform:translateX(18px)}
.modal-footer{padding:14px 20px;border-top:1px solid #2d3748;display:flex;justify-content:flex-end;gap:10px;position:sticky;bottom:0;background:#1a1d2e}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2d3748;color:#e2e8f0;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:200;opacity:0;transition:opacity .2s;pointer-events:none}
.toast.show{opacity:1}
.toast.err-toast{background:#3a1c1c;color:#fc8181}
</style>
</head>
<body>
<div class="header">
  <svg width="22" height="22" fill="none" stroke="#3b82f6" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
  <h1>PostDeal Admin</h1>
  <span class="badge" id="userCount">—</span>
  <span class="refresh-info" id="refreshInfo"></span>
</div>
<div class="container" id="app">
  <div class="login-wrap" id="loginWrap">
    <div class="login-card">
      <h2>🔐 Accesso Admin</h2>
      <div class="err" id="loginErr" style="display:none"></div>
      <input class="inp" id="pwdInput" type="password" placeholder="Password" autofocus>
      <button class="btn" onclick="doLogin()">Entra</button>
    </div>
  </div>
  <div id="dashWrap" style="display:none">
    <div class="loading" id="loadingMsg"><span class="spinner"></span>Caricamento…</div>
    <div class="grid" id="grid" style="display:none"></div>
  </div>
</div>

<!-- Settings modal -->
<div class="overlay" id="settingsOverlay" style="display:none" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-head">
      <h3 id="modalTitle">Impostazioni</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body" id="modalBody"></div>
    <div class="modal-footer">
      <button class="btn-sm" onclick="closeModal()">Annulla</button>
      <button class="btn-primary-sm" onclick="saveSettings()">💾 Salva</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const S = sessionStorage;
let pwd, countdown, dashData;
let editingProfile = null;

function fmt(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'})
    +' '+d.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
}
function sinceText(iso){
  if(!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff/86400000);
  if(days===0) return 'oggi';
  if(days===1) return 'ieri';
  if(days<30) return days+'g fa';
  if(days<365) return Math.floor(days/30)+'m fa';
  return Math.floor(days/365)+'a fa';
}

function showToast(msg, err=false){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err?' err-toast':'');
  setTimeout(() => t.className='toast', 2500);
}

async function api(action, body={}){
  const r = await fetch('/admin', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({password: pwd, action, ...body})
  });
  if(r.status===401){ S.removeItem('adminPwd'); location.reload(); return null; }
  return r.json();
}

function renderDashboard(data){
  dashData = data;
  const grid = document.getElementById('grid');
  document.getElementById('loadingMsg').style.display='none';
  grid.style.display='';
  document.getElementById('userCount').textContent = data.users.length + (data.users.length===1?' utente':' utenti');

  grid.innerHTML = data.users.map(u => {
    const isBlocked = u.blocked;
    const blockedBanner = isBlocked
      ? '<div class="blocked-banner">🚫 UTENTE BLOCCATO DALL\\'ADMIN</div>'
      : '';
    const blockBtn = isBlocked
      ? \`<button class="btn-sm btn-green" onclick="toggleBlock('\${u.rootId}', false)">✅ Sblocca</button>\`
      : \`<button class="btn-sm btn-warn" onclick="toggleBlock('\${u.rootId}', true)">🚫 Blocca</button>\`;

    const chHtml = u.channels.length === 0
      ? '<div class="no-ch">Nessun canale configurato</div>'
      : u.channels.map(ch => {
          const statusPill = ch.attivo
            ? '<span class="pill pill-green">🟢 Attivo</span>'
            : '<span class="pill pill-red">🔴 Off</span>';
          const windowPill = \`<span class="pill pill-blue">⏰ \${ch.oraI}–\${ch.oraF}</span>\`;
          const intervPill = \`<span class="pill pill-gray">⌛ \${ch.interv}min</span>\`;
          const subLine = ch.username
            ? \`@\${ch.username} · <span style="color:#4a5568">\${ch.channelId}</span>\`
            : ch.channelId;
          return \`<div class="ch-row">
            <div class="ch-top">
              <div class="ch-info">
                <div class="ch-name">\${ch.channelName}</div>
                <div class="ch-sub">\${subLine}</div>
              </div>
              <div class="ch-actions">
                <button class="btn-sm" onclick="openSettings('\${ch.profileId}','\${esc(ch.channelName)}')">✏️</button>
                <button class="btn-sm btn-danger" onclick="removeChannel('\${ch.profileId}','\${ch.channelId}','\${esc(ch.channelName)}')">🗑️</button>
              </div>
            </div>
            <div class="ch-meta">\${statusPill}\${windowPill}\${intervPill}</div>
          </div>\`;
        }).join('');

    const since = sinceText(u.firstAt);

    return \`<div class="card\${isBlocked?' blocked-card':''}">
      \${blockedBanner}
      <div class="card-head">
        <div>
          <div class="user-id">ID \${u.rootId}</div>
          <div class="stats">\${u.totalPosts} post\${since?' · da '+since:''}</div>
        </div>
        <div class="card-actions">
          \${blockBtn}
          <button class="btn-sm btn-danger" onclick="deleteUser('\${u.rootId}')">🗑️</button>
        </div>
      </div>
      <div class="ch-list">\${chHtml}</div>
      \${u.firstAt||u.lastAt ? \`<div class="meta-dates">
        \${u.firstAt?\`<span>Primo: \${fmt(u.firstAt)}</span>\`:''}
        \${u.lastAt?\`<span>Ultimo: \${fmt(u.lastAt)}</span>\`:''}
      </div>\`:''}
    </div>\`;
  }).join('');
}

function esc(s){ return String(s||'').replace(/'/g,"\\'"); }

/* ── Block / Unblock ─────────────────────────── */
async function toggleBlock(rootId, block){
  const verb = block ? 'bloccare' : 'sbloccare';
  if(!confirm(\`Vuoi \${verb} l'utente \${rootId}?\`)) return;
  const r = await api('block', { rootId, blocked: block });
  if(r?.ok){ showToast(block?'Utente bloccato':'Utente sbloccato'); loadData(); }
  else showToast('Errore', true);
}

/* ── Delete user ─────────────────────────────── */
async function deleteUser(rootId){
  if(!confirm(\`ATTENZIONE: eliminare l'utente \${rootId} e tutti i suoi dati?\\n\\nQuesta azione è irreversibile.\`)) return;
  if(!confirm(\`Confermi l'eliminazione di \${rootId}?\`)) return;
  const r = await api('delete_user', { rootId });
  if(r?.ok){ showToast('Utente eliminato'); loadData(); }
  else showToast('Errore', true);
}

/* ── Remove channel ──────────────────────────── */
async function removeChannel(profileId, channelId, channelName){
  if(!confirm(\`Rimuovere il canale "\${channelName}" dalle impostazioni?\`)) return;
  const r = await api('delete_channel', { profileId, channelId });
  if(r?.ok){ showToast('Canale rimosso'); loadData(); }
  else showToast('Errore', true);
}

/* ── Settings modal ──────────────────────────── */
async function openSettings(profileId, channelName){
  editingProfile = profileId;
  document.getElementById('modalTitle').textContent = '⚙️ ' + channelName;
  document.getElementById('modalBody').innerHTML = '<div style="text-align:center;padding:30px;color:#718096"><span class="spinner"></span>Caricamento…</div>';
  document.getElementById('settingsOverlay').style.display='flex';

  const r = await api('get_settings', { profileId });
  if(!r){ closeModal(); return; }
  const cfg = r.cfg || {};

  document.getElementById('modalBody').innerHTML = \`
    <div class="section-title">📅 Pubblicazione</div>
    <div class="toggle-row">
      <label class="toggle"><input type="checkbox" id="s_attivo" \${cfg.attivo?'checked':''}><span class="toggle-slider"></span></label>
      <span class="toggle-label">Autopost attivo</span>
    </div>
    <div class="field-row" style="margin-bottom:14px">
      <div class="field-group" style="margin:0">
        <label>Ora inizio</label>
        <input class="inp-sm" id="s_oraI" type="time" value="\${cfg.oraI||'08:00'}">
      </div>
      <div class="field-group" style="margin:0">
        <label>Ora fine</label>
        <input class="inp-sm" id="s_oraF" type="time" value="\${cfg.oraF||'22:00'}">
      </div>
    </div>
    <div class="field-group">
      <label>Intervallo (minuti)</label>
      <input class="inp-sm" id="s_interv" type="number" min="1" max="1440" value="\${cfg.interv||60}">
    </div>

    <div class="section-title">🤖 Telegram</div>
    <div class="field-group">
      <label>Bot Token</label>
      <input class="inp-sm" id="s_botToken" type="text" placeholder="lascia vuoto per non modificare" value="\${cfg.telegram?.botToken||''}">
    </div>

    <div class="section-title">🛒 Amazon</div>
    <div class="field-group">
      <label>Affiliate Tag</label>
      <input class="inp-sm" id="s_affTag" type="text" placeholder="es: cavalieridelr-21" value="\${cfg.amazon?.affiliateTag||''}">
    </div>
    <div class="field-group">
      <label>Credential ID (Paapi)</label>
      <input class="inp-sm" id="s_credId" type="text" value="\${cfg.amazon?.credentialId||''}">
    </div>
    <div class="field-group">
      <label>Credential Secret</label>
      <input class="inp-sm" id="s_credSecret" type="password" placeholder="lascia vuoto per non modificare" value="\${cfg.amazon?.credentialSecret||''}">
    </div>
    <div class="field-row">
      <div class="field-group" style="margin:0">
        <label>Marketplace</label>
        <select class="inp-sm" id="s_marketplace">
          \${['IT','DE','FR','ES','UK','US','JP','CA'].map(m=>\`<option value="\${m}" \${(cfg.amazon?.marketplace||'IT')===m?'selected':''}>\${m}</option>\`).join('')}
        </select>
      </div>
      <div class="field-group" style="margin:0">
        <label>API Version</label>
        <input class="inp-sm" id="s_version" type="text" value="\${cfg.amazon?.version||'2.2'}">
      </div>
    </div>
  \`;
}

async function saveSettings(){
  if(!editingProfile) return;
  const g = id => document.getElementById(id);
  const patch = {
    attivo: g('s_attivo').checked,
    oraI: g('s_oraI').value,
    oraF: g('s_oraF').value,
    interv: parseInt(g('s_interv').value)||60,
    telegram: {},
    amazon: {},
  };
  const botToken = g('s_botToken').value.trim();
  if(botToken) patch.telegram.botToken = botToken;
  const affTag = g('s_affTag').value.trim();
  if(affTag) patch.amazon.affiliateTag = affTag;
  const credId = g('s_credId').value.trim();
  if(credId) patch.amazon.credentialId = credId;
  const credSecret = g('s_credSecret').value.trim();
  if(credSecret) patch.amazon.credentialSecret = credSecret;
  patch.amazon.marketplace = g('s_marketplace').value;
  patch.amazon.version = g('s_version').value.trim()||'2.2';

  // Remove empty objects
  if(!Object.keys(patch.telegram).length) delete patch.telegram;
  if(!Object.keys(patch.amazon).length) delete patch.amazon;

  const r = await api('update_settings', { profileId: editingProfile, patch });
  if(r?.ok){ showToast('Impostazioni salvate ✓'); closeModal(); loadData(); }
  else showToast('Errore nel salvataggio', true);
}

function closeModal(){
  document.getElementById('settingsOverlay').style.display='none';
  editingProfile = null;
}

/* ── Data loading ────────────────────────────── */
function startCountdown(){
  let secs = 60;
  clearInterval(countdown);
  countdown = setInterval(() => {
    secs--;
    document.getElementById('refreshInfo').textContent = 'Aggiornamento tra '+secs+'s';
    if(secs<=0){ clearInterval(countdown); loadData(); }
  }, 1000);
}

async function loadData(){
  try {
    const r = await fetch('/admin', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({password: pwd})
    });
    if(r.status===401){ clearInterval(countdown); S.removeItem('adminPwd'); location.reload(); return; }
    const data = await r.json();
    renderDashboard(data);
    startCountdown();
  } catch(e) {
    document.getElementById('refreshInfo').textContent = 'Errore, riprovo…';
    startCountdown();
  }
}

async function doLogin(){
  const p = document.getElementById('pwdInput').value;
  if(!p) return;
  const r = await fetch('/admin', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({password: p})
  });
  if(r.status===401){
    document.getElementById('loginErr').style.display='';
    document.getElementById('loginErr').textContent='Password errata';
    return;
  }
  S.setItem('adminPwd', p);
  pwd = p;
  const data = await r.json();
  document.getElementById('loginWrap').style.display='none';
  document.getElementById('dashWrap').style.display='';
  renderDashboard(data);
  startCountdown();
}

document.getElementById('pwdInput').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });

(function init(){
  const saved = S.getItem('adminPwd');
  if(saved){
    pwd = saved;
    document.getElementById('loginWrap').style.display='none';
    document.getElementById('dashWrap').style.display='';
    loadData();
  }
})();
</script>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(getHtml());
    return;
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, any>;
    const { password, action } = body;

    if (password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Password errata' });
      return;
    }

    // ── Block / Unblock user ──────────────────────────────────────────────────
    if (action === 'block') {
      const rootId = String(body.rootId ?? '');
      if (!rootId) { res.status(400).json({ error: 'rootId mancante' }); return; }
      const [row] = await sql`SELECT data FROM settings WHERE user_id = ${rootId}`;
      if (!row) { res.status(404).json({ error: 'Utente non trovato' }); return; }
      const cfg = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {});
      cfg.blocked = !!body.blocked;
      await sql`UPDATE settings SET data = ${JSON.stringify(cfg)}, updated_at = NOW() WHERE user_id = ${rootId}`;
      res.json({ ok: true });
      return;
    }

    // ── Delete user (all profiles + history) ─────────────────────────────────
    if (action === 'delete_user') {
      const rootId = String(body.rootId ?? '');
      if (!rootId) { res.status(400).json({ error: 'rootId mancante' }); return; }
      await Promise.all([
        sql`DELETE FROM settings WHERE user_id = ${rootId} OR user_id LIKE ${rootId + ':%'}`,
        sql`DELETE FROM published_posts WHERE user_id = ${rootId} OR user_id LIKE ${rootId + ':%'}`,
        sql`DELETE FROM autopost_queue WHERE user_id = ${rootId} OR user_id LIKE ${rootId + ':%'}`.catch(() => {}),
      ]);
      res.json({ ok: true });
      return;
    }

    // ── Remove channel from profile ───────────────────────────────────────────
    if (action === 'delete_channel') {
      const profileId = String(body.profileId ?? '');
      const channelId = String(body.channelId ?? '');
      if (!profileId || !channelId) { res.status(400).json({ error: 'profileId/channelId mancanti' }); return; }
      const [row] = await sql`SELECT data FROM settings WHERE user_id = ${profileId}`;
      if (!row) { res.status(404).json({ error: 'Profilo non trovato' }); return; }
      const cfg = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {});
      cfg.channels = ((cfg.channels as string[]) || []).filter((c: string) => c !== channelId);
      await sql`UPDATE settings SET data = ${JSON.stringify(cfg)}, updated_at = NOW() WHERE user_id = ${profileId}`;
      // If secondary profile has no channels left, delete it
      if (profileId.includes(':') && cfg.channels.length === 0) {
        await sql`DELETE FROM settings WHERE user_id = ${profileId}`;
      }
      res.json({ ok: true });
      return;
    }

    // ── Get settings for a profile ────────────────────────────────────────────
    if (action === 'get_settings') {
      const profileId = String(body.profileId ?? '');
      if (!profileId) { res.status(400).json({ error: 'profileId mancante' }); return; }
      const [row] = await sql`SELECT data FROM settings WHERE user_id = ${profileId}`;
      const cfg = row ? (typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {})) : {};
      res.json({ cfg });
      return;
    }

    // ── Update settings for a profile ─────────────────────────────────────────
    if (action === 'update_settings') {
      const profileId = String(body.profileId ?? '');
      const patch = body.patch as Record<string, any> ?? {};
      if (!profileId) { res.status(400).json({ error: 'profileId mancante' }); return; }
      const [row] = await sql`SELECT data FROM settings WHERE user_id = ${profileId}`;
      const existing = row ? (typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {})) : {};
      const updated = deepMerge(existing, patch);
      await sql`UPDATE settings SET data = ${JSON.stringify(updated)}, updated_at = NOW() WHERE user_id = ${profileId}`;
      res.json({ ok: true });
      return;
    }

    // ── Default: return dashboard data ────────────────────────────────────────
    try {
      const data = await getData();
      res.json(data);
    } catch (e: any) {
      console.error('[admin] errore getData:', e?.message ?? e);
      res.status(500).json({ error: 'Errore interno: ' + (e?.message ?? 'unknown') });
    }
    return;
  }

  res.status(405).end();
}
