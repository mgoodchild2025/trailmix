// Search CG Core's clients, prospects and leads as you type (2+ characters).
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/bridge.js';
import { errMsg } from '../lib/util.js';
import Icon from './Icon.jsx';

export default function ClientSearch({ onPick, toast, autoFocus = true }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (query.trim().length < 2) return setResults(null);
    let alive = true;
    const t = setTimeout(() => {
      api.filing
        .search(query)
        .then((r) => alive && setResults(r))
        .catch((e) => alive && (setResults([]), toast(errMsg(e))));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, toast]);

  return (
    <>
      <label className="search">
        <Icon name="search" />
        <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients, prospects and leads" />
      </label>
      <div className="file-results" role="listbox">
        {results === null ? (
          <p className="muted small pad">Type at least two letters of the name.</p>
        ) : results.length === 0 ? (
          <p className="muted small pad">No clients, prospects or leads match.</p>
        ) : (
          results.map((r) => (
            <button key={`${r.type}:${r.id}`} className="file-result" role="option" aria-selected="false" onClick={() => onPick(r)}>
              <span>{r.name}</span>
              <span className="muted small">{r.detail}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
