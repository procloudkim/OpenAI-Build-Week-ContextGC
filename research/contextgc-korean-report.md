# ContextGC 심층 연구 보고서

> **부제:** Codex native compaction을 대체하지 않고, 그 전후의 기억 손실 위험과 비용을 통제하는 가역적 context safety controller
>
> **대상 독자:** OpenAI Build Week 심사위원, AI·시스템 엔지니어링 검토자
>
> **증거 기준일:** 2026-07-18 KST
>
> **근거 범위:** [`contextgc-decision-brief.md`](./contextgc-decision-brief.md)와 [`claim-ledger.json`](./claim-ledger.json)에 수록된 주장·출처·반증만 사용

## Executive Summary

**결론은 조건부 GO다.** ContextGC가 방어적으로 주장할 수 있는 제품은 “새로운 압축 알고리즘”이나 “Codex의 native compactor 대체재”가 아니다. 현재 공적 근거가 지지하는 제품 정의는 다음과 같다.

> **ContextGC는 Codex 전용의 invariant-gated, reversible context controller다.** 명시적 사용자 제약, exact identifier, unresolved blocker, 검증 명령과 결과를 보호하고, native compaction 전후에 원문·해시·checkpoint·policy receipt를 남겨 잘못된 외부화를 복구 가능하게 만든다.

핵심 판단은 여섯 가지다.

