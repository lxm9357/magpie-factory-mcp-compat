/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{original: string, alias: string}} ToolName */
/**
 * @typedef {object} Context
 * @property {string} agent
 * @property {string} protocol
 * @property {string} path
 * @property {{id: string, account?: string}} [provider]
 * @property {number} [status]
 * @property {{toolNames?: ToolName[]}} state
 */

/** @type {ToolName[]} */
const toolNames = [
  { original: "mcp__paseo__progress_show", alias: "paseo_progress_show" },
  { original: "mcp__paseo__progress_ticket_update", alias: "paseo_progress_ticket_update" },
]

export const events = ["content_block_start"]

/** @param {unknown} value @returns {value is JsonObject} */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** @param {unknown} value @returns {JsonObject[]} */
function objects(value) {
  return Array.isArray(value) ? value.filter(isObject) : []
}

/** @param {unknown} body @param {Context} ctx */
export function onProvider(body, ctx) {
  // The runtime shares state across candidate attempts, but parses a fresh body.
  delete ctx.state.toolNames
  if (ctx.agent !== "claude" || ctx.protocol !== "anthropic" || ctx.path !== "/v1/messages"
      || ctx.provider?.id !== "factory" || ctx.provider.account !== "plugin" || !isObject(body)) return

  const declarations = objects(body.tools)
  /** @type {JsonObject[]} */
  const uses = []
  /** @type {JsonObject[]} */
  const references = []
  for (const message of objects(body.messages)) {
    for (const block of objects(message.content)) {
      switch (block.type) {
        case "tool_use":
          if (message.role === "assistant") uses.push(block)
          break
        case "tool_addition": {
          const tool = block.tool
          if (isObject(tool) && tool.type === "tool_definition" && isObject(tool.definition)) {
            declarations.push(tool.definition)
          }
          break
        }
        case "tool_reference":
        case "tool_removal":
          references.push(block)
          break
        case "tool_result":
          for (const part of objects(block.content)) {
            if (part.type === "tool_definition" && isObject(part.definition)) {
              declarations.push(part.definition)
            } else if (part.type === "tool_reference") {
              references.push(part)
            }
          }
          break
      }
    }
  }

  const declaredNames = new Set(declarations.map(tool => tool.name))
  const historicalNames = new Set(uses.map(tool => tool.name))
  const active = toolNames.filter(({ original, alias }) =>
    declaredNames.has(original) && !declaredNames.has(alias) && !historicalNames.has(alias))
  if (active.length === 0) return

  const choice = body.tool_choice
  if (isObject(choice) && choice.type === "tool") uses.push(choice)

  // Only these structured fields carry tool names. Inputs and text may contain
  // identical strings with unrelated meanings.
  const aliases = new Map(active.map(({ original, alias }) => [original, alias]))
  for (const tool of declarations.concat(uses)) {
    const alias = typeof tool.name === "string" && aliases.get(tool.name)
    if (alias) tool.name = alias
  }
  for (const reference of references) {
    const alias = typeof reference.tool_name === "string" && aliases.get(reference.tool_name)
    if (alias) reference.tool_name = alias
  }

  ctx.state.toolNames = active
  return body
}

/** @param {unknown} block @param {ToolName[]} active */
function restoreUse(block, active) {
  if (!isObject(block) || block.type !== "tool_use") return false
  const match = active.find(({ alias }) => alias === block.name)
  if (!match) return false
  block.name = match.original
  return true
}

/** @param {unknown} event @param {Context} ctx */
export function onEvent(event, ctx) {
  const active = ctx.state.toolNames
  if (active && isObject(event) && event.type === "content_block_start"
      && restoreUse(event.content_block, active)) return event
}

/** @param {unknown} body @param {Context} ctx */
export function onResponse(body, ctx) {
  const active = ctx.state.toolNames
  if (!active || (ctx.status !== undefined && (ctx.status < 200 || ctx.status >= 300))
      || !isObject(body) || body.type !== "message") return

  let changed = false
  for (const block of objects(body.content)) {
    if (restoreUse(block, active)) changed = true
  }
  if (changed) return body
}
