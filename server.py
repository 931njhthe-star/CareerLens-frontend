"""Serve the independent frontend and proxy its same-origin API to Python."""

from pathlib import Path
from io import BytesIO
import argparse
import ipaddress
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

from flask import Flask, Request as FlaskRequest, Response, jsonify, request, send_from_directory
from waitress import serve
from resume_conversion import MAX_UPLOAD_BYTES, extract_resume

ROOT = Path(__file__).resolve().parent


class InMemoryUploadRequest(FlaskRequest):
    """Keep accepted upload bodies in memory, including multipart file parts."""

    def _get_file_stream(
        self, total_content_length, content_type, filename=None, content_length=None
    ):
        return BytesIO()


def career_postings_directory():
    configured = os.environ.get("CAREERLENS_JOB_POSTINGS_DIR", "").strip()
    if configured:
        return Path(configured).expanduser()
    return ROOT.parent / "CareerLens-backend" / "app" / "modules" / "job_postings"


def career_posting_categories(directory):
    """Read optional source taxonomy without following Markdown links or changing fixtures."""
    index = directory / "00_목록.md"
    if not index.is_file() or index.is_symlink():
        return {}
    if index.stat().st_size > 1024 * 1024:
        raise ValueError("Job posting index size limit exceeded.")
    categories, columns = {}, None
    for line in index.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(name in cells for name in ("번호", "직무 유형", "파일")):
            columns = {name: cells.index(name) for name in ("번호", "직무 유형", "파일")}
            continue
        if not columns or len(cells) <= max(columns.values()):
            continue
        number = cells[columns["번호"]]
        category = cells[columns["직무 유형"]]
        link = re.fullmatch(r"\[[^\]]*\]\(([0-9]+)\.md\)", cells[columns["파일"]])
        if (
            not number.isascii()
            or not number.isdigit()
            or not link
            or int(number) != int(link[1])
            or not category
        ):
            continue
        categories[f"{link[1]}.md"] = category
    return categories


def load_career_markdown(directory):
    """Expose only the configured repository's numbered fictional posting fixtures."""
    if not directory.is_dir():
        raise FileNotFoundError("Job posting directory does not exist.")
    files = sorted(
        (
            path
            for path in directory.glob("*.md")
            if path.is_file()
            and not path.is_symlink()
            and path.stem.isascii()
            and path.stem.isdigit()
        ),
        key=lambda path: int(path.stem),
    )
    if not files:
        raise ValueError("No numbered Markdown job postings were found.")
    categories = career_posting_categories(directory)
    items, total_size = [], 0
    for path in files:
        size = path.stat().st_size
        total_size += size
        if size > 1024 * 1024 or total_size > 10 * 1024 * 1024:
            raise ValueError("Job posting Markdown size limit exceeded.")
        items.append(
            {
                "id": path.stem,
                "filename": path.name,
                "content": path.read_text(encoding="utf-8-sig"),
                **({"role_category": categories[path.name]} if path.name in categories else {}),
            }
        )
    return {"items": items}


def load_local_env(path):
    """Read simple KEY=value settings without overriding the process environment."""
    if not path.exists():
        return
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key):
            raise ValueError(f"Invalid .env setting on line {number}; use KEY=value.")
        if value[:1] in ('"', "'"):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f"Unclosed .env value on line {number}.")
            value = value[1:-1]
        os.environ.setdefault(key, value)


def validate_origin(value):
    """Only a fixed operator-configured HTTPS origin or local HTTP is accepted."""
    if any(char.isspace() for char in value):
        raise ValueError("API origin must not contain whitespace.")
    value = value.rstrip("/")
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("API origin has an invalid port.") from error
    if (
        not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.scheme not in ("http", "https")
        or (port is not None and port < 1)
    ):
        raise ValueError(
            "Use an HTTP(S) origin only, without a path, credentials, query or fragment."
        )
    hostname = parsed.hostname
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        try:
            hostname = hostname.encode("idna").decode("ascii")
        except UnicodeError as error:
            raise ValueError("API origin has an invalid hostname.") from error
        if len(hostname) > 253 or not all(
            re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
            for label in hostname.rstrip(".").split(".")
        ):
            raise ValueError("API origin has an invalid hostname.")
    if parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(
            "HTTP is supported only for loopback development APIs. Use HTTPS for remote APIs."
        )
    authority = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None:
        authority += f":{port}"
    return f"{parsed.scheme}://{authority}"


def frontend_cookie(value):
    # The response belongs to the frontend host. Preserve all security attributes.
    return re.sub(r";\s*Domain\s*=\s*[^;]*", "", value, flags=re.IGNORECASE)


