import { ArrowRight, Check, Mail, MessageCircle, Play, ShieldCheck, Sparkles, Store as StoreIcon, Video } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import BrandLogo from '../components/BrandLogo';
import Modal from '../components/Modal';
import Seo from '../components/Seo';
import type { Product, Store } from '../types';
import { formatMoney } from '../lib/api';
import '../marketing-upgrade.css';

const marketingSchema = [
  { '@context': 'https://schema.org', '@type': 'Organization', name: 'StoYangu', slogan: 'My Store, My Hope', email: 'info@stoyangu.com', telephone: '+254793533683', areaServed: { '@type': 'Country', name: 'Kenya' }, logo: '/stoyangu-logo.png' },
  { '@context': 'https://schema.org', '@type': 'WebSite', name: 'StoYangu', description: 'Online storefronts for Kenyan social-media sellers.', inLanguage: ['en', 'sw'] },
  { '@context': 'https://schema.org', '@type': 'Service', name: 'StoYangu online store setup', areaServed: 'Kenya', serviceType: 'Online storefront design and product catalog', offers: [{ '@type': 'Offer', name: "Full store design and build (value KES 15,000) — waived in exchange for a 1-minute testimonial video", price: '0', priceCurrency: 'KES' }, { '@type': 'Offer', name: 'Store hosting and maintenance after 30 free days', price: '999', priceCurrency: 'KES' }] },
];

