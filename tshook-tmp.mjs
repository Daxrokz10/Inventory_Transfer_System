import { register } from "node:module";
import { pathToFileURL } from "node:url";
if (!process.env.__TSHOOK) {
  process.env.__TSHOOK = "1";
  register(pathToFileURL(new URL(import.meta.url).pathname.slice(1)));
}
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
    try { return await next(specifier + ".ts", context); } catch { /* fall through */ }
  }
  return next(specifier, context);
}
