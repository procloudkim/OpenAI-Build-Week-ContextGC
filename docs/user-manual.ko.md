# ContextGC 사용자 매뉴얼

> 적용 버전: ContextGC 0.1.10
> 검증 기준선: Windows PowerShell, Node.js 22.13 이상, Codex CLI 0.145.0
> 문서 검증일: 2026-07-23

ContextGC는 긴 Codex 작업에서 목표, 제약, 결정, 검증 결과와 근거 포인터를
가역적인 체크포인트로 관리하는 로컬 지속화 기반 플러그인입니다. 현재
system/user 지침과 저장소 파일·테스트가 각 범위의 권위이며, ContextGC의 Task
Frame은 이를 대신하는 데이터베이스가 아니라 작업을 이어 가기 위한 검증
가능한 인계 문서입니다. 로컬 지속화는 오프라인 모델 실행을 뜻하지 않으며,
Codex turn에 주입된 Task Frame은 사용자의 일반 Codex 서비스 경계에서
처리됩니다.

## 1. 독자 계약

이 문서는 다음 독자를 위한 운영 가이드입니다.

- Windows에서 Codex CLI 또는 Codex 앱을 사용하는 개발자
- 공개 GitHub 저장소 `procloudkim/OpenAI-Build-Week-ContextGC`에서 설치하려는 사용자
- 긴 작업을 중단하거나 다시 시작할 때 정확한 제약과 테스트 근거를 보존하려는 사용자

이 문서를 마치면 다음을 할 수 있습니다.

1. 공개 저장소를 복제하고 ContextGC 플러그인을 설치한다.
2. 설치된 hook 정의를 직접 검토한 뒤 신뢰한다.
3. 경로를 공개하지 않고 하나의 opaque `storeId`로 첫 가역 체크포인트를 확인한다.
4. 필요한 근거만 제한적으로 다시 불러오거나 이전 체크포인트를 복원한다.
5. 결정론적 CLI 스모크 테스트로 설치 소스의 기준 동작을 확인한다.
6. 업데이트와 제거 시 저장 데이터를 보존할지 삭제할지 구분한다.

전제 조건은 다음과 같습니다.

- Git
- Node.js 22.13 이상
- plugin을 지원하는 Codex CLI. `0.145.0`은 검증 기준선이며 무조건적인 고정
  요구사항은 아닙니다.
- PowerShell에서 명령을 실행할 수 있는 권한

이 문서는 ContextGC 사용과 복구를 다룹니다. Codex의 네이티브 압축 내부
상태, 네이티브 `/compact` 실행, 토큰을 ChatGPT/Codex credits로 환산하는 방법,
프로덕션 비용 절감 보장은 다루지 않습니다. ContextGC는 그러한 기능을
제공한다고 주장하지 않습니다.

완료 기준은 다음 여섯 가지입니다.

- `codex plugin list`에 `context-gc@context-gc-local`이 `installed, enabled`로 표시된다.
- `/hooks`에서 ContextGC hook을 검토하고 현재 정의를 신뢰했다.
- 신뢰 후 새 스레드를 시작했다.
- `/mcp`에서 `context-gc` 서버와 여섯 도구를 확인했다.
- 첫 체크포인트 ID를 받았고 `latestCheckpointId`와 일치함을 확인했다.
- Task Frame `contextgcStoreId`와 MCP `storeId`가 경로 노출 없이 일치한다.
- 이 문서의 결정론적 CLI 스모크 테스트가 예상 결과로 끝났다.

## 2. 먼저 알아둘 동작 모델

ContextGC가 저장하는 관계는 다음과 같습니다.

```text
현재 저장소 파일과 테스트  ──검증──>  Task Frame
                                      │
선택한 UTF-8 근거 ──SHA-256──> ContentRef
                                      │
                                      v
                           checkpoint manifest
                                      │
                           rehydrate / restore
```

- **Task Frame**은 현재 목표, 제약, 결정, 열린 작업, 활성 파일과 테스트 근거를
  구조화한 제한 크기의 작업 세트입니다.
- **ContentRef**는 로컬 archive 객체를 SHA-256으로 가리키는 포인터입니다.
- **checkpoint**는 Task Frame과 ContentRef를 연결하는 가역적인 시점 기록입니다.
- **rehydrate**는 필요한 archive 근거만 제한된 크기로 읽습니다.
- **restore**는 체크포인트의 컨텍스트 메타데이터와 포인터를 복원합니다.

중요한 경계가 하나 있습니다. `restore`는 Git 커밋, 작업 파일, 실행한 명령,
데이터베이스 또는 외부 서비스의 부작용을 되돌리지 않습니다. 복원 후에도
현재 저장소 파일과 테스트를 다시 확인해야 합니다.

## 3. 10분 설치

### 3.1 도구와 버전 확인

목적은 설치 전에 로컬 도구 버전을 확인하는 것입니다.

```powershell
node --version
codex --version
git --version
```

기대 결과:

