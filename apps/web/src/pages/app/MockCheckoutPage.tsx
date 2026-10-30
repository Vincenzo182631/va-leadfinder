import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { SubscriptionResponse } from '@vlf/shared';
import { Alert, Button, Card, PageHeader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

/** Development-only page for the mock billing adapter. No money moves. */
export function MockCheckoutPage() {
  const [params] = useSearchParams();
  const subscriptionId = params.get('subscription') ?? '';
  const nav = useNavigate();
  const qc = useQueryClient();
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => api<SubscriptionResponse>('/api/subscription'), refetchInterval: 2000 });
  const sim = useMutation({
    mutationFn: (event: string) => api<{ delivered: number; outcome: { outcome: string } }>('/api/dev/billing/simulate', { method: 'POST', body: { subscriptionId, event } }),
    onSuccess: () => { qc.invalidateQueries(); },
  });
  if (sub.data && sub.data.billing.mode !== 'mock') return <Alert tone="error">Mock checkout is only available in development mock billing mode.</Alert>;
  return (
    <>
      <PageHeader title="Test checkout (simulated)" description="Development mock of the PayMongo payment step. No real charge is made." />
      <Card className="max-w-xl space-y-4">
        <Alert tone="warn" title="Simulation only">
          Your plan changes only after the server receives a <strong>signed webhook</strong>, exactly as with PayMongo — not because you visited this page.
        </Alert>
        <p className="text-sm">Subscription status: <strong>{sub.data?.subscription?.status ?? '…'}</strong> · Plan in effect: <strong>{sub.data?.planCode ?? '…'}</strong></p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => sim.mutate('subscription.invoice.paid')} loading={sim.isPending}>Simulate successful payment</Button>
          <Button variant="danger" onClick={() => sim.mutate('subscription.invoice.payment_failed')}>Simulate failed payment</Button>
        </div>
        {sim.data && <p className="text-sm text-muted" aria-live="polite">Webhook delivered (HTTP {sim.data.delivered}) · outcome: {sim.data.outcome.outcome}</p>}
        {sim.isError && <Alert tone="error">{errorMessage(sim.error)}</Alert>}
        <Button variant="secondary" onClick={() => nav('/app/account#billing')}>Back to billing</Button>
      </Card>
    </>
  );
}
