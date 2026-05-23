/* ══════════════════════════════════════════
   BECKY AI — script.js
   Client-side logic. Talks to server.js,
   which proxies to Ollama (tinyllama).
   ══════════════════════════════════════════ */

// ── CONFIG ─────────────────────────────────
const AI_SYSTEM = 'You are Becky AI, a helpful, smart, and friendly AI assistant. Be concise but thorough. Format responses with markdown when helpful.';

// ── STATE ──────────────────────────────────
let currentChatId = null;
let chats         = {};      // { id: { title, messages:[], ts } }
let isLoading     = false;
let currentUser   = null;

// ── STORAGE ────────────────────────────────
function saveState() {
  if (!currentUser) return;
  localStorage.setItem(`becky_chats_${currentUser}`, JSON.stringify(chats));
  localStorage.setItem(`becky_current_${currentUser}`, currentChatId || '');
}
function loadState() {
  if (!currentUser) return;
  try   { chats = JSON.parse(localStorage.getItem(`becky_chats_${currentUser}`) || '{}'); }
  catch { chats = {}; }
  currentChatId = localStorage.getItem(`becky_current_${currentUser}`) || null;
}

// ── TOAST ───────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── AUTH ───────────────────────────────────
let authMode = 'login';

document.getElementById('auth-toggle').onclick = () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  const s = authMode === 'signup';
  document.getElementById('auth-title').textContent      = s ? 'Create account'              : 'Welcome back';
  document.getElementById('auth-sub').textContent        = s ? 'Sign up to start using Becky AI' : 'Sign in to continue to Becky AI';
  document.getElementById('auth-submit').textContent     = s ? 'Create Account'               : 'Sign In';
  document.getElementById('auth-switch-text').textContent= s ? 'Already have an account?'    : "Don't have an account?";
  document.getElementById('auth-toggle').textContent     = s ? ' Sign in'                    : ' Sign up';
  document.getElementById('auth-name-wrap').style.display = s ? 'block' : 'none';
  document.getElementById('auth-err').style.display = 'none';
};

document.getElementById('auth-submit').onclick = doAuth;
['auth-user', 'auth-pass', 'auth-name'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doAuth();
  });
});

async function doAuth() {
  const username    = document.getElementById('auth-user').value.trim();
  const password    = document.getElementById('auth-pass').value;
  const displayName = document.getElementById('auth-name').value.trim();
  const errEl       = document.getElementById('auth-err');
  const btn         = document.getElementById('auth-submit');
  errEl.style.display = 'none';

  if (!username || !password) { showAuthErr('Please fill in all fields.'); return; }

  btn.disabled    = true;
  btn.textContent = authMode === 'signup' ? 'Creating…' : 'Signing in…';

  const endpoint = authMode === 'signup' ? '/api/auth/register' : '/api/auth/login';
  try {
    const res  = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password, displayName })
    });
    const data = await res.json();
    if (!data.ok) {
      showAuthErr(data.error || 'Authentication failed.');
    } else {
      initApp(data.username, data.displayName || data.username);
    }
  } catch {
    showAuthErr('Server error. Is the server running?');
  } finally {
    btn.disabled    = false;
    btn.textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
  }
}

function showAuthErr(msg) {
  const el = document.getElementById('auth-err');
  el.textContent = msg;
  el.style.display = 'block';
}

async function logout() {
  if (!confirm('Log out?')) return;
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  currentUser = null;
  chats = {};
  currentChatId = null;
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-user').value = '';
  document.getElementById('auth-pass').value = '';
}

// ── INIT ───────────────────────────────────
function initApp(userId, displayName) {
  currentUser = userId;
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('user-display').textContent = displayName || userId;
  document.getElementById('user-avatar').textContent  = (displayName || userId)[0].toUpperCase();
  loadState();
  renderHistory();
  if (currentChatId && chats[currentChatId]) {
    loadChat(currentChatId);
  } else {
    showWelcome();
  }
  checkOllama();
}

