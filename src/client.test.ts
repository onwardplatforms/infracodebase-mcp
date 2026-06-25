import { describe, it, expect, vi, afterEach } from "vitest";
import { InfracodebaseClient, ApiError } from "./client.js";

/**
 * These tests exercise the one piece of real logic that touches the actual
 * process boundary: the shared request() path (URL + query building, auth
 * headers, body serialization, and the non-2xx -> ApiError translation).
 * `fetch` is the only thing mocked — it is the true boundary.
 */

/** Install a fetch stub that records calls and returns a canned response. */
function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Read back the (url, init) of the single fetch call. */
function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: url as string, init: init as RequestInit };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InfracodebaseClient — request plumbing", () => {
  it("strips a trailing slash from baseUrl when building the URL", async () => {
    const fetchMock = stubFetch(jsonResponse({ data: [] }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com/", token: "t" });

    await client.listEnterprises();

    expect(lastCall(fetchMock).url).toBe("https://api.example.com/enterprises");
  });

  it("sends the bearer token and the JSON + User-Agent headers", async () => {
    const fetchMock = stubFetch(jsonResponse({ data: [] }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "secret" });

    await client.listEnterprises();

    expect(lastCall(fetchMock).init.headers).toMatchObject({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
      "User-Agent": "@infracodebase/mcp/1.0.0",
    });
  });

  it("omits the body on a GET", async () => {
    const fetchMock = stubFetch(jsonResponse({ data: [] }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    await client.listWorkspaces("ent_1");

    const { init } = lastCall(fetchMock);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("JSON-serializes the body on a POST", async () => {
    const fetchMock = stubFetch(jsonResponse({ id: "ws_1" }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    await client.createWorkspace("ent_1", { name: "infra" });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://api.example.com/enterprises/ent_1/workspaces");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "infra" }));
  });

  it("returns the parsed JSON body on a 2xx", async () => {
    stubFetch(jsonResponse({ data: [{ id: "ent_1" }] }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    const out = await client.listEnterprises();

    expect(out).toEqual({ data: [{ id: "ent_1" }] });
  });

  it("throws an ApiError carrying status, body, and URL on a non-2xx", async () => {
    stubFetch(new Response("forbidden", { status: 403 }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    const err = await client.listWorkspaces("ent_1").catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.body).toBe("forbidden");
    expect(err.path).toBe("/enterprises/ent_1/workspaces");
    expect(err.message).toContain("403");
    expect(err.message).toContain("https://api.example.com/enterprises/ent_1/workspaces");
  });
});

describe("InfracodebaseClient — query/path building", () => {
  it("URL-encodes the iac_tool query param on getWorkspaceContext", async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    await client.getWorkspaceContext("ent_1", "ws_1", "cloud formation");

    expect(lastCall(fetchMock).url).toBe(
      "https://api.example.com/enterprises/ent_1/workspaces/ws_1/context?iac_tool=cloud%20formation"
    );
  });

  it("omits the iac_tool query when no tool is given", async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    await client.getWorkspaceContext("ent_1", "ws_1");

    expect(lastCall(fetchMock).url).toBe(
      "https://api.example.com/enterprises/ent_1/workspaces/ws_1/context"
    );
  });

  it("hits the /latest evaluation when no ref is given, else the ref path", async () => {
    const fetchMock = stubFetch(jsonResponse({}));
    fetchMock.mockImplementation(async () => jsonResponse({})); // fresh body per call
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    await client.getComplianceEvaluation("ent_1", "ws_1");
    expect(lastCall(fetchMock).url).toMatch(/\/compliance\/evaluations\/latest$/);

    fetchMock.mockClear();
    await client.getComplianceEvaluation("ent_1", "ws_1", "abc123");
    expect(lastCall(fetchMock).url).toMatch(/\/compliance\/evaluations\/abc123$/);
  });

  it("fetches findings under the ref evaluation, passing status as a query param", async () => {
    const fetchMock = stubFetch(jsonResponse({ findings: [] }));
    fetchMock.mockImplementation(async () => jsonResponse({ findings: [] })); // fresh body per call
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    // An explicit ref goes straight to that evaluation's findings — no latest lookup.
    await client.listComplianceFindings("ent_1", "ws_1", { ref: "abc", status: "fail" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall(fetchMock).url).toBe(
      "https://api.example.com/enterprises/ent_1/workspaces/ws_1/compliance/evaluations/abc/findings?status=fail"
    );

    // No status -> bare findings path (still under the ref evaluation).
    fetchMock.mockClear();
    await client.listComplianceFindings("ent_1", "ws_1", { ref: "abc" });
    expect(lastCall(fetchMock).url).toMatch(/\/compliance\/evaluations\/abc\/findings$/);
  });

  it("hits the latest-findings alias in a single request when no ref is given", async () => {
    const fetchMock = stubFetch(jsonResponse({ findings: [] }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    await client.listComplianceFindings("ent_1", "ws_1", { status: "pass" });

    // No client-side id resolution — the server resolves `latest`.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall(fetchMock).url).toBe(
      "https://api.example.com/enterprises/ent_1/workspaces/ws_1/compliance/evaluations/latest/findings?status=pass"
    );
  });

  it("surfaces the server 404 when the workspace has no evaluation", async () => {
    const fetchMock = stubFetch(jsonResponse({ code: "evaluation_not_found" }, 404));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    await expect(client.listComplianceFindings("ent_1", "ws_1")).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall(fetchMock).url).toMatch(/\/compliance\/evaluations\/latest\/findings$/);
  });

  it("PATCHes the dedicated /resources endpoint with the add/remove body", async () => {
    const fetchMock = stubFetch(jsonResponse({ workspace_id: "ws_1" }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    await client.updateWorkspaceResources("ent_1", "ws_1", {
      add_ruleset_ids: ["rs_1"],
      remove_workflow_ids: ["wf_2"],
    });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://api.example.com/enterprises/ent_1/workspaces/ws_1/resources");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      add_ruleset_ids: ["rs_1"],
      remove_workflow_ids: ["wf_2"],
    });
  });
});

describe("InfracodebaseClient — verifyToken", () => {
  it("returns the enterprises array on success", async () => {
    stubFetch(jsonResponse({ data: [{ id: "ent_1", name: "Acme" }] }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    expect(await client.verifyToken()).toEqual([{ id: "ent_1", name: "Acme" }]);
  });

  it("falls back to an empty array when the response omits data", async () => {
    stubFetch(jsonResponse({}));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "t" });

    expect(await client.verifyToken()).toEqual([]);
  });

  it("propagates an ApiError on an invalid token (401)", async () => {
    stubFetch(new Response("unauthorized", { status: 401 }));
    const client = new InfracodebaseClient({ baseUrl: "https://api.example.com", token: "bad" });

    await expect(client.verifyToken()).rejects.toBeInstanceOf(ApiError);
  });
});
