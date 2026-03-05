"use client";

import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="text-sm text-zinc-400">
          Sign in to access your terminal sessions
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
