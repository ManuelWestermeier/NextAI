import React, { useEffect, useMemo, useRef, useState } from 'react';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-70b-versatile';
const STORAGE_KEYS = {
  apiKey: 'pc_groq_key',
  chats: 'pc_chats_v1',
  activeChat: 'pc_active_chat_v1',
  history: 'pc_history_v1'
};

function uid() {
  return crypto.randomUUID();
}

function nowLabel() {
  return new Date().toLocaleString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:js|javascript)?\s*([\s\S]*?)```$/i);
  return match ? match[1].trim() : trimmed;
}

function extractFunctionSource(text) {
  const cleaned = stripCodeFence(text);
  const idx = cleaned.indexOf('async function');
  if (idx >= 0) return cleaned.slice(idx).trim();
  const idx2 = cleaned.indexOf('function');
  if (idx2 >= 0) return cleaned.slice(idx2).trim();
  return cleaned;
}

function clampText(text, limit = 180) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function useLocalStorageState(key, fallback) {
  const [state, setState] = useState(() => loadJSON(key, fallback));
  useEffect(() => {
    saveJSON(key, state);
  }, [key, state]);
  return [state, setState];
}

function IconButton({ children, title, onClick, className = '' }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`inline-flex items-center justify-center h-10 px-3 border border-zinc-800 bg-zinc-900 text-zinc-100 text-sm tracking-wide hover:bg-zinc-800 active:bg-zinc-700 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

function Panel({ title, children, right = false, open, onClose, widthClass = 'w-[18rem]' }) {
  return (
    <aside
      className={`fixed top-0 ${right ? 'right-0 border-l' : 'left-0 border-r'} border-zinc-800 h-full ${widthClass} bg-zinc-950/98 backdrop-blur-sm z-30 transition-transform duration-200 ${
        open ? 'translate-x-0' : right ? 'translate-x-full' : '-translate-x-full'
      }`}
    >
      <div className="h-full flex flex-col">
        <div className="h-16 px-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="text-sm uppercase tracking-[0.24em] text-zinc-400">{title}</div>
          <button onClick={onClose} className="h-8 w-8 border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">×</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3">{children}</div>
      </div>
    </aside>
  );
}

