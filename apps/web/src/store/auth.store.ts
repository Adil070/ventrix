import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  isSuperAdmin: boolean;
  organizations: Array<{
    organizationId: string;
    role: string;
    organization: { id: string; name: string; logoUrl?: string };
    permissions: any[];
  }>;
}

interface Organization {
  id: string;
  name: string;
  logoUrl?: string;
  gstin?: string;
  currency: string;
  timezone: string;
  subscription?: { plan: string; status: string };
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  currentOrganization: Organization | null;
  currentBranch: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  _hasHydrated: boolean;

  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setCurrentOrganization: (org: Organization) => void;
  setCurrentBranch: (branchId: string | null) => void;
  updateUser: (user: Partial<User>) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      currentOrganization: null,
      currentBranch: null,
      isAuthenticated: false,
      isLoading: false,
      _hasHydrated: false,

      setAuth: (user, accessToken, refreshToken) => {
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
        // Set default organization
        const firstOrg = user.organizations[0];
        if (firstOrg) {
          localStorage.setItem('organizationId', firstOrg.organizationId);
        }
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          currentOrganization: firstOrg ? { ...firstOrg.organization, id: firstOrg.organizationId, currency: 'INR', timezone: 'Asia/Kolkata' } : null,
        });
      },

      setCurrentOrganization: (org) => {
        localStorage.setItem('organizationId', org.id);
        set({ currentOrganization: org });
      },

      setCurrentBranch: (branchId) => {
        set({ currentBranch: branchId });
      },

      updateUser: (userData) => {
        const current = get().user;
        if (current) set({ user: { ...current, ...userData } });
      },

      logout: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('organizationId');
        set({ user: null, accessToken: null, refreshToken: null, currentOrganization: null, currentBranch: null, isAuthenticated: false });
      },

      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        currentOrganization: state.currentOrganization,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
