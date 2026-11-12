import { ExternalLink, ReceiptText, RefreshCw, Repeat } from 'lucide-react';
import type { Order, Subscription } from '../types.js';
import { formatDate, formatDateTime, formatMoney } from '../lib/format.js';
import { StatusBadge } from '../components/StatusBadge.js';

type BillingPageProps = {
  orders: Order[];
  subscriptions: Subscription[];
  portalBusy: boolean;
  onPortal: () => void;
  onRefresh: () => void;
};

export function BillingPage({ orders, subscriptions, portalBusy, onPortal, onRefresh }: BillingPageProps) {
  const paidTotal = orders.filter((order) => order.status === 'paid').reduce((sum, order) => sum + order.amountCents, 0);
  const currency = orders[0]?.currency ?? 'usd';
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === 'active' || subscription.status === 'trialing').length;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Billing</h1>
          <p className="muted">Payment history and subscription state are synchronized from verified provider events.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="button button-secondary" onClick={onRefresh}><RefreshCw size={16} aria-hidden="true" />Refresh</button>
          <button type="button" className="button button-primary" onClick={onPortal} disabled={portalBusy}><ExternalLink size={16} aria-hidden="true" />Manage billing</button>
        </div>
      </header>
      <section className="stats-grid" aria-label="Billing summary">
        <article className="stat-card"><ReceiptText size={20} aria-hidden="true" /><p>Confirmed payments</p><strong>{formatMoney(paidTotal, currency)}</strong></article>
        <article className="stat-card"><Repeat size={20} aria-hidden="true" /><p>Active subscriptions</p><strong>{activeSubscriptions}</strong></article>
        <article className="stat-card"><ReceiptText size={20} aria-hidden="true" /><p>Orders</p><strong>{orders.length}</strong></article>
      </section>
      <section aria-labelledby="subscriptions-heading">
        <h2 id="subscriptions-heading">Subscriptions</h2>
        {subscriptions.length === 0 ? (
          <p className="empty-state">No subscriptions yet. Choose a plan to start recurring billing.</p>
        ) : (
          <div className="subscription-list">
            {subscriptions.map((subscription) => (
              <article key={subscription.id} className="subscription-card">
                <div>
                  <h3>{subscription.planName}</h3>
                  <p className="muted">{formatMoney(subscription.amountCents, subscription.currency)}{subscription.interval ? ` / ${subscription.interval}` : ''}</p>
                </div>
                <div className="subscription-meta">
                  <StatusBadge status={subscription.status} />
                  <p>{subscription.cancelAtPeriodEnd ? 'Cancels at period end' : `Renews ${formatDate(subscription.currentPeriodEnd)}`}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="orders-heading">
        <h2 id="orders-heading">Payment history</h2>
        {orders.length === 0 ? (
          <p className="empty-state">No orders yet. Completed checkouts will appear here after webhook confirmation.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead><tr><th scope="col">Plan</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.planName}</td>
                    <td>{formatMoney(order.amountCents, order.currency)}</td>
                    <td><StatusBadge status={order.status} /></td>
                    <td>{formatDateTime(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}