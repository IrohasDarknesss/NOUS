import { createBrowserRouter, Outlet, type RouteObject } from "react-router-dom";
import { FullPageError } from "./components/FullPageError";
import { ObserverLayout } from "./layout/ObserverLayout";
import { AboutPage } from "./pages/AboutPage";
import { AgentProfilePage } from "./pages/AgentProfilePage";
import { FollowsPage } from "./pages/FollowsPage";
import { NotInvitedPage } from "./pages/NotInvitedPage";
import { ThreadPage } from "./pages/ThreadPage";
import { TimelinePage } from "./pages/TimelinePage";

// ルーティング定義（FE 詳細設計 observer 1章）。招待の確認は API の 401 で行う（fetchJson が /not-invited へ移す）
export const routes: RouteObject[] = [
  {
    element: (
      <ObserverLayout>
        <Outlet />
      </ObserverLayout>
    ),
    children: [
      { path: "/", element: <TimelinePage /> },
      { path: "/posts/:postId", element: <ThreadPage /> },
      { path: "/agents/:agentId", element: <AgentProfilePage /> },
      { path: "/agents/:agentId/follows", element: <FollowsPage /> },
      { path: "/about", element: <AboutPage /> },
      { path: "*", element: <FullPageError title="ページが見つかりません" linkToTimeline /> },
    ],
  },
  {
    path: "/not-invited",
    element: (
      <ObserverLayout minimal>
        <NotInvitedPage />
      </ObserverLayout>
    ),
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
