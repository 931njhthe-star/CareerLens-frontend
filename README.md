# CareerLens Frontend

승인된 **포슬린 블루 · 스튜디오 보고서 · 사파이어 방사형 눈 · 클리어 사파이어 피라미드 · 블루 오빗 전환**을 유지하면서 팀 FastAPI 백엔드에 연결합니다. 페이지와 모션은 기존 HTML/CSS·브라우저 ES module이며 화면 실행에 npm 설치나 빌드가 필요하지 않습니다.

현재 흐름은 소개 → 이력서 → 희망 직무 → 채용공고 → 모의지원 결과 확인 → 눈 모션 분석 → 결과입니다. **실제 평가는 로그인 후 시작**합니다. 로그인 전 입력·공고 탐색은 가능하지만 실제 평가 API를 비회원으로 호출하지 않습니다. 백엔드는 `develop`의 평가·보고서 계약을 사용하고, 프론트 `src/shared/api/backend-adapter.js`가 기존 화면 구조에 맞춥니다.

## 실행

프로젝트 상위 폴더의 `start.bat`은 Python 3.12+ 공유 환경에서 프론트 5300, FastAPI 5301, 별도 평가 워커를 실행합니다. `start.bat --no-worker --no-browser`는 대기 평가를 가져가지 않고 API·화면만 확인하는 모드입니다. 자세한 내용은 [상위 실행 안내](../README.md)를 참고하세요.

프론트만 따로 실행하려면 이 저장소에서 다음을 실행합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

프론트 `.env`에는 API 서버 주소와 공개 프론트 설정만 넣습니다. `/api` 경로를 붙이지 않습니다.

```dotenv
BACKEND_URL=http://127.0.0.1:5301
FRONTEND_PORT=5300
```

```powershell
.\.venv\Scripts\python server.py
```

원격 API는 `https://api.example.com` 같은 HTTPS origin을 사용합니다. 원격 평문 HTTP는 지원하지 않습니다. 설정 우선순위는 `--backend-url` → 프로세스 환경변수 → `.env`입니다. 환경 파일은 단순한 `KEY=value`이며 셸 명령을 실행하지 않습니다. `/health`는 프론트 생존과 API 주소 설정 여부만 나타냅니다. API 연결 실패는 502, 주소 미설정은 503으로 표시합니다.

## 현재 API·인증 연결

브라우저는 `/api/v1`을 같은 출처로 호출하고, Python 프론트 서버가 `BACKEND_URL`로 전달합니다. 프록시는 `Authorization`, `Idempotency-Key`, `Last-Event-ID`를 보존합니다. Supabase 프로젝트 URL 자체를 `BACKEND_URL`로 쓰지 않습니다.

실제 계정은 백엔드의 이메일·비밀번호 로그인/가입을 사용합니다. 백엔드에서 발급한 access/refresh token과 프론트 임시 작업 상태는 브라우저 `sessionStorage`에 보관합니다. 현재 백엔드에는 OAuth와 비밀번호 재설정 API가 없으므로 해당 기능을 실제 지원하는 것처럼 표시하지 않습니다. 명시적 합성 시연 모드는 실제 계정·평가와 구분합니다.

로그인 전 첨부·선택 준비는 브라우저 세션에만 보관하고, 최초 유효 첨부부터 30분 유효 기간을 사용합니다. 만료된 상태 접근 시 제거하며 파일 교체로 시간을 늘리지 않습니다. 인증 후 연결은 이력서를 백엔드에 업로드하고 직무·백엔드 공고 선택을 복구합니다. 비회원 실제 평가·완료 보고서를 서버에 저장했다가 가져오는 이전 `guest_workspaces` 방식은 아닙니다.

OpenAI 키, Supabase service role 키, DB URL·비밀번호는 **백엔드 `.env` 전용**입니다. 프론트 JavaScript, `public/`, 프론트 `.env`, 커밋에 넣지 마세요. 현재 데이터 저장 위치는 백엔드 환경설정이 지정한 Supabase이며 이전 로컬 SQLite 자료를 자동 이전하지 않습니다.

## 업로드·공고·평가

