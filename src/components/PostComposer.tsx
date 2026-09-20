import { Check, Image as ImageIcon, Send, X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Modal from '../components/Modal';
import { apiFetch, uploadImage } from '../lib/api';

type SocialAccount = {
  id: number;
  platform: string;
  handle: string;
};

type SocialPost = {
  id: number;
  caption: string;
  platforms: string[];
  status: string;
  created_at: string;
};

const PLATFORMS = [
  { key: 'tiktok', label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'threads', label: 'Threads' },
];

const platformLabel = (key: string) => PLATFORMS.find((item) => item.key === key)?.label || key;

export default function PostComposer({ storeId, onClose, onPosted }: { storeId: number; onClose: () => void; onPosted: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [photos, setPhotos] = useState<Array<{ id: string; url: string; file?: File }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<SocialPost | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<{ accounts: SocialAccount[] }>(`/api/media?action=social&op=status&storeId=${storeId}`)
      .then((data) => {
        setAccounts(data.accounts || []);
        setSelected((data.accounts || []).map((account) => account.platform));
      })
      .catch(() => setError('Could not load your connected accounts.'))
      .finally(() => setLoading(false));
  }, [storeId]);

  const choose = (files?: FileList | null) => {
    const picked = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (!picked.length) return;
    setPhotos((current) => {
      const room = Math.max(0, 4 - current.length);
      if (picked.length > room) setError('A post can carry up to 4 photos.');
      return [...current, ...picked.slice(0, room).map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, url: URL.createObjectURL(file), file }))];
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (caption.trim().length < 2) return setError('Write something to post first.');
    if (!selected.length) return setError('Choose at least one platform. Connect accounts from the Inbox tab first.');
    setBusy(true);
    try {
      const mediaUrls = await Promise.all(
        photos.map(async (photo) => (photo.file ? (await uploadImage(photo.file, 'social')).url : photo.url))
      );
      const data = await apiFetch<{ post: SocialPost }>('/api/media?action=social&op=post', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, caption: caption.trim(), platforms: selected, mediaUrls }),
      });
      setDone(data.post);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish that post.');
    } finally {
      setBusy(false);
    }
  };

  return <Modal title="Post once, everywhere" onClose={onClose}>
    {done ? <div className="form-stack composer-done">
      <div className="composer-success"><span><Check /></span><h3>Posted to {done.platforms.length} app{done.platforms.length === 1 ? '' : 's'}</h3></div>
      <div className="composer-posted-list">{done.platforms.map((platform) => <span key={platform}><Check /> {platformLabel(platform)}</span>)}</div>
      {done.status === 'failed' && <div className="form-error">Repliz could not deliver this time — the post is saved and marked failed. Please try again in a moment.</div>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={() => { setDone(null); setCaption(''); setPhotos([]); }}>Post another</button>
        <button className="button-primary" onClick={() => { onClose(); onPosted(); }}>Open inbox</button>
      </div>
    </div> : <form className="form-stack" onSubmit={submit}>
      <p className="form-intro">Write once — StoYangu sends it to every app you choose.</p>
      <label>Caption<textarea rows={5} maxLength={2200} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="New drop just landed…" /></label>
      <small className="composer-count">{caption.length} / 2200</small>
      {loading ? <p className="composer-hint">Loading your connected accounts…</p> : <fieldset className="composer-platforms">
        <legend>Post to</legend>
        {PLATFORMS.map((item) => {
          const account = accounts.find((row) => row.platform === item.key);
          const on = selected.includes(item.key);
          return <button type="button" key={item.key} className={`composer-platform ${on ? 'selected' : ''}`} disabled={!account} title={account ? account.handle : `Connect ${item.label} from the Inbox tab`} onClick={() => setSelected((current) => on ? current.filter((key) => key !== item.key) : [...current, item.key])}><span className={`platform-dot platform-${item.key}`} />{item.label}{on && <Check />}</button>;
        })}
        {!accounts.length && <p className="composer-hint">No accounts connected yet — open the Inbox tab to connect TikTok, Instagram, Facebook, YouTube and Threads first.</p>}
      </fieldset>}
      <div className="composer-photos">
        {photos.map((photo) => <div className="composer-thumb" key={photo.id}><img src={photo.url} alt="Post attachment" /><button type="button" onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))} aria-label="Remove photo"><X /></button></div>)}
        {photos.length < 4 && <button type="button" className="composer-add" onClick={() => fileRef.current?.click()}><ImageIcon /><span>Add photo</span></button>}
      </div>
      <input ref={fileRef} hidden type="file" accept="image/*" multiple onChange={(event) => { choose(event.target.files); event.target.value = ''; }} />
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button className="button-primary" disabled={busy}>{busy ? 'Posting…' : <><Send /> Post now</>}</button>
      </div>
    </form>}
  </Modal>;
}
