import type { NextFunction, Response } from "express";
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, type AuthenticatedRequest } from "../utils/requireAuth";
import { eventImageStorage, toPublicEvent } from "../utils/event";

const router = Router();

const EVENT_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "event-images");

function ensureUploadDir() {
  fs.mkdirSync(EVENT_UPLOAD_ROOT, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, EVENT_UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    const userId = (req as AuthenticatedRequest).user?.sub ?? "user";
    cb(null, `${userId}-${Date.now()}${ext}`);
  },
});

function cleanupFiles(files: Express.Multer.File[] | undefined) {
  if (!files) {
    return;
  }
  files.forEach((file) => {
    fs.unlink(file.path, () => undefined);
  });
}

function deleteStoredImageFiles(imagePaths: string[]) {
  imagePaths.forEach((relativePath) => {
    const absolute = path.join(process.cwd(), relativePath.replace(/^\//, ""));
    fs.unlink(absolute, () => undefined);
  });
}

function validateSchedule(
  startsAt: Date,
  registrationDeadline: Date,
  now: Date
): string | null {
  if (startsAt.getTime() <= now.getTime()) {
    return "Event time must be in the future";
  }
  if (registrationDeadline.getTime() <= now.getTime()) {
    return "Registration deadline must be in the future";
  }
  if (registrationDeadline.getTime() >= startsAt.getTime()) {
    return "Registration deadline must be before the event start time";
  }
  return null;
}

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/png" || file.mimetype === "image/jpeg") {
      cb(null, true);
    } else {
      cb(new Error("Only PNG and JPEG images are allowed."));
    }
  },
});

const createEventSchema = z.object({
  name: z.string().min(1, "Event name is required").max(200),
  description: z.string().min(1, "Description is required").max(4000),
  location: z.string().min(1, "Location is required").max(240),
  time: z
    .string()
    .min(1, "Event time is required")
    .transform((value) => new Date(value))
    .refine(
      (value) => !Number.isNaN(value.getTime()),
      "Event time must be a valid date"
    ),
  eventOwner: z.string().min(1, "Event owner is required").max(200),
  category: z.string().min(1, "Category is required").max(200),
  attendanceLimit: z.coerce
    .number()
    .int("Attendance limit must be a whole number")
    .positive("Attendance limit must be positive"),
  registrationDeadline: z
    .string()
    .min(1, "Registration deadline is required")
    .transform((value) => new Date(value))
    .refine(
      (value) => !Number.isNaN(value.getTime()),
      "Registration deadline must be a valid date"
    ),
});

const updateEventSchema = createEventSchema;

router.use(requireAuth);

async function handleCreateEvent(req: AuthenticatedRequest, res: Response) {
  const parsed = createEventSchema.safeParse(req.body);

  if (!parsed.success) {
    cleanupFiles(req.files as Express.Multer.File[] | undefined);
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsed.error.flatten() });
  }

  const data = parsed.data;
  const uploadedImages = (req.files as Express.Multer.File[]) ?? [];

  const startsAt = data.time;
  const registrationDeadline = data.registrationDeadline;
  const now = new Date();

  const scheduleError = validateSchedule(startsAt, registrationDeadline, now);
  if (scheduleError) {
    cleanupFiles(uploadedImages);
    return res.status(400).json({ message: scheduleError });
  }

  const imagePaths = uploadedImages.map(
    (file) => `/uploads/event-images/${file.filename}`
  );

  const ownerName =
    data.eventOwner.trim() || req.user?.fullName?.trim() || "Event Owner";
  const event = await prisma.event.create({
    data: {
      name: data.name,
      description: data.description,
      location: data.location,
      startsAt,
      images: eventImageStorage.stringify(imagePaths),
      category: data.category,
      ownerId: req.user!.sub,
      ownerName,
      attendanceLimit: data.attendanceLimit,
      registrationDeadline,
    },
  });

  return res.status(201).json({
    message: "Event created successfully",
    event: toPublicEvent(event),
  });
}

