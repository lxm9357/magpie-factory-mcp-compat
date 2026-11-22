import { test } from "node:test"
import assert from "node:assert/strict"

import * as middleware from "../paseo-factory-mcp.middleware.js"

const SHOW = "mcp__paseo__progress_show"
const UPDATE = "mcp__paseo__progress_ticket_update"
const SHOW_ALIAS = "paseo_progress_show"
const UPDATE_ALIAS = "paseo_progress_ticket_update"

// The complete set of Paseo tools visible to this harness. These are used only
// as synthetic declarations; no MCP operation is executed.
const PASEO_TOOL_NAMES = [
  "archive_agent",
  "archive_workspace",
  "cancel_agent",
  "capture_terminal",
  "create_agent",
  "create_heartbeat",
  "create_schedule",
  "create_terminal",
  "create_workspace",
  "delete_heartbeat",
  "delete_schedule",
  "get_agent_activity",
  "get_agent_status",
  "inspect_provider",
  "inspect_schedule",
  "kill_agent",
  "kill_terminal",
  "list_agents",
  "list_hosts",
  "list_models",
  "list_pending_permissions",
  "list_profiles",
  "list_providers",
  "list_schedules",
  "list_terminals",
  "list_workspace_scripts",
  "list_workspaces",
  "paseo_progress",
  "pause_schedule",
  "progress_activity_add",
  "progress_deliverable_add",
  "progress_finish",
  "progress_question_answer",
  "progress_question_ask",
  "progress_show",
  "progress_start",
  "progress_ticker",
  "progress_ticket_add",
  "progress_ticket_update",
  "rename_workspace",
  "respond_to_permission",
  "resume_schedule",
  "run_schedule_once",
  "schedule_logs",
  "send_agent_prompt",
  "send_terminal_keys",
  "set_agent_mode",
  "start_workspace_script",
  "stop_workspace_script",
  "subscribe_change_request",
  "unsubscribe_change_request",
  "update_agent",
  "update_schedule",
]

const FACTORY = { id: "factory", name: "Factory", account: "plugin", model: "claude-opus-5-5" }

/** A request's shared hook context, as Magpie builds it for one middleware. */
function context(overrides = {}) {
  return {
    protocol: "anthropic",
    model: "claude-opus-5-5",
    stream: true,
    path: "/v1/messages",
    agent: "claude",
    options: {},
    state: {},
    reject() {},
    ...overrides,
  }
}

/** Calls onProvider the way the gateway does: ctx.state is shared, provider is the try's. */
function tryProvider(body, ctx, provider = FACTORY) {
  const out = middleware.onProvider(body, { ...ctx, provider })
  return out === undefined ? body : out
}

function toolBlock(name, extra = {}) {
  return {
    name,
    description: `${name} description`,
    input_schema: { type: "object", properties: { path: { type: "string" } } },
    ...extra,
  }
}

function mappedAlias(ctx, original) {
  return ctx.state.toolNames?.find((entry) => entry.original === original)?.alias
}

function assertAliasContract(alias, original) {
  assert.equal(typeof alias, "string", `${original} has no string alias`)
  assert.ok(alias.length > 0, `${original} has an empty alias`)
  assert.ok(alias.length <= 64, `${original} alias is ${alias.length} characters: ${alias}`)
  assert.match(alias, /^[A-Za-z0-9_-]+$/, `${original} alias is not legal ASCII: ${alias}`)
  assert.ok(!alias.startsWith("mcp__"), `${original} alias keeps the mcp__ prefix: ${alias}`)
}

function eventFor(alias) {
  return {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_event", name: alias, input: {} },
  }
}

function restoreFromEvent(ctx, alias) {
  const event = middleware.onEvent(structuredClone(eventFor(alias)), ctx)
  return event?.content_block?.name
}

function paseoName(tool) {
  return `mcp__paseo__${tool}`
}

function paseoAlias(tool) {
  return `paseo_${tool}`
}

test("the middleware subscribes only to content_block_start events", () => {
  assert.deepEqual(middleware.events, ["content_block_start"])
})

