"""설명 가능한 SCB 데모 점수, 추천, property-graph 진단 로직."""

from __future__ import annotations

from typing import Any


MODEL_VERSION = "moa-scb-demo-v1"


def _clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return max(minimum, min(maximum, value))


def _growth(values: list[float]) -> float:
    if len(values) < 2 or values[0] <= 0:
        return 0
    return (values[-1] / values[0] - 1) * 100


def assess(metrics: dict[str, Any], monthly_sales: int = 0) -> dict[str, Any]:
    """금융위 SCB 공개 방향을 재현한 PoC 점수. 공식 SCB/CSS가 아니다."""
    sales = [float(value) for value in metrics.get("sales6m", []) if isinstance(value, (int, float))]
    absolute_growth = _growth(sales)
    local_growth = float(metrics.get("localSalesGrowth", 0))
    relative_growth = absolute_growth - local_growth
    cash_flow = float(metrics.get("operatingCashFlow", 0))
    debt_payment = float(metrics.get("monthlyDebtPayment", 0))
    debt_total = float(metrics.get("debtTotal", 0))
    overdue = int(metrics.get("overdueCount", 0))
    age = float(metrics.get("businessAge", 0))

    components = {
        "매출 성장": round(_clamp(50 + absolute_growth * 2 + relative_growth) * 0.25, 1),
        "상권 내 경쟁력": round(_clamp(
            45 + float(metrics.get("footTrafficGrowth", 0)) * 2
            + (1 - float(metrics.get("competitorDensity", 0.5))) * 25
            - max(0, float(metrics.get("closureRate", 10)) - 10)
        ) * 0.15, 1),
        "현금흐름 지속성": round(_clamp(
            45 + (cash_flow / max(monthly_sales, 1)) * 170
            + min(15, float(metrics.get("repeatRate", 0)) / 5)
        ) * 0.20, 1),
        "부채 회복력": round(_clamp(
            80 - debt_payment / max(cash_flow, 1) * 45
            - debt_total / max(monthly_sales * 12, 1) * 18 - overdue * 22
        ) * 0.20, 1),
        "경영 안정성": round(_clamp(
            45 + min(age, 10) * 4 + (12 if metrics.get("taxCompliant", True) else -25)
            - int(metrics.get("adminPenalties", 0)) * 15 - int(metrics.get("ownerChanges", 0)) * 8
        ) * 0.10, 1),
        "비계량 가점": round(_clamp(float(metrics.get("qualitativeBonus", 0)), 0, 10), 1),
    }
    score = round(_clamp(sum(components.values())), 1)
    thresholds = [(90, "S1"), (82, "S2"), (75, "S3"), (68, "S4"), (60, "S5"),
                  (52, "S6"), (44, "S7"), (36, "S8"), (28, "S9"), (0, "S10")]
    grade = next(label for threshold, label in thresholds if score >= threshold)
    funding_limit = int(max(5_000_000, monthly_sales * (0.35 + score / 100 * 1.15)) // 100_000 * 100_000)

    missing = []
    if len(sales) < 6:
        missing.append("최근 6개월 월별 매출")
    if cash_flow <= 0:
        missing.append("영업현금흐름")
    if "debtTotal" not in metrics or "monthlyDebtPayment" not in metrics:
        missing.append("총부채와 월 상환액")
    if "footTrafficGrowth" not in metrics or "competitorDensity" not in metrics:
        missing.append("유동인구와 경쟁밀도")
    if "taxCompliant" not in metrics:
        missing.append("세금 납부 이력")

    strengths = [name for name, value in components.items() if value >= {"매출 성장": 18.5, "상권 내 경쟁력": 10.5, "현금흐름 지속성": 14, "부채 회복력": 14, "경영 안정성": 7, "비계량 가점": 6}.get(name, 999)]
    weaknesses = [name for name, value in components.items() if value <= {"매출 성장": 12, "상권 내 경쟁력": 7.5, "현금흐름 지속성": 10, "부채 회복력": 10, "경영 안정성": 5, "비계량 가점": 3}.get(name, -1)]
    return {
        "score": score, "grade": grade, "fundingLimit": funding_limit,
        "components": components, "missing": missing, "strengths": strengths,
        "weaknesses": weaknesses, "modelVersion": MODEL_VERSION,
        "official": False,
        "notice": "공개된 SCB 추진 방향을 재현한 설명용 PoC이며 금융회사·CB사의 공식 신용등급이 아닙니다.",
    }


def build_graph(business: dict[str, Any], metrics: dict[str, Any], assessment: dict[str, Any]) -> dict[str, Any]:
    bid = str(business["id"])
    nodes = [
        {"id": f"business:{bid}", "type": "Business", "label": business["name"]},
        {"id": f"owner:{bid}", "type": "Owner", "label": "대표자"},
        {"id": f"area:{bid}", "type": "CommercialArea", "label": business["address"].split()[1] if len(business["address"].split()) > 1 else business["address"]},
        {"id": f"segment:{bid}", "type": "Category", "label": metrics.get("segment", business["category"])},
        {"id": f"sales:{bid}", "type": "Metric", "label": "최근 6개월 매출"},
        {"id": f"cash:{bid}", "type": "Metric", "label": "영업현금흐름"},
        {"id": f"debt:{bid}", "type": "Risk", "label": "부채·상환부담"},
        {"id": f"grade:{bid}", "type": "Assessment", "label": assessment["grade"]},
    ]
    edges = [
        {"source": f"owner:{bid}", "target": f"business:{bid}", "relation": "OPERATES", "evidence": "회원·사업체 등록"},
        {"source": f"business:{bid}", "target": f"area:{bid}", "relation": "LOCATED_IN", "evidence": business["address"]},
        {"source": f"business:{bid}", "target": f"segment:{bid}", "relation": "BELONGS_TO", "evidence": metrics.get("segment", business["category"])},
        {"source": f"business:{bid}", "target": f"sales:{bid}", "relation": "HAS_SIGNAL", "evidence": str(metrics.get("sales6m", []))},
        {"source": f"business:{bid}", "target": f"cash:{bid}", "relation": "HAS_SIGNAL", "evidence": str(metrics.get("operatingCashFlow", 0))},
        {"source": f"business:{bid}", "target": f"debt:{bid}", "relation": "EXPOSED_TO", "evidence": str(metrics.get("debtTotal", 0))},
        {"source": f"sales:{bid}", "target": f"grade:{bid}", "relation": "SUPPORTS", "evidence": f"매출 성장 구성점수 {assessment['components']['매출 성장']}"},
        {"source": f"cash:{bid}", "target": f"grade:{bid}", "relation": "SUPPORTS", "evidence": f"현금흐름 구성점수 {assessment['components']['현금흐름 지속성']}"},
        {"source": f"debt:{bid}", "target": f"grade:{bid}", "relation": "LIMITS", "evidence": f"부채 회복력 구성점수 {assessment['components']['부채 회복력']}"},
    ]
    return {"nodes": nodes, "edges": edges, "pathCount": len(edges)}


def diagnostic_answer(business: dict[str, Any], assessment: dict[str, Any], graph: dict[str, Any]) -> str:
    missing = ", ".join(assessment["missing"]) or "필수 기준자료는 모두 등록됨"
    weak = ", ".join(assessment["weaknesses"]) or "뚜렷한 취약 구성요인은 없음"
    strong = ", ".join(assessment["strengths"]) or "추가로 확인할 강점 자료가 필요함"
    return (
        f"{business['name']}은 현재 설명용 성장등급 {assessment['grade']}({assessment['score']}점)입니다. "
        f"그래프의 {len(graph['nodes'])}개 노드와 {len(graph['edges'])}개 근거 관계를 추적한 결과, "
        f"강점은 {strong}, 보완 우선순위는 {weak}입니다. 부족 자료: {missing}. "
        "점수만으로 펀딩 승인이나 투자 결정을 자동화하지 말고 원본 매출·세금·부채 증빙과 운영자 심사를 함께 확인하세요."
    )


def recommendation(store: dict[str, Any], assessment: dict[str, Any]) -> dict[str, Any]:
    coupon_text = store.get("coupon", {}).get("benefit", "")
    coupon_bonus = 5 if "%" in coupon_text else 3
    support = float(store.get("support", 0))
    score = round(assessment["score"] * 0.65 + support * 0.25 + coupon_bonus, 1)
    return {
        "storeId": store["id"], "name": store["name"], "score": score,
        "sGrade": assessment["grade"], "growth": store.get("growth"),
        "coupon": coupon_text, "reasons": assessment["strengths"][:2],
        "risks": store.get("risks", [])[:2], "dataGaps": assessment["missing"],
        "notice": "추천 점수는 비교 탐색용이며 투자 권유·수익 보장이 아닙니다.",
    }
