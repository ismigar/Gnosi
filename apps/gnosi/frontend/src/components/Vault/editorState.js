// Module-level state shared between BlockEditor and VaultDashboard.
// Kept in a separate file so BlockEditor.jsx only exports React components
// and Vite Fast Refresh works correctly.
export const inFlightSaves = new Map();
