# Anime Face Recognition model notices

These models are application assets downloaded by the browser. User videos, decoded frames,
reference crops and character embeddings are never sent to the model authors or any API.

## Anime head detector

- Upstream repository: `deepghs/anime_head_detection`
- Model: `head_detect_v2.0_s_yv11/model.onnx`
- Repository license label: MIT
- Embedded exporter metadata: Ultralytics YOLO11, AGPL-3.0
- Source: https://huggingface.co/deepghs/anime_head_detection

The repository label and embedded exporter notice are both retained here;
the repository label alone does not resolve distribution compatibility.

## Character similarity encoder

- Upstream repository: `deepghs/ccip_onnx`
- Model: `ccip-caformer-24-randaug-pruned/model_feat.onnx`
- License label: OpenRAIL
- Source: https://huggingface.co/deepghs/ccip_onnx

The checked-in GPU encoder is an FP16 conversion with float32 inputs and outputs. The CPU path
uses the same encoder in its native FP32 representation, split into external weight files so every
repository asset stays below GitHub's single-file limit. Both paths follow the upstream CCIP metric
graph and the `ccip-caformer-24-randaug-pruned` threshold metadata. This pruned checkpoint is the
sole character identity encoder in this build.

## Runtime

- ONNX Runtime Web: https://github.com/microsoft/onnxruntime
- License: MIT
