import { useCallback, useEffect, useState } from 'react';
import { Edit3, Save, Trash2 } from 'lucide-react';
import Modal from './Modal';
import { apiFetch } from '../lib/api';
import type { SocialPost } from '../types';
export default function SavedPosts({ storeId, onClose }: { storeId: number; onClose: () => void }) {
  const [posts, setPosts] = useState<SocialPost[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [editing, setEditing] = useState<number | null>(null); const [caption, setCaption] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const data = await apiFetch<{ posts: SocialPost[] }>(`/api/media?action=social&op=posts&storeId=${storeId}`); setPosts(data.posts.filter(post => post.status === 'draft')); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load drafts.'); } finally { setLoading(false); } }, [storeId]);
  useEffect(() => { void load(); }, [load]);
  const mutate = async (id: number, remove = false) => {
    if (remove && !window.confirm('Delete this saved draft?')) return;
    if (!remove && !caption.trim()) { setError('A caption is required.'); return; }
    setBusy(true); setError('');
    try { await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: remove ? 'delete_draft' : 'update_draft', store_id: storeId, id, caption: caption.trim() }) }); await load(); setEditing(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update the draft.'); }
    finally { setBusy(false); }
  };
  return <Modal title="Saved drafts" onClose={onClose}><div className="saved-draft-list">{loading ? <p role="status">Loading drafts…</p> : posts.length ? posts.map(post => <article key={post.id}><small>{new Date(post.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'long' })} · Not published</small><div className="draft-media">{post.media_urls.map((url, i) => (post.results?.media_kinds as string[] | undefined)?.[i] === 'video' ? <video key={url} src={url} controls playsInline preload="metadata" /> : <img key={url} src={url} alt={`Draft photo ${i + 1}`} />)}</div>{editing === post.id ? <label className="composer-caption">Caption<textarea aria-label="Draft caption" value={caption} onChange={e => setCaption(e.target.value)} rows={6} maxLength={2200} /></label> : <pre>{post.caption}</pre>}<div className="modal-actions">{editing === post.id ? <button className="button-primary compact" onClick={() => mutate(post.id)} disabled={busy}><Save /> Save changes</button> : <button className="secondary-button" onClick={() => { setCaption(post.caption); setEditing(post.id); }} disabled={busy}><Edit3 /> Edit caption</button>}<button className="secondary-button" aria-label="Delete draft" onClick={() => mutate(post.id, true)} disabled={busy}><Trash2 /></button></div></article>) : <div className="orders-empty">No saved drafts yet. Create a post and choose Save draft.</div>}{error && <div className="form-error" role="alert">{error}</div>}</div></Modal>;
}
