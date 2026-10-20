// ルーターと Provider を組んで描画する（main.tsx と同じ構成を createMemoryRouter で）
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { routes as appRoutes } from "../router";

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

export function renderApp(initialPath: string, routes: RouteObject[] = appRoutes) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const queryClient = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