def frontend_redirect(value, backend_origin):
    """Keep API-owned redirects same-origin; OAuth provider redirects stay intact."""
    destination, backend = urlsplit(value), urlsplit(backend_origin)
    if not destination.netloc:
        return value
    try:
        destination_scheme = destination.scheme or backend.scheme
        same_origin = (
            destination_scheme == backend.scheme
            and destination.hostname == backend.hostname
            and (destination.port or (443 if destination_scheme == "https" else 80))
            == (backend.port or (443 if backend.scheme == "https" else 80))
        )
    except ValueError:
        return value
    if same_origin:
        return urlunsplit(
            ("", "", destination.path or "/", destination.query, destination.fragment)
        )
    return value


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def create_app(backend_url=None):
    app = Flask(__name__, static_folder=None)
    app.request_class = InMemoryUploadRequest
    app.config.update(
        MAX_CONTENT_LENGTH=11 * 1024 * 1024, TRUSTED_HOSTS=["127.0.0.1", "localhost", "[::1]"]
    )
    configured = backend_url if backend_url is not None else os.environ.get("BACKEND_URL", "")
    origin = validate_origin(configured) if configured else None
    public_origin = os.environ.get("FRONTEND_PUBLIC_ORIGIN", "")
    if public_origin:
        app.config["TRUSTED_HOSTS"].append(urlsplit(validate_origin(public_origin)).hostname)
    opener = build_opener(ProxyHandler({}), NoRedirect())

    @app.get("/")
    def index():
        return send_from_directory(ROOT / "public", "index.html")

    @app.get("/design-lab")
    def design_lab():
        """Isolated synthetic visual comparisons; no workspace or account data."""
        return send_from_directory(ROOT / "public", "design-lab.html")

    @app.get("/motion-preview")
    def motion_preview():
        """Actual motion modules with synthetic progress and no analysis requests."""
        return send_from_directory(ROOT / "public", "motion-preview.html")

    @app.get("/health")
    def health():
        return jsonify(status="ok", service="careerlens-frontend", backend_configured=bool(origin))

    @app.get("/api/v1/local-data/career-markdown")
    def career_markdown():
        try:
            return jsonify(load_career_markdown(career_postings_directory()))
        except (OSError, UnicodeError, ValueError):
            return (
                jsonify(
                    error={
                        "code": "career_markdown_unavailable",
                        "message": "직무 Markdown 원본을 읽지 못했습니다. CAREERLENS_JOB_POSTINGS_DIR 설정과 UTF-8 Markdown 파일을 확인해 주세요.",
                    }
                ),
                503,
            )

    @app.post("/api/v1/local-data/convert-resume")
    def convert_resume():
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            return (
                jsonify(error={"code": "file_required", "message": "이력서 파일을 선택해 주세요."}),
                400,
            )
        filename = Path(upload.filename.replace("\\", "/")).name
        if Path(filename).suffix.lower() not in {".pdf", ".docx", ".txt", ".md"}:
            return (
                jsonify(
                    error={
                        "code": "unsupported_file",
                        "message": "PDF, DOCX, TXT, MD 파일을 선택해 주세요.",
                    }
                ),
                415,
            )
        data = upload.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            return too_large(None)
        try:
            text = extract_resume(filename, data)
        except ValueError as error:
            return jsonify(error={"code": "invalid_resume", "message": str(error)}), 400
        return jsonify(filename=Path(filename).stem[:180] + ".md", text=text)

    @app.get("/favicon.svg")
    def favicon():
        return send_from_directory(ROOT / "public", "favicon.svg")

    @app.get("/src/<path:name>")
    def source(name):
        if Path(name).suffix.lower() not in {".js", ".css", ".svg", ".png", ".jpg", ".woff2"}:
            return "", 404
        response = send_from_directory(ROOT / "src", name)
        if name.endswith(".js"):
            response.mimetype = "text/javascript"
        return response

    @app.get("/public/<path:name>")
    def public(name):
        if Path(name).suffix.lower() not in {".svg", ".png", ".jpg", ".ico", ".webp"}:
            return "", 404
        return send_from_directory(ROOT / "public", name)

    @app.route("/api/<path:name>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api(name):
        if not origin:
            return (
                jsonify(
                    error={
                        "code": "backend_unconfigured",
                        "message": "API 서버가 설정되지 않았습니다. 이 저장소의 .env에 팀 API의 BACKEND_URL을 지정해 주세요.",
                    }
                ),
                503,
            )
        target = origin + request.path
        if request.query_string:
            target += "?" + request.query_string.decode("ascii")
        # urllib creates Host from the target API origin (essential for HTTPS virtual hosts).
        allowed = {
            "content-type",
            "cookie",
            "x-csrf-token",
            "origin",
            "accept",
            "authorization",
            "idempotency-key",
            "last-event-id",
        }
        headers = {key: value for key, value in request.headers if key.lower() in allowed}
        payload = request.get_data() if request.method not in {"GET", "HEAD"} else None
        upstream_request = Request(target, data=payload, headers=headers, method=request.method)
        try:
            try:
                upstream = opener.open(upstream_request, timeout=60)
            except HTTPError as error:
                upstream = error
            with upstream:
                response = Response(upstream.read(), status=upstream.code)
                forwarded = {
                    "content-type",
                    "set-cookie",
                    "location",
                    "cache-control",
                    "retry-after",
                }
                for key in forwarded:
                    values = upstream.headers.get_all(key, [])
                    if values:
                        response.headers.pop(key, None)
                        for value in values:
                            if key == "set-cookie":
                                value = frontend_cookie(value)
                            elif key == "location":
                                value = frontend_redirect(value, origin)
                            response.headers.add(key, value)
                return response
        except (URLError, TimeoutError, OSError):
            return (
                jsonify(
                    error={
                        "code": "backend_unavailable",
                        "message": "설정된 API 서버에 연결할 수 없습니다. 주소와 서버 실행 상태를 확인해 주세요.",
                    }
                ),
                502,
            )

    @app.errorhandler(413)
    def too_large(_):
        return (
            jsonify(error={"code": "file_too_large", "message": "10MB 이하 파일을 선택해 주세요."}),
            413,
        )

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        return response

    return app


if __name__ == "__main__":
    load_local_env(ROOT / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("FRONTEND_PORT") or os.environ.get("PORT") or "5100"),
    )
    parser.add_argument("--host", default=os.environ.get("FRONTEND_HOST") or "127.0.0.1")
    parser.add_argument("--backend-url", default=None)
    args = parser.parse_args()
    # Keep accepted resume request bodies below Waitress's disk-spool threshold.
    serve(
        create_app(args.backend_url),
        host=args.host,
        port=args.port,
        inbuf_overflow=12 * 1024 * 1024,
        max_request_body_size=11 * 1024 * 1024,
    )
