/** Native tool selections: empty is empty; omitted and nonempty include browsing. */
export const BASELINE_TOOLS = ['read', 'ls', 'find', 'grep'];
export function withBaseline(tools) {
  if (tools === undefined) return [...BASELINE_TOOLS];
  if (!Array.isArray(tools) || !tools.length) return tools;
  return [...tools, ...BASELINE_TOOLS.filter(tool => !tools.includes(tool))];
}
export function withBaselineTools(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return model;
  const agent = a => a && typeof a === 'object' && !Array.isArray(a) ? { ...a, tools: withBaseline(a.tools) } : a;
  return { ...model, ...(model.orchestrator ? { orchestrator: agent(model.orchestrator) } : {}),
    ...(Array.isArray(model.agents) ? { agents: model.agents.map(agent) } : {}) };
}