export default function MarketingPage() {
  const [applyOpen, setApplyOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+254');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [featured, setFeatured] = useState<{ store: Store; products: Product[] } | null>(null);

  useEffect(() => {
    fetch('/api/stores?featured=1').then((res) => res.ok ? res.json() : null).then(setFeatured).catch(() => undefined);
    if (new URLSearchParams(window.location.search).get('apply') === '1') {
      setApplyOpen(true);
      window.history.replaceState({}, '', '/');
    }
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    if (name.trim().length < 2) return setMessage('Please add your full name.');
    if (!/^\+?[0-9\s-]{9,16}$/.test(phone)) return setMessage('Please add a valid phone number.');
    setSending(true);
    try {
      const response = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage('Asante! Tumepata details zako. We will call you soon.'); setName(''); setPhone('+254');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setSending(false); }
  };
  const canonical = `https://${String(import.meta.env.VITE_ROOT_DOMAIN || window.location.host).replace(/^www\./, '')}/`;
  return <div className="marketing-page">
    <Seo title="StoYangu" description="Beautiful online stores for Kenyan social-media sellers of clothes, perfumes, watches and other physical products. Customers browse and order through WhatsApp." canonical={canonical} schema={marketingSchema} />
    <header className="marketing-nav"><a href="/" aria-label="StoYangu home"><BrandLogo /></a><nav aria-label="Main navigation"><a href="#how">Inawork aje?</a><a href="#get-store">Napata StoYangu aje?</a><a href="#pricing">Ni how much?</a></nav><nav className="marketing-quick-links" aria-label="Quick navigation"><a href="#how">Inawork aje?</a><a href="#pricing">Ni how much?</a></nav><a className="nav-login" href="/login">Login <ArrowRight size={16} /></a></header>
    <main>
      <section className="hero-section">
        <div className="hero-glow" />
        <motion.div className="hero-copy" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}>
          <span className="hero-pill"><Sparkles size={15} /> Store yako. Free kuanza.</span>
          <h1>Video Yangu,<br /><em>Store Yangu</em></h1>
          <div className="hero-offer"><span>A full store build: <s>KES 15,000</s></span><b>FREE kwako</b><small>Lipa na a short 1-minute video about your biashara — then KES 999/month hosting & maintenance after your free 30 days.</small></div>
          <div className="hero-commerce-tags"><span>Clothes</span><span>Perfumes</span><span>Watches</span><span>Anything physical</span></div>
          <div className="hero-actions"><button className="button-primary" onClick={() => setApplyOpen(true)}>Apply for my store <ArrowRight /></button><a className="text-link" href="#how"><Play size={16} fill="currentColor" /> See how it works</a></div>
          <div className="trust-row"><span><Check /> Full design is free</span><span><Check /> 30 days free</span><span><ShieldCheck /> No pressure</span></div>
        </motion.div>
        <motion.div className="hero-visual" initial={{ opacity: 0, scale: .95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .15, duration: .8 }}>
          <img className="hero-person" src="/images/kenyan-seller.jpg" alt="Kenyan small business owner using her phone" fetchPriority="high" decoding="async" />
          <div className="phone-demo" aria-label="Example customer storefront on a phone">
            <div className="phone-top"><span /><small>{featured?.store?.name || 'Your Store'}</small><b /></div>
            <div className="phone-store-hero"><small>NEW COLLECTION</small><strong>Made for your moment.</strong></div>
            <div className="phone-products">{featured?.products?.slice(0, 4).map((product) => <div key={product.id}><img src={product.image_url} alt={product.name} decoding="async" /><span>{product.name}</span><b>{formatMoney(product.price)}</b></div>)}</div>
            <div className="phone-shop-button"><MessageCircle size={14} /> Order via WhatsApp</div>
          </div>
          <div className="hero-float-card"><span className="live-dot" /> <div><strong>New WhatsApp order</strong><small>Customer is ready to buy</small></div></div>
          <div className="hero-imagine-card"><Sparkles /><div><strong>Imagine product zako</strong><small>zikilook this good pamoja.</small></div></div>
        </motion.div>
      </section>

      <section className="logo-strip"><span>Built for biashara ndogo</span><span className="strip-dot" /><span>Made for Kenya</span><span className="strip-dot" /><span>Simple to use</span><span className="strip-dot" /><span>Yours to share</span></section>

      <section className="icp-showcase" aria-labelledby="seller-heading">
        <motion.div className="icp-copy" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .25 }}>
          <span className="eyebrow">Made for Kenya's social sellers</span><h2 id="seller-heading">Uza kila kitu,<br /><em>one beautiful link.</em></h2><p>Whether you sell outfits, perfume, watches, shoes, skincare or home pieces, customers should see everything clearly before they message you.</p>
          <div className="icp-pills"><span>Instagram sellers</span><span>TikTok businesses</span><span>WhatsApp shops</span><span>Physical products</span><span>Kenya-wide delivery</span></div>
        </motion.div>
        <div className="icp-collage">
          <motion.figure className="icp-card one" initial={{ opacity: 0, y: 35, rotate: -2 }} whileInView={{ opacity: 1, y: 0, rotate: -2 }} viewport={{ once: true }}><img src="/images/black-seller-window.jpg" alt="Black woman running sales from her phone" loading="lazy" decoding="async" /><span>Fashion & accessories</span></motion.figure>
          <motion.figure className="icp-card two" initial={{ opacity: 0, x: 30, rotate: 3 }} whileInView={{ opacity: 1, x: 0, rotate: 3 }} transition={{ delay: .12 }} viewport={{ once: true }}><img src="/images/black-social-seller.jpg" alt="Black woman using her phone to run a social media business" loading="lazy" decoding="async" /><span>Social selling</span></motion.figure>
          <motion.figure className="icp-card three" initial={{ opacity: 0, y: 30, rotate: 1 }} whileInView={{ opacity: 1, y: 0, rotate: 1 }} transition={{ delay: .2 }} viewport={{ once: true }}><img src="/images/black-fashion-seller.jpg" alt="Black woman managing customer messages on her phone" loading="lazy" decoding="async" /><span>Built for Kenya</span></motion.figure>
          <div className="icp-proof"><i /><div><b>One link. Every product.</b><small>Ready to share in your next video.</small></div></div>
        </div>
      </section>

      <section id="how" className="marketing-section steps-section">
        <div className="section-heading"><span className="eyebrow">Simple from start to sale</span><h2>Inawork aje?</h2><p>Your video brings customers in. Your store helps them choose. WhatsApp closes the sale.</p></div>
        <div className="steps-grid">
          <article className="step-card step-dark"><span className="step-number">01</span><div className="step-visual"><img src="/images/seller-recording-shop.jpg" alt="Black woman recording a product-selling video on her phone" loading="lazy" decoding="async" /></div><div className="step-copy"><div className="step-icon"><Video /></div><h3>Unatengeneza video</h3><p>Record a simple product video in your shop and mention your store link so customers know where to browse.</p></div></article>
          <article className="step-card"><span className="step-number">02</span><div className="step-visual"><img src="/images/category-products-flatlay.jpg" alt="Fashion, watch and perfume products displayed together" loading="lazy" decoding="async" /></div><div className="step-copy"><div className="step-icon"><StoreIcon /></div><h3>Wanaona products zote</h3><p>They see jerseys, hoodies, polos, perfume and every category together in one beautiful shop.</p></div></article>
          <article className="step-card step-green"><span className="step-number">03</span><div className="step-visual whatsapp-visual"><div className="whatsapp-shot"><div className="whatsapp-shot-head"><MessageCircle /><span>Stevo Jerseys</span><small>online</small></div><div className="whatsapp-shot-body"><div className="whatsapp-bubble">Hey, I am interested in the Stevo Home Jersey, KES 2,800, delivered to Kilimani near Yaya Centre. Could you kindly confirm availability and delivery?<time>11:42 ✓✓</time></div></div></div></div><div className="step-copy"><div className="step-icon"><MessageCircle /></div><h3>Unareceive order WhatsApp</h3><p>You receive a clear order with the product, price, location and customer instructions, then continue the conversation directly.</p></div></article>
        </div>
      </section>

      <section className="marketing-section comments-section" aria-labelledby="comments-heading">
        <div className="section-heading"><span className="eyebrow">Umechoka kureply?</span><h2 id="comments-heading">“Bei gani?” 700 times a day.<br /><em>One link answers them all.</em></h2><p>Price. Size. Colour. Delivery. Your store shows it all per product — the customer taps the link, chooses, and orders on WhatsApp.</p></div>
        <div className="comments-grid">
          <div className="comments-chaos" aria-hidden="true">
            <span className="chaos-tag">WITHOUT STOYANGU</span>
            <div className="chaos-bubble">Bei hii?? 🙏</div>
            <div className="chaos-bubble">Size 38 iko?</div>
            <div className="chaos-bubble">Colours gani ziko</div>
            <div className="chaos-bubble">DM price please</div>
            <div className="chaos-bubble">Deliver unado?</div>
            <div className="chaos-bubble">Nitumie details</div>
            <div className="chaos-count">≈ 700 a day · across TikTok, Instagram &amp; Facebook</div>
          </div>
          <div className="comments-calm">
            <span className="calm-tag">WITH YOUR STORE LINK</span>
            <div className="calm-product"><div><strong>Chelsea Third Jersey</strong><span>KES 1,100 · Sizes S–XXL · 6 colours</span></div></div>
            <div className="calm-product"><div><strong>Home Perfume 100ml</strong><span>KES 900 · In stock</span></div></div>
            <div className="calm-order"><MessageCircle size={14} /> Order via WhatsApp</div>
            <p className="calm-note">Customer saw the product, price, size and colour — no DM needed.</p>
          </div>
        </div>
      </section>

      <section id="get-store" className="get-store-section">
        <div className="get-store-photo"><img src="/images/black-seller-lifestyle.jpg" alt="Black social seller managing her business on a phone" loading="lazy" decoding="async" /><div className="photo-quote"><strong>“Sasa customers wangu wanaona kila kitu one place.”</strong><span>Built to make selling feel easy</span></div></div>
        <div className="get-store-copy"><span className="eyebrow light">Video Yangu, StoYangu</span><h2>Napata StoYangu aje?</h2><p className="section-lead">Get your whole store for totally free.</p>
          <ol className="number-list"><li><img src="/images/apply-phone.jpg" alt="Black business owner applying on her phone" /><b>1</b><div><strong>Apply for a store</strong><p>Finya “Apply.” Add your name and phone number, and you are done.</p></div></li><li><img src="/images/store-build-preview.jpg" alt="Products arranged into a polished online storefront" /><b>2</b><div><strong>Tutabuild store yako</strong><p>We build your complete store with your real products, then send it to you to review.</p></div></li><li><img src="/images/testimonial-recording.jpg" alt="Black woman recording a short testimonial video" /><b>3</b><div><strong>Record a 1-minute video</strong><p>If you like it, say your name and that you received your store from stoyangu.com. Your store then goes live.</p></div></li></ol>
          <button className="button-cream" onClick={() => setApplyOpen(true)}>Start my free store <ArrowRight /></button>
        </div>
      </section>

      <section id="pricing" className="marketing-section pricing-section"><div className="pricing-intro"><span className="eyebrow">Clear, honest pricing</span><h2>Ni how much?</h2><p>Clear pricing, kind support and the freedom to choose what works for your business.</p></div><div className="price-card"><div className="price-card-head"><span>YOUR FIRST 30 DAYS</span><strong>FREE</strong></div><div className="price-card-body"><p><Check /> Full store design and build — <b>worth KES 15,000</b> — totally waived. Lipa na a short 1-minute video about your business.</p><p><Check /> First 30 days live, totally free</p><p><Check /> Then <b>KES 999/month</b> — hosting & maintenance of your store, support included</p><p><Check /> If it is not the right fit, you can pause anytime. We will always make the process simple and respectful.</p><button className="button-primary" onClick={() => setApplyOpen(true)}>Apply now <ArrowRight /></button></div></div></section>

      <section className="final-cta"><div><span className="eyebrow light">Your next sale can start here</span><h2>Biashara yako.<br />Store yako.</h2></div><button className="button-cream" onClick={() => setApplyOpen(true)}>Nipee store yangu <ArrowRight /></button></section>
    </main>
    <footer className="marketing-footer"><BrandLogo /><p>We help small sellers put every product in one beautiful place.</p><div><a href="mailto:info@stoyangu.com"><Mail /> info@stoyangu.com</a><a href="https://wa.me/254793533683"><MessageCircle /> 0793533683</a></div><small>© {new Date().getFullYear()} StoYangu. My Store, My Hope.</small></footer>
    {applyOpen && <Modal title="Apply for a free store" onClose={() => setApplyOpen(false)}><form className="form-stack" onSubmit={submit}><p className="form-intro">Add your name and phone number. Tutakupigia, that is all.</p><label>Your name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Amina Hassan" autoFocus /></label><label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+254 7..." /></label>{message && <div className={message.startsWith('Asante') ? 'form-success' : 'form-error'}>{message}</div>}<button className="button-primary full" disabled={sending}>{sending ? 'Sending…' : 'Send my application'} <ArrowRight /></button></form></Modal>}
  </div>;
}
