import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BRANCH, commitMessage, gitDependencySpecifier, publishGitDist } from "./publish-git-dist.mjs";

const IDENTITY = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const sourceA = "a".repeat(40);
const sourceB = "b".repeat(40);

function git(cwd, args, input) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY }, input }).trim();
}

// A source repository whose `origin` is a local bare repository, plus a dist directory.
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "settings-git-dist-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const remote = join(base, "remote.git");
  const root = join(base, "source");
  const distDir = join(base, "dist");
  git(base, ["init", "--quiet", "--bare", remote]);
  git(base, ["init", "--quiet", root]);
  git(root, ["remote", "add", "origin", remote]);
  mkdirSync(join(distDir, "pkg"), { recursive: true });
  writeDist(distDir, "export const version = 1;\n");
  const publish = (sourceCommit, options = {}) =>
    publishGitDist({ root, distDir, sourceCommit, push: true, env: IDENTITY, ...options });
  const tip = () => git(remote, ["rev-parse", `refs/heads/${BRANCH}`]);
  const show = (commit, path) => git(remote, ["cat-file", "blob", `${commit}:${path}`]);
  return { remote, root, distDir, publish, tip, show };
}

function writeDist(distDir, moduleSource) {
  writeFileSync(
    join(distDir, "package.json"),
    `${JSON.stringify({ name: "@moritzbrantner/settings-browser", version: "0.2.0" })}\n`,
  );
  writeFileSync(join(distDir, "settings-browser.js"), moduleSource);
  writeFileSync(join(distDir, "pkg", "settings_wasm_bg.wasm"), "\0asm");
}

test("creates the branch as a root commit holding the package, SOURCE_SHA and .nojekyll", (t) => {
  const { publish, tip, show, remote } = fixture(t);
  const report = publish(sourceA);
  assert.equal(report.changed, true);
  assert.equal(report.pushed, true);
  assert.equal(report.parent, null);
  assert.equal(tip(), report.commit);
  assert.equal(show(report.commit, "SOURCE_SHA"), sourceA);
  assert.deepEqual(git(remote, ["ls-tree", "-r", "--name-only", report.commit]).split("\n"), [
    ".nojekyll",
    "SOURCE_SHA",
    "package.json",
    "pkg/settings_wasm_bg.wasm",
    "settings-browser.js",
  ]);
  assert.equal(report.dependency, `github:moritzbrantner/settings#${report.commit}`);
});

test("adds a child of the previous tip when the contents change", (t) => {
  const { publish, tip, show, remote, distDir } = fixture(t);
  const first = publish(sourceA);
  writeDist(distDir, "export const version = 2;\n");
  const second = publish(sourceB);
  assert.equal(second.changed, true);
  assert.equal(second.parent, first.commit);
  assert.equal(tip(), second.commit);
  assert.equal(git(remote, ["rev-parse", `${second.commit}^`]), first.commit);
  assert.equal(show(second.commit, "SOURCE_SHA"), sourceB);
  assert.match(git(remote, ["log", "-1", "--format=%B", second.commit]), new RegExp(`from ${sourceB}`, "u"));
});

test("keeps the previous commit when only the source commit changed", (t) => {
  const { publish, tip, show } = fixture(t);
  const first = publish(sourceA);
  const second = publish(sourceB);
  assert.equal(second.changed, false);
  assert.equal(second.pushed, false);
  assert.equal(second.commit, first.commit);
  assert.equal(tip(), first.commit);
  assert.equal(show(tip(), "SOURCE_SHA"), sourceA);
});

test("migrates an existing force-pushed head by building on top of it", (t) => {
  const { remote, root, publish, tip } = fixture(t);
  // The legacy orphan layout: package files, .nojekyll and a SOURCE_SHA file.
  const legacyRoot = join(root, "..", "legacy");
  mkdirSync(legacyRoot);
  writeFileSync(join(legacyRoot, "SOURCE_SHA"), `${sourceA}\n`);
  writeFileSync(join(legacyRoot, "index.html"), "legacy\n");
  git(legacyRoot, ["init", "--quiet"]);
  git(legacyRoot, ["add", "."]);
  git(legacyRoot, ["commit", "--quiet", "-m", `Publish browser distribution for ${sourceA}`]);
  git(legacyRoot, ["push", "--quiet", remote, `HEAD:refs/heads/${BRANCH}`]);
  const legacy = tip();

  const report = publish(sourceB);
  assert.equal(report.parent, legacy);
  assert.equal(tip(), report.commit);
  git(remote, ["merge-base", "--is-ancestor", legacy, report.commit]);
});

test("prepares without pushing in dry-run mode", (t) => {
  const { publish, tip, distDir } = fixture(t);
  const first = publish(sourceA);
  writeDist(distDir, "export const version = 2;\n");
  const dryRun = publish(sourceB, { push: false });
  assert.equal(dryRun.changed, true);
  assert.equal(dryRun.pushed, false);
  assert.equal(dryRun.parent, first.commit);
  assert.equal(tip(), first.commit);
});

test("rejects publisher-owned files in the assembled distribution", (t) => {
  const { publish, distDir } = fixture(t);
  writeFileSync(join(distDir, "SOURCE_SHA"), `${sourceA}\n`);
  assert.throws(() => publish(sourceA), /generated by the publisher/u);
});

test("accepts only exact source and distribution commits", () => {
  assert.throws(() => gitDependencySpecifier("main"), /exact 40-character commit/u);
  assert.throws(() => commitMessage({ name: "x", version: "1", sourceCommit: "HEAD" }), /exact/u);
  assert.equal(
    commitMessage({ name: "@moritzbrantner/settings-browser", version: "0.2.0", sourceCommit: sourceA }),
    [
      `Publish @moritzbrantner/settings-browser 0.2.0 from ${sourceA}`,
      "",
      `Source: https://github.com/moritzbrantner/settings/commit/${sourceA}`,
    ].join("\n"),
  );
});
