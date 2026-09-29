import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Edit3, Trash2, Video, X } from 'lucide-react';
import type { Product } from '../types';
import { formatMoney } from '../lib/api';
import { pushBackHandler } from '../lib/backNavigation';

type Props = {
  product: Product;
  locked?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export default function ProductDetailsModal({ product, locked = false, onClose, onEdit, onDelete }: Props) {
  const photos = (product.images?.length ? product.images : [product.image_url].filter(Boolean)) as string[];
  const [activePhoto, setActivePhoto] = useState<string>(photos[0] || '/stoyangu-logo.png');

  // Push back handler for phone back controls
  useEffect(() => {
    return pushBackHandler(() => {
      onClose();
      return true;
    });
  }, [onClose]);

  // Pre-decode photos for instant viewing
  useEffect(() => {
    photos.forEach((url) => {
      const img = new Image();
      img.src = url;
      img.decode?.().catch(() => undefined);
    });
  }, [photos]);

  const activeIndex = photos.indexOf(activePhoto);
  const prevPhoto = () => {
    if (photos.length <= 1) return;
    const nextIdx = (activeIndex - 1 + photos.length) % photos.length;
    setActivePhoto(photos[nextIdx]);
  };
  const nextPhoto = () => {
    if (photos.length <= 1) return;
    const nextIdx = (activeIndex + 1) % photos.length;
    setActivePhoto(photos[nextIdx]);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card product-details-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${product.name} details`}
      >
        <div className="product-details-header">
          <div className="product-details-title-wrap">
            <span className="eyebrow">Product Details</span>
            <h2>{product.name}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close product details">
            <X size={20} />
          </button>
        </div>

        <div className="product-details-body">
          {/* Main Photo Gallery */}
          <div className="product-details-gallery">
            <div className="product-details-main-image-wrap">
              <img
                src={activePhoto}
                alt={product.name}
                className="product-details-main-image"
                loading="eager"
              />
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    className="gallery-nav-btn prev"
                    onClick={prevPhoto}
                    aria-label="Previous photo"
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <button
                    type="button"
                    className="gallery-nav-btn next"
                    onClick={nextPhoto}
                    aria-label="Next photo"
                  >
                    <ChevronRight size={22} />
                  </button>
                  <span className="gallery-counter">
                    {Math.max(1, activeIndex + 1)} / {photos.length}
                  </span>
                </>
              )}
            </div>

            {/* Thumbnail Strip */}
            {photos.length > 1 && (
              <div className="product-details-thumbnails" role="tablist" aria-label="Photo thumbnails">
                {photos.map((url, i) => (
                  <button
                    type="button"
                    key={url + i}
                    className={`thumb-btn ${url === activePhoto ? 'active' : ''}`}
                    onClick={() => setActivePhoto(url)}
                    aria-label={`View photo ${i + 1}`}
                  >
                    <img src={url} alt={`${product.name} thumbnail ${i + 1}`} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product Video if present */}
          {product.video_url && (
            <div className="product-details-video-box">
              <div className="video-box-header">
                <strong><Video size={16} /> Product Video</strong>
              </div>
              <video
                src={product.video_url}
                poster={product.image_url}
                controls
                playsInline
                preload="metadata"
                className="product-details-video-player"
              />
            </div>
          )}

          {/* Product Information */}
          <div className="product-details-info">
            <div className="product-details-price-row">
              <span className="price-tag">{formatMoney(product.price)}</span>
            </div>

            <div className="product-details-stats">
              <div className="stat-chip">
                <span>Total views</span>
                <strong>{product.views_total.toLocaleString()}</strong>
                <small>+{product.views_today} today</small>
              </div>
              <div className="stat-chip">
                <span>Total orders</span>
                <strong>{product.orders_total.toLocaleString()}</strong>
                <small>+{product.orders_today} today</small>
              </div>
            </div>

            {product.colors && product.colors.length > 0 && (
              <div className="product-details-variants">
                <span className="variant-label">Colours available</span>
                <div className="variant-chips">
                  {product.colors.map((c) => (
                    <span key={c} className="variant-badge color-badge">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {product.sizes && product.sizes.length > 0 && (
              <div className="product-details-variants">
                <span className="variant-label">Sizes available</span>
                <div className="variant-chips">
                  {product.sizes.map((s) => (
                    <span key={s} className="variant-badge">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions product-details-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onEdit}
            disabled={locked}
          >
            <Edit3 size={16} /> Edit product
          </button>
          <button
            type="button"
            className="danger secondary-button"
            onClick={onDelete}
            disabled={locked}
          >
            <Trash2 size={16} /> Delete
          </button>
          <button type="button" className="button-primary compact" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
