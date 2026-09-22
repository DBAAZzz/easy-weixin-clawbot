// generate/validate 等仅解析 schema 的命令不连接数据库，env 缺失时允许占位串放行
const PLACEHOLDER_DB_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder";

type PrismaEnvName = "DATABASE_URL" | "DIRECT_URL";

function readEnv(name: PrismaEnvName): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requireEnv(name: PrismaEnvName): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(
      `Missing required Prisma environment variable: ${name}. ` +
        "Set both DATABASE_URL and DIRECT_URL in the repo-root .env.",
    );
  }
  return value;
}

export function ensurePrismaUrls(options: { allowPlaceholder?: boolean } = {}) {
  const databaseUrl = options.allowPlaceholder
    ? (readEnv("DATABASE_URL") ?? PLACEHOLDER_DB_URL)
    : requireEnv("DATABASE_URL");
  const directUrl = options.allowPlaceholder
    ? (readEnv("DIRECT_URL") ?? PLACEHOLDER_DB_URL)
    : requireEnv("DIRECT_URL");

  if (options.allowPlaceholder && (!readEnv("DATABASE_URL") || !readEnv("DIRECT_URL"))) {
    console.warn(
      "[prisma-env] DATABASE_URL/DIRECT_URL 未配置，本次命令不连接数据库，已用占位串放行；真实连库命令仍要求在仓库根目录 .env 中配置。",
    );
  }

  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = directUrl;

  return {
    databaseUrl,
    directUrl,
  };
}
