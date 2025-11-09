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

export function toPublicEvent(event: Event) {
  const { images, ...rest } = event;
  return {
    ...rest,
    images: parseImages(images),
  };
}

export const eventImageStorage = {
  parse: parseImages,
  stringify: stringifyImages,
};
