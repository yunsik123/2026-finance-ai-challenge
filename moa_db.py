"""모아 프로토타입의 SQLite 저장 계층."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

import moa_intelligence


ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT / "data" / "moa.db"
DB_PATH = Path(os.environ.get("MOA_DB_PATH", str(DEFAULT_DB_PATH)))
if not DB_PATH.is_absolute():
    DB_PATH = ROOT / DB_PATH
DATA_DIR = DB_PATH.parent
SCHEMA_PATH = ROOT / "schema.sql"
STORE_SEED_PATH = ROOT / "seed" / "stores.json"
OWNER_SEED_PATH = ROOT / "seed" / "demo_owners.json"
SESSION_SECONDS = 7 * 24 * 60 * 60
PASSWORD_ITERATIONS = 260_000


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    stores = json.loads(STORE_SEED_PATH.read_text(encoding="utf-8"))
    owners = json.loads(OWNER_SEED_PATH.read_text(encoding="utf-8"))
    with connect() as connection:
        connection.executescript(schema)
        for store in stores:
            connection.execute(
                """INSERT INTO stores(id, payload_json) VALUES (?, ?)
                   ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=CURRENT_TIMESTAMP""",
                (store["id"], json.dumps(store, ensure_ascii=False)),
            )
        for owner in owners:
            _seed_demo_owner(connection, owner)
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))


def _seed_demo_owner(connection: sqlite3.Connection, seed: dict[str, Any]) -> None:
    """반복 실행해도 안전한 세 명의 비교용 가상 소상공인 시드."""
    email = seed["email"].lower()
    row = connection.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    if row:
        user_id = row["id"]
    else:
        user_id = connection.execute(
            "INSERT INTO users(email, name, role, password_hash) VALUES (?, ?, 'owner', ?)",
            (email, seed["name"], hash_password(seed["password"])),
        ).lastrowid
        connection.execute("INSERT OR IGNORE INTO preferences(user_id) VALUES (?)", (user_id,))
        connection.execute(
            "INSERT OR IGNORE INTO disclosures(user_id, values_json) VALUES (?, ?)",
            (user_id, json.dumps(["sales", "cost", "debt", "plan", "risk", "evidence"])),
        )
    business = seed["business"]
    connection.execute(
        """INSERT INTO businesses(user_id, name, category, business_number, address, monthly_sales, business_age, description, verification_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'demo_verified')
           ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, category=excluded.category,
             business_number=excluded.business_number, address=excluded.address,
             monthly_sales=excluded.monthly_sales, business_age=excluded.business_age,
             description=excluded.description, verification_status='demo_verified'""",
        (user_id, business["name"], business["category"], business["number"], business["address"],
         business["sales"], business["age"], business["description"]),
    )
    business_id = connection.execute("SELECT id FROM businesses WHERE user_id=?", (user_id,)).fetchone()["id"]
    metrics = seed["metrics"]
    connection.execute(
        """INSERT INTO business_metrics(
             business_id, segment, cb_grade, sales_6m_json, operating_cash_flow, debt_total,
             monthly_debt_payment, overdue_count, employee_count, tax_compliant,
             admin_penalties, owner_changes, foot_traffic_growth, local_sales_growth,
             competitor_density, closure_rate, repeat_rate, rating, digital_sales_ratio, qualitative_bonus
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(business_id) DO UPDATE SET segment=excluded.segment, cb_grade=excluded.cb_grade,
             sales_6m_json=excluded.sales_6m_json, operating_cash_flow=excluded.operating_cash_flow,
             debt_total=excluded.debt_total, monthly_debt_payment=excluded.monthly_debt_payment,
             overdue_count=excluded.overdue_count, employee_count=excluded.employee_count,
             tax_compliant=excluded.tax_compliant, admin_penalties=excluded.admin_penalties,
             owner_changes=excluded.owner_changes, foot_traffic_growth=excluded.foot_traffic_growth,
             local_sales_growth=excluded.local_sales_growth, competitor_density=excluded.competitor_density,
             closure_rate=excluded.closure_rate, repeat_rate=excluded.repeat_rate, rating=excluded.rating,
             digital_sales_ratio=excluded.digital_sales_ratio, qualitative_bonus=excluded.qualitative_bonus,
             updated_at=CURRENT_TIMESTAMP""",
        (business_id, metrics["segment"], metrics["cbGrade"], json.dumps(metrics["sales6m"]),
         metrics["operatingCashFlow"], metrics["debtTotal"], metrics["monthlyDebtPayment"],
         metrics["overdueCount"], metrics["employeeCount"], int(metrics["taxCompliant"]),
         metrics["adminPenalties"], metrics["ownerChanges"], metrics["footTrafficGrowth"],
         metrics["localSalesGrowth"], metrics["competitorDensity"], metrics["closureRate"],
         metrics["repeatRate"], metrics["rating"], metrics["digitalSalesRatio"], metrics["qualitativeBonus"]),
    )
    _refresh_intelligence(connection, business_id)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iteration_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iteration_text))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_dto(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


def authenticate(name: str, email: str, password: str, role: str) -> tuple[dict[str, Any], str]:
    normalized_email = email.strip().lower()
    now = int(time.time())
    with connect() as connection:
        existing = connection.execute("SELECT * FROM users WHERE email = ?", (normalized_email,)).fetchone()
        if existing:
            if not verify_password(password, existing["password_hash"]):
                raise ValueError("이메일 또는 비밀번호가 올바르지 않습니다.")
            if existing["role"] != role:
                expected = "소상공인" if existing["role"] == "owner" else "소비자"
                raise ValueError(f"이 이메일은 {expected} 계정으로 가입되어 있습니다.")
            connection.execute(
                "UPDATE users SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (name.strip(), existing["id"]),
            )
            user_id = existing["id"]
        else:
            cursor = connection.execute(
                "INSERT INTO users(email, name, role, password_hash) VALUES (?, ?, ?, ?)",
                (normalized_email, name.strip(), role, hash_password(password)),
            )
            user_id = cursor.lastrowid
            connection.execute("INSERT INTO preferences(user_id) VALUES (?)", (user_id,))
            connection.execute(
                """INSERT INTO disclosures(user_id, values_json)
                   VALUES (?, ?)""",
                (user_id, json.dumps(["sales", "cost", "debt", "plan"] if role == "owner" else [])),
            )
            if role == "consumer":
                connection.execute(
                    """INSERT INTO coupons(
                           id, user_id, source_type, source_id, store_name, title, benefit,
                           condition_text, code, expires_at
                       ) VALUES (?, ?, 'welcome', 'welcome', '모아', ?, ?, ?, ?, ?)""",
                    (
                        str(uuid.uuid4()), user_id, "첫 방문 3,000원 쿠폰", "3,000원 할인",
                        "2만원 이상 주문 시", f"MOA-WELCOME-{secrets.token_hex(3).upper()}", "2026-12-31",
                    ),
                )

        token = secrets.token_urlsafe(32)
        connection.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash(token), user_id, now + SESSION_SECONDS),
        )
        row = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return user_dto(row), token


def resolve_user(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    with connect() as connection:
        row = connection.execute(
            """SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
               WHERE s.token_hash=? AND s.expires_at>?""",
            (token_hash(token), int(time.time())),
        ).fetchone()
        return user_dto(row)


def delete_session(token: str | None) -> None:
    if not token:
        return
    with connect() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(token),))


def record_login_event(
    event_type: str,
    email: str = "",
    user_id: int | None = None,
    ip_address: str = "",
    user_agent: str = "",
) -> None:
    with connect() as connection:
        connection.execute(
            """INSERT INTO login_events(user_id, email, event_type, ip_address, user_agent)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, email.strip().lower(), event_type, ip_address[:80], user_agent[:500]),
        )


