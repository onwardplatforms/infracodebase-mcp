import { describe, it, expect } from "vitest";
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_BUDGET } from "./instructions.js";

describe("server instructions", () => {
  it("fits inside the budget clients actually display", () => {
    // Claude Code cuts server instructions at 4,096 characters (2,048 before
    // v2.1.296). Anything past the cut is invisible to the model, so the text
    // must fit, and protocol the agent must follow still rides in responses.
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
