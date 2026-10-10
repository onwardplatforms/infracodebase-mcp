/**
 * `infracodebase init`: sign in, then wire the server into the user's MCP
 * clients, in one interactive pass. Safe to re-run: a working saved login is
 * reused and clients already set up for this instance are left alone.
 */

import os from "node:os";
import { styleText } from "node:util";
import * as prompts from "@clack/prompts";
import { ApiError, InfracodebaseClient, type Identity } from "../client.js";
import { DEFAULT_API_URL } from "../config.js";
import {
  AuthSessionError,
  createStoredOAuthTokenProvider,
  login,
} from "../oauth.js";
import {
  clientsFor,
  normalizeApiUrl,
  systemSetupEnv,
  type McpClient,
  type ServerLaunch,
  type SetupEnv,
} from "./clients.js";
import { hyperlink, supportsHyperlinks, useNeutralColors } from "./theme.js";

const TRY_IT = [
  "Try it: open any repo with infrastructure code and ask your agent:",
  '"Check this repo against our rulesets."',
];

/** Secondary text: still readable, but steps back from what the user needs to act on. */
function dim(text: string): string {
  return styleText("dim", text);
}

export interface InitOptions {
  apiUrl: string;
  noOpen: boolean;
  /** Client ids from `--client`; skips the picker when set. */
  clientIds?: string[];
}

/**
 * What every client is told to run. The API URL is pinned so login and server
 * always agree. On Windows `npx` is a .cmd shim that MCP clients cannot start
 * without a shell, so it runs through `cmd /c`.
 */
export function serverLaunch(apiUrl: string, platform: NodeJS.Platform): ServerLaunch {
  const args = ["-y", "@infracodebase/mcp@latest"];
  if (apiUrl !== DEFAULT_API_URL) args.push("--api-url", apiUrl);
  return platform === "win32" ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args };
}

/** Split `--client a,b` into known clients, reporting any id we do not support. */
export function parseClientIds(
  ids: string[],
  platform: NodeJS.Platform
): { clients: McpClient[]; unknown: string[] } {
  const available = clientsFor(platform);
  const clients: McpClient[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const client = available.find((candidate) => candidate.id === id);
    if (client) {
      if (!clients.includes(client)) clients.push(client);
    } else {
      unknown.push(id);
    }
  }
  return { clients, unknown };
}

function clientIdList(platform: NodeJS.Platform): string {
  return clientsFor(platform)
    .map((client) => client.id)
    .join(", ");
}

function identityClient(apiUrl: string): InfracodebaseClient {
  return new InfracodebaseClient({
    baseUrl: apiUrl,
    getAccessToken: createStoredOAuthTokenProvider(apiUrl),
    authKind: "oauth",
  });
}