test("progress_show: declaration, tool_choice and history are renamed; ids, inputs and text stay", () => {
  const ctx = context()
  const body = {
    model: "claude-opus-5-5",
    max_tokens: 2048,
    stream: true,
    system: [{ type: "text", text: `Never read ${SHOW} in this system prompt.` }],
    tools: [
      toolBlock(SHOW),
      toolBlock("Bash", { description: "unchanged tool" }),
    ],
    tool_choice: { type: "tool", name: SHOW, disable_parallel_tool_use: true },
    messages: [
      { role: "user", content: [{ type: "text", text: `Please call ${SHOW}.` }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: `I will use ${SHOW}.`, signature: "sig-very-secret" },
          { type: "tool_use", id: "toolu_01", name: SHOW, input: { path: "/tmp/x", note: SHOW } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_01", content: [{ type: "text", text: `result for ${SHOW}` }] }],
      },
    ],
  }
  const original = structuredClone(body)
  const out = tryProvider(body, ctx)

  assert.equal(out, body)
  assert.equal(out.tools[0].name, SHOW_ALIAS)
  assert.equal(out.tools[0].description, original.tools[0].description)
  assert.deepEqual(out.tools[0].input_schema, original.tools[0].input_schema)
  assert.equal(out.tools[1].name, "Bash")
  assert.equal(out.tool_choice.name, SHOW_ALIAS)
  assert.equal(out.tool_choice.type, "tool")
  assert.equal(out.tool_choice.disable_parallel_tool_use, true)
  assert.equal(out.messages[0].content[0].text, `Please call ${SHOW}.`)
  assert.equal(out.messages[1].content[0].thinking, `I will use ${SHOW}.`)
  assert.equal(out.messages[1].content[0].signature, "sig-very-secret")
  assert.equal(out.messages[1].content[1].name, SHOW_ALIAS)
  assert.equal(out.messages[1].content[1].id, "toolu_01")
  assert.deepEqual(out.messages[1].content[1].input, { path: "/tmp/x", note: SHOW })
  assert.equal(out.messages[2].content[0].tool_use_id, "toolu_01")
  assert.equal(out.messages[2].content[0].content[0].text, `result for ${SHOW}`)
  assert.equal(out.system[0].text, `Never read ${SHOW} in this system prompt.`)
  assert.equal(out.model, "claude-opus-5-5")
  assert.equal(out.max_tokens, 2048)
  assert.equal(out.stream, true)
})

test("progress_ticket_update alone is renamed in its declared places", () => {
  const ctx = context()
  const body = {
    model: "claude-opus-5-5",
    tools: [toolBlock(UPDATE)],
    tool_choice: { type: "tool", name: UPDATE },
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_02", name: UPDATE, input: { ticket: "T03" } }] },
    ],
  }
  const out = tryProvider(body, ctx)

  assert.equal(out.tools[0].name, UPDATE_ALIAS)
  assert.equal(out.tool_choice.name, UPDATE_ALIAS)
  assert.equal(out.messages[0].content[0].name, UPDATE_ALIAS)
  assert.equal(out.messages[0].content[0].id, "toolu_02")
  assert.deepEqual(out.messages[0].content[0].input, { ticket: "T03" })
})

test("both tools are renamed together without creating extra aliases", () => {
  const ctx = context()
  const body = {
    model: "claude-opus-5-5",
    tools: [toolBlock(SHOW), toolBlock(UPDATE)],
    tool_choice: { type: "tool", name: SHOW },
    messages: [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_a", name: SHOW, input: { a: 1 } },
          { type: "tool_use", id: "toolu_b", name: UPDATE, input: { b: 2 } },
        ],
      },
    ],
  }
  const out = tryProvider(body, ctx)
  const names = out.tools.map((tool) => tool.name)

  assert.deepEqual(names, [SHOW_ALIAS, UPDATE_ALIAS])
  assert.equal(out.messages[0].content[0].name, SHOW_ALIAS)
  assert.equal(out.messages[0].content[1].name, UPDATE_ALIAS)
  assert.ok(!JSON.stringify(out).includes(`${SHOW_ALIAS}_`))
  assert.ok(!JSON.stringify(out).includes(`${UPDATE_ALIAS}_`))
})

test("non-Factory providers and display-name-only matches pass through untouched", () => {
  const body = {
    model: "claude-opus-5-5",
    tools: [toolBlock(SHOW)],
    tool_choice: { type: "tool", name: SHOW },
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: SHOW, input: {} }] }],
  }
  const before = structuredClone(body)
  const providers = [
    { id: "claude", name: "Claude", account: "claude", model: "claude-opus-5-5" },
    { id: "factory", name: "Factory", account: "factory", model: "claude-opus-5-5" },
    { id: "claude", name: "Factory", account: "plugin", model: "claude-opus-5-5" },
    { id: "factory", name: "Factory", account: "", model: "claude-opus-5-5" },
  ]
  for (const provider of providers) {
    const ctx = context()
    const out = middleware.onProvider(body, { ...ctx, provider })
    assert.equal(out, undefined)
    assert.deepEqual(body, before)
    const event = { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: SHOW_ALIAS, input: {} } }
    assert.equal(middleware.onEvent(structuredClone(event), ctx), undefined)
  }
})

test("non-Claude agents, non-Anthropic protocols and non-messages paths are left alone", () => {
  const body = { tools: [toolBlock(SHOW)], messages: [] }
  const cases = [
    { agent: "codex" },
    { protocol: "chat", path: "/v1/messages" },
    { protocol: "anthropic", path: "/v1/messages/count_tokens" },
    { protocol: "anthropic", path: "/v1/chat/completions" },
  ]
  for (const overrides of cases) {
    const ctx = context(overrides)
    assert.equal(middleware.onProvider(body, { ...ctx, provider: FACTORY }), undefined)
    assert.deepEqual(body, { tools: [toolBlock(SHOW)], messages: [] })
  }
})

test("a name only in history or tool_choice is not renamed without a declaration", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock("Bash")],
    tool_choice: { type: "tool", name: SHOW },
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: SHOW, input: { path: "/" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "ok" }] }] },
    ],
  }
  const before = structuredClone(body)

  assert.equal(middleware.onProvider(body, { ...ctx, provider: FACTORY }), undefined)
  assert.deepEqual(body, before)
})

