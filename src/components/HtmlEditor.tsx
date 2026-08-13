import { Check, Clipboard, Code2, ExternalLink, FileCode2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import { apiFetch, storeLink } from '../lib/api';
import type { Store } from '../types';
import '../html-storefront.css';

function existingHtml(store: Store) {
  return String(store.design_json?.storefront_html || '').trim();
}

type SaveResult = {
  notes?: string[];
  headline?: string;
  summary?: Record<string, number>;
  replaced_images?: number;
};

export default function HtmlEditor({ store, onClose, onSaved }: { store: Store; onClose: () => void; onSaved: () => void }) {
  const [html, setHtml] = useState(existingHtml(store));
  const [error, setError] = useState('');
  const [result, setResult] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [starterBusy, setStarterBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ prompt: string }>(`/api/storefront?action=prompt&store_id=${store.id}`)
      .then((payload) => setPrompt(payload.prompt || ''))
      .catch(() => undefined);
  }, [store.id]);

  const copyPrompt = async () => {
    const text = prompt || 'Design one self-contained HTML storefront file for this Kenyan shop. All CSS in one <style>. Use Unsplash images. Include a product area the app can fill.';
    try {
      await navigator.clipboard.writeText(text);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 2200);
    } catch {
      window.prompt('Copy this prompt manually:', text);
    }
  };

  const loadStarter = async () => {
    setStarterBusy(true); setError('');
    try {
      const payload = await apiFetch<{ template: string }>('/api/storefront?action=default');
      setHtml(payload.template || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the starter template.');
    } finally {
      setStarterBusy(false);
    }
  };

  const save = async () => {
    if (!html.trim()) return setError('Paste the HTML the AI gave you first.');
    setBusy(true); setError(''); setResult(null);
    try {
      const payload = await apiFetch<SaveResult>('/api/storefront?action=save', {
        method: 'POST',
        body: JSON.stringify({ store_id: store.id, template: html }),
      });
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the HTML.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Storefront HTML: ${store.name}`} onClose={onClose} wide>
      <div className="json-editor-help">
        <FileCode2 />
        <p>
          Paste the complete HTML file from your AI. When you save, StoYangu sanitises it and lists everything that was removed or changed.
          Unsplash photos are copied into your storage. WhatsApp ordering is wired in for you.
        </p>
        <a href={`${storeLink(store.slug)}?fresh=1`} target="_blank" rel="noreferrer">Open live preview <ExternalLink /></a>
        <button type="button" className="prompt-copy-button" onClick={copyPrompt}>
          {promptCopied ? <><Check /> Prompt copied!</> : <><Clipboard /> Copy AI HTML prompt</>}
        </button>
      </div>
      <textarea
        className="code-input json-editor html-editor"
        value={html}
        onChange={(event) => { setHtml(event.target.value); setError(''); setResult(null); }}
        spellCheck={false}
        placeholder="<!doctype html>... paste the full storefront HTML here"
      />
      {result && (
        <div className="sanitize-report" role="status">
          <div className="sanitize-report-head">
            <ShieldCheck />
            <strong>{result.headline || 'Sanitisation complete.'}</strong>
          </div>
          {typeof result.replaced_images === 'number' && result.replaced_images > 0 && (
            <p className="sanitize-report-extra">Copied {result.replaced_images} photo{result.replaced_images === 1 ? '' : 's'} into StoYangu storage.</p>
          )}
          {result.notes && result.notes.length > 0 ? (
            <ol>
              {result.notes.map((note) => <li key={note}>{note}</li>)}
            </ol>
          ) : (
            <p>Nothing unsafe was found. The HTML was saved as designed.</p>
          )}
          <div className="sanitize-report-actions">
            <a className="secondary-button" href={`${storeLink(store.slug)}?fresh=1`} target="_blank" rel="noreferrer">View store</a>
            <button type="button" className="button-primary" onClick={onSaved}>Done</button>
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={loadStarter} disabled={starterBusy}>
          {starterBusy ? <RefreshCw className="spin" /> : <Code2 />}
          {starterBusy ? 'Loading…' : 'Load starter template'}
        </button>
        <button className="button-primary" disabled={busy} onClick={save}>
          {busy ? 'Sanitising and saving…' : 'Save HTML storefront'} <Check />
        </button>
      </div>
    </Modal>
  );
}
