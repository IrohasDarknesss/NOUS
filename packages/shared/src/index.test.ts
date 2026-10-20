import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("shared の雛形", () => {
  it("TC-NOUS42_DEV-01 shared の vitest と zod が動く", () => {
    expect(z.string().min(1).safeParse("nous").success).toBe(true);
  });
});
