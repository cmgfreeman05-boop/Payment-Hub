import { useEffect, useRef } from 'react';
import { FlaskConical, LoaderCircle, X } from 'lucide-react';
import type { Order } from '../types.js';
import { formatMoney } from '../lib/format.js';

type DemoCheckoutDialogProps = {
  order: Order | null;
  busy: boolean;
  onComplete: () => void;
  onClose: () => void;
};

export function DemoCheckoutDialog({ order, busy, onComplete, onClose }: DemoCheckoutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="demo-checkout-heading" onCancel={onClose}>
      <div className="dialog-header">
        <h2 id="demo-checkout-heading"><FlaskConical size={20} aria-hidden="true" />Demo checkout</h2>
        <button type="button" className="icon-button" aria-label="Close demo checkout" onClick={onClose}><X size={18} /></button>
      </div>
      <p>This simulator completes the same webhook-driven fulfillment path used by Stripe. No card details are collected and no real charge occurs.</p>
      {order && <p className="dialog-summary"><strong>{order.planName}</strong><span>{formatMoney(order.amountCents, order.currency)}</span></p>}
      <div className="dialog-actions">
        <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="button button-primary" onClick={onComplete} disabled={busy} autoFocus>
          {busy && <LoaderCircle size={18} className="spin" aria-hidden="true" />}Complete demo payment
        </button>
      </div>
    </dialog>
  );
}