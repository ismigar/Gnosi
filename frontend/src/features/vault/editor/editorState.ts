// Module-level state shared between BlockEditor and VaultDashboard.
// Kept in a separate file so BlockEditor.jsx only exports React components
// and Vite Fast Refresh works correctly.
interface InFlightSave {
  content: string;
  metadata: Record<string, unknown>;
  promise: Promise<unknown>;
  timestamp: number;
}

export const inFlightSaves = new Map<string, InFlightSave>();
