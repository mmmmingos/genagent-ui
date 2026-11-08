// The orchestrator's planner: turn a goal into a flow of steps, each with a harness, and
// predict what each step will need from the user or a teammate so those can be answered early.
import fs from "node:fs";
import { MODELS, log } from "./config.js";
import { claudeCall } from "./claude-call.js";
import { available } from "./harness.js";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "2-6 words, sentence case" },
    goal: { type: "string", description: "The goal restated precisely in one or two sentences" },
    steps: { type: "array", items: { type: "object", properties: {
      label: { type: "string", description: "2-6 words, sentence case" },
      harness: { type: "string", enum: ["claude", "codex", "grok", "you"], description: "Who does it: a harness, or 'you' when only the user can (approvals, merges, sign-ins)" },
      why: { type: "string", description: "One line: what this step produces" },
      needs: { type: "array", items: { type: "object", properties: {
        owner: { type: "string", description: "'you' or a teammate's name" }, question: { type: "string" },
      }, required: ["owner", "question"] } },
    }, required: ["label", "harness", "why"] } },
  },
  required: ["title", "goal", "steps"],
};

export async function plan({ goal, cwd }) {
  try { return await planOnce({ goal, cwd }); }
  catch (e) {
    // A transient failure (busy API, no valid structured answer) usually passes on a second try.
    if (!e.transient) throw e;
    log(`plan retry after: ${e.message} ${e.detail || ""}`);
    return await planOnce({ goal, cwd });
  }
}

async function planOnce({ goal, cwd }) {
  const have = available();
  const harnesses = Object.entries(have).filter(([, ok]) => ok).map(([k]) => k).join(", ");
  const r = await claudeCall({
    model: MODELS.plan, schema: SCHEMA, tools: "Read,Grep,Glob", userSettingsOnly: true, noPersist: true, lane: "plan", cwd: cwd && fs.existsSync(cwd) ? cwd : undefined, timeoutMs: 300000,
    appendSystem: "You are GenAgent UI's orchestrator. You plan; you never edit files or run commands.",
    prompt: `Plan this goal as a short flow of steps (3-8). You may glance at the project folder to ground the plan, but keep it quick.
Goal: ${goal}
Project folder: ${cwd || "(none)"}
Available harnesses: ${harnesses}. Prefer claude for writing, research and most code; codex for focused code changes and PRs; grok for X/Twitter or web research. Use "you" for steps only the user can do.
For each step, predict the questions it will need answered (owner "you" or a named teammate if the goal names one) so they can be asked up front. Keep labels short.`,
  });
  return r.data;
}

// The first message for a step's worker: the plan, the step, and answers already given.
export function stepPrompt(p, index, answers = {}) {
  const step = p.steps[index];
  const lines = [
    `You are a fresh worker started by GenAgent UI's orchestrator.`,
    `Overall goal: ${p.goal}`,
    `The plan:\n${p.steps.map((s, i) => `${i + 1}. ${s.label} (${s.harness})${i === index ? "  <- your step" : ""}`).join("\n")}`,
    `Your step: ${step.label}. ${step.why || ""}`,
  ];
  const a = Object.entries(answers).filter(([, v]) => v);
  if (a.length) lines.push(`Answers the user has already given:\n${a.map(([q, v]) => `- ${q}: ${v}`).join("\n")}`);
  lines.push(`Do only your step. When your step is done, say so in one line and stop.`);
  return lines.join("\n\n");
}
