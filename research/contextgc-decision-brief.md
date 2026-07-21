# ContextGC research decision brief

> Evidence cut: 2026-07-18 KST
> Product surface: Windows-first Codex plugin, local-first storage
> Decision: **GO, with a narrowed claim and a reversible control-plane architecture**

## 1. Executive decision

ContextGC should not be presented as a new compression algorithm or a replacement for Codex's native compactor. Native Codex compaction produces an opaque continuation state, and a normal plugin hook can observe, enrich, stop, or audit lifecycle events but has no documented action for starting compaction in an already-running Codex thread. A separately owned `codex app-server` thread does expose `thread/compact/start`, but that is a different integration boundary.

The defensible product is therefore:

> A Codex-specific, auditable context safety controller that protects typed invariants, snapshots exact source material, estimates token/cache economics, and makes every externalization reversible around native compaction.

The research hypothesis is deliberately narrower than “better memory”:

> On fixed software-engineering traces, can an invariant-gated, cache-aware break-even policy reduce a weighted token-cost proxy per verified successful task relative to manual and fixed-threshold policies, with zero critical-memory loss?

This wording avoids four unsupported claims:

- **No “first” claim.** Automatic compaction, cache-aware eviction, hierarchical memory, raw expansion, and checkpoint replay already exist in adjacent systems.
- **No “lossless” claim.** A summary is lossy. ContextGC can only claim that the archived source is byte-recoverable when it actually stores and verifies that source.
- **No “globally optimal” claim.** Exactness applies only to the explicitly defined small discrete selection model, not to semantic usefulness or future task success.
- **No “exact credits” claim.** OpenAI documents that Codex usage varies with model, context, reasoning, tools, retrieval, caching, and task duration; no public deterministic token-to-ChatGPT-credit conversion was found.

The machine-readable verdicts and counterevidence are in [`claim-ledger.json`](./claim-ledger.json).

## 2. Evidence standard

Sources are classified as follows:

| Class | Meaning | How it is used |
| --- | --- | --- |
| Official product documentation/source | Current behavior or supported integration surface | Product boundary and implementation contract |
| Peer-reviewed conference/journal | Established method or published empirical finding | Mathematical and evaluation prior art |
| Preprint/official project repository | Recent direction or author-reported result | Competitive landscape, never independent validation |
| ContextGC inference | Engineering conclusion derived from sources and local constraints | Must be falsified by tests before becoming a product claim |

`VERIFIED` means the cited source directly supports the claim. It does not mean an author-reported benchmark has been independently reproduced. `INFERENCE` is a product conclusion rather than a source fact. `UNKNOWN` means the public evidence is insufficient. `REJECTED` means counterevidence makes the proposed statement untenable.

## 3. Codex mechanism and integration boundary

### 3.1 What native compaction exposes

OpenAI's [Compaction guide](https://developers.openai.com/api/docs/guides/compaction) describes Responses compaction as a mechanism that reduces context while carrying forward prior state in an encrypted, opaque compaction item. The standalone compact endpoint returns a canonical next context window that should be passed onward as-is. This supports continuation, but it is not an inspectable semantic memory representation.

Codex configuration exposes `model_auto_compact_token_limit`, `model_auto_compact_token_limit_scope`, and a `compact_prompt` override in the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml). These are configuration controls, not a per-turn plugin actuation API.

### 3.2 What hooks can do

