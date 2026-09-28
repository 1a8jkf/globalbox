import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { db, GameError } from "./db.ts";
const scrypt = promisify(rawScrypt);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex"),
    hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  value: string,
): Promise<boolean> {
  const [salt, stored] = value.split(":");
  if (!salt || !stored) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer,
    expected = Buffer.from(stored, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function session(res: Response, userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      tokenHash: digest(token),
      userId,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  res.cookie("gt_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 7 * 86400000,
    path: "/",
  });
}
export async function userFrom(req: Request) {
  const token = req.cookies?.gt_session;
  if (typeof token !== "string" || token.length !== 64) return null;
  const value = await db.session.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: true },
  });
  return value && value.expiresAt > new Date() ? value.user : null;
}
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = await userFrom(req);
    if (!user) throw new GameError("Entre na sua conta para continuar.", 401);
    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
export async function logout(req: Request, res: Response) {
  if (typeof req.cookies?.gt_session === "string")
    await db.session.deleteMany({
      where: { tokenHash: digest(req.cookies.gt_session) },
    });
  res.clearCookie("gt_session", {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
  });
}
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) throw Error();
    } catch {
      res.status(403).json({ error: "Origem da solicitação não permitida." });
      return;
    }
  }
  next();
}
export const publicUser = (user: {
  id: string;
  username: string;
  money: number;
}) => ({ id: user.id, username: user.username, money: user.money });
