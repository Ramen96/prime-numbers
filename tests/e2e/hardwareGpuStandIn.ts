// SwiftShader dressed up as a hardware GPU, for gpuStripping.spec.ts (step 11f).
//
// The site refuses software adapters (lib/gpuAdapter.ts), and headless Chromium's
// only adapter is SwiftShader, which says so (architecture "swiftshader",
// isFallbackAdapter true). These tests want the GPU path itself, so every page
// and worker here sees an adapter that says it's hardware, while SwiftShader still
// does the work. Nothing in the app changes: the patch goes in from outside.
//
// Pages get it as an init script. Workers, including the GPU worker that the
// prime and checker workers start, are out of Playwright's reach, so this talks
// to Chromium's DevTools protocol directly (Playwright's own CDP session can't
// address a worker's session): each new worker is caught as it starts, stopped
// just before its first script runs (WebGPU's interfaces don't exist yet while it
// waits at the start), patched, and let go. gpuSoftwareOnly.spec.ts checks the
// same browser without this, as a visitor would get it.

import { test as base, type Browser } from "@playwright/test";

/** Makes every GPUAdapterInfo read as a hardware adapter, in whatever global it runs. */
const HARDWARE_STAND_IN = `(() => {
  if (typeof GPUAdapterInfo === "undefined") return;
  for (const [name, value] of [["vendor", "stand-in"], ["architecture", "stand-in-hardware"], ["device", ""], ["description", ""], ["isFallbackAdapter", false]])
    Object.defineProperty(GPUAdapterInfo.prototype, name, { configurable: true, get: () => value });
})()`;

/** What every page and worker auto-attaches to: workers only, each one held until it's patched. */
const ATTACH_TO_WORKERS = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "worker" }, { type: "page", exclude: true }] };

/** Each Playwright worker's browser gets a port of its own. */
const FIRST_DEBUGGING_PORT = 9300;

interface ProtocolMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: { sessionId?: string; targetInfo?: { type: string; targetId: string } };
}

/** Patches every worker of every page in the browser listening on `port`, until the returned function closes it. */
async function patchEveryWorker(port: number): Promise<() => void> {
  const { webSocketDebuggerUrl } = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const send = (method: string, params: object = {}, sessionId?: string) =>
    socket.send(JSON.stringify({ id: nextId++, method, params, ...(sessionId && { sessionId }) }));

  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data)) as ProtocolMessage;
    const { method, params, sessionId } = message;
    if (method === "Target.targetCreated" && params?.targetInfo?.type === "page") {
      send("Target.attachToTarget", { targetId: params.targetInfo.targetId, flatten: true });
    } else if (method === "Target.attachedToTarget" && params?.sessionId) {
      // a page: watch for its workers; a worker: for its own, and stop it at its first script
      send("Target.setAutoAttach", ATTACH_TO_WORKERS, params.sessionId);
      if (params.targetInfo?.type === "worker") {
        send("Debugger.enable", {}, params.sessionId);
        send("Debugger.setInstrumentationBreakpoint", { instrumentation: "beforeScriptExecution" }, params.sessionId);
        send("Runtime.runIfWaitingForDebugger", {}, params.sessionId);
      }
    } else if (method === "Debugger.paused" && sessionId) {
      send("Runtime.evaluate", { expression: HARDWARE_STAND_IN }, sessionId);
      send("Debugger.resume", {}, sessionId);
      send("Debugger.disable", {}, sessionId); // and its breakpoint with it, so later scripts run straight on
    }
  });
  send("Target.setDiscoverTargets", { discover: true });
  return () => socket.close();
}

export const test = base.extend<object, { browser: Browser }>({
  browser: [
    async ({ playwright, launchOptions }, provide, workerInfo) => {
      const port = FIRST_DEBUGGING_PORT + workerInfo.parallelIndex;
      const browser = await playwright.chromium.launch({ ...launchOptions, args: [...(launchOptions.args ?? []), `--remote-debugging-port=${port}`] });
      const stopPatching = await patchEveryWorker(port);
      await provide(browser);
      stopPatching();
      await browser.close();
    },
    { scope: "worker" },
  ],
  // `provide` is Playwright's `use`, renamed so React's hook rules don't take it for theirs
  context: async ({ context }, provide) => {
    await context.addInitScript(HARDWARE_STAND_IN);
    await provide(context);
  },
});

export { expect } from "@playwright/test";