/** The saved login's identity, or null when the user needs to sign in. */
async function existingIdentity(apiUrl: string): Promise<Identity | null> {
  try {
    return await identityClient(apiUrl).verifyToken();
  } catch (error) {
    if (error instanceof AuthSessionError && error.kind !== "transient") return null;
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

function describeIdentity(identity: Identity): string {
  const who = identity.email ? `Signed in as ${identity.email}` : "Signed in";
  const names = identity.enterprises.flatMap((enterprise) => (enterprise.name ? [enterprise.name] : []));
  if (names.length === 1) return `${who} (${names[0]})`;
  if (names.length > 1) return `${who} (${names.length} enterprises)`;
  return who;
}

/**
 * The sign-in URL is long and wraps across several lines. When the browser
 * opens on its own it is only a fallback, so show a short clickable form where
 * the terminal supports links. With --no-open it is the only way in, so show it
 * whole.
 */
function signInMessage(url: string, noOpen: boolean): string {
  if (noOpen) return `Open this URL to sign in:\n${url}`;
  const { origin, pathname } = new URL(url);
  const shown = supportsHyperlinks(process.env) ? hyperlink(`${origin}${pathname}?…`, url) : url;
  return `Opening your browser to sign in…\n${dim(`(or open this URL: ${shown})`)}`;
}

async function signIn(options: InitOptions): Promise<Identity> {
  const saved = await existingIdentity(options.apiUrl);
  if (saved) {
    prompts.log.success(`${describeIdentity(saved)} ${dim("· saved login")}`);
    return saved;
  }

  const waiting = prompts.spinner();
  await login(options.apiUrl, {
    onAuthorizationUrl: (url) => {
      prompts.log.step(signInMessage(url, options.noOpen));
      waiting.start("Waiting for you to approve access in the browser");
    },
    openBrowser: options.noOpen ? async () => undefined : undefined,
  }).catch((error: unknown) => {
    waiting.error("Sign-in did not finish");
    throw error;
  });
  const identity = await identityClient(options.apiUrl).verifyToken();
  waiting.clear();
  prompts.log.success(describeIdentity(identity), { spacing: 0 });
  return identity;
}

/**
 * Whether a client already has an infracodebase entry: none, one for this
 * instance, or one pointed at a different instance (for example SaaS when
 * setting up a dedicated deployment).
 */
export type ClientStatus = "missing" | "current" | "other-instance";

export interface ClientState {
  client: McpClient;
  detected: boolean;
  status: ClientStatus;
  /** The instance an existing entry points at. */
  existingApiUrl?: string;
}

function hostOf(apiUrl: string): string {
  return new URL(apiUrl).host;
}

export interface PickerPlan {
  /** Already configured for this instance; reported and left alone. */
  current: McpClient[];
  /** Everything else, in display order. */
  choices: Array<{ client: McpClient; hint?: string; preselected: boolean }>;
  /** True when every installed client is already set up, so there is nothing to suggest. */
  nothingToSuggest: boolean;
}

/**
 * Decide what the picker shows. Detected clients that are not set up yet are
 * pre-checked. A client pointed at another instance is shown but never
 * pre-checked, because switching it moves that client off the other instance.
 */
export function planPicker(states: ClientState[]): PickerPlan {
  const otherHost = (state: ClientState) =>
    state.status === "other-instance" && state.existingApiUrl
      ? `uses ${hostOf(state.existingApiUrl)}`
      : undefined;
  const current = states.filter((state) => state.status === "current").map((state) => state.client);
  const choices = states
    .filter((state) => state.status !== "current")
    .map((state) => ({
      client: state.client,
      hint: otherHost(state) ?? (state.detected ? "detected" : undefined),
      preselected: state.detected && state.status === "missing",
    }));
  return {
    current,
    choices,
    nothingToSuggest: current.length > 0 && !choices.some((choice) => choice.preselected),
  };
}

async function inspectClients(env: SetupEnv, apiUrl: string, clients: McpClient[]): Promise<ClientState[]> {
  return Promise.all(
    clients.map(async (client): Promise<ClientState> => {
      const existingApiUrl = await client.existingApiUrl(env);
      const status: ClientStatus =
        existingApiUrl === undefined
          ? "missing"
          : existingApiUrl === normalizeApiUrl(apiUrl)
            ? "current"
            : "other-instance";
      return { client, detected: await client.detect(env), status, existingApiUrl };
    })
  );
}

function cancelled(): never {
  prompts.cancel("Setup cancelled. Your login is saved; no clients were changed.");
  process.exit(0);
}

function listOf(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function labels(clients: McpClient[]): string {
  return listOf(clients.map((client) => client.label));
}

/** End on what to do next, indented to line up under the first line. */
function finish(lines: string[]): void {
  prompts.outro(lines.map((line, index) => (index === 0 || line === "" ? line : `   ${line}`)).join("\n"));
}

/** The clients to configure now, plus how many were already set up. */
async function chooseClients(
  env: SetupEnv,
  options: InitOptions
): Promise<{ clients: McpClient[]; alreadySetUp: number }> {
  if (options.clientIds) {
    const { clients, unknown } = parseClientIds(options.clientIds, env.platform);
    if (unknown.length > 0) {
      throw new Error(`Unknown client: ${unknown.join(", ")}. Choose from ${clientIdList(env.platform)}.`);
    }
    const states = await inspectClients(env, options.apiUrl, clients);
    const current = states.filter((state) => state.status === "current").map((state) => state.client);
    if (current.length > 0) prompts.log.info(`Already set up: ${labels(current)}`);
    return {
      clients: states.filter((state) => state.status !== "current").map((state) => state.client),
      alreadySetUp: current.length,
    };
  }

  const states = await inspectClients(env, options.apiUrl, clientsFor(env.platform));
  const plan = planPicker(states);
  if (plan.current.length > 0) prompts.log.info(`Already set up: ${labels(plan.current)}`);
  // Picker hints only show on checked or focused rows, so say this up front.
  for (const state of states) {
    if (state.status === "other-instance" && state.existingApiUrl) {
      prompts.log.warn(
        `${state.client.label} uses ${hostOf(state.existingApiUrl)}. Select it below to switch it to ${hostOf(options.apiUrl)}.`
      );
    }
  }
  const none = { clients: [], alreadySetUp: plan.current.length };
  if (plan.choices.length === 0) return none;

  if (plan.nothingToSuggest) {
    const more = await prompts.confirm({ message: "Add Infracodebase to another client?", initialValue: false });
    if (prompts.isCancel(more)) cancelled();
    if (!more) return none;
  }

  const anyDetected = plan.current.length > 0 || plan.choices.some((choice) => choice.hint);
  const selected = await prompts.multiselect({
    message: anyDetected
      ? "Which MCP clients should use Infracodebase?"
      : "No MCP clients found. Which ones do you use?",
    options: plan.choices.map((choice) => ({
      value: choice.client.id,
      label: choice.client.label,
      hint: choice.hint,
    })),
    initialValues: plan.choices.filter((choice) => choice.preselected).map((choice) => choice.client.id),
    required: false,
  });
  if (prompts.isCancel(selected)) cancelled();
  return {
    clients: plan.choices.map((choice) => choice.client).filter((client) => selected.includes(client.id)),
    alreadySetUp: plan.current.length,
  };
}

export async function runInit(options: InitOptions): Promise<void> {
  const restoreColors = useNeutralColors(process.stdout);
  try {
    await setUp(options);
  } finally {
    restoreColors();
  }
}

async function setUp(options: InitOptions): Promise<void> {
  if (!options.clientIds && !(process.stdin.isTTY && process.stdout.isTTY)) {
    throw new Error(
      `init needs a terminal to ask which MCP clients to set up. Pass --client with one or more of: ${clientIdList(process.platform)}.`
    );
  }

  const env = systemSetupEnv(os.homedir());
  const origin = new URL(options.apiUrl).origin;
  const docsUrl = `${origin}/docs/developers/mcp`;

  prompts.intro(`Infracodebase MCP setup · ${new URL(origin).host}`);
  await signIn(options);

  const { clients, alreadySetUp } = await chooseClients(env, options);
  if (clients.length === 0) {
    if (alreadySetUp > 0) finish([...TRY_IT, "", dim(`Docs: ${docsUrl}`)]);
    else finish(["No clients changed. You're signed in, so run init again to add one.", dim(`Docs: ${docsUrl}`)]);
    return;
  }

  const launch = serverLaunch(options.apiUrl, env.platform);
  // One row per client, names in a column so the results scan down the left.
  const width = Math.max(...clients.map((client) => client.label.length));
  const manual: string[] = [];
  for (const [index, client] of clients.entries()) {
    const result = await client.install(env, launch);
    const row = { spacing: index === 0 ? 1 : 0 };
    const name = client.label.padEnd(width);
    if (result.ok) {
      const detail = result.restart
        ? `${dim(`${result.detail}.`)} Restart ${client.label} to load it.`
        : dim(result.detail);
      prompts.log.success(`${name}  ${detail}`, row);
    } else {
      prompts.log.error(`${name}  ${result.detail}`, row);
      manual.push(`${client.label}\n${result.manual}`);
    }
  }

  if (manual.length > 0) prompts.note(manual.join("\n\n"), "Finish these by hand");
  if (process.env.INFRACODEBASE_TOKEN) {
    prompts.log.warn(
      "INFRACODEBASE_TOKEN is set in this shell. If your MCP client also sets it, that token is used instead of this login."
    );
  }

  const configured = clients.length - manual.length;
  if (configured === 0 && alreadySetUp === 0) {
    finish(["Nothing was set up. Finish the steps above by hand, then restart your client.", dim(`Docs: ${docsUrl}`)]);
    process.exitCode = 1;
    return;
  }

  finish([...TRY_IT, "", dim(`Docs: ${docsUrl}`)]);
}