// Check session on load
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res  = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.ok) {
      initApp(data.username, data.displayName || data.username);
    }
  } catch { /* server not ready */ }
});

// Ollama health check
async function checkOllama() {
  try {
    const res  = await fetch('/api/ollama-status');
    const data = await res.json();
    if (!data.ok) {
      showToast('⚠️ Ollama not found — run: ollama serve', 'err');
    } else {
      const has = data.models.some(m => m.includes('tinyllama'));
      if (!has && data.models.length === 0) {
        showToast('⚠️ No models found — run: ollama pull tinyllama', 'err');
      } else {
        document.getElementById('model-badge').textContent = 'LOCAL';
      }
    }
  } catch { /* ignore */ }
}

// ── EVENT LISTENERS ────────────────────────
document.getElementById('toggle-sidebar-btn').onclick = toggleSidebar;
document.getElementById('new-btn-sidebar').onclick    = newChat;
document.getElementById('new-btn-header').onclick     = newChat;
document.getElementById('logout-btn-header').onclick  = logout;
document.getElementById('logout-row').onclick         = logout;
document.getElementById('send-btn').onclick           = send;

const textarea = document.getElementById('input');
textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
});
textarea.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

// ── SIDEBAR ────────────────────────────────
function toggleSidebar() {
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sidebar-overlay');
  const mob = window.innerWidth <= 700;
  if (mob) {
    const open = sb.classList.toggle('open');
    ov.classList.toggle('show', open);
  } else {
    sb.classList.toggle('collapsed');
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

// Auto-close sidebar on mobile after navigation
function maybeCloseSidebar() {
  if (window.innerWidth <= 700) closeSidebar();
}

// ── CHAT MANAGEMENT ────────────────────────
function genId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function newChat() {
  currentChatId = null;
  showWelcome();
  renderHistory();
  saveState();
  maybeCloseSidebar();
  document.getElementById('input').focus();
}

function loadChat(id) {
  currentChatId = id;
  const chat = chats[id];
  if (!chat) return;
  const msgEl = document.getElementById('messages');
  msgEl.innerHTML = '';
  chat.messages.forEach(m => appendBubble(m.role, m.content, false));
  msgEl.scrollTop = msgEl.scrollHeight;
  renderHistory();
  saveState();
  maybeCloseSidebar();
}

function deleteChat(id, e) {
  e.stopPropagation();
  delete chats[id];
  if (currentChatId === id) { currentChatId = null; showWelcome(); }
  renderHistory();
  saveState();
}

function renderHistory() {
  const el  = document.getElementById('history');
  const ids = Object.keys(chats).sort((a, b) => (chats[b].ts || 0) - (chats[a].ts || 0));
  if (!ids.length) {
    el.innerHTML = '<div style="padding:6px 11px;font-size:12px;color:var(--text3)">No chats yet</div>';
    return;
  }
  el.innerHTML = ids.map(id => `
    <div class="hist-item ${id === currentChatId ? 'active' : ''}" data-id="${id}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escHtml(chats[id].title || 'Untitled')}</span>
      <button class="hist-del" data-del="${id}" title="Delete">✕</button>
    </div>`).join('');

  // Delegated events
  el.querySelectorAll('.hist-item').forEach(item => {
    item.addEventListener('click', () => loadChat(item.dataset.id));
  });
  el.querySelectorAll('.hist-del').forEach(btn => {
    btn.addEventListener('click', e => deleteChat(btn.dataset.del, e));
  });
}

// ── WELCOME SCREEN ─────────────────────────
function showWelcome() {
  document.getElementById('messages').innerHTML = `
    <div class="welcome">
      <div class="wlc-icon">✦</div>
      <h1>How can I help you?</h1>
      <p>Powered by Becky AI · Running locally via Ollama.</p>
      <div class="cards">
        <div class="card" data-prompt="Explain quantum computing in simple terms">
          <div class="card-icon">⚛️</div>
          <div class="card-title">Explain a concept</div>
          <div class="card-sub">Quantum computing simplified</div>
        </div>
        <div class="card" data-prompt="Write a Python function to reverse a string">
          <div class="card-icon">💻</div>
          <div class="card-title">Write code</div>
          <div class="card-sub">Python, JS, SQL &amp; more</div>
        </div>
        <div class="card" data-prompt="Give me 5 creative content ideas for a tech YouTube channel">
          <div class="card-icon">✏️</div>
          <div class="card-title">Brainstorm ideas</div>
          <div class="card-sub">Content, marketing, startups</div>
        </div>
        <div class="card" data-prompt="What are the key differences between REST and GraphQL APIs?">
          <div class="card-icon">📋</div>
          <div class="card-title">Compare topics</div>
          <div class="card-sub">REST vs GraphQL explained</div>
        </div>
      </div>
    </div>`;

  document.querySelectorAll('.card[data-prompt]').forEach(card => {
    card.addEventListener('click', () => fillPrompt(card.dataset.prompt));
  });
}

function fillPrompt(text) {
  const ta = document.getElementById('input');
  ta.value = text;
  ta.dispatchEvent(new Event('input'));
  ta.focus();
}

// ── SEND / RECEIVE ─────────────────────────
async function send() {
  const ta  = document.getElementById('input');
  const msg = ta.value.trim();
  if (!msg || isLoading) return;

  ta.value = '';
  ta.style.height = 'auto';
  isLoading = true;
  document.getElementById('send-btn').disabled = true;

  // Remove welcome if present
  document.querySelector('.welcome')?.remove();

  // Create chat if new
  if (!currentChatId) {
    currentChatId = genId();
    chats[currentChatId] = {
      title: msg.slice(0, 42) + (msg.length > 42 ? '…' : ''),
      messages: [],
      ts: Date.now()
    };
    renderHistory();
  }

  const chat = chats[currentChatId];
  chat.messages.push({ role: 'user', content: msg });
  chat.ts = Date.now();
  appendBubble('user', msg);
  saveState();

  // Typing indicator
  const typingId  = 'typing-' + Date.now();
  const msgEl     = document.getElementById('messages');
  const typingRow = document.createElement('div');
  typingRow.className = 'row ai';
  typingRow.id        = typingId;
  typingRow.innerHTML = `<div class="ai-av">✦</div><div class="bubble ai"><div class="typing"><span></span><span></span><span></span></div></div>`;
  msgEl.appendChild(typingRow);
  msgEl.scrollTop = msgEl.scrollHeight;

  let aiText = '';

  try {
    const apiMessages = chat.messages
      .slice(0, -1)
      .concat([{ role: 'user', content: msg }])
      .map(m => ({ role: m.role, content: m.content }));

    const resp = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: apiMessages, system: AI_SYSTEM })
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(errData.error || `HTTP ${resp.status}`);
    }

    // Replace typing indicator with streaming bubble
    typingRow.remove();
    const aiRow    = document.createElement('div');
    aiRow.className = 'row ai';
    const aiAv     = document.createElement('div');
    aiAv.className = 'ai-av';
    aiAv.textContent = '✦';
    const aiWrap   = document.createElement('div');
    const aiBubble = document.createElement('div');
    aiBubble.className = 'bubble ai';
    aiWrap.appendChild(aiBubble);
    aiWrap.appendChild(createActions(() => copyText(aiText)));
    aiRow.appendChild(aiAv);
    aiRow.appendChild(aiWrap);
    msgEl.appendChild(aiRow);

    // Read SSE stream
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.text) {
            aiText += ev.text;
            aiBubble.innerHTML = markdownToHtml(aiText);
            msgEl.scrollTop = msgEl.scrollHeight;
          }
        } catch { /* skip */ }
      }
    }

    chat.messages.push({ role: 'assistant', content: aiText });
    saveState();

  } catch (err) {
    document.getElementById(typingId)?.remove();
    appendBubble('ai', `⚠️ **Error:** ${escHtml(err.message)}\n\n_Make sure Ollama is running: \`ollama serve\`_`);
    showToast('Error: ' + err.message, 'err');
  }

  isLoading = false;
  document.getElementById('send-btn').disabled = false;
  document.getElementById('input').focus();
}

