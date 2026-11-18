import { WORKSPACE_PAGE_LIMIT } from "../client.js";
import type { ToolDef } from "./helpers.js";

export const TRUNCATED_NEXT =
  `This enterprise has more workspaces than one call returns (at most ${WORKSPACE_PAGE_LIMIT}), ` +
  "and the API has no cursor to page further. To reach a specific workspace, pass slug here, " +
  "or call get_workspace_context with its repo_url or workspace_id.";

/**
 * List workspaces in an enterprise. The API returns one page and no cursor,
 * so a full page is reported as `truncated` with a `next` saying how to
 * reach a workspace that is not on it.
 */
export const listWorkspaces: ToolDef = {
  name: "list_workspaces",
  async run({ client }, a) {
    const limit = a.limit ?? WORKSPACE_PAGE_LIMIT;
    const result = (await client.listWorkspaces(a.enterprise_id, a.kinds, {
      limit,
      slug: a.slug,
    })) as { data: unknown[] } & Record<string, unknown>;
    const truncated = !a.slug && (result.data ?? []).length >= limit;
    return truncated ? { ...result, truncated, next: TRUNCATED_NEXT } : { ...result, truncated };
  },
};
