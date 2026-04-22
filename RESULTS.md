# Results

## 1. 실험 요약
- 저장소: exp-rag-browser-pipeline
- 커밋 해시: 536a144
- 실험 일시: 2026-04-22T06:14:00.691Z -> 2026-04-22T06:14:00.691Z
- 담당자: ai-webgpu-lab
- 실험 유형: `ml`
- 상태: `success`

## 2. 질문
- browser-only ingest, chunk, retrieve, rerank, answer loop가 단일 보고 흐름으로 남는가
- citation hit-rate와 answer latency를 함께 기록할 수 있는가
- 실제 embedder와 generator를 붙이기 전 deterministic fixture로 end-to-end 경로를 고정할 수 있는가

## 3. 실행 환경
### 브라우저
- 이름: Chrome
- 버전: 147.0.7727.15

### 운영체제
- OS: Linux
- 버전: unknown

### 디바이스
- 장치명: Linux x86_64
- device class: `desktop-high`
- CPU: 16 threads
- 메모리: 16 GB
- 전원 상태: `unknown`

### GPU / 실행 모드
- adapter: not-applicable
- backend: `mixed`
- fallback triggered: `false`
- worker mode: `main`
- cache state: `cold`
- required features: []
- limits snapshot: {}

## 4. 워크로드 정의
- 시나리오 이름: Browser RAG Fixture
- 입력 프로필: 3-docs-3-questions
- 데이터 크기: deterministic fixture; docs=3; chunks=6; questions=3; automation=playwright-chromium
- dataset: rag-fixture-v1
- model_id 또는 renderer: -
- 양자화/정밀도: -
- resolution: -
- context_tokens: -
- output_tokens: -

## 5. 측정 지표
### 공통
- time_to_interactive_ms: 214.3 ms
- init_ms: 9.6 ms
- success_rate: 1
- peak_memory_note: 16 GB reported by browser
- error_type: -

### RAG
- ingest_ms_per_page: 0.17 ms
- chunk_count: 6
- embed_total_ms: 9.6 ms
- retrieve_ms: 0.13 ms
- rerank_ms: 0 ms
- answer_total_ms: 31.03 ms
- citation_hit_rate: 1

## 6. 결과 표
| Run | Scenario | Backend | Cache | Mean | P95 | Notes |
|---|---|---:|---:|---:|---:|---|
| 1 | Browser RAG Fixture | mixed | cold | 31.03 | 18.37 | retrieve=0.13 ms, citation_hit_rate=1 |

## 7. 관찰
- end-to-end answer_total_ms는 31.03 ms, citation_hit_rate는 1였다.
- 이 baseline은 fixture 기반 extractive answer여서 retrieval/rerank 경로 검증용으로 해석하는 편이 맞다.
- playwright-chromium로 수집된 automation baseline이며 headless=true, browser=Chromium 147.0.7727.15.
- 실제 runtime/model/renderer 교체 전 deterministic harness 결과이므로, 절대 성능보다 보고 경로와 재현성 확인에 우선 의미가 있다.

## 8. 결론
- deterministic RAG pipeline baseline의 raw result와 요약 문서가 처음으로 채워졌다.
- 다음 단계는 실제 embedder, retriever, reranker를 붙여 같은 질문 세트를 유지하는 것이다.
- citation hit-rate와 answer latency를 브라우저별로 누적해야 계획 기준에 도달한다.

## 9. 첨부
- 스크린샷: ./reports/screenshots/01-browser-rag-fixture.png
- 로그 파일: ./reports/logs/01-browser-rag-fixture.log
- raw json: ./reports/raw/01-browser-rag-fixture.json
- 배포 URL: https://ai-webgpu-lab.github.io/exp-rag-browser-pipeline/
- 관련 이슈/PR: -