def list_login_events(user_id: int, limit: int = 10) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            """SELECT event_type, ip_address, user_agent, created_at
               FROM login_events WHERE user_id=? ORDER BY id DESC LIMIT ?""",
            (user_id, max(1, min(limit, 50))),
        ).fetchall()
    labels = {"login_success": "로그인", "login_failure": "로그인 실패", "logout": "로그아웃"}
    return [
        {"event": row["event_type"], "label": labels[row["event_type"]],
         "ip": row["ip_address"], "userAgent": row["user_agent"], "createdAt": row["created_at"]}
        for row in rows
    ]


def list_stores() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute("SELECT payload_json FROM stores WHERE is_active=1 ORDER BY rowid").fetchall()
        return [json.loads(row["payload_json"]) for row in rows]


def business_dto(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row["id"], "name": row["name"], "category": row["category"],
        "number": row["business_number"], "address": row["address"],
        "sales": row["monthly_sales"], "age": row["business_age"],
        "description": row["description"], "verificationStatus": row["verification_status"],
    }


def _metrics_dto(row: sqlite3.Row | None, business_age: float = 0) -> dict[str, Any]:
    if not row:
        return {"businessAge": business_age}
    return {
        "segment": row["segment"], "cbGrade": row["cb_grade"],
        "sales6m": json.loads(row["sales_6m_json"]),
        "operatingCashFlow": row["operating_cash_flow"], "debtTotal": row["debt_total"],
        "monthlyDebtPayment": row["monthly_debt_payment"], "overdueCount": row["overdue_count"],
        "employeeCount": row["employee_count"], "taxCompliant": bool(row["tax_compliant"]),
        "adminPenalties": row["admin_penalties"], "ownerChanges": row["owner_changes"],
        "footTrafficGrowth": row["foot_traffic_growth"], "localSalesGrowth": row["local_sales_growth"],
        "competitorDensity": row["competitor_density"], "closureRate": row["closure_rate"],
        "repeatRate": row["repeat_rate"], "rating": row["rating"],
        "digitalSalesRatio": row["digital_sales_ratio"], "qualitativeBonus": row["qualitative_bonus"],
        "businessAge": business_age,
    }


