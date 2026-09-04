import { describe, it, expect } from "vitest";
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_BUDGET } from "./instructions.js";

describe("server instructions", () => {
  it("fits inside the budget clients actually display", () => {
    // Claude Code showed ~1,850 chars of the old 9,850-char text. Anything past
    // the budget is invisible to the model, so it must not carry protocol.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(SERVER_INSTRUCTIONS_BUDGET);
  });

  it("names the entry point, the setup path, and the evaluation rule", () => {
    for (const name of [
      "get_workspace_context",
      "plan_workspace_setup",
      "setup_workspace",
      "Commit and push first",
    ]) {
      expect(SERVER_INSTRUCTIONS).toContain(name);
    }
  });
});