test("a declared alias conflict gets a deterministic fallback alias", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW), toolBlock(SHOW_ALIAS, { description: "the real one" })],
    tool_choice: { type: "tool", name: SHOW },
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: SHOW, input: { a: 1 } }] }],
  }

  const out = tryProvider(body, ctx)
  const alias = mappedAlias(ctx, SHOW)

  assertAliasContract(alias, SHOW)
  assert.notEqual(alias, SHOW_ALIAS)
  assert.equal(out.tools[0].name, alias)
  assert.equal(out.tools[1].name, SHOW_ALIAS)
  assert.equal(out.tool_choice.name, alias)
  assert.equal(out.messages[0].content[0].name, alias)

  const reversedCtx = context()
  const reversedBody = {
    tools: [toolBlock(SHOW_ALIAS, { description: "the real one" }), toolBlock(SHOW)],
    tool_choice: { type: "tool", name: SHOW },
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: SHOW, input: { a: 1 } }] }],
  }
  tryProvider(reversedBody, reversedCtx)
  assert.equal(mappedAlias(reversedCtx, SHOW), alias)
})

test("one conflicting tool does not stop the other mapped tool", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW), toolBlock(UPDATE), toolBlock(SHOW_ALIAS)],
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: UPDATE, input: {} }] }],
  }
  const out = tryProvider(body, ctx)
  const showAlias = mappedAlias(ctx, SHOW)

  assertAliasContract(showAlias, SHOW)
  assert.notEqual(showAlias, SHOW_ALIAS)
  assert.equal(out.tools[0].name, showAlias)
  assert.equal(out.tools[1].name, UPDATE_ALIAS)
  assert.equal(out.tools[2].name, SHOW_ALIAS)
  assert.equal(out.messages[0].content[0].name, UPDATE_ALIAS)
})

test("an alias already used in assistant history gets a fallback alias", () => {
  const ctx = context()
  const history = [
    { type: "tool_use", id: "t1", name: SHOW_ALIAS, input: {} },
    { type: "tool_use", id: "t2", name: SHOW, input: { path: "/" } },
    { type: "tool_use", id: "t3", name: UPDATE, input: {} },
  ]
  const out = tryProvider({
    tools: [toolBlock(SHOW), toolBlock(UPDATE)],
    tool_choice: { type: "tool", name: SHOW },
    messages: [{ role: "assistant", content: structuredClone(history) }],
  }, ctx)
  const showAlias = mappedAlias(ctx, SHOW)

  assertAliasContract(showAlias, SHOW)
  assert.notEqual(showAlias, SHOW_ALIAS)
  assert.deepEqual(out.tools.map(tool => tool.name), [showAlias, UPDATE_ALIAS])
  assert.equal(out.tool_choice.name, showAlias)
  assert.deepEqual(out.messages[0].content, [
    history[0],
    { ...history[1], name: showAlias },
    { ...history[2], name: UPDATE_ALIAS },
  ])
  assert.equal(restoreFromEvent(ctx, showAlias), SHOW)
  assert.equal(restoreFromEvent(ctx, SHOW_ALIAS), undefined)
})

test("a target name taken by a delayed tool definition also gets a fallback alias", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW)],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_addition",
            tool: { type: "tool_definition", definition: { name: SHOW_ALIAS, input_schema: { type: "object" } } },
          },
        ],
      },
    ],
  }
  const out = tryProvider(body, ctx)
  const alias = mappedAlias(ctx, SHOW)

  assertAliasContract(alias, SHOW)
  assert.notEqual(alias, SHOW_ALIAS)
  assert.equal(out.tools[0].name, alias)
  assert.equal(out.messages[0].content[0].tool.definition.name, SHOW_ALIAS)
})

test("delayed tool definitions and their structured references are renamed", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW, { defer_loading: true }), toolBlock("DeferredToolPlaceholder", { defer_loading: true })],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_addition",
            tool: {
              type: "tool_definition",
              definition: {
                name: UPDATE,
                description: "update a ticket",
                input_schema: { type: "object", properties: { ticket: { type: "string" } } },
                defer_loading: true,
              },
            },
          },
          { type: "tool_removal", tool_name: UPDATE },
          { type: "tool_reference", tool_name: UPDATE },
          {
            type: "tool_result",
            tool_use_id: "toolu_search",
            content: [
              { type: "tool_reference", tool_name: SHOW },
              {
                type: "tool_definition",
                definition: { name: SHOW, description: "show state", input_schema: { type: "object" } },
              },
              { type: "text", text: `Use ${SHOW} and ${UPDATE} exactly as written.` },
            ],
          },
        ],
      },
    ],
  }
  const out = tryProvider(body, ctx)
  const content = out.messages[0].content

  assert.equal(out.tools[0].name, SHOW_ALIAS)
  assert.equal(out.tools[0].defer_loading, true)
  assert.equal(out.tools[1].name, "DeferredToolPlaceholder")
  assert.equal(content[0].tool.definition.name, UPDATE_ALIAS)
  assert.equal(content[0].tool.definition.description, "update a ticket")
  assert.deepEqual(content[0].tool.definition.input_schema, { type: "object", properties: { ticket: { type: "string" } } })
  assert.equal(content[1].tool_name, UPDATE_ALIAS)
  assert.equal(content[2].tool_name, UPDATE_ALIAS)
  assert.equal(content[3].content[0].tool_name, SHOW_ALIAS)
  assert.equal(content[3].content[1].definition.name, SHOW_ALIAS)
  assert.equal(content[3].content[1].definition.description, "show state")
  assert.equal(content[3].content[2].text, `Use ${SHOW} and ${UPDATE} exactly as written.`)
})

