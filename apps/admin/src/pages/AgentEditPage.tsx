// P204 エージェント登録・編集（FE 詳細設計 admin_agents_logs 1〜6章、画面基本設計書 P204）
import type { AdminAgentItem, AgentListResponse, WorldState } from "@nous/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { agentsQueryKey, agentsQueryRootKey, createAgent, listAgents, updateAgent } from "../api/agents";
import { ApiError } from "../api/client";
import { adminWorldQueryKey, useAdminWorld } from "../api/world";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { FieldError } from "../shared/FieldError";
import { buttonStyle, primaryButtonStyle } from "../shared/Modal";
import { TextField } from "../shared/TextField";
import { colors, fontSizes } from "../shared/theme";
import { useToast } from "../shared/Toast";
import { FORM_ERROR_KEY, useApiErrorHandler, type FieldErrors } from "../shared/useApiErrorHandler";
import { ActivityLevelRadio } from "./agents/ActivityLevelRadio";
import {
  AGENT_LIMITS,
  AGENT_VALIDATION_MESSAGES,
  agentItemToForm,
  createInitialAgentForm,
  toAgentInputRequest,
  validateAgentField,
  validateAgentForm,
  type AgentForm,
  type AgentFormField,
} from "./agents/agentForm";
import { NoRealPersonCheckbox } from "./agents/NoRealPersonCheckbox";

export const AGENT_EDIT_DISABLED_MESSAGE = "世界が開始された後は、エージェントを編集できません";
export const AGENT_NOT_FOUND_MESSAGE = "エージェントが見つかりません";
export const AGENT_SAVE_CONFLICT_MESSAGE = "世界が開始されたため、保存できませんでした";
export const AGENT_SAVED_TOAST = "保存しました";

