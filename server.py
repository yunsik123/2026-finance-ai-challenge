#!/usr/bin/env python3
"""모아 로컬 데모 서버.

정적 파일을 제공하고 SGLLM Gateway를 서버 측에서 호출한다.
API 키는 브라우저로 전달하지 않는다.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import ssl
import urllib.error
import urllib.request
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import moa_db


ROOT = Path(__file__).resolve().parent
GATEWAY_BASE = "https://factchat-cloud.mindlogic.ai/v1/gateway"
CHAT_MODEL = os.environ.get("MOA_CHAT_MODEL", "gpt-5.6-luna")
OCR_MODEL = os.environ.get("MOA_OCR_MODEL", "claude-haiku-4-5-20251001")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_OCR_MODEL = os.environ.get("OLLAMA_OCR_MODEL", "qwen2.5vl:7b")
OCR_ENGINE = os.environ.get("MOA_OCR_ENGINE", "auto").lower()
MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BYTES = 6 * 1024 * 1024


def build_ssl_context() -> ssl.SSLContext:
    """Python.org 배포판의 macOS 인증서 저장소 누락을 보완한다."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL_CONTEXT = build_ssl_context()


def load_api_key() -> str:
    env_key = os.environ.get("SGLLM_API_KEY", "").strip()
    if env_key:
        return env_key

    matches = list(ROOT.rglob("api키.txt"))
    if not matches:
        return ""
    return matches[0].read_text(encoding="utf-8").strip()


def extract_error_message(body: bytes, fallback: str) -> str:
    try:
        data = json.loads(body.decode("utf-8"))
        error = data.get("error", data)
        if isinstance(error, dict):
            return str(error.get("message") or error.get("detail") or fallback)
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        pass
    return fallback


def call_gateway(path: str, payload: dict[str, Any], extra_headers: dict[str, str] | None = None) -> dict[str, Any]:
    api_key = load_api_key()
    if not api_key:
        raise RuntimeError("SGLLM API 키 파일을 찾을 수 없습니다.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        # Gateway 보안 계층이 Python 기본 User-Agent를 브라우저 위조로 오인한다.
        "User-Agent": "curl/8.7.1",
    }
    if extra_headers:
        headers.update(extra_headers)

    request = urllib.request.Request(
        f"{GATEWAY_BASE}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90, context=SSL_CONTEXT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read()
        message = extract_error_message(body, f"SGLLM API 오류 ({exc.code})")
        raise RuntimeError(message) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("SGLLM 서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.") from exc


def call_ollama_vision(image_b64: str, prompt: str) -> tuple[dict[str, Any], str]:
    payload = {
        "model": OLLAMA_OCR_MODEL,
        "messages": [{"role": "user", "content": prompt, "images": [image_b64]}],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0},
    }
    request = urllib.request.Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
        content = result.get("message", {}).get("content", "")
        if not content:
            raise RuntimeError("Ollama OCR 결과가 비어 있습니다.")
        return parse_json_block(content), result.get("model", OLLAMA_OCR_MODEL)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("로컬 Ollama Vision 모델에 연결하지 못했습니다.") from exc