test("nested tool_removal references are renamed with their declarations", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW)],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_search",
            content: [{ type: "tool_removal", tool_name: SHOW }],
          },
        ],
      },
    ],
  }
  const out = tryProvider(body, ctx)
  assert.equal(out.tools[0].name, SHOW_ALIAS)
  assert.equal(out.messages[0].content[0].content[0].tool_name, SHOW_ALIAS)
})

test("Claude Code nested deferred references and legacy tool_addition names are renamed", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW), toolBlock(UPDATE)],
    messages: [
      {
        role: "system",
        content: [
          { type: "tool_addition", tool: { type: "tool_reference", name: SHOW } },
          { type: "tool_removal", tool: { type: "tool_reference", name: SHOW } },
          { type: "tool_addition", tool: UPDATE },
        ],
      },
    ],
  }
  const out = tryProvider(body, ctx)
  const content = out.messages[0].content

  assert.equal(content[0].tool.name, SHOW_ALIAS)
  assert.equal(content[1].tool.name, SHOW_ALIAS)
  assert.equal(content[2].tool, UPDATE_ALIAS)
})

test("a declaration only inside a tool_result content object is renamed", () => {
  const ctx = context()
  const body = {
    tools: [],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_definition",
            content: {
              type: "tool_definition",
              definition: { name: SHOW, description: "show state", input_schema: { type: "object" } },
            },
          },
        ],
      },
    ],
  }
  const out = tryProvider(body, ctx)

  assert.equal(mappedAlias(ctx, SHOW), SHOW_ALIAS)
  assert.equal(out.messages[0].content[0].content.definition.name, SHOW_ALIAS)
  assert.equal(out.messages[0].content[0].content.definition.description, "show state")
})

test("deferred references without any matching declaration stay untouched", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock("Bash")],
    messages: [
      {
        role: "system",
        content: [
          { type: "tool_reference", tool_name: SHOW },
          { type: "tool_removal", tool: { type: "tool_reference", name: SHOW } },
          { type: "tool_addition", tool: { type: "tool_reference", name: SHOW } },
        ],
      },
    ],
  }
  const before = structuredClone(body)
  assert.equal(middleware.onProvider(body, { ...ctx, provider: FACTORY }), undefined)
  assert.deepEqual(body, before)
})

test("unverified message content shapes are not rewritten", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW)],
    messages: [
      {
        role: "user",
        content: [
          { type: "unknown", tool_name: SHOW },
          { type: "tool_use", id: "t1", name: SHOW, input: { text: SHOW } },
          { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: SHOW }] },
        ],
      },
    ],
  }
  const before = structuredClone(body)
  const out = tryProvider(body, ctx)
  assert.equal(out.tools[0].name, SHOW_ALIAS)
  assert.deepEqual(out.messages, before.messages)
})

test("SSE content_block_start.tool_use names are restored; other events are untouched", () => {
  const ctx = context()
  tryProvider({ tools: [toolBlock(SHOW), toolBlock(UPDATE)], messages: [] }, ctx)

  const showStart = {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_1", name: SHOW_ALIAS, input: {} },
  }
  const showOut = middleware.onEvent(showStart, ctx)
  assert.equal(showOut.content_block.name, SHOW)
  assert.equal(showOut.content_block.id, "toolu_1")
  assert.deepEqual(showOut.content_block.input, {})

  const updateStart = {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_2", name: UPDATE_ALIAS, input: {} },
  }
  assert.equal(middleware.onEvent(updateStart, ctx).content_block.name, UPDATE)

  const delta = {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: `{"text":"${SHOW_ALIAS}"}` },
  }
  assert.equal(middleware.onEvent(structuredClone(delta), ctx), undefined)

  const errorEvent = { type: "error", error: { type: "api_error", message: `upstream saw ${SHOW_ALIAS}` } }
  assert.equal(middleware.onEvent(structuredClone(errorEvent), ctx), undefined)

  const messageDelta = { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } }
  assert.equal(middleware.onEvent(structuredClone(messageDelta), ctx), undefined)
})

test("a tool_use block whose name was not mapped is not restored", () => {
  const ctx = context()
  tryProvider({ tools: [toolBlock(SHOW), toolBlock(UPDATE)], messages: [] }, ctx)
  const event = {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_x", name: "paseo_progress_show_extra", input: {} },
  }
  assert.equal(middleware.onEvent(structuredClone(event), ctx), undefined)
})

test("non-streaming JSON tool_use names are restored; thinking, text, ids and inputs stay", () => {
  const ctx = context({ stream: false })
  tryProvider({ tools: [toolBlock(SHOW), toolBlock(UPDATE)], messages: [] }, ctx)
  const response = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "thinking", thinking: `We should call ${SHOW_ALIAS}.`, signature: "sig-1" },
      { type: "text", text: `Calling ${UPDATE_ALIAS} now.` },
      { type: "tool_use", id: "toolu_1", name: SHOW_ALIAS, input: { path: "/" } },
      { type: "tool_use", id: "toolu_2", name: UPDATE_ALIAS, input: { ticket: "T03" } },
      { type: "tool_use", id: "toolu_3", name: "Bash", input: { command: "true" } },
    ],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 20 },
  }
  const out = middleware.onResponse(response, ctx)

  assert.equal(out.content[0].thinking, `We should call ${SHOW_ALIAS}.`)
  assert.equal(out.content[0].signature, "sig-1")
  assert.equal(out.content[1].text, `Calling ${UPDATE_ALIAS} now.`)
  assert.equal(out.content[2].name, SHOW)
  assert.equal(out.content[2].id, "toolu_1")
  assert.deepEqual(out.content[2].input, { path: "/" })
  assert.equal(out.content[3].name, UPDATE)
  assert.equal(out.content[3].id, "toolu_2")
  assert.deepEqual(out.content[3].input, { ticket: "T03" })
  assert.equal(out.content[4].name, "Bash")
  assert.equal(out.id, "msg_1")
  assert.equal(out.stop_reason, "tool_use")
  assert.deepEqual(out.usage, { input_tokens: 10, output_tokens: 20 })
})

