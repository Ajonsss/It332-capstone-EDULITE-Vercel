let pending;

// Share the same download between the sign-in form and React's lazy route.
export function loadDashboard() {
  pending ??= import("../components/Dashboard.jsx").catch((error) => { pending = undefined; throw error; });
  return pending;
}
