import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Store } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const [path, setPath] = useState<'choose' | 'login'>('choose');
  const [identifier, setIdentifier] = useState(''); const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const { profile } = useAuth(); const navigate = useNavigate();
  useEffect(() => { if (profile) navigate(profile.role === 'founder' ? '/founder' : '/owner', { replace: true }); }, [profile, navigate]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    const trimmed = identifier.trim();
    const isEmail = trimmed.includes('@');
    const phone = normalizePhone(trimmed);
    if (isEmail && !/^\S+@\S+\.\S+$/.test(trimmed)) return setError('Please enter a valid email address.');
    if (!isEmail && !phone) return setError('Please enter a valid WhatsApp number, including the country code.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    setBusy(true);
    const credentials = isEmail ? { email: trimmed.toLowerCase(), password } : { phone: phone!, password };
    const { error: authError } = await supabase.auth.signInWithPassword(credentials);
    if (authError) { setError('WhatsApp number, email or password is not correct. Please try again.'); setBusy(false); return; }
    setBusy(false);
  };
  return <div className="login-page"><div className="login-art"><Link to="/"><BrandLogo /></Link><div className="login-art-copy"><span>SELL SIMPLY</span><h1>Your shop.<br />Your progress.</h1><p>One calm place to see products, visitors and orders.</p></div><img src="/images/login-seller.jpg" alt="Store owner working on her business" /></div><main className="login-panel"><Link className="back-link" to="/"><ArrowLeft /> Back home</Link><div className="login-box">{path === 'choose' ? <><span className="eyebrow">Welcome to StoYangu</span><h2>What would you like to do?</h2><p>Choose one. Tutakusaidia from there.</p><button className="login-choice" onClick={() => setPath('login')}><span><LockKeyhole /></span><div><strong>Existing store owner</strong><small>Owners use WhatsApp number and password</small></div><ArrowRight /></button><Link className="login-choice" to="/?apply=1"><span><Store /></span><div><strong>Apply for a store</strong><small>Only your name and phone number</small></div><ArrowRight /></Link></> : <><button className="tiny-back" onClick={() => setPath('choose')}><ArrowLeft /> Choose another option</button><span className="eyebrow">Secure login</span><h2>Karibu back</h2><p>Store owners use their WhatsApp number. Founders can continue using email.</p><form className="form-stack" onSubmit={submit}><label>Email or WhatsApp number<input type="text" inputMode="email" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="+254 7... or you@example.com" autoFocus /></label><label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /><button type="button" onClick={() => setShowPassword((show) => !show)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>{error && <div className="form-error">{error}</div>}<button className="button-primary full" disabled={busy}>{busy ? 'Checking…' : 'Login securely'} <ArrowRight /></button></form></>}</div></main></div>;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  const normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits.startsWith('254') ? digits : digits;
  return normalized.length >= 10 && normalized.length <= 15 ? `+${normalized}` : '';
}
