/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadProjectSkills,
  saveProjectSkill,
  deleteProjectSkill,
  validateScriptFilename,
  recallSkillTool,
} from "../tools/skills";

function mkRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wrexlyn-skills-test-"));
}

function skillsDir(root: string): string {
  return path.join(root, ".coding-agent", "skills");
}

test("validateScriptFilename: accepts a plain filename with a supported extension", () => {
  assert.equal(validateScriptFilename("run.js"), "run.js");
  assert.equal(validateScriptFilename("score.py"), "score.py");
  assert.equal(validateScriptFilename(" deploy.sh "), "deploy.sh");
});

test("validateScriptFilename: path separators are stripped to a safe basename, never enabling traversal", () => {
  // path.basename() strips everything up to the last separator no matter how many ".." segments
  // precede it, so the result can never contain a separator -- joining it into scripts/ can never
  // escape that directory. This neutralizes traversal by reduction rather than rejecting it outright.
  for (const input of ["../../../../Windows/System32/evil.js", "../secrets.py", "/etc/passwd.sh"]) {
    const result = validateScriptFilename(input);
    assert.ok(
      result === null || (!result.includes("/") && !result.includes("\\")),
      `"${input}" must never produce a filename containing a path separator`
    );
  }
});

test("validateScriptFilename: rejects empty, dot, and unsupported extensions", () => {
  assert.equal(validateScriptFilename(""), null);
  assert.equal(validateScriptFilename("."), null);
  assert.equal(validateScriptFilename(".."), null);
  assert.equal(validateScriptFilename("payload.exe"), null);
  assert.equal(validateScriptFilename("noext"), null);
});

test("saveProjectSkill: rejects an unsupported extension instead of silently dropping the script", () => {
  const root = mkRoot();
  const result = saveProjectSkill(root, {
    name: "Bad Script",
    description: "d",
    steps: "s",
    scriptContent: "MZ\x90\x00binary",
    scriptFilename: "../../malware.exe", // reduces to "malware.exe" via basename, then rejected for its extension
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Invalid scriptFilename/);
  assert.deepEqual(loadProjectSkills(root), []); // nothing should have been written at all
});

test("saveProjectSkill: a traversal-attempt filename is neutralized and the script lands safely inside the skill's own scripts/ directory", () => {
  const root = mkRoot();
  const result = saveProjectSkill(root, {
    name: "Traversal Attempt",
    description: "d",
    steps: "s",
    scriptContent: "malicious content",
    scriptFilename: "../../../../evil.js",
  });
  assert.equal(result.ok, true); // basename-reduction neutralizes it -- no need to reject a safe-after-reduction name

  const scriptPath = path.join(skillsDir(root), "traversal-attempt", "scripts", "evil.js");
  assert.equal(fs.existsSync(scriptPath), true, "the script must land inside the skill's own scripts/ directory");
  assert.equal(fs.readFileSync(scriptPath, "utf-8"), "malicious content");
  // Confirm nothing was written anywhere outside the skill's own package directory.
  assert.equal(fs.existsSync(path.join(root, "evil.js")), false);
  assert.equal(fs.existsSync(path.join(path.dirname(root), "evil.js")), false);
});

test("saveProjectSkill: writes a package with a validated script and a server-computed command", () => {
  const root = mkRoot();
  const result = saveProjectSkill(root, {
    name: "Deploy To Staging",
    description: "Deploys the app to staging.",
    steps: "1. build\n2. push\n3. verify",
    scriptContent: "console.log('deploying');",
    scriptFilename: "run.js",
    scriptDescription: "Runs the deploy.",
    scriptArgs: "--env=staging",
  });
  assert.equal(result.ok, true);

  const skills = loadProjectSkills(root);
  assert.equal(skills.length, 1);
  const skill = skills[0];
  assert.equal(skill.name, "Deploy To Staging");
  assert.equal(skill.version, 1);
  assert.ok(skill.script);
  assert.equal(skill.script!.command, "node .coding-agent/skills/deploy-to-staging/scripts/run.js --env=staging");
  assert.equal(skill.script!.relativePath, ".coding-agent/skills/deploy-to-staging/scripts/run.js");

  const scriptOnDisk = fs.readFileSync(path.join(skillsDir(root), "deploy-to-staging", "scripts", "run.js"), "utf-8");
  assert.equal(scriptOnDisk, "console.log('deploying');");

  // SKILL.md is a generated, write-only artifact -- confirm it exists and mentions the script, but
  // it is never the thing loadProjectSkills reads back.
  const skillMd = fs.readFileSync(path.join(skillsDir(root), "deploy-to-staging", "SKILL.md"), "utf-8");
  assert.match(skillMd, /Runs the deploy\./);
});

test("saveProjectSkill: version increments monotonically, falling back to 1 on a corrupt existing manifest", () => {
  const root = mkRoot();
  saveProjectSkill(root, { name: "Refine Me", description: "d1", steps: "s1" });
  let skill = loadProjectSkills(root)[0];
  assert.equal(skill.version, 1);

  saveProjectSkill(root, { name: "Refine Me", description: "d2", steps: "s2" });
  skill = loadProjectSkills(root)[0];
  assert.equal(skill.version, 2);
  assert.equal(skill.description, "d2"); // the resave's content wins

  // Corrupt the manifest, then save again -- must fall back to version 1, not throw.
  fs.writeFileSync(path.join(skillsDir(root), "refine-me", "manifest.json"), "{not valid json", "utf-8");
  saveProjectSkill(root, { name: "Refine Me", description: "d3", steps: "s3" });
  skill = loadProjectSkills(root)[0];
  assert.equal(skill.version, 1);
});

test("saveProjectSkill: migrates a legacy flat-JSON skill, and the legacy file is removed only after the new package is fully written", () => {
  const root = mkRoot();
  // Write a legacy skill directly, bypassing saveProjectSkill, to simulate a pre-Phase-8 skill.
  fs.mkdirSync(skillsDir(root), { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir(root), "legacy-skill.json"),
    JSON.stringify({ name: "Legacy Skill", description: "old", steps: "old steps" }),
    "utf-8"
  );

  let skills = loadProjectSkills(root);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].version, undefined); // legacy skills have no version

  const result = saveProjectSkill(root, { name: "Legacy Skill", description: "new", steps: "new steps" });
  assert.equal(result.ok, true);

  // The legacy file must be gone, the package dir must exist, and there must be exactly one skill
  // (not two) -- proves both the migration-on-write and the package-wins-over-legacy dedupe.
  assert.equal(fs.existsSync(path.join(skillsDir(root), "legacy-skill.json")), false);
  assert.equal(fs.existsSync(path.join(skillsDir(root), "legacy-skill", "manifest.json")), true);
  skills = loadProjectSkills(root);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].description, "new");
  assert.equal(skills[0].version, 1);
});

