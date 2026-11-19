// Developer maintenance only: never import the maker in native agent execution.
export default async function (pi) {
  if (process.env.FAUR_MCP_RUNTIME === '1') return;
  const { default: maintain } = await import('../../.faur-mcp/faur/extensions/faur/index.ts');
  return maintain(pi);
}