test("HTTP errors and JSON error bodies pass through without inspection", () => {
  const ctx = context({ stream: false })
  tryProvider({ tools: [toolBlock(SHOW)], messages: [] }, ctx)
  const body = { type: "error", error: { type: "permission_error", message: `Factory refused ${SHOW_ALIAS}` }, request_id: "req_1" }
  ctx.status = 403
  assert.equal(middleware.onResponse(body, ctx), undefined)
  assert.deepEqual(body, { type: "error", error: { type: "permission_error", message: `Factory refused ${SHOW_ALIAS}` }, request_id: "req_1" })

  ctx.status = 200
  assert.equal(middleware.onResponse(body, ctx), undefined)
})

test("a fallback candidate clears the previous factory mapping for the response path", () => {
  const ctx = context()
  const body = { tools: [toolBlock(SHOW)], messages: [] }
  const out = tryProvider(body, ctx)
  assert.equal(out.tools[0].name, SHOW_ALIAS)

  const other = { id: "claude", name: "Claude", account: "claude", model: "claude-opus-5-5" }
  assert.equal(middleware.onProvider({ tools: [toolBlock(SHOW)], messages: [] }, { ...ctx, provider: other }), undefined)

  const event = {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_fallback", name: SHOW_ALIAS, input: {} },
  }
  assert.equal(middleware.onEvent(structuredClone(event), ctx), undefined)

  const response = {
    id: "msg_fallback",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_fallback", name: SHOW_ALIAS, input: {} }],
  }
  assert.equal(middleware.onResponse(response, ctx), undefined)
})

test("a later factory candidate without a mapping also clears the earlier one", () => {
  const ctx = context()
  tryProvider({ tools: [toolBlock(SHOW)], messages: [] }, ctx)
  assert.equal(middleware.onProvider({ tools: [toolBlock("Bash")], messages: [] }, { ...ctx, provider: FACTORY }), undefined)

  const event = {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_later", name: SHOW_ALIAS, input: {} },
  }
  assert.equal(middleware.onEvent(structuredClone(event), ctx), undefined)
})

test("mappings do not leak between requests", () => {
  const first = context()
  tryProvider({ tools: [toolBlock(SHOW)], messages: [] }, first)

  const second = context()
  const event = {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_second", name: SHOW_ALIAS, input: {} },
  }
  assert.equal(middleware.onEvent(structuredClone(event), second), undefined)
  const response = {
    id: "msg_2",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_second", name: SHOW_ALIAS, input: {} }],
  }
  assert.equal(middleware.onResponse(response, second), undefined)
})

test("non-matching response names are never rewritten", () => {
  const ctx = context({ stream: false })
  tryProvider({ tools: [toolBlock(SHOW)], messages: [] }, ctx)
  const response = {
    id: "msg_3",
    type: "message",
    role: "assistant",
    content: [
      { type: "tool_use", id: "t1", name: "paseo_progress_show_other", input: {} },
      { type: "tool_use", id: "t2", name: SHOW, input: {} },
    ],
  }
  assert.equal(middleware.onResponse(response, ctx), undefined)
})

test("malformed or non-object bodies are left alone", () => {
  const ctx = context()
  for (const body of [undefined, null, "", 1, [], [1, 2], "text"]) {
    assert.equal(middleware.onProvider(body, { ...ctx, provider: FACTORY }), undefined)
  }
})

test("tool_choice other shapes keep their extra fields when a mapped name is present", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW)],
    tool_choice: { type: "tool", name: SHOW, disable_parallel_tool_use: false, custom: { keep: true } },
    messages: [],
  }
  const out = tryProvider(body, ctx)
  assert.equal(out.tool_choice.name, SHOW_ALIAS)
  assert.equal(out.tool_choice.disable_parallel_tool_use, false)
  assert.deepEqual(out.tool_choice.custom, { keep: true })

  const autoCtx = context()
  const auto = { tools: [toolBlock(SHOW)], tool_choice: { type: "auto" }, messages: [] }
  const autoOut = tryProvider(auto, autoCtx)
  assert.equal(autoOut.tools[0].name, SHOW_ALIAS)
  assert.deepEqual(autoOut.tool_choice, { type: "auto" })
})

test("a factory request with no mapped declaration is returned unchanged", () => {
  const ctx = context()
  const body = {
    model: "claude-opus-5-5",
    tools: [toolBlock("Bash"), toolBlock("Read")],
    messages: [{ role: "user", content: [{ type: "text", text: `nothing to do with ${SHOW}` }] }],
  }
  const before = structuredClone(body)
  assert.equal(middleware.onProvider(body, { ...ctx, provider: FACTORY }), undefined)
  assert.deepEqual(body, before)
})

