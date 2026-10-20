// 管理 API：認証・招待・監査の 7 本（BE 詳細設計 admin_auth 2章）
import type { AuditOperation, AuditTargetType } from "../constants.js";
import type { Cursor, CursorPage, Id, IsoDateTime, JsonValue, NoContent } from "./common.js";

// ---- POST /admin/api/login ----

export interface LoginRequest {
  password: string;
}
export interface LoginResponse {
  displayName: string;
  csrfToken: string;
}

// ---- POST /admin/api/logout ----

export type LogoutResponse = NoContent;

// ---- GET /admin/api/session ----

export interface SessionResponse {
  displayName: string;
  csrfToken: string;
  /** min(作成＋8 時間, 最終操作＋60 分) */
  expiresAt: IsoDateTime;
}

// ---- GET /admin/api/invitations ----

export interface InvitationItem {
  invitationId: Id;
  label: string;
  issuedAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
  lastUsedAt: IsoDateTime | null;
}
export interface InvitationListResponse {
  items: InvitationItem[];
  /** 観察サーバーが待ち受ける端末の私設 IPv4 アドレス。見つからなければ null */
  lanAddress: string | null;
}

// ---- POST /admin/api/invitations ----

export interface InvitationCreateRequest {
  label: string;
}
export interface InvitationCreateResponse {
  invitationId: Id;
  /** 一度だけ返す招待リンク（http://LAN の IP:8080/invite/トークン） */
  inviteUrl: string;
}

// ---- POST /admin/api/invitations/:invitationId/revoke ----

export interface InvitationParams {
  invitationId: Id;
}
export interface InvitationRevokeResponse {
  invitationId: Id;
  revokedAt: IsoDateTime;
}

// ---- GET /admin/api/audit-logs ----

export interface AuditLogQuery {
  operation?: AuditOperation;
  cursor?: Cursor;
  limit?: number;
}
export interface AuditLog {
  auditId: Id;
  operation: AuditOperation;
  targetType: AuditTargetType;
  targetId: string | null;
  beforeJson: JsonValue | null;
  afterJson: JsonValue | null;
  operatedAt: IsoDateTime;
}
export type AuditLogPage = CursorPage<AuditLog>;
export type AuditLogListResponse = AuditLogPage;
