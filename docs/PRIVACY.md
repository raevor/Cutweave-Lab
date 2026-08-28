# Privacy foundation

## Current verified behavior

The foundation accepts a file through a native browser file input and creates an object URL for local video preview. It does not contain a media upload endpoint, cloud rendering job or analytics integration.

The workspace displays `0 B` as the amount sent through the Cutweave media flow in this build. This is a scoped statement, not a claim that the browser makes no network requests: Next.js still serves application code and assets from localhost.

## Media-plane invariant

Video bytes, decoded frames, thumbnails, waveforms, face crops, local matching data and enhanced frames must not be sent to Cutweave, Vercel, Supabase, analytics providers or any third party.

## Evidence still required

Before a public privacy claim is made, the implemented analysis and export flow will need automated network interception, request classification, negative upload tests and a documented browser/codec matrix. The visible Privacy Monitor will report only instrumented and independently tested behavior.
