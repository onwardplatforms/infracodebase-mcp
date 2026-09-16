import { expect, it } from "vitest";
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_BUDGET } from "./instructions.js";
it("keeps initialization guidance within the client's displayed budget", () => {
  expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(SERVER_INSTRUCTIONS_BUDGET);
});