test("all 53 Paseo tool names are mapped and restored individually", () => {
  assert.equal(PASEO_TOOL_NAMES.length, 53)

  for (const tool of PASEO_TOOL_NAMES) {
    const original = paseoName(tool)
    const expected = paseoAlias(tool)
    const ctx = context()
    const body = {
      tools: [toolBlock(original)],
      tool_choice: { type: "tool", name: original },
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: original, input: { tool } }] },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                { type: "tool_reference", tool_name: original },
                { type: "tool_definition", definition: { name: original, description: tool, input_schema: { type: "object" } } },
                { type: "text", text: original },
              ],
            },
          ],
        },
      ],
    }
    const out = tryProvider(body, ctx)

    assert.equal(mappedAlias(ctx, original), expected, tool)
    assertAliasContract(expected, original)
    assert.equal(out.tools[0].name, expected, tool)
    assert.equal(out.tool_choice.name, expected, tool)
    assert.equal(out.messages[0].content[0].name, expected, tool)
    assert.equal(out.messages[1].content[0].content[0].tool_name, expected, tool)
    assert.equal(out.messages[1].content[0].content[1].definition.name, expected, tool)
    assert.equal(out.messages[1].content[0].content[2].text, original, tool)
    assert.equal(restoreFromEvent(ctx, expected), original, tool)

    const response = {
      id: "msg_individual",
      type: "message",
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: expected, input: { tool } }],
    }
    assert.equal(middleware.onResponse(response, ctx).content[0].name, original, tool)
  }
})

test("all 53 Paseo tool names map together with unique aliases and restore", () => {
  const ctx = context()
  const originals = PASEO_TOOL_NAMES.map(paseoName)
  const body = {
    tools: PASEO_TOOL_NAMES.map((tool) => toolBlock(paseoName(tool))),
    tool_choice: { type: "tool", name: originals[0] },
    messages: [
      {
        role: "assistant",
        content: PASEO_TOOL_NAMES.map((tool, index) => ({
          type: "tool_use",
          id: `toolu_${index}`,
          name: paseoName(tool),
          input: { index },
        })),
      },
    ],
  }
  const out = tryProvider(body, ctx)
  const aliases = out.tools.map((tool) => tool.name)

  assert.equal(ctx.state.toolNames.length, 53)
  assert.equal(new Set(aliases).size, 53)
  assert.deepEqual(aliases, PASEO_TOOL_NAMES.map(paseoAlias))
  assert.equal(out.tool_choice.name, paseoAlias(PASEO_TOOL_NAMES[0]))
  assert.deepEqual(
    out.messages[0].content.map((block) => block.name),
    PASEO_TOOL_NAMES.map(paseoAlias),
  )

  for (const tool of PASEO_TOOL_NAMES) {
    assertAliasContract(paseoAlias(tool), paseoName(tool))
    assert.equal(restoreFromEvent(ctx, paseoAlias(tool)), paseoName(tool), tool)
  }

  const response = {
    id: "msg_all",
    type: "message",
    role: "assistant",
    content: PASEO_TOOL_NAMES.map((tool, index) => ({
      type: "tool_use",
      id: `toolu_${index}`,
      name: paseoAlias(tool),
      input: { index },
    })),
  }
  const responseOut = middleware.onResponse(response, ctx)
  assert.deepEqual(
    responseOut.content.map((block) => block.name),
    PASEO_TOOL_NAMES.map(paseoName),
  )
  assert.deepEqual(
    responseOut.content.map((block) => block.id),
    PASEO_TOOL_NAMES.map((_, index) => `toolu_${index}`),
  )
})

test("arbitrary namespaces map independently without dropping namespace or tool", () => {
  const ctx = context()
  const cases = [
    ["mcp__github__create_issue", "github_create_issue"],
    ["mcp__gitlab__create_issue", "gitlab_create_issue"],
    ["mcp__paseo__create_issue", "paseo_create_issue"],
    ["mcp__team-1__create_issue_2", "team-1_create_issue_2"],
  ]
  const body = {
    tools: cases.map(([name]) => toolBlock(name)),
    messages: [
      {
        role: "assistant",
        content: cases.map(([name], index) => ({ type: "tool_use", id: `toolu_${index}`, name, input: {} })),
      },
    ],
  }
  const out = tryProvider(body, ctx)

  for (const [original, expected] of cases) {
    assert.equal(mappedAlias(ctx, original), expected)
    assertAliasContract(expected, original)
    assert.equal(restoreFromEvent(ctx, expected), original)
  }
  assert.deepEqual(out.tools.map((tool) => tool.name), cases.map(([, alias]) => alias))
  assert.deepEqual(out.messages[0].content.map((block) => block.name), cases.map(([, alias]) => alias))
})

