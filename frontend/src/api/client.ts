// API client - the ONLY way the frontend communicates with the backend.
// Frontend NEVER communicates directly with AI providers or the database.
// Tokens are stored in HttpOnly cookies (not accessible to JS),
// so we do NOT manually attach Authorization headers for auth.
// We use fetch with credentials: 'include' to send cookies.
import { clientId } from "@/client-id";

const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

class ApiError extends Error {
  status: number;
  data?: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function request(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client-Id": clientId,
    ...(options.headers as Record<string, string> | undefined),
  };

  const config: RequestInit = {
    ...options,
    headers,
    // Always send cookies (HttpOnly auth tokens)
    credentials: "include",
    cache: "no-store",
  };

  const response = await fetch(url, config);

  // Handle network errors
  if (!response.ok) {
    let errorData: any = null;
    try {
      errorData = await response.json();
    } catch {
      // ignore JSON parse errors
    }

    const message =
      errorData?.error?.message ||
      errorData?.detail ||
      `Request failed with status ${response.status}`;

    throw new ApiError(message, response.status, errorData);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

export const api = {
  get: (path: string, options?: RequestInit) =>
    request(path, { ...options, method: "GET" }),
  post: (path: string, body?: any, options?: RequestInit) =>
    request(path, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: (path: string, body?: any, options?: RequestInit) =>
    request(path, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: (path: string, body?: any, options?: RequestInit) =>
    request(path, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: (path: string, options?: RequestInit) =>
    request(path, { ...options, method: "DELETE" }),
};

export { ApiError };
