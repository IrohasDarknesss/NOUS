import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("admin の雛形", () => {
  it("TC-NOUS42_DEV-04 testing-library で描画できる", () => {
    render(<App />);
    expect(screen.getByText("NOUS admin")).toBeInTheDocument();
  });
});