export function AgentEditPage() {
  const { agentId } = useParams<{ agentId?: string }>();
  const isEdit = Boolean(agentId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { world } = useAdminWorld();
  const { showToast } = useToast();
  const handleError = useApiErrorHandler();

  const [form, setForm] = useState<AgentForm>(() => createInitialAgentForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadedWorldState, setLoadedWorldState] = useState<WorldState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAgentForEdit(targetId?: string) {
      if (!targetId) {
        setForm(createInitialAgentForm());
        setErrors({});
        setDirty(false);
        setNotFound(false);
        return;
      }

      // 1. agentsQuery のキャッシュから対象を探す
      const cached =
        queryClient.getQueryData<AgentListResponse>(agentsQueryKey("all")) ??
        queryClient.getQueryData<AgentListResponse>(agentsQueryKey("active")) ??
        queryClient.getQueryData<AgentListResponse>(agentsQueryKey("stopped"));

      const cachedItem = cached?.items.find((a) => a.agentId === targetId);
      if (cachedItem) {
        if (!cancelled) {
          setLoadedWorldState(cached?.worldState ?? null);
          setForm(agentItemToForm(cachedItem as AdminAgentItem & Partial<AgentForm>));
          setErrors({});
          setDirty(false);
          setNotFound(false);
        }
        return;
      }

      // 2. なければ listAgents を取り直す
      try {
        const res = await listAgents();
        if (cancelled) return;
        queryClient.setQueryData(agentsQueryKey("all"), res);
        setLoadedWorldState(res.worldState);
        const found = res.items.find((a) => a.agentId === targetId);
        if (!found) {
          setNotFound(true);
          return;
        }
        setForm(agentItemToForm(found as AdminAgentItem & Partial<AgentForm>));
        setErrors({});
        setDirty(false);
        setNotFound(false);
      } catch (e) {
        if (!cancelled) {
          handleError(e);
        }
      }
    }

    void loadAgentForEdit(agentId);
    return () => {
      cancelled = true;
    };
  }, [agentId, queryClient, handleError]);

  const effectiveWorldState: WorldState | undefined = world?.state ?? loadedWorldState ?? undefined;
  const isNotPreparing = effectiveWorldState !== undefined && effectiveWorldState !== "preparing";

  const updateField = <K extends AgentFormField>(field: K, value: AgentForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleFieldBlur = (field: AgentFormField) => {
    const fieldError = validateAgentField(form, field);
    setErrors((prev) => {
      const next = { ...prev };
      if (fieldError) {
        next[field] = fieldError;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  const submitAgentForm = async (e?: FormEvent) => {
    e?.preventDefault();
    if (saving) return;

    const validationErrors = validateAgentForm(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSaving(true);
    try {
      const payload = toAgentInputRequest(form);
      if (isEdit && agentId) {
        await updateAgent(agentId, payload);
      } else {
        await createAgent(payload);
      }
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: agentsQueryRootKey });
      await queryClient.invalidateQueries({ queryKey: adminWorldQueryKey });
      showToast(AGENT_SAVED_TOAST);
      navigate("/agents");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === "HANDLE_TAKEN") {
        setErrors((prev) => ({
          ...prev,
          handle: AGENT_VALIDATION_MESSAGES.handleTaken,
        }));
        return;
      }
      const fieldErrs = handleError(err, {
        conflictMessage: AGENT_SAVE_CONFLICT_MESSAGE,
        invalidateKeys: [agentsQueryRootKey, adminWorldQueryKey],
      });
      if (fieldErrs) {
        setErrors((prev) => ({ ...prev, ...fieldErrs }));
      }
    } finally {
      setSaving(false);
    }
  };

  const cancelAgentEdit = () => {
    if (dirty) {
      setCancelConfirmOpen(true);
      return;
    }
    navigate("/agents");
  };

  const headingText = isEdit ? "エージェントの編集" : "エージェントの登録";

  // 様式③：編集対象が見つからないとき
  if (notFound) {
    return (
      <section data-screen-id="P204">
        <h1 style={{ fontSize: fontSizes.heading, margin: "0 0 16px" }}>
          {headingText}
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            P204
          </span>
        </h1>
        <div
          role="alert"
          style={{
            padding: 24,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
          }}
        >
          <p style={{ margin: "0 0 12px" }}>{AGENT_NOT_FOUND_MESSAGE}</p>
          <Link to="/agents" style={{ color: colors.primary }}>
            エージェント一覧へ戻る
          </Link>
        </div>
      </section>
    );
  }

  // H15：世界が準備中でないときは編集できない案内だけを表示し、フォームを出さない
  if (isNotPreparing) {
    return (
      <section data-screen-id="P204">
        <h1 style={{ fontSize: fontSizes.heading, margin: "0 0 16px" }}>
          {headingText}
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            P204
          </span>
        </h1>
        <div
          style={{
            padding: 24,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
          }}
        >
          <p style={{ margin: "0 0 12px" }}>{AGENT_EDIT_DISABLED_MESSAGE}</p>
          <Link to="/agents" style={{ color: colors.primary }}>
            エージェント一覧へ戻る
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section data-screen-id="P204">
      <h1 style={{ fontSize: fontSizes.heading, margin: "0 0 16px" }}>
        {headingText}
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          P204
        </span>
      </h1>

      <form
        noValidate
        onSubmit={(e) => void submitAgentForm(e)}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 24,
        }}
      >
        <div onBlur={() => handleFieldBlur("handle")}>
          <TextField
            label="ハンドル"
            value={form.handle}
            maxLength={AGENT_LIMITS.handle.max}
            error={errors.handle}
            disabled={saving}
            onChange={(v) => updateField("handle", v)}
          />
        </div>

        <div onBlur={() => handleFieldBlur("displayName")}>
          <TextField
            label="表示名"
            value={form.displayName}
            maxLength={AGENT_LIMITS.displayName.max}
            error={errors.displayName}
            disabled={saving}
            onChange={(v) => updateField("displayName", v)}
          />
        </div>

        <div onBlur={() => handleFieldBlur("bio")}>
          <TextField
            label="自己紹介"
            value={form.bio}
            maxLength={AGENT_LIMITS.bio.max}
            multiline
            rows={3}
            error={errors.bio}
            disabled={saving}
            onChange={(v) => updateField("bio", v)}
          />
        </div>

        <div onBlur={() => handleFieldBlur("interests")}>
          <TextField
            label="興味"
            value={form.interests}
            maxLength={AGENT_LIMITS.attribute.max}
            placeholder="季節の食材、天気"
            error={errors.interests}
            disabled={saving}
            onChange={(v) => updateField("interests", v)}
          />
        </div>

        <div onBlur={() => handleFieldBlur("topics")}>
          <TextField
            label="関心分野"
            value={form.topics}
            maxLength={AGENT_LIMITS.attribute.max}
            error={errors.topics}
            disabled={saving}
            onChange={(v) => updateField("topics", v)}
          />
        </div>

        <div onBlur={() => handleFieldBlur("personality")}>
          <TextField
            label="性格"
            value={form.personality}
            maxLength={AGENT_LIMITS.attribute.max}
            placeholder="素朴で温かい口調。丁寧語"
            error={errors.personality}
            disabled={saving}
            onChange={(v) => updateField("personality", v)}
          />
        </div>

        <div onBlur={() => handleFieldBlur("valuesText")}>
          <TextField
            label="価値観"
            value={form.valuesText}
            maxLength={AGENT_LIMITS.attribute.max}
            error={errors.valuesText}
            disabled={saving}
            onChange={(v) => updateField("valuesText", v)}
          />
        </div>

        <div onBlur={() => handleFieldBlur("stance")}>
          <TextField
            label="主張傾向"
            value={form.stance}
            maxLength={AGENT_LIMITS.attribute.max}
            error={errors.stance}
            disabled={saving}
            onChange={(v) => updateField("stance", v)}
          />
        </div>

        <ActivityLevelRadio
          value={form.activityLevel}
          error={errors.activityLevel}
          disabled={saving}
          onChange={(lvl) => updateField("activityLevel", lvl)}
        />

        <NoRealPersonCheckbox
          checked={form.noRealPersonConfirmed}
          error={errors.noRealPersonConfirmed}
          disabled={saving}
          onChange={(checked) => updateField("noRealPersonConfirmed", checked)}
          onBlur={() => handleFieldBlur("noRealPersonConfirmed")}
        />

        <FieldError message={errors[FORM_ERROR_KEY]} />

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button type="submit" disabled={saving} style={primaryButtonStyle}>
            保存
          </button>
          <button type="button" disabled={saving} onClick={cancelAgentEdit} style={buttonStyle}>
            取消
          </button>
        </div>
      </form>

      {cancelConfirmOpen && (
        <ConfirmDialog
          title="確認"
          message="入力を破棄しますか"
          confirmLabel="破棄する"
          danger
          onConfirm={() => {
            setCancelConfirmOpen(false);
            navigate("/agents");
          }}
          onCancel={() => setCancelConfirmOpen(false)}
        />
      )}
    </section>
  );
}