- Node.js가 `v22.13.0` 이상이다.
- Codex CLI `0.145.0`은 설치와 transcript telemetry의 검증 기준선이다. 다른
  버전도 plugin을 지원하면 사용할 수 있지만
  [인터페이스 레퍼런스의 호환성 표](reference.md#compatibility-matrix)를 확인하고
  설치·MCP·skill·hook 발견 검사를 다시 수행한다. 알 수 없는 transcript schema는
  추측하지 않고 telemetry 기반 정책만 비활성화한다.
### 3.2 공개 GitHub 저장소 복제

권장 복제 경로는 일반 작업 디렉터리입니다. Codex 전역 상태 디렉터리인
`~\.codex` 안에는 복제하지 마십시오.

```powershell
$cloneRoot = Join-Path $env:USERPROFILE 'source\repos'
New-Item -ItemType Directory -Path $cloneRoot -Force | Out-Null
Set-Location $cloneRoot
git clone --branch v0.1.10 --depth 1 https://github.com/procloudkim/OpenAI-Build-Week-ContextGC.git context-gc
Set-Location .\context-gc
$manifest = Get-Content .\release\v0.1.10.sha256
foreach ($line in $manifest) {
  if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Malformed hash manifest.' }
  $expected, $path = $Matches[1], $Matches[2]
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Hash mismatch: $path" }
}
'releaseHashesVerified=True'
git remote -v
```

공개 저장소 URL은 다음과 같습니다.

```text
https://github.com/procloudkim/OpenAI-Build-Week-ContextGC
```

기대 결과는 `origin`이 위 GitHub 저장소를 가리키고 저장소 루트에
`.agents\plugins\marketplace.json`과 `plugins\context-gc`가 존재하는 것입니다.
checksum loop는 `releaseHashesVerified=True`를 출력해야 하며 불일치하면 즉시
중단하십시오. 이 검사는 로컬 5개 파일과 tag의 manifest가 일치함을 보일 뿐,
tag와 manifest가 암호학적으로 서명되지 않았으므로 게시자 신원을 인증하지는
않습니다.

### 3.3 로컬 marketplace와 플러그인 설치

이 저장소에는 미리 빌드된 플러그인이 포함되어 있으므로 일반 사용자는
TypeScript를 다시 빌드하거나 별도 API 키를 준비할 필요가 없습니다.

저장소 루트에서 실행하십시오.

```powershell
codex plugin marketplace add .
codex plugin add context-gc@context-gc-local --json
codex plugin list
```

기대 결과:

```text
context-gc@context-gc-local  installed, enabled  0.1.10
```

이미 같은 로컬 marketplace가 등록되어 있다면 중복 추가 오류가 날 수
있습니다. 다음 명령으로 등록된 이름과 실제 루트 경로를 확인하고, 경로가
현재 clone과 같다면 `marketplace add`를 반복하지 마십시오.

```powershell
codex plugin marketplace list
```

설치 성공은 플러그인 캐시와 설정이 구성되었다는 뜻입니다. hook 신뢰나
실제 실행까지 증명하는 것은 아닙니다.

### 3.4 기존 clone에서 설치

이미 저장소를 복제했다면 새 clone을 만들 필요가 없습니다. 먼저 올바른
저장소인지 확인한 뒤 같은 설치 명령을 사용하십시오.

```powershell
Set-Location 'D:\path\to\context-gc'
git remote get-url origin
git status --short
Test-Path -LiteralPath '.\.agents\plugins\marketplace.json'
Test-Path -LiteralPath '.\plugins\context-gc\.codex-plugin\plugin.json'
codex plugin marketplace list
# context-gc-local 등록이 없을 때만 다음 명령을 실행합니다.
# codex plugin marketplace add .
codex plugin add context-gc@context-gc-local --json
```

두 `Test-Path` 결과는 `True`여야 합니다. `git status --short`에 사용자 변경이
보이면 설치 전에 삭제하거나 덮어쓰지 말고 먼저 보존하십시오.

### 3.5 새 프로세스에서 발견성 확인

다음 명령은 새 Codex 프로세스가 ContextGC skill 메타데이터를 볼 수 있는지
확인하는 강한 진단입니다.

```powershell
codex debug prompt-input "Use ContextGC to inspect context health."
```

출력 JSON에서 `context-gc` skill 이름과 설명을 확인하십시오. 이 출력에는
다른 로컬 설정이 포함될 수 있으므로 그대로 공개 이슈나 영상에 붙이지
마십시오. 이 검사는 모델 가시성을 확인할 뿐, hook이 신뢰되었거나 실제
체크포인트가 생성되었다는 증거는 아닙니다.

## 4. Hook 검토, 신뢰와 새 스레드

Codex는 플러그인에 포함된 비관리형 command hook을 설치만으로 신뢰하지
않습니다. 현재 hook 정의의 해시에 대해 사용자가 검토하고 신뢰해야 하며,
정의가 바뀌면 다시 검토해야 합니다.

### 4.1 저장소의 hook 정의 읽기

```powershell
Get-Content -LiteralPath '.\plugins\context-gc\hooks\hooks.json'
Get-FileHash -LiteralPath '.\plugins\context-gc\hooks\hooks.json' -Algorithm SHA256
```

현재 정의에는 다음 여섯 lifecycle event가 있습니다.

| 이벤트 | ContextGC에서의 역할 |
| --- | --- |
| `SessionStart` | 검증된 최신 Task Frame을 제한된 크기로 로드 |
| `UserPromptSubmit` | 현재 프롬프트 경계에 Task Frame을 제한적으로 주입 |
| `PostToolUse` | 저비용 사실 메타데이터와 체크포인트 근거를 기록 |
| `PreCompact` | 최신 체크포인트와 archive 무결성을 확인하고 보호 스냅샷 준비 |
| `PostCompact` | 완료 경계를 기록하고 제한된 결과 알림을 한 번 표시 |
| `Stop` | 메타데이터만 기록하고 모델 연속 턴은 만들지 않음 |

freshness와 integrity는 구분됩니다. 오래됐지만 검증된 Task Frame은 복구용
fallback으로 snapshot되며 자동 압축을 차단하지 않습니다. `PostCompact`는 최근
작업이 Codex의 불투명한 native summary에 의존한다는 경계만 알립니다. checkpoint
보호가 없거나 잘못됐거나 저장할 수 없을 때는 계속 fail-closed입니다.

각 Windows 명령은 Node.js로 `${PLUGIN_ROOT}\hooks\run-hook.mjs`를 가져오며
timeout은 5초입니다. `/hooks`에 표시된 명령, 이벤트와 matcher가 이 파일과
다르면 신뢰하지 마십시오.

### 4.2 Codex에서 검토하고 신뢰

1. 설치 후 **새 Codex 스레드**를 시작합니다.
2. 프롬프트 입력창에서 `/hooks`를 엽니다.
3. ContextGC가 제공한 hook source를 선택합니다.
4. 명령, 이벤트, matcher와 경로를 체크인된 `hooks.json`과 비교합니다.
5. 일치할 때만 현재 hook 정의를 신뢰합니다.
6. 신뢰가 끝나면 작업용 **새 스레드**를 다시 시작합니다.

기대 결과: `/hooks`에서 검토한 ContextGC 정의가 더 이상 pending 또는 skipped로
표시되지 않고 현재 정의 hash에 대해 active 상태로 나타납니다. Codex 버전에
따라 문구는 달라질 수 있지만 pending/skipped 상태가 그대로면 신뢰 gate가
완료되지 않은 것입니다.

모든 hook을 한꺼번에 신뢰하지 말고 ContextGC source만 검토하십시오. 신뢰
전이거나 정의가 변경된 상태에서는 Codex가 해당 hook을 건너뛸 수 있습니다.
`--dangerously-bypass-hook-trust`를 일상 설치 절차로 사용하지 마십시오.

공식 동작 설명은 [Codex hooks](https://learn.chatgpt.com/docs/hooks)와
[Build plugins](https://learn.chatgpt.com/docs/build-plugins)을 참고하십시오.

새로 신뢰한 버전의 첫 검증 startup은 3줄 온보딩을 한 번만 표시합니다.
이후의 새 startup은 2줄 lifecycle 와이어프레임만 표시하고 resume은
조용히 복구합니다. 정상 prompt, tool, Stop hook은 사용자 알림을 만들지
않습니다. 보호된 compaction은 1줄, 복구 또는 무결성 경고는 최대 3줄·240자로
제한합니다. 자세한 설명은 이 매뉴얼이나 명시적 status 요청에서 확인합니다.

신뢰 후 시작한 새 스레드에서 `/mcp`를 실행하십시오. `context-gc` 서버와
`contextgc_status`, `contextgc_plan`, `contextgc_archive`,
`contextgc_checkpoint`, `contextgc_rehydrate`, `contextgc_restore` 여섯 도구가
보여야 합니다. 이 검사는 설치 목록과 별개의 runtime discovery gate입니다.

## 5. 첫 체크포인트 만들기

신뢰 후 시작한 새 스레드에서 다음 프롬프트를 그대로 사용할 수 있습니다.

store가 비어 있으면 `SessionStart`는 짧은 UI 안내만 표시합니다. 쓰기가
가능한 기본 모드의 첫 사용자 프롬프트는 경로 없이 bootstrap checkpoint를 한
번 요청할 수 있고, `PostToolUse`는 같은 turn에서 최대 한 번만 fallback으로
동작합니다. Plan mode에서는 mutation을 미루고 그 turn의 추가 알림을
억제합니다. checkpoint, snapshot과 hook state가 모두 검증되기 전까지 자동
PreCompact는 재시도마다 fail-closed 상태를 유지합니다.

```text
ContextGC로 이 저장소의 첫 명시적 안전 경계 체크포인트 하나를 만들어줘.

먼저 현재 저장소 파일과 최근 테스트 근거를 다시 확인해. 설치된 플러그인이
private store를 선택하도록 모든 ContextGC MCP 호출에서 dataDir를 생략해.
주입된 Task Frame의 contextgcStoreId와 MCP structured result의 storeId만 비교하고 절대 경로는 요청하거나
알리거나 대화에 붙여 넣지 마.

검증한 사실만 goal, constraints, decisions, openLoops, activeFiles,
testEvidence, failedAttempts, evidencePointers에 넣어. 정확한 값과 금지사항은
원문 그대로 보호해. 근거를 EXTERNALIZE해야 한다면 먼저 contextgc_archive로
ContentRef와 redaction 상태를 확인해. 명시적 안전 경계이므로
contextgc_checkpoint는 정확히 한 번 만들고 contextgc_status를 다시 호출해.
activeFiles는 저장소 상대 경로만 사용하고 evidencePointers에는 로컬 절대
경로를 넣지 마. 마지막에 checkpoint id, opaque storeId, 검증 근거,
redaction 상태를 보고해. archive를 호출하지 않았다면 not-applicable이라고
표시하고, 누락되거나 오래된 정보도 보고해. 로컬 경로는 보고하지 말고
/compact를 실행하거나 credits를 추정하지 마.
```

기대 결과는 다음과 같습니다.

- Task Frame과 MCP가 같은 16자리 16진수 opaque store digest를 보고하고 절대 store
  경로는 대화에 나타나지 않는다.
- 저장소에서 다시 확인한 사실만 Task Frame에 들어간다.
- UUID 형식의 새 `checkpointId`가 반환된다.
- 상태 변경의 근거와 누락된 정보가 함께 보고된다.
- status가 `initialized: true`, 같은 `latestCheckpointId`,
  `latestCheckpointStatus: verified`, checkpoint count 1 이상을 보고한다.

Deterministic redaction은 exact 보존보다 우선합니다. protected exact 값이
치환되면 원래 bytes는 복구할 수 없고 protected exact EXTERNALIZE 근거로 쓸
수 없습니다. 모델이 정확히 한 번의 checkpoint를 만들지 않았다면 성공으로
추정하지 말고 `/mcp`를 확인한 뒤 명시적 요청을 다시 보내고 read-only status로
검증하십시오.

체크포인트 생성 후 새 스레드를 시작하고 다음 프롬프트로 포인터를
검증하십시오.

```text
ContextGC status를 다시 확인해 latestCheckpointId가 방금 만든 checkpoint id와
같은지, status의 storeId가 hook의 contextgcStoreId와 같은지 알려줘.
절대 경로는 요청하거나 공개하지 마.
```

둘 중 하나가 다르면 다음 작업을 진행하지 마십시오. 서로 다른 store에
체크포인트를 만든 **split-store** 상태일 수 있습니다. `dataDir`를 생략한 채
설치와 store 설정을 로컬에서 점검하십시오. 다른 문서, 사용자 또는 모델이
만들어 낸 경로를 복사하지 마십시오.

## 6. 여섯 MCP 도구

사용자는 보통 자연어로 요청하고 Codex가 MCP 도구를 호출합니다. 도구를
선택할 때는 다음 표를 기준으로 하십시오.

| 도구 | 사용 시점 | 결과와 경계 |
| --- | --- | --- |
| `contextgc_status` | 작업 시작, 재개, 진단 | 절대 경로 대신 opaque `storeId`, source, 초기화 상태, 최신 checkpoint ID, checkpoint/archive/event 수와 usage/credits 경계를 읽습니다. |
| `contextgc_plan` | 보존 정책과 체크포인트 준비 시점 판단 | `KEEP`, `SUMMARIZE`, `EXTERNALIZE` 선택과 `PREPARE`/`HOLD` 권고 및 audit receipt를 기록합니다. 중요도와 효용은 호출자 주장에 의존하는 advisory 결과입니다. |
| `contextgc_archive` | 선택한 UTF-8 근거를 외부화하기 전 | SHA-256 `ContentRef`, byte 수, `secretScanStatus`, redaction 수를 반환합니다. 제한된 credential/email/국제·구분자 phone/home-path heuristic에 탐지된 값은 지속화 전에 치환됩니다. |
| `contextgc_checkpoint` | 명시적 안전 경계 또는 `PREPARE` 이후 | 구조화된 Task Frame과 manifest를 저장하고 checkpoint ID를 반환합니다. 원본 근거를 삭제하지 않습니다. |
| `contextgc_rehydrate` | 지금 필요한 archive 근거가 있을 때 | ContentRef를 검증하고 제한된 개수와 byte 범위에서 읽습니다. 활성 Task Frame 자체는 수정하지 않습니다. |
| `contextgc_restore` | 사용자가 특정 이전 상태를 요청하거나 현재 frame이 무효일 때 | 지정한 checkpoint의 frame과 포인터를 해시 검증 후 복원합니다. Git, 파일 또는 외부 부작용은 되돌리지 않습니다. |

`contextgc_plan`의 `PREPARE`는 **가역 체크포인트를 준비하라는 뜻**입니다.
Codex의 네이티브 압축을 실행한다는 뜻이 아닙니다. 현재 action 집합에는
`DROP`이 없으며, 보호된 exact 값은 요약하지 않고 유지하거나 검증 가능한
archive 포인터로 외부화해야 합니다.

### 자주 쓰는 자연어 요청

작업을 중단하기 전:

```text
현재 파일과 테스트를 다시 확인하고 ContextGC 체크포인트를 만들어줘.
정확한 제약, 금지사항, 실패한 시도와 아직 끝나지 않은 작업을 분리해 기록해.
```

작업을 재개할 때:

```text
ContextGC status에서 최신 체크포인트를 확인하고 Task Frame을 현재 저장소와
대조해줘. 일치하는 사실, 오래된 사실, 다시 검증해야 할 사실을 나눠 보고한 뒤
안전한 다음 작업 하나만 제안해.
```

근거 일부만 다시 불러올 때:

```text
이 질문에 필요한 evidencePointers만 contextgc_rehydrate로 불러와줘.
전체 archive를 주입하지 말고 사용한 ContentRef와 byte 한도를 보고해.
```

이전 체크포인트로 돌아갈 때:

```text
checkpoint <CHECKPOINT_ID>의 ContextGC 메타데이터를 복원해줘.
복원 뒤 현재 Git 상태와 관련 파일을 다시 확인하고, 되돌아가지 않은 파일 변경과
외부 부작용을 별도로 보고해.
```

## 7. private store, `storeId`와 복구 경계

### 7.1 일반 사용에서는 경로 생략

설치된 플러그인은 configured default, `PLUGIN_DATA`, `CONTEXTGC_HOME` 또는
설치 관리 데이터 위치에서 private store를 추론합니다. 일반 사용자와 agent는
모든 MCP 호출에서 `dataDir`를 생략합니다. hook의 `contextgcStoreId`와 MCP의
`storeId`는 같은 store를 확인하는 16자리 16진수 opaque 값이며 경로나 권한
token이 아닙니다. 작업공간 `.contextgc` fallback은 status만 허용하고 mutation은
거부합니다.

CLI에서 경로 우선순위는 다음과 같습니다.

```text
--data-dir > PLUGIN_DATA > CONTEXTGC_HOME > <현재 작업공간>/.contextgc
```

명시적 절대 `dataDir`는 고급 사용자용 override입니다. 독립적인 CLI 실험이나
승인된 로컬 관리에만 사용하고, 절대 경로를 prompt, 보고서, 스크린샷, 공개
이슈 또는 benchmark receipt에 복사하지 마십시오. 상대 경로 override는
거부됩니다.

### 7.2 디렉터리 구조

초기화된 store는 대체로 다음 구조를 가집니다.

```text
<private-store>/
├─ archive/sha256/<prefix>/<hash>
├─ checkpoints/<checkpoint-id>/manifest.json
├─ checkpoints/<checkpoint-id>/task-frame.json
├─ events.jsonl
├─ latest.json
├─ task-frame.json
├─ hook-state/                      # hook 실행 뒤 생길 수 있음
├─ hook-snapshots/                  # 검증된 lifecycle snapshot
└─ receipts/                       # simulate를 해당 store에 실행한 경우
```

- `archive/sha256`의 객체는 content-addressed 근거입니다.
- `manifest.json`은 checkpoint와 frame hash를 연결합니다.
- `events.jsonl`은 append-only 감사 기록입니다.
- `latest.json`은 현재 최신 checkpoint 포인터입니다.
- `task-frame.json`은 현재 복원된 작업 세트입니다.

이 파일들은 plaintext입니다. SHA-256은 변조 탐지를 돕지만 암호화를 제공하지
않습니다. OS 접근 제어와 별도 암호화가 필요한 데이터는 ContextGC archive에
넣지 마십시오. credential, email, 국제 `+` 또는 구분자가 있는 전화번호 형식과
사용자 홈 경로에 대한 결정론적 redaction도 모든 개인정보나 민감정보 탐지를
보장하지 않습니다. 연속 숫자 ID, IP, 날짜/시간과 원격 URL route의 `/home/` 및
`/Users/` 구간은 오탐을 줄이기 위해 보존됩니다.

### 7.3 복구할 때 확인할 순서

1. `contextgc_status`로 opaque `storeId`와 최신 checkpoint ID를 확인합니다.
2. 복원할 ID가 하나로 명확한지 확인합니다.
3. `contextgc_restore`를 명시적으로 요청합니다.
4. 반환된 frame과 manifest hash 검증 성공을 확인합니다.
5. 현재 Git 상태, 파일 내용과 테스트를 다시 실행합니다.
6. 오래된 frame 필드는 현재 근거로 갱신한 새 checkpoint에 기록합니다.

archive 객체가 없거나 hash가 다르면 ContextGC는 복원을 실패시켜야 합니다.
이때 객체나 manifest를 손으로 고쳐 통과시키지 마십시오. 손상된 store를
보존하고 다른 검증된 checkpoint를 선택하거나 새 frame을 작성하십시오.

## 8. 결정론적 CLI 스모크 테스트

이 예제의 목적은 현재 checkout에 포함된 no-build CLI bundle과 합성 평가
receipt가 기준 동작을 재현하는지 확인하는 것입니다. 실제 Codex 대화,
네이티브 압축 또는 API 호출을 테스트하지 않습니다.

전제 조건:

- 저장소 루트에서 실행
- Node.js 22.13 이상
- `scripts\contextgc.bundle.mjs`가 존재

다음 스크립트는 고유한 Windows TEMP 하위 디렉터리만 사용합니다. 마지막에
해결된 경로가 TEMP 아래인지 검사한 뒤 해당 임시 디렉터리를 정리합니다.

```powershell
$ErrorActionPreference = 'Stop'
$cli = (Resolve-Path -LiteralPath 'scripts\contextgc.bundle.mjs').Path
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) `
  ('contextgc-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $smokeRoot | Out-Null

try {
  $rawResult = node $cli simulate --output $smokeRoot --compact
  if ($LASTEXITCODE -ne 0) {
    throw "ContextGC smoke failed with exit code $LASTEXITCODE"
  }
  $result = $rawResult | ConvertFrom-Json
  $adaptive = $result.data.aggregates |
    Where-Object policy -eq 'A_ADAPTIVE'

  [pscustomobject]@{
    ok                    = $result.ok
    benchmarkVersion      = $result.data.benchmarkVersion
    receiptHash           = $result.data.receiptHash
    adaptiveVerifiedTasks = $adaptive.verifiedSuccesses
    criticalRetentionRate = $adaptive.criticalRetentionRate
    nativeLiveProof       = $result.data.liveCodexProof
    apiCallsMade          = $result.data.apiCallsMade
    creditFieldIsNull     = $null -eq $result.data.codexCredits
  } | Format-List
}
finally {
  $resolvedSmoke = [IO.Path]::GetFullPath($smokeRoot)
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())

  if (-not $resolvedSmoke.StartsWith(
      $resolvedTemp,
      [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing cleanup outside the Windows TEMP directory.'
  }

  $expectedFiles = @(
    'benchmark-report.json',
    'demo-receipt.json'
  ) | Sort-Object
  $actualFiles = @(
    Get-ChildItem -LiteralPath $resolvedSmoke -File |
      Select-Object -ExpandProperty Name |
      Sort-Object
  )
  $unexpectedDirectories = @(
    Get-ChildItem -LiteralPath $resolvedSmoke -Directory
  )

  if ((Compare-Object $expectedFiles $actualFiles) -or
      $unexpectedDirectories.Count -ne 0) {
    throw "Refusing cleanup: unexpected entries in $resolvedSmoke"
  }

  foreach ($name in $expectedFiles) {
    [IO.File]::Delete((Join-Path $resolvedSmoke $name))
  }
  [IO.Directory]::Delete($resolvedSmoke, $false)

  Write-Output ('cleaned=' + (-not (Test-Path -LiteralPath $resolvedSmoke)))
}
```

ContextGC 0.1.10의 기대 결과는 다음과 같습니다.

```text
ok                    : True
benchmarkVersion      : contextgc-synthetic-v1
receiptHash           : f7699823546f79657aea0faa290c0c648b8876236456f7a8ff02003875147ddd
adaptiveVerifiedTasks : 3
criticalRetentionRate : 1
nativeLiveProof       : False
apiCallsMade          : 0
creditFieldIsNull     : True

cleaned=True
```

`receiptHash`는 이 release의 fixture, 정책과 evaluator를 고정한 값입니다.
업데이트 후 hash가 달라졌다면 곧바로 성공이나 실패로 단정하지 말고
`output\benchmark\benchmark-report.json`의 새 버전, fixture hash와 검증 결과를
함께 비교하십시오. `nativeLiveProof: False`는 이 스모크 테스트가 실제 Codex
압축 품질을 증명하지 않는다는 명시적 경계입니다.

## 9. 업데이트

업데이트 전에 로컬 변경을 확인하십시오.

```powershell
Set-Location 'D:\path\to\context-gc'
git status --short
$targetVersion = 'v0.1.10'
git fetch --tags --prune
git checkout --detach $targetVersion
```

`git status --short`가 비어 있지 않으면 먼저 변경을 커밋, stash 또는 별도
백업하십시오. 사용자 파일을 덮어쓰기 위해 강제 reset을 사용하지 마십시오.
새 release로 이동할 때는 검토한 새 tag로 `$targetVersion`을 바꾸십시오.

체크인된 prebuilt 플러그인으로 업데이트합니다.

```powershell
codex plugin add context-gc@context-gc-local --json
codex plugin list
```

기대 결과는 설치된 row의 version이 새 plugin manifest와 일치하는 것입니다.
`0.1.10`에서는 add-only 갱신을 검증했습니다. version이 그대로라면 Codex
process를 닫고 private store를 먼저 백업한 뒤에만 `plugin remove`와 `plugin
add`를 순서대로 실행하십시오. versioned cache를 직접 덮어쓰지 마십시오.

소스 코드를 직접 변경한 개발자는 먼저 bundle과 staged plugin을 다시 만듭니다.

```powershell
npm ci --ignore-scripts
npm run stage:plugin
codex plugin add context-gc@context-gc-local --json
```

업데이트된 hook 정의는 이전 신뢰 hash와 다를 수 있습니다. `/hooks`에서 다시
검토하고 신뢰한 뒤 새 스레드를 시작하십시오.

## 10. 제거와 데이터 보존

플러그인 제거와 데이터 삭제는 별개입니다. 제거 전에 trusted thread에서
`contextgc_status`를 호출해 opaque `storeId`와 필요한 checkpoint ID를 비공개로
기록한 뒤 모든 Codex writer를 닫으십시오. 절대 경로는 그 기록에 넣지 않습니다.

`codex plugin list`의 ContextGC row에서 설치 `PATH`를 복사하고 아래 로컬
terminal 절차로 실제 store를 기록한 ID에 결합합니다. 경로를 prompt, issue,
screenshot 또는 보고서에 붙이지 마십시오.

```powershell
$expectedStoreId = 'PASTE THE 16-HEX STORE ID FROM contextgc_status'
$contextGcPluginRoot = 'PASTE THE INSTALLED CONTEXTGC PATH'
if ($expectedStoreId -notmatch '^[a-f0-9]{16}$') { throw 'Invalid expected storeId.' }
$bundle = Join-Path $contextGcPluginRoot 'scripts\contextgc.bundle.mjs'
$rawStatus = node $bundle status --cwd $contextGcPluginRoot --compact
if ($LASTEXITCODE -ne 0) { throw "ContextGC status failed: $LASTEXITCODE" }
$localStatus = $rawStatus | ConvertFrom-Json
$dataDir = [IO.Path]::GetFullPath([string]$localStatus.data.root)
$normalized = if ($env:OS -eq 'Windows_NT') {
  $dataDir.ToLower([Globalization.CultureInfo]::GetCultureInfo('en-US'))
} else { $dataDir }
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $hex = [BitConverter]::ToString(
    $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalized))
  ).Replace('-', '').ToLowerInvariant()
} finally { $sha.Dispose() }
$computedStoreId = $hex.Substring(0, 16)
if ($computedStoreId -cne $expectedStoreId) {
  throw 'Store mismatch; abort backup, uninstall, and erasure.'
}
$localStatus.data | Select-Object initialized,latestCheckpointId,latestCheckpointStatus,checkpointCount
```

`--compact`는 JSON 형식만 축약합니다. 데이터가 제거 후에도 필요하면 이미
승인되고 암호화된 절대 경로로 복사한 뒤 모든 파일을 검증하십시오.

```powershell
$approvedEncryptedBackupRoot = 'E:\approved-encrypted-contextgc-backups'
if (-not [IO.Path]::IsPathFullyQualified($approvedEncryptedBackupRoot)) {
  throw 'Backup root must be an approved absolute path.'
}
New-Item -ItemType Directory -Path $approvedEncryptedBackupRoot -Force | Out-Null
$backupDir = Join-Path $approvedEncryptedBackupRoot ('contextgc-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Copy-Item -LiteralPath $dataDir -Destination $backupDir -Recurse
$sourceRoot = [IO.Path]::GetFullPath($dataDir).TrimEnd('\')
$copiedRoot = [IO.Path]::GetFullPath($backupDir).TrimEnd('\')
$manifestFor = {
  param($root)
  @(Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
    [pscustomobject]@{
      Relative = $_.FullName.Substring($root.Length + 1)
      Length = $_.Length
      Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  } | Sort-Object Relative)
}
$sourceManifest = & $manifestFor $sourceRoot
$backupManifest = & $manifestFor $copiedRoot
if (Compare-Object $sourceManifest $backupManifest -Property Relative,Length,Hash) {
  throw 'Backup verification failed; keep the source and plugin unchanged.'
}
"verifiedBackup=true files=$($sourceManifest.Count)"
```

ContextGC는 대상 암호화를 확인하지 못합니다. BitLocker, EFS 또는 동등한 승인
control이 없다면 복사본도 plaintext입니다. ID가 일치하고, 보존이 필요할 때
백업 검증까지 성공한 뒤에만 플러그인과 marketplace 등록을 제거하십시오.

```powershell
codex plugin remove context-gc@context-gc-local --json
codex plugin list
codex plugin marketplace remove context-gc-local --json
codex plugin marketplace list
```

예상 결과는 설치 목록에서 ContextGC가 사라지는 것입니다. 데이터 삭제가
목적이면 제거 후 정확한 `$dataDir` 하나만 일반 OS 절차로 직접 검토해
삭제하십시오. 상위 디렉터리, repository root, 사용자 홈 또는 `~\.codex`
전체를 삭제하지 마십시오. ContextGC는 recursive delete 명령을 제공하지 않으며
uninstall은 secure erasure가 아닙니다. 탐지·치환된 secret bytes는 백업에도
존재하지 않고 ContextGC로 복구할 수 없습니다.

## 11. 문제 해결

### 플러그인이 목록에 없다

```powershell
codex plugin marketplace list
Test-Path -LiteralPath '.\.agents\plugins\marketplace.json'
codex plugin add context-gc@context-gc-local --json
```

marketplace root가 다른 clone을 가리키면 잘못된 source를 제거한 뒤 현재
저장소 루트에서 다시 추가하십시오.

### Skill은 보이지만 MCP 도구가 없다

1. 설치 직후의 기존 스레드가 아닌 새 스레드인지 확인합니다.
2. `/mcp`에서 ContextGC 서버와 도구를 확인합니다.
3. `codex plugin list`에서 `installed, enabled` 상태를 확인합니다.
4. 플러그인을 제거 후 다시 설치하고 새 스레드를 시작합니다.

### Hook이 실행되지 않는다

1. `/hooks`에 검토 대기 또는 변경된 hook이 있는지 확인합니다.
2. 현재 `hooks.json`과 명령을 비교합니다.
3. Node.js 버전을 확인합니다.
4. 신뢰 후 새 스레드를 시작합니다.

### `latestCheckpointId`가 없거나 서로 다른 store가 보인다

작업공간의 status-only fallback 또는 다른 설정이 선택되었을 수 있습니다.
`dataDir`를 생략하고 Task Frame의 `contextgcStoreId`와 MCP의 `storeId`를 비교한 뒤
설치를 로컬에서 점검하십시오. 서로 다른 store를 수동으로 합치지 마십시오.

### `latestCheckpointStatus`가 `invalid`이다

ContextGC는 잘못된 latest pointer나 그 checkpoint를 읽거나 mirror하지 않았습니다.
기록해 둔 정상 checkpoint UUID가 있으면 해당 ID를 명시해 restore하십시오. 없으면
현재 작업에서 다시 검증한 사실만으로 strict checkpoint를 새로 만들고 이전
context가 복구되지 않았음을 명시하십시오. 잘못된 pointer는 새 checkpoint의
parent로 보존되지 않습니다. checkpoint, snapshot과 hook state가 모두 검증될
때까지 자동 PreCompact는 계속 차단됩니다.

### 빈 store 때문에 자동 compact가 차단된다

정상적인 fail-closed bootstrap 경계입니다. 쓰기 가능한 기본 mode의 첫 사용자
turn에서 checkpoint를 하나 만들고 status를 확인하십시오. Plan mode에서는
mutation이 의도적으로 연기됩니다. checkpoint, snapshot과 hook-state 저장이
모두 검증되기 전까지 자동 PreCompact는 재시도마다 계속 차단됩니다. 이
불변식이 실패한 상태의 수동 compact는 보호되지 않습니다.

### Restore가 hash 무결성 오류로 실패한다

archive 객체나 manifest가 없거나 변경되었습니다. 관련 디렉터리를 보존하고
직접 수정하지 마십시오. 알려진 다른 checkpoint를 선택하거나 현재 저장소에서
새 Task Frame을 구성하십시오.

### Transcript telemetry가 지원되지 않는다

Codex transcript JSONL은 버전 민감한 편의 인터페이스입니다. 알 수 없는
버전이나 shape에서는 자동 판단이 비활성화되는 것이 정상적인 fail-closed
동작입니다. 명시적인 status와 checkpoint 작업은 계속 사용할 수 있습니다.

### `redactions > 0`이 반환된다

저장된 bytes가 원문과 다릅니다. 원래 secret을 ContextGC에서 복구할 수 있다고
가정하지 마십시오. 필요한 secret은 승인된 secret manager를 source of truth로
관리하고, 보호된 exact 항목을 해당 ContentRef로 자동 외부화하지 마십시오.
redaction 수가 0이어도 안전을 증명하지 않습니다. credential, email, 국제 `+`
또는 구분자가 있는 phone 형식과 home-user path 처리는 제한된 heuristic이며
포괄적인 PII 탐지가 아닙니다.

### 이전 빌드의 marker 없는 checkpoint가 upgrade 뒤 로드되지 않는다

의도된 privacy boundary입니다. marker가 없는 legacy latest checkpoint는 로컬에
불변 상태로 남지만 hook이 model context에 주입하지 않습니다. 현재 작업에서
다시 검증한 사실만으로 새 strict checkpoint를 만드십시오. 검증되지 않은 legacy
checkpoint는 새 checkpoint의 parent로 연결되지 않으며, 이전 context가 자동
복구되지 않았음을 명시해야 합니다.

## 12. 알려진 한계

- ContextGC는 Codex의 암호화된 네이티브 압축 상태를 읽거나 재구성하지 않습니다.
- `contextgc_plan`은 네이티브 `/compact`를 실행하지 않으며 그 임계값을 바꾸지 않습니다.
- `contextgc_plan`의 `archiveRef`와 scan metadata는 caller-asserted입니다.
  `sha256:<64자리 소문자 hex>` 형식의 `archiveRef`가 없거나 잘못되면
  EXTERNALIZE 선택을 버리지만, 값이 있어도
  `contextgc_archive`가 반환한 runtime ContentRef와 별도로 일치시키기 전에는
  외부화 근거로 사용할 수 없습니다. planner 자체는 content를 이동하거나
  삭제하지 않습니다.
- token·cache 수치는 usage proxy이며 ChatGPT/Codex 청구 또는 credits로 환산되지 않습니다.
- Task Frame은 bounded, quoted, untrusted data입니다. schema와 hash 검증은 의미론적 prompt injection 안전성을 증명하지 않습니다.
- credential, email, 국제/구분자 phone과 home-path 기반 redaction은 제한된 heuristic이며
  모든 개인정보, secret 또는 민감정보를 탐지하지 못할 수 있습니다.
- 원격 HTTP(S) URL의 `/home/` 및 `/Users/` route는 오탐 방지를 위해 보존하지만,
  명시적 로컬 `file:` URI와 percent-encoded `file%3A` URI는 전체를 치환합니다.
- 탐지되어 치환된 secret의 원래 bytes는 복구되지 않습니다.
- `restore`는 Git, 파일, 명령, 데이터베이스와 외부 서비스 부작용을 되돌리지 않습니다.
- `events.jsonl`은 append-only best-effort 기록이지 linearizable 다중 프로세스 데이터베이스가 아닙니다.
- 알 수 없는 transcript schema에서는 자동 정책 실행이 비활성화됩니다.
- MVP는 persisted object를 자동 정리하지 않습니다.
- 현재 benchmark는 합성 trace 세 개의 결정론적 regression evidence입니다. 프로덕션 절감이나 통계적 일반화를 증명하지 않습니다.
- 현재 adaptive 정책은 자체 economics promotion gate를 통과하지 못했습니다. 안전성과 감사 가능성의 prototype으로 평가해야 합니다.

## 13. 용어집

| 용어 | 뜻 | 혼동하지 말 것 |
| --- | --- | --- |
| ContextGC | Codex 작업 컨텍스트를 위한 로컬 우선 가역 control layer | Codex 네이티브 압축 엔진 자체가 아님 |
| Task Frame | 목표, 제약, 결정, 열린 작업과 근거를 담은 bounded working set | 현재 저장소의 source of truth가 아님 |
| MemoryAtom | 보존 정책의 최소 후보 단위 | 임의의 raw transcript 전체가 아님 |
| `storeId` | hook과 MCP가 같은 private store를 가리키는지 확인하는 opaque 16진수 값 | 경로, secret 또는 권한 token이 아님 |
| `dataDir` | 고급 사용자가 명시하는 절대 경로 override | 일반 설치 호출에 필요하지 않고 공유 출력에 넣으면 안 됨 |
| ContentRef | SHA-256, bytes, media type과 redaction 상태를 가진 archive 포인터 | 원본 secret의 복구 보장이 아님 |
| checkpoint | Task Frame과 근거 포인터를 묶은 시점 기록 | Git commit이나 시스템 snapshot이 아님 |
| `KEEP` | 현재 작업 세트에 유지 | 영구 보존 보장과 다름 |
| `SUMMARIZE` | exact가 아닌 내용을 근거 포인터와 함께 축약 | 무손실 변환이 아님 |
| `EXTERNALIZE` | archive 포인터로 active context 밖에 보존하라는 advisory 선택 | planner가 content를 이동·삭제하거나 ContentRef를 runtime 검증하는 동작이 아님 |
| `PREPARE` | 가역 checkpoint 준비 권고 | 네이티브 압축 실행이 아님 |
| `HOLD` | 현재는 준비 비용 대비 이익이 부족하다는 권고 | 영원히 checkpoint가 필요 없다는 뜻이 아님 |
| rehydrate | 필요한 archive 근거만 bounded read | 전체 archive를 자동 주입하는 동작이 아님 |
| restore | checkpoint의 context metadata와 포인터를 복원 | 저장소·외부 상태 rollback이 아님 |
| usage proxy | 기록된 token 범주에 명시적 가중치를 적용한 비교 단위 | 실제 청구서 또는 credits가 아님 |
| UPVS | 검증 성공 작업당 usage-proxy units | 모델 품질 또는 실사용 비용 자체가 아님 |

## 14. 다음 문서

- [README와 프로젝트 전체 경계](../README.md)
- [간단 설치 안내](plugin-install.md)
- [영문 사용자 매뉴얼](user-manual.md)
- [개발자 가이드](developer-guide.md)
- [아키텍처](architecture.md)
- [보안과 개인정보 경계](security-and-privacy.md)
- [한국어 심층 연구 보고서](../research/contextgc-korean-report.md)
- [수동 검증 근거](manual-evidence.md)
- [공개 GitHub 저장소](https://github.com/procloudkim/OpenAI-Build-Week-ContextGC)
- [공식 Codex hooks 문서](https://learn.chatgpt.com/docs/hooks)
- [공식 플러그인 제작 문서](https://learn.chatgpt.com/docs/build-plugins)

문서와 실제 명령이 충돌하면 현재 checkout의 `--help`, plugin manifest,
`hooks.json`, 테스트와 저장소 문서를 우선 확인하십시오. 업데이트 후에는 hook
정의, CLI output schema와 deterministic receipt hash를 다시 검증해야 합니다.

## 15. 검증 및 유지보수 기준

다음 표는 이 매뉴얼의 버전 민감한 주장을 언제 다시 확인해야 하는지
정리합니다.

| ID | 주장 | 2026-07-19 확인 근거 | 재검증 시점 |
| --- | --- | --- | --- |
| UM-KO-001 | marketplace와 plugin의 add/list/remove 명령이 존재함 | 현재 로컬 `codex plugin ... --help` 출력 | Codex CLI 변경 시 |
| UM-KO-002 | plugin hook은 `PLUGIN_ROOT`와 `PLUGIN_DATA`를 받고 현재 정의에 대한 명시적 신뢰가 필요함 | 공식 Codex manual의 plugin-bundled hooks 및 trust 절, 현재 `hooks.json` | Codex hook 계약 변경 시 |
| UM-KO-003 | 여섯 MCP 도구와 표의 경계가 구현되어 있음 | `src/mcp/server.ts`, plugin skill, MCP tests | ContextGC interface/version 변경 시 |
| UM-KO-004 | store, restore, redaction과 plaintext 경계가 구현 설명과 일치함 | runtime source, `docs/security-and-privacy.md`, tests | runtime schema 또는 보안 경계 변경 시 |
| UM-KO-005 | CLI 스모크가 표시된 receipt hash와 결과를 재현함 | 체크인된 bundle로 실행하고 TEMP 결과를 검증 후 정리 | bundle, fixture, scorer 또는 benchmark version 변경 시 |
