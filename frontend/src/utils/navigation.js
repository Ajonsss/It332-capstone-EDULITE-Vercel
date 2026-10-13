export const NAVIGATION_ITEMS = [
  { view: "dashboard", label: "Dashboard", icon: "dashboard" },
  { view: "sections", label: "Sections", icon: "category" },
  { view: "subjects", label: "Subjects", icon: "menu_book" },
  { view: "students", label: "Students", icon: "groups", relatedViews: ["studentForm"] },
  { view: "assessments", label: "Assessments", icon: "assignment", relatedViews: ["assessmentForm"] },
  { view: "records", label: "Records", icon: "table_view" },
  { view: "interventions", label: "Interventions", icon: "intervention" },
  { view: "yearEnd", label: "Year-End & Archives", icon: "archive" },
  { view: "awards", label: "Awards", icon: "workspace_premium" },
  { view: "aiInsights", label: "AI Insights", icon: "auto_awesome" },
];

export function isNavigationItemActive(item, activeView) {
  return item.view === activeView || (item.relatedViews ?? []).includes(activeView);
}