1. **Native compaction은 continuation을 가능하게 하지만 의미적으로 투명하지 않다 — `VERIFIED`.** OpenAI Responses compaction은 이전 상태를 opaque encrypted compaction item으로 이어 가며 더 작은 context를 제공한다. 그러나 그 내부에 어떤 exact fact가 남았는지 직접 감사할 수 없고, downstream task quality도 보장하지 않는다. [OpenAI Compaction guide](https://developers.openai.com/api/docs/guides/compaction)

2. **일반 Codex plugin hook은 기존 Desktop/CLI thread의 native compaction을 직접 시작하는 문서화된 권한이 없다 — `UNKNOWN`.** Hook은 관찰, bounded context injection, snapshot, veto, audit에는 적합하지만 “지금 이 thread를 compact하라”는 documented action은 확인되지 않았다. 반면 자신이 소유한 app-server thread에는 `thread/compact/start`가 존재한다. [OpenAI Codex Hooks](https://learn.chatgpt.com/docs/hooks), [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

3. **압축 효율은 token 감소만으로 판정할 수 없다 — `VERIFIED`.** Prompt compression에는 task-dependent rate-distortion trade-off가 있으며, exact coding constraint 손실은 text similarity만으로 검출할 수 없다. 성공한 task를 분모로 둔 비용 proxy와 critical invariant retention을 함께 측정해야 한다. [Fundamental Limits of Prompt Compression, NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/hash/ac8fbba029dadca99d6b8c3f913d3ed6-Abstract-Conference.html)

4. **Token에서 ChatGPT-authenticated Codex의 실제 credits로 가는 결정론적 환산식은 공개 근거에서 확인되지 않았다 — `UNKNOWN`.** 따라서 ContextGC는 actual credits 절감률을 주장하지 않고, raw token categories, frozen weights를 쓴 weighted proxy, 선택적 API-equivalent USD만 분리해 표시해야 한다. [Codex pricing](https://learn.chatgpt.com/docs/pricing)

5. **수학적 최적화는 제한된 문제에만 정확하다 — `INFERENCE`.** 작은 additive `KEEP / SUMMARIZE / EXTERNALIZE` 선택 문제는 명시된 integer budget 아래 discrete dynamic programming으로 정확히 풀 수 있다. 그러나 semantic utility가 잘못 추정되거나 atom 간 상호작용이 생기면 이 exactness는 사라진다. “전역적으로 최적인 기억 관리”라는 표현은 허용되지 않는다.

6. **현재 합성 fixture 설계는 falsification 도구이지 production proof가 아니다.** 세 개의 handcrafted coding trace와 deterministic hidden grader는 회귀와 실패 탐지에는 유용하지만, independent holdout·통계적 risk guarantee·실사용 일반화를 입증하기에는 부족하다. ContextGC는 이 한계를 제품 메시지에 포함해야 한다.

심사 관점에서 ContextGC의 차별점은 개별 기능의 최초성이 아니다. Cache-aware timing, automatic compaction, tiered memory, checkpoint replay, raw-source pointer는 모두 prior art가 있다. 방어 가능한 차별점은 **Codex lifecycle에 설치되는 control plane, typed software-engineering invariants, metric provenance, deterministic receipt, fail-closed reversible externalization의 결합**이다.

## 1. Claim Boundary: 무엇을 말할 수 있고 무엇을 말할 수 없는가

### 1.1 판정 체계

`claim-ledger.json`의 36개 주장은 다음과 같이 분포한다.

| 판정 | 건수 | 의미 | 이 보고서에서의 사용 원칙 |
| --- | ---: | --- | --- |
| `VERIFIED` | 27 | 인용한 official/primary source가 해당 사실을 직접 지지 | 제품 경계와 prior art의 근거로 사용. 저자 보고 benchmark는 독립 재현으로 간주하지 않음 |
| `INFERENCE` | 2 | 검증된 사실에서 도출한 ContextGC 공학 결론 | 구현·시험 전에는 제품 성능 사실로 승격하지 않음 |
| `UNKNOWN` | 2 | 조사한 공개 primary source가 주장을 확립하지 못함 | 숫자·기능을 추정하지 않고 null 또는 experimental boundary로 유지 |
| `REJECTED` | 5 | 공식 근거나 prior art가 제안된 표현을 반박 | 제품·제출·데모 문구에서 금지 |

### 1.2 핵심 claim-boundary table

| 질문 | 판정 | 근거가 허용하는 답 | 금지되는 확대 해석 | 제품 결정 |
| --- | --- | --- | --- | --- |
| Codex에는 compaction lifecycle hook이 있는가? | `VERIFIED` | `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `PostCompact`, `Stop`을 control plane에 사용할 수 있음 | Event 존재가 원하는 모든 action의 권한을 뜻함 | Observe, inject, snapshot, audit, fail-closed control에 사용 |
| Native compaction 결과를 의미적으로 검사할 수 있는가? | `VERIFIED` | Responses compaction은 opaque continuation item을 반환 | 내부에 exact fact가 남았다고 검사·보증함 | Downstream hidden test와 invariant probe로만 평가 |
| Plugin이 기존 thread를 즉시 compact할 수 있는가? | `UNKNOWN` | 문서상 `PreCompact` veto와 static threshold config는 확인됨 | 임의 Desktop/CLI thread에 start-compaction action이 있다고 주장 | P0 native actuation 제외 |
| App-server 소유 thread를 compact할 수 있는가? | `VERIFIED` | 소유 client는 `thread/compact/start`를 요청 가능 | 다른 client가 소유한 thread까지 제어 가능 | Version-pinned experimental adapter로 격리 |
| Prompt length가 곧 usage인가? | `REJECTED` | Usage에는 model, context, reasoning, tools, retrieval, caching, duration 등이 관여 | Prompt length 단일 변수로 비용·효율 판정 | Raw categories와 task success를 함께 보고 |
| Token을 실제 Codex credits로 정확히 환산할 수 있는가? | `UNKNOWN` | 공개된 결정론적 per-run conversion을 확인하지 못함 | “credits X% 절감” 산출 | ChatGPT-login에서는 credits 필드를 null로 유지 |
| 작은 선택 최적화가 exact한가? | `INFERENCE` | 선언된 additive finite DP instance에 한해 exact | Semantic usefulness나 미래 성공까지 전역 최적 | Inputs·constraints·receipt를 공개하고 claim 범위를 제한 |
| 모든 utility score에 submodular 보장이 적용되는가? | `REJECTED` | 보장은 monotone submodularity와 constraint class 증명이 필요 | 임의 heuristic score에 approximation theorem 적용 | 증명 전에는 deterministic heuristic 또는 exact DP 사용 |
| Active summary는 lossless인가? | `REJECTED` | 별도로 저장·검증한 source bytes만 byte-recoverable | “never forgets”, “lossless compression” | Summary와 archive 복구 가능성을 분리 |
| ContextGC가 세계 최초인가? | `REJECTED` | 개별 구성 요소 모두 명시적 prior art가 있음 | Automatic/cache-aware/reversible memory의 first claim | Codex-specific combination과 proof boundary만 주장 |

### 1.3 제출용 표현 계약

다음 문구는 evidence boundary 안에 있다.

> ContextGC is a Codex-specific, invariant-gated and reversible context controller. In frozen local traces it changed a declared weighted token proxy while preserving every critical fixture invariant.

단, 실제 benchmark가 promotion gate를 통과하고 receipt가 검증되기 전에는 “reduced”나 구체적 백분율로 강화하면 안 된다.

다음 표현은 금지한다.

- “the first automatic Codex compactor”
- “lossless context compression” 또는 “never forgets”
- “mathematically optimal context management”
- authoritative credit receipt 없이 “Codex credits X% 절감”
- hidden deterministic task evidence 없이 “quality preserved”
- compatibility range 검증 없이 “모든 Codex 버전 지원”

## 2. Codex Native Compaction: 작동 방식과 통합 경계

### 2.1 Native compaction은 context continuation이지 inspectable memory가 아니다

OpenAI의 [Compaction guide](https://developers.openai.com/api/docs/guides/compaction)는 Responses compaction을 이전 상태를 더 적은 token으로 이어 가기 위한 기능으로 설명한다. Standalone compact endpoint는 다음 요청에 그대로 전달할 canonical next context window를 반환하고, 이전 상태는 encrypted opaque compaction item으로 운반된다. 이 사실은 **continuation capability**를 지지하지만, 다음을 지지하지는 않는다.

- 어떤 exact identifier가 보존되었는지 내부 item을 열어 검사할 수 있다는 주장
- 모든 semantic detail이 유지되었다는 주장
- 같은 task success를 보장한다는 주장
- Compaction item 자체를 ContextGC의 inspectable memory graph로 사용할 수 있다는 주장

따라서 native compactor의 품질은 내부 표현을 읽어 평가하는 것이 아니라, compact 이후의 정확한 행동으로 평가해야 한다. 예를 들어 초기 turn의 path, expected value, forbidden change가 후반 hidden test에서 그대로 충족되는지 확인해야 한다.

### 2.2 Configuration은 static control이고 per-turn actuation API가 아니다

[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)는 `model_auto_compact_token_limit`, `model_auto_compact_token_limit_scope`, `compact_prompt` 같은 control을 제공한다. 이는 자동 압축 한계와 범위, prompt를 구성하는 설정이지, plugin이 임의의 live turn에서 native compaction을 호출하는 action contract가 아니다.

**구현 결정:** ContextGC는 사용자의 Codex configuration을 자동 변경하지 않는다. Config는 simulation context로 읽을 수 있지만, runtime mutation은 별도의 안전성과 지원 계약이 확인되기 전까지 제외한다.

### 2.3 Hook은 compaction 주변의 control plane이다

[OpenAI Codex Hooks](https://learn.chatgpt.com/docs/hooks)가 지지하는 ContextGC의 역할은 다음과 같다.

| Hook event | ContextGC가 할 수 있는 일 | 할 수 없는 일 |
| --- | --- | --- |
| `SessionStart` | 마지막 schema-valid, bounded Task Frame을 developer context로 주입 | Native history 자체를 교체하거나 복원 |
| `UserPromptSubmit` | Bounded developer context 추가, unsafe submission 차단 | Native context window를 직접 재작성 |
| `PostToolUse` | 지원되는 tool input/output metadata 기록 | 이미 발생한 tool side effect 취소 |
| `PreCompact` | Source snapshot, audit, 필요 시 `continue:false` | 문서화되지 않은 start-compaction action 실행, stdout로 context 주입 |
| `PostCompact` | Compaction 완료 event 기록 | Opaque result의 semantic detail 검사, native result 되돌리기 |
| `Stop` | 한 번의 continuation prompt 요청 | Recursion-free 무제한 loop; 추가 continuation은 usage와 latency를 소비 |

Hook common input의 `transcript_path`는 유용한 관찰 지점이지만, OpenAI 문서는 transcript format을 stable hook interface로 보장하지 않는다. 따라서 adapter는 다음 원칙을 가져야 한다.

- Codex version과 transcript schema compatibility를 명시한다.
- Unknown record를 무시하거나 보존하되 semantic externalization을 추측하지 않는다.
- Unsupported schema에서는 fail closed한다.
- Stable API처럼 transcript 구조를 제품 contract에 노출하지 않는다.

현재 문서 기준으로 command handler가 실행 표면이며 prompt·agent handler와 async command hook은 사용할 수 있는 runtime contract가 아니다. Plugin hook은 정상적인 trust review도 거쳐야 한다.

### 2.4 App-server actuation은 별도 제품 경계다

[Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)은 client가 자신이 소유한 thread에 `thread/compact/start`를 요청하고 `contextCompaction` lifecycle item을 관찰할 수 있음을 보여 준다. 그러나 이것은 일반 plugin이 다른 client의 Desktop/CLI thread를 탈취하거나 compact할 수 있음을 뜻하지 않는다.

**P0 결정:**

- 일반 plugin 경로: observe → protect → checkpoint → recover
- App-server 경로: opt-in, version-pinned, experimental adapter
- App-server 실패 시: checkpoint와 recovery는 계속 작동
- Arbitrary existing-thread actuation: `UNKNOWN` 상태 유지

이 경계는 약점이 아니라 claim discipline이다. ContextGC는 native compactor를 통제한다고 과장하는 대신, 불투명한 compaction 주변에 감사 가능하고 복구 가능한 safety envelope를 제공한다.

## 3. 효율과 Context Loss: 무엇을 최적화해야 하는가

### 3.1 Token 감소와 task quality는 같은 변수가 아니다

[Fundamental Limits of Prompt Compression](https://proceedings.neurips.cc/paper_files/paper/2024/hash/ac8fbba029dadca99d6b8c3f913d3ed6-Abstract-Conference.html)은 prompt compression을 task-dependent rate-distortion 문제로 정식화하고, 해당 실험 조건에서 query-aware compression의 중요성을 보였다. ContextGC에 주는 함의는 분명하다.

- Compression ratio만으로 quality를 판정할 수 없다.
- ROUGE나 embedding similarity만으로 coding task의 critical fact retention을 보증할 수 없다.
- Distortion은 downstream task failure, exact invariant miss, forbidden change violation으로 측정해야 한다.
- 같은 summary라도 task phase와 future query에 따라 utility가 달라진다.

이 논문이 ContextGC의 전역 optimum을 보증하는 것은 아니다. Formal distribution과 model이 다른 실제 coding trajectory에 그대로 이전할 수 없기 때문이다.

### 3.2 End-task evaluation이 compression policy의 기준이어야 한다

[RECOMP, ICLR 2024](https://openreview.net/forum?id=mlJLVigNHp)는 retrieval context를 end-task performance에 맞춰 압축하고 selective augmentation하는 접근을 평가했다. 그러나 그 결과는 retrieval QA와 language modeling에서 나온 것이므로 exact command, path, error string, expected value가 중요한 software-engineering context 안전성을 직접 입증하지 않는다.

ContextGC는 이를 다음처럼 제한적으로 채택한다.

- Relevance가 낮은 context를 active window에서 제외할 수 있다.
- Exact protected value는 semantic summary 대상으로 삼지 않는다.
- Selection quality는 text similarity가 아니라 hidden coding-task success로 검증한다.
- 실패한 externalization은 source archive와 checkpoint로 되돌릴 수 있어야 한다.

### 3.3 Long-term memory는 recall뿐 아니라 update와 abstention을 평가해야 한다

[LongMemEval, ICLR 2025](https://openreview.net/forum?id=pZiyCaVuti)는 긴 interactive history에서 extraction, multi-session reasoning, temporal reasoning, knowledge update, abstention을 평가한다. ContextGC가 가져와야 할 핵심은 단순 “기억했는가”보다 넓다.

- 오래된 값이 새 값으로 수정되었을 때 최신성을 유지하는가?
- 서로 충돌하는 evidence를 잘못 합치지 않는가?
- 불확실하거나 archive가 손상되었을 때 추측 대신 abstain하는가?
- 시간 순서와 decision lineage를 보존하는가?

다만 LongMemEval은 conversational QA benchmark다. ContextGC의 software-engineering claim에는 deterministic grader가 있는 coding fixture가 별도로 필요하다.

### 3.4 “효율적”의 최소 정의

ContextGC가 효율을 주장하려면 최소한 다음 두 축을 동시에 통과해야 한다.

1. **경제성:** 동일한 frozen trace와 동일한 metric weights 아래 verified success당 weighted token proxy가 baseline보다 낮다.
2. **안전성:** Critical invariant retention과 externalized source의 byte recovery가 100%다.

둘 중 하나만 통과하면 결론이 달라진다.

| 경제성 | 안전성 | 해석 |
| --- | --- | --- |
| 개선 | 통과 | 제한된 fixture에서 context controller 효과를 주장 가능 |
| 개선 | 실패 | 비용은 줄었지만 task correctness를 훼손; automatic action 중지 |
| 미개선 | 통과 | Safety/audit/recovery 도구로 재포지셔닝 |
| 미개선 | 실패 | 제품 가설 기각 또는 설계 재작성 |

## 4. Token, Cache, Credits: 측정 가능한 것과 불가능한 것

### 4.1 Cache continuity는 실제 비용 신호지만 surface별 차이를 보존해야 한다

[OpenAI Prompt Caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)에 따르면 cache hit에는 exact prefix match가 필요하다. API response는 cached-token category를 보고하며 GPT-5.6 family에서는 cache-write category도 보고한다. 이 때문에 context를 자주 재구성하면 active token 수가 줄더라도 prefix continuity가 깨져 cache economics가 악화될 수 있다.

하지만 API의 prompt-caching rule이 ChatGPT-authenticated Codex session에서도 동일한 accounting으로 적용된다는 보장은 없다. 따라서 cache 관련 모든 값에는 provenance가 필요하다.

| Provenance | 의미 | 허용되는 사용 |
| --- | --- | --- |
| `reported` | 지원되는 API 또는 Codex event가 직접 제공 | Raw receipt와 계산 입력 |
| `derived` | Reported category와 versioned rate snapshot에서 산술 계산 | 가정과 rate source를 함께 표시 |
| `estimated` | Tokenizer 또는 byte heuristic | 비교용 추정치로만 사용 |
| `unavailable` | 현재 surface에서 관찰 불가 | 0으로 대체하지 않고 null 유지 |

[Codex observability documentation](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry)은 opt-in OpenTelemetry를 통한 structured token telemetry를 설명한다. 반면 hook input 자체는 token/credit usage를 제공하지 않고 transcript format도 불안정하다. 따라서 metric pipeline은 “없음”과 “0”을 구분해야 한다.

### 4.2 Prompt length 단일 변수설은 기각된다

[Codex pricing documentation](https://learn.chatgpt.com/docs/pricing#what-are-the-usage-limits-for-my-plan)은 similar task도 model, context, reasoning, tool use, retrieval, caching, task size, duration 등에 따라 usage가 달라질 수 있음을 설명한다.

따라서 다음 추론은 `REJECTED`다.

> Context가 30% 짧아졌으므로 Codex usage 또는 credits도 30% 줄었다.

Context length는 입력 변수 중 하나일 뿐이다. 압축 때문에 추가 model call, rehydration, cache miss, tool retry가 발생하면 총 usage는 반대로 증가할 수 있다.

### 4.3 실제 credits 환산은 공개 근거가 부족하다

조사 범위의 [Codex pricing](https://learn.chatgpt.com/docs/pricing)과 [Work mode usage FAQ](https://learn.chatgpt.com/docs/enterprise/work-admin-faq#how-does-work-mode-usage-translate-into-spend-over-time)는 local ChatGPT-authenticated Codex의 token event를 per-run actual credits로 바꾸는 결정론적 공식을 제공하지 않는다. 판정은 `UNKNOWN`이다.

따라서 P0 receipt 계약은 다음과 같아야 한다.

```text
weighted_token_proxy          동일한 frozen weights 안에서만 비교
estimated_api_equivalent_usd  선택적·가상 API-rate 계산
estimated_credits             ChatGPT-login session에서는 null
actual_credits                OpenAI가 authoritative per-run 값을 제공할 때만 기록
```

`estimated_api_equivalent_usd`도 실제 subscription spend가 아니다. Rate snapshot에는 URL, retrieval date, model, service tier, cache read/write assumption이 있어야 한다.

### 4.4 Primary economic metric: UPVS

동일한 local replay에서 사용할 비교 지표는 다음과 같다.

\[
\operatorname{UPVS}=\frac{\sum_r(w_uU_r+w_cC_r+w_wW_r+w_oO_r)}
{\sum_r\mathbf{1}[\text{verified success}_r]}
\]

- \(U_r\): uncached input tokens
- \(C_r\): cached input tokens
- \(W_r\): cache-write tokens
- \(O_r\): output tokens. Charged reasoning output을 이미 포함하므로 별도 항으로 다시 더하지 않는다.
- \(w_*\): 실험 전에 고정한 비교 weight이며 credit conversion factor가 아님

Verified success가 하나도 없으면 UPVS는 무한대다. 이는 token을 적게 쓰고 task를 실패한 policy가 “효율적”으로 보이는 오류를 막는다. 모든 보고서는 UPVS뿐 아니라 raw categories를 함께 제시해야 weight 변경에도 재감사가 가능하다.

**Claim boundary:** UPVS는 ContextGC experiment metric이지 OpenAI billing metric도, externally validated credits metric도 아니다. 이를 actual credits로 표현하는 주장은 `REJECTED`다.

## 5. Mathematical Formulation: 제한된 exactness와 fail-closed control

### 5.1 State와 action

Decision time \(t\)의 상태를 다음과 같이 둔다.

\[
x_t=(N_t,g_t,\hat H_t,R_t,W_t,\phi_t,M_t)
\]

| 변수 | 의미 |
| --- | --- |
| \(N_t\) | Active-context token estimate와 provenance |
| \(g_t\) | 최근 turn당 context growth |
| \(\hat H_t\) | 남은 turn 수의 bounded forecast |
| \(R_t, W_t\) | 관찰 또는 추정된 cache read/write |
| \(\phi_t\) | Lifecycle phase: `explore`, `implement`, `verify`, `handoff` |
| \(M_t\) | 후보 MemoryAtom 집합 |

Action은 다음과 같다.

\[
a_t=(z_t,\{m_i\},k_t),\qquad m_i\in\{KEEP,SUMMARIZE,EXTERNALIZE\}
\]

- \(z_t\): reversible checkpoint 요청. Native compaction 요청과 동일하지 않음
- \(m_i\): 각 atom의 처리 방식
- \(k_t\): bounded rehydration budget
- `DROP`: 설계에서 제외

### 5.2 Optimization 전에 적용하는 hard constraints

다음 항목은 utility score와 교환할 수 없다.

- 명시적 사용자 constraint와 forbidden change
- `exact`로 표시된 identifier, path, command, error string, expected value
- unresolved decision과 blocker
- 마지막 authoritative test command와 결과
- externalized atom마다 archive pointer, source hash, rollback checkpoint

Protected set이 injection budget을 넘으면 controller는 경고하고 exact source를 pointer와 함께 externalize해야 한다. Protected value를 조용히 요약하거나 버리는 것은 허용되지 않는다.

이 순서가 중요하다. 먼저 feasible set을 safety constraint로 자르고, 그 안에서만 비용 최적화를 수행한다. 즉 ContextGC의 최적화 목표는 correctness보다 상위가 아니라, correctness gate를 통과한 후보 사이의 선택이다.

### 5.3 Checkpoint interval의 stationary baseline

Checkpoint cost를 \(K\), active context growth를 turn당 \(g\), retained growth의 token-turn cost를 \(p\)라고 하면 interval \(L\)의 평균 proxy cost는 다음과 같다.

\[
\bar C(L)=\frac{K}{L}+\frac{pg(L-1)}{2}
\]

Continuous relaxation의 stationary optimum은 다음과 같다.

\[
L^*=\sqrt{\frac{2K}{pg}}
\]

이는 Young의 [optimum checkpoint interval 연구](https://doi.org/10.1145/361147.361115)에서 영감을 받은 ContextGC engineering derivation이며, language-model semantic quality에 대한 theorem이 아니다. Task phase, growth, cache, loss risk가 nonstationary하면 내부 optimum이 무의미할 수 있다.

따라서 P0는 \(L^*\)를 자동 truth로 쓰지 않고 다음 장치를 추가한다.

- Lifecycle boundary trigger
- Enter/exit threshold를 분리한 hysteresis
- Two-turn cooldown
- Hard safety cap
- Learned model 대신 phase와 open loop에 기반한 bounded horizon rule

### 5.4 Break-even trigger

Checkpoint는 예상 future saving이 모든 직접·간접 비용과 margin을 넘을 때만 제안한다.

\[
\widehat S_{future}>
K_{checkpoint}+K_{cache}+K_{rehydrate}+\lambda\widehat R_{loss}+\delta
\]

- \(K_{checkpoint}\): snapshot·serialization 비용
- \(K_{cache}\): prefix continuity 변화로 인한 cache churn 비용
- \(K_{rehydrate}\): 후속 retrieval·injection 비용
- \(\widehat R_{loss}\): critical information loss 위험 추정
- \(\lambda\): risk penalty
- \(\delta\): jitter와 thrashing을 막는 safety margin

이 식은 transparent policy decision을 위한 proxy다. 각 term의 provenance와 assumption을 receipt에 남기지 않으면 수치가 설명력을 잃는다.

### 5.5 MemoryAtom selection은 작은 선언된 문제에서만 exact하다

Atom \(i\)와 action \(j\)에 대해 token cost \(b_{ij}\), utility \(u_{ij}\), risk \(r_{ij}\)를 두고 다음 multiple-choice knapsack을 푼다.

\[
\max\sum_{i,j}u_{ij}y_{ij}
\]

subject to

\[
\sum_{i,j}b_{ij}y_{ij}\le B,\qquad
\sum_jy_{ij}=1,\qquad
y_{ij}\in\{0,1\}
\]

여기에 forced `KEEP`와 exact-source externalization constraint가 추가된다. Manageable integer budget과 additive utility가 고정된 경우 discrete dynamic programming은 이 finite instance를 정확히 풀 수 있다 — `INFERENCE`.

그러나 exactness는 다음으로 확장되지 않는다.

- Utility score가 downstream success를 정확히 나타낸다는 보장
- Atom 사이의 dependency와 coverage interaction
- 미래 user request 분포
- Semantic fidelity의 전역 optimum

[Nemhauser and Wolsey](https://doi.org/10.1287/moor.3.3.177)의 classical approximation guarantee도 objective가 nondecreasing submodular이고 해당 constraint class를 만족한다는 증명이 있어야 적용할 수 있다. 임의 ContextGC score에 generic guarantee를 붙이는 주장은 `REJECTED`다.

### 5.6 MPC와 RL을 지금 사용하지 않는 이유

[García, Prett, and Morari의 MPC survey](https://doi.org/10.1016/0005-1098(89)90002-2)는 MPC가 explicit model과 반복적 finite-horizon optimization에 의존함을 보여 준다. ContextGC는 아직 task horizon, context growth, cache continuity, semantic loss transition model을 calibration하지 못했다.

따라서 P0에 MPC나 reinforcement learning을 넣는 것은 “수학적으로 고급”이라는 인상은 줄 수 있어도, 더 나은 결정을 입증하지는 못한다. Predictive controller의 promotion 조건은 다음과 같다.

- Horizon MAPE ≤ 25%
- Deterministic break-even controller보다 UPVS ≥ 5% 개선
- Additional critical-memory miss = 0
- Frozen holdout trace에서 안정적 성공

이 조건을 통과하기 전까지 deterministic controller가 production baseline이다.

## 6. Reversible Memory Architecture: Summary가 아니라 복구 계약

### 6.1 MemoryAtom과 Task Frame

ContextGC의 active representation은 자유형 “대화 요약문” 하나가 아니라 typed MemoryAtom의 집합과 bounded Task Frame이다. 최소한 다음 class를 구분해야 한다.

- Explicit user constraints와 forbidden changes
- Exact identifiers, paths, commands, error strings, expected values
- Open decisions와 blockers
- Last-known authoritative test command와 outcome
- Supporting rationale와 stale/noisy observations

이 구조의 목적은 모든 내용을 영구적으로 active window에 두는 것이 아니다. Future action을 잘못 바꿀 수 있는 invariant를 typed field로 승격하고, 나머지는 source pointer를 통해 bounded rehydration 가능하게 만드는 것이다.

### 6.2 세 action과 `DROP` 금지

| Action | Active context 처리 | Recovery 계약 |
| --- | --- | --- |
| `KEEP` | Exact 또는 high-utility atom을 그대로 유지 | Task Frame과 receipt에 lineage 유지 |
| `SUMMARIZE` | Non-exact content를 bounded semantic form으로 축약 | Summary가 lossy임을 인정하고 source reference 유지 |
| `EXTERNALIZE` | Active window에서 제거하고 local archive로 이동 | Pointer, source hash, rollback checkpoint 필수 |

`DROP`은 제외된다. 정보가 당장 active하지 않더라도 삭제가 아니라 externalization으로 처리해야 audit와 rollback이 가능하다.

### 6.3 Byte-recoverable과 lossless summary를 구분한다

ContextGC가 증명할 수 있는 최대치는 다음 조건을 만족한 원문 archive의 byte recovery다.

1. Externalize 전에 source bytes를 실제 저장한다.
2. Cryptographic hash를 기록한다.
3. Restore 시 hash를 다시 검증한다.
4. Checkpoint와 source pointer의 lineage가 끊기지 않는다.

이 조건을 만족해도 active summary가 모든 semantic detail을 보존한다는 뜻은 아니다. [LCM preprint](https://arxiv.org/abs/2605.04050)도 hierarchical summary DAG와 original material pointer를 사용하며, 여기서 “lossless”라는 표현은 raw retrievability에 관한 것이다. ContextGC는 더 엄격하게 “byte-recoverable archive”라고 표현하고 active summary에는 lossless라는 말을 쓰지 않는다.

### 6.4 Compaction 전후의 recovery sequence

권장 lifecycle은 다음과 같다.

1. `PreCompact`에서 protected set과 active Task Frame을 검증한다.
2. Externalization candidate의 exact source, hash, pointer를 저장한다.
3. Policy input, constraint, decision을 deterministic receipt에 기록한다.
4. Native compaction은 Codex가 수행한다. ContextGC는 그 opaque result를 해석했다고 주장하지 않는다.
5. `PostCompact`에서 event와 compatibility state를 기록한다.
6. `SessionStart(source=compact)`에서 schema-valid bounded Task Frame을 재주입한다.
7. Exact invariant probe 또는 hidden task test 실패 시 archive에서 rehydrate하거나 checkpoint로 rollback한다.

이 sequence는 native compaction을 “되돌리는” 것이 아니다. Native result 내부를 조작하지 않고, compaction 전에 별도로 만든 evidence를 사용해 작업 상태를 복구하는 것이다.

### 6.5 Fail-closed failure modes

다음 상황에서는 semantic externalization을 중지하고 advisory mode로 내려가야 한다.

- Transcript schema/version이 지원 범위를 벗어남
- Protected set이 bounded injection budget을 초과함
- Archive hash verification 실패
- Exact-value classification이 불확실함
- Cache/accounting provenance가 `unavailable`인데 수치 최적화가 필요함
- Restore pointer 또는 rollback checkpoint 누락

Failure를 숨기고 summary를 계속 생성하는 것보다, 자동 action을 중지하고 source를 보존하는 것이 제품의 핵심 안전 계약이다.

## 7. Evaluation Design: 합성 회귀와 운영 증거를 분리한다

### 7.1 Research hypothesis

검증할 가설은 다음과 같이 좁힌다.

> 동일한 software-engineering trace에서 invariant-gated, cache-aware break-even policy가 manual 및 fixed-threshold policy보다 verified successful task당 weighted token-cost proxy를 줄이면서 critical-memory loss를 0으로 유지하는가?

이는 “더 좋은 memory” 전체를 증명하는 가설이 아니다. 고정된 trace, 고정된 weights, deterministic success criterion 안의 정책 비교다.

### 7.2 세 synthetic trace

평가 설계는 각 10–12 turn의 세 trace를 사용한다.

1. **Exact Config Migration:** 초기에 제시된 exact key/value와 forbidden change를 후반에 재사용
2. **Noisy Incident Debug:** 많은 noisy observation 속에서 authoritative error와 last-known test result를 보존
3. **Interrupted Refactor:** 중단·재개 후 open decision, file scope, verification contract를 복원

각 trace에는 hidden deterministic test, forbidden change, early exact value, frozen completion criterion이 있어야 한다. Model self-judge는 task success 판정에 사용하지 않는다.

### 7.3 비교 policy

| Policy | 정의 | 역할 |
| --- | --- | --- |
| `MANUAL` | 평가 전에 동결한 human-authored schedule | 수동 `/compact` 또는 수동 checkpoint를 대리하는 baseline |
| `FIXED` | Normalized context 75%에서 checkpoint, two-turn cooldown | 단순 threshold baseline |
| `ADAPTIVE` | Break-even timing + hard invariant gate + safety cap | ContextGC hypothesis |

Policy 간 비교는 동일 trace, 동일 config, 동일 source hash, 동일 evaluator에서 수행해야 한다. Manual schedule을 결과를 본 뒤 수정하면 leakage가 된다.

### 7.4 Required receipts

재현 가능한 결과에는 다음이 포함되어야 한다.

- Trace, config, source hashes
- Codex와 transcript adapter version
- Metric provenance
- Raw token categories
- 각 turn의 policy decision과 input
- Protected-set audit
- Archive/restore pointer
- Deterministic test result
- Elapsed time

Receipt hash가 같아야 한다는 determinism gate는 “모델 전체가 결정론적”이라는 뜻이 아니라, 동일한 frozen policy input에서 ContextGC decision과 receipt 생성이 동일해야 한다는 계약이다.

### 7.5 Promotion gates

| Gate | 요구 결과 | 실패 시 조치 |
| --- | --- | --- |
| Critical retention | 100% | 해당 atom type의 automatic action 비활성화 |
| Byte recovery | Externalized source 100% | Release 차단 |
| Determinism | 동일 trace/config에서 동일 decision·receipt hash | Benchmark claim 차단 |
| Economics | `ADAPTIVE` UPVS가 `FIXED`, `MANUAL`보다 각각 ≥ 15% 개선 | Safety/audit tool로 재포지셔닝 |
| Cache awareness | Reported data가 있을 때 cache-category prediction error ≤ 10% | Cache-aware performance claim 제거 |
| Native integration | Clean Windows hook run 3회, recursion·state corruption 0 | Simulator/advisory path만 배포 |
| Generalization | Independent holdout 성공 유지 | Fixture-specific 결과로 제한 |

### 7.6 현재 synthetic evidence의 한계

구현 후 생성한 checked-in synthetic receipt
`f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd`의
현재 결과는 다음과 같다.

| Policy | UPVS | Verified fixtures | Critical retention | Manual interventions |
| --- | ---: | ---: | ---: | ---: |
| `MANUAL` | 59,884.67 | 3/3 | 100% | 6 |
| `FIXED` | 67,653.67 | 3/3 | 100% | 0 |
| `ADAPTIVE` | 65,488.33 | 3/3 | 100% | 0 |

`ADAPTIVE`는 `FIXED`보다 3.20% 낮지만 `MANUAL`보다 9.36% 높다.
따라서 “둘 모두보다 15% 개선”이라는 자체 economics gate는 `FAIL`이며,
현재 제품은 cost winner가 아니라 **safety/audit trade-off**로 포지셔닝해야
한다. 각 fixture의 protected required fact를 손상시키는 negative control은
3/3 실패하므로 정상 policy의 성공은 scorer가 무조건 부여한 값은 아니다.

Promotion status는 Critical retention=`PASS`, tested non-secret byte
recovery=`PASS`, determinism=`PASS`, economics=`FAIL`, cache calibration=
`NOT_RUN`, three clean live Windows hooks=`NOT_RUN`, independent holdout=
`NOT_RUN`이다. 이 수치는 live credits 절감, native hook reliability 또는
production generalization을 증명하지 않는다.

세 handcrafted fixture의 한계는 다음과 같다.

- Sample size가 통계적 보장에 너무 작다.
- Fixture author와 policy designer의 편향을 배제하지 못한다.
- Independent, exchangeable trajectory population이 아니다.
- Real user의 task distribution, tool failure, interruption pattern을 대표하지 않는다.
- Native opaque compaction의 semantic retention을 직접 관찰할 수 없다.
- API cache category가 ChatGPT-authenticated Codex에 동일하게 대응하는지 모른다.

[Conformal Risk Control, ICLR 2024](https://openreview.net/forum?id=33XGfHLtZg)은 bounded monotone loss와 calibration assumption 아래 expected risk control을 다룬다. [Learn then Test, Annals of Applied Statistics 2025](https://doi.org/10.1214/24-AOAS1998)는 held-out statistical test를 통한 parameter selection framework를 제공한다. 그러나 세 fixture는 이들 방법의 exchangeability·sample 조건을 충족하지 못하므로 P0는 conformal guarantee나 statistical certification을 주장하지 않는다.

## 8. 권위 있는 연구 흐름과 AI Memory 동향

### 8.1 Foundational systems research: checkpoint를 비용·복구 trade-off로 본다

Young의 [A First Order Approximation to the Optimum Checkpoint Interval](https://doi.org/10.1145/361147.361115)과 Toueg·Babaoglu의 [On the Optimum Checkpoint Selection Problem](https://doi.org/10.1137/0213039)은 checkpoint timing을 save cost, recovery/rework cost, task duration, failure behavior의 trade-off로 다룬다.

ContextGC는 이 전통에서 “언제 context를 정리할 것인가”를 감각적 threshold가 아니라 checkpoint economics 문제로 본다. 그러나 coding agent의 information failure는 독립적·stationary stochastic process로 알려져 있지 않으므로 기존 failure distribution을 그대로 fit하지 않는다.

### 8.2 Control research: model이 없으면 복잡한 controller가 정당화되지 않는다

García, Prett, Morari의 [MPC survey](https://doi.org/10.1016/0005-1098(89)90002-2)는 finite-horizon optimization에 explicit transition model이 필요하다는 기본선을 제공한다. ContextGC의 방향은 먼저 deterministic, interpretable controller로 trajectory를 수집하고, forecast calibration과 holdout improvement가 확인된 뒤에만 MPC/RL로 승격하는 것이다.

### 8.3 NeurIPS·ICLR: text similarity에서 task-aware distortion으로 이동한다

- [Fundamental Limits of Prompt Compression, NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/hash/ac8fbba029dadca99d6b8c3f913d3ed6-Abstract-Conference.html): rate-distortion formalization과 query-aware compression
- [RECOMP, ICLR 2024](https://openreview.net/forum?id=mlJLVigNHp): end-task-trained extractive/abstractive compression과 selective augmentation
- [LongMemEval, ICLR 2025](https://openreview.net/forum?id=pZiyCaVuti): extraction뿐 아니라 temporal reasoning, update, abstention 평가
- [Conformal Risk Control, ICLR 2024](https://openreview.net/forum?id=33XGfHLtZg): calibration assumption 아래 bounded risk control
- [Learn then Test, AOAS 2025](https://doi.org/10.1214/24-AOAS1998): held-out testing을 통한 parameter calibration

공통 흐름은 압축률 자체보다 **task-conditioned distortion, downstream success, update/conflict handling, calibrated failure risk**를 중시하는 방향이다. ContextGC의 exact invariant와 hidden coding grader는 이 흐름을 software-engineering context에 맞게 좁힌 설계다.

### 8.4 2025–2026 preprint: 단순 summary에서 lifecycle·cache·execution state로 이동한다

다음 자료는 최신 방향을 보여 주지만 peer-reviewed independent validation으로 취급해서는 안 된다.

| 연구 | 제안 방향 | ContextGC에 주는 함의 | 증거 한계 |
| --- | --- | --- | --- |
| [ACON](https://arxiv.org/abs/2510.00615) | Full-context success와 compressed-context failure trajectory로 compression guideline 최적화 | Paired failure를 policy learning 자료로 활용 가능 | Compressor overhead, 제한된 model coverage, author-reported result |
| [TokenPilot](https://arxiv.org/abs/2606.17016) | Cache-efficient, lifecycle-aware context management | Cache churn과 lifecycle phase가 핵심 state임을 지지 | June 2026 preprint, benchmark-specific author report |
| [SWE-MeM](https://arxiv.org/abs/2606.28434) | Coding agent가 when/what/how to compress를 학습 | Adaptive memory action 자체는 novelty가 아님 | Training-dependent, ContextGC plugin 검증 아님 |
| [MAGE](https://arxiv.org/abs/2606.06090) | Execution-state tree의 grow/compress/maintain/revise | Memory를 semantic notes가 아닌 execution state로 볼 필요 | Preprint, acronym ambiguity, author-reported result |
| [LCM](https://arxiv.org/abs/2605.04050) | Hierarchical summary DAG와 original-source pointer | Stable lineage와 targeted rehydration은 prior art | “Lossless”는 raw retrievability 의미, active summary fidelity 아님 |

이 흐름은 ContextGC의 문제 선택이 시의적절함을 지지하지만, “first” claim은 오히려 반박한다. 경쟁력은 더 큰 novelty 문구가 아니라 Codex plugin boundary 안에서 검증 가능한 safety contract를 구현하는 데 있다.

## 9. Competitor와 Prior Art: 차별화는 결합과 증거에서 나온다

| System | Primary source가 지지하는 기존 capability | ContextGC의 차별화 경계 |
| --- | --- | --- |
| [Magic Context](https://github.com/cortexkit/magic-context) | Cache-deferred reduction, tagged raw history, bounded expansion, background historian, structured facts | Cache-aware·reversible·tiered memory 최초 주장 금지 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/context-compression-and-caching.md) | Pluggable context engine, threshold compression, token accounting, Codex app-server mode | Auto-compression이 아니라 pure Codex plugin lifecycle receipt로 차별화 |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management) | Background auto-compaction, manual compact, structured summary/checkpoint, detail-loss 경고 | Loss risk와 exact-source recovery를 더 명시적으로 증명 |
| [Claude Code](https://code.claude.com/docs/en/context-window) | Automatic/manual compaction, persistent project instruction, survival/loss rule | Durable invariant reinjection 자체는 established practice |
| [Letta](https://docs.letta.com/guides/core-concepts/memory/memory-blocks) | Always-visible structured memory block, archival memory/search | Typed/tiered memory 최초 주장 금지 |
| [LangGraph](https://docs.langchain.com/oss/python/langgraph/persistence) | Step checkpoint, replay, fork/time travel, durable store | Reversibility가 아니라 arbitrary Codex lifecycle 적용과 auditability로 차별화 |
| [LCM](https://arxiv.org/abs/2605.04050) | Summary DAG와 raw-source pointer | Provenance·drill-down 자체는 prior art |

### 9.1 방어 가능한 novelty statement

ContextGC가 주장할 수 있는 것은 다음 결합이다.

- Replacement agent loop가 아닌 native Codex lifecycle integration
- Typed software-engineering invariants와 exact-value gate
- `reported / derived / estimated / unavailable` metric provenance
- 동일 trace의 deterministic policy receipt와 replay
- Opaque native compactor 주변의 fail-closed reversible externalization

이 결합도 “세계 최초”로 단정하지 않는다. Build Week에서는 문제 framing, 안전 계약, 실행 증거의 재현성으로 평가받아야 한다.

## 10. 구현 결정: P0가 해야 할 것과 하지 말아야 할 것

### 10.1 P0 scope

P0의 제품 역할은 다음 네 동사로 제한한다.

1. **Observe:** Hook lifecycle, reported telemetry, compatible transcript record를 관찰
2. **Protect:** Exact invariant와 unresolved state를 typed Task Frame으로 보호
3. **Checkpoint:** Compaction 전 source, hash, pointer, policy receipt를 저장
4. **Recover:** Bounded rehydration과 rollback을 제공

P0가 하지 않는 일은 다음과 같다.

- 임의 기존 Codex thread의 native compaction 강제 호출
- User config의 자동 rewrite
- Transcript schema의 추측성 parsing과 semantic externalization
- Token에서 actual ChatGPT credits 계산
- Summary를 lossless라고 표시
- Learned horizon predictor, MPC, RL 기반 production actuation

### 10.2 Engineering contracts

| Surface | 구현 계약 | Failure policy |
| --- | --- | --- |
| Hook | Synchronous command handler, bounded input/output, recursion guard | Unsupported event/schema에서 fail closed |
| Transcript adapter | Versioned, tolerant of unknown records, tested compatibility range | Semantic externalization 중지 |
| Task Frame | Schema-valid, bounded, exact fields 우선 | Protected overflow 경고 + source externalization |
| Archive | Local-first source, pointer, hash, rollback checkpoint | Hash/pointer 실패 시 release 차단 |
| Optimizer | Hard constraints 후 finite DP 또는 deterministic heuristic | Infeasible이면 자동 action 중지 |
| Accounting | Raw categories + provenance + frozen weights | Unavailable은 null, 0으로 대체 금지 |
| Receipt | Trace/config/source/policy/result hashes | Determinism 실패 시 benchmark claim 차단 |
| App-server | Opt-in, version-pinned experimental adapter | Core checkpoint/recovery와 격리 |

### 10.3 Judge demo가 보여 줘야 할 것

데모의 중심은 “압축 버튼”이 아니라 안전한 decision lifecycle이어야 한다.

1. 초기에 exact path, forbidden change, expected value를 입력한다.
2. Noise가 증가하는 동안 controller가 protected atoms를 분류한다.
3. Break-even policy가 checkpoint 준비 여부와 근거를 receipt로 출력한다.
4. Externalized source의 pointer와 hash를 보여 준다.
5. Compaction 이후 bounded Task Frame을 reinject한다.
6. Hidden deterministic test로 exact invariant retention을 검사한다.
7. 실패 scenario에서 archive rehydration 또는 rollback을 시연한다.
8. Token categories, UPVS, credits=`null`의 claim boundary를 함께 표시한다.

이 흐름은 ContextGC가 native compactor를 대체하지 않으면서도 실질적 사용자 불편 — 수동 `/compact` 시점 판단과 기억 손실 불안 — 을 줄이는 방법을 보여 준다.

## 11. Unknowns와 Rejected Claims: 미해결 문제를 제품 계약으로 관리한다

### 11.1 Residual unknowns

| ID | 미해결 질문 | 제품 영향 | 해소에 필요한 증거 |
| --- | --- | --- | --- |
| U-001 | OpenAI가 ChatGPT-authenticated Codex의 authoritative per-run credits를 제공할 것인가? | Exact-credit optimization과 savings claim 차단 | Supported per-run billing/usage field와 공식 환산 contract |
| U-002 | Intended Codex release range에서 어떤 transcript record shape가 호환되는가? | Release compatibility risk | Version matrix와 transcript fixtures, fail-closed tests |
| U-003 | 향후 supported plugin API가 host-owned existing thread의 native compaction을 시작할 수 있는가? | Advisory에서 native actuation으로의 확장 여부 | Official plugin action contract |
| U-004 | Atom utility/risk score가 independent coding task success를 예측하는가? | Semantic optimality와 calibrated-risk claim 차단 | Independent labeled trajectories와 holdout validation |
| U-005 | ChatGPT-authenticated Codex의 cache accounting이 public API schedule과 충분히 일치하는가? | Local subscription economics로 전이 불가 | Same-task cross-surface telemetry study |
| U-006 | Conformal/Learn-then-Test calibration에 충분한 independent trajectory가 있는가? | P0 statistical guarantee 차단 | Predefined loss, independent calibration/test split, 충분한 sample |

### 11.2 Rejected claims와 반증

| Claim ID | 기각된 주장 | 핵심 반증 | 대체 문구 |
| --- | --- | --- | --- |
| CG-011 | Codex usage는 prompt length만으로 결정됨 | OpenAI가 model, reasoning, tools, retrieval, caching, duration 등 다변수 영향을 명시 | “Context length는 usage signal 중 하나” |
| CG-017 | 모든 ContextGC utility score에 classical submodular guarantee 적용 | Monotonicity·submodularity·constraint class가 증명되지 않음 | “선언된 additive instance에 exact DP 사용” |
| CG-034 | 세계 최초 automatic, cache-aware, reversible coding-agent memory | Magic Context, TokenPilot, SWE-MeM 등 명시적 prior art | “Codex-specific invariant/recovery/audit combination” |
| CG-035 | ContextGC compression은 lossless이고 never forgets | Summary detail loss와 opaque native compaction; archive bytes만 검증 가능 | “Hash-verified byte-recoverable archive” |
| CG-036 | UPVS는 외부 검증된 Codex credits 지표 | ContextGC 실험 proxy이며 OpenAI billing metric이 아님 | “Frozen-weight comparative proxy” |

기각된 claim은 marketing 표현만의 문제가 아니다. 잘못된 optimization objective와 evaluation leakage를 방지하는 engineering requirement다.

## 12. 단계적 Research-to-Production Roadmap

Roadmap은 기능 수가 아니라 claim을 승격시키는 증거의 순서로 구성한다.

### Stage 0 — Claim-safe local MVP

**목표:** Native compaction을 대체하지 않는 observe/protect/checkpoint/recover plugin.

**필수 산출물:**

- Typed MemoryAtom과 bounded Task Frame
- Exact-value hard constraints
- Local archive pointer, source hash, rollback checkpoint
- Deterministic policy receipt
- Credits=`null`, raw token category/provenance display
- App-server adapter와 core recovery의 격리

**Exit gate:** Unsupported schema, missing pointer, hash mismatch에서 fail closed가 재현된다.

### Stage 1 — Deterministic synthetic falsification

**목표:** 세 frozen coding trace에서 MANUAL, FIXED, ADAPTIVE를 동일 조건으로 비교.

**필수 산출물:**

- Hidden deterministic grader
- Frozen manual schedule
- Same trace/config/source hash replay
- Critical retention, byte recovery, determinism receipt
- Raw categories와 UPVS

**Exit gate:** Critical retention 100%, byte recovery 100%, deterministic decision/receipt hash. Economics gate를 실패하면 safety/audit tool로 재포지셔닝한다.

### Stage 2 — Native Windows integration evidence

**목표:** 실제 Codex hook lifecycle에서 compatibility와 recovery를 검증.

**필수 산출물:**

- Tested Codex version matrix
- `PreCompact → PostCompact → SessionStart(source=compact)` receipts
- Stop hook recursion guard evidence
- Transcript schema drift fixtures

**Exit gate:** Clean Windows hook run 3회, recursion과 corrupted state 0. 실패하면 simulator/advisory path만 유지한다.

### Stage 3 — Independent generalization and cache study

**목표:** Handcrafted fixture bias와 API/Codex cache parity unknown을 줄인다.

**필수 산출물:**

- Independent holdout task set
- Fixture author와 evaluator 분리
- Lifecycle·task family별 stratified results
- Reported cache category가 있는 동일 task의 cross-surface 비교
- Failure taxonomy: exact miss, stale update, wrong rehydration, cache churn

**Exit gate:** Independent holdout 성공 유지, reported data에서 cache-category prediction error ≤ 10%. 그렇지 않으면 generalization/cache-aware performance claim을 제거한다.

### Stage 4 — Statistical risk calibration feasibility

**목표:** Conformal Risk Control 또는 Learn-then-Test 조건이 실제 trajectory에 성립하는지 검토.

**필수 산출물:**

- Bounded monotone loss candidate
- Exchangeability·distribution-shift audit
- Independent calibration/test split
- Pre-registered threshold와 failure criterion

**Exit gate:** Assumption과 sample sufficiency가 검증될 때만 calibrated risk claim을 제안한다. 미충족 시 deterministic gates를 유지한다.

### Stage 5 — Predictive controller promotion

**목표:** Deterministic break-even baseline을 실제로 능가하는 경우에만 MPC/RL 계열 controller 도입.

**Exit gate:** Horizon MAPE ≤ 25%, UPVS ≥ 5% 추가 개선, additional critical miss 0, frozen holdout 안정성.

### Stage 6 — Experimental native actuation

**목표:** ContextGC가 소유한 app-server thread에서만 version-pinned `thread/compact/start`를 검증.

**필수 조건:**

- Official protocol compatibility pin
- Separate integration suite
- Actuation failure가 checkpoint/recovery를 손상하지 않음
- Arbitrary host-owned thread 지원처럼 보이지 않는 UI·문서

기존 Desktop/CLI thread actuation은 official plugin contract가 생길 때까지 roadmap의 promise가 아니라 residual unknown으로 남긴다.

## 13. 최종 판단

ContextGC의 핵심 가치는 “더 많이 압축한다”가 아니다. 장기 AI coding session에서 무엇을 active context에 남기고, 무엇을 축약하고, 무엇을 externalize할지 결정하는 과정에 **hard invariant, 비용 모델, provenance, rollback**을 부여하는 것이다.

공식 문서와 연구가 지지하는 결론은 다음과 같다.

- Codex native compaction은 효율적인 continuation을 제공하지만 semantic retention을 inspectable하게 보증하지 않는다 — `VERIFIED`.
- Plugin hook은 compaction 주변의 safety control plane을 만들 수 있다 — `VERIFIED`.
- 임의 기존 thread의 native compaction 직접 호출은 현재 공개 근거로 확립되지 않았다 — `UNKNOWN`.
- Prompt compression은 task-aware rate-distortion 문제이며 coding correctness로 평가해야 한다 — `VERIFIED`.
- Token에서 actual ChatGPT credits로의 per-run 결정론적 환산은 확인되지 않았다 — `UNKNOWN`.
- 작은 선언된 additive selection은 exact DP가 가능하지만 semantic global optimum은 아니다 — `INFERENCE`.
- Lossless, never forgets, world first, exact credits saved는 모두 허용되지 않는다 — `REJECTED`.

따라서 Build Week 제출에서 가장 강한 메시지는 과장된 compression claim이 아니라 다음이다.

> **ContextGC makes Codex compaction safer to live with.** It preserves typed engineering invariants, records why a context decision was made, and keeps separately archived source recoverable when an opaque native compactor cannot prove what it retained.

이 문구를 production claim으로 강화하려면 synthetic fixture의 deterministic success를 넘어, clean native integration runs, independent holdout, cache parity evidence, 그리고 실제 surface가 제공하는 authoritative usage receipt가 순서대로 필요하다.
