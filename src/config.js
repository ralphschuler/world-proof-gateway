import { readFile } from "node:fs/promises";

const appId = /^app_[A-Za-z0-9]+$/;
const rpId = /^rp_[A-Za-z0-9]+$/;
const action = /^[a-z0-9][a-z0-9-]{2,80}$/;
const address = /^0x[a-fA-F0-9]{40}$/;

function required(value, name) {
  if (!value || typeof value !== "string") throw new Error(`missing_${name}`);
  return value;
}

export function validateProjects(value, env = process.env) {
  if (!value || !Array.isArray(value.projects)) throw new Error("projects_array_required");
  const projects = new Map();
  for (const project of value.projects) {
    if (!project || !/^[a-z0-9-]{3,48}$/.test(project.id || "")) throw new Error("invalid_project_id");
    if (projects.has(project.id)) throw new Error("duplicate_project_id");
    if (!appId.test(project.appId || "") || !rpId.test(project.rpId || "") || !action.test(project.action || "")) throw new Error(`invalid_world_config:${project.id}`);
    if (!["production", "staging"].includes(project.environment)) throw new Error(`invalid_environment:${project.id}`);
    if (!Array.isArray(project.allowedOrigins) || project.allowedOrigins.some((origin) => { try { return new URL(origin).protocol !== "https:"; } catch { return true; } })) throw new Error(`invalid_origins:${project.id}`);
    if (!["none", "wallet-address"].includes(project.signalPolicy || "none")) throw new Error(`invalid_signal_policy:${project.id}`);
    if (project.attestation) {
      if (!Number.isInteger(project.attestation.chainId) || !address.test(project.attestation.verifyingContract || "")) throw new Error(`invalid_attestation:${project.id}`);
    }
    projects.set(project.id, { ...project, signingKey: required(env[project.signingKeyEnv], project.signingKeyEnv) });
  }
  return projects;
}

export async function loadProjects(path, env = process.env) {
  return validateProjects(JSON.parse(await readFile(path, "utf8")), env);
}
