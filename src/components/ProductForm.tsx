// Woyoyo-004: the shared add/edit product form as an embeddable component.
// ProductModal keeps wrapping it in a dialog (shelf Edit); the post composer
// embeds it directly so sellers add products inside the posting flow.

import { Camera, Check, Image, Plus, X } from 'lucide-react';
import { FormEvent, useRef, useState } from 'react';
import { apiFetch, uploadImage } from '../lib/api';
import type { Product } from '../types';

const colorPresets = ['Black', 'White', 'Navy', 'Green', 'Red', 'Blue', 'Pink', 'Brown', 'Beige', 'Gold'];
const sizePresets = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42'];

export function OptionPicker({ label, enabled, setEnabled, items, selected, onToggle, custom, setCustom, onAdd }: { label: string; enabled: boolean; setEnabled: (value: boolean) => void; items: string[]; selected: string[]; onToggle: (item: string) => void; custom: string; setCustom: (value: string) => void; onAdd: () => void }) { return <fieldset className="option-picker"><label className="toggle-label"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><Check /></span><strong>{label}</strong></label>{enabled && <div className="option-expand"><div className="option-chips">{items.map((item) => <button type="button" className={selected.includes(item) ? 'selected' : ''} key={item} onClick={() => onToggle(item)}>{selected.includes(item) && <Check />} {item}</button>)}{selected.filter((item) => !items.includes(item)).map((item) => <button type="button" className="selected" key={item} onClick={() => onToggle(item)}><Check /> {item}</button>)}</div><div className="custom-option"><input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={`Add custom ${label.toLowerCase().includes('color') ? 'colour' : 'size'}`} /><button type="button" onClick={onAdd}><Plus /> Add</button></div></div>}</fieldset>; }

type Props = {
  product?: Product | null;
  storeId: number;
  busy?: boolean;
  error?: string;
  submitLabel?: string;
  cancelLabel?: string;
  onBusyChange?: (busy: boolean) => void;
  onError?: (message: string) => void;
  onCancel?: () => void;
  onSaved?: (savedId?: number) => void;
};

