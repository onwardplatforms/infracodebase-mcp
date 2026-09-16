import type { ToolDef } from "./helpers.js";

/** Read-only company catalog discovery, independent of repository setup. */
export const listModules: ToolDef = {
  name: "list_modules",
  async run({ client }, a) {
    let enterpriseId = a.enterprise_id as string | undefined;
    if (!enterpriseId) {
      const { data } = await client.listEnterprises();
      const enterprises = data as Array<{ id: string; name: string }>;
      if (enterprises.length !== 1) {
        return {
          status: enterprises.length ? "needs_enterprise" : "no_access",
          enterprises: enterprises.map(({ id, name }) => ({ id, name })),
          message: enterprises.length
            ? "Ask which enterprise to use, then call list_modules with its enterprise_id. Do not combine catalogs from different enterprises."
            : "No enterprise is accessible with this token. Check your Infracodebase account or ask an enterprise admin for access; the module catalog has not been checked.",
        };
      }
      enterpriseId = enterprises[0].id;
    }
    const result = a.module_id
      ? await client.listModules(enterpriseId, a.module_id)
      : await client.listModules(enterpriseId);
    return {
      ...(result as Record<string, unknown>),
      enterprise_id: enterpriseId,
      guidance:
        "Compare these modules with the user's intent. Recommend relevant modules by exact name and explain the fit; do not force unrelated matches. Do not infer security guarantees from a description or version number. Use get_workspace_context for applicable rules before drafting; an empty folder does not require repository setup. Inspect the selected version's interface before composing code. Prefer registry_source with version when present; otherwise use source_url with a Git ref. Catalog access does not establish workspace governance or grant permission to create infrastructure.",
    };
  },
};
