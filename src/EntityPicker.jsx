import React, { useEffect, useRef, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';

/**
 * Predictive record lookup for create/edit forms.
 * Props:
 *   endpoint   e.g. "/api/v1/parties/search"
 *   book       "DIRECT" | "ASSUMED" | undefined
 *   value      selected record id
 *   valueLabel selected display label
 *   onChange   (id, item | null) => void
 *   placeholder
 *   disabled
 */
export default function EntityPicker({ endpoint, book, value, valueLabel, onChange, placeholder = 'Search by number or name…', disabled = false }) {
  const [term, setTerm] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const q = term.trim();
    if (!open || q.length < 2) {
      setItems([]);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError('');
      try {
        const headers = { 'X-EIA-Tenant': TENANT };
        if (book) headers['X-EIA-Book'] = book;
        const response = await fetch(`${endpoint}?q=${encodeURIComponent(q)}&limit=8`, { headers, signal: controller.signal });
        if (!response.ok) throw new Error(`Lookup failed (${response.status})`);
        const body = await response.json();
        setItems(Array.isArray(body) ? body : (Array.isArray(body.items) ? body.items : []));
      } catch (e) {
        if (e.name !== 'AbortError') {
          setItems([]);
          setError(e.message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [term, open, endpoint, book]);

  const choose = (item) => {
    onChange(item.id, item);
    setOpen(false);
    setTerm('');
  };

  if (value) {
    return (
      <div className="eia-picker" ref={rootRef}>
        <div className="eia-picker-selected">
          <span className="value">
            <b>{valueLabel || value}</b>
            <small>{value}</small>
          </span>
          <button type="button" disabled={disabled} onClick={() => onChange('', null)}>Change</button>
        </div>
      </div>
    );
  }

  return (
    <div className="eia-picker" ref={rootRef}>
      <input
        type="search"
        value={term}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => { setTerm(event.target.value); setOpen(true); }}
        aria-label={placeholder}
      />
      {!open && <span className="eia-picker-hint">Type at least two characters to search existing records.</span>}
      {open && (
        <div className="eia-picker-results">
          {loading && <div className="eia-picker-empty">Searching…</div>}
          {!loading && error && <div className="eia-picker-empty">{error}</div>}
          {!loading && !error && term.trim().length < 2 && <div className="eia-picker-empty">Start typing to find a record.</div>}
          {!loading && !error && term.trim().length >= 2 && items.length === 0 && <div className="eia-picker-empty">No matching records.</div>}
          {!loading && items.map((item) => (
            <button type="button" key={item.id || item.href} className="eia-picker-option" onClick={() => choose(item)}>
              <span className="value">
                <b>{item.label}</b>
                <small>{item.secondary}</small>
              </span>
              <span className="status">{item.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
