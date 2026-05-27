/* ─────────────────────────────────────────────────────────
   My Chat Board — script.js
   Uses the OpenRouter API (https://openrouter.ai)
   Replace API_KEY below with your free OpenRouter key.
   Get one free at: https://openrouter.ai/keys
───────────────────────────────────────────────────────── */

const API_KEY      = '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'; // ← Replace with your key
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/* ── DOM refs ─────────────────────────────────────────── */
const chatBox           = document.getElementById('chatBox');
const sendBtn           = document.getElementById('sendBtn');
const userInput         = document.getElementById('userInput');
const suggestionsEl     = document.getElementById('suggestions');
const historyListEl     = document.getElementById('historyList');
const exportBtn         = document.getElementById('exportHistory');
const clearBtn          = document.getElementById('clearHistory');
const newChatBtn        = document.getElementById('newChatBtn');
const quickSugInput     = document.getElementById('quickSuggestions');
const systemPromptInput = document.getElementById('systemPrompt');
const modelSelect       = document.getElementById('model');

/* ── State ────────────────────────────────────────────── */
const STORAGE_KEY = 'chatboard_v3';
let history  = [];
let current  = { id: null, messages: [], created: null };
let isSending = false;

/* ── Helpers ──────────────────────────────────────────── */
function now()        { return new Date().toISOString(); }
function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
function esc(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/\n/g, '<br>');
}

/* ── Render a single message ──────────────────────────── */
function renderMessage(msg) {
  const empty = chatBox.querySelector('.empty-state');
  if (empty) empty.remove();

  const wrapper = document.createElement('div');
  wrapper.className = `message ${msg.role}`;
  wrapper.innerHTML = `
    <div class="message-bubble">${esc(msg.content)}</div>
    <div class="message-meta">${fmtTime(msg.time)}</div>
  `;
  chatBox.appendChild(wrapper);
  chatBox.scrollTop = chatBox.scrollHeight;
}

/* ── Typing indicator ─────────────────────────────────── */
function showTyping() {
  removeTyping();
  const el = document.createElement('div');
  el.id = '__typing';
  el.className = 'typing-bubble';
  el.innerHTML = `
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  `;
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function removeTyping() {
  const el = document.getElementById('__typing');
  if (el) el.remove();
}

/* ── Add message to current conversation ─────────────── */
function addMessage(role, content) {
  const msg = { role, content, time: now() };
  current.messages.push(msg);
  renderMessage(msg);
  return msg;
}

/* ── Render an error bubble ───────────────────────────── */
function renderError(text) {
  const empty = chatBox.querySelector('.empty-state');
  if (empty) empty.remove();
  const wrapper = document.createElement('div');
  wrapper.className = 'message error';
  wrapper.innerHTML = `<div class="message-bubble">⚠ ${esc(text)}</div>`;
  chatBox.appendChild(wrapper);
  chatBox.scrollTop = chatBox.scrollHeight;
}

/* ── Save & load history ──────────────────────────────── */
function saveHistory() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch (e) {}
}
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    history = raw ? JSON.parse(raw) : [];
  } catch (e) { history = []; }
}

/* ── Render history list ──────────────────────────────── */
function renderHistory() {
  historyListEl.innerHTML = '';
  if (!history.length) {
    historyListEl.innerHTML = '<div class="hist-empty">No conversations yet.</div>';
    return;
  }
  history.forEach(h => {
    const el = document.createElement('div');
    el.className = 'hist-item';
    el.innerHTML = `
      <div class="hist-preview">${esc(h.preview || 'Conversation')}</div>
      <div class="hist-time">${fmtTime(h.created)}</div>
    `;
    el.addEventListener('click', () => loadConversation(h.id));
    historyListEl.appendChild(el);
  });
}

/* ── Load a past conversation ─────────────────────────── */
function loadConversation(id) {
  const conf = history.find(h => h.id === id);
  if (!conf) return;
  current = { id: conf.id, messages: conf.messages.slice(), created: conf.created };
  chatBox.innerHTML = '';
  current.messages.forEach(renderMessage);
  switchTab('chat');
}

