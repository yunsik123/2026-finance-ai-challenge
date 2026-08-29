#!/usr/bin/env python3
"""외부 패키지 없이 실행하는 모아 백엔드 통합 테스트."""

from __future__ import annotations

import http.cookiejar
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"


def request(opener: urllib.request.OpenerDirector, method: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        BASE + path,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method=method,
    )
    with opener.open(req, timeout=10) as response:
        data = json.loads(response.read().decode("utf-8"))
    assert data.get("ok") is True, data
    return data


def wait_for_server(opener: urllib.request.OpenerDirector) -> None:
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            request(opener, "GET", "/api/health")
            return
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.1)
    raise RuntimeError("테스트 서버가 시작되지 않았습니다.")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="moa-backend-test-") as temp_dir:
        database_path = Path(temp_dir) / "integration.db"
        env = os.environ.copy()
        env["MOA_DB_PATH"] = str(database_path)
        process = subprocess.Popen(
            [sys.executable, "server.py", "--host", "127.0.0.1", "--port", str(PORT)],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        consumer = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        owner = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        try:
            wait_for_server(consumer)
            consumer_auth = request(consumer, "POST", "/api/auth/session", {
                "name": "통합 소비자", "email": "integration-consumer@moa.local",
                "password": "Consumer123!", "role": "consumer",
            })
            assert consumer_auth["user"]["role"] == "consumer"
            assert len(consumer_auth["recommendations"]) == 3
            assert consumer_auth["loginHistory"][0]["event"] == "login_success"
            favorite = request(consumer, "POST", "/api/favorites/toggle", {"storeId": "ongi"})
            assert favorite["saved"] is True
            contribution = request(consumer, "POST", "/api/contributions", {
                "storeId": "ongi", "amount": 30000, "riskConsent": True,
            })
            assert contribution["total"] == 30000
            coupon_id = contribution["coupon"]["id"]
            used = request(consumer, "POST", "/api/coupons/use", {"couponId": coupon_id})
            assert used["coupon"]["used"] is True

            owner_auth = request(owner, "POST", "/api/auth/session", {
                "name": "통합 사장", "email": "integration-owner@moa.local",
                "password": "OwnerPass123!", "role": "owner",
            })
            assert owner_auth["user"]["role"] == "owner"
            business = request(owner, "POST", "/api/business", {
                "name": "통합 식당", "category": "한식", "number": "123-45-67890",
                "address": "서울 성동구 통합로 1", "sales": 30000000, "age": 3,
                "description": "통합 테스트 사업체",
            })
            assert business["business"]["name"] == "통합 식당"
            metrics = request(owner, "POST", "/api/business/metrics", {
                "sales6m": [22000000, 23500000, 24800000, 26500000, 28400000, 30000000],
                "operatingCashFlow": 5200000, "debtTotal": 35000000,
                "monthlyDebtPayment": 1200000, "overdueCount": 0,
                "employeeCount": 4, "taxCompliant": True, "footTrafficGrowth": 7.2,
                "localSalesGrowth": 4.1, "competitorDensity": 0.55,
                "closureRate": 8.5, "repeatRate": 55, "digitalSalesRatio": 30,
            })
            assert metrics["intelligence"]["assessment"]["score"] >= 60
            assert metrics["intelligence"]["assessment"]["official"] is False
            assert metrics["intelligence"]["graph"]["pathCount"] == 9
            campaign = request(owner, "POST", "/api/campaign", {
                "name": "주방 교체", "target": 30000000, "duration": 30,
                "plan": "냉장고 구매 2천만원과 설치비 1천만원",
                "risk": "공사 지연과 원가 상승",
            })
            assert campaign["campaign"]["status"] == "초안"
            disclosures = request(owner, "POST", "/api/disclosures", {
                "values": ["sales", "cost", "debt", "plan", "risk", "evidence"],
            })
            assert len(disclosures["disclosures"]) == 6
            region = request(owner, "POST", "/api/preferences/region", {"region": "서울 마포구"})
            assert region["region"] == "서울 마포구"
            issued = request(owner, "POST", "/api/coupons/issue", {
                "name": "감사 쿠폰", "benefit": "10% 할인", "quantity": 100, "condition": "2만원 이상",
            })
            assert issued["issuedCoupon"]["quantity"] == 100

            restored = request(owner, "GET", "/api/bootstrap")
            assert restored["business"]["name"] == "통합 식당"
            assert restored["campaign"]["name"] == "주방 교체"
            assert restored["region"] == "서울 마포구"
            assert restored["intelligence"]["assessment"]["official"] is False
            assert restored["intelligence"]["graph"]["pathCount"] >= 8
            assert "공식 신용등급이 아닙니다" in restored["intelligence"]["assessment"]["notice"]

            graph = request(owner, "GET", "/api/knowledge-graph")
            assert graph["intelligence"]["graph"]["nodes"]
            recommendations = request(consumer, "GET", "/api/recommendations")
            assert [item["name"] for item in recommendations["recommendations"]] == [
                "온기린 식당", "목화 로스터리", "일구의 식탁",
            ]

            with sqlite3.connect(database_path) as connection:
                counts = dict(connection.execute(
                    "SELECT 'users', COUNT(*) FROM users UNION ALL SELECT 'stores', COUNT(*) FROM stores UNION ALL SELECT 'contributions', COUNT(*) FROM contributions UNION ALL SELECT 'demo_metrics', COUNT(*) FROM business_metrics UNION ALL SELECT 'graph_edges', COUNT(*) FROM knowledge_edges"
                ).fetchall())
                assert counts["users"] == 5
                assert counts["stores"] == 6
                assert counts["contributions"] == 1
                assert counts["demo_metrics"] == 4
                assert counts["graph_edges"] >= 36
            print("PASS SQLite 인증·로그인이력·3개 샘플·SCB·지식그래프·추천 API")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
