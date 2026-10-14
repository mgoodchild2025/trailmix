import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/bridge.js';
import { renderMarkdown } from '../lib/markdown.js';
import { errMsg, uid } from '../lib/util.js';
import Icon from './Icon.jsx';

const MEETING_PROMPTS = ['Draft a follow-up email', 'What are my action items?', 'Write a ticket note', 'What did they push back on?'];
const LIBRARY_PROMPTS = ['What did I commit to this week?', 'Which clients raised backup issues?', 'Summarise my meetings since Monday'];

export default function ChatPanel({ meetingId, initial = [], onSave, onClose, full, toast, disabled }) {
  const [messages, setMessages] = useState(initial);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(null); // { requestId, text }
  const bodyRef = useRef(null);

  useEffect(() => setMessages(initial), [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  async function ask(text) {
    const q = text.trim();
    if (!q || pending) return;
    if (disabled) return toast(disabled);
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    const requestId = uid();
    setPending({ requestId, text: '' });
    const off = api.ai.onDelta((d) => d.requestId === requestId && setPending((p) => p && { ...p, text: p.text + d.text }));
    try {
      const { text: answer } = await api.ai.chat({ requestId, meetingId, messages: next });
      const done = [...next, { role: 'assistant', content: answer }];
      setMessages(done);
      onSave?.(done);
    } catch (e) {
      setMessages(messages);
      setInput(q);
      if (!/Cancelled/.test(errMsg(e))) toast(errMsg(e));
    } finally {
      off();
      setPending(null);
    }
  }

  const prompts = meetingId ? MEETING_PROMPTS : LIBRARY_PROMPTS;

  return (
    <section className={`chat ${full ? 'full' : ''}`}>
      {!full && (
        <header className="panel-head">
          <span>
            <Icon name="sparkle" /> Ask about this meeting
          </span>
          <span className="row gap-s">
            {messages.length > 0 && (
              <button className="link small" onClick={() => (setMessages([]), onSave?.([]))}>
                Clear
              </button>
            )}
            <button className="icon-btn" onClick={onClose} title="Close">
              <Icon name="close" />
            </button>
          </span>
        </header>
      )}
      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && !pending && (
          <div className="chat-empty">
            <p className="muted">{meetingId ? 'Ask anything about this meeting.' : 'Ask a question across all of your meetings.'}</p>
            <div className="suggestions">
              {prompts.map((p) => (
                <button key={p} className="chip button" onClick={() => ask(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={i} m={m} />
        ))}
        {pending && (
          <div className="msg assistant">
            {pending.text ? <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(pending.text) }} /> : <span className="typing"><i /><i /><i /></span>}
          </div>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={meetingId ? 'Ask about this meeting…' : 'Ask across all meetings…'} autoFocus />
        {pending ? (
          <button type="button" className="icon-btn" onClick={() => api.ai.cancel(pending.requestId)} title="Stop">
            <Icon name="stop" />
          </button>
        ) : (
          <button type="submit" className="icon-btn accent" disabled={!input.trim()} title="Send">
            <Icon name="send" />
          </button>
        )}
      </form>
    </section>
  );
}

function Message({ m }) {
  if (m.role === 'user') return <div className="msg user">{m.content}</div>;
  return (
    <div className="msg assistant">
      <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
      <button className="link small" onClick={() => api.exporter.copy({ text: m.content, html: renderMarkdown(m.content) })}>
        <Icon name="copy" size={12} /> Copy
      </button>
    </div>
  );
}
