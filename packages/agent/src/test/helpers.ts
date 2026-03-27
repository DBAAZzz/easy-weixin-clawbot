import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface CapabilityFixture {
  rootDir: string;
  toolsBuiltinDir: string;
  toolsUserDir: string;
  skillsBuiltinDir: string;
  skillsUserDir: string;
  cleanup(): Promise<void>;
}

export async function createTempCapabilityFixture(
  files: Record<string, string>,
): Promise<CapabilityFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "clawbot-capabilities-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(rootDir, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  return {
    rootDir,
    toolsBuiltinDir: join(rootDir, "tools", "builtin"),
    toolsUserDir: join(rootDir, "tools", "user"),
    skillsBuiltinDir: join(rootDir, "skills", "builtin"),
    skillsUserDir: join(rootDir, "skills", "user"),
    cleanup() {
      return rm(rootDir, { recursive: true, force: true });
    },
  };
}
