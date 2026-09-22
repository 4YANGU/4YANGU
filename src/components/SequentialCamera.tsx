import { useEffect, useRef, useState } from 'react';
import { Camera, Check, X } from 'lucide-react';
export default function SequentialCamera({ room, onClose, onUse }: { room: number; onClose: () => void; onUse: (files: File[]) => void }) {
  const finder = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const previews = useRef(new Set<string>());
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable. Please use Gallery instead.');
        const video = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1600 } } });
        if (!alive) { video.getTracks().forEach(t => t.stop()); return; }
        stream.current = video;
        if (finder.current) { finder.current.srcObject = video; await finder.current.play(); }
      } catch { if (alive) setError('Allow camera access in your browser, or use Gallery.'); }
      finally { if (alive) setStarting(false); }
    })();
    return () => { alive = false; stream.current?.getTracks().forEach(t => t.stop()); previews.current.forEach(URL.revokeObjectURL); };
  }, []);
  const capture = async () => {
    if (capturing || shots.length >= room || !finder.current?.videoWidth) return;
    setCapturing(true); setError('');
    try {
      const canvas = document.createElement('canvas'); const v = finder.current;
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Capture unavailable.');
      context.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
      if (!blob) throw new Error('Unable to capture. Please try again.');
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const url = URL.createObjectURL(file); previews.current.add(url);
      setShots(current => [...current, { file, url }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setCapturing(false); }
  };
  return <div className="recorder-backdrop" role="dialog" aria-modal="true" aria-label="Take product photos"><div className="recorder-shell photo-capture-shell sequential-camera"><div className="recorder-top"><button onClick={onClose} aria-label="Close camera"><X /></button><strong>Photos · {shots.length}/{room}</strong><span>{room - shots.length} left</span></div><div className="photo-burst-live"><video ref={finder} playsInline muted autoPlay /></div>{error && <div className="form-error">{error}</div>}<div className="recorder-controls camera-v12"><button className="button-primary" onClick={capture} disabled={starting || capturing || shots.length >= room || !!error}><Camera />{starting ? 'Opening camera…' : capturing ? 'Taking photo…' : 'Take photo'}</button><div className="sequential-preview-grid">{shots.map((shot, index) => <div key={shot.url} className="sequential-preview-cell"><img src={shot.url} alt={`Photo ${index + 1}`} /><button aria-label={`Delete photo ${index + 1}`} onClick={() => { URL.revokeObjectURL(shot.url); previews.current.delete(shot.url); setShots(current => current.filter(item => item !== shot)); }}><X size={14} /></button></div>)}</div><button className="button-primary" disabled={!shots.length || capturing} onClick={() => onUse(shots.map(shot => shot.file))}><Check /> Use {shots.length} photo{shots.length !== 1 ? 's' : ''}</button></div></div></div>;
}
