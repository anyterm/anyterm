"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, gql } from "urql";
import { SubscribeModal } from "@/components/subscribe-modal";
import { authClient } from "./auth-client";
import type { PlanTier } from "./plan-limits";

const CURRENT_PLAN_QUERY = gql`
  query {
    currentPlan
  }
`;

type SubscriptionInfo = {
  isActive: boolean;
  planName: PlanTier | null;
  loading: boolean;
};

const SubscriptionContext = createContext<{
  subscription: SubscriptionInfo;
  openSubscribeModal: () => void;
} | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [modalOpen, setModalOpen] = useState(false);
  const { data: activeOrg } = (authClient as any).useActiveOrganization();

  const [planResult, reexecuteQuery] = useQuery<{ currentPlan: PlanTier | null }>({
    query: CURRENT_PLAN_QUERY,
  });

  // Re-query plan when active org changes
  const orgId = activeOrg?.id;
  useEffect(() => {
    if (orgId) {
      reexecuteQuery({ requestPolicy: "network-only" });
    }
  }, [orgId, reexecuteQuery]);

  const plan = planResult.data?.currentPlan ?? null;
  const isActive = plan === "starter" || plan === "pro" || plan === "team";
  const loading = planResult.fetching;

  const openSubscribeModal = useCallback(() => setModalOpen(true), []);

  const value = useMemo(
    () => ({
      subscription: { isActive, planName: plan, loading },
      openSubscribeModal,
    }),
    [isActive, plan, loading, openSubscribeModal],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
      <SubscribeModal isOpen={modalOpen} onOpenChange={setModalOpen} />
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionInfo {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    return { isActive: true, planName: "team", loading: false };
  }
  return ctx.subscription;
}

