import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import type { Core } from "./core.js";
import { PORT, TOKEN_FILE } from "./server.js";

// The task id of the slow call in progress, sent along so the owner process keeps the answer (see heldTasks).
export const taskContext = new AsyncLocalStorage<string>();

// Used when another flow-mcp process (Studio or a second Claude client) already owns the Flow tab and queue.
async function call(method: string, args: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-flow-token": readFileSync(TOKEN_FILE, "utf8").trim(),
      ...(taskContext.getStore() ? { "x-flow-task": taskContext.getStore() } : {}),
    },
    body: JSON.stringify(args ?? {}),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `flow-mcp owner process answered ${res.status}`);
  return data;
}

// Answers the owner process kept for slow calls made by tool processes that have since exited. Apps that start one
// tool process per call (Paperclip) kill it right after the reply, so a still_working task id is only useful if the
// owner holds the result.
export async function heldTasks(ids: string[]): Promise<{ tasks: (Record<string, unknown> | null)[] }> {
  return (await call("task_results", { ids })) as { tasks: (Record<string, unknown> | null)[] };
}

export class RemoteCore implements Core {
  status = (a: unknown) => call("status", a);
  generate = (a: unknown) => call("generate", a);
  cancel = (a: unknown) => call("cancel", a);
  retry = (a: unknown) => call("retry", a);
  assets = (a: unknown) => call("assets", a);
  download = (a: unknown) => call("download", a);
  assemble = (a: unknown) => call("assemble", a);
  techniques = (a: unknown) => call("techniques", a);
  voices = () => call("voices", {});
  narrate = (a: unknown) => call("narrate", a);
  character = (a: unknown) => call("character", a);
  characters = () => call("characters", {});
  character_edit = (a: unknown) => call("character_edit", a);
  edit = (a: unknown) => call("edit", a);
  trash = (a: unknown) => call("trash", a);
  discard = (a: unknown) => call("discard", a);
  set_key = (a: unknown) => call("set_key", a);
  continue_shot = (a: unknown) => call("continue_shot", a);
  agent = (a: unknown) => call("agent", a);
  outputs = () => call("outputs", {});
  transcribe = (a: unknown) => call("transcribe", a);
  caption_preview = (a: unknown) => call("caption_preview", a);
  captions = (a: unknown) => call("captions", a);
  caption_setup = () => call("caption_setup", {});

  // Long waits are split up so no single HTTP request outlives fetch's header timeout.
  async wait(a: { job_ids?: string[]; timeout_seconds: number }): Promise<unknown> {
    const deadline = Date.now() + a.timeout_seconds * 1000;
    for (;;) {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      const out = (await call("wait", { ...a, timeout_seconds: Math.max(5, Math.min(120, left)) })) as { finished: boolean };
      if (out.finished || left <= 120) return out;
    }
  }
}
