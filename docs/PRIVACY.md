# Privacy foundation

## Current verified behavior

The application accepts a file through a native browser file input and creates an object URL for local video or audio preview. Face Recognition transfers reduced frames only to a worker in the same browser context, loads its model and WASM files from the application origin, and produces matches and exports locally. Music & Bass Markers decodes audio locally, transfers only a bounded mono analysis signal to a worker in the same browser context, and builds marker exports locally. Video Enhancer downloads fixed model/runtime assets from the application origin, restores decoded frames inside its local worker and encodes the MP4 locally. Media is never a model request payload. It does not contain a media upload endpoint, cloud rendering job or analytics integration.

The workspace displays `0 B` as the amount sent through the Cutweave media flow in this build. This is a scoped statement, not a claim that the browser makes no network requests: Next.js still serves application code and assets from localhost.

## Media-plane invariant

Video bytes, decoded frames, thumbnails, waveforms, face crops, local matching data and enhanced frames must not be sent to Cutweave, Vercel, Supabase, analytics providers or any third party.

## Evidence still required

Before a public privacy claim is made, the implemented analysis and export flow still needs automated network interception, request classification, negative upload tests and a documented browser/codec matrix. The visible `0 B` statement is scoped to Cutweave media uploads; it does not count application, model or WASM asset downloads.