def _refresh_intelligence(connection: sqlite3.Connection, business_id: int) -> tuple[dict[str, Any], dict[str, Any]]:
    business_row = connection.execute("SELECT * FROM businesses WHERE id=?", (business_id,)).fetchone()
    metrics_row = connection.execute("SELECT * FROM business_metrics WHERE business_id=?", (business_id,)).fetchone()
    business = business_dto(business_row)
    if not business:
        raise ValueError("사업체를 찾을 수 없습니다.")
    metrics = _metrics_dto(metrics_row, business["age"])
    assessment = moa_intelligence.assess(metrics, business["sales"])
    latest = connection.execute(
        "SELECT score, s_grade, model_version FROM credit_assessments WHERE business_id=? ORDER BY id DESC LIMIT 1",
        (business_id,),
    ).fetchone()
    if not latest or latest["score"] != assessment["score"] or latest["s_grade"] != assessment["grade"] or latest["model_version"] != assessment["modelVersion"]:
        connection.execute(
            """INSERT INTO credit_assessments(business_id, score, s_grade, funding_limit, components_json, missing_json, model_version)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (business_id, assessment["score"], assessment["grade"], assessment["fundingLimit"],
             json.dumps(assessment["components"], ensure_ascii=False),
             json.dumps(assessment["missing"], ensure_ascii=False), assessment["modelVersion"]),
        )
    graph = moa_intelligence.build_graph(business, metrics, assessment)
    for node in graph["nodes"]:
        connection.execute(
            """INSERT INTO knowledge_nodes(id, business_id, node_type, label, properties_json)
               VALUES (?, ?, ?, ?, '{}')
               ON CONFLICT(id) DO UPDATE SET label=excluded.label, node_type=excluded.node_type""",
            (node["id"], business_id, node["type"], node["label"]),
        )
    for index, edge in enumerate(graph["edges"]):
        edge_id = f"edge:{business_id}:{index}"
        connection.execute(
            """INSERT INTO knowledge_edges(id, business_id, source_node_id, target_node_id, relation_type, evidence)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET source_node_id=excluded.source_node_id,
                 target_node_id=excluded.target_node_id, relation_type=excluded.relation_type,
                 evidence=excluded.evidence""",
            (edge_id, business_id, edge["source"], edge["target"], edge["relation"], edge["evidence"]),
        )
    return assessment, graph


def owner_intelligence(user_id: int) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute("SELECT id FROM businesses WHERE user_id=?", (user_id,)).fetchone()
        if not row:
            return None
        assessment, graph = _refresh_intelligence(connection, row["id"])
        business = business_dto(connection.execute("SELECT * FROM businesses WHERE id=?", (row["id"],)).fetchone())
        return {
            "assessment": assessment, "graph": graph,
            "diagnosis": moa_intelligence.diagnostic_answer(business, assessment, graph),
        }


def public_recommendations() -> list[dict[str, Any]]:
    stores = {store["id"]: store for store in list_stores()}
    mapping = {"온기린 식당": "ongi", "목화 로스터리": "mokhwa", "일구의 식탁": "table"}
    results: list[dict[str, Any]] = []
    with connect() as connection:
        for business_name, store_id in mapping.items():
            row = connection.execute("SELECT * FROM businesses WHERE name=?", (business_name,)).fetchone()
            if not row or store_id not in stores:
                continue
            assessment, _ = _refresh_intelligence(connection, row["id"])
            results.append(moa_intelligence.recommendation(stores[store_id], assessment))
    return sorted(results, key=lambda item: item["score"], reverse=True)


def campaign_dto(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row["id"], "name": row["name"], "target": row["target_amount"],
        "duration": str(row["duration_days"]), "plan": row["plan"], "risk": row["risk"],
        "status": "초안" if row["status"] == "draft" else row["status"],
    }


def coupon_dto(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "store": row["store_name"], "title": row["title"],
        "benefit": row["benefit"], "condition": row["condition_text"],
        "code": row["code"], "used": bool(row["used_at"]), "expires": row["expires_at"],
    }


def bootstrap(user: dict[str, Any] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "user": user,
        "stores": list_stores(),
        "favorites": [], "business": None, "campaign": None, "contributions": {},
        "coupons": [], "disclosures": [], "issuedCoupon": None,
        "region": "서울 성동구", "recentOcr": None,
        "loginHistory": [], "intelligence": None,
        "recommendations": public_recommendations(),
    }
    if not user:
        return payload

    user_id = user["id"]
    with connect() as connection:
        payload["favorites"] = [row["store_id"] for row in connection.execute("SELECT store_id FROM favorites WHERE user_id=?", (user_id,))]
        payload["business"] = business_dto(connection.execute("SELECT * FROM businesses WHERE user_id=?", (user_id,)).fetchone())
        payload["campaign"] = campaign_dto(connection.execute("SELECT * FROM campaigns WHERE user_id=? ORDER BY id DESC LIMIT 1", (user_id,)).fetchone())
        payload["contributions"] = {
            row["store_id"]: row["total"]
            for row in connection.execute("SELECT store_id, SUM(amount) AS total FROM contributions WHERE user_id=? GROUP BY store_id", (user_id,))
        }
        payload["coupons"] = [coupon_dto(row) for row in connection.execute("SELECT * FROM coupons WHERE user_id=? ORDER BY created_at DESC", (user_id,))]
        disclosure = connection.execute("SELECT values_json FROM disclosures WHERE user_id=?", (user_id,)).fetchone()
        payload["disclosures"] = json.loads(disclosure["values_json"]) if disclosure else []
        preference = connection.execute("SELECT region FROM preferences WHERE user_id=?", (user_id,)).fetchone()
        payload["region"] = preference["region"] if preference else "서울 성동구"
        issued = connection.execute("SELECT * FROM issued_coupon_templates WHERE user_id=? ORDER BY id DESC LIMIT 1", (user_id,)).fetchone()
        if issued:
            payload["issuedCoupon"] = {
                "id": issued["id"], "name": issued["name"], "benefit": issued["benefit"],
                "quantity": issued["quantity"], "condition": issued["condition_text"],
            }
        recent = connection.execute("SELECT id, result_json, model, created_at FROM ocr_analyses WHERE user_id=? ORDER BY id DESC LIMIT 1", (user_id,)).fetchone()
        if recent:
            payload["recentOcr"] = {"id": recent["id"], "result": json.loads(recent["result_json"]), "model": recent["model"], "createdAt": recent["created_at"]}
    payload["loginHistory"] = list_login_events(user_id)
    if user["role"] == "owner":
        payload["intelligence"] = owner_intelligence(user_id)
    return payload


def toggle_favorite(user_id: int, store_id: str) -> tuple[bool, list[str]]:
    with connect() as connection:
        store = connection.execute("SELECT 1 FROM stores WHERE id=? AND is_active=1", (store_id,)).fetchone()
        if not store:
            raise ValueError("가게를 찾을 수 없습니다.")
        existing = connection.execute("SELECT 1 FROM favorites WHERE user_id=? AND store_id=?", (user_id, store_id)).fetchone()
        if existing:
            connection.execute("DELETE FROM favorites WHERE user_id=? AND store_id=?", (user_id, store_id))
            saved = False
        else:
            connection.execute("INSERT INTO favorites(user_id, store_id) VALUES (?, ?)", (user_id, store_id))
            saved = True
        values = [row["store_id"] for row in connection.execute("SELECT store_id FROM favorites WHERE user_id=?", (user_id,))]
        return saved, values


def save_business(user_id: int, data: dict[str, Any]) -> dict[str, Any]:
    with connect() as connection:
        connection.execute(
            """INSERT INTO businesses(user_id, name, category, business_number, address, monthly_sales, business_age, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                   name=excluded.name, category=excluded.category, business_number=excluded.business_number,
                   address=excluded.address, monthly_sales=excluded.monthly_sales,
                   business_age=excluded.business_age, description=excluded.description,
                   updated_at=CURRENT_TIMESTAMP""",
            (user_id, data["name"], data["category"], data["number"], data["address"], data["sales"], data["age"], data["description"]),
        )
        return business_dto(connection.execute("SELECT * FROM businesses WHERE user_id=?", (user_id,)).fetchone())


def save_business_metrics(user_id: int, data: dict[str, Any]) -> dict[str, Any]:
    with connect() as connection:
        business_row = connection.execute("SELECT * FROM businesses WHERE user_id=?", (user_id,)).fetchone()
        if not business_row:
            raise ValueError("사업체 정보를 먼저 등록해 주세요.")
        business_id = business_row["id"]
        connection.execute(
            """INSERT INTO business_metrics(
                 business_id, segment, cb_grade, sales_6m_json, operating_cash_flow, debt_total,
                 monthly_debt_payment, overdue_count, employee_count, tax_compliant,
                 admin_penalties, owner_changes, foot_traffic_growth, local_sales_growth,
                 competitor_density, closure_rate, repeat_rate, rating, digital_sales_ratio, qualitative_bonus
               ) VALUES (?, ?, 5, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 0, ?, 0)
               ON CONFLICT(business_id) DO UPDATE SET sales_6m_json=excluded.sales_6m_json,
                 operating_cash_flow=excluded.operating_cash_flow, debt_total=excluded.debt_total,
                 monthly_debt_payment=excluded.monthly_debt_payment, overdue_count=excluded.overdue_count,
                 employee_count=excluded.employee_count, tax_compliant=excluded.tax_compliant,
                 foot_traffic_growth=excluded.foot_traffic_growth, local_sales_growth=excluded.local_sales_growth,
                 competitor_density=excluded.competitor_density, closure_rate=excluded.closure_rate,
                 repeat_rate=excluded.repeat_rate, digital_sales_ratio=excluded.digital_sales_ratio,
                 updated_at=CURRENT_TIMESTAMP""",
            (business_id, "숙박·음식점업", json.dumps(data["sales6m"]), data["operatingCashFlow"],
             data["debtTotal"], data["monthlyDebtPayment"], data["overdueCount"], data["employeeCount"],
             int(data["taxCompliant"]), data["footTrafficGrowth"], data["localSalesGrowth"],
             data["competitorDensity"], data["closureRate"], data["repeatRate"], data["digitalSalesRatio"]),
        )
        assessment, graph = _refresh_intelligence(connection, business_id)
        business = business_dto(business_row)
        return {
            "assessment": assessment, "graph": graph,
            "diagnosis": moa_intelligence.diagnostic_answer(business, assessment, graph),
        }


def save_campaign(user_id: int, data: dict[str, Any]) -> dict[str, Any]:
    with connect() as connection:
        business = connection.execute("SELECT id FROM businesses WHERE user_id=?", (user_id,)).fetchone()
        if not business:
            raise ValueError("사업체 정보를 먼저 등록해 주세요.")
        campaign_id = data.get("id")
        existing = None
        if campaign_id:
            existing = connection.execute("SELECT id FROM campaigns WHERE id=? AND user_id=?", (campaign_id, user_id)).fetchone()
        if existing:
            connection.execute(
                """UPDATE campaigns SET name=?, target_amount=?, duration_days=?, plan=?, risk=?, updated_at=CURRENT_TIMESTAMP
                   WHERE id=? AND user_id=?""",
                (data["name"], data["target"], data["duration"], data["plan"], data["risk"], campaign_id, user_id),
            )
        else:
            cursor = connection.execute(
                """INSERT INTO campaigns(user_id, business_id, name, target_amount, duration_days, plan, risk)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user_id, business["id"], data["name"], data["target"], data["duration"], data["plan"], data["risk"]),
            )
            campaign_id = cursor.lastrowid
        return campaign_dto(connection.execute("SELECT * FROM campaigns WHERE id=?", (campaign_id,)).fetchone())