test("namespace, tool and underscore boundaries are accepted", () => {
  const ctx = context()
  const cases = [
    ["mcp__ns1__tool_2", "ns1_tool_2"],
    ["mcp__ns-1__tool-2", "ns-1_tool-2"],
    ["mcp__my_namespace__long_tool_name", "my_namespace_long_tool_name"],
  ]
  const body = {
    tools: cases.map(([name]) => toolBlock(name)),
    messages: [],
  }
  const out = tryProvider(body, ctx)

  for (const [original, expected] of cases) {
    assert.equal(mappedAlias(ctx, original), expected)
    assertAliasContract(expected, original)
    assert.equal(restoreFromEvent(ctx, expected), original)
  }
  assert.deepEqual(out.tools.map((tool) => tool.name), cases.map(([, alias]) => alias))

  const multiCtx = context()
  const multi = "mcp__a__b__c"
  const multiOut = tryProvider({ tools: [toolBlock(multi)], messages: [] }, multiCtx)
  const multiAlias = mappedAlias(multiCtx, multi)
  assertAliasContract(multiAlias, multi)
  assert.equal(multiOut.tools[0].name, multiAlias)
  assert.equal(restoreFromEvent(multiCtx, multiAlias), multi)

  const prefixCtx = context()
  const prefixHeavy = "mcp__mcp____foo"
  const prefixOut = tryProvider({ tools: [toolBlock(prefixHeavy)], messages: [] }, prefixCtx)
  const prefixAlias = mappedAlias(prefixCtx, prefixHeavy)
  assertAliasContract(prefixAlias, prefixHeavy)
  assert.ok(!prefixAlias.startsWith("mcp__"))
  assert.equal(prefixOut.tools[0].name, prefixAlias)
  assert.equal(restoreFromEvent(prefixCtx, prefixAlias), prefixHeavy)
})

test("names outside the mcp__<namespace>__<tool> grammar stay untouched", () => {
  const invalidNames = [
    "",
    "mcp",
    "mcp__",
    "mcp____tool",
    "mcp__namespace__",
    "mcp__namespace__tool.name",
    "mcp__namespace__tool name",
    "mcp__命名空间__工具",
    "MCP__namespace__tool",
    "not-mcp__namespace__tool",
    "mcp__namespace_tool",
  ]

  for (const invalid of invalidNames) {
    const ctx = context()
    const body = { tools: [toolBlock(invalid), toolBlock(SHOW)], messages: [] }
    const out = tryProvider(body, ctx)

    assert.equal(out.tools[0].name, invalid)
    assert.equal(out.tools[1].name, SHOW_ALIAS)
    assert.equal(mappedAlias(ctx, invalid), undefined)
  }
})

test("long names get short unique aliases instead of a plain truncation", () => {
  const longNamespace = `team_${"n".repeat(40)}`
  const longTool = `operation_${"x".repeat(60)}`
  const first = `mcp__${longNamespace}__${longTool}_alpha`
  const second = `mcp__${longNamespace}__${longTool}_beta`

  const forwardCtx = context()
  const forward = tryProvider({
    tools: [toolBlock(first), toolBlock(second), toolBlock("Bash")],
    messages: [],
  }, forwardCtx)
  const firstAlias = mappedAlias(forwardCtx, first)
  const secondAlias = mappedAlias(forwardCtx, second)

  assertAliasContract(firstAlias, first)
  assertAliasContract(secondAlias, second)
  assert.notEqual(firstAlias, secondAlias)
  assert.equal(forward.tools[0].name, firstAlias)
  assert.equal(forward.tools[1].name, secondAlias)
  assert.equal(forward.tools[2].name, "Bash")
  assert.equal(restoreFromEvent(forwardCtx, firstAlias), first)
  assert.equal(restoreFromEvent(forwardCtx, secondAlias), second)

  const reversedCtx = context()
  tryProvider({
    tools: [toolBlock(second), toolBlock(first)],
    messages: [],
  }, reversedCtx)
  assert.equal(mappedAlias(reversedCtx, first), firstAlias)
  assert.equal(mappedAlias(reversedCtx, second), secondAlias)
})

test("different originals whose simple aliases collide stay unique and order-independent", () => {
  const first = "mcp__a_b__c"
  const second = "mcp__a__b_c"

  const forwardCtx = context()
  const forward = tryProvider({ tools: [toolBlock(first), toolBlock(second)], messages: [] }, forwardCtx)
  const firstAlias = mappedAlias(forwardCtx, first)
  const secondAlias = mappedAlias(forwardCtx, second)

  assertAliasContract(firstAlias, first)
  assertAliasContract(secondAlias, second)
  assert.notEqual(firstAlias, secondAlias)
  assert.equal(forward.tools[0].name, firstAlias)
  assert.equal(forward.tools[1].name, secondAlias)

  const reversedCtx = context()
  tryProvider({ tools: [toolBlock(second), toolBlock(first)], messages: [] }, reversedCtx)
  assert.equal(mappedAlias(reversedCtx, first), firstAlias)
  assert.equal(mappedAlias(reversedCtx, second), secondAlias)
})

test("a collision with a normalized MCP prefix can allocate and restore an alias", () => {
  const ctx = context()
  const original = "mcp__mcp____"
  const occupied = "mcp_"
  const out = tryProvider({ tools: [toolBlock(original), toolBlock(occupied)] }, ctx)
  const alias = out.tools[0].name

  assertAliasContract(alias, original)
  assert.notEqual(alias, occupied)
  assert.equal(out.tools[1].name, occupied)
  assert.equal(restoreFromEvent(ctx, alias), original)
})

