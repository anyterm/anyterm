"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "urql";
import { gql } from "urql";
import { FormBanner } from "@/components/ui/form-banner";

const SSO_PROVIDERS_QUERY = gql`
  query { ssoProviders { id providerId domain issuer } }
`;

const REGISTER_SSO_MUTATION = gql`
  mutation ($providerId: String!, $domain: String!, $issuer: String!, $clientId: String!, $clientSecret: String!, $discoveryEndpoint: String) {
    registerSSOProvider(providerId: $providerId, domain: $domain, issuer: $issuer, clientId: $clientId, clientSecret: $clientSecret, discoveryEndpoint: $discoveryEndpoint)
  }
`;

const DELETE_SSO_MUTATION = gql`
  mutation ($providerId: String!) {
    deleteSSOProvider(providerId: $providerId)
  }
`;

const ssoSchema = z.object({
  providerId: z.string().min(1, "Required").max(64).regex(/^[a-z0-9-]+$/, "Lowercase alphanumeric and hyphens only"),
  domain: z.string().min(1, "Required").max(255),
  issuer: z.string().url("Must be a valid URL"),
  clientId: z.string().min(1, "Required"),
  clientSecret: z.string().min(1, "Required"),
});

type SSOValues = z.infer<typeof ssoSchema>;

export function SSOSection({ orgId }: { orgId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [serverError, setServerError] = useState("");
  const [success, setSuccess] = useState("");

  const [{ data, fetching }, reexecute] = useQuery({ query: SSO_PROVIDERS_QUERY });
  const [, executeRegister] = useMutation(REGISTER_SSO_MUTATION);
  const [, executeDelete] = useMutation(DELETE_SSO_MUTATION);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SSOValues>({
    resolver: zodResolver(ssoSchema),
  });

  async function onSubmit(values: SSOValues) {
    setServerError("");
    setSuccess("");

    const result = await executeRegister({
      ...values,
      discoveryEndpoint: `${values.issuer}/.well-known/openid-configuration`,
    });

    if (result.error) {
      setServerError(result.error.message || "Failed to register SSO provider");
      return;
    }

    setSuccess("SSO provider configured");
    reset();
    setShowForm(false);
    reexecute({ requestPolicy: "network-only" });
    setTimeout(() => setSuccess(""), 3000);
  }

  async function handleDelete(providerId: string) {
    const result = await executeDelete({ providerId });
    if (result.error) {
      setServerError(result.error.message || "Failed to delete provider");
      return;
    }
    reexecute({ requestPolicy: "network-only" });
  }

  const providers = data?.ssoProviders ?? [];

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-medium">Single Sign-On</h3>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-zinc-200"
          >
            Add Provider
          </button>
        )}
      </div>

      {fetching ? (
        <div className="text-sm text-zinc-500">Loading...</div>
      ) : providers.length > 0 ? (
        <div className="mb-4 space-y-2">
          {providers.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-2.5">
              <div>
                <span className="text-sm text-zinc-300">{p.providerId}</span>
                <span className="ml-2 text-xs text-zinc-600">{p.domain}</span>
              </div>
              <button
                onClick={() => handleDelete(p.providerId)}
                className="text-xs text-red-400 transition hover:text-red-300"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : !showForm ? (
        <p className="mb-4 text-sm text-zinc-500">No SSO providers configured. Add an OIDC provider to enable single sign-on for your team.</p>
      ) : null}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Provider ID</label>
              <input
                type="text"
                placeholder="acme-okta"
                {...register("providerId")}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-zinc-600"
              />
              {errors.providerId && <p className="mt-1 text-xs text-red-400">{errors.providerId.message}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Domain</label>
              <input
                type="text"
                placeholder="acme.com"
                {...register("domain")}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-zinc-600"
              />
              {errors.domain && <p className="mt-1 text-xs text-red-400">{errors.domain.message}</p>}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Issuer URL</label>
            <input
              type="url"
              placeholder="https://acme.okta.com"
              {...register("issuer")}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-zinc-600"
            />
            {errors.issuer && <p className="mt-1 text-xs text-red-400">{errors.issuer.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Client ID</label>
              <input
                type="text"
                {...register("clientId")}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-zinc-600"
              />
              {errors.clientId && <p className="mt-1 text-xs text-red-400">{errors.clientId.message}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Client Secret</label>
              <input
                type="password"
                {...register("clientSecret")}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-zinc-600"
              />
              {errors.clientSecret && <p className="mt-1 text-xs text-red-400">{errors.clientSecret.message}</p>}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Save Provider"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); reset(); }}
              className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {serverError && (
        <FormBanner variant="error" className="mt-2">{serverError}</FormBanner>
      )}
      {success && (
        <FormBanner variant="success" className="mt-2">{success}</FormBanner>
      )}
    </section>
  );
}
