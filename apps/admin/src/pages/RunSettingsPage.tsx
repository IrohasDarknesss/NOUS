// P205 実行設定（画面基本設計書 P205、FE 詳細設計 admin_control 2〜6章）
import {
  DEFAULT_SETTINGS,
  MODEL_OPTIONS,
  SETTINGS_RANGES,
  type ModelId,
  type NumericSettingKey,
  type RunSettings,
  type SettingsEstimateBasis,
} from "@nous/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router-dom";
import { ApiError, NetworkError } from "../api/client";
import { getSettings, updateSettings } from "../api/settings";
import { adminWorldQueryKey } from "../api/world";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { useErrorState } from "../shared/ErrorContext";
import { FieldError } from "../shared/FieldError";
import { buttonStyle, primaryButtonStyle } from "../shared/Modal";
import { NumberField } from "../shared/NumberField";
import { SelectField } from "../shared/SelectField";
import { colors, fontSizes } from "../shared/theme";
import { useToast } from "../shared/Toast";
import { FORM_ERROR_KEY, useApiErrorHandler, type FieldErrors } from "../shared/useApiErrorHandler";
import { computeEstimate } from "./runSettings/estimate";
import { EstimatePanel } from "./runSettings/EstimatePanel";
import { LimitWarning } from "./runSettings/LimitWarning";

export type SettingsForm = {
  [K in NumericSettingKey]: string;
} & {
  modelId: ModelId;
  promptVersion: string;
};

const NUMERIC_KEYS: readonly NumericSettingKey[] = [
  "cycleMinutes",
  "activityPercent",
  "maxRefPosts",
  "maxMemoryChars",
  "maxInputTokens",
  "maxOutputTokens",
  "dailyNeuronsLimit",
  "dailyRunsLimit",
  "maxConcurrency",
] as const;

export function toSettingsForm(settings: RunSettings): SettingsForm {
  return {
    cycleMinutes: String(settings.cycleMinutes),
    activityPercent: String(settings.activityPercent),
    maxRefPosts: String(settings.maxRefPosts),
    maxMemoryChars: String(settings.maxMemoryChars),
    maxInputTokens: String(settings.maxInputTokens),
    maxOutputTokens: String(settings.maxOutputTokens),
    dailyNeuronsLimit: String(settings.dailyNeuronsLimit),
    dailyRunsLimit: String(settings.dailyRunsLimit),
    maxConcurrency: String(settings.maxConcurrency),
    modelId: settings.modelId,
    promptVersion: settings.promptVersion,
  };
}

function toRunSettings(form: SettingsForm): RunSettings {
  return {
    cycleMinutes: Number(form.cycleMinutes),
    activityPercent: Number(form.activityPercent),
    maxRefPosts: Number(form.maxRefPosts),
    maxMemoryChars: Number(form.maxMemoryChars),
    maxInputTokens: Number(form.maxInputTokens),
    maxOutputTokens: Number(form.maxOutputTokens),
    dailyNeuronsLimit: Number(form.dailyNeuronsLimit),
    dailyRunsLimit: Number(form.dailyRunsLimit),
    maxConcurrency: Number(form.maxConcurrency),
    modelId: form.modelId,
    promptVersion: form.promptVersion,
  };
}

function isNumericSettingKey(name: string): name is NumericSettingKey {
  return name in SETTINGS_RANGES;
}

export function validateSettingsField(name: NumericSettingKey, value: string | number): string | null {
  const range = SETTINGS_RANGES[name];
  const message = `${range.min}〜${range.max} の整数で入力してください`;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || !/^-?\d+$/.test(trimmed)) {
      return message;
    }
    const num = Number(trimmed);
    if (!Number.isInteger(num) || num < range.min || num > range.max) {
      return message;
    }
    return null;
  }

  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    return message;
  }
  return null;
}

function isFormDirty(form: SettingsForm, saved: SettingsForm): boolean {
  return (
    form.cycleMinutes !== saved.cycleMinutes ||
    form.activityPercent !== saved.activityPercent ||
    form.maxRefPosts !== saved.maxRefPosts ||
    form.maxMemoryChars !== saved.maxMemoryChars ||
    form.maxInputTokens !== saved.maxInputTokens ||
    form.maxOutputTokens !== saved.maxOutputTokens ||
    form.dailyNeuronsLimit !== saved.dailyNeuronsLimit ||
    form.dailyRunsLimit !== saved.dailyRunsLimit ||
    form.maxConcurrency !== saved.maxConcurrency ||
    form.modelId !== saved.modelId ||
    form.promptVersion !== saved.promptVersion
  );
}