export default function ProductForm({ product = null, storeId, busy: busyProp, error: errorProp, submitLabel, cancelLabel, onBusyChange, onError, onCancel, onSaved }: Props) {
  const [name, setName] = useState(product?.name || '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [hasColors, setHasColors] = useState(Boolean(product?.colors?.length)); const [colors, setColors] = useState<string[]>(product?.colors || []); const [customColor, setCustomColor] = useState('');
  const [hasSizes, setHasSizes] = useState(Boolean(product?.sizes?.length)); const [sizes, setSizes] = useState<string[]>(product?.sizes || []); const [customSize, setCustomSize] = useState('');
  const initialPhotos = (product?.images?.length ? product.images : [product?.image_url].filter(Boolean)) as string[];
  const [photos, setPhotos] = useState<Array<{ id: string; url: string; file?: File }>>(initialPhotos.map((url, index) => ({ id: `saved-${index}`, url })));
  const [busyLocal, setBusyLocal] = useState(false); const [errorLocal, setErrorLocal] = useState('');
  const busy = busyProp ?? busyLocal;
  const error = errorProp ?? errorLocal;
  const setBusy = (value: boolean) => { setBusyLocal(value); onBusyChange?.(value); };
  const setError = (message: string) => { setErrorLocal(message); onError?.(message); };
  const galleryRef = useRef<HTMLInputElement>(null); const cameraRef = useRef<HTMLInputElement>(null);
  const choose = (files?: FileList | null) => {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (!selected.length) return;
    setPhotos((current) => {
      const room = Math.max(0, 7 - current.length);
      if (selected.length > room) setError('A product can have a maximum of 7 photos.');
      return [...current, ...selected.slice(0, room).map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, url: URL.createObjectURL(file), file }))];
    });
  };
  const removePhoto = (id: string) => setPhotos((current) => current.filter((photo) => photo.id !== id));
  const toggle = (item: string, list: string[], setter: (value: string[]) => void) => setter(list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  const addCustom = (type: 'color' | 'size') => { const value = (type === 'color' ? customColor : customSize).trim(); if (!value) return; if (type === 'color') { setColors(Array.from(new Set([...colors, value]))); setCustomColor(''); } else { setSizes(Array.from(new Set([...sizes, value]))); setCustomSize(''); } };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (name.trim().length < 2) return setError('Add a product name.');
    if (!Number(price) || Number(price) < 1) return setError('Add a valid product price.');
    if (!photos.length) return setError('Add at least one product photo from gallery or camera.');
    if (photos.length > 7) return setError('A product can have a maximum of 7 photos.');
    setBusy(true);
    try {
      const images = await Promise.all(photos.map(async (photo) => photo.file ? (await uploadImage(photo.file, 'products')).url : photo.url));
      const body = { id: product?.id, store_id: storeId, name: name.trim(), price: Number(price), colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], image_url: images[0], images };
      const saved = await apiFetch<Product>('/api/products', { method: product ? 'PUT' : 'POST', body: JSON.stringify(body) });
      onSaved?.(saved?.id ?? product?.id);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save product.'); } finally { setBusy(false); }
  };
  return <form className="product-form product-form-embedded" onSubmit={submit}><div className="photo-manager"><div className="photo-manager-head"><div><strong>Product photos</strong><p>Add up to 7. JPG, PNG, WebP, GIF, HEIC and AVIF are supported.</p></div><span>{photos.length} / 7</span></div><div className="photo-grid">{photos.map((photo, index) => <div className={`photo-tile ${index === 0 ? 'cover' : ''}`} key={photo.id}><img src={photo.url} alt={`Product photo ${index + 1}`} />{index === 0 && <small>Cover</small>}<button type="button" onClick={() => removePhoto(photo.id)} aria-label={`Remove photo ${index + 1}`}><X /></button></div>)}{photos.length < 7 && <button type="button" className="photo-add-tile" onClick={() => galleryRef.current?.click()}><Image /><span>Add photos</span></button>}</div><div className="photo-source-actions"><button type="button" className="secondary-button" onClick={() => galleryRef.current?.click()}><Image /> Choose from gallery</button><button type="button" className="secondary-button" onClick={() => cameraRef.current?.click()}><Camera /> Take a photo</button></div><input ref={galleryRef} hidden multiple type="file" accept="image/*,.avif,.heic,.heif" onChange={(event) => { choose(event.target.files); event.target.value = ''; }} /><input ref={cameraRef} hidden type="file" accept="image/*,.avif,.heic,.heif" capture="environment" onChange={(event) => { choose(event.target.files); event.target.value = ''; }} /></div><div className="form-grid"><label>Product name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Price (KES)<input type="number" min="1" value={price} onChange={(event) => setPrice(event.target.value)} /></label></div><OptionPicker label="Colors available" enabled={hasColors} setEnabled={setHasColors} items={colorPresets} selected={colors} onToggle={(item) => toggle(item, colors, setColors)} custom={customColor} setCustom={setCustomColor} onAdd={() => addCustom('color')} /><OptionPicker label="Sizes available" enabled={hasSizes} setEnabled={setHasSizes} items={sizePresets} selected={sizes} onToggle={(item) => toggle(item, sizes, setSizes)} custom={customSize} setCustom={setCustomSize} onAdd={() => addCustom('size')} />{error && onError === undefined && <div className="form-error">{error}</div>}<div className="modal-actions">{onCancel && <button type="button" className="secondary-button" onClick={onCancel}>{cancelLabel || 'Cancel'}</button>}<button className="button-primary" disabled={busy}>{busy ? `Uploading ${photos.length} photo${photos.length === 1 ? '' : 's'}…` : (submitLabel || 'Save product')} <Check /></button></div></form>;
}
