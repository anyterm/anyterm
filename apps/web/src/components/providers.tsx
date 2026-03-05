"use client";

import { Provider } from "urql";
import { urqlClient } from "@/lib/urql";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider value={urqlClient}>
      <ToastProvider>{children}</ToastProvider>
    </Provider>
  );
}
