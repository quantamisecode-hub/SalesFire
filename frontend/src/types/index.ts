// Frontend type definitions.
// Never store backend secrets or credentials here.

export interface User {
  id: string;
  email: string;
  full_name?: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
}

export interface Membership {
  id: string;
  organization_id: string;
  user_id: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  is_active: boolean;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name?: string;
  organization_name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthError {
  code: string;
  message: string;
  field?: string;
}

export interface ErrorResponse {
  error: AuthError;
  request_id?: string;
}

export interface PaginationParams {
  page?: number;
  page_size?: number;
}

export interface ApiError extends Error {
  status?: number;
  data?: ErrorResponse;
}
