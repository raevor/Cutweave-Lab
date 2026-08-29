export const en = {
  common: {
    nav: { label: "Main navigation", workflow: "How it works", privacy: "Your files", openLab: "Open tools" },
    footer: { line: "Small tools for the repetitive parts of editing.", status: "Early build · local files only" },
    language: { label: "Choose language", current: "Current language" },
  },
  home: {
    eyebrowA: "Made for editors", eyebrowB: "Runs in your browser",
    titleLead: "Skip the prep.", titleEmphasis: "Get to the edit.",
    lede: "Pick a face, mark the bass hits or clean up soft footage. Cutweave handles the repetitive prep in your browser so you can get back to the actual edit.",
    browseTools: "Choose a tool",
    privacyNote: "The file you choose stays on this device.",
    previewAria: "Cutweave preview with face matches and music markers", previewLinkAria: "Jump to the Face Recognition overview",
    previewJump: "VIEW FACE RECOGNITION",
    previewLabel: "LOCAL PREP / PREVIEW", faceScenes: "MATCHED SCENES", selectedFace: "RECOGNIZED FACE", bassMarkers: "BASS MARKERS",
    scenesFound: "SCENES FOUND", markersFound: "MARKERS", mediaSent: "MEDIA SENT",
    principlesLabel: "What Cutweave is built around",
    principles: ["ONE JOB AT A TIME", "FILES STAY LOCAL", "YOU REVIEW THE RESULT", "EXPORTS YOU CAN USE"],
    toolsEyebrow: "The repetitive part / cut short", toolsTitleA: "Three jobs.", toolsTitleB: "Three focused tools.",
    toolsIntro: "Each tool opens around a result, not an empty timeline. Choose the prep job that is slowing you down and leave with something your editor can use.",
    toolsLabel: "Cutweave local editing tools", localTool: "LOCAL TOOL", inputLabel: "YOU BRING", outputLabel: "YOU TAKE", openTool: "OPEN TOOL",
    previewOutput: "PLANNED RESULT", interfacePreview: "INTERFACE PREVIEW — NO ANALYSIS SHOWN",
    workflowEyebrow: "From source to handoff", workflowTitleA: "A short route.", workflowTitleB: "No mystery steps.",
    workflowIntro: "The same four moves run through every Cutweave tool. The interface changes for the job; the media boundary does not.",
    workflow: [
      { title: "Choose the job", copy: "Open the tool for the result you need instead of setting up another editing project." },
      { title: "Open a local file", copy: "The browser reads the video, song or audio file from this device." },
      { title: "Review the result", copy: "Keep the useful matches or markers, remove the misses and adjust the settings." },
      { title: "Take it to the edit", copy: "Export a clip, scene list or marker data you can continue using in your editor." },
    ],
    localEyebrow: "The media path / by design", localTitleA: "Your file takes", localTitleB: "the short route.",
    localCopy: "Cutweave is designed so the working media moves from your device into the browser workspace and back to a local export. A cloud copy is not part of that route.",
    localLink: "See exactly what stays local",
    routeTitle: "MEDIA PATH / CURRENT ARCHITECTURE", routeStatus: "ON-DEVICE BOUNDARY", routeAria: "The local media path from device to browser workspace and local export",
    routeDevice: "YOUR DEVICE", routeFile: "SOURCE FILE", routeBrowser: "THIS TAB", routeWorkspace: "BROWSER WORKSPACE", routeExport: "LOCAL EXPORT",
    routeCloud: "CLOUD MEDIA BUCKET", routeCloudStatus: "NOT IN THE MEDIA PATH",
    localFacts: ["NO MEDIA UPLOAD ROUTE", "NO INSTALLER", "ACCOUNT OPTIONAL"],
  },
  library: {
    eyebrowA: "Three focused tools", eyebrowB: "No blank timeline", titleA: "What do you want", titleB: "done first?",
    intro: "You do not need another full editing app. Choose the result you want, add a local file and review what Cutweave finds.",
    localNote: "Your media stays in this tab", toolsLabel: "Cutweave editing tools", cardLabel: "LOCAL TOOL", openTool: "OPEN",
  },
  tools: {
    "face-recognition": {
      title: "Face Recognition", shortTitle: "Find one face across the video", eyebrow: "Faces / scene finding",
      description: "Choose a face from the video. Cutweave recognizes where the same face appears again and lists those scenes for review. Everything runs locally; it does not search the internet for the person's identity.",
      promise: "Stop scrubbing through the whole video just to find one person.", input: "One local video", output: "Face-matched scenes + timecodes",
      anatomy: "PREVIEW / FACE RECOGNITION", anatomyOutput: "MATCHES READY TO REVIEW",
      results: ["A face picker built from local frames", "Scenes where the chosen face appears", "Timecodes you can correct before export", "A scene list ready for the next editing step"],
    },
    "bass-markers": {
      title: "Music & Bass Markers", shortTitle: "Put the hits on the timeline", eyebrow: "Music / bass and impact points",
      description: "Add a song, audio file or video. Cutweave listens for the hits that matter to an edit and places adjustable markers on the timeline.",
      promise: "Let the rhythm points arrive before you start cutting.", input: "Local song, audio or video", output: "Adjustable timeline markers",
      anatomy: "PREVIEW / MUSIC & BASS MARKERS", anatomyOutput: "HITS READY TO ADJUST",
      results: ["Bass and strong-impact marker candidates", "Sensitivity and minimum-gap controls", "Markers you can move, remove or add", "Marker data prepared for export"],
    },
    "clarity-boost": {
      title: "Video Enhancer", shortTitle: "Bring back useful detail", eyebrow: "Picture / denoise, detail and upscale",
      description: "Give soft or noisy footage a cleaner preview, then choose how far to sharpen, denoise or upscale it. The original file remains untouched.",
      promise: "Rescue a usable shot before you give up on it.", input: "One local video", output: "Enhanced clip + comparison",
      anatomy: "PREVIEW / BEFORE & AFTER", anatomyOutput: "DETAIL READY TO COMPARE",
      results: ["A true before-and-after preview", "Noise cleanup and detail controls", "Upscale choices matched to the device", "An enhanced local export with the original untouched"],
    },
  },
  focused: {
    navLabel: "Tool navigation", before: "BEFORE", after: "AFTER", markerAxisLabel: "TIMECODE / MARKER CANDIDATES",
    localFoundation: "Runs on this device", allTools: "All tools", privacy: "Your files", input: "YOU ADD", output: "YOU GET",
    mediaBoundary: "YOUR FILE", zeroSent: "STAYS HERE", noUpload: "Cutweave opens the file in this tab; it is not sent to our servers.",
    browserPreflight: "Can this browser run it?", chooseSource: "CHOOSE A FILE TO START", sourceReady: "FILE READY", analysisOffline: "TOOL ENGINE COMING NEXT",
    localIntake: "STEP 01 / CHOOSE A FILE", chooseSuffix: "The file opens only in this tab.", chooseVideo: "Choose a video", chooseMedia: "Choose audio or video",
    localSource: "FILE", size: "SIZE", nextStep: "CURRENT STATUS", pipelineSpike: "PREVIEW READY", clearSource: "Remove file",
    sourceReadyLead: "Your file is open.", pipelinePending: "This screen can preview the file, but the processing engine is not connected yet. Nothing has been analyzed or enhanced.", analyzeLocally: "Run locally",
    resultContract: "When the tool is ready", resultTitle: "What you will be able to take with you.",
  },
  privacy: {
    eyebrow: "Your file is not an upload", titleA: "The edit stays", titleB: "on your machine.",
    intro: "Cutweave needs access to the file you choose, not ownership of it. The browser does the media work; our servers do not need a copy of your footage.",
    browseTools: "Choose a local tool", boundaryLabel: "How Cutweave handles your files",
    boundaries: [
      { title: "Your footage stays here", copy: "Video bytes, decoded frames, face crops, waveforms and enhanced previews remain on your device." },
      { title: "An account should know very little", copy: "If accounts are added later, they may store preferences and project labels—not the media itself." },
      { title: "We do not need your footage", copy: "Cutweave is not designed with media upload routes, cloud rendering jobs or content-based tracking." },
    ],
    statusTitle: "What works today", statusCopy: "The current build can open and preview a local file without a media upload route. The three processing engines are still being built, so the interface never pretends that an analysis has run.",
  },
  notFound: { eyebrow: "404 / Wrong turn", titleA: "That tool is", titleB: "not here.", home: "Go back to the tools" },
};

type MessageShape<T> = T extends string
  ? string
  : T extends Array<infer U>
    ? Array<MessageShape<U>>
    : T extends object
      ? { [K in keyof T]: MessageShape<T[K]> }
      : T;

export type Messages = MessageShape<typeof en>;
