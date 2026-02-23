import { create } from 'zustand';
import type {
  StrategyDashboardData,
  DecisionRecordData,
  MarketStateData,
  StrategyEngineStatus,
} from '../types/strategy';

interface StrategyState {
  data: StrategyDashboardData | null;
  isLoading: boolean;
  error: string | null;
  selectedDecision: DecisionRecordData | null;
  drawerOpen: boolean;

  fetchData: () => Promise<void>;
  selectDecision: (d: DecisionRecordData | null) => void;
  toggleDrawer: (open?: boolean) => void;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export const useStrategyStore = create<StrategyState>((set, get) => ({
  data: null,
  isLoading: false,
  error: null,
  selectedDecision: null,
  drawerOpen: false,

  fetchData: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/strategy`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      set({ data: json, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch strategy data',
        isLoading: false,
      });
    }
  },

  selectDecision: (d) => set({ selectedDecision: d, drawerOpen: d !== null }),
  toggleDrawer: (open) => set((s) => ({ drawerOpen: open ?? !s.drawerOpen })),
}));
