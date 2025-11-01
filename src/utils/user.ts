import type { User } from "@prisma/client";

export function toPublicUser(user: User) {
  const { passwordHash, interests, ...rest } = user;
  return {
    ...rest,
    interests: interests ? interests.split(",").filter(Boolean) : [],
  };
}
