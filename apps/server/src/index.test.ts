import { ulid } from "ulid";
import { describe, expect, it } from "vitest";

describe("server の雛形", () => {
  it("TC-NOUS42_DEV-02 ulid が 26 字の ID を返す", () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
