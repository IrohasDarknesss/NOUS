// 管理セッションの API（getSession・login・logout）
import type { LoginRequest, LoginResponse, SessionResponse } from "@nous/shared";
import { adminFetch } from "./client";

export function getSession(): Promise<SessionResponse> {
  return adminFetch<SessionResponse>("/admin/api/session");
}

export function login(password: string): Promise<LoginResponse> {
  const body: LoginRequest = { password };
  return adminFetch<LoginResponse>("/admin/api/login", { method: "POST", body, csrf: false });
}

export function logout(): Promise<void> {
  return adminFetch<void>("/admin/api/logout", { method: "POST" });
}
