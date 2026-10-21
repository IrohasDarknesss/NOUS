// P210 閲覧アクセス管理の API クライアント（FE 詳細設計 admin_moderation 1章・4章）
import type {
  Id,
  InvitationCreateRequest,
  InvitationCreateResponse,
  InvitationListResponse,
  InvitationRevokeResponse,
} from "@nous/shared";
import { adminFetch } from "./client";

/** 招待の一覧と端末の LAN アドレスを取得する（GET /admin/api/invitations） */
export function listInvitations(): Promise<InvitationListResponse> {
  return adminFetch<InvitationListResponse>("/admin/api/invitations");
}

/** 招待リンクを発行する（POST /admin/api/invitations） */
export function issueInvitation(body: InvitationCreateRequest): Promise<InvitationCreateResponse> {
  return adminFetch<InvitationCreateResponse>("/admin/api/invitations", {
    method: "POST",
    body,
  });
}

/** 招待を失効させる（POST /admin/api/invitations/:invitationId/revoke） */
export function revokeInvitation(invitationId: Id): Promise<InvitationRevokeResponse> {
  return adminFetch<InvitationRevokeResponse>(`/admin/api/invitations/${encodeURIComponent(invitationId)}/revoke`, {
    method: "POST",
  });
}
