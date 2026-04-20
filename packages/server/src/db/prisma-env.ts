function requireEnv(name: "DATABASE_URL" | "DIRECT_URL"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required Prisma environment variable: ${name}. ` +
        "Set both DATABASE_URL and DIRECT_URL in the repo-root .env.",
    );
  }
  return value;
}

export function ensurePrismaUrls() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const directUrl = requireEnv("DIRECT_URL");

  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = directUrl;

  return {
    databaseUrl,
    directUrl,
  };
}
