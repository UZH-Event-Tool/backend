import type { NextFunction, Response } from "express";
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../utils/requireAuth";
import { toPublicUser } from "../utils/user";
import { ENV } from "../env";

const router = Router();

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "profile-images");

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_ROOT);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    const timestamp = Date.now();
    const userId = (req as AuthenticatedRequest).user?.sub ?? "user";
    cb(null, `${userId}-${timestamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/png" || file.mimetype === "image/jpeg") {
      cb(null, true);
    } else {
      cb(new Error("Only PNG and JPEG images are allowed."));
    }
  },
});

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(120),
  lastName: z.string().min(1, "Last name is required").max(120),
  dateOfBirth: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined))
    .refine(
      (value) => !value || !Number.isNaN(value.getTime()),
      "Date of birth must be a valid date",
    ),
  gender: z.string().max(60).optional(),
  about: z.string().max(600).optional(),
  age: z.coerce
    .number()
    .int()
    .min(16, "Age must be at least 16")
    .max(120, "Age must be realistic"),
  location: z.string().min(1, "Location is required").max(180),
  fieldOfStudies: z.string().min(1, "Field of studies is required").max(180),
  universityEmail: z
    .string()
    .min(1, "University email is required")
    .email("University email must be valid"),
  interests: z
    .preprocess((value) => {
      if (Array.isArray(value)) {
        return value.flatMap((item) =>
          typeof item === "string" && item.length
            ? item.split(",").map((entry) => entry.trim())
            : [],
        );
      }
      if (typeof value === "string" && value.length) {
        return value.split(",").map((entry) => entry.trim());
      }
      return [];
    }, z.array(z.string().min(1).max(40)).max(12))
    .optional(),
});

function isAllowedDomain(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === ENV.ALLOWED_EMAIL_DOMAIN.toLowerCase();
}

router.use(requireAuth);

router.get("/", async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.sub;
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({ user: toPublicUser(user) });
});

async function handleProfileUpdate(req: AuthenticatedRequest, res: Response) {
  const parsed = profileSchema.safeParse(req.body);

  if (!parsed.success) {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsed.error.flatten() });
  }

  const data = parsed.data;

  const normalizedUniversityEmail = data.universityEmail.toLowerCase();

  if (!isAllowedDomain(normalizedUniversityEmail)) {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }
    return res.status(400).json({
      message: `University email must end with ${ENV.ALLOWED_EMAIL_DOMAIN}`,
    });
  }

  const userId = req.user!.sub;

  const existingUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!existingUser) {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }
    return res.status(404).json({ message: "User not found" });
  }

  if (normalizedUniversityEmail !== existingUser.universityEmail) {
    const emailTaken = await prisma.user.findUnique({
      where: { universityEmail: normalizedUniversityEmail },
    });
    if (emailTaken && emailTaken.id !== userId) {
      if (req.file) {
        fs.unlink(req.file.path, () => undefined);
      }
      return res.status(409).json({ message: "University email already in use" });
    }
  }

  const interestsArray = data.interests ?? [];
  const profileImageUrl =
    req.file != null
      ? `/uploads/profile-images/${req.file.filename}`
      : existingUser.profileImageUrl;

  if (req.file && existingUser.profileImageUrl) {
    const existingPath = path.join(
      process.cwd(),
      existingUser.profileImageUrl.replace(/^\//, ""),
    );
    fs.promises
      .access(existingPath, fs.constants.F_OK)
      .then(() => fs.promises.unlink(existingPath))
      .catch(() => undefined);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      fullName: `${data.firstName} ${data.lastName}`.trim(),
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth ?? null,
      gender: data.gender ?? null,
      about: data.about ?? null,
      age: data.age,
      location: data.location,
      fieldOfStudies: data.fieldOfStudies,
      universityEmail: normalizedUniversityEmail,
      interests: interestsArray.join(","),
      profileImageUrl,
    },
  });

  return res.json({ user: toPublicUser(updated) });
}

router.put("/", (req, res, next: NextFunction) => {
  upload.single("profileImage")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    handleProfileUpdate(req as AuthenticatedRequest, res as Response).catch(
      (error) => {
        console.error("Failed to update profile", error);
        next(error);
      },
    );
  });
});

export const profileRouter = router;
