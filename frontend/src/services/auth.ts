// Auth API service layer.
// All calls go through the backend API. Frontend never handles secrets.

import { api } from "../api/client";
import type {
  RegisterRequest,
  LoginRequest,
  TokenResponse,
  User,
} from "@/types";

export const authService = {
  async register(data: RegisterRequest): Promise<TokenResponse> {
    return api.post("/auth/register", data);
  },

  async login(data: LoginRequest): Promise<TokenResponse> {
    return api.post("/auth/login", data);
  },

  async logout(): Promise<void> {
    await api.post("/auth/logout");
  },

  async refresh(): Promise<TokenResponse> {
    return api.post("/auth/refresh");
  },

  async getMe(): Promise<User> {
    return api.get("/auth/me");
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    return api.post("/auth/forgot-password", { email });
  },

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    return api.post("/auth/reset-password", { token, new_password: newPassword });
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return api.post("/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },
};
