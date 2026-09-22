const LOCAL_WEBSITE_URL = "http://localhost:3000";

/** Public marketing-site origin used by the game client's home control. */
export function getWebsiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WEBSITE_URL?.trim();
  if (!configured) return LOCAL_WEBSITE_URL;

  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return LOCAL_WEBSITE_URL;
    }
    return url.toString();
  } catch {
    return LOCAL_WEBSITE_URL;
  }
}
