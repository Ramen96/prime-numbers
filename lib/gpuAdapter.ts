/// <reference types="@webgpu/types" />
// Which WebGPU adapters count as a GPU (CLAUDE.md, step 11f). A software adapter
// runs the shader on the processor itself, so stripping there only takes time from
// the CPU's own proofs: on Linux, Chromium with --enable-unsafe-webgpu handed the
// site SwiftShader, and a 300-digit random prime took 21 s against about 14 s on
// the CPU. So a fallback adapter, or one that names a known software renderer,
// counts as no adapter at all: the switch is greyed out and the CPU does everything.

/** Software renderers, as they appear in an adapter's vendor, architecture, device or description. */
export const SOFTWARE_RENDERER_NAMES = ["swiftshader", "llvmpipe", "lavapipe", "softpipe", "microsoft basic render driver", "warp"];

/** What's read from an adapter: its info, and the flag older browsers kept on the adapter itself. */
export interface AdapterDescription {
  info?: Partial<Pick<GPUAdapterInfo, "vendor" | "architecture" | "device" | "description" | "isFallbackAdapter">>;
  isFallbackAdapter?: boolean;
}

/**
 * Whether the adapter runs on the processor. Empty names count as hardware: a
 * browser that hides them gives empty strings, and taking those for software
 * would turn the GPU off everywhere such a browser runs.
 */
export function isSoftwareAdapter(adapter: AdapterDescription): boolean {
  const info = adapter.info ?? {};
  if (info.isFallbackAdapter === true || adapter.isFallbackAdapter === true) return true;
  const names = [info.vendor, info.architecture, info.device, info.description].map((name) => (name ?? "").toLowerCase());
  return names.some((name) => SOFTWARE_RENDERER_NAMES.some((software) => name.includes(software)));
}

/** The browser's adapter if it's a hardware one, else null (none, or a software one). */
export async function requestHardwareAdapter(gpu: GPU | undefined): Promise<GPUAdapter | null> {
  const adapter = await gpu?.requestAdapter();
  if (!adapter) return null;
  return isSoftwareAdapter(adapter as unknown as AdapterDescription) ? null : adapter;
}