def parse_json_block(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {"rawText": text}
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
                return parsed if isinstance(parsed, dict) else {"rawText": text}
            except json.JSONDecodeError:
                pass
    return {"rawText": text}


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class MoaHandler(SimpleHTTPRequestHandler):
    server_version = "MoaLocal/1.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        elif self.path == "/" or self.path.startswith("/?") or self.path.endswith((".html", ".css", ".js")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, status: int, payload: dict[str, Any], headers: dict[str, str] | None = None) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        if headers:
            for name, value in headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(encoded)

    @property
    def api_path(self) -> str:
        return urlsplit(self.path).path

    def session_token(self) -> str | None:
        raw_cookie = self.headers.get("Cookie")
        if not raw_cookie:
            return None
        cookie = SimpleCookie()
        try:
            cookie.load(raw_cookie)
        except Exception:
            return None
        morsel = cookie.get("moa_session")
        return morsel.value if morsel else None

    def current_user(self) -> dict[str, Any] | None:
        return moa_db.resolve_user(self.session_token())

    def require_user(self, role: str | None = None) -> dict[str, Any]:
        user = self.current_user()
        if not user:
            raise ApiError(HTTPStatus.UNAUTHORIZED, "로그인이 필요합니다.")
        if role and user["role"] != role:
            raise ApiError(HTTPStatus.FORBIDDEN, "이 계정으로 이용할 수 없는 기능입니다.")
        return user

    @staticmethod
    def text_field(data: dict[str, Any], key: str, label: str, maximum: int, minimum: int = 1) -> str:
        value = data.get(key)
        if not isinstance(value, str):
            raise ValueError(f"{label}을(를) 입력해 주세요.")
        value = value.strip()
        if len(value) < minimum or len(value) > maximum:
            raise ValueError(f"{label}은(는) {minimum}~{maximum}자로 입력해 주세요.")
        return value

    @staticmethod
    def int_field(data: dict[str, Any], key: str, label: str, minimum: int, maximum: int) -> int:
        value = data.get(key)
        if isinstance(value, bool):
            raise ValueError(f"{label} 값이 올바르지 않습니다.")
        try:
            number = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{label} 값이 올바르지 않습니다.") from exc
        if number < minimum or number > maximum:
            raise ValueError(f"{label}은(는) {minimum:,}~{maximum:,} 범위여야 합니다.")
        return number

    @staticmethod
    def float_field(data: dict[str, Any], key: str, label: str, minimum: float, maximum: float) -> float:
        value = data.get(key)
        if isinstance(value, bool):
            raise ValueError(f"{label} 값이 올바르지 않습니다.")
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{label} 값이 올바르지 않습니다.") from exc
        if number < minimum or number > maximum:
            raise ValueError(f"{label} 값이 허용 범위를 벗어났습니다.")
        return number

    def read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("잘못된 요청 크기입니다.") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("요청 데이터가 없거나 허용 크기를 초과했습니다.")
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("JSON 요청 형식이 올바르지 않습니다.") from exc
        if not isinstance(data, dict):
            raise ValueError("요청 본문은 객체여야 합니다.")
        return data

    def do_GET(self) -> None:
        path = self.api_path
        if path == "/api/health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "apiConfigured": bool(load_api_key()),
                    "chatModel": CHAT_MODEL,
                    "ocrModel": OCR_MODEL,
                    "ollamaModel": OLLAMA_OCR_MODEL,
                    "ocrEngine": OCR_ENGINE,
                    "storage": "sqlite",
                },
            )
            return
        if path == "/api/bootstrap":
            self.send_json(HTTPStatus.OK, {"ok": True, **moa_db.bootstrap(self.current_user())})
            return
        if path == "/api/stores":
            self.send_json(HTTPStatus.OK, {"ok": True, "stores": moa_db.list_stores()})
            return
        if path == "/api/recommendations":
            self.send_json(HTTPStatus.OK, {"ok": True, "recommendations": moa_db.public_recommendations()})
            return
        if path == "/api/knowledge-graph":
            user = self.require_user("owner")
            self.send_json(HTTPStatus.OK, {"ok": True, "intelligence": moa_db.owner_intelligence(user["id"])})
            return
        if path == "/api/login-history":
            user = self.require_user()
            self.send_json(HTTPStatus.OK, {"ok": True, "loginHistory": moa_db.list_login_events(user["id"])})
            return
        super().do_GET()

    def do_POST(self) -> None:
        try:
            path = self.api_path
            if path == "/api/auth/session":
                self.handle_auth()
                return
            if path == "/api/favorites/toggle":
                self.handle_favorite()
                return
            if path == "/api/business":
                self.handle_business()
                return
            if path == "/api/business/metrics":
                self.handle_business_metrics()
                return
            if path == "/api/campaign":
                self.handle_campaign()
                return
            if path == "/api/contributions":
                self.handle_contribution()
                return
            if path == "/api/coupons/use":
                self.handle_coupon_use()
                return
            if path == "/api/coupons/issue":
                self.handle_coupon_issue()
                return
            if path == "/api/disclosures":
                self.handle_disclosures()
                return
            if path == "/api/preferences/region":
                self.handle_region()
                return
            if path == "/api/ai/chat":
                self.handle_chat()
                return
            if path == "/api/ai/ocr":
                self.handle_ocr()
                return
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "API 경로를 찾을 수 없습니다."})
        except ApiError as exc:
            self.send_json(exc.status, {"ok": False, "error": str(exc)})
        except ValueError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
        except RuntimeError as exc:
            self.send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(exc)})
        except Exception:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "서버 처리 중 오류가 발생했습니다."})

    def do_DELETE(self) -> None:
        if self.api_path != "/api/auth/session":
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "API 경로를 찾을 수 없습니다."})
            return
        user = self.current_user()
        if user:
            moa_db.record_login_event("logout", user["email"], user["id"], self.client_address[0], self.headers.get("User-Agent", ""))
        moa_db.delete_session(self.session_token())
        self.send_json(
            HTTPStatus.OK,
            {"ok": True},
            {"Set-Cookie": "moa_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"},
        )

    def handle_auth(self) -> None:
        data = self.read_json()
        name = self.text_field(data, "name", "이름", 40, 2)
        email = self.text_field(data, "email", "이메일", 160, 5).lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        password = self.text_field(data, "password", "비밀번호", 128, 8)
        role = data.get("role")
        if role not in {"consumer", "owner"}:
            raise ValueError("계정 역할이 올바르지 않습니다.")
        try:
            user, token = moa_db.authenticate(name, email, password, role)
        except ValueError:
            moa_db.record_login_event("login_failure", email, None, self.client_address[0], self.headers.get("User-Agent", ""))
            raise
        moa_db.record_login_event("login_success", email, user["id"], self.client_address[0], self.headers.get("User-Agent", ""))
        payload = moa_db.bootstrap(user)
        self.send_json(
            HTTPStatus.OK,
            {"ok": True, **payload},
            {"Set-Cookie": f"moa_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={moa_db.SESSION_SECONDS}"},
        )

    def handle_favorite(self) -> None:
        user = self.require_user()
        data = self.read_json()
        store_id = self.text_field(data, "storeId", "가게", 50)
        saved, favorites = moa_db.toggle_favorite(user["id"], store_id)
        self.send_json(HTTPStatus.OK, {"ok": True, "saved": saved, "favorites": favorites})

    def handle_business(self) -> None:
        user = self.require_user("owner")
        data = self.read_json()
        age_value = data.get("age", 0)
        try:
            age = float(age_value)
        except (TypeError, ValueError) as exc:
            raise ValueError("업력 값이 올바르지 않습니다.") from exc
        if age < 0 or age > 100:
            raise ValueError("업력 값이 올바르지 않습니다.")
        values = {
            "name": self.text_field(data, "name", "상호명", 100),
            "category": self.text_field(data, "category", "업종", 30),
            "number": self.text_field(data, "number", "사업자등록번호", 30),
            "address": self.text_field(data, "address", "주소", 250),
            "sales": self.int_field(data, "sales", "월 평균 매출", 0, 10_000_000_000),
            "age": age,
            "description": str(data.get("description", "")).strip()[:2000],
        }
        self.send_json(HTTPStatus.OK, {"ok": True, "business": moa_db.save_business(user["id"], values)})

    def handle_business_metrics(self) -> None:
        user = self.require_user("owner")
        data = self.read_json()
        sales = data.get("sales6m")
        if not isinstance(sales, list) or len(sales) != 6:
            raise ValueError("최근 6개월 매출을 6개 입력해 주세요.")
        parsed_sales = []
        for value in sales:
            if isinstance(value, bool):
                raise ValueError("월별 매출 값이 올바르지 않습니다.")
            try:
                amount = int(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("월별 매출 값이 올바르지 않습니다.") from exc
            if amount < 0 or amount > 10_000_000_000:
                raise ValueError("월별 매출 값이 허용 범위를 벗어났습니다.")
            parsed_sales.append(amount)
        values = {
            "sales6m": parsed_sales,
            "operatingCashFlow": self.int_field(data, "operatingCashFlow", "영업현금흐름", 0, 10_000_000_000),
            "debtTotal": self.int_field(data, "debtTotal", "총 부채", 0, 100_000_000_000),
            "monthlyDebtPayment": self.int_field(data, "monthlyDebtPayment", "월 상환액", 0, 10_000_000_000),
            "overdueCount": self.int_field(data, "overdueCount", "연체 횟수", 0, 50),
            "employeeCount": self.int_field(data, "employeeCount", "근로자 수", 0, 100),
            "taxCompliant": data.get("taxCompliant") is True,
            "footTrafficGrowth": self.float_field(data, "footTrafficGrowth", "유동인구 증감률", -100, 1000),
            "localSalesGrowth": self.float_field(data, "localSalesGrowth", "상권 매출 증감률", -100, 1000),
            "competitorDensity": self.float_field(data, "competitorDensity", "경쟁 밀도", 0, 1),
            "closureRate": self.float_field(data, "closureRate", "주변 폐업률", 0, 100),
            "repeatRate": self.float_field(data, "repeatRate", "재방문율", 0, 100),
            "digitalSalesRatio": self.float_field(data, "digitalSalesRatio", "온라인 매출 비중", 0, 100),
        }
        self.send_json(HTTPStatus.OK, {"ok": True, "intelligence": moa_db.save_business_metrics(user["id"], values)})

    def handle_campaign(self) -> None:
        user = self.require_user("owner")
        data = self.read_json()
        values = {
            "id": data.get("id"),
            "name": self.text_field(data, "name", "펀딩 제목", 150),
            "target": self.int_field(data, "target", "목표 금액", 100_000, 10_000_000_000),
            "duration": self.int_field(data, "duration", "모집 기간", 1, 365),
            "plan": self.text_field(data, "plan", "자금 사용계획", 5000, 10),
            "risk": self.text_field(data, "risk", "위험요인", 5000, 5),
        }
        self.send_json(HTTPStatus.OK, {"ok": True, "campaign": moa_db.save_campaign(user["id"], values)})

    def handle_contribution(self) -> None:
        user = self.require_user("consumer")
        data = self.read_json()
        if data.get("riskConsent") is not True:
            raise ValueError("위험 확인 동의가 필요합니다.")
        store_id = self.text_field(data, "storeId", "가게", 50)
        amount = self.int_field(data, "amount", "참여 금액", 1_000, 100_000_000)
        total, coupon = moa_db.record_contribution(user["id"], store_id, amount)
        self.send_json(HTTPStatus.OK, {"ok": True, "total": total, "coupon": coupon})

    def handle_coupon_use(self) -> None:
        user = self.require_user("consumer")
        data = self.read_json()
        coupon_id = self.text_field(data, "couponId", "쿠폰", 100)
        self.send_json(HTTPStatus.OK, {"ok": True, "coupon": moa_db.use_coupon(user["id"], coupon_id)})

    def handle_coupon_issue(self) -> None:
        user = self.require_user("owner")
        data = self.read_json()
        values = {
            "name": self.text_field(data, "name", "쿠폰 이름", 100),
            "benefit": self.text_field(data, "benefit", "혜택", 100),
            "quantity": self.int_field(data, "quantity", "수량", 1, 1000),
            "condition": str(data.get("condition", "")).strip()[:200],
        }
        self.send_json(HTTPStatus.OK, {"ok": True, "issuedCoupon": moa_db.issue_coupon_template(user["id"], values)})

    def handle_disclosures(self) -> None:
        user = self.require_user("owner")
        data = self.read_json()
        allowed = {"sales", "cost", "debt", "plan", "risk", "evidence"}
        values = data.get("values")
        if not isinstance(values, list) or any(value not in allowed for value in values):
            raise ValueError("공시 항목이 올바르지 않습니다.")
        self.send_json(HTTPStatus.OK, {"ok": True, "disclosures": moa_db.save_disclosures(user["id"], list(dict.fromkeys(values)))})

    def handle_region(self) -> None:
        user = self.require_user()
        data = self.read_json()
        allowed = {"서울 성동구", "서울 마포구", "서울 종로구", "경기 수원시"}
        region = data.get("region")
        if region not in allowed:
            raise ValueError("지원하지 않는 분석 지역입니다.")
        self.send_json(HTTPStatus.OK, {"ok": True, "region": moa_db.save_region(user["id"], region)})

    def handle_chat(self) -> None:
        data = self.read_json()
        incoming = data.get("messages")
        if not isinstance(incoming, list) or not incoming:
            raise ValueError("대화 내용이 필요합니다.")

        messages: list[dict[str, str]] = []
        for item in incoming[-12:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str):
                continue
            messages.append({"role": role, "content": content[:4000]})
        if not messages:
            raise ValueError("유효한 대화 내용이 없습니다.")

        page_context = str(data.get("context", ""))[:6000]
        system_prompt = """당신은 지역 소상공인 펀딩 플랫폼 '모아'의 설명형 AI 상담사입니다.
한국어로 간결하고 친절하게 답하세요. 사업자에게는 사업계획, 매출, 상권, 리뷰, 자금 집행을 정리하도록 돕고,
참여자에게는 투자 포인트뿐 아니라 원금 손실·폐업·매출 변동·정보 부족 위험을 같은 비중으로 설명하세요.
수익을 보장하거나 특정 투자를 지시하지 마세요. 주어진 정보와 일반적인 안내를 구분하고, 정보가 부족하면
추가로 확인할 자료를 질문하세요. 법률·세무·투자 판단은 전문가 확인이 필요하다고 명시하세요.
화면 컨텍스트가 제공되면 그 안의 수치만 사용하고, 존재하지 않는 수치를 만들지 마세요."""
        if page_context:
            system_prompt += f"\n\n현재 화면의 검증되지 않은 데모 정보:\n{page_context}"
        user = self.current_user()
        if user and user["role"] == "owner":
            intelligence = moa_db.owner_intelligence(user["id"])
            if intelligence:
                system_prompt += (
                    "\n\nDB property graph에서 조회한 해당 사업체 진단 근거(JSON):\n"
                    + json.dumps(intelligence, ensure_ascii=False)[:10000]
                    + "\n답변에는 어떤 노드·관계·수치가 근거인지 밝히고 부족 자료의 보완 방법을 우선 설명하세요."
                )

        payload = {
            "model": CHAT_MODEL,
            "messages": [{"role": "system", "content": system_prompt}, *messages],
            "max_completion_tokens": 1200,
        }
        result = call_gateway("/chat/completions/", payload)
        try:
            content = result["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("SGLLM 응답 형식을 해석하지 못했습니다.") from exc
        self.send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "message": content,
                "model": result.get("model", CHAT_MODEL),
                "usage": result.get("usage"),
            },
        )

    def handle_ocr(self) -> None:
        user = self.require_user("owner")
        data = self.read_json()
        data_url = data.get("image")
        if not isinstance(data_url, str):
            raise ValueError("분석할 이미지가 필요합니다.")
        match = re.fullmatch(r"data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)", data_url)
        if not match:
            raise ValueError("PNG, JPG 또는 WebP 이미지만 분석할 수 있습니다.")
        try:
            image_bytes = base64.b64decode(match.group(2), validate=False)
        except ValueError as exc:
            raise ValueError("이미지 데이터가 손상되었습니다.") from exc
        if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
            raise ValueError("이미지는 6MB 이하여야 합니다.")

        plan = str(data.get("plan", "등록된 사업계획 없음"))[:2000]
        filename = str(data.get("filename", "")).strip()[:255]
        prompt = f"""이 이미지는 소상공인이 자금 사용 증빙으로 제출한 문서입니다.
영수증, 세금계산서 또는 계약서의 보이는 정보만 추출하세요. 추측하지 말고 읽을 수 없으면 빈 값으로 두세요.
현재 승인된 사용계획: {plan}

반드시 아래 키를 가진 JSON 객체만 반환하세요.
{{
  "documentType": "영수증|세금계산서|계약서|기타",
  "merchant": "공급자 또는 상호",
  "businessNumber": "사업자번호",
  "date": "YYYY-MM-DD 또는 원문",
  "items": [{{"name": "품목", "quantity": 1, "amount": 0}}],
  "subtotal": 0,
  "tax": 0,
  "total": 0,
  "paymentMethod": "결제수단",
  "planMatch": "적합|검토 필요|부적합",
  "confidence": 0,
  "warnings": ["확인이 필요한 내용"],
  "rawText": "주요 원문"
}}
confidence는 0부터 100 사이 숫자입니다. planMatch는 문서 정보와 승인된 사용계획의 일치 정도입니다."""
        image_b64 = base64.b64encode(image_bytes).decode("ascii")
        structured = None
        model = ""
        ollama_error = None
        if OCR_ENGINE in {"auto", "ollama"}:
            try:
                structured, model = call_ollama_vision(image_b64, prompt)
            except RuntimeError as exc:
                ollama_error = str(exc)
                if OCR_ENGINE == "ollama":
                    raise

        payload = {
            "model": OCR_MODEL,
            "max_tokens": 1400,
            "system": "당신은 한국어 영수증과 사업 증빙을 판독하는 OCR 검증 보조자입니다. 보이는 정보만 구조화하고 절대 지어내지 마세요.",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": match.group(1),
                                "data": image_b64,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        }
        if structured is None:
            result = call_gateway(
                "/claude/v1/messages/",
                payload,
                {"x-api-key": load_api_key(), "anthropic-version": "2023-06-01"},
            )
            try:
                text = "\n".join(block.get("text", "") for block in result["content"] if block.get("type") == "text")
            except (KeyError, TypeError) as exc:
                raise RuntimeError("OCR 응답 형식을 해석하지 못했습니다.") from exc
            if not text.strip():
                raise RuntimeError("OCR 결과가 비어 있습니다.")
            structured = parse_json_block(text)
            model = result.get("model", OCR_MODEL)
            if ollama_error:
                structured.setdefault("warnings", []).append("로컬 Ollama를 사용할 수 없어 클라우드 OCR로 대체했습니다.")
        analysis_id = moa_db.save_ocr_analysis(user["id"], filename, plan, structured, model)
        self.send_json(
            HTTPStatus.OK,
            {"ok": True, "result": structured, "model": model, "analysisId": analysis_id},
        )

    def log_message(self, fmt: str, *args: Any) -> None:
        # API 키나 요청 본문은 기록하지 않는다.
        super().log_message(fmt, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="모아 로컬 웹/API 서버")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    moa_db.initialize()
    server = ThreadingHTTPServer((args.host, args.port), MoaHandler)
    print(f"모아 서버 실행: http://{args.host}:{args.port}")
    print(f"SGLLM API: {'연결 설정됨' if load_api_key() else '키 없음'}")
    print(f"데이터베이스: {moa_db.DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
