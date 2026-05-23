// ══════════════════════════════════════════
//  BECKY AI — server.js
//  Node.js + Express + Ollama (tinyllama)
// ══════════════════════════════════════════

const express  = require('express');
const session  = require('express-session');
const fs       = require('fs');
const path     = require('path');

const app  = express();
const PORT         = process.env.PORT         || 3000;
const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'tinyllama';
const SESSION_SECRET = process.env.SESSION_SECRET || 'becky-ai-super-secret-key-change-me';
const USERS_FILE   = path.join(__dirname, 'users.json');

// ── MIDDLEWARE ────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,   // 7 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ── USER STORE (JSON file) ────────────────
function getUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── AUTH MIDDLEWARE ───────────────────────
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ ok: false, error: 'Not authenticated' });
}

// ── AUTH ROUTES ───────────────────────────

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password)
    return res.json({ ok: false, error: 'Please fill in all fields.' });
  if (password.length < 4)
    return res.json({ ok: false, error: 'Password must be at least 4 characters.' });

  const users = getUsers();
  if (users[username])
    return res.json({ ok: false, error: 'Username already taken.' });

  const name = (displayName || '').trim() || username;
  users[username] = { password, displayName: name };
  saveUsers(users);

  req.session.user = { username, displayName: name };
  res.json({ ok: true, username, displayName: name });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const users = getUsers();

  if (!users[username] || users[username].password !== password)
    return res.json({ ok: false, error: 'Invalid username or password.' });

  const name = users[username].displayName || username;
  req.session.user = { username, displayName: name };
  res.json({ ok: true, username, displayName: name });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Session check
app.get('/api/auth/me', (req, res) => {
  if (req.session?.user) res.json({ ok: true, ...req.session.user });
  else res.json({ ok: false });
});

// ── CHAT ROUTE (SSE streaming) ────────────
app.post('/api/chat', requireAuth, async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: 'Invalid messages payload.' });

  // Build Ollama message array
  const ollamaMessages = [];
  if (system) ollamaMessages.push({ role: 'system', content: system });
  ollamaMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));

  let ollamaRes;
  try {
    ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: ollamaMessages,
        stream: true,
        options: {
          temperature: 0.7,
          num_predict: 2048
        }
      })
    });
  } catch (fetchErr) {
    console.error('[Ollama] Connection error:', fetchErr.message);
    return res.status(503).json({
      error: `Cannot reach Ollama at ${OLLAMA_URL}. Make sure Ollama is running with: ollama serve`
    });
  }

  if (!ollamaRes.ok) {
    const errText = await ollamaRes.text().catch(() => 'Unknown error');
    console.error('[Ollama] HTTP error:', ollamaRes.status, errText);
    return res.status(502).json({ error: `Ollama error ${ollamaRes.status}: ${errText}` });
  }

  // Stream SSE back to client
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // nginx: disable buffering
  res.flushHeaders();

  const reader  = ollamaRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();                     // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            res.write(`data: ${JSON.stringify({ text: data.message.content })}\n\n`);
          }
          if (data.done) {
            res.write('data: [DONE]\n\n');
          }
        } catch { /* skip malformed JSON */ }
      }
    }
  } catch (streamErr) {
    console.error('[Stream] Error:', streamErr.message);
    res.write('data: [DONE]\n\n');
  }

  res.end();
});

// ── OLLAMA HEALTH CHECK ───────────────────
app.get('/api/ollama-status', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const json = await r.json();
    const models = (json.models || []).map(m => m.name);
    res.json({ ok: true, models });
  } catch {
    res.json({ ok: false, models: [] });
  }
});

// ── START ─────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ✦  Becky AI is running!');
  console.log(`     Local:   http://localhost:${PORT}`);
  console.log(`     Network: http://0.0.0.0:${PORT}`);
  console.log(`     Ollama:  ${OLLAMA_URL}  (model: ${OLLAMA_MODEL})`);
  console.log('');
  console.log('  Tip: For a public URL run:');
  console.log('       npx cloudflared tunnel --url http://localhost:' + PORT);
  console.log('');
});
