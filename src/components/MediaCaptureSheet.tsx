import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, Mic, Video, X } from 'lucide-react';
import { clearHistoryFlag, pushBackHandler, pushHistoryFlag } from '../lib/backNavigation';

type MediaItem = { file: File; url: string; kind: 'image' | 'video' };
type Props = {
  onClose: () => void;
  onUse: (files: File[]) => void;
  title?: string;
  maxPhotos?: number;
  maxVideos?: number;
  maxItems?: number;
};

function kindOf(file: File): MediaItem['kind'] | null {
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(file.name)) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name)) return 'video';
  return null;
}

export default function MediaCaptureSheet({ onClose, onUse, title = 'Add media', maxPhotos = 7, maxVideos = 1, maxItems = 8 }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [cameraLoading, setCameraLoading] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const swipeStartY = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    pushHistoryFlag('stoyanguMediaCapture');
    const removeBackHandler = pushBackHandler(() => { onCloseRef.current(); return true; });
    return () => {
      removeBackHandler();
      clearHistoryFlag('stoyanguMediaCapture');
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const openCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: true });
        } catch {
          // Some devices grant the camera but not the microphone. Photo capture
          // should still work, and video recording can fall back to silent video.
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        }
        if (!alive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        setCameraReady(true);
        setCameraError('');
      } catch (reason) {
        if (alive) setCameraError(reason instanceof Error ? reason.message : 'Camera could not be opened. You can still browse your gallery.');
      } finally {
        if (alive) setCameraLoading(false);
      }
    };
    void openCamera();
    const objectUrls = objectUrlsRef.current;
    return () => {
      alive = false;
      const recorder = recorderRef.current;
      if (recorder?.state === 'recording') {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [cameraReady]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds((current) => {
        if (current >= 59) recorderRef.current?.stop();
        return current + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const addFiles = (files: File[]) => {
    setError('');
    let photoRoom = Math.max(0, maxPhotos - items.filter((item) => item.kind === 'image').length);
    let videoRoom = Math.max(0, maxVideos - items.filter((item) => item.kind === 'video').length);
    let itemRoom = Math.max(0, maxItems - items.length);
    const accepted: Array<{ file: File; kind: MediaItem['kind'] }> = [];
    let rejectedType = false;
    let rejectedLimit = false;
    let rejectedSize = false;

    for (const file of files) {
      const kind = kindOf(file);
      if (!kind) {
        rejectedType = true;
        continue;
      }
      const limit = kind === 'video' ? 75 * 1024 * 1024 : 15 * 1024 * 1024;
      if (file.size > limit) {
        rejectedSize = true;
        continue;
      }
      if (itemRoom <= 0 || (kind === 'image' ? photoRoom <= 0 : videoRoom <= 0)) {
        rejectedLimit = true;
        continue;
      }
      accepted.push({ file, kind });
      itemRoom -= 1;
      if (kind === 'image') photoRoom -= 1;
      else videoRoom -= 1;
    }

    const next = accepted.map(({ file, kind }) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.add(url);
      return { file, kind, url };
    });
    if (next.length) setItems((current) => [...current, ...next]);
    if (rejectedSize) setError('Photos must be under 15 MB and videos under 75 MB.');
    else if (rejectedLimit) setError(`You can add up to ${maxPhotos} photos${maxVideos ? ' and one video' : ''}.`);
    else if (rejectedType) setError('Choose photo or video files only.');
  };

  const removeItem = (item: MediaItem) => {
    URL.revokeObjectURL(item.url);
    objectUrlsRef.current.delete(item.url);
    setItems((current) => current.filter((entry) => entry !== item));
    setError('');
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError('The camera is still starting. Try again in a moment.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('This browser could not capture the photo. Please use the gallery.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('The photo could not be saved. Please try again.');
        return;
      }
      addFiles([new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
    }, 'image/jpeg', 0.92);
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setError('Video recording is not available. Browse your gallery instead.');
      return;
    }
    try {
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || 'video/webm';
        const extension = type.includes('mp4') ? 'mp4' : 'webm';
        const file = new File(chunksRef.current, `camera-${Date.now()}.${extension}`, { type });
        chunksRef.current = [];
        setRecording(false);
        setRecordingSeconds(0);
        if (file.size) addFiles([file]);
        else setError('No video was recorded. Please try again.');
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecordingSeconds(0);
      setRecording(true);
      setError('');
    } catch {
      setError('Video recording could not start. Try another camera or use the gallery.');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const openGallery = () => fileInputRef.current?.click();
  const onDrawerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => { swipeStartY.current = event.clientY; };
  const onDrawerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (swipeStartY.current !== null && swipeStartY.current - event.clientY > 36) openGallery();
    swipeStartY.current = null;
  };
  const finish = () => {
    if (!items.length) return;
    onUse(items.map((item) => item.file));
  };

  return <div className="media-capture-backdrop" role="presentation" onClick={onClose}>
    <section className="media-capture-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
      <header className="media-capture-header">
        <button type="button" onClick={onClose} aria-label="Close media picker"><X /></button>
        <div><strong>{title}</strong><small>Take a photo, record a video, or choose from your phone</small></div>
        <span className="media-capture-count">{items.length}/{maxItems}</span>
      </header>

      <div className="media-capture-stage">
        {cameraReady
          ? <video ref={videoRef} className="media-capture-live-video" playsInline autoPlay muted aria-label="Live camera preview" />
          : <div className="media-capture-camera-fallback"><Camera /><strong>{cameraLoading ? 'Opening camera…' : 'Camera unavailable'}</strong><span>{cameraError || 'You can still select media from your gallery.'}</span></div>}
        {recording && <div className="media-recording-indicator"><span /> REC {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}</div>}
        {!recording && cameraReady && <div className="media-capture-modes" role="group" aria-label="Capture type">
          <button type="button" className={mode === 'photo' ? 'active' : ''} onClick={() => { setMode('photo'); setError(''); }}><Camera /> Photo</button>
          <button type="button" className={mode === 'video' ? 'active' : ''} onClick={() => { setMode('video'); setError(''); }}><Video /> Video</button>
        </div>}
      </div>

      <div className="media-capture-drawer">
        <div className="media-capture-drawer-handle" onPointerDown={onDrawerPointerDown} onPointerUp={onDrawerPointerUp} onPointerCancel={() => { swipeStartY.current = null; }}>
          <span className="drawer-grip" />
          <strong>Recent media</strong>
          <button type="button" onClick={openGallery}><ImagePlus /> Browse</button>
          <small>Swipe up to open gallery</small>
        </div>
        <div className="media-capture-strip" role="list" aria-label="Selected media">
          {items.map((item, index) => <div className="media-capture-thumb" role="listitem" key={`${item.file.name}-${item.file.lastModified}-${index}`}>
            {item.kind === 'video' ? <video src={item.url} muted playsInline preload="metadata" /> : <img src={item.url} alt={`Selected ${item.kind} ${index + 1}`} />}
            {item.kind === 'video' && <span className="media-capture-thumb-video"><Video /></span>}
            <button type="button" aria-label={`Remove media ${index + 1}`} onClick={() => removeItem(item)}><X /></button>
          </div>)}
          {!items.length && <span className="media-capture-empty">Your selected photos and videos will appear here.</span>}
        </div>
        {error && <p className="media-capture-error" role="alert">{error}</p>}
        <div className="media-capture-footer">
          <button type="button" className="media-gallery-button" onClick={openGallery} aria-label="Browse photos and videos"><ImagePlus /><span>Gallery</span></button>
          <button type="button" className={`media-capture-shutter ${mode === 'video' ? 'video-mode' : ''} ${recording ? 'recording' : ''}`} onClick={recording ? stopRecording : mode === 'photo' ? capturePhoto : startRecording} disabled={cameraLoading || (!cameraReady && !recording)} aria-label={recording ? 'Stop video recording' : mode === 'photo' ? 'Take photo' : 'Record video'}>
            {mode === 'photo' ? <Camera /> : recording ? <span className="media-stop-square" /> : <span className="media-record-dot" />}
          </button>
          <button type="button" className="button-primary media-capture-use" onClick={finish} disabled={!items.length}><Check /> Use {items.length || ''}</button>
        </div>
        <p className="media-capture-permission"><Mic /> Camera and microphone are used only while this screen is open.</p>
      </div>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*,video/*,.avif,.heic,.heif,.mp4,.mov,.m4v,.webm,.3gp" multiple onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
    </section>
  </div>;
}