// ── DOM HELPERS ────────────────────────────
function appendBubble(role, content, scroll = true) {
  const msgEl = document.getElementById('messages');
  const row   = document.createElement('div');
  row.className = 'row ' + (role === 'assistant' ? 'ai' : role);

  if (role === 'ai' || role === 'assistant') {
    const av     = document.createElement('div'); av.className = 'ai-av'; av.textContent = '✦';
    const wrap   = document.createElement('div');
    const bubble = document.createElement('div'); bubble.className = 'bubble ai';
    bubble.innerHTML = markdownToHtml(content);
    const actions = createActions(() => copyText(content));
    wrap.appendChild(bubble); wrap.appendChild(actions);
    row.appendChild(av); row.appendChild(wrap);
  } else {
    const bubble = document.createElement('div');
    bubble.className = 'bubble user';
    bubble.textContent = content;
    row.appendChild(bubble);
  }

  msgEl.appendChild(row);
  if (scroll) msgEl.scrollTop = msgEl.scrollHeight;
}

function createActions(onCopy) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'act-btn';
  copyBtn.title = 'Copy';
  copyBtn.textContent = '⎘';
  copyBtn.addEventListener('click', () => {
    onCopy();
    copyBtn.textContent = '✓';
    setTimeout(() => { copyBtn.textContent = '⎘'; }, 1200);
  });
  const thumbUp = document.createElement('button');
  thumbUp.className = 'act-btn'; thumbUp.title = 'Good'; thumbUp.textContent = '👍';
  const thumbDn = document.createElement('button');
  thumbDn.className = 'act-btn'; thumbDn.title = 'Bad'; thumbDn.textContent = '👎';
  wrap.appendChild(copyBtn); wrap.appendChild(thumbUp); wrap.appendChild(thumbDn);
  return wrap;
}

