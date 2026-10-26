/// <reference lib="webworker" />

import { AutoModel, AutoProcessor, env, RawImage, type PreTrainedModel, type Processor, type ProgressInfo, type Tensor } from "@huggingface/transformers";
import type { RemoverEngine, RemoverWorkerRequest, RemoverWorkerResponse } from "@/lib/background-remover/types";

const workerScope = self as DedicatedWorkerGlobalScope;

/*
 * BiRefNet lite (MIT), pinned so every visitor gets the same weights. The official
 * ONNX export cannot run on WebGPU (its Split nodes need more storage buffers than
 * a shader stage allows), so the GPU path uses an MIT re-export with the same
 * weights and a rewritten graph. The CPU path keeps the official export.
 */
const MODELS = {
  gpu: { id: "jiabins0303/birefnet-lite-1024-webgpu", revision: "1ad01cef0f4101a285c5a3e0bd7f15597d93403f" },
  cpu: { id: "onnx-community/BiRefNet_lite-ONNX", revision: "de15b22ba131738a16dff04aab8bdf8dc32e3ac1" },
} as const;

// Only model files come from Hugging Face. The ONNX Runtime files are the ones Auto Subtitles serves.
env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL("/wasm/auto-subtitles/ort-wasm-simd-threaded.asyncify.mjs", workerScope.location.origin).href,
    wasm: new URL("/wasm/auto-subtitles/ort-wasm-simd-threaded.asyncify.wasm", workerScope.location.origin).href,
  };
}

let loaded: { key: string; model: PreTrainedModel; processor: Processor } | null = null;

function post(response: RemoverWorkerResponse) {
  workerScope.postMessage(response);
}

async function load(engine: RemoverEngine, jobId: string) {
  const key = engine;
  if (loaded?.key === key) return loaded;
  await loaded?.model.dispose();
  loaded = null;

  const files = new Map<string, { loaded: number; total: number }>();
  let lastProgressAt = 0;
  const progress_callback = (info: ProgressInfo) => {
    if (info.status !== "progress") return;
    files.set(info.file, { loaded: info.loaded, total: info.total });
    const now = performance.now();
    if (now - lastProgressAt < 120) return;
    lastProgressAt = now;
    let done = 0;
    let total = 0;
    files.forEach((file) => { done += file.loaded; total += file.total; });
    post({ type: "model-progress", jobId, loaded: done, total });
  };

  const source = MODELS[engine];
  const model = await AutoModel.from_pretrained(source.id, {
    revision: source.revision,
    device: engine === "gpu" ? "webgpu" : "wasm",
    // The GPU file is already fp16; naming it directly stops the library adding a dtype suffix.
    ...(engine === "gpu" ? { dtype: "fp32" as const, model_file_name: "model_fp16" } : { dtype: "fp32" as const }),
    progress_callback,
  });
  const processor = await AutoProcessor.from_pretrained(source.id, { revision: source.revision });
  loaded = { key, model, processor };
  return loaded;
}

async function remove(request: RemoverWorkerRequest) {
  const started = performance.now();
  const { model, processor } = await load(request.engine, request.jobId);
  post({ type: "processing", jobId: request.jobId });
  const image = new RawImage(new Uint8ClampedArray(request.pixels), request.width, request.height, 4);
  const { pixel_values } = await processor(image.rgb());
  const { output_image } = await model({ input_image: pixel_values }) as { output_image: Tensor };
  // The model works at 1024 x 1024; the matte is scaled back to the image's own size.
  const first = (output_image as unknown as Tensor[])[0];
  const matte = await RawImage.fromTensor(first.sigmoid().mul(255).to("uint8")).resize(request.width, request.height);
  const mask = new Uint8Array(matte.data);
  post({ type: "result", jobId: request.jobId, mask: mask.buffer, width: request.width, height: request.height, seconds: (performance.now() - started) / 1000 });
}

workerScope.onmessage = (event: MessageEvent<RemoverWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "remove") return;
  remove(request).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    post({
      type: "error",
      jobId: request.jobId,
      message: /fetch|network/i.test(message)
        ? "The background model could not be downloaded. Check the connection and try again; your image was not sent anywhere."
        : `Background removal stopped: ${message}`,
    });
  });
};

export {};