async function handleUpdateEvent(req: AuthenticatedRequest, res: Response) {
  const parsed = updateEventSchema.safeParse(req.body);

  if (!parsed.success) {
    cleanupFiles(req.files as Express.Multer.File[] | undefined);
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsed.error.flatten() });
  }

  const { eventId } = req.params;
  if (!eventId) {
    cleanupFiles(req.files as Express.Multer.File[] | undefined);
    return res.status(400).json({ message: "Event id is required" });
  }
  const existingEvent = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!existingEvent) {
    cleanupFiles(req.files as Express.Multer.File[] | undefined);
    return res.status(404).json({ message: "Event not found" });
  }

  if (existingEvent.ownerId !== req.user!.sub) {
    cleanupFiles(req.files as Express.Multer.File[] | undefined);
    return res
      .status(403)
      .json({ message: "You are not allowed to edit this event" });
  }

  const uploadedImages = (req.files as Express.Multer.File[]) ?? [];
  const startsAt = parsed.data.time;
  const registrationDeadline = parsed.data.registrationDeadline;
  const now = new Date();
  const scheduleError = validateSchedule(startsAt, registrationDeadline, now);

  if (scheduleError) {
    cleanupFiles(uploadedImages);
    return res.status(400).json({ message: scheduleError });
  }

  const currentImages = eventImageStorage.parse(existingEvent.images);

  const imagePaths = uploadedImages.length
    ? uploadedImages.map((file) => `/uploads/event-images/${file.filename}`)
    : currentImages;

  const updatedEvent = await prisma.event.update({
    where: { id: eventId },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      location: parsed.data.location,
      startsAt,
      images: eventImageStorage.stringify(imagePaths),
      category: parsed.data.category,
      attendanceLimit: parsed.data.attendanceLimit,
      registrationDeadline,
      ownerName:
        parsed.data.eventOwner.trim() || req.user?.fullName?.trim() || existingEvent.ownerName,
    },
  });

  if (uploadedImages.length) {
    deleteStoredImageFiles(currentImages);
  }

  return res.json({
    message: "Event updated successfully",
    event: toPublicEvent(updatedEvent),
  });
}

router.post("/", (req, res, next: NextFunction) => {
  upload.array("images", 5)(req, res, (err) => {
    if (err) {
      cleanupFiles(req.files as Express.Multer.File[] | undefined);
      return res.status(400).json({ message: err.message });
    }
    handleCreateEvent(req as AuthenticatedRequest, res).catch((error) => {
      cleanupFiles(req.files as Express.Multer.File[] | undefined);
      next(error);
    });
  });
});

router.get("/", async (_req, res) => {
  const events = await prisma.event.findMany({
    orderBy: { startsAt: "asc" },
  });

  return res.json({
    events: events.map(toPublicEvent),
  });
});

router.get("/:eventId", async (req: AuthenticatedRequest, res) => {
  const { eventId } = req.params;
  if (!eventId) {
    return res.status(400).json({ message: "Event id is required" });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    return res.status(404).json({ message: "Event not found" });
  }

  return res.json({ event: toPublicEvent(event) });
});

router.put("/:eventId", (req, res, next: NextFunction) => {
  upload.array("images", 5)(req, res, (err) => {
    if (err) {
      cleanupFiles(req.files as Express.Multer.File[] | undefined);
      return res.status(400).json({ message: err.message });
    }
    handleUpdateEvent(req as AuthenticatedRequest, res).catch((error) => {
      cleanupFiles(req.files as Express.Multer.File[] | undefined);
      next(error);
    });
  });
});

router.delete("/:eventId", async (req: AuthenticatedRequest, res) => {
  const { eventId } = req.params;
  if (!eventId) {
    return res.status(400).json({ message: "Event id is required" });
  }
  const event = await prisma.event.findUnique({ where: { id: eventId } });

  if (!event) {
    return res.status(404).json({ message: "Event not found" });
  }

  if (event.ownerId !== req.user!.sub) {
    return res
      .status(403)
      .json({ message: "You are not allowed to delete this event" });
  }

  await prisma.event.delete({ where: { id: eventId } });
  deleteStoredImageFiles(eventImageStorage.parse(event.images));
  return res.status(204).send();
});

export const eventsRouter = router;
