import { useEffect, useRef } from 'react';
import { FlaskConical, X } from 'lucide-react';
import type { Subscription } from '../types.js';
import { StatusBadge } from './StatusBadge.js';

type DemoPortalDialogProps = {
  subscriptions: Subscription[];
  busyId: string | null;
  onCancel: (subscriptionId: string) => void;
  onClose: () => void;
};

export function DemoPortalDialog({ subscriptions, busyId, onCancel, onClose }: DemoPortalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="demo-portal-heading" onCancel={onClose}>
      <div className="dialog-header">
        <h2 id="demo-portal-heading"><FlaskConical size={20} aria-hidden="true" />Demo billing portal</h2>
        <button type="button" className="icon-button" aria-label="Close demo billing portal" onClick={onClose}><X size={18} /></button>
      </div>
      <p>In Stripe mode this opens the hosted Customer Portal. In demo mode you can cancel a simulated subscription below.</p>
      {subscriptions.length === 0 ? <p className="empty-state">No subscriptions to manage.</p> : (
        <ul className="demo-portal-list">
          {subscriptions.map((subscription) => (
            <li key={subscription.id}>
              <div><strong>{subscription.planName}</strong><StatusBadge status={subscription.status} /></div>
              <button type="button" className="button button-secondary" disabled={busyId === subscription.id || subscription.status === 'canceled'} onClick={() => onCancel(subscription.id)}>
                {busyId === subscription.id ? 'Canceling…' : 'Cancel subscription'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions"><button type="button" className="button button-primary" onClick={onClose}>Done</button></div>
    </dialog>
  );
}