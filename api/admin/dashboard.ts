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

async function getData() {
  const [settingsRows, postStats, lastPublished] = await Promise.all([
    sql`SELECT user_id, data, created_at FROM settings ORDER BY user_id`,
    sql`
      SELECT
        SPLIT_PART(user_id, ':', 1) AS root_id,
        COUNT(*)::int AS total,
        MIN(published_at) AS first_at,
        MAX(published_at) AS last_at
      FROM published_posts
      GROUP BY SPLIT_PART(user_id, ':', 1)
    `,
    sql`
      SELECT DISTINCT ON (SPLIT_PART(user_id,':',1))
        SPLIT_PART(user_id,':',1) AS root_id, chat_id, title, published_at
      FROM published_posts
      ORDER BY SPLIT_PART(user_id,':',1), published_at DESC
    `.catch(() => [] as any[]),
  ]);

  const statsMap = new Map(postStats.map((r: any) => [String(r.root_id), r]));

  // Raggruppa profili per root user
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
      // Raccoglie canali univoci, preferendo la configurazione del profilo secondario
      const channelMap = new Map<string, any>();

      for (const profile of profiles) {
        const uid = String(profile.user_id);
        const cfg = typeof profile.data === 'string' ? JSON.parse(profile.data) : (profile.data ?? {});
        const channels: string[] = Array.isArray(cfg.channels) ? cfg.channels.filter(Boolean) : [];
        const isSecondary = uid.includes(':');

        for (const ch of channels) {
          // Profilo secondario ha priorità sul profilo base
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

      // Risolve nomi canali in parallelo
      const channelEntries = await Promise.all(
        Array.from(channelMap.values()).map(async (ch) => {
          const info = await resolveChannel(ch.channelId);
          return { ...ch, channelName: info.name, username: info.username };
        })
      );

      const stats = statsMap.get(rootId) as any;

      return {
        rootId,
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
.container{padding:20px;max-width:1100px;margin:0 auto}
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:80vh}
.login-card{background:#1a1d2e;border:1px solid #2d3748;border-radius:12px;padding:32px;width:100%;max-width:340px}
.login-card h2{font-size:20px;font-weight:700;margin-bottom:20px;text-align:center}
.inp{width:100%;background:#0f1117;border:1px solid #2d3748;border-radius:8px;color:#e2e8f0;padding:10px 14px;font-size:14px;outline:none;margin-bottom:12px}
.inp:focus{border-color:#3b82f6}
.btn{width:100%;background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:11px;font-size:14px;font-weight:600;cursor:pointer}
.btn:hover{background:#2563eb}
.err{color:#fc8181;font-size:13px;margin-bottom:10px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.card{background:#1a1d2e;border:1px solid #2d3748;border-radius:12px;overflow:hidden}
.card-head{padding:14px 16px;border-bottom:1px solid #2d3748;display:flex;align-items:center;gap:10px}
.user-id{font-size:13px;font-weight:700;color:#a0aec0}
.stats{margin-left:auto;text-align:right;font-size:11px;color:#718096;line-height:1.6}
.ch-list{padding:8px 0}
.ch-row{padding:10px 16px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid #1e2235}
.ch-row:last-child{border-bottom:none}
.ch-name{font-size:14px;font-weight:600;color:#e2e8f0}
.ch-user{font-size:11px;color:#718096}
.ch-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
.pill{font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500}
.pill-green{background:#1c3a2e;color:#68d391}
.pill-red{background:#3a1c1c;color:#fc8181}
.pill-blue{background:#1c2a4a;color:#90cdf4}
.pill-gray{background:#2d3748;color:#a0aec0}
.meta-dates{padding:10px 16px 12px;border-top:1px solid #1e2235;display:flex;gap:16px;font-size:11px;color:#718096}
.meta-dates span b{color:#a0aec0;font-weight:600}
.no-ch{padding:16px;font-size:13px;color:#718096;font-style:italic}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid #2d3748;border-top-color:#3b82f6;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.loading{text-align:center;padding:60px;color:#718096}
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
<script>
const S = sessionStorage;
let timer, countdown, pwd;

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

function renderDashboard(data){
  const grid = document.getElementById('grid');
  document.getElementById('loadingMsg').style.display='none';
  grid.style.display='';
  document.getElementById('userCount').textContent = data.users.length + (data.users.length===1?' utente':' utenti');

  grid.innerHTML = data.users.map(u => {
    const chHtml = u.channels.length === 0
      ? '<div class="no-ch">Nessun canale configurato</div>'
      : u.channels.map(ch => {
          const statusPill = ch.attivo
            ? '<span class="pill pill-green">🟢 Attivo</span>'
            : '<span class="pill pill-red">🔴 Disattivato</span>';
          const windowPill = \`<span class="pill pill-blue">⏰ \${ch.oraI}–\${ch.oraF}</span>\`;
          const intervPill = \`<span class="pill pill-gray">⌛ ogni \${ch.interv}min</span>\`;
          const userLine = ch.username
            ? \`<span class="ch-user">@\${ch.username}</span>\`
            : \`<span class="ch-user">\${ch.channelId}</span>\`;
          return \`<div class="ch-row">
            <span class="ch-name">\${ch.channelName}</span>
            \${userLine}
            <div class="ch-meta">\${statusPill}\${windowPill}\${intervPill}</div>
          </div>\`;
        }).join('');

    const since = sinceText(u.firstAt);
    const lastPost = sinceText(u.lastAt);

    return \`<div class="card">
      <div class="card-head">
        <span class="user-id">ID \${u.rootId}</span>
        <div class="stats">
          <div><b style="color:#e2e8f0">\${u.totalPosts}</b> post pubblicati</div>
          \${since ? \`<div>Usa il bot da \${since}</div>\` : ''}
        </div>
      </div>
      <div class="ch-list">\${chHtml}</div>
      \${u.firstAt || u.lastAt ? \`<div class="meta-dates">
        \${u.firstAt ? \`<span><b>Primo:</b> \${fmt(u.firstAt)}</span>\` : ''}
        \${u.lastAt ? \`<span><b>Ultimo:</b> \${fmt(u.lastAt)}</span>\` : ''}
      </div>\` : ''}
    </div>\`;
  }).join('');
}

function startCountdown(){
  let secs = 30;
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
    if(r.status===401){ clearInterval(timer); S.removeItem('adminPwd'); location.reload(); return; }
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

// Auto-login se già autenticato
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
    const { password } = (req.body ?? {}) as { password?: string };
    if (password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Password errata' });
      return;
    }
    const data = await getData();
    res.json(data);
    return;
  }

  res.status(405).end();
}
