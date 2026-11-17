// Register page - creates the account AND the organization, then signs in.
// Flow: validate → POST /auth/register → OWNER membership → session → /dashboard
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { registerSchema } from "@/validators/auth";
import type { RegisterInput } from "@/validators/auth";

export function RegisterPage() {
  const navigate = useNavigate();
  const { register: authRegister } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterInput) => {
    setSubmitting(true);
    setError(null);
    try {
      await authRegister(
        data.email,
        data.password,
        data.full_name || "",
        data.organization_name
      );
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const status = err?.status;
      if (status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else if (status === 409) {
        setError(err?.message || "An account with this email already exists.");
      } else {
        setError(
          err?.message || "Registration failed. Please try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary-600 to-accent text-white shadow-card">
            <Sparkles size={22} />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Create your workspace
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            One workspace per organization. You become the owner.
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
                Full name
              </label>
              <input
                {...register("full_name")}
                type="text"
                autoComplete="name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                placeholder="Jane Doe"
              />
            </div>

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
                Organization name
              </label>
              <input
                {...register("organization_name")}
                type="text"
                autoComplete="organization"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                placeholder="Acme Corp"
              />
              {errors.organization_name && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.organization_name.message}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                {...register("password")}
                type="password"
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                placeholder="At least 8 characters"
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
              {submitting ? "Creating workspace..." : "Create workspace"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary-600 hover:text-primary-hover">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
