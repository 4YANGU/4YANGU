import { useMemo } from 'react';
import StorefrontRenderer from './StorefrontRenderer';
import type { Product, Store } from '../types';
import '../html-storefront.css';

type Props = {
  store: Store;
  products: Product[];
  onOrder: (product: Product, color?: string, size?: string, fulfilment?: string, note?: string) => void;
  onView: (id: number) => void;
};

function readStoredHtml(store: Store) {
  const design = store.design_json || {};
  return String(design.storefront_html || '').trim();
}

export default function HtmlStorefront({ store, products, onOrder, onView }: Props) {
  const stored = useMemo(() => readStoredHtml(store), [store]);

  if (!stored) {
    return <StorefrontRenderer store={store} products={products} onOrder={onOrder} onView={onView} />;
  }

  const src = `/api/storefront?action=render&slug=${encodeURIComponent(store.slug)}&format=raw&fresh=1`;

  return (
    <div className="html-storefront-frame-wrap">
      <iframe
        className="html-storefront-frame"
        title={`${store.name} storefront`}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-top-navigation-by-user-activation"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
