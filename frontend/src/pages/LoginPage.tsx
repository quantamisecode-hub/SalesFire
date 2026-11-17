// Login page - real authentication against the backend.
// Errors: validation, invalid credentials, disabled account, rate limit, server error.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { loginSchema } from "@/validators/auth";
import type { LoginInput } from "@/validators/auth";

export function LoginPage() {
  const navigate = useNavigate();
  const { login: authLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput) => {
    setSubmitting(true);
    setError(null);
    try {
      await authLogin(data.email, data.password);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const status = err?.status;
      if (status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else if (status === 401) {
        setError(err?.message || "Invalid email or password.");
      } else if (status === 403) {
        setError(err?.message || "This account is disabled.");
      } else {
        setError(
          err?.message ||
            "Could not sign in. Please check your connection and try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary-600 to-accent text-white shadow-card">
            <Sparkles size={22} />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Sign in to SalesFire</h1>
          <p className="mt-1 text-sm text-slate-500">
            AI Sales Intelligence for your outreach pipeline
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-card">
          {error && (
            <div className="mb-5 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Work email
              </label>
              <input
                {...register("email")}
                type="email"
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                placeholder="you@company.com"
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                {...register("password")}
                type="password"
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                placeholder="••••••••••"
              />
              {errors.password && (
                <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Don't have an account?{" "}
            <Link to="/register" className="font-medium text-primary-600 hover:text-primary-hover">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
