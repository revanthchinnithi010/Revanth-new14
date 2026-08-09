import { create } from "zustand";
import {
  ALL_ALERTS,
  type AnyAlert,
  type AlertStatus,
} from "@/data/alertsData";

// ── Persistence ───────────────────────────────────────────────────────────────
const LS_KEY = "tj_global_alerts_v1";

function load(): AnyAlert[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AnyAlert[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return ALL_ALERTS.map(a => ({ ...a }));
}

function save(alerts: AnyAlert[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(alerts)); } catch { /* ignore */ }
}

// ── Store interface ───────────────────────────────────────────────────────────
interface AlertStore {
  alerts: AnyAlert[];
  addAlert:    (alert: AnyAlert) => void;
  updateAlert: (id: string, patch: Partial<AnyAlert> & { status?: AlertStatus }) => void;
  deleteAlert: (id: string) => void;
  setAlerts:   (alerts: AnyAlert[]) => void;
}

export const useAlertStore = create<AlertStore>((set) => ({
  alerts: load(),

  addAlert: (alert) => set((state) => {
    const next = [alert, ...state.alerts.filter(a => a.id !== alert.id)];
    save(next);
    return { alerts: next };
  }),

  updateAlert: (id, patch) => set((state) => {
    const next = state.alerts.map(a =>
      a.id === id ? ({ ...a, ...patch } as AnyAlert) : a
    );
    save(next);
    return { alerts: next };
  }),

  deleteAlert: (id) => {
    // id is prefixed p_/z_/t_ (see apiAlertToPriceAlert etc. in pages/alerts.tsx)
    // to say which backend table it lives in. Fire-and-forget DB delete —
    // every caller (Alert Center modal, alerts page, etc.) goes through this
    // one function, so this is the single place that needs to talk to the
    // backend. Safe even if a caller already issued its own DELETE first
    // (idempotent 404, ignored).
    const endpoint =
      id.startsWith("z_") ? "/api/zones" :
      id.startsWith("t_") ? "/api/trendlines" :
      "/api/alerts";
    const numId = id.startsWith("p_") || id.startsWith("z_") || id.startsWith("t_") ? id.slice(2) : id;
    fetch(`${endpoint}/${numId}`, { method: "DELETE" }).catch(() => { /* offline/best-effort */ });

    set((state) => {
      const next = state.alerts.filter(a => a.id !== id);
      save(next);
      return { alerts: next };
    });
  },

  setAlerts: (alerts) => {
    save(alerts);
    set({ alerts });
  },
}));
