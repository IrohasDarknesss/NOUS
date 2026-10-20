import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { NotInvitedError } from "./api/client";
import { createRouter } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 401 は /not-invited へ移すので再試行しない。それ以外は 1 回だけ再試行する
      retry: (failureCount, error) => !(error instanceof NotInvitedError) && failureCount < 1,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
    },
  },
});

const router = createRouter();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
