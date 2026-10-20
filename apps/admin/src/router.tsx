// 管理画面の全 11 画面のルーティング（FE 詳細設計 admin_control・admin_agents_logs・admin_moderation 1章）。
// useBlocker（未保存の確認）を使うため、データルーター（createBrowserRouter）で組む。
import { createBrowserRouter, Navigate, Outlet, type RouteObject } from "react-router-dom";
import { AdminLayout } from "./layout/AdminLayout";
import { AgentEditPage } from "./pages/AgentEditPage";
import { AgentListPage } from "./pages/AgentListPage";
import { GenerationDetailPage } from "./pages/GenerationDetailPage";
import { GenerationListPage } from "./pages/GenerationListPage";
import { InvitationsPage } from "./pages/InvitationsPage";
import { LoginPage } from "./pages/LoginPage";
import { MetricsPage } from "./pages/MetricsPage";
import { ModerationPage } from "./pages/ModerationPage";
import { RunControlPage } from "./pages/RunControlPage";
import { RunSettingsPage } from "./pages/RunSettingsPage";
import { WorldArchivePage } from "./pages/WorldArchivePage";
import { RequireSession } from "./session/RequireSession";
import { SessionProvider } from "./session/SessionProvider";

function SessionRoot() {
  return (
    <SessionProvider>
      <Outlet />
    </SessionProvider>
  );
}

function ProtectedLayout() {
  return (
    <RequireSession>
      <AdminLayout />
    </RequireSession>
  );
}

/** 認証が要る画面（AdminLayout の中に出す） */
export const protectedRoutes: RouteObject[] = [
  { index: true, element: <RunControlPage /> }, // P202
  { path: "agents", element: <AgentListPage /> }, // P203
  { path: "agents/new", element: <AgentEditPage /> }, // P204（新規）
  { path: "agents/:agentId/edit", element: <AgentEditPage /> }, // P204（編集）
  { path: "settings", element: <RunSettingsPage /> }, // P205
  { path: "metrics", element: <MetricsPage /> }, // P206
  { path: "generations", element: <GenerationListPage /> }, // P207
  { path: "generations/:eventId", element: <GenerationDetailPage /> }, // P208
  { path: "moderation", element: <ModerationPage /> }, // P209
  { path: "invitations", element: <InvitationsPage /> }, // P210
  { path: "worlds", element: <WorldArchivePage /> }, // P211
];

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <SessionRoot />,
    children: [
      { path: "login", element: <LoginPage /> }, // P201
      { element: <ProtectedLayout />, children: protectedRoutes },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

export function createAdminRouter() {
  return createBrowserRouter(routes);
}
