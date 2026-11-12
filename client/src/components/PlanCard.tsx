import { Check, CreditCard, LoaderCircle } from 'lucide-react';
import type { Plan } from '../types.js';
import { formatMoney } from '../lib/format.js';

type PlanCardProps = {
  plan: Plan;
  busy: boolean;
  demo: boolean;
  onCheckout: (planId: string) => void;
};

export function PlanCard({ plan, busy, demo, onCheckout }: PlanCardProps) {
  const highlighted = plan.id === 'pro-monthly';
  return (
    <article className={`plan-card${highlighted ? ' plan-highlighted' : ''}`} aria-labelledby={`plan-${plan.id}`}>
      {highlighted && <span className="plan-ribbon">Most popular</span>}
      <h3 id={`plan-${plan.id}`}>{plan.name}</h3>
      <p className="plan-description">{plan.description}</p>
      <p className="plan-price">
        <span>{formatMoney(plan.amountCents, plan.currency)}</span>
        {plan.interval && <small>/{plan.interval}</small>}
      </p>
      <ul className="plan-features">
        {plan.features.map((feature) => (
          <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>
        ))}
      </ul>
      <button type="button" className="button button-primary plan-button" disabled={busy} onClick={() => onCheckout(plan.id)}>
        {busy ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <CreditCard size={18} aria-hidden="true" />}
        {busy ? 'Redirecting…' : plan.kind === 'subscription' ? 'Subscribe' : 'Buy now'}
      </button>
      <p className="plan-note">{demo ? 'Demo checkout — no real charge.' : 'Secure hosted checkout by Stripe.'}</p>
    </article>
  );
}