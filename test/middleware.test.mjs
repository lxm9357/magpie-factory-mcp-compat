import { test } from "node:test"
import assert from "node:assert/strict"

import * as middleware from "../paseo-factory-mcp.middleware.js"

const SHOW = "mcp__paseo__progress_show"
const UPDATE = "mcp__paseo__progress_ticket_update"
const SHOW_ALIAS = "paseo_progress_show"
const UPDATE_ALIAS = "paseo_progress_ticket_update"

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

test("a declared target-name conflict leaves that item untouched and derives no alias", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW), toolBlock(SHOW_ALIAS, { description: "the real one" })],
    tool_choice: { type: "tool", name: SHOW },
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: SHOW, input: { a: 1 } }] }],
  }
  const before = structuredClone(body)

  assert.equal(middleware.onProvider(body, { ...ctx, provider: FACTORY }), undefined)
  assert.deepEqual(body, before)
  assert.ok(!JSON.stringify(body).includes("paseo_progress_show_"))
})

test("one conflicting tool does not stop the other mapped tool", () => {
  const ctx = context()
  const body = {
    tools: [toolBlock(SHOW), toolBlock(UPDATE), toolBlock(SHOW_ALIAS)],
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: UPDATE, input: {} }] }],
  }
  const out = tryProvider(body, ctx)

  assert.equal(out.tools[0].name, SHOW)
  assert.equal(out.tools[1].name, UPDATE_ALIAS)
  assert.equal(out.tools[2].name, SHOW_ALIAS)
  assert.equal(out.messages[0].content[0].name, UPDATE_ALIAS)
})

test("an alias already used in assistant history disables only its own mapping", () => {
  const ctx = context()
  const history = [
    { type: "tool_use", id: "t1", name: SHOW_ALIAS, input: {} },
    { type: "tool_use", id: "t2", name: SHOW, input: { path: "/" } },
    { type: "tool_use", id: "t3", name: UPDATE, input: {} },
  ]
  const originalHistory = structuredClone(history)
  const out = tryProvider({
    tools: [toolBlock(SHOW), toolBlock(UPDATE)],
    tool_choice: { type: "tool", name: SHOW },
    messages: [{ role: "assistant", content: history }],
  }, ctx)

  assert.deepEqual(out.tools.map(tool => tool.name), [SHOW, UPDATE_ALIAS])
  assert.equal(out.tool_choice.name, SHOW)
  assert.deepEqual(out.messages[0].content, [
    originalHistory[0], originalHistory[1], { ...originalHistory[2], name: UPDATE_ALIAS },
  ])
  const event = {
    type: "content_block_start",
    content_block: { type: "tool_use", id: "t4", name: SHOW_ALIAS, input: {} },
  }
  assert.equal(middleware.onEvent(event, ctx), undefined)
})

test("a target name taken by a delayed tool definition also counts as a conflict", () => {
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
  const before = structuredClone(body)
  assert.equal(middleware.onProvider(body, { ...ctx, provider: FACTORY }), undefined)
  assert.deepEqual(body, before)
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
