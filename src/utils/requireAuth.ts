import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtPayload } from "./jwt";

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.get("authorization");

  if (!header) {
    return res.status(401).json({ message: "Authorization header missing" });
  }

  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return res.status(401).json({ message: "Invalid authorization header" });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (error) {
    console.error("Failed to verify token", error);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
