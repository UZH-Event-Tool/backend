import jwt from "jsonwebtoken";
import { ENV } from "../env";

export type JwtPayload = {
  sub: string;
  email: string;
  fullName: string;
};

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, ENV.JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
}
