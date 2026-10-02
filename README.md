# CareerLens Frontend

교육용 CareerLens의 로그인과 이력서 → 채용공고 → 추가 질문 → 모의지원 결과 화면입니다. HTML/CSS와 브라우저 기본 ES module을 사용하고, Python 서버가 정적 파일 제공 및 같은 출처 API 프록시를 담당합니다. npm 설치나 프론트엔드 빌드가 필요하지 않습니다.

## 각자 환경에서 실행

Python 3.11 이상이 필요합니다. 이 저장소를 내려받은 폴더에서 실행합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

`.env`의 `BACKEND_URL`을 본인 또는 팀의 API 서버로 지정합니다. URL에는 `/api` 경로를 붙이지 않습니다.

```dotenv
BACKEND_URL=http://127.0.0.1:5101
FRONTEND_PORT=5100
```

원격 API는 `BACKEND_URL=https://api.example.com`처럼 HTTPS 주소를 사용합니다. 원격 평문 HTTP는 지원하지 않습니다. API를 따로 실행한 뒤 프론트엔드를 시작합니다.

```powershell
.\.venv\Scripts\python server.py
```

브라우저에서 [http://127.0.0.1:5100](http://127.0.0.1:5100)을 엽니다. 직접 실행 옵션도 지원합니다.

```powershell
.\.venv\Scripts\python server.py --port 5200 --backend-url https://api.example.com
```

설정 우선순위는 명령행 `--backend-url` → 프로세스 환경변수 → 저장소의 `.env`입니다. `.env`는 단순한 `KEY=value` 형식이고 주석은 별도 줄에 씁니다. 셸 명령이나 변수 치환을 실행하지 않습니다. API 설정이 비어 있으면 503 `backend_unconfigured`, 연결에 실패하면 502 `backend_unavailable` 오류를 표시합니다. `/health`의 `backend_configured`는 주소 설정 유무만 뜻하며 API 연결 성공을 보증하지 않습니다.

## 백엔드·DB·API 연결 조건

[CareerLens Backend](https://github.com/931njhthe-star/CareerLens-backend)의 인증·워크스페이스 API와 연동합니다. 각 팀원은 백엔드 `.env`에 자신의 DB 연결, OAuth, SMTP 및 필요한 API 설정을 넣습니다. 이 프론트엔드는 DB에 직접 접속하지 않습니다.

다른 API 서버를 연결하려면 [OpenAPI 1.1.0 계약](src/shared/api/openapi.json)에 정의한 `/api/v1/auth/session`, 이메일 인증, 쿠키·CSRF, 이력서·공고·분석·워크스페이스 요청과 응답을 구현해야 합니다. 주소만 바꾸어 임의의 API와 호환되지는 않습니다. Supabase REST URL이나 프로젝트 URL 자체는 이 계약을 구현한 CareerLens API가 아닙니다. Supabase 등의 DB 연결은 백엔드 설정에서 처리합니다.

API 키, DB URL, OAuth client secret, SMTP 비밀번호를 JavaScript, `public/`, 프론트엔드 `.env`에 넣지 마세요. 실제 개인 `.env`, DB 파일, 세션키, 메일, 업로드 데이터는 이 저장소에 포함하지 않습니다. 대시보드 기능도 포함하지 않습니다.

## 인증·쿠키·HTTPS

브라우저는 `/api/v1`을 같은 출처로 호출합니다. `server.py`만 `BACKEND_URL`로 연결하므로 CORS 설정이나 브라우저에 API 키를 노출하는 방식이 필요하지 않습니다.

- 백엔드 `PUBLIC_ORIGIN`은 **브라우저에서 연 프론트엔드 주소**와 정확히 같아야 합니다. 예: `http://127.0.0.1:5100`. API 서버 주소와 혼동하지 마세요.
- 프록시는 브라우저의 `Origin`, 세션 쿠키, `X-CSRF-Token`을 전달하고, upstream `Host`는 API 주소로 설정합니다.
- 응답 쿠키의 `Domain` 속성만 제거하여 프론트엔드 호스트에 귀속시킵니다. `Secure`, `HttpOnly`, `SameSite`, `Path`는 유지합니다. 호환 백엔드는 세션 쿠키를 `Path=/`로 설정해야 합니다.
- `Secure` 쿠키를 발급하는 API는 브라우저 쪽도 HTTPS로 제공해야 합니다. 프록시가 `Secure`를 제거해 평문으로 낮추지 않습니다. HTTPS UI는 팀의 TLS reverse proxy를 통해 제공하고 `.env`의 `FRONTEND_PUBLIC_ORIGIN=https://careerlens.example.com`과 백엔드 `PUBLIC_ORIGIN`을 맞춥니다. Python 서버는 루프백에서 실행합니다.
- OAuth 앱에 등록하는 callback은 프론트엔드 주소의 `/api/v1/auth/oauth/{provider}/callback`입니다. 공급자 ID/secret은 백엔드에서 설정합니다. 공급자가 설정되지 않으면 화면의 버튼이 비활성화됩니다.
- API 자신의 origin으로 향하는 `Location`은 프론트엔드의 상대 경로로 변환합니다. 외부 OAuth 공급자 주소는 그대로 전달하고 서버가 대신 따라가지 않습니다.
- HTTPS API 인증서를 정상 검증합니다. 인증서 검증을 끄는 옵션은 없습니다.

상세한 서버 계약과 전달 방법은 [API 연동 문서](docs/api/contract-workflow.md)를 확인하세요.

## 화면 기능

- 이메일 회원가입·로그인·로그아웃, 비밀번호 찾기·재설정, 설정된 OAuth 공급자 연결
- PDF/DOCX/TXT 업로드 및 추출 텍스트 확인, 직접 붙여넣기
- 회사·직무·채용공고 입력과 추가 질문
- 준비도·항목별 근거·강점·보완사항·가상 리크루터 메일·예상 면접 질문
- 계정의 저장 데이터 불러오기, 답변 수정·재분석, 삭제 확인
- 카드 내부 리포트 스크롤, 키보드·모바일 대응, 전체 리포트 인쇄

실제 저장·인증·추출·분석은 연결된 백엔드가 수행합니다. 화면의 회사·공고 예시는 가상이며 실제 기업에 지원서를 보내는 동작은 없습니다. 분석 점수는 준비도 점검용이며 실제 합격 확률이 아닙니다.

## 코드 구조

```text
public/                  진입 HTML·파비콘
src/app/                 라우터·화면 상태
src/pages/               화면 조합
src/features/auth/       로그인·회원가입·비밀번호
src/features/resumes/    이력서 편집
src/features/job-postings/ 공고 편집
src/features/analysis/   질문·결과
src/shared/api/          같은 출처 클라이언트·OpenAPI snapshot
src/shared/components/   셸·공통 UI
src/shared/styles/       반응형·스크롤·인쇄 스타일
server.py                Python 정적 서버·API 프록시
```

## 검증

```powershell
.\.venv\Scripts\python -m unittest discover -s tests -p test_server.py
node --test tests/unit/*.test.mjs
node scripts/sync-api-contract.mjs --check
```

Python 프록시 테스트는 외부 네트워크·실제 DB·자격증명을 사용하지 않습니다. JS 테스트는 HTML 이스케이프, OAuth 설정 상태, CSRF 갱신, 저장된 보고서와 미저장 편집의 분리·보존을 확인합니다. Node.js는 테스트와 계약 검사에만 필요하며 화면 실행에는 필요하지 않습니다.
