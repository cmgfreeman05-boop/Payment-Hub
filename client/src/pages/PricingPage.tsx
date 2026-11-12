import { ShieldCheck } from 'lucide-react';
import type { Plan } from '../types.js';
import { PlanCard } from '../components/PlanCard.js';

type PricingPageProps = {
  plans: Plan[];
  busyPlan: string | null;
  demo: boolean;
  onCheckout: (planId: string) => void;
};

export function PricingPage({ plans, busyPlan, demo, onCheckout }: PricingPageProps) {
  const oneTime = plans.filter((plan) => plan.kind === 'one_time');
  const recurring = plans.filter((plan) => plan.kind === 'subscription');
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Checkout</h1>
          <p className="muted">Server-controlled pricing. Card details stay with Stripe, and purchases are confirmed by webhook.</p>
        </div>
        <span className="security-chip"><ShieldCheck size={16} aria-hidden="true" />PCI SAQ-A hosted flow</span>
      </header>
      {demo && <p className="demo-banner">Demo mode is active. Checkout is simulated and no real charges occur.</p>}
      <section aria-labelledby="one-time-heading">
        <h2 id="one-time-heading">One-time purchases</h2>
        <div className="plan-grid">
          {oneTime.map((plan) => <PlanCard key={plan.id} plan={plan} busy={busyPlan === plan.id} demo={demo} onCheckout={onCheckout} />)}
        </div>
      </section>
      <section aria-labelledby="subscription-heading">
        <h2 id="subscription-heading">Subscriptions</h2>
        <div className="plan-grid">
          {recurring.map((plan) => <PlanCard key={plan.id} plan={plan} busy={busyPlan === plan.id} demo={demo} onCheckout={onCheckout} />)}
        </div>
      </section>
      {plans.length === 0 && <p className="empty-state">Loading plans…</p>}
    </div>
  );
}