test("loadProjectSkills: a package always wins over a same-slug legacy file if both exist", () => {
  const root = mkRoot();
  saveProjectSkill(root, { name: "Dual Format", description: "package version", steps: "s" });
  // Simulate a leftover legacy file for the same slug (e.g. from an old bug or a transient window).
  fs.writeFileSync(
    path.join(skillsDir(root), "dual-format.json"),
    JSON.stringify({ name: "Dual Format", description: "STALE legacy version", steps: "old" }),
    "utf-8"
  );

  const skills = loadProjectSkills(root);
  assert.equal(skills.length, 1, "must render once, not twice, even with both shapes present");
  assert.equal(skills[0].description, "package version");
});

test("deleteProjectSkill: removes the package directory (fixes the silent-no-op regression), not just a legacy file", () => {
  const root = mkRoot();
  saveProjectSkill(root, {
    name: "Deletable",
    description: "d",
    steps: "s",
    scriptContent: "print('hi')",
    scriptFilename: "run.py",
  });
  assert.equal(loadProjectSkills(root).length, 1);
  const dir = path.join(skillsDir(root), "deletable");
  assert.equal(fs.existsSync(dir), true);

  deleteProjectSkill(root, "Deletable");

  assert.equal(fs.existsSync(dir), false, "the whole package directory, including scripts/, must be gone");
  assert.equal(loadProjectSkills(root).length, 0);
});

test("deleteProjectSkill: also removes a legacy flat-JSON skill (unchanged behavior)", () => {
  const root = mkRoot();
  fs.mkdirSync(skillsDir(root), { recursive: true });
  fs.writeFileSync(path.join(skillsDir(root), "old-one.json"), JSON.stringify({ name: "Old One", description: "d", steps: "s" }), "utf-8");
  assert.equal(loadProjectSkills(root).length, 1);

  deleteProjectSkill(root, "Old One");

  assert.equal(loadProjectSkills(root).length, 0);
});

test("recall_skill: previews the exact script command without ever reading or running the script itself", async () => {
  const root = mkRoot();
  saveProjectSkill(root, {
    name: "Scored Skill",
    description: "d",
    steps: "s",
    scriptContent: "console.log('would run')",
    scriptFilename: "run.js",
    scriptDescription: "Scores the target.",
  });

  const result = await recallSkillTool.run({ name: "Scored Skill" }, { root });
  assert.equal(result.ok, true);
  assert.match(result.output, /Scores the target\./);
  assert.match(result.output, /run_shell_command/);
  assert.match(result.output, /node \.coding-agent\/skills\/scored-skill\/scripts\/run\.js/);
});

test("recall_skill: a skill with no script gets no script-preview block", async () => {
  const root = mkRoot();
  saveProjectSkill(root, { name: "Plain Skill", description: "d", steps: "s" });
  const result = await recallSkillTool.run({ name: "Plain Skill" }, { root });
  assert.equal(result.ok, true);
  assert.ok(!result.output.includes("run_shell_command"));
});

test("saveProjectSkill/loadProjectSkills: never throw on a missing or corrupt skills directory", () => {
  const root = mkRoot();
  assert.deepEqual(loadProjectSkills(root), []);
  fs.rmSync(root, { recursive: true, force: true }); // remove the root entirely
  assert.deepEqual(loadProjectSkills(root), []);
});
