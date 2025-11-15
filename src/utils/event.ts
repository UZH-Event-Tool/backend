import type { Event } from "@prisma/client";

function parseImages(images: string): string[] {
  if (!images) return [];
  try {
    const parsed = JSON.parse(images);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return images.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
}

function stringifyImages(images: string[]): string {
  return JSON.stringify(images);
}

export type EventMeta = {
  registrationCount?: number;
  isRegistered?: boolean;
};

export function toPublicEvent(event: Event & Partial<EventMeta>) {
  const { images, registrationCount, isRegistered, ...rest } = event as Event & EventMeta;
  return {
    ...rest,
    images: parseImages(images),
    registrationCount: registrationCount ?? 0,
    isRegistered: Boolean(isRegistered),
  };
}

export const eventImageStorage = {
  parse: parseImages,
  stringify: stringifyImages,
};