The official [Hooks guide](https://learn.chatgpt.com/docs/hooks) establishes the following usable surface:

| Event | Supported ContextGC use | Hard boundary |
| --- | --- | --- |
| `SessionStart` | Inject the last validated bounded Task Frame, including after `source=compact` | Injection is context, not native history replacement |
| `UserPromptSubmit` | Add bounded developer context or block unsafe submission | It does not rewrite the native context window |
| `PostToolUse` | Record supported tool input/output metadata after completion | It cannot undo the tool's side effects |
| `PreCompact` | Snapshot/audit and optionally return `continue:false` | Plain stdout is ignored; no documented “start compact” action |
| `PostCompact` | Record that compaction completed | It cannot inspect or reverse the compaction result |
| `Stop` | Continue once with a new prompt; `stop_hook_active` prevents recursion | An extra continuation consumes time and usage |

Every hook receives `session_id`, `transcript_path`, `cwd`, event name, and model. The same guide explicitly warns that the transcript format is not a stable hook interface. Consequently, the transcript adapter must be versioned, tolerate unknown records, and fail closed for semantic externalization.

Only command handlers currently run; prompt and agent hook handlers are parsed but skipped. Plugin-bundled hooks also require the normal trust review. The official [plugin structure](https://learn.chatgpt.com/docs/build-plugins#plugin-structure) supports a required `.codex-plugin/plugin.json` plus optional `hooks/`, `skills/`, `.mcp.json`, and assets.

### 3.3 Native actuation decision

OpenAI's [app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) exposes `thread/compact/start` and streams a `contextCompaction` item. This is suitable only when ContextGC is the client that owns the app-server thread. It does not establish that a normal plugin can seize and compact an arbitrary Desktop or CLI thread.

**Product decision:** P0 remains an observe/protect/recover plugin. App-server-managed compaction is an opt-in experimental adapter with a version pin and separate integration test. Failure of that adapter must not degrade checkpointing or recovery.

## 4. Tokens, caching, credits, and measurable economics

### 4.1 What can be measured

OpenAI's [Prompt Caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) states that cache hits require an exact prefix match. It also documents response fields for cache reads and, for GPT-5.6-family models, cache writes. This makes cache churn a material cost signal in an API-controlled experiment.

Codex can export structured telemetry, including token counts on completed responses, through opt-in OpenTelemetry according to the [advanced configuration documentation](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry). Hook input itself does not contain token or credit usage, and transcript records are explicitly unstable. ContextGC must therefore preserve provenance for every metric:

- `reported`: supplied by a supported API or Codex event;
- `derived`: arithmetic from reported token categories and a versioned rate snapshot;
- `estimated`: tokenizer or byte heuristic;
- `unavailable`: not observable in the current surface.

### 4.2 What cannot be claimed

The [Codex pricing documentation](https://learn.chatgpt.com/docs/pricing#what-are-the-usage-limits-for-my-plan) says that similar tasks can consume different usage because model choice, context, reasoning, tool use, retrieval, and caching all matter. It does not publish a deterministic conversion from local ChatGPT-authenticated Codex token events to credits charged.

Therefore the P0 receipt fields should be:

```text
weighted_token_proxy        comparable only under the same frozen weights
estimated_api_equivalent_usd optional hypothetical API-rate calculation
estimated_credits           null for ChatGPT-login sessions
actual_credits              never emitted unless OpenAI supplies an authoritative per-run value
```

An API-equivalent estimate is not the user's actual subscription spend. Rate snapshots must include source URL, retrieval date, model, service tier, and cache-write/read assumptions.

### 4.3 Primary economic metric

For local replay, use:

\[
\operatorname{UPVS}=
\frac{\sum_r (w_u U_r+w_c C_r+w_w W_r+w_o O_r)}
{\sum_r \mathbf{1}[\text{verified success}_r]}
\]

where `U`, `C`, `W`, and `O` are uncached input, cached input, cache-write, and output token categories. `O` already includes any charged reasoning output and must not be double-counted as a separate category. `w` values are frozen experiment weights, not credit conversion factors. If there is no verified success, UPVS is infinite.

Report raw categories alongside UPVS so the result remains auditable when weights change.

## 5. Mathematical controller

### 5.1 State and actions

At decision time `t`, use:

\[
x_t=(N_t,g_t,\hat H_t,R_t,W_t,\phi_t,M_t)
\]

- `N_t`: active-context token estimate and provenance;
- `g_t`: recent context growth per turn;
- `H_hat_t`: bounded remaining-turn forecast;
- `R_t`, `W_t`: observed/estimated cache reads and writes;
- `phi_t`: lifecycle phase (`explore`, `implement`, `verify`, `handoff`);
- `M_t`: candidate MemoryAtoms.

The action is:

\[
a_t=(z_t,\{m_i\},k_t), \quad
m_i\in\{KEEP,SUMMARIZE,EXTERNALIZE\}
\]

`DROP` is excluded. `z_t` requests a reversible checkpoint, not necessarily native compaction. `k_t` is the bounded rehydration budget.

### 5.2 Hard constraints before optimization

The optimizer may not trade away:

- explicit user constraints and forbidden changes;
- exact identifiers, paths, commands, error strings, and expected values marked `exact`;
- unresolved decisions and blockers;
- last known test commands and their authoritative outcomes;
- an archive pointer, source hash, and rollback checkpoint for every externalized atom.

If the protected set exceeds the injection budget, the controller must warn and externalize exact source with pointers; it must not silently summarize protected values.

### 5.3 Timing model

For a stationary comparison baseline, assume a checkpoint costs `K` weighted units, active context grows `g` tokens per turn, and retained growth costs `p` units per token-turn. The average proxy cost of interval `L` is:

\[
\bar C(L)=\frac{K}{L}+\frac{pg(L-1)}{2}
\]

The continuous relaxation has:

\[
L^*=\sqrt{\frac{2K}{pg}}
\]

This is a ContextGC engineering derivation, analogous to the classic checkpoint-cost versus rework trade-off introduced by Young's [checkpoint interval work](https://doi.org/10.1145/361147.361115). It is not a theorem about language-model quality. The assumptions fail when phase, growth, cache state, or loss risk changes, so P0 uses it only as a baseline plus lifecycle boundaries, hysteresis, and a hard safety cap.

Trigger a checkpoint only when:

\[
\widehat{S}_{future} > K_{checkpoint}+K_{cache}+K_{rehydrate}+\lambda\widehat{R}_{loss}+\delta
\]

The controller uses separate enter/exit thresholds and a two-turn cooldown. `H_hat_t` is a bounded rule from lifecycle phase and open loops; no learned horizon predictor ships in P0.

### 5.4 Selection model

For each atom `i` and action `j`, define token cost `b_ij`, utility `u_ij`, and risk `r_ij`. Solve the small multiple-choice knapsack:

\[
\max \sum_{i,j}u_{ij}y_{ij}
\]

subject to:

\[
\sum_{i,j}b_{ij}y_{ij}\le B,\quad
\sum_jy_{ij}=1,\quad
y_{ij}\in\{0,1\}
\]

plus forced KEEP/exact-externalize constraints. Integer dynamic programming is exact only for this frozen additive formulation and manageable budget. When diversity or coverage interactions are introduced, the objective may be modeled as submodular, but classical guarantees such as those in [Nemhauser and Wolsey](https://doi.org/10.1287/moor.3.3.177) require monotonicity and the stated constraint class. ContextGC will not advertise a generic approximation guarantee without proving those assumptions for its scoring function.

### 5.5 Why MPC and RL are deferred

The classic MPC survey by García, Prett, and Morari defines MPC around an explicit model and repeated finite-horizon optimization ([DOI](https://doi.org/10.1016/0005-1098(89)90002-2)). ContextGC does not yet have a calibrated transition model for task horizon, context growth, cache continuity, or semantic loss. Adding MPC or reinforcement learning before collecting independent trajectories would increase complexity without establishing better decisions.

Promotion gate for a predictive controller:

- horizon MAPE at most 25%;
- at least 5% UPVS improvement over the deterministic break-even controller;
- zero additional critical-memory misses;
- stable performance on a frozen holdout trace.

## 6. Research evidence for compression, retrieval, and risk

### Peer-reviewed foundations

1. **Prompt rate-distortion.** Nagle et al., [Fundamental Limits of Prompt Compression](https://proceedings.neurips.cc/paper_files/paper/2024/hash/ac8fbba029dadca99d6b8c3f913d3ed6-Abstract-Conference.html), NeurIPS 2024, formalize hard-prompt compression with a distortion-rate function and show query-aware compression is important in their evaluated setting. Product implication: distortion must be task-aware, not ROUGE or embedding similarity alone. Limitation: the paper's optimum is defined for its formal distribution/model, not a global optimum for coding-agent history.

2. **Task-trained retrieval compression.** Xu, Shi, and Choi, [RECOMP](https://openreview.net/forum?id=mlJLVigNHp), ICLR 2024, train extractive and abstractive compressors for end-task performance and selective augmentation. Product implication: irrelevant context may be omitted, but only after end-task evaluation. Limitation: retrieval QA/language modeling evidence does not establish safe compression of exact software-engineering state.

3. **Long-term interactive memory evaluation.** Wu et al., [LongMemEval](https://openreview.net/forum?id=pZiyCaVuti), ICLR 2025, evaluate extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention over 500 questions. Product implication: evaluate update/conflict and abstention, not only recall. Limitation: it is a conversational QA benchmark, so ContextGC needs coding fixtures with deterministic graders.

4. **Risk calibration.** Angelopoulos et al., [Conformal Risk Control](https://openreview.net/forum?id=33XGfHLtZg), ICLR 2024, control expected bounded monotone losses under conformal assumptions. [Learn then Test](https://doi.org/10.1214/24-AOAS1998), Annals of Applied Statistics 2025, selects parameter values through held-out statistical tests. Product implication: an automatic policy could eventually be calibrated to a critical-miss risk. Limitation: three handcrafted fixtures are not enough independent exchangeable data for a valid guarantee, so P0 uses deterministic fail-closed gates and makes no conformal guarantee.

5. **Checkpoint placement.** Toueg and Babaoglu's [checkpoint selection work](https://doi.org/10.1137/0213039) optimizes expected completion time under explicit task, save/restore, and failure models. Product implication: checkpoint timing is a cost/recovery optimization problem. Limitation: a coding agent's “information failure” process is neither independent nor known.

### Recent preprints: directional evidence only

- [ACON](https://arxiv.org/abs/2510.00615) reports optimizing natural-language compression guidelines using success/failure trajectories and reductions in peak tokens on its benchmarks. It also reports compressor latency and limited model coverage. Treat all numbers as author-reported until reproduced.
- [TokenPilot](https://arxiv.org/abs/2606.17016) explicitly studies cache continuity and lifecycle-aware eviction. This strongly defeats any novelty claim based only on “cache-aware context management.” It is a June 2026 preprint.
- [SWE-MeM](https://arxiv.org/abs/2606.28434) trains software-engineering agents to choose when, what, and how to compress. This defeats novelty based only on adaptive memory actions for coding agents. It is a June 2026 preprint.
- [MAGE: Memory as Agent-Guided Exploration](https://arxiv.org/abs/2606.06090) represents execution state as a hierarchical tree with grow/compress/maintain/revise operations. It is a June 2026 preprint and its results are author-reported.
- [LCM](https://arxiv.org/abs/2605.04050) uses a hierarchical summary DAG with stable pointers to original material. Its “lossless” label refers to retrievability of archived source, not preservation of every semantic detail inside the active summary.

## 7. Closest products and novelty boundary

| System | Existing capability supported by primary source | Consequence for ContextGC |
| --- | --- | --- |
| [Magic Context](https://github.com/cortexkit/magic-context) | Cache-deferred reductions, tagged history, background historian, structured facts, bounded raw expansion | Do not claim first cache-aware, reversible, or tiered agent memory |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/context-compression-and-caching.md) | Pluggable context engine, threshold compression, token accounting; Codex app-server mode uses native thread compaction | Do not claim first Codex-adjacent auto-compression controller |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management) | Background auto-compaction, manual `/compact`, structured summary and checkpoints; docs explicitly acknowledge detail loss | Make loss and recovery visible rather than promising perfect summaries |
| [Claude Code](https://code.claude.com/docs/en/context-window) | Automatic/manual compaction, persistent project instructions, explicit survival/loss rules | Typed invariant reinjection is established practice, not novelty |
| [Letta](https://docs.letta.com/guides/core-concepts/memory/memory-blocks) | Always-visible structured memory blocks plus archival search | Typed working memory and archival tiers are established |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/persistence) | Step checkpoints, replay, fork/time travel, durable stores | Reversibility alone is not differentiating |
| [LCM](https://arxiv.org/abs/2605.04050) | Summary DAG and raw-source pointers | Stable provenance and drill-down are prior art |

The defensible novelty is the combination and proof boundary:

- native Codex lifecycle integration rather than a replacement agent loop;
- typed software-engineering invariants and exact-value gates;
- explicit distinction among reported, derived, estimated, and unavailable usage;
- deterministic policy receipts and replay on identical traces;
- fail-closed reversible externalization around an opaque native compactor.

## 8. Evaluation and falsification protocol

Use three 10–12-turn traces: Exact Config Migration, Noisy Incident Debug, and Interrupted Refactor. Each has hidden deterministic tests, forbidden changes, exact values introduced early and required late, and a frozen completion criterion.

Compare:

- `MANUAL`: a human-authored schedule frozen before evaluation;
- `FIXED`: checkpoint at 75% normalized context, two-turn cooldown;
- `ADAPTIVE`: break-even timing plus hard invariant gate and safety cap.

Required receipts include trace/config/source hashes, Codex and adapter versions, metric provenance, raw token categories, policy decisions, protected-set audit, restore pointer, test result, and elapsed time.

Promotion gates:

| Gate | Required result | Failure action |
| --- | --- | --- |
| Critical retention | 100% | Disable automatic action for the failing atom type |
| Byte recovery | 100% for externalized source | Block release |
| Determinism | Same trace/config gives same decision and receipt hashes | Block benchmark claim |
| Economics | ADAPTIVE improves UPVS by at least 15% over FIXED and MANUAL | Reposition as safety/audit tool |
| Cache awareness | Cache-category prediction error at most 10% where reported data exists | Remove cache-aware performance claim |
| Native integration | Three clean Windows hook runs with no recursion or corrupted state | Ship simulator/advisory path only |
| Generalization | Independent holdout remains successful | Otherwise label result fixture-specific |

Current Build Week status (2026-07-18):

| Gate | Status | Evidence boundary / resulting action |
| --- | --- | --- |
| Critical retention | PASS on three authored synthetic fixtures | 100% for all supported policies; a corrupt-protected-fact negative control fails 3/3, proving the oracle can reject loss |
| Byte recovery | PASS for tested non-secret text paths | Hash-verified archive, bounded rehydrate and restore tests pass; arbitrary binary and production filesystem conditions are not promoted |
| Determinism | PASS for the checked-in fixture/config | Identical replay regenerates receipt `f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd` |
| Economics | FAIL | ADAPTIVE is 3.20% below FIXED but 9.36% above MANUAL; manual also requires six interventions, so the release is positioned as a safety/audit tradeoff rather than an economics win |
| Cache awareness | NOT_RUN | No calibrated prediction-error study; remove any production cache-savings claim |
| Native integration | NOT_RUN | Source/staged validation and direct hook fixtures are not three clean user-trusted live Windows runs; native behavior remains advisory |
| Generalization | NOT_RUN | Fixture authors also authored the oracles and there is no independent holdout; label every result synthetic and fixture-specific |

The current receipt records fixture/source hashes, metric provenance, raw token
categories, policy outcomes and test evidence. Codex/adapter version parity,
production restore pointers and elapsed-time receipts remain future promotion
evidence rather than silently satisfied fields.

No model self-judge determines task success. Do not mix API billing with ChatGPT subscription estimates, and do not present simulator runs as production proof.

## 9. Residual unknowns

1. **Credit attribution:** no authoritative per-run token-to-ChatGPT-credit mapping was found. This blocks numeric local-credit claims.
2. **Transcript stability:** hooks expose a transcript path but explicitly do not promise a stable format. Version drift remains a release risk.
3. **Native compact result semantics:** the opaque compaction item cannot be inspected for retained facts, so only downstream task behavior can evaluate it.
4. **Existing-thread actuation:** app-server can compact a thread it serves; a plugin path for initiating compaction in an arbitrary existing Desktop/CLI thread is not documented.
5. **Statistical risk guarantees:** the launch fixture count is too small for conformal or Learn-then-Test guarantees.
6. **Cache parity:** API prompt-caching rules do not prove identical cache accounting for ChatGPT-authenticated Codex sessions.
7. **Semantic scoring validity:** atom utility scores have no validated correlation with downstream coding success yet.

These unknowns are not blockers for a transparent local MVP. They are blockers for exact-credit, lossless, globally optimal, or statistically guaranteed claims.

## 10. Ship-language contract

Allowed:

> ContextGC is a Codex-specific, invariant-gated and reversible context controller. In our frozen local traces it reduced a declared weighted token proxy while preserving every critical fixture invariant.

Only after the benchmark passes may the percentage be inserted.

Disallowed:

- “the first automatic Codex compactor”;
- “lossless compression” or “never forgets”;
- “mathematically optimal context management”;
- “saves X% of Codex credits” without authoritative credit receipts;
- “quality is preserved” without hidden deterministic success evidence;
- “works with every Codex version” without a tested compatibility range.
