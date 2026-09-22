import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Store } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { signInWithGoogle } from '../lib/googleAuth';

export default function LoginPage() {
  const [path, setPath] = useState<'choose' | 'login'>('choose');
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const { profile, error: profileError, refreshProfile } = useAuth(); const navigate = useNavigate(); const location = useLocation();

  useEffect(() => { if (profile) { const from = location.state?.from; const allowed = typeof from === 'string' && (from.startsWith('/owner') || profile.role === 'founder' && /^\/(founder|manage\/\d+)(\?|$)/.test(from)); navigate(allowed ? from : profile.role === 'founder' ? '/founder' : '/owner', { replace: true }); } }, [profile, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    const trimmed = identifier.trim();
    const isEmail = trimmed.includes('@');
    const phone = normalizePhone(trimmed);
    if (isEmail && !/^\S+@\S+\.\S+$/.test(trimmed)) return setError('Please enter a valid email address.');
    if (!isEmail && !phone) return setError('Please enter a valid WhatsApp number, e.g. 0712 345 678.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    try {
      const credentials = { email: isEmail ? trimmed.toLowerCase() : ownerAuthEmail(phone!), password };
      const { error: authError } = await supabase.auth.signInWithPassword(credentials);
      if (authError) throw authError;
    } catch (e: any) {
      setError('Your WhatsApp number or password is not correct. Please try again.');
    } finally { setBusy(false); }
  };

  return <div className="login-page">
    <div className="login-art"><Link to="/"><BrandLogo /></Link><div className="login-art-copy"><span>SELL SIMPLY</span><h1>Your shop.<br />Your progress.</h1><p>One calm place to see products, visitors and orders.</p></div><img src="/images/login-seller.jpg" alt="Store owner working on her business" /></div>
    <main className="login-panel"><Link className="back-link" to="/"><ArrowLeft /> Back home</Link>
      <div className="login-box">
        {path === 'choose' ? <>
          <span className="eyebrow">Welcome to StoYangu</span>
          <h2>What would you like to do?</h2><p>Choose one.</p>
          <button className="login-choice" onClick={() => setPath('login')}><span><LockKeyhole /></span><div><strong>Existing store owner</strong><small>Owners use WhatsApp number and password</small></div><ArrowRight /></button>
          <Link className="login-choice" to="/?apply=1"><span><Store /></span><div><strong>Apply for a store</strong><small>Only your name and phone number</small></div><ArrowRight /></Link>
          {error && <div className="form-error">{error}</div>}
        </> : <>
          <button className="tiny-back" onClick={() => setPath('choose')}><ArrowLeft /> Choose another option</button>
          <span className="eyebrow">Secure login</span><h2>Karibu back</h2><p>Enter the WhatsApp number you used when your store was created.</p>
          <form className="form-stack" onSubmit={submit}>
            <label>WhatsApp number or email<input type="text" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="0712 345 678 or your email" autoFocus /><small>Use your store's WhatsApp number, or your founder email.</small></label>
            <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /><button type="button" onClick={() => setShowPassword((show) => !show)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
            {error && <div className="form-error">{error}</div>}
            <button className="button-primary full" disabled={busy}>{busy ? 'Checking…' : 'Login securely'} <ArrowRight /></button>
            <span style={{ textAlign: 'center', color: '#879184', fontSize: 11 }}>or</span>
            <button type="button" className="secondary-button" disabled={busy} onClick={async () => { setError(''); setBusy(true); try { await signInWithGoogle('StoYangu'); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign in.'); } finally { setBusy(false); } }}>Sign in with Google</button>
          </form>
        </>}
        {profileError && <div className="form-error" role="alert">{profileError} <button type="button" onClick={refreshProfile}>Retry</button></div>}
      </div>
    </main>
  </div>;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  let normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
  if (!normalized.startsWith('254') && (normalized.startsWith('7') || normalized.startsWith('1')) && normalized.length === 9) normalized = `254${normalized}`;
  return normalized.length >= 10 && normalized.length <= 15 ? `+${normalized}` : '';
}
function ownerAuthEmail(phone: string) {
  return `phone-${phone.replace(/\D/g, '')}@owners.stoyangu.invalid`;
}
