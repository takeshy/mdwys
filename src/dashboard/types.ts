export interface LayoutPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardWidget {
  id: string;
  type: "file" | "web";
  title: string;
  layout: LayoutPos;
  config: Record<string, unknown>;
}

export interface DashboardData {
  widgets: DashboardWidget[];
}

export const DASHBOARD_STORAGE_KEY = "mdwys:dashboard";

export const defaultDashboard = (): DashboardData => ({
  widgets: [
    {
      id: crypto.randomUUID(),
      type: "file",
      title: "File",
      layout: { x: 0, y: 0, w: 8, h: 5 },
      config: {},
    },
  ],
});
