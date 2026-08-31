import { openUrl } from "@tauri-apps/plugin-opener";

const urls = {
  source: "https://github.com/YuLeo926/veilsend",
  releases: "https://github.com/YuLeo926/veilsend/releases",
  security: "https://github.com/YuLeo926/veilsend/security",
} as const;

export type ProjectLink = keyof typeof urls;

export const projectUrl = (kind: ProjectLink) => urls[kind];

export const openProjectLink = (kind: ProjectLink) => openUrl(projectUrl(kind));