function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

// ── MARKDOWN ────────────────────────────────
function markdownToHtml(md) {
  // GPT-style code panels with header + copy button
  md = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const label   = lang || 'plaintext';
    const escaped = escHtml(code.trim());
    const id      = 'cb-' + Math.random().toString(36).slice(2, 8);
    return `<div class="code-panel">
      <div class="code-header">
        <span class="code-lang">${label}</span>
        <button class="code-copy-btn" onclick="copyCodeBlock('${id}',this)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy code
        </button>
      </div>
      <pre><code id="${id}" class="lang-${label}">${escaped}</code></pre>
    </div>`;
  });
  md = md.replace(/`([^`]+)`/g, '<code>$1</code>');
  md = md.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  md = md.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  md = md.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  md = md.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  md = md.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  md = md.replace(/\*(.+?)\*/g,         '<em>$1</em>');
  md = md.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  md = md.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:12px 0">');
  md = md.replace(/((?:^[-*] .+\n?)+)/gm, m => {
    const items = m.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  md = md.replace(/((?:^\d+\. .+\n?)+)/gm, m => {
    const items = m.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>');
  md = md.split(/\n{2,}/).map(p => {
    p = p.trim();
    if (!p) return '';
    if (/^<(h[1-3]|ul|ol|pre|blockquote|hr)/.test(p)) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
  return md;
}

function copyCodeBlock(id, btn) {
  const code = document.getElementById(id)?.innerText || '';
  navigator.clipboard?.writeText(code).catch(() => {});
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
  btn.style.color = 'var(--accent)';
  setTimeout(() => {
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy code`;
    btn.style.color = '';
  }, 2000);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
