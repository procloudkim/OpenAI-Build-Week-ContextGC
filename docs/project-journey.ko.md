# 컨텍스트 불안에서 가역적 제어 계층까지

이 문서는 OpenAI Build Week에서 ContextGC의 문제를 정의하고, 주장을 좁히고,
구현하고, 검증한 과정을 공개 가능한 범위로 기록한 일대기입니다. 비공개 prompt,
session identifier, 로컬 경로, 계정 정보와 raw transcript는 포함하지 않습니다.

## 출발점

프로젝트는 긴 AI 코딩 세션의 컨텍스트가 커질수록 작업을 신뢰하기 어려워진다는
현실적인 불편에서 시작했습니다. 숙련 사용자는 `PROJECT_STATE.md`를 유지하고,
개인적인 임계값에서 압축하며, 새 thread에 상태 요약을 전달해 문제를 해결합니다.

이 방법은 효과적이지만 사용자에게 또 하나의 직업을 만듭니다. 본래의
엔지니어링 문제를 해결하는 동시에 수동 기억 시스템도 운영해야 합니다.

- 무엇을 반드시 남길지 결정하기
- 정확한 값을 바꾸지 않고 복사하기
- 현재 사실과 오래된 시도를 구분하기
- checkpoint 시점을 기억하기
- 다음 thread에서 같은 작업 상태 복원하기

처음의 질문은 최종 제품보다 더 넓었습니다.

> 긴 작업이 복잡해질 때마다 사용자가 수동 압축 의식을 수행하지 않도록
> 컨텍스트 정리를 최적화할 수 있을까?

## 리서치가 주장을 바꾸다

초기 리서치는 흔히 섞이는 세 가지 메커니즘을 분리했습니다.

1. **Native compaction**은 더 작은 continuation context를 만듭니다.
2. **Task memory**는 어떤 사실을 계속 사용할지 결정합니다.
3. **Lifecycle control**은 언제 상태를 보호하고 어떻게 감사·복구할지 정합니다.

OpenAI native compaction 상태는 의도적으로 불투명합니다. 일반 Codex plugin은
lifecycle hook에 참여할 수 있지만 임의의 기존 thread를 소유하거나 native
compaction을 강제하는 문서화된 명령은 없습니다. Prompt compression 연구도
token 감소가 곧 작업 품질을 의미하지 않는다는 점을 보여줬습니다. 특히
software 작업에서는 정확한 명령, 경로, 식별자와 금지사항이 중요합니다.

그래서 프로젝트를 “최적 압축기”에서 다음과 같이 좁혔습니다.

> Codex native compaction 주변의 감사 가능하고 가역적인 safety controller.

## 사람이 결정한 제품 원칙

프로젝트 소유자는 다음을 직접 선택했습니다.

- 독립 채팅 앱이 아니라 Codex plugin으로 구현
- 실제 개발 환경을 반영한 Windows-first
- 별도 API key가 필요 없는 local-first persistence
- 사용자 원문을 자동 삭제하지 않음
- Markdown 작업 방식을 대체하지 않고 보완
- 근거 없는 token-to-credit 환산 거부
- 큰 marketing claim보다 좁고 반증 가능한 주장 선택

이 결정들이 이후 모든 공학 선택을 제한했습니다.

## 안전 계층 만들기

### 1. 자유 형식 요약 대신 typed memory

ContextGC는 작업 상태를 MemoryAtom과 bounded Task Frame으로 표현합니다.
Protected goal, constraint, exact identifier, blocker와 authoritative test
outcome은 조용히 버릴 수 없습니다. Action은 `KEEP`, `SUMMARIZE`,
`EXTERNALIZE`로 제한되며 `DROP`은 없습니다.

### 2. 자동화보다 가역성 우선

Externalize된 근거는 최소화된 뒤 SHA-256 content-addressed local archive에
보존됩니다. Checkpoint는 Task Frame과 evidence pointer를 연결합니다.
Rehydrate는 필요한 객체만 읽고 restore는 검증된 이전 Frame을 선택합니다.
Restore가 Git, 파일, 명령 또는 외부 부작용까지 되돌린다고 주장하지 않습니다.

### 3. Lifecycle integration

여섯 개의 Codex hook이 control plane을 구성합니다.

- `SessionStart`: 검증된 bounded Frame 로드
- `UserPromptSubmit`: bounded context와 bootstrap guidance 제공
- `PostToolUse`: 지원되는 factual event 기록
- `PreCompact`: 보호 경계 검증
- `PostCompact`: compaction 완료 기록과 제한된 결과 알림
- `Stop`: 추가 모델 턴 없이 메타데이터만 기록

가장 중요한 동작은 fail-closed입니다. Checkpoint, snapshot, hook state가 모두
검증될 때까지 automatic compaction은 중단됩니다.

