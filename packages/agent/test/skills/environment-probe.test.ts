import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  UNPROBED_INDEX,
  normalizePythonName,
  probeNodePackages,
  resolveDependencyStatus,
  stripNodeVersionRange,
} from "../../src/skills/environment-probe.js";
import type { InstalledPackageIndex } from "../../src/skills/environment-probe.js";
import type { SkillDependency } from "../../src/skills/types.js";

function dependency(name: string, installSpec?: string): SkillDependency {
  return { name, installSpec, source: "markdown-install", confidence: "high" };
}

function index(entries: Record<string, string>): InstalledPackageIndex {
  return { probed: true, versions: new Map(Object.entries(entries)) };
}

test("normalizePythonName follows PEP 503 normalization", () => {
  assert.equal(normalizePythonName("Scikit_Learn"), "scikit-learn");
  assert.equal(normalizePythonName("zope.interface"), "zope-interface");
  assert.equal(normalizePythonName(" NumPy "), "numpy");
});

test("stripNodeVersionRange keeps scope but drops the range", () => {
  assert.equal(stripNodeVersionRange("lodash"), "lodash");
  assert.equal(stripNodeVersionRange("lodash@^4.17.0"), "lodash");
  assert.equal(stripNodeVersionRange("@scope/pkg"), "@scope/pkg");
  assert.equal(stripNodeVersionRange("@scope/pkg@1.2.3"), "@scope/pkg");
});

test("resolveDependencyStatus reports ok when installed and unconstrained", () => {
  const result = resolveDependencyStatus(
    dependency("numpy"),
    index({ numpy: "1.26.4" }),
    normalizePythonName,
  );
  assert.equal(result.status, "ok");
  assert.equal(result.installedVersion, "1.26.4");
});

test("resolveDependencyStatus reports outdated when the constraint is unmet", () => {
  const result = resolveDependencyStatus(
    dependency("numpy", "numpy>=1.20"),
    index({ numpy: "1.18.0" }),
    normalizePythonName,
  );
  assert.equal(result.status, "outdated");
  assert.equal(result.installedVersion, "1.18.0");
});

test("resolveDependencyStatus reports missing when the probe succeeded but the package is absent", () => {
  const result = resolveDependencyStatus(dependency("pandas"), index({}), normalizePythonName);
  assert.equal(result.status, "missing");
  assert.equal(result.installedVersion, undefined);
});

test("resolveDependencyStatus reports unknown when the probe itself failed", () => {
  const result = resolveDependencyStatus(dependency("pandas"), UNPROBED_INDEX, normalizePythonName);
  assert.equal(result.status, "unknown");
});

test("resolveDependencyStatus matches names through PEP 503 normalization", () => {
  const result = resolveDependencyStatus(
    dependency("scikit_learn", "scikit_learn>=1.0"),
    index({ "scikit-learn": "1.4.0" }),
    normalizePythonName,
  );
  assert.equal(result.status, "ok");
});

test("probeNodePackages reads versions from node_modules manifests", async () => {
  const skillDir = await mkdtemp(join(tmpdir(), "skill-node-probe-"));
  try {
    await mkdir(join(skillDir, "node_modules", "lodash"), { recursive: true });
    await writeFile(
      join(skillDir, "node_modules", "lodash", "package.json"),
      JSON.stringify({ name: "lodash", version: "4.17.21" }),
      "utf8",
    );

    const result = await probeNodePackages(skillDir, [
      dependency("lodash@^4.17.0"),
      dependency("express"),
    ]);

    assert.equal(result.probed, true);
    assert.equal(result.versions.get("lodash"), "4.17.21");
    assert.equal(result.versions.has("express"), false);
  } finally {
    await rm(skillDir, { recursive: true, force: true });
  }
});

test("probeNodePackages treats a missing node_modules as an empty environment, not a failure", async () => {
  const skillDir = await mkdtemp(join(tmpdir(), "skill-node-probe-empty-"));
  try {
    const result = await probeNodePackages(skillDir, [dependency("lodash")]);
    assert.equal(result.probed, true);
    assert.equal(result.versions.size, 0);
  } finally {
    await rm(skillDir, { recursive: true, force: true });
  }
});
