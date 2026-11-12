import { useCallback, useEffect, useState } from 'react';
import { CreditCard, LayoutDashboard, LogOut, ShieldCheck, X } from 'lucide-react';
import { api, ApiError } from './lib/api.js';
import type { AppConfig, AuthResponse, CheckoutResponse, Order, Plan, Subscription } from './types.js';
import { AuthPanel } from './components/AuthPanel.js';
import { DemoCheckoutDialog } from './components/DemoCheckoutDialog.js';
import { DemoPortalDialog } from './components/DemoPortalDialog.js';
import { PricingPage } from './pages/PricingPage.js';
import { BillingPage } from './pages/BillingPage.js';

type Notice = { kind: 'success' | 'error' | 'info'; message: string };

function upsertOrder(current: Order[], order: Order): Order[] {
  return current.some((candidate) => candidate.id === order.id)
    ? current.map((candidate) => (candidate.id === order.id ? order : candidate))
    : [order, ...current];
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [view, setView] = useState<'pricing' | 'billing'>('pricing');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [demoCheckoutId, setDemoCheckoutId] = useState<string | null>(null);
  const [demoPortalOpen, setDemoPortalOpen] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoCancelBusy, setDemoCancelBusy] = useState<string | null>(null);
  const [returnOrderId, setReturnOrderId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const orderId = params.get('order');
    if (checkout && orderId) {
      setView('billing');
      setReturnOrderId(orderId);
      setNotice(checkout === 'success'
        ? { kind: 'info', message: 'Checkout returned. Waiting for verified payment confirmation…' }
        : { kind: 'info', message: 'Checkout was canceled. No payment was confirmed.' });
    }
    const demoCheckout = params.get('demo_checkout');
    if (demoCheckout) setDemoCheckoutId(demoCheckout);
    if (params.get('demo_portal')) setDemoPortalOpen(true);
    if (params.get('billing')) setView('billing');
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const refreshBilling = useCallback(async () => {
    const [orderResponse, subscriptionResponse] = await Promise.all([
      api<{ orders: Order[] }>('/api/orders'),
      api<{ subscriptions: Subscription[] }>('/api/subscriptions'),
    ]);
    setOrders(orderResponse.orders);
    setSubscriptions(subscriptionResponse.subscriptions);
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const session = await api<AuthResponse>('/api/auth/me');
      setAuth(session);
      await refreshBilling();
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 401) {
        setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to load your session.' });
      }
      setAuth(null);
    } finally {
      setAuthLoading(false);
    }
  }, [refreshBilling]);

  useEffect(() => {
    api<AppConfig>('/api/config').then(setConfig).catch(() => setConfig({ gateway: 'stripe', stripeConfigured: false }));
    api<{ plans: Plan[] }>('/api/plans').then((response) => setPlans(response.plans)).catch((cause: unknown) => {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to load plans.' });
    });
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);

  useEffect(() => {
    if (!auth || !returnOrderId) return;
    let active = true;
    async function poll() {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const response = await api<{ order: Order }>(`/api/orders/${returnOrderId}`);
          if (!active) return;
          setOrders((current) => upsertOrder(current, response.order));
          if (response.order.status === 'paid') {
            setNotice({ kind: 'success', message: 'Payment confirmed by webhook. Your purchase is recorded.' });
            setReturnOrderId(null);
            await refreshBilling();
            return;
          }
          if (response.order.status === 'failed' || response.order.status === 'expired') {
            setNotice({ kind: 'error', message: `Checkout ${response.order.status}. Start a new checkout to try again.` });
            setReturnOrderId(null);
            return;
          }
        } catch {
          if (active) setNotice({ kind: 'error', message: 'Unable to confirm payment status. Refresh billing shortly.' });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (active) setNotice({ kind: 'info', message: 'Payment is still pending. Provider confirmation can take a moment; refresh billing to check again.' });
    }
    void poll();
    return () => { active = false; };
  }, [auth, returnOrderId, refreshBilling]);

  useEffect(() => {
    if (!auth || !demoCheckoutId) return;
    api<{ order: Order }>(`/api/orders/${demoCheckoutId}`)
      .then((response) => setOrders((current) => upsertOrder(current, response.order)))
      .catch(() => undefined);
  }, [auth, demoCheckoutId]);

  async function handleAuthenticate(email: string, password: string, mode: 'login' | 'register') {
    const session = await api<AuthResponse>(`/api/auth/${mode}`, { method: 'POST', body: { email, password } });
    setAuth(session);
    setNotice({ kind: 'success', message: mode === 'register' ? 'Account created. You are signed in.' : 'Signed in.' });
    await refreshBilling();
  }

  async function handleLogout() {
    if (!auth) return;
    try {
      await api<void>('/api/auth/logout', { method: 'POST', csrfToken: auth.csrfToken });
      setAuth(null);
      setOrders([]);
      setSubscriptions([]);
      setView('pricing');
      setNotice({ kind: 'info', message: 'Signed out.' });
    } catch (cause) {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to sign out.' });
    }
  }

  async function handleCheckout(planId: string) {
    if (!auth) {
      setNotice({ kind: 'error', message: 'Sign in before starting checkout.' });
      return;
    }
    setBusyPlan(planId);
    try {
      const result = await api<CheckoutResponse>('/api/checkout/sessions', {
        method: 'POST',
        body: { planId },
        csrfToken: auth.csrfToken,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setView('billing');
      setNotice({ kind: 'info', message: 'This checkout was already processed. Review billing for the latest status.' });
      await refreshBilling();
    } catch (cause) {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to start checkout.' });
    } finally {
      setBusyPlan(null);
    }
  }

  async function handlePortal() {
    if (!auth) return;
    setPortalBusy(true);
    try {
      const result = await api<{ url: string }>('/api/billing/portal', { method: 'POST', csrfToken: auth.csrfToken });
      window.location.assign(result.url);
    } catch (cause) {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to open the billing portal.' });
    } finally {
      setPortalBusy(false);
    }
  }

  async function handleDemoComplete() {
    if (!auth || !demoCheckoutId) return;
    setDemoBusy(true);
    try {
      await api<{ order: Order }>(`/api/demo/checkout/${demoCheckoutId}/complete`, { method: 'POST', csrfToken: auth.csrfToken });
      setDemoCheckoutId(null);
      setView('billing');
      setNotice({ kind: 'success', message: 'Demo payment confirmed through the webhook processing path. No real charge occurred.' });
      await refreshBilling();
    } catch (cause) {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to complete the demo payment.' });
    } finally {
      setDemoBusy(false);
    }
  }

  async function handleDemoCancel(subscriptionId: string) {
    if (!auth) return;
    setDemoCancelBusy(subscriptionId);
    try {
      await api<{ canceled: boolean }>(`/api/demo/subscriptions/${subscriptionId}/cancel`, { method: 'POST', csrfToken: auth.csrfToken });
      setNotice({ kind: 'success', message: 'Demo subscription canceled.' });
      await refreshBilling();
    } catch (cause) {
      setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to cancel the demo subscription.' });
    } finally {
      setDemoCancelBusy(null);
    }
  }

  if (authLoading) return <div className="loading-screen" role="status">Loading Payment Hub…</div>;
  if (!auth) return <AuthPanel gateway={config?.gateway ?? 'stripe'} onAuthenticate={handleAuthenticate} />;

  const demo = config?.gateway === 'demo';
  const demoOrder = orders.find((order) => order.id === demoCheckoutId) ?? null;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={24} aria-hidden="true" /><span>Payment Hub</span></div>
        <nav aria-label="Primary">
          <button type="button" className="nav-button" aria-current={view === 'pricing' ? 'page' : undefined} onClick={() => setView('pricing')}><CreditCard size={18} aria-hidden="true" />Checkout</button>
          <button type="button" className="nav-button" aria-current={view === 'billing' ? 'page' : undefined} onClick={() => setView('billing')}><LayoutDashboard size={18} aria-hidden="true" />Billing</button>
        </nav>
        <div className="sidebar-footer">
          <span className={`gateway-badge${demo ? ' gateway-demo' : ''}`}>{demo ? 'Demo mode' : 'Stripe hosted'}</span>
          <p>Card details stay with Stripe. Fulfillment is webhook-confirmed.</p>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div><p className="muted">Signed in as</p><strong>{auth.user.email}</strong></div>
          <button type="button" className="button button-secondary" onClick={() => void handleLogout()}><LogOut size={16} aria-hidden="true" />Sign out</button>
        </header>
        {notice && (
          <div className={`notice notice-${notice.kind}`} role="status">
            <span>{notice.message}</span>
            <button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={16} /></button>
          </div>
        )}
        <main>
          {view === 'pricing' ? (
            <PricingPage plans={plans} busyPlan={busyPlan} demo={demo} onCheckout={(planId) => void handleCheckout(planId)} />
          ) : (
            <BillingPage orders={orders} subscriptions={subscriptions} portalBusy={portalBusy} onPortal={() => void handlePortal()} onRefresh={() => void refreshBilling().catch((cause: unknown) => setNotice({ kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to refresh billing.' }))} />
          )}
        </main>
      </div>
      {demoCheckoutId && <DemoCheckoutDialog order={demoOrder} busy={demoBusy} onComplete={() => void handleDemoComplete()} onClose={() => setDemoCheckoutId(null)} />}
      {demoPortalOpen && <DemoPortalDialog subscriptions={subscriptions} busyId={demoCancelBusy} onCancel={(id) => void handleDemoCancel(id)} onClose={() => setDemoPortalOpen(false)} />}
    </div>
  );
}