test("aliases avoid names reserved by declarations, history, choices and references", () => {
  const target = "mcp__acme__deploy"
  const base = "acme_deploy"
  const ctx = context()
  const body = {
    tools: [toolBlock(target), toolBlock("Bash")],
    tool_choice: { type: "tool", name: base, custom: { keep: true } },
    messages: [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: base, input: { note: base } },
          { type: "tool_use", id: "t2", name: target, input: {} },
          { type: "tool_reference", tool_name: base },
          { type: "tool_removal", tool_name: base },
          { type: "tool_removal", tool: { type: "tool_reference", name: base } },
          { type: "tool_addition", tool: { type: "tool_reference", name: base } },
        ],
      },
    ],
  }
  const out = tryProvider(body, ctx)
  const alias = mappedAlias(ctx, target)

  assertAliasContract(alias, target)
  assert.notEqual(alias, base)
  assert.equal(out.tools[0].name, alias)
  assert.equal(out.tools[1].name, "Bash")
  assert.equal(out.tool_choice.name, base)
  assert.equal(out.messages[0].content[0].name, base)
  assert.deepEqual(out.messages[0].content[0].input, { note: base })
  assert.equal(out.messages[0].content[1].name, alias)
  assert.equal(out.messages[0].content[2].tool_name, base)
  assert.equal(out.messages[0].content[3].tool_name, base)
  assert.equal(out.messages[0].content[4].tool.name, base)
  assert.equal(out.messages[0].content[5].tool.name, base)

  const declaredCtx = context()
  const declared = tryProvider({
    tools: [toolBlock(target), toolBlock(base)],
    messages: [],
  }, declaredCtx)
  const declaredAlias = mappedAlias(declaredCtx, target)
  assertAliasContract(declaredAlias, target)
  assert.notEqual(declaredAlias, base)
  assert.equal(declared.tools[0].name, declaredAlias)
  assert.equal(declared.tools[1].name, base)
})

test("duplicate declarations of one original share a single alias", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW), toolBlock(SHOW, { description: "duplicate declaration" })],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_addition",
            tool: { type: "tool_definition", definition: { name: SHOW, input_schema: { type: "object" } } },
          },
        ],
      },
    ],
  }
  const out = tryProvider(body, ctx)

  assert.equal(ctx.state.toolNames.length, 1)
  assert.equal(mappedAlias(ctx, SHOW), SHOW_ALIAS)
  assert.deepEqual(out.tools.map((tool) => tool.name), [SHOW_ALIAS, SHOW_ALIAS])
  assert.equal(out.messages[0].content[0].tool.definition.name, SHOW_ALIAS)
})

test("declaration order and duplicates do not change the mapping", () => {
  const originals = [
    "mcp__paseo__progress_show",
    "mcp__github__create_issue",
    "mcp__a_b__c",
    "mcp__a__b_c",
    "mcp__team-1__deploy_v2",
    "mcp__deep_space__long_tool_name_with_many_parts",
  ]

  function mappingFor(order, duplicates = false) {
    const ctx = context()
    const tools = order.map((name) => toolBlock(name))
    if (duplicates) tools.push(toolBlock(order[0]))
    tryProvider({ tools, messages: [] }, ctx)
    return Object.fromEntries(ctx.state.toolNames.map(({ original, alias }) => [original, alias]))
  }

  const forward = mappingFor(originals)
  const reversed = mappingFor([...originals].reverse())
  const shuffled = mappingFor([originals[2], originals[5], originals[0], originals[4], originals[1], originals[3]])
  const duplicated = mappingFor(originals, true)

  assert.deepEqual(reversed, forward)
  assert.deepEqual(shuffled, forward)
  assert.deepEqual(duplicated, forward)
  assert.equal(Object.keys(forward).length, originals.length)
  assert.equal(new Set(Object.values(forward)).size, originals.length)
})

test("each candidate request uses only its own mapping", () => {
  const ctx = context()
  tryProvider({ tools: [toolBlock(SHOW)], messages: [] }, ctx)
  const firstAlias = mappedAlias(ctx, SHOW)
  assert.equal(firstAlias, SHOW_ALIAS)

  const second = "mcp__github__progress_show"
  tryProvider({ tools: [toolBlock(second)], messages: [] }, ctx)
  assert.equal(mappedAlias(ctx, SHOW), undefined)
  assert.equal(mappedAlias(ctx, second), "github_progress_show")
  assert.equal(restoreFromEvent(ctx, firstAlias), undefined)
  assert.equal(restoreFromEvent(ctx, "github_progress_show"), second)

  const response = {
    id: "msg_candidate",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "t", name: "github_progress_show", input: {} }],
  }
  assert.equal(middleware.onResponse(response, ctx).content[0].name, second)
})

test("fallback aliases are restored in non-streaming responses", () => {
  const ctx = context({ stream: false })
  const body = {
    tools: [toolBlock(SHOW), toolBlock(SHOW_ALIAS)],
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: SHOW, input: {} }] }],
  }
  tryProvider(body, ctx)
  const alias = mappedAlias(ctx, SHOW)
  assertAliasContract(alias, SHOW)
  assert.notEqual(alias, SHOW_ALIAS)

  const response = {
    id: "msg_fallback",
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: `Use ${alias}.`, signature: "sig-fallback" },
      { type: "tool_use", id: "toolu_1", name: alias, input: { path: "/" } },
      { type: "tool_use", id: "toolu_2", name: SHOW_ALIAS, input: {} },
    ],
  }
  const out = middleware.onResponse(response, ctx)
  assert.equal(out.content[0].signature, "sig-fallback")
  assert.equal(out.content[1].name, SHOW)
  assert.equal(out.content[1].id, "toolu_1")
  assert.equal(out.content[2].name, SHOW_ALIAS)
})
