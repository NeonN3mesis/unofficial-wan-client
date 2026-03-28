export const upstreamChatFixture = [
  {
    id: "chat-001",
    authorName: "Rina",
    authorRole: "member" as const,
    body: "Low-latency custom client is already a better control room than keeping three browser tabs open.",
    accentColor: "#f59e0b",
    sentAt: "2026-03-27T23:36:00.000Z"
  },
  {
    id: "chat-002",
    authorName: "Signal Ops",
    authorRole: "system" as const,
    body: "Fixture relay online. Replace with captured Floatplane chat traffic when the upstream join flow is mapped.",
    accentColor: "#94a3b8",
    sentAt: "2026-03-27T23:36:05.000Z"
  },
  {
    id: "chat-003",
    authorName: "Maya",
    authorRole: "moderator" as const,
    body: "Read-side chat is stable; send-side should stay behind the capability flag until the real endpoint is verified.",
    accentColor: "#fb7185",
    sentAt: "2026-03-27T23:36:14.000Z"
  }
];