- `POST /api/v1/local-data/convert-resume`: multipart `file`로 PDF/DOCX/TXT/MD, 최대 10MiB. 프론트 Python 서버가 메모리에서 본문을 추출해 `{filename, text}`를 반환합니다. 원본을 저장하거나 외부 API로 전송하지 않습니다. 암호화·손상 파일, 과도한 페이지·압축 해제 크기, 빈 본문은 거부합니다. 이미지 PDF의 OCR은 포함하지 않습니다.
- 인증된 업로드: 변환된 UTF-8 Markdown을 백엔드 `POST /resumes`로 전달합니다. 백엔드는 이 Markdown과 본문을 Supabase의 비공개 `resume-files` Storage·이력서 테이블에 저장합니다. 직접 붙여넣기도 Markdown으로 전달합니다.
- `GET /api/v1/local-data/career-markdown`: `CAREERLENS_JOB_POSTINGS_DIR` 또는 형제 `CareerLens-backend/app/modules/job_postings`에서 숫자 이름의 가상 공고를 읽습니다. 로그인 전 직무·공고 탐색용이며 실시간 채용 수집 기능이 아닙니다. 실제 평가는 백엔드 `/jobs`에 등록된 공고 ID를 요구합니다.
- 평가: `/evaluations` 생성 후 진행 조회. `/evaluations/{id}/progress`가 404이면 `/evaluations/{id}`로 전환합니다. `completed` 또는 `partial`을 확인하고 `/result` 및 `/reports/{id}`를 읽어 기존 화면 계약의 `{ report }`로 반환합니다.
- 취소·화면 이탈: 추적 중인 평가 ID에 `/evaluations/{id}/cancel`을 `keepalive`로 요청합니다. 브라우저 요청 중단만으로 서버 평가가 중단됐다고 가정하지 않습니다.
- 결과: 실제 평가 요약·검증 상태·Markdown 영역은 백엔드 점수·근거를 유지합니다. 보류된 종합점수는 `null`이며 평균이나 무작위 숫자를 만들어 채우지 않습니다. 기존 스튜디오 피라미드는 실제 평가와 무관하다고 표시한 시연 그래픽으로 유지되며, 이번 연동에서 실제 점수 그래프로 변경하지 않았습니다.

백엔드 워커는 프론트 버튼이 직접 띄우지 않습니다. API와 별도 프로세스로 실행돼야 합니다. 필요한 DB 마이그레이션·체크포인트 초기화는 백엔드 운영 준비이며, 파일을 pull했다는 이유만으로 적용됐다고 간주하지 않습니다. 이 프론트 연결 작업은 백엔드 소스와 원격 DB 스키마를 수정하지 않습니다.

## 화면과 모션

공통 메뉴는 소개·이력서·채용공고·모의 지원이며 희망 직무는 내부 단계입니다. 이력서에서 점이 시작하고, 희망 직무에서 가지와 최대 5개 요소, 채용공고에서 회전 원이 형성됩니다. 앞뒤 이동과 빠른 방향 전환은 현재 장면에서 연속으로 이어집니다. 홈·소개에는 과정 모션이 없습니다.

과정 모션은 본문 뒤에 고정되며 입력 패널은 80% 흰색 배경, 글자 주변은 국소적으로 선을 옅게 처리합니다. 결과 버튼을 누르면 내용이 흰색으로 페이드 아웃하고 같은 위치·크기의 원이 가속해 눈 동공과 이어집니다. 불규칙한 방사형 섬유와 동공 백분율은 시각적 진행이며, 최소 4초와 실제 성공을 모두 확인합니다. 결과 화면에서는 본문이 불투명하게 복구됩니다. 모션은 서버의 항목별 측정값을 뜻하지 않습니다.

[선택된 디자인](docs/product/selected-design.md), [과정 모션·복원 안내](docs/product/motion-journey.md)를 참고하세요. `/motion-preview`와 `/design-lab`은 합성 자료로만 동작하는 비교실이며 실제 평가 API를 호출하지 않습니다. 보고서는 브라우저 열람용이고 인쇄·PDF 다운로드 버튼은 제공하지 않습니다.

## 이전 계약의 보존 범위

기존 OpenAPI 1.7.1 snapshot과 쿠키·CSRF·워크스페이스·비회원 claim 코드는 이전 백엔드 연결 및 회귀 검증을 위해 보존합니다. 이것이 현재 FastAPI에 같은 endpoint가 존재한다는 뜻은 아닙니다. 이전 OAuth·비밀번호 재설정, 서버 SQL guest retention, 관심 공고·직접 입력·가상 이력서 관련 계약은 [API 문서의 이전 계약 부분](docs/api/contract-workflow.md)에 남겨 둡니다.

레거시 쿠키 모드에서는 `PUBLIC_ORIGIN`이 브라우저 origin과 같아야 하며 프록시는 쿠키·`X-CSRF-Token`·`Origin`을 전달합니다. 응답 쿠키는 Domain만 제거하고 Secure/HttpOnly/SameSite/Path를 유지합니다. OAuth callback은 실제 해당 API를 제공하는 구형 서버에서만 유효합니다. HTTPS 인증서 검증을 끄지 않습니다.

## 코드와 검증

`src/app`은 라우팅·상태, `src/pages`는 페이지 조합, `src/features`는 기능·모션, `src/shared/api`는 클라이언트·어댑터, `server.py`는 정적 서버·같은 출처 프록시, `resume_conversion.py`는 로컬 문서 변환을 담당합니다.

```powershell
.\.venv\Scripts\python -m unittest discover -s tests -p test_server.py
node --test tests/unit/*.test.mjs
node scripts/sync-api-contract.mjs --check
```

서버 테스트와 어댑터 테스트는 합성 입력·가짜 API로 실행하며 실제 DB·자격증명·모델 호출을 필요로 하지 않습니다. snapshot 검사 성공은 과거 계약 파일의 해시 검증이며 현재 FastAPI의 실제 호환성을 보증하지 않습니다. Node.js는 테스트와 모션 소스 재빌드에만 필요합니다.

공개 배포는 별도 작업입니다. [이전 배포 준비 안내](infra/deploy/README.md)의 레거시 인증·저장소 설명은 현재 FastAPI 운영 설정과 구분하세요.
