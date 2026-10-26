# Privacy foundation

## Current verified behavior

The application accepts a file through a native browser file input and creates an object URL for local video or audio preview. Face Recognition transfers reduced frames only to a worker in the same browser context, loads its model and WASM files from the application origin, and produces matches and exports locally. Music & Bass Markers decodes audio locally, transfers only a bounded mono analysis signal to a worker in the same browser context, and builds marker exports locally. Auto Subtitles decodes the soundtrack locally and transfers 16 kHz mono speech samples only to a worker in the same browser context; its Whisper model files (`onnx-community/whisper-base.en_timestamped`) are fetched from Hugging Face (`huggingface.co`, pinned revision) and cached by the browser, while its ONNX Runtime WASM files come from the application origin. Background Remover reads the chosen image locally and transfers its pixels only to a worker in the same browser context; its background model files (BiRefNet lite on GPU, ormbg on CPU) are fetched from Hugging Face at pinned revisions and cached by the browser, and the cut-out and matte are drawn and exported in the tab. Music & Bass Markers encodes its MP3 export in the tab as well. These model downloads are the only third-party requests the tools make, and they carry no media. Media is never a model request payload. It does not contain a media upload endpoint, cloud rendering job or analytics integration.

The workspace displays `0 B` as the amount sent through the Cutweave media flow in this build. This is a scoped statement, not a claim that the browser makes no network requests: Next.js still serves application code and assets from the application origin, whether on localhost or the deployed site.

## Media-plane invariant

Video bytes, decoded frames, thumbnails, waveforms, face crops, and local matching data must not be sent to Cutweave, Vercel, Supabase, analytics providers or any third party.

## Evidence still required

Before a public privacy claim is made, the implemented analysis and export flow still needs automated network interception, request classification, negative upload tests and a documented browser/codec matrix. The visible `0 B` statement is scoped to Cutweave media uploads; it does not count application, model or WASM asset downloads.
