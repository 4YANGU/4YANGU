// Woyoyo-004: TikTok-style vertical recorder. Records with the back camera by
// default (tap Flip for selfie), shows a live 9:16 portrait finder, then hands
// the finished .webm/.mp4 blob to the composer. No extra deploy deps.

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, FlipHorizontal2, Trash2, Video, X } from 'lucide-react';

type Props = {
  onDone: (file: File) => void;
  onClose: () => void;
  // Woyoyo-005: camera-first post flow — custom step title, instructions and
  // an optional skip (e.g. sellers who only want product photos).
  title?: string;
  instructions?: string;
  skipLabel?: string;
  onSkip?: () => void;
};

const MAX_SECONDS = 180;

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export default function VideoRecorder({ onDone, onClose, title, instructions, skipLabel, onSkip }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef(0);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [phase, setPhase] = useState<'starting' | 'preview' | 'recording' | 'review'>('starting');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [reviewUrl, setReviewUrl] = useState('');
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const mimeType = useRef(pickMimeType());

  const stopStream = () => {
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    mediaRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      setError('');
      setPhase('starting');
      stopStream();
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot open the camera. Please use Chrome or Safari on your phone.');
        setPhase('preview');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: { ideal: facing }, width: { ideal: 1080 }, height: { ideal: 1920 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        mediaRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => undefined);
        }
        setPhase('preview');
      } catch {
        if (!cancelled) {
          setError('Camera access was blocked. Allow the camera (and microphone) for this site, then tap the cross and try again.');
          setPhase('preview');
        }
      }
    };
    start();
    return () => { cancelled = true; stopStream(); window.clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  useEffect(() => () => { if (reviewUrl) URL.revokeObjectURL(reviewUrl); }, [reviewUrl]);

  const startRecording = () => {
    const stream = mediaRef.current;
    if (!stream) return;
    chunksRef.current = [];
    try {
      const recorder = new MediaRecorder(stream, mimeType.current ? { mimeType: mimeType.current, videoBitsPerSecond: 6_000_000 } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = mimeType.current.split(';')[0] || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        const extension = type.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `post-video-${Date.now()}.${extension}`, { type });
        const url = URL.createObjectURL(blob);
        setReviewFile(file);
        setReviewUrl(url);
        setPhase('review');
        window.clearInterval(timerRef.current);
      };
      recorder.start(250);
      setSeconds(0);
      setPhase('recording');
      timerRef.current = window.setInterval(() => {
        setSeconds((value) => {
          if (value + 1 >= MAX_SECONDS) stopRecording();
          return value + 1;
        });
      }, 1000);
    } catch {
      setError('Recording is not supported in this browser. Please update Chrome or Safari and try again.');
    }
  };

  const stopRecording = () => {
    window.clearInterval(timerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    else setPhase('preview');
  };

  const retake = () => {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewUrl('');
    setReviewFile(null);
    setSeconds(0);
    setPhase('preview');
  };

  const useIt = () => {
    if (reviewFile) onDone(reviewFile);
  };

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return <div className="recorder-backdrop" role="dialog" aria-modal="true" aria-label="Record a video">
    <div className="recorder-shell">
      <div className="recorder-top">
        <button type="button" onClick={onClose} aria-label="Close recorder"><X /></button>
        <strong>{phase === 'review' ? 'Preview' : phase === 'recording' ? `● REC ${clock}` : (title || 'Record · 9:16 vertical')}</strong>
        <span>{phase === 'recording' ? `${MAX_SECONDS - seconds}s left` : 'up to 3 min'}</span>
      </div>
      {instructions && phase !== 'review' && <p className="recorder-instructions">{instructions}</p>}
      <div className="recorder-finder">
        {phase === 'review' && reviewUrl
          ? <video src={reviewUrl} controls playsInline className="recorder-video" />
          : <video ref={videoRef} playsInline muted className="recorder-video" />}
        {phase === 'starting' && <div className="recorder-status">Opening camera…</div>}
        {phase === 'recording' && <span className="recorder-dot" aria-hidden="true" />}
      </div>
      {error && <div className="form-error recorder-error">{error}</div>}
      <div className="recorder-controls">
        {phase === 'review' ? <>
          <button type="button" className="secondary-button" onClick={retake}><Trash2 /> Retake</button>
          <button type="button" className="button-primary" onClick={useIt} disabled={!reviewFile}><Check /> Use this video</button>
        </> : phase === 'recording' ? <>
          <button type="button" className="secondary-button" onClick={stopRecording}><Video /> Stop</button>
          <span className="recorder-hint">Tap Stop when you finish talking.</span>
        </> : <>
          <button type="button" className="secondary-button" onClick={() => setFacing((value) => value === 'environment' ? 'user' : 'environment')}><FlipHorizontal2 /> Flip</button>
          <button type="button" className="button-primary recorder-go" onClick={startRecording} disabled={phase === 'starting' || Boolean(error)}><Camera /> Start recording</button>
          {onSkip && <button type="button" className="secondary-button recorder-skip" onClick={onSkip}>{skipLabel || 'Skip'}</button>}
        </>}
      </div>
    </div>
  </div>;
}
