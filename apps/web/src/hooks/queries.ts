import { useQuery } from '@tanstack/react-query';
import type { MeResponse, UsageResponse } from '@vlf/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export interface PublicConfig { demoMode: boolean; liveSourcesActive: number; billingMode: string; authMode: string; environment: string }

export const usePublicConfig = () =>
  useQuery({ queryKey: ['public-config'], queryFn: () => api<PublicConfig>('/api/public/config'), staleTime: 60_000 });

export function useMe() {
  const { user } = useAuth();
  return useQuery({ queryKey: ['me', user?.id], queryFn: () => api<MeResponse>('/api/me'), enabled: Boolean(user), staleTime: 30_000 });
}

export function useUsage() {
  const { user } = useAuth();
  return useQuery({ queryKey: ['usage', user?.id], queryFn: () => api<UsageResponse>('/api/usage'), enabled: Boolean(user) });
}
