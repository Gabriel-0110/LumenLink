import { create } from 'zustand';
import type { DashboardData } from '../types/api';
import { fetchDashboardData } from '../services/api';

interface DashboardStore {
  /** Full dashboard payload from /api/data */
  data: DashboardData | null;

  /** Loading / error state */
  isLoading: boolean;
  error: string | null;

  /** WebSocket connection status */
  wsConnected: boolean;

  /** Seconds until next auto-refresh */
  countdown: number;

  /** Sidebar collapsed state */
  sidebarCollapsed: boolean;

  /** Actions */
  fetchData: () => Promise<void>;
  setWsConnected: (connected: boolean) => void;
  setCountdown: (value: number) => void;
  tickCountdown: () => number;
  toggleSidebar: () => void;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  data: null,
  isLoading: false,
  error: null,
  wsConnected: false,
  countdown: 15,
  sidebarCollapsed: false,

  fetchData: async () => {
    if (get().isLoading) return; // guard against concurrent fetches
    set({ isLoading: true, error: null });
    try {
      const data = await fetchDashboardData();
      set({ data, isLoading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch data';
      set({ error: message, isLoading: false });
    }
  },

  setWsConnected: (connected: boolean) => set({ wsConnected: connected }),

  setCountdown: (value: number) => set({ countdown: value }),

  tickCountdown: () => {
    const current = get().countdown - 1;
    set({ countdown: current });
    return current;
  },

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
