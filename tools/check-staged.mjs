import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const names = (filter) =>
  execFileSync(
    "git",
    ["diff", "--cached", "--name-only", `--diff-filter=${filter}`, "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);

const changed = names("ACMRD");
if (changed.length === 0) process.exit(0);

const formatted = names("ACMR").filter((file) =>
  /\.(?:css|html|js|json|mjs)$/.test(file),
);
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const snapshot = mkdtempSync(join(tmpdir(), "senal-staged-"));

try {
  execFileSync("git", ["checkout-index", "--all", `--prefix=${snapshot}/`]);
  symlinkSync(
    join(root, "node_modules"),
    join(snapshot, "node_modules"),
    "dir",
  );
  if (formatted.length > 0) {
    execFileSync(
      join(root, "node_modules", ".bin", "prettier"),
      ["--check", ...formatted],
      { cwd: snapshot, stdio: "inherit" },
    );
  }
  execFileSync("npm", ["run", "check:fast"], {
    cwd: snapshot,
    stdio: "inherit",
  });
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
