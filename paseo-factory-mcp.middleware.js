/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{original: string, alias: string}} ToolName */
/** @typedef {{original: string, namespace: string, tool: string}} McpTool */
/** @typedef {{holder: JsonObject, key: "tool_name" | "name" | "tool"}} ToolNameField */
/**
 * @typedef {object} Context
 * @property {string} agent
 * @property {string} protocol
 * @property {string} path
 * @property {{id: string, account?: string}} [provider]
 * @property {number} [status]
 * @property {{toolNames?: ToolName[]}} state
 */

const MAX_ALIAS_LENGTH = 64
const MCP_PREFIX = "mcp__"
const NAME_PART_PATTERN = /^[A-Za-z0-9_-]+$/
const ALIAS_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export const events = ["content_block_start"]

/** @param {unknown} value @returns {value is JsonObject} */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** @param {unknown} value @returns {JsonObject[]} */
function objects(value) {
  return Array.isArray(value) ? value.filter(isObject) : []
}

/** @param {JsonObject} holder @returns {ToolNameField | undefined} */
function nameField(holder) {
  if (typeof holder.tool_name === "string") return { holder, key: "tool_name" }
  if (typeof holder.name === "string") return { holder, key: "name" }
}

/**
 * Collects declarations and references from the structured deferred-tool
 * blocks Claude Code sends, including the nested reference form.
 * @param {JsonObject} block
 * @param {JsonObject[]} declarations
 * @param {ToolNameField[]} references
 */
function collectDeferredBlock(block, declarations, references) {
  switch (block.type) {
    case "tool_addition": {
      const tool = block.tool
      if (isObject(tool) && tool.type === "tool_definition") {
        if (isObject(tool.definition)) declarations.push(tool.definition)
        else if (typeof tool.name === "string") declarations.push(tool)
      } else if (isObject(tool) && tool.type === "tool_reference") {
        const field = nameField(tool)
        if (field) references.push(field)
      } else if (typeof tool === "string") {
        references.push({ holder: block, key: "tool" })
      }
      break
    }
    case "tool_definition":
      if (isObject(block.definition)) declarations.push(block.definition)
      else if (typeof block.name === "string") declarations.push(block)
      break
    case "tool_reference":
    case "tool_removal": {
      const field = nameField(block)
      if (field) references.push(field)
      if (isObject(block.tool) && block.tool.type === "tool_reference") {
        const nested = nameField(block.tool)
        if (nested) references.push(nested)
      } else if (typeof block.tool === "string") {
        references.push({ holder: block, key: "tool" })
      }
      break
    }
  }
}

/**
 * Splits an MCP tool name into its namespace and tool. It scans for the first
 * double underscore that leaves a non-empty namespace and tool, so tool names
 * (and leading underscores in a namespace) may contain further underscores.
 * @param {unknown} name
 * @returns {{namespace: string, tool: string} | undefined}
 */
function parseMcpToolName(name) {
  if (typeof name !== "string" || !name.startsWith(MCP_PREFIX)) return
  const rest = name.slice(MCP_PREFIX.length)
  if (!NAME_PART_PATTERN.test(rest)) return
  const separator = rest.indexOf("__", 1)
  if (separator === -1 || separator + 2 >= rest.length) return
  return { namespace: rest.slice(0, separator), tool: rest.slice(separator + 2) }
}

/** @param {string} value @param {number} seed @returns {string} */
function hash32(value, seed) {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * Produces a stable 64-bit-sized digest without relying on BigInt or crypto,
 * so the alias is identical in every runtime Magpie loads the middleware in.
 * @param {string} value
 * @param {number} attempt
 * @returns {string}
 */
function aliasDigest(value, attempt) {
  const input = `${value}\u0000${attempt}`
  return `${hash32(input, 0x811c9dc5)}${hash32(input, 0x9e3779b9)}`
}

/** @param {string} namespace @param {string} tool @returns {string} */
function aliasBase(namespace, tool) {
  const base = `${namespace}_${tool}`
  // Avoid the reserved MCP prefix even when the namespace ends with underscores.
  return base.replace(/^mcp_{2,}/, "mcp_")
}

/** @param {string} alias @param {Set<string>} reserved @returns {boolean} */
function isUsableAlias(alias, reserved) {
  return ALIAS_PATTERN.test(alias) && !alias.startsWith(MCP_PREFIX) && !reserved.has(alias)
}

/**
 * Returns the preferred alias when it is free, otherwise a deterministic
 * prefix plus digest. Long aliases keep a readable prefix without truncating
 * two different names to the same value.
 * @param {string} original
 * @param {string} namespace
 * @param {string} tool
 * @param {Set<string>} reserved
 * @returns {string}
 */
function createAlias(original, namespace, tool, reserved) {
  const base = aliasBase(namespace, tool)
  if (isUsableAlias(base, reserved)) return base
  for (let attempt = 0; ; attempt += 1) {
    const suffix = aliasDigest(original, attempt)
    const prefixLength = Math.max(0, MAX_ALIAS_LENGTH - suffix.length - 1)
    const candidate = aliasBase(base.slice(0, prefixLength), suffix)
    if (isUsableAlias(candidate, reserved)) return candidate
  }
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
  /** @type {ToolNameField[]} */
  const references = []
  for (const message of objects(body.messages)) {
    for (const block of objects(message.content)) {
      if (block.type === "tool_use") {
        if (message.role === "assistant") uses.push(block)
        continue
      }
      collectDeferredBlock(block, declarations, references)
      if (block.type !== "tool_result") continue
      const parts = Array.isArray(block.content) ? objects(block.content) : isObject(block.content) ? [block.content] : []
      for (const part of parts) collectDeferredBlock(part, declarations, references)
    }
  }

  /** @type {Set<string>} */
  const declaredNames = new Set()
  /** @type {McpTool[]} */
  const targets = []
  for (const declaration of declarations) {
    const name = declaration.name
    if (typeof name !== "string" || declaredNames.has(name)) continue
    declaredNames.add(name)
    const parsed = parseMcpToolName(name)
    if (parsed) targets.push({ original: name, ...parsed })
  }
  if (targets.length === 0) return

  const choice = isObject(body.tool_choice) ? body.tool_choice : undefined
  /** @type {Set<string>} */
  const reserved = new Set(declaredNames)
  for (const use of uses) {
    if (typeof use.name === "string") reserved.add(use.name)
  }
  for (const reference of references) {
    const name = reference.holder[reference.key]
    if (typeof name === "string") reserved.add(name)
  }
  if (choice && typeof choice.name === "string") reserved.add(choice.name)

  // Sorting by the original name makes aliases independent of declaration order.
  targets.sort((left, right) => (
    left.original < right.original ? -1 : left.original > right.original ? 1 : 0
  ))

  /** @type {ToolName[]} */
  const active = []
  const aliases = new Map()
  for (const target of targets) {
    const alias = createAlias(target.original, target.namespace, target.tool, reserved)
    active.push({ original: target.original, alias })
    aliases.set(target.original, alias)
    reserved.add(alias)
  }

  if (choice && choice.type === "tool") uses.push(choice)

  // Only these structured fields carry tool names. Inputs and text may contain
  // identical strings with unrelated meanings.
  for (const tool of declarations.concat(uses)) {
    const alias = typeof tool.name === "string" && aliases.get(tool.name)
    if (alias) tool.name = alias
  }
  for (const reference of references) {
    const name = reference.holder[reference.key]
    const alias = typeof name === "string" && aliases.get(name)
    if (alias) reference.holder[reference.key] = alias
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
