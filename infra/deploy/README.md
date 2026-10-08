# 프론트엔드 배포 준비

화면은 HTML/CSS/ES module이며, Python 서버가 정적 파일과 동일 출처 API 프록시를 제공합니다. 현재 인증 흐름을 유지하려면 정적 파일만 호스팅하는 대신 이 서버 또는 동등한 /api 프록시를 함께 배포해야 합니다.

```sh
python -m pip install -r requirements.txt
python server.py --host 0.0.0.0 --port 8000
```

`--host` > `FRONTEND_HOST` > 127.0.0.1, `--port` > `FRONTEND_PORT` > `PORT` > 5100 순서입니다. 공개 HTTPS는 배포 환경에서 제공합니다. 로컬 통합 start.bat는 loopback을 유지합니다.

- `BACKEND_URL`: 동일 API 계약을 제공하는 백엔드 origin. 경로·키·비밀번호 없이 설정합니다. 로컬 loopback HTTP 또는 원격 HTTPS를 지원하며 원격 평문 HTTP는 지원하지 않습니다.
- `FRONTEND_PUBLIC_ORIGIN`: 실제 공개 HTTPS origin. 서버가 해당 Host를 받아들이는 데 사용합니다.
- 백엔드의 `PUBLIC_ORIGIN`도 같은 브라우저 origin으로 맞춥니다. OAuth callback과 HTTPS 보안 쿠키 설정도 배포 주소에 맞아야 합니다.

브라우저는 상대 경로 /api를 사용하므로 BACKEND_URL 변경에 화면 코드 재작성·재빌드는 필요하지 않습니다. DB/API 비밀키는 백엔드에서 관리합니다. .env·로그·개인 데이터를 Git에 넣지 않습니다.

상태 확인: `/health`는 프론트엔드 생존과 주소 설정 유무, `/api/v1/health`는 백엔드 프록시 연결 확인에 사용합니다. 이후 로그인·저장·분석을 검증합니다. 실배포 업체와 도메인은 미정이며 실제 배포는 수행하지 않았습니다.

### 비회원 원본 파일의 임시 디스크 기록

기본 `python server.py` 실행은 허용 요청 최대 11MiB, Waitress 메모리 버퍼 임계값 12MiB로 설정되어 원본 업로드를 임시 디스크 파일로 넘기지 않습니다. 별도 WSGI 서버나 외부 리버스 프록시를 추가할 때도 요청 본문 디스크 버퍼링을 끄거나 허용 크기보다 높은 메모리 임계값을 설정해야 합니다. 이 프록시는 파일 본문·API 응답을 로그에 기록하지 않습니다.
