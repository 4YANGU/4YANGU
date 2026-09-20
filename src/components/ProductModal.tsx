import Modal from './Modal';
import ProductForm from './ProductForm';
import type { Product } from '../types';

// Shared add/edit product form in a dialog. Used by the manage-store products
// shelf (Edit). The post composer embeds ProductForm directly instead.
export default function ProductModal({ product, storeId, onClose, onSaved }: { product: Product | null; storeId: number; onClose: () => void; onSaved: () => void }) {
  return <Modal title={product ? 'Edit product' : 'Add a product'} onClose={onClose} wide><ProductForm product={product} storeId={storeId} onCancel={onClose} cancelLabel="Cancel" onSaved={() => onSaved()} /></Modal>;
}