### 4. Interface contract로서의 개인정보 보호

설치된 plugin은 private local store를 추론하고 절대경로 대신 opaque store
identifier를 반환합니다. Raw session identifier는 persistence 전에 hash됩니다.
Task Frame은 closed schema를 사용하고 명시적 local file URI는 전체를
redact합니다. 이는 결정론적 data minimization이며 완전한 PII detector나
encryption을 의미하지 않습니다.

## Hardening 과정

첫 working version을 완성으로 취급하지 않았습니다. 적대적 검토에서 다음
실패 경로가 발견됐습니다.

- 이전 bytes가 남은 versioned plugin cache
- successor lineage에 들어갈 수 있는 malformed·markerless checkpoint
- mirror와 latest pointer의 분리 publication
- byte readback 없이 기록되는 hook state
- 의도한 guard를 우회할 수 있는 unknown compaction trigger
- local path를 노출할 수 있는 normalized file URI variant

각 문제를 invariant와 regression test로 바꿨습니다. Codex가 새 immutable cache
entry를 사용하도록 release version을 `0.1.5`로 올렸고, 최종 hook manifest는
모든 compaction trigger를 unknown value에서 fail-closed하는 코드로 전달합니다.

실제 terminal 사용에서 긴 Stop continuation이 정상 작업을 가리는 문제가 확인된
뒤 `0.1.6` hotfix로 사람에게 보이는 interface를 줄였습니다. 정상 lifecycle은
무음으로 바꾸고, 알림은 최대 3줄로 제한했으며, resume 온보딩 반복을 없애고,
checkpoint freshness 검사를 실제 PreCompact 안전 경계로 옮겼습니다.

## 과장하지 않는 평가

ContextGC는 세 개의 고정 software-engineering trace를 manual, fixed,
adaptive 정책으로 재생합니다. Hidden deterministic oracle이 exact fact와
forbidden change를 검사하며 모델이 스스로 점수를 매기지 않습니다.

세 정책 모두 3/3 verified task와 100% critical retention을 달성했습니다.
Adaptive 정책은 fixed보다 UPVS가 3.20% 낮았지만 frozen manual schedule보다
9.36% 높았습니다. 따라서 15%-versus-both 경제성 promotion gate는
실패했습니다.

이 결과를 숨기지 않고 제품 포지셔닝을 바꿨습니다. ContextGC는 검증된 절감
우승자가 아니라 safety/audit controller입니다. 현재 surface에서 authoritative
per-run conversion과 완전한 before/after token receipt를 제공하지 않기 때문에
실제 Codex credits 절감은 아직 측정하지 않았습니다.

## 실제 lifecycle 수용 테스트

자동화 suite 통과 후 실제 Codex trust와 lifecycle 흐름으로 검증했습니다.

- 여섯 개 bundled hook 검토 및 활성화
- verified checkpoint 생성
- 두 compaction hook이 활성화된 상태에서 native compaction 완료
- 완전히 새로운 thread에서 같은 protected Task Frame 복구
- checkpoint와 store correlation 일치
- 수용 보고서에서 local absolute path 비노출

Raw checkpoint, store와 session identifier는 공개 artifact에서 의도적으로
제외했습니다.

## Codex와 GPT-5.6의 기여

Codex with GPT-5.6은 primary engineering collaborator로 사용됐습니다.

- 제품 질문을 testable architecture로 변환
- 최신 OpenAI integration boundary 확인
- TypeScript core, MCP server, hooks, CLI와 site 구현
- deterministic fixture와 negative control 구성
- 개인정보와 integrity 적대적 검토
- liveness deadlock과 package-cache mismatch 수정
- 재현 가능한 심사·오픈소스 문서 작성

프로젝트 소유자는 제품 방향, 개인정보 경계, 플랫폼 선택, release 권한과 최종
제출을 책임졌습니다. Primary build `/feedback` Session ID는 Devpost에만
입력하며 저장소에 포함하지 않습니다.

## 이 프로젝트가 보여주는 것

ContextGC는 새로운 memory theory를 발명했다는 이야기보다 불확실한 model
boundary 주변에서 공학적 규율을 적용한 사례입니다.

- 매력적이지만 근거 없는 주장을 좁히기
- 정확한 사용자 제약을 협상 불가능한 invariant로 만들기
- local proof와 external release proof를 분리하기
- review finding을 실행 가능한 regression test로 바꾸기
- source뿐 아니라 Git metadata에서도 개인정보 보호하기
- 경제성 promotion gate 실패를 정직하게 공개하기

다음 research milestone은 before/after context, checkpoint overhead,
rehydration overhead, cache impact와 provenance를 담는 privacy-preserving live
CompactionReceipt입니다. 그전까지 가장 강한 검증 효익은 credits 수치가 아니라
작업 연속성과 복구 가능성입니다.
