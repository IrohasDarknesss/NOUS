// SQL の補助（BE 詳細設計 admin_data 4章 escapeLike）

/** LIKE の ESCAPE に指定する文字。escapeLike と組で `LIKE ? ESCAPE '\'` として使う */
export const LIKE_ESCAPE_CHAR = "\\";

/** LIKE の特殊文字を逃がす。\ を \\ に、% を \% に、_ を \_ にする */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 部分一致の LIKE のパターン（%値%）を作る */
export function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}
