// P210 閲覧アクセス管理（FE 詳細設計 admin_moderation 2章〜6章）
import type { InvitationItem } from "@nous/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useBlocker } from "react-router-dom";
import { ApiError } from "../api/client";
import { issueInvitation, listInvitations, revokeInvitation } from "../api/invitations";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { colors, fontSizes } from "../shared/theme";
import { useToast } from "../shared/Toast";
import { useApiErrorHandler, type FieldErrors } from "../shared/useApiErrorHandler";
import { InvitationTable } from "./invitations/InvitationTable";
import { IssuedLinkBox } from "./invitations/IssuedLinkBox";
import { IssueForm } from "./invitations/IssueForm";
import { LanAddressNote } from "./invitations/LanAddressNote";

export const invitationsQueryKey = ["admin", "invitations"] as const;
export const LEAVE_CONFIRM_MESSAGE = "招待リンクはもう表示できません。コピーしましたか";
export const REVOKE_CONFIRM_MESSAGE = "失効させますか。この招待では見られなくなります";
export const REVOKE_SUCCESS_TOAST = "失効させました。次の閲覧から見られなくなります";
export const ALREADY_REVOKED_MESSAGE = "この招待はすでに失効しています";
export const LAN_ADDRESS_NOT_FOUND_MESSAGE =
  "この端末の LAN のアドレスが見つかりません。端末がネットワークにつながっているか確かめてください";

export function useInvitations() {
  return useQuery({
    queryKey: invitationsQueryKey,
    queryFn: listInvitations,
  });
}

export function useLeaveGuard(issuedUrl: string | null) {
  const hasUrl = Boolean(issuedUrl);
  const blocker = useBlocker(hasUrl);

  useEffect(() => {
    if (!hasUrl) return undefined;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUrl]);

  return blocker;
}

export function InvitationsPage() {
  // 発行したリンクはメモリ（useState）だけに持ち、localStorage・sessionStorage・URL・クエリキャッシュに入れない
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<InvitationItem | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const handleApiError = useApiErrorHandler();

  const invitationsQuery = useInvitations();
  const blocker = useLeaveGuard(issuedUrl);

  useEffect(() => {
    const err = invitationsQuery.error;
    if (err) handleApiError(err);
  }, [invitationsQuery.error, handleApiError]);

  const issue = async (label: string): Promise<FieldErrors | void> => {
    try {
      const res = await issueInvitation({ label });
      setIssuedUrl(res.inviteUrl);
      await queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        return handleApiError(err);
      }
      handleApiError(err, {
        conflictMessage: (apiErr) =>
          apiErr.code === "LAN_ADDRESS_NOT_FOUND" ? LAN_ADDRESS_NOT_FOUND_MESSAGE : apiErr.message,
      });
      // エラー時は label を残すため _form を空文字で返さず FieldErrors 判定に使う
      return { _form: "" };
    }
  };

  const requestRevoke = (invitation: InvitationItem) => {
    setConfirm(invitation);
  };

  const revoke = async (invitation: InvitationItem) => {
    try {
      await revokeInvitation(invitation.invitationId);
      await queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
      showToast(REVOKE_SUCCESS_TOAST);
      setConfirm(null);
    } catch (err) {
      handleApiError(err, {
        conflictMessage: ALREADY_REVOKED_MESSAGE,
        invalidateKeys: [invitationsQueryKey],
      });
      setConfirm(null);
    }
  };

  const items = invitationsQuery.data?.items ?? [];
  const lanAddress = invitationsQuery.data ? invitationsQuery.data.lanAddress : undefined;

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
        <h1 style={{ fontSize: fontSizes.heading, margin: 0 }}>閲覧アクセス管理</h1>
        <span style={{ color: colors.subText, fontSize: 12 }}>P210</span>
      </div>

      {lanAddress !== undefined && <LanAddressNote lanAddress={lanAddress} />}

      <IssueForm onIssue={issue} />

      {issuedUrl && <IssuedLinkBox url={issuedUrl} />}

      <InvitationTable items={items} onRevoke={requestRevoke} />

      {confirm && (
        <ConfirmDialog
          title="招待の失効"
          message={REVOKE_CONFIRM_MESSAGE}
          confirmLabel="失効させる"
          danger
          onConfirm={() => revoke(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {blocker.state === "blocked" && (
        <ConfirmDialog
          title="画面を離れますか"
          message={LEAVE_CONFIRM_MESSAGE}
          confirmLabel="移動する"
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </section>
  );
}