def record_contribution(user_id: int, store_id: str, amount: int) -> tuple[int, dict[str, Any]]:
    with connect() as connection:
        row = connection.execute("SELECT payload_json FROM stores WHERE id=? AND is_active=1", (store_id,)).fetchone()
        if not row:
            raise ValueError("펀딩 가게를 찾을 수 없습니다.")
        store = json.loads(row["payload_json"])
        connection.execute(
            "INSERT INTO contributions(user_id, store_id, amount, risk_consent) VALUES (?, ?, ?, 1)",
            (user_id, store_id, amount),
        )
        coupon = store["coupon"]
        source_id = f"funding-{store_id}"
        connection.execute(
            """INSERT OR IGNORE INTO coupons(
                   id, user_id, store_id, source_type, source_id, store_name, title, benefit,
                   condition_text, code, expires_at
               ) VALUES (?, ?, ?, 'funding', ?, ?, ?, ?, ?, ?, '2027-02-28')""",
            (
                str(uuid.uuid4()), user_id, store_id, source_id, store["name"], coupon["title"],
                coupon["benefit"], coupon["condition"], f"MOA-{store_id.upper()}-{secrets.token_hex(3).upper()}",
            ),
        )
        total = connection.execute("SELECT SUM(amount) AS total FROM contributions WHERE user_id=? AND store_id=?", (user_id, store_id)).fetchone()["total"]
        coupon_row = connection.execute("SELECT * FROM coupons WHERE user_id=? AND source_type='funding' AND source_id=?", (user_id, source_id)).fetchone()
        return total, coupon_dto(coupon_row)


