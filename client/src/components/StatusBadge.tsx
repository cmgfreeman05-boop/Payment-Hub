import type { OrderStatus, SubscriptionStatus } from '../types.js';

const labels: Record<OrderStatus | SubscriptionStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  expired: 'Expired',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  active: 'Active',
  trialing: 'Trialing',
  past_due: 'Past due',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
  incomplete_expired: 'Incomplete expired',
  unpaid: 'Unpaid',
  paused: 'Paused',
};

const success = new Set(['paid', 'active', 'trialing']);
const warning = new Set(['pending', 'past_due', 'incomplete', 'unpaid', 'paused', 'partially_refunded']);

export function StatusBadge({ status }: { status: OrderStatus | SubscriptionStatus }) {
  const tone = success.has(status) ? 'success' : warning.has(status) ? 'warning' : 'neutral';
  return <span className={`status-badge status-${tone}`}>{labels[status]}</span>;
}