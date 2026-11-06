// Magpie agent plugin for MUSACode (摩尔线程 MUSACode).
//
// MUSACode keeps its settings in ~/.config/musacode/musacode.jsonc and reads
// the OpenCode config shape: a provider block with npm/options/models, and
// `model` as "provider/model". magpie writes its gateway into provider.magpie,
// then points `model` at magpie/<provider>/<model>; on disconnect every key
// magpie wrote is put back.
//
// The module runs in magpie's moejs host: no Node APIs, no imports from
// outside this package.
export const agent = {
  id: "musacode",
  name: "MUSACode",
  config: "~/.config/musacode/musacode.jsonc",
  format: "json",
  model: "model",
  prefix: "magpie/",
  dir: "~/.config/musacode",
  ua: ["musacode"],
  notice: "MUSACode 在启动时读取配置：重启它才会使用新模型。",
}

const PROVIDER = "magpie"
const NPM = "@ai-sdk/openai-compatible"
// The order OpenCode's picker shows reasoning levels in; unknown levels keep
// their order after these.
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]

function perMillion(price) {
  if (price === undefined || price === null || price === "") return undefined
  const n = Number(price)
  if (!Number.isFinite(n)) return undefined
  // keep binary floating point from leaking into the config (0.09999999999999)
  return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000
}

function sortedEfforts(efforts) {
  const seen = new Set()
  const out = []
  for (const effort of efforts) {
    if (typeof effort !== "string" || effort === "" || seen.has(effort)) continue
    seen.add(effort)
    out.push(effort)
  }
  return out.sort((a, b) => {
    const ia = EFFORT_ORDER.indexOf(a)
    const ib = EFFORT_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

function modelEntry(model) {
  const entry = { name: model.name || model.id }

  const context = Number(model.context)
  if (Number.isFinite(context) && context > 0) {
    const output = Number(model.output)
    entry.limit = { context, output: Number.isFinite(output) && output > 0 ? output : 0 }
  }

  if (model.images) {
    entry.modalities = { input: ["text", "image"], output: ["text"] }
  }

  const efforts = sortedEfforts(Array.isArray(model.efforts) ? model.efforts : [])
  if (efforts.length > 0) {
    // OpenCode 1 adds low/medium/high of its own to a model marked reasoning;
    // mark one only when those three are really there, as magpie does, or it
    // would offer levels the model doesn't have.
    if (["low", "medium", "high"].every((level) => efforts.includes(level))) entry.reasoning = true
    entry.variants = {}
    for (const effort of efforts) entry.variants[effort] = { reasoningEffort: effort }
  }

  // magpie's pricing is USD per token; OpenCode's cost is USD per million.
  if (model.pricing) {
    const cost = {}
    const input = perMillion(model.pricing.prompt)
    const output = perMillion(model.pricing.completion)
    const cacheRead = perMillion(model.pricing.input_cache_read)
    const cacheWrite = perMillion(model.pricing.input_cache_write)
    if (input !== undefined) cost.input = input
    if (output !== undefined) cost.output = output
    if (cacheRead !== undefined) cost.cache_read = cacheRead
    if (cacheWrite !== undefined) cost.cache_write = cacheWrite
    if (Object.keys(cost).length > 0) entry.cost = cost
  }

  return entry
}

export function connect({ gateway, models }) {
  const listed = {}
  for (const model of Array.isArray(models) ? models : []) {
    if (!model || typeof model.id !== "string" || model.id === "") continue
    listed[model.id] = modelEntry(model)
  }

  return {
    [`provider.${PROVIDER}`]: {
      npm: NPM,
      name: PROVIDER,
      options: { baseURL: gateway.v1, apiKey: gateway.key },
      models: listed,
    },
  }
}