export function useUnsavedGuard(dirty: boolean) {
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  return blocker;
}

const sectionStyle = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
} as const;

export function RunSettingsPage() {
  const [form, setForm] = useState<SettingsForm>(() => toSettingsForm(DEFAULT_SETTINGS));
  const [saved, setSaved] = useState<SettingsForm>(() => toSettingsForm(DEFAULT_SETTINGS));
  const [basis, setBasis] = useState<SettingsEstimateBasis>({
    avgNeuronsPerRun: 16.4,
    activeAgents: 0,
    avgParticipation: 0,
  });
  const [modelOptions, setModelOptions] = useState<readonly ModelId[]>(MODEL_OPTIONS);
  const [promptVersions, setPromptVersions] = useState<readonly string[]>(["v1"]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { showModal } = useErrorState();
  const handleApiError = useApiErrorHandler();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSettings();
      const loaded = toSettingsForm(res.settings);
      setForm(loaded);
      setSaved(loaded);
      setBasis({
        avgNeuronsPerRun: res.avgNeuronsPerRun,
        activeAgents: res.activeAgents,
        avgParticipation: res.avgParticipation,
      });
      if (res.modelOptions.length > 0) setModelOptions(res.modelOptions);
      if (res.promptVersions.length > 0) setPromptVersions(res.promptVersions);
      setErrors({});
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        handleApiError(e);
      } else if ((e instanceof ApiError && e.status >= 500) || e instanceof NetworkError) {
        showModal({ message: "設定を取得できませんでした" });
      } else if (!(e instanceof ApiError && e.status === 404)) {
        handleApiError(e);
      }
    } finally {
      setLoading(false);
    }
  }, [handleApiError, showModal]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const dirty = useMemo(() => isFormDirty(form, saved), [form, saved]);
  const blocker = useUnsavedGuard(dirty);

  const estimate = useMemo(
    () => computeEstimate(form, basis.avgNeuronsPerRun, basis.activeAgents, basis.avgParticipation),
    [form, basis],
  );

  const onFieldChange = <K extends keyof SettingsForm>(name: K, value: SettingsForm[K]) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    if (isNumericSettingKey(name)) {
      const fieldError = validateSettingsField(name, value);
      setErrors((prev) => {
        const next = { ...prev };
        if (fieldError) {
          next[name] = fieldError;
        } else {
          delete next[name];
        }
        delete next[FORM_ERROR_KEY];
        return next;
      });
    } else {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        delete next[FORM_ERROR_KEY];
        return next;
      });
    }
  };

  const saveSettings = async () => {
    if (saving) return;

    const validationErrors: FieldErrors = {};
    for (const key of NUMERIC_KEYS) {
      const msg = validateSettingsField(key, form[key]);
      if (msg) validationErrors[key] = msg;
    }
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSaving(true);
    try {
      const payload = toRunSettings(form);
      const res = await updateSettings(payload);
      const nextSaved = toSettingsForm(res.settings);
      setForm(nextSaved);
      setSaved(nextSaved);
      setErrors({});
      await queryClient.invalidateQueries({ queryKey: adminWorldQueryKey });
      const baseToast = "保存しました。周期と活動量は次の巡から反映します";
      showToast(res.stateChanged ? `${baseToast}。上限停止が解けました` : baseToast);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 500) {
        showModal({ message: "保存に失敗しました。時間をおいて再度お試しください" });
        return;
      }
      const fieldErrors = handleApiError(e);
      if (fieldErrors) {
        setErrors(fieldErrors);
      }
    } finally {
      setSaving(false);
    }
  };

  const revertSettings = () => {
    setForm(saved);
    setErrors({});
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 style={{ fontSize: fontSizes.heading, margin: 0 }}>実行設定</h1>
        <span style={{ fontSize: 12, color: colors.subText }}>P205</span>
      </div>

      {loading ? (
        <p style={{ color: colors.subText }}>設定を読み込み中…</p>
      ) : (
        <>
          <EstimatePanel estimate={estimate} />
          <LimitWarning estimate={estimate} limit={Number(form.dailyNeuronsLimit)} />

          <section aria-label="周期と活動量" style={sectionStyle}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>周期と活動量（次の巡から反映）</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
              <NumberField
                label="周期（分）"
                value={form.cycleMinutes}
                min={SETTINGS_RANGES.cycleMinutes.min}
                max={SETTINGS_RANGES.cycleMinutes.max}
                unit="分"
                error={errors.cycleMinutes}
                disabled={saving}
                onChange={(v) => onFieldChange("cycleMinutes", v)}
              />
              <NumberField
                label="活動量（%）"
                value={form.activityPercent}
                min={SETTINGS_RANGES.activityPercent.min}
                max={SETTINGS_RANGES.activityPercent.max}
                unit="%"
                error={errors.activityPercent}
                disabled={saving}
                onChange={(v) => onFieldChange("activityPercent", v)}
              />
            </div>
          </section>

          <section aria-label="参照範囲と入出力の上限" style={sectionStyle}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>参照範囲と入出力の上限</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
              <NumberField
                label="参照する投稿の上限"
                value={form.maxRefPosts}
                min={SETTINGS_RANGES.maxRefPosts.min}
                max={SETTINGS_RANGES.maxRefPosts.max}
                unit="件"
                error={errors.maxRefPosts}
                disabled={saving}
                onChange={(v) => onFieldChange("maxRefPosts", v)}
              />
              <NumberField
                label="記憶の文字数の上限"
                value={form.maxMemoryChars}
                min={SETTINGS_RANGES.maxMemoryChars.min}
                max={SETTINGS_RANGES.maxMemoryChars.max}
                unit="字"
                error={errors.maxMemoryChars}
                disabled={saving}
                onChange={(v) => onFieldChange("maxMemoryChars", v)}
              />
              <NumberField
                label="最大入力トークン"
                value={form.maxInputTokens}
                min={SETTINGS_RANGES.maxInputTokens.min}
                max={SETTINGS_RANGES.maxInputTokens.max}
                unit="トークン"
                error={errors.maxInputTokens}
                disabled={saving}
                onChange={(v) => onFieldChange("maxInputTokens", v)}
              />
              <NumberField
                label="最大出力トークン"
                value={form.maxOutputTokens}
                min={SETTINGS_RANGES.maxOutputTokens.min}
                max={SETTINGS_RANGES.maxOutputTokens.max}
                unit="トークン"
                error={errors.maxOutputTokens}
                disabled={saving}
                onChange={(v) => onFieldChange("maxOutputTokens", v)}
              />
            </div>
          </section>

          <section aria-label="日次上限と並列数" style={sectionStyle}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>日次上限と並列数</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
              <NumberField
                label="Neurons の日次上限"
                value={form.dailyNeuronsLimit}
                min={SETTINGS_RANGES.dailyNeuronsLimit.min}
                max={SETTINGS_RANGES.dailyNeuronsLimit.max}
                unit="（無料枠 10,000）"
                error={errors.dailyNeuronsLimit}
                disabled={saving}
                onChange={(v) => onFieldChange("dailyNeuronsLimit", v)}
              />
              <NumberField
                label="生成の回数の日次上限"
                value={form.dailyRunsLimit}
                min={SETTINGS_RANGES.dailyRunsLimit.min}
                max={SETTINGS_RANGES.dailyRunsLimit.max}
                unit="回"
                error={errors.dailyRunsLimit}
                disabled={saving}
                onChange={(v) => onFieldChange("dailyRunsLimit", v)}
              />
              <NumberField
                label="並列数の上限"
                value={form.maxConcurrency}
                min={SETTINGS_RANGES.maxConcurrency.min}
                max={SETTINGS_RANGES.maxConcurrency.max}
                error={errors.maxConcurrency}
                disabled={saving}
                onChange={(v) => onFieldChange("maxConcurrency", v)}
              />
            </div>
          </section>

          <section aria-label="モデルとプロンプト" style={sectionStyle}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>モデルとプロンプト</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
              <SelectField<ModelId>
                label="モデル"
                options={modelOptions.map((m) => ({ value: m, label: m }))}
                value={form.modelId}
                error={errors.modelId}
                disabled={saving}
                onChange={(v) => onFieldChange("modelId", v)}
              />
              <SelectField<string>
                label="プロンプトの版"
                options={promptVersions.map((v) => ({ value: v, label: v }))}
                value={form.promptVersion}
                error={errors.promptVersion}
                disabled={saving}
                onChange={(v) => onFieldChange("promptVersion", v)}
              />
            </div>
          </section>

          <FieldError message={errors[FORM_ERROR_KEY]} />

          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void saveSettings()}
              style={{
                ...primaryButtonStyle,
                opacity: !dirty || saving ? 0.55 : 1,
                cursor: !dirty || saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={revertSettings}
              style={{
                ...buttonStyle,
                opacity: !dirty || saving ? 0.55 : 1,
                cursor: !dirty || saving ? "not-allowed" : "pointer",
              }}
            >
              元に戻す
            </button>
          </div>
        </>
      )}

      {blocker.state === "blocked" && (
        <ConfirmDialog
          title="未保存の変更"
          message="変更が保存されていません。移動しますか"
          confirmLabel="移動する"
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  );
}
