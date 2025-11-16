import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { ENV } from "../env";
import { signToken } from "../utils/jwt";
import { requireAuth } from "../utils/requireAuth";
import { toPublicUser } from "../utils/user";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";

const router = Router();

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  password: z.string().min(6, "Password must be at least 6 characters"),
  age: z.coerce.number().int().positive().max(120).optional(),
  location: z.string().max(120).optional(),
  fieldOfStudies: z.string().max(120).optional(),
  universityEmail: z.string().email(),
  interests: z
    .array(z.string().min(1).max(40))
    .max(10)
    .optional(),
});

const loginSchema = z.object({
  universityEmail: z.string().email(),
  password: z.string().min(1),
});

function isAllowedDomain(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === ENV.ALLOWED_EMAIL_DOMAIN.toLowerCase();
}

const PROFILE_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "profile-images");

function ensureProfileUploadDir() {
  fs.mkdirSync(PROFILE_UPLOAD_ROOT, { recursive: true });
}

const profileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureProfileUploadDir();
    cb(null, PROFILE_UPLOAD_ROOT);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `profile-${Date.now()}${ext}`);
  },
});

const profileUpload = multer({
  storage: profileStorage,
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

router.post("/register", (req, res, next: NextFunction) => {
  profileUpload.single("profileImage")(req, res, (err) => {
    if (err) {
      if (req.file) {
        fs.unlink(req.file.path, () => undefined);
      }
      return res.status(400).json({ message: err.message });
    }
    handleRegister(req, res).catch((error) => {
      if (req.file) {
        fs.unlink(req.file.path, () => undefined);
      }
      next(error);
    });
  });
});

async function handleRegister(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsed.error.flatten() });
  }

  const data = parsed.data;
  const universityEmail = data.universityEmail.toLowerCase();

  if (!isAllowedDomain(universityEmail)) {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }
    return res.status(400).json({
      message: `University email must end with ${ENV.ALLOWED_EMAIL_DOMAIN}`,
    });
  }

  const existing = await prisma.user.findUnique({
    where: { universityEmail },
  });

  if (existing) {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }
    return res.status(409).json({ message: "An account already exists" });
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const [firstName, ...restName] = data.fullName.trim().split(/\s+/);
  const lastName = restName.join(" ") || null;

  const user = await prisma.user.create({
    data: {
      passwordHash,
      fullName: data.fullName,
      firstName: firstName || null,
      lastName,
      age: data.age ?? null,
      location: data.location ?? null,
      fieldOfStudies: data.fieldOfStudies ?? null,
      universityEmail,
      interests: data.interests?.join(",") ?? null,
      profileImageUrl: req.file ? `/uploads/profile-images/${req.file.filename}` : null,
    },
  });

  const token = signToken({
    sub: user.id,
    universityEmail: user.universityEmail,
    fullName: user.fullName,
  });

  res.status(201).json({ user: toPublicUser(user), token });
}

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsed.error.flatten() });
  }

  const { universityEmail, password } = parsed.data;
  const normalizedUniversityEmail = universityEmail.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { universityEmail: normalizedUniversityEmail },
  });

  if (!user) {
    return res.status(401).json({ message: "Invalid university email or password" });
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);

  if (!isValidPassword) {
    return res.status(401).json({ message: "Invalid university email or password" });
  }

  const token = signToken({
    sub: user.id,
    universityEmail: user.universityEmail,
    fullName: user.fullName,
  });

  res.json({ user: toPublicUser(user), token });
});

router.post("/logout", requireAuth, (_req, res) => {
  // Client removes the token; this endpoint just validates and acknowledges the logout request.
  res.status(204).send();
});

export const authRouter = router;
