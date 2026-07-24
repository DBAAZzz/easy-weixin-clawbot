import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersions,
  parseVersionConstraints,
  satisfiesVersion,
} from "../../src/skills/version-spec.js";

function satisfies(installed: string, spec: string, name: string) {
  return satisfiesVersion(installed, parseVersionConstraints(spec, name));
}

test("compareVersions pads missing segments and ignores prerelease suffixes", () => {
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("2.0.0", "10.0.0"), -1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), 0);
  assert.equal(compareVersions("v1.4.0", "1.4.0"), 0);
});

test("parseVersionConstraints strips the package name from PEP 440 and npm specs", () => {
  assert.deepEqual(parseVersionConstraints("numpy>=1.20", "numpy"), [
    { operator: ">=", version: "1.20" },
  ]);
  assert.deepEqual(parseVersionConstraints("lodash@^4.17.0", "lodash"), [
    { operator: "^", version: "4.17.0" },
  ]);
  assert.deepEqual(parseVersionConstraints("requests[security]>=2.0", "requests"), [
    { operator: ">=", version: "2.0" },
  ]);
  assert.deepEqual(parseVersionConstraints("pandas>=1.5,<3.0", "pandas"), [
    { operator: ">=", version: "1.5" },
    { operator: "<", version: "3.0" },
  ]);
});

test("parseVersionConstraints falls back to a later candidate name", () => {
  // 上游把整串当成了包名，规范化后的名字才能对上前缀
  assert.deepEqual(
    parseVersionConstraints("lodash@^4.17.0", "lodash@^4.17.0", "lodash"),
    [{ operator: "^", version: "4.17.0" }],
  );
});

test("parseVersionConstraints treats unparsable or open specs as unconstrained", () => {
  assert.deepEqual(parseVersionConstraints(undefined, "numpy"), []);
  assert.deepEqual(parseVersionConstraints("numpy", "numpy"), []);
  assert.deepEqual(parseVersionConstraints("lodash@latest", "lodash"), []);
  assert.deepEqual(parseVersionConstraints("numpy>=not-a-version", "numpy"), []);
});

test("satisfiesVersion evaluates comparison operators", () => {
  assert.equal(satisfies("1.26.4", "numpy>=1.20", "numpy"), true);
  assert.equal(satisfies("1.18.0", "numpy>=1.20", "numpy"), false);
  assert.equal(satisfies("2.0.0", "pandas>=1.5,<3.0", "pandas"), true);
  assert.equal(satisfies("3.1.0", "pandas>=1.5,<3.0", "pandas"), false);
  assert.equal(satisfies("1.2.3", "pkg==1.2.3", "pkg"), true);
  assert.equal(satisfies("1.2.4", "pkg==1.2.3", "pkg"), false);
  assert.equal(satisfies("1.2.4", "pkg!=1.2.3", "pkg"), true);
});

test("satisfiesVersion supports wildcard equality", () => {
  assert.equal(satisfies("1.4.9", "pkg==1.4.*", "pkg"), true);
  assert.equal(satisfies("1.5.0", "pkg==1.4.*", "pkg"), false);
});

test("satisfiesVersion applies compatible-release bounds", () => {
  // ~=1.4.2 → >=1.4.2, <1.5.0
  assert.equal(satisfies("1.4.9", "pkg~=1.4.2", "pkg"), true);
  assert.equal(satisfies("1.4.1", "pkg~=1.4.2", "pkg"), false);
  assert.equal(satisfies("1.5.0", "pkg~=1.4.2", "pkg"), false);

  // ~=1.4 → >=1.4, <2.0
  assert.equal(satisfies("1.9.0", "pkg~=1.4", "pkg"), true);
  assert.equal(satisfies("2.0.0", "pkg~=1.4", "pkg"), false);
});

test("satisfiesVersion applies npm caret and tilde bounds", () => {
  assert.equal(satisfies("4.17.21", "lodash@^4.17.0", "lodash"), true);
  assert.equal(satisfies("5.0.0", "lodash@^4.17.0", "lodash"), false);

  // 0.x 下 caret 锁定次版本
  assert.equal(satisfies("0.2.9", "pkg@^0.2.3", "pkg"), true);
  assert.equal(satisfies("0.3.0", "pkg@^0.2.3", "pkg"), false);

  assert.equal(satisfies("1.2.9", "pkg@~1.2.3", "pkg"), true);
  assert.equal(satisfies("1.3.0", "pkg@~1.2.3", "pkg"), false);
});
