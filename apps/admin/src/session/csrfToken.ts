// CSRF トークンの置き場所。メモリだけに置き、localStorage・sessionStorage には保存しない（P201 の業務ルール）。
// SessionProvider が書き、adminFetch が読む。

let csrfToken: string | null = null;

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}