function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEYS.apiKey) || '');
  const [apiModalOpen, setApiModalOpen] = useState(() => !localStorage.getItem(STORAGE_KEYS.apiKey));
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState('idle');
  const [history, setHistory] = useLocalStorageState(STORAGE_KEYS.history, []);
  const [chats, setChats] = useLocalStorageState(STORAGE_KEYS.chats, [
    { id: uid(), name: 'Main', createdAt: Date.now(), messages: [] }
  ]);
  const [activeChatId, setActiveChatId] = useLocalStorageState(STORAGE_KEYS.activeChat, chats[0]?.id);
  const [showHistory, setShowHistory] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [textModalOpen, setTextModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [generatedMeta, setGeneratedMeta] = useState(null);
  const [lastCode, setLastCode] = useState('');
  const [lastResponse, setLastResponse] = useState('Tap to start');
  const [listening, setListening] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  const outputRef = useRef(null);
  const promptRef = useRef(null);
  const pointerStart = useRef({ x: 0, y: 0, t: 0, active: false });
  const holdTimer = useRef(null);
  const recognitionRef = useRef(null);
  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId) || chats[0], [chats, activeChatId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (!activeChatId && chats[0]?.id) setActiveChatId(chats[0].id);
  }, [activeChatId, chats, setActiveChatId]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.innerHTML = `
        <div class="w-full max-w-4xl mx-auto px-4">
          <div class="border border-zinc-800 bg-zinc-900/70 shadow-hard p-6 md:p-8">
            <div class="text-[11px] uppercase tracking-[0.32em] text-zinc-500 mb-4">Prompt Canvas</div>
            <div class="text-3xl md:text-5xl font-semibold tracking-tight text-zinc-100">${lastResponse}</div>
            <div class="mt-6 text-sm text-zinc-400 leading-6 max-w-2xl">
              Tap: audio start · Hold: speak · Double click: type · Swipe left: history · Swipe right: chats
            </div>
          </div>
        </div>`;
    }
  }, []);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      setAudioReady(true);
    }
  }, []);

  useEffect(() => {
    const active = chats.find((c) => c.id === activeChatId);
    if (active && activeChat !== active) {
      // noop; state sync handled by render.
    }
  }, [activeChat, activeChatId, chats]);

  function currentChat() {
    return chats.find((c) => c.id === activeChatId) || chats[0];
  }

  function updateChat(id, updater) {
    setChats((prev) => prev.map((chat) => (chat.id === id ? updater(chat) : chat)));
  }

  function addMessage(role, content, extra = {}) {
    const chatId = activeChatId || chats[0]?.id;
    const message = { id: uid(), role, content, createdAt: Date.now(), ...extra };
    updateChat(chatId, (chat) => ({ ...chat, messages: [...chat.messages, message] }));
    return message;
  }

  function openSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError('Spracherkennung wird von diesem Browser nicht unterstützt.');
      return;
    }
    try {
      const recognition = new SR();
      recognition.lang = 'de-DE';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;
      recognition.onstart = () => {
        setListening(true);
        setStatus('listening');
      };
      recognition.onresult = (e) => {
        const text = e.results?.[0]?.[0]?.transcript || '';
        if (text.trim()) {
          setPrompt(text.trim());
          void runPrompt(text.trim());
        }
      };
      recognition.onerror = () => {
        setListening(false);
        setStatus('idle');
        setError('Spracherkennung fehlgeschlagen.');
      };
      recognition.onend = () => {
        setListening(false);
        setStatus('idle');
      };
      recognition.start();
    } catch (e) {
      setError(e.message || 'Spracherkennung konnte nicht gestartet werden.');
    }
  }

  async function groqChat(messages, temperature = 0.2) {
    const res = await fetch(GROQ_BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        temperature,
        messages
      })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Groq API Fehler (${res.status}): ${clampText(body, 220)}`);
    }

    return res.json();
  }

  async function callLLM(level, promptText) {
    const temperatures = { 1: 0.1, 2: 0.25, 3: 0.45 };
    const system = [
      'You are a strict UI generator.',
      'Return only a single async function named exactly async function(outputElem, fetch, userContext, callLLM) { ... }.',
      'No markdown, no fences, no explanations.',
      'Generate a modern, minimal, hard-edged, professional UI.',
      'Prefer full-screen dashboards, tools, editors, panels, lists, tables, inspectors.',
      'Use Tailwind classes only.',
      'The function must be self-contained and work in the browser.',
      'Never output chat-like content.'
    ].join(' ');

    const completion = await groqChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: promptText }
      ],
      temperatures[level] ?? temperatures[2]
    );
    return completion?.choices?.[0]?.message?.content || '';
  }

  async function executeGeneratedFunction(source, contextPrompt) {
    const outputElem = outputRef.current;
    if (!outputElem) return;

    outputElem.innerHTML = '<div class="w-full h-full flex items-center justify-center text-zinc-400 text-sm">Rendering…</div>';

    const fetchWrapper = async (url, options = {}) => {
      const response = await fetch(url, { ...options });
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return response.json();
      return response.text();
    };

    const userContext = {
      prompt: contextPrompt,
      chatId: activeChatId,
      history,
      memory: {},
      user: {},
      device: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        width: window.innerWidth,
        height: window.innerHeight
      },
      settings: {},
      timestamp: Date.now()
    };

    const fn = new Function(`return (${source});`)();
    if (typeof fn !== 'function') throw new Error('LLM output is not a function.');
    await fn(outputElem, fetchWrapper, userContext, callLLM);
  }

  async function runPrompt(text) {
    if (!apiKey) {
      setApiModalOpen(true);
      return;
    }

    const finalPrompt = text.trim();
    if (!finalPrompt) return;

    setError('');
    setIsThinking(true);
    setStatus('thinking');
    setLastResponse(finalPrompt);
    setGeneratedMeta({ prompt: finalPrompt, time: nowLabel() });
    addMessage('user', finalPrompt);
    setPrompt('');

    try {
      const systemPrompt = [
        'Build a self-contained UI for the user request.',
        'The output must be only one async function:',
        'async function(outputElem, fetch, userContext, callLLM) { ... }',
        'No markdown, no extra text.',
        'Use compact, sharp, minimalist, professional UI.',
        'Render only the final interface into outputElem.',
        'Use fetch only when useful for external data.',
        'Use callLLM only for sub-tasks and analysis.'
      ].join(' ');

      const raw = await groqChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: finalPrompt }
        ],
        0.2
      );

      const answer = raw?.choices?.[0]?.message?.content || '';
      const source = extractFunctionSource(answer);
      setLastCode(source);
      setHistory((prev) => [{ id: uid(), prompt: finalPrompt, code: source, createdAt: Date.now() }, ...prev].slice(0, 30));
      addMessage('assistant', 'Rendered interface');
      await executeGeneratedFunction(source, finalPrompt);
      setStatus('idle');
    } catch (e) {
      setError(e.message || 'Fehler beim Generieren.');
      outputRef.current.innerHTML = `
        <div class="w-full max-w-3xl mx-auto p-4 md:p-8">
          <div class="border border-zinc-800 bg-zinc-900 p-5">
            <div class="text-xs uppercase tracking-[0.3em] text-zinc-500 mb-3">Error</div>
            <div class="text-zinc-100 font-medium">${(e.message || 'Unknown error').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          </div>
        </div>`;
      setStatus('idle');
    } finally {
      setIsThinking(false);
    }
  }

  function handlePointerDown(e) {
    pointerStart.current = { x: e.clientX, y: e.clientY, t: Date.now(), active: true };
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      setListening(true);
      openSpeechRecognition();
    }, 380);
  }

  function handlePointerUp(e) {
    clearTimeout(holdTimer.current);
    if (!pointerStart.current.active) return;

    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    const dt = Date.now() - pointerStart.current.t;
    pointerStart.current.active = false;

    if (Math.abs(dx) > 120 && Math.abs(dx) > Math.abs(dy) && dt < 1000) {
      if (dx < 0) {
        setShowHistory(true);
        setShowChats(false);
      } else {
        setShowChats(true);
        setShowHistory(false);
      }
      return;
    }
  }

  function handleDoubleClick() {
    setTextModalOpen(true);
    setTimeout(() => promptRef.current?.focus(), 0);
  }

  const chatSummary = activeChat?.messages?.slice(-3) || [];
  const latestHistory = history.slice(0, 12);

  return (
    <div className="w-full h-full bg-zinc-950 text-zinc-100 select-none">
      <Panel title="History" open={showHistory} onClose={() => setShowHistory(false)}>
        <div className="space-y-2">
          {latestHistory.length === 0 && <div className="text-sm text-zinc-500 border border-zinc-800 bg-zinc-900 p-3">No history yet.</div>}
          {latestHistory.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setShowHistory(false);
                setPrompt(item.prompt);
                setLastResponse(item.prompt);
                setLastCode(item.code || '');
                outputRef.current && (outputRef.current.innerHTML = `<div class="w-full max-w-4xl mx-auto p-4 md:p-8"><div class="border border-zinc-800 bg-zinc-900 p-6"><div class="text-xs uppercase tracking-[0.3em] text-zinc-500 mb-3">History</div><div class="text-2xl font-semibold">${item.prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></div></div>`);
              }}
              className="w-full text-left border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition-colors p-3"
            >
              <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 mb-2">{new Date(item.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
              <div className="text-sm text-zinc-100 leading-5">{item.prompt}</div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Chats" right open={showChats} onClose={() => setShowChats(false)}>
        <div className="space-y-2">
          <button
            onClick={() => {
              const chat = { id: uid(), name: `Chat ${chats.length + 1}`, createdAt: Date.now(), messages: [] };
              setChats((prev) => [chat, ...prev]);
              setActiveChatId(chat.id);
              setShowChats(false);
            }}
            className="w-full h-10 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition-colors text-left px-3 text-sm"
          >
            + New chat
          </button>

          {chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => {
                setActiveChatId(chat.id);
                setShowChats(false);
              }}
              className={`w-full text-left border p-3 transition-colors ${chat.id === activeChatId ? 'border-zinc-500 bg-zinc-800' : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800'}`}
            >
              <div className="text-sm text-zinc-100">{chat.name}</div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 mt-1">{chat.messages.length} messages</div>
            </button>
          ))}
        </div>
      </Panel>

      {apiModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md border border-zinc-800 bg-zinc-950 shadow-hard p-5 md:p-6">
            <div className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Groq API Key</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">Enter key</div>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="gsk_..."
              className="mt-5 w-full h-12 bg-zinc-900 border border-zinc-800 px-4 outline-none text-zinc-100 placeholder:text-zinc-600"
              type="password"
              autoComplete="off"
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  if (!apiKey.trim()) return;
                  setApiModalOpen(false);
                }}
                className="h-11 px-4 bg-zinc-100 text-zinc-950 border border-zinc-100 font-medium hover:bg-white transition-colors"
              >
                Save
              </button>
              <button onClick={() => setApiModalOpen(false)} className="h-11 px-4 border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 transition-colors">
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {textModalOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl border border-zinc-800 bg-zinc-950 shadow-hard p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-zinc-500">Prompt</div>
                <div className="text-lg font-semibold">Type text</div>
              </div>
              <button onClick={() => setTextModalOpen(false)} className="h-9 w-9 border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition-colors text-zinc-400">
                ×
              </button>
            </div>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  setTextModalOpen(false);
                  void runPrompt(prompt);
                }
              }}
              placeholder="Describe the app you want to generate…"
              className="w-full h-44 md:h-56 bg-zinc-900 border border-zinc-800 p-4 outline-none resize-none text-zinc-100 placeholder:text-zinc-600"
            />
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Cmd/Ctrl + Enter to run</div>
              <button
                onClick={() => {
                  setTextModalOpen(false);
                  void runPrompt(prompt);
                }}
                className="h-11 px-5 bg-zinc-100 text-zinc-950 border border-zinc-100 font-medium hover:bg-white transition-colors"
              >
                Render
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0">
        <div className="absolute inset-0 flex flex-col">
          <header className="h-16 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm px-4 md:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 border border-zinc-700 bg-zinc-900 grid place-items-center text-xs font-semibold">PC</div>
              <div className="min-w-0">
                <div className="text-sm font-medium leading-5 truncate">Prompt Canvas</div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 truncate">Fullscreen AI app generator</div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="hidden md:inline-flex h-10 items-center px-3 border border-zinc-800 bg-zinc-900 text-xs uppercase tracking-[0.24em] text-zinc-500">{status}</span>
              <IconButton title="Text" onClick={() => setTextModalOpen(true)}>Type</IconButton>
              <IconButton title="Voice" onClick={openSpeechRecognition}>{listening ? 'Listening' : 'Speak'}</IconButton>
              <IconButton title="History" onClick={() => { setShowHistory((v) => !v); setShowChats(false); }}>History</IconButton>
              <IconButton title="Chats" onClick={() => { setShowChats((v) => !v); setShowHistory(false); }}>Chats</IconButton>
            </div>
          </header>

          <main
            className="flex-1 relative overflow-hidden"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              pointerStart.current = { x: touch.clientX, y: touch.clientY, t: Date.now(), active: true };
              clearTimeout(holdTimer.current);
              holdTimer.current = setTimeout(() => openSpeechRecognition(), 380);
            }}
            onTouchEnd={() => clearTimeout(holdTimer.current)}
          >
            <div ref={outputRef} className="absolute inset-0 overflow-y-auto scrollbar-thin p-4 md:p-8" />

            <div className="absolute left-4 right-4 bottom-4 md:left-6 md:right-6 md:bottom-6 flex items-end justify-between gap-3 pointer-events-none">
              <div className="pointer-events-auto max-w-[60%] border border-zinc-800 bg-zinc-950/95 px-4 py-3 shadow-hard">
                <div className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Current</div>
                <div className="text-sm text-zinc-100 mt-1 truncate">{generatedMeta ? generatedMeta.prompt : 'Ready'}</div>
              </div>
              <div className="pointer-events-auto border border-zinc-800 bg-zinc-950/95 px-4 py-3 shadow-hard text-right">
                <div className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Chat</div>
                <div className="text-sm text-zinc-100 mt-1 truncate">{activeChat?.name || 'Main'}</div>
              </div>
            </div>
          </main>
        </div>
      </div>

      <div className="fixed left-0 right-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm px-4 md:px-6 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Last response</div>
          <div className="text-sm text-zinc-100 truncate">{clampText(lastResponse, 90)}</div>
        </div>
        <div className="flex items-center gap-2">
          {error ? <div className="hidden md:block text-xs text-red-400 max-w-[24rem] truncate">{error}</div> : null}
          <button
            onClick={() => void runPrompt(prompt || 'Build a minimal dashboard UI')}
            disabled={isThinking}
            className="h-11 px-5 bg-zinc-100 text-zinc-950 border border-zinc-100 font-medium hover:bg-white disabled:opacity-60 transition-colors"
          >
            {isThinking ? 'Running…' : 'Render'}
          </button>
        </div>
      </div>

      {showHistory && <div className="fixed inset-0 bg-black/20 z-20 pointer-events-none" />}
      {showChats && <div className="fixed inset-0 bg-black/20 z-20 pointer-events-none" />}

      <div className="hidden">{lastCode}</div>
      <div className="hidden">{chatSummary.length}</div>
    </div>
  );
}

export default App;
