// The public build, the one Render makes (render.yaml): the collector under /collector/ and the office handing its
// session over to it. Two interface tests need it in dist (login-password-layout-ui and login-station-flow-ui).
// The variables are set here, inside Node: a shell can forget one, and Git Bash turns /collector/ into a Windows path.
import { spawnSync } from "node:child_process";

const env = { ...process.env, CYP_PUBLIC_DEMO: "true", VITE_PUBLIC_DEMO: "true", VITE_COLLECTOR_URL: "/collector/" };
const result = spawnSync("pnpm", ["build"], { stdio: "inherit", env, shell: process.platform === "win32" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
