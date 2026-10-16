'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Experience } from '@/lib/business';

export function useOrganization() {
  return useQuery({
    queryKey: ['organization'],
    queryFn: () => api.organization.get(),
    select: r => r.data.data,
    staleTime: 5 * 60 * 1000,
  });
}

// UI preferences live in organization.settings so they follow the business across devices.
export function useOrgSettings() {
  const qc = useQueryClient();
  const { data: org, isLoading } = useOrganization();
  const settings: Record<string, any> = org?.settings || {};

  const mutation = useMutation({
    // PUT replaces the whole settings object, so merge with what's already stored.
    mutationFn: (patch: Record<string, any>) => api.organization.update({ settings: { ...settings, ...patch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization'] }),
  });

  return {
    org,
    isLoading,
    settings,
    experience: (settings.experience as Experience | undefined) ?? 'simple',
    hasChosenExperience: !!settings.experience,
    updateSettings: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
