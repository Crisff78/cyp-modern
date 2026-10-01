import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const adminDirectory = resolve(appDirectory, "client-admin/dist");
const collectorDirectory = resolve(appDirectory, "client-collector/dist");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serveFile(request: FastifyRequest, reply: FastifyReply) {
  let path: string;
  try {
    path = decodeURIComponent(new URL(request.url, "http://local").pathname);
  } catch {
    return reply.code(400).send("Invalid path");
  }
  if (path.startsWith("/api/")) return reply.callNotFound();
  const collector = path.startsWith("/collector/");
  const root = collector ? collectorDirectory : adminDirectory;
  const relative = collector ? path.slice("/collector".length) : path;
  if (
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.split("/").some((part) => part === ".." || part.startsWith("."))
  )
    return reply.code(404).send("Not found");
  const file = resolve(root, `.${relative}`);
  if (file !== root && !file.startsWith(root + sep))
    return reply.code(404).send("Not found");
  const target = relative === "/" || !extname(file) ? resolve(root, "index.html") : file;
  try {
    const body = await readFile(target);
    return reply.type(contentTypes[extname(target)] ?? "application/octet-stream").send(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return reply.code(404).send("Not found");
    throw error;
  }
}

export async function registerPublicWeb(app: FastifyInstance) {
  app.get("/collector", async (_request, reply) => reply.redirect("/collector/"));
  app.get("/", serveFile);
  app.get("/*", serveFile);
}
