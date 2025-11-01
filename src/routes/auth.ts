import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { ENV } from "../env";
import { signToken } from "../utils/jwt";
import { toPublicUser } from "../utils/user";

const router = Router();

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  age: z.coerce.number().int().positive().max(120).optional(),
  location: z.string().max(120).optional(),
  fieldOfStudies: z.string().max(120).optional(),
  universityEmail: z.string().email().optional(),
  interests: z
    .array(z.string().min(1).max(40))
    .max(10)
    .optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function isAllowedDomain(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === ENV.ALLOWED_EMAIL_DOMAIN.toLowerCase();
}

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsed.error.flatten() });
  }

  const data = parsed.data;
  const email = data.email.toLowerCase();

  if (!isAllowedDomain(email)) {
    return res
      .status(400)
      .json({ message: `Email must be a ${ENV.ALLOWED_EMAIL_DOMAIN} address` });
  }

  if (data.universityEmail && !isAllowedDomain(data.universityEmail)) {
    return res.status(400).json({
      message: `University email must end with ${ENV.ALLOWED_EMAIL_DOMAIN}`,
    });
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    return res.status(409).json({ message: "An account already exists" });
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const [firstName, ...restName] = data.fullName.trim().split(/\s+/);
  const lastName = restName.join(" ") || null;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: data.fullName,
      firstName: firstName || null,
      lastName,
      age: data.age ?? null,
      location: data.location ?? null,
      fieldOfStudies: data.fieldOfStudies ?? null,
      universityEmail: data.universityEmail?.toLowerCase() ?? null,
      interests: data.interests?.join(",") ?? null,
    },
  });

  const token = signToken({
    sub: user.id,
    email: user.email,
    fullName: user.fullName,
  });

  res.status(201).json({ user: toPublicUser(user), token });
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", issues: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);

  if (!isValidPassword) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = signToken({
    sub: user.id,
    email: user.email,
    fullName: user.fullName,
  });

  res.json({ user: toPublicUser(user), token });
});

export const authRouter = router;
