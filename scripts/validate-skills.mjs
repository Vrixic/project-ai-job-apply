import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repositoryRoot, "skills");
const agentsInstructions = await readFile(join(repositoryRoot, "AGENTS.md"), "utf8");
const catalog = await readFile(join(skillsRoot, "README.md"), "utf8");
const entries = await readdir(skillsRoot, { withFileTypes: true });
const skillDirectories = entries
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));
const errors = [];
const descriptions = new Set();

if (skillDirectories.length === 0) {
  errors.push("No repository skills were found.");
}

for (const directory of skillDirectories) {
  const skillName = directory.name;
  const skillPath = join(skillsRoot, skillName);
  let skill;
  let metadata;

  try {
    skill = await readFile(join(skillPath, "SKILL.md"), "utf8");
  } catch {
    errors.push(`${skillName}: missing SKILL.md`);
    continue;
  }

  try {
    metadata = await readFile(join(skillPath, "agents", "openai.yaml"), "utf8");
  } catch {
    errors.push(`${skillName}: missing agents/openai.yaml`);
    continue;
  }

  const frontmatter = skill.match(/^---\r?\n(?<yaml>[\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter?.groups?.yaml) {
    errors.push(`${skillName}: invalid or missing YAML frontmatter`);
    continue;
  }

  const name = frontmatter.groups.yaml.match(/^name:\s*(?<value>.+)$/m)?.groups?.value.trim();
  const description = frontmatter.groups.yaml
    .match(/^description:\s*(?<value>.+)$/m)
    ?.groups?.value.trim();

  if (name !== skillName) {
    errors.push(`${skillName}: frontmatter name must match its folder`);
  }
  if (!/^[a-z0-9-]{1,63}$/.test(skillName)) {
    errors.push(`${skillName}: name must be lower kebab-case and at most 63 characters`);
  }
  if (!description || description.length < 80) {
    errors.push(`${skillName}: description must explain both capability and trigger context`);
  } else if (descriptions.has(description)) {
    errors.push(`${skillName}: description duplicates another skill`);
  } else {
    descriptions.add(description);
  }

  if (/\bTODO\b|\[TODO/i.test(skill)) {
    errors.push(`${skillName}: template TODO remains`);
  }
  if (!/display_name:\s*"[^"]+"/.test(metadata)) {
    errors.push(`${skillName}: openai.yaml is missing display_name`);
  }
  if (!/short_description:\s*"[^"]{25,64}"/.test(metadata)) {
    errors.push(`${skillName}: short_description must contain 25–64 characters`);
  }
  if (!metadata.includes(`$${skillName}`)) {
    errors.push(`${skillName}: default_prompt must explicitly invoke $${skillName}`);
  }
  if (!agentsInstructions.includes(`| \`${skillName}\` |`)) {
    errors.push(`${skillName}: AGENTS.md routing entry is missing`);
  }
  if (!catalog.includes(`(${skillName}/SKILL.md)`)) {
    errors.push(`${skillName}: skills/README.md catalog entry is missing`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Validated ${skillDirectories.length} repository skills.`);
}
