# Architecture foundation

## Runtime boundary

```text
Browser media plane
  local File → object URL preview → future worker pipeline → future local export

Web control plane
  Next.js routes → static application assets → future optional account/preferences
```

The media plane and control plane must remain separate in code, networking and data models.

## Current implementation

- Next.js App Router, React and strict TypeScript.
- Tailwind CSS v4 plus project-owned OKLCH tokens and semantic CSS.
- `/lab` is the server-rendered tool library. Focused client tool routes own browser file handles, object URLs and capability detection while revealing only the controls required for that job.
- Object URLs are revoked when the selected source changes or the component unmounts.
- There is no backend, database, authentication or upload route in this foundation.

## Planned adapter boundaries

Processing will be introduced behind explicit adapters for capability detection, demux/decode, local face matching and scene selection, music/bass analysis, video enhancement, export and privacy instrumentation. WebGPU acceleration cannot become a core-flow requirement; a WASM/CPU fallback must exist before a tool is considered complete.

All focused tools will share the same local project and decode cache. Tool-first navigation must not cause the browser to upload media or decode the same source independently for every tool.