/* ── Save current conversation snapshot ──────────────── */
function saveCurrentConversation() {
  if (!current.messages.length) return;
  const snap = {
    id:       current.id,
    created:  current.created,
    preview:  current.messages.find(m => m.role === 'user')?.content?.slice(0, 80) || 'Conversation',
    messages: current.messages.slice()
  };
  const idx = history.findIndex(h => h.id === snap.id);
  if (idx >= 0) history[idx] = snap; else history.unshift(snap);
  saveHistory();
  renderHistory();
}

/* ── Start a new conversation ─────────────────────────── */
function newConversation() {
  current = { id: 'c_' + Date.now(), messages: [], created: now() };
  chatBox.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✦</div>
      <div class="empty-title">Start a conversation</div>
      <div class="empty-sub">Ask me anything — powered by OpenRouter.</div>
    </div>
  `;
}

/* ── Auto-grow textarea ───────────────────────────────── */
function autoGrow() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
}

/* ── Extract reply from OpenRouter response ───────────── */
function extractReply(data) {
  return data?.choices?.[0]?.message?.content
      || data?.choices?.[0]?.text
      || null;
}

/* ── Main send function ───────────────────────────────── */
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isSending) return;

  isSending = true;
  sendBtn.disabled = true;
  userInput.value = '';
  autoGrow();

  addMessage('user', text);
  showTyping();

  const model        = modelSelect?.value || DEFAULT_MODEL;
  const systemPrompt = systemPromptInput?.value.trim() || 'You are a helpful assistant.';

  // Build messages array for OpenRouter (map 'bot' → 'assistant')
  const apiMessages = current.messages
    .filter(m => m.role === 'user' || m.role === 'bot')
    .map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.content }));

  // Prepend system message
  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...apiMessages
  ];

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  window.location.href,   // required by OpenRouter
        'X-Title':       'My Chat Board'          // optional but good practice
      },
      body: JSON.stringify({
        model,
        messages:   fullMessages,
        max_tokens: 1024
      })
    });

    const data = await resp.json();
    removeTyping();

    if (!resp.ok) {
      const errMsg = data?.error?.message || data?.message || `HTTP ${resp.status}`;
      throw new Error(errMsg);
    }

    const reply = extractReply(data);
    if (!reply) throw new Error('Empty response from model. Try a different model.');

    addMessage('bot', reply);

  } catch (err) {
    removeTyping();
    renderError(err?.message || 'Failed to connect to OpenRouter.');
    console.error('[ChatBoard]', err);
  }

  saveCurrentConversation();
  isSending = false;
  sendBtn.disabled = false;
  userInput.focus();
}

/* ── Suggestions ──────────────────────────────────────── */
function renderSuggestions() {
  suggestionsEl.innerHTML = '';
  const raw   = quickSugInput?.value || '';
  const items = raw
    ? raw.split(';').map(s => s.trim()).filter(Boolean)
    : ['Hello!', 'Help me write an email', 'Explain a concept', 'Summarize this'];

  items.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      userInput.value = s;
      autoGrow();
      userInput.focus();
    });
    suggestionsEl.appendChild(chip);
  });
}

/* ── Tab switching ────────────────────────────────────── */
function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('panel-' + tab);
  if (panel) panel.classList.remove('hidden');
}

/* ── Export history ───────────────────────────────────── */
function exportHistory() {
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'chat_history.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── Clear history ────────────────────────────────────── */
function clearAllHistory() {
  if (!confirm('Delete all saved conversations? This cannot be undone.')) return;
  history = [];
  saveHistory();
  renderHistory();
  newConversation();
}

/* ── Event listeners ──────────────────────────────────── */
sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

userInput.addEventListener('input', autoGrow);
exportBtn.addEventListener('click', exportHistory);
clearBtn.addEventListener('click', clearAllHistory);
newChatBtn.addEventListener('click', () => { saveCurrentConversation(); newConversation(); });

document.querySelectorAll('.nav-btn').forEach(btn =>
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
);

quickSugInput?.addEventListener('input', renderSuggestions);

/* ── Init ─────────────────────────────────────────────── */
loadHistory();
renderHistory();
newConversation();
renderSuggestions();