def use_coupon(user_id: int, coupon_id: str) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute("SELECT * FROM coupons WHERE id=? AND user_id=?", (coupon_id, user_id)).fetchone()
        if not row:
            raise ValueError("쿠폰을 찾을 수 없습니다.")
        if row["used_at"]:
            raise ValueError("이미 사용한 쿠폰입니다.")
        connection.execute("UPDATE coupons SET used_at=CURRENT_TIMESTAMP WHERE id=?", (coupon_id,))
        return coupon_dto(connection.execute("SELECT * FROM coupons WHERE id=?", (coupon_id,)).fetchone())


def save_disclosures(user_id: int, values: list[str]) -> list[str]:
    encoded = json.dumps(values, ensure_ascii=False)
    with connect() as connection:
        connection.execute(
            """INSERT INTO disclosures(user_id, values_json) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET values_json=excluded.values_json, updated_at=CURRENT_TIMESTAMP""",
            (user_id, encoded),
        )
    return values


def save_region(user_id: int, region: str) -> str:
    with connect() as connection:
        connection.execute(
            """INSERT INTO preferences(user_id, region) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET region=excluded.region, updated_at=CURRENT_TIMESTAMP""",
            (user_id, region),
        )
    return region


def issue_coupon_template(user_id: int, data: dict[str, Any]) -> dict[str, Any]:
    with connect() as connection:
        business = connection.execute("SELECT id FROM businesses WHERE user_id=?", (user_id,)).fetchone()
        cursor = connection.execute(
            """INSERT INTO issued_coupon_templates(user_id, business_id, name, benefit, quantity, condition_text)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, business["id"] if business else None, data["name"], data["benefit"], data["quantity"], data["condition"]),
        )
        return {"id": cursor.lastrowid, **data}


def save_ocr_analysis(user_id: int, filename: str, plan: str, result: dict[str, Any], model: str) -> int:
    with connect() as connection:
        business = connection.execute("SELECT id FROM businesses WHERE user_id=?", (user_id,)).fetchone()
        cursor = connection.execute(
            """INSERT INTO ocr_analyses(user_id, business_id, filename, plan, result_json, model)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, business["id"] if business else None, filename, plan, json.dumps(result, ensure_ascii=False), model),
        )
        return cursor.lastrowid
