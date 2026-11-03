import { describe, it, expect, vi } from "vitest";
import { listWorkspaces, TRUNCATED_NEXT } from "./list_workspaces.js";
import { WORKSPACE_PAGE_LIMIT } from "../client.js";
import { mockClient, mockContext } from "../test-helpers.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ws_${i}` }));

describe("list_workspaces", () => {
  it("asks for the largest page with no kinds by default", async () => {
    const client = mockClient({ listWorkspaces: vi.fn().mockResolvedValue({ data: [] }) });
    const ctx = mockContext({ client });

    await listWorkspaces.run(ctx, { enterprise_id: "ent_1" });

    expect(client.listWorkspaces).toHaveBeenCalledWith("ent_1", undefined, {
      limit: WORKSPACE_PAGE_LIMIT,
      slug: undefined,
    });
  });

  it("passes kinds, slug, and limit through", async () => {
    const client = mockClient({ listWorkspaces: vi.fn().mockResolvedValue({ data: [] }) });
    const ctx = mockContext({ client });

    await listWorkspaces.run(ctx, {
      enterprise_id: "ent_1",
      kinds: ["STANDARD", "TEMPLATE", "MODULE"],
      slug: "platform-team",
      limit: 10,
    });

    expect(client.listWorkspaces).toHaveBeenCalledWith("ent_1", ["STANDARD", "TEMPLATE", "MODULE"], {
      limit: 10,
      slug: "platform-team",
    });
  });

  it("returns the client's rows and reports a partial page as not truncated", async () => {
    const response = {
      data: [
        { id: "ws_1", name: "Infra", kind: "STANDARD" },
        { id: "ws_2", name: "Terraform Template", kind: "TEMPLATE" },
      ],
    };
    const client = mockClient({ listWorkspaces: vi.fn().mockResolvedValue(response) });
    const ctx = mockContext({ client });

    const result = await listWorkspaces.run(ctx, { enterprise_id: "ent_1" });

    expect(result).toEqual({ ...response, truncated: false });
  });

  it("flags a full page as truncated and says how to reach the rest", async () => {
    const client = mockClient({
      listWorkspaces: vi.fn().mockResolvedValue({ data: rows(WORKSPACE_PAGE_LIMIT) }),
    });
    const ctx = mockContext({ client });

    const result = (await listWorkspaces.run(ctx, { enterprise_id: "ent_1" })) as Record<
      string,
      unknown
    >;

    expect(result.truncated).toBe(true);
    expect(result.next).toBe(TRUNCATED_NEXT);
    expect(TRUNCATED_NEXT).toMatch(/slug/);
  });

  it("measures truncation against the limit the caller chose", async () => {
    const client = mockClient({ listWorkspaces: vi.fn().mockResolvedValue({ data: rows(5) }) });
    const ctx = mockContext({ client });

    const result = (await listWorkspaces.run(ctx, { enterprise_id: "ent_1", limit: 5 })) as Record<
      string,
      unknown
    >;

    expect(result.truncated).toBe(true);
  });

  it("never calls a slug lookup truncated, even when it fills the page", async () => {
    const client = mockClient({ listWorkspaces: vi.fn().mockResolvedValue({ data: rows(1) }) });
    const ctx = mockContext({ client });

    const result = (await listWorkspaces.run(ctx, {
      enterprise_id: "ent_1",
      slug: "infra",
      limit: 1,
    })) as Record<string, unknown>;

    expect(result.truncated).toBe(false);
    expect(result.next).toBeUndefined();
  });
});
