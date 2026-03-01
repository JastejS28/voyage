from decimal import Decimal, ROUND_HALF_UP
import json
import random
import uuid

from fastapi import HTTPException
from psycopg2.extras import Json, RealDictCursor

from db import get_db_conn

FULL_CANCELLATION_PENALTY = Decimal("0.30")
PARTIAL_CANCELLATION_PENALTY = Decimal("0.20")
AUTO_PROCESS_REFUND_ON_CANCELLATION = True


def _money(value: int | float | str | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _ensure_cancellation_schema(cur) -> None:
    cur.execute(
        """
        ALTER TABLE public.bookings
        ADD COLUMN IF NOT EXISTS currency character varying NOT NULL DEFAULT 'INR',
        ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS total_booking_amount numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS cancelled_items jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS cancelled_amount numeric(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) NOT NULL DEFAULT 0
        """
    )
    cur.execute(
        """
        ALTER TABLE public.cancellations_refunds
        ADD COLUMN IF NOT EXISTS cancelled_items jsonb,
        ADD COLUMN IF NOT EXISTS penalty_percent numeric(5,2)
        """
    )


def initialize_cancellation_schema():
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            _ensure_cancellation_schema(cur)
        conn.commit()
    return {"message": "Cancellation schema ready"}


def _normalize_pricing_items(raw_items) -> list[dict]:
    if not isinstance(raw_items, list):
        return []

    normalized: list[dict] = []
    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue

        item_id_raw = item.get("item_id")
        if item_id_raw:
            item_id = str(item_id_raw)
        else:
            fingerprint = json.dumps(item, sort_keys=True, default=str)
            item_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"pricing-item:{idx}:{fingerprint}"))

        day_value = item.get("day")
        if day_value is not None:
            try:
                day_value = int(day_value)
            except (TypeError, ValueError):
                day_value = None

        category = str(item.get("category") or item.get("type") or "other")
        name = str(item.get("name") or item.get("description") or f"{category.title()} item")
        amount = _money(item.get("amount", 0))
        status = str(item.get("status") or "active").lower()
        if status not in {"active", "cancelled"}:
            status = "active"

        normalized.append(
            {
                "item_id": item_id,
                "name": name,
                "category": category,
                "amount": float(amount),
                "status": status,
                "day": day_value,
            }
        )

    return normalized


def seed_booking_pricing(provider_booking_id: str, overwrite: bool = False):
    fake_items = [
        {"name": "Flight Fare", "category": "flight", "amount": 42000},
        {"name": "Hotel Stay", "category": "hotel", "amount": 36000},
        {"name": "Airport Transfer", "category": "transfer", "amount": 6000},
        {"name": "Activity Package", "category": "activity", "amount": 9000},
        {"name": "Travel Insurance", "category": "insurance", "amount": 3000},
    ]

    priced_items = [
        {
            "item_id": str(uuid.uuid4()),
            "name": row["name"],
            "category": row["category"],
            "amount": row["amount"],
            "status": "active",
        }
        for row in fake_items
    ]
    total_amount = _money(sum(row["amount"] for row in fake_items))

    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            _ensure_cancellation_schema(cur)

            cur.execute(
                """
                SELECT booking_id, provider_booking_id, pricing_breakdown
                FROM bookings
                WHERE provider_booking_id = %s
                """,
                (provider_booking_id,),
            )
            booking = cur.fetchone()
            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found")

            existing_items = _normalize_pricing_items(booking.get("pricing_breakdown"))
            if existing_items and not overwrite:
                return {
                    "message": "Pricing already exists. Pass overwrite=true to replace.",
                    "booking_id": str(booking["booking_id"]),
                    "provider_booking_id": str(booking.get("provider_booking_id") or provider_booking_id),
                    "existing_item_count": len(existing_items),
                }

            cur.execute(
                """
                UPDATE bookings
                SET pricing_breakdown = %s,
                    total_booking_amount = %s,
                    currency = 'INR',
                    cancelled_items = '[]'::jsonb,
                    cancelled_amount = 0,
                    refunded_amount = 0,
                    updated_at = CURRENT_TIMESTAMP
                WHERE booking_id = %s
                """,
                (Json(priced_items), total_amount, booking["booking_id"]),
            )

        conn.commit()

    return {
        "message": "Fake booking pricing seeded",
        "booking_id": str(booking["booking_id"]),
        "provider_booking_id": str(booking.get("provider_booking_id") or provider_booking_id),
        "currency": "INR",
        "total_booking_amount": float(total_amount),
        "items": priced_items,
    }


def generate_disruption():
    disruptions = [
        ("delayed", "Flight delayed due to operational congestion."),
        ("cancelled_by_airline", "Flight cancelled due to crew shortage."),
        ("technical_issue", "Aircraft undergoing unexpected technical inspection."),
        ("weather_issue", "Severe weather conditions affecting operations."),
        ("overbooked", "Flight overbooked. Re-accommodation required."),
    ]
    return random.choice(disruptions)


def disrupt_random_booking():
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT booking_id
                FROM bookings
                WHERE booking_status = 'confirmed'
                  AND disruption_status = 'none'
                  AND trip_end_date > NOW()
                ORDER BY RANDOM()
                LIMIT 1
                """
            )

            result = cur.fetchone()

            if not result:
                return {"message": "No eligible bookings available for disruption"}

            booking_id = result[0]
            status, reason = generate_disruption()

            cur.execute(
                """
                UPDATE bookings
                SET disruption_status = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE booking_id = %s
                """,
                (status, booking_id),
            )

        conn.commit()

    return {
        "booking_id": str(booking_id),
        "new_disruption_status": status,
        "reason": reason,
    }


def get_cancellation_details(provider_booking_id: str):
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            _ensure_cancellation_schema(cur)

            cur.execute(
                """
                SELECT booking_id, provider_booking_id, booking_status, trip_start_date, trip_end_date,
                       currency, pricing_breakdown, total_booking_amount,
                       cancelled_items, cancelled_amount, refunded_amount
                FROM bookings
                WHERE provider_booking_id = %s
                """,
                (provider_booking_id,),
            )
            booking = cur.fetchone()

            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found")

            cur.execute(
                """
                SELECT cancellation_id, cancellation_type, refund_status,
                       total_booking_amount, cancellation_penalty, refund_amount,
                       penalty_percent, cancelled_items, created_at
                FROM cancellations_refunds
                WHERE booking_id = %s
                ORDER BY created_at DESC
                """,
                (booking["booking_id"],),
            )
            cancellations = cur.fetchall()

        conn.commit()

    return {
        "booking": booking,
        "cancellations": cancellations,
    }


def get_booking_pricing(provider_booking_id: str):
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            _ensure_cancellation_schema(cur)

            cur.execute(
                """
                SELECT booking_id, provider_booking_id, booking_status, currency,
                       pricing_breakdown, total_booking_amount,
                       cancelled_amount, refunded_amount
                FROM bookings
                WHERE provider_booking_id = %s
                """,
                (provider_booking_id,),
            )
            booking = cur.fetchone()

            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found")

        conn.commit()

    pricing_items = _normalize_pricing_items(booking.get("pricing_breakdown"))
    active_items = [item for item in pricing_items if item["status"] == "active"]
    cancelled_items = [item for item in pricing_items if item["status"] == "cancelled"]

    return {
        "booking_id": str(booking["booking_id"]),
        "provider_booking_id": str(booking.get("provider_booking_id") or provider_booking_id),
        "booking_status": booking["booking_status"],
        "currency": booking.get("currency") or "INR",
        "total_booking_amount": float(_money(booking.get("total_booking_amount") or 0)),
        "cancelled_amount": float(_money(booking.get("cancelled_amount") or 0)),
        "refunded_amount": float(_money(booking.get("refunded_amount") or 0)),
        "active_items": active_items,
        "cancelled_items": cancelled_items,
    }


def cancel_trip(
    provider_booking_id: str,
    cancellation_type: str,
    selected_item_ids: list[str] | None = None,
    selected_days: list[int] | None = None,
):
    cancellation_type = cancellation_type.lower().strip()
    if cancellation_type not in {"full", "partial"}:
        raise HTTPException(status_code=422, detail="cancellation_type must be 'full' or 'partial'")

    selected_item_ids = selected_item_ids or []
    selected_days = selected_days or []

    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            _ensure_cancellation_schema(cur)

            cur.execute(
                """
                SELECT booking_id, provider_booking_id, booking_status, currency, pricing_breakdown,
                       cancelled_items, cancelled_amount
                FROM bookings
                WHERE provider_booking_id = %s
                FOR UPDATE
                """,
                (provider_booking_id,),
            )
            booking = cur.fetchone()

            if not booking:
                raise HTTPException(status_code=404, detail="Booking not found")

            pricing_items = _normalize_pricing_items(booking.get("pricing_breakdown"))
            if not pricing_items:
                raise HTTPException(
                    status_code=400,
                    detail="No pricing breakdown exists for this booking. Seed/add itemized pricing first.",
                )

            active_items = [item for item in pricing_items if item["status"] == "active"]
            if not active_items:
                raise HTTPException(status_code=400, detail="All items are already cancelled")

            active_item_map = {item["item_id"]: item for item in active_items}
            if cancellation_type == "full":
                chosen_ids = list(active_item_map.keys())
                penalty_rate = FULL_CANCELLATION_PENALTY
            else:
                if not selected_item_ids and not selected_days:
                    raise HTTPException(
                        status_code=422,
                        detail="For partial cancellation, provide selected_item_ids or selected_days.",
                    )

                if selected_item_ids:
                    chosen_ids = list(dict.fromkeys(selected_item_ids))
                    invalid_ids = [item_id for item_id in chosen_ids if item_id not in active_item_map]
                    if invalid_ids:
                        raise HTTPException(
                            status_code=422,
                            detail={
                                "message": "Some selected items are invalid or already cancelled",
                                "invalid_item_ids": invalid_ids,
                            },
                        )
                else:
                    day_set = set(selected_days)
                    chosen_ids = [
                        item["item_id"]
                        for item in active_items
                        if item.get("day") in day_set
                    ]
                    invalid_days = sorted(day_set - {item.get("day") for item in active_items if item.get("day") is not None})
                    if invalid_days:
                        raise HTTPException(
                            status_code=422,
                            detail={
                                "message": "Some selected days are invalid or already cancelled",
                                "invalid_days": invalid_days,
                            },
                        )

                    if not chosen_ids:
                        raise HTTPException(
                            status_code=422,
                            detail="No active pricing rows found for selected_days.",
                        )

                penalty_rate = PARTIAL_CANCELLATION_PENALTY

            chosen_items = [active_item_map[item_id] for item_id in chosen_ids]
            cancelled_scope_amount = _money(sum(item["amount"] for item in chosen_items))
            cancellation_penalty = _money(cancelled_scope_amount * penalty_rate)
            refund_amount = _money(cancelled_scope_amount - cancellation_penalty)

            cancelled_item_records = [
                {
                    "item_id": item["item_id"],
                    "name": item["name"],
                    "category": item["category"],
                    "amount": item["amount"],
                    "day": item.get("day"),
                }
                for item in chosen_items
            ]

            updated_pricing = []
            for item in pricing_items:
                if item["item_id"] in chosen_ids:
                    item["status"] = "cancelled"
                updated_pricing.append(item)

            existing_cancelled_items = booking.get("cancelled_items")
            if not isinstance(existing_cancelled_items, list):
                existing_cancelled_items = []

            cancellation_id = str(uuid.uuid4())
            existing_cancelled_items.append(
                {
                    "cancellation_id": cancellation_id,
                    "cancellation_type": cancellation_type,
                    "items": cancelled_item_records,
                    "cancelled_scope_amount": float(cancelled_scope_amount),
                }
            )

            remaining_active = [item for item in updated_pricing if item["status"] == "active"]
            new_status = "cancelled" if not remaining_active else booking["booking_status"]
            new_cancelled_total = _money(
                sum(item["amount"] for item in updated_pricing if item.get("status") == "cancelled")
            )

            cur.execute(
                """
                INSERT INTO cancellations_refunds (
                    cancellation_id,
                    booking_id,
                    cancellation_type,
                    refund_status,
                    total_booking_amount,
                    cancellation_penalty,
                    refund_amount,
                    currency,
                    cancelled_items,
                    penalty_percent
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    cancellation_id,
                    booking["booking_id"],
                    cancellation_type,
                    "refunded" if AUTO_PROCESS_REFUND_ON_CANCELLATION else "quote_generated",
                    cancelled_scope_amount,
                    cancellation_penalty,
                    refund_amount,
                    booking.get("currency") or "INR",
                    Json(cancelled_item_records),
                    float((penalty_rate * Decimal("100")).quantize(Decimal("0.01"))),
                ),
            )

            cur.execute(
                """
                UPDATE bookings
                SET booking_status = %s,
                    pricing_breakdown = %s,
                    cancelled_items = %s,
                    cancelled_amount = %s,
                    refunded_amount = COALESCE(
                        (
                            SELECT SUM(refund_amount)
                            FROM cancellations_refunds
                            WHERE booking_id = %s
                              AND refund_status = 'refunded'
                        ),
                        0
                    ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE booking_id = %s
                """,
                (
                    new_status,
                    Json(updated_pricing),
                    Json(existing_cancelled_items),
                    new_cancelled_total,
                    booking["booking_id"],
                    booking["booking_id"],
                ),
            )

        conn.commit()

    return {
        "message": "Cancellation processed with auto-refund" if AUTO_PROCESS_REFUND_ON_CANCELLATION else "Cancellation initiated",
        "cancellation_id": cancellation_id,
        "booking_id": str(booking["booking_id"]),
        "provider_booking_id": str(booking.get("provider_booking_id") or provider_booking_id),
        "cancellation_type": cancellation_type,
        "cancelled_items": cancelled_item_records,
        "cancelled_scope_amount": float(cancelled_scope_amount),
        "penalty_percent": float((penalty_rate * Decimal("100")).quantize(Decimal("0.01"))),
        "penalty_amount": float(cancellation_penalty),
        "refund_quote": float(refund_amount),
        "refund_status": "refunded" if AUTO_PROCESS_REFUND_ON_CANCELLATION else "quote_generated",
        "amount_refunded": float(refund_amount) if AUTO_PROCESS_REFUND_ON_CANCELLATION else 0.0,
        "booking_status": new_status,
        "booking_cancelled_amount": float(new_cancelled_total),
    }


def process_refund(cancellation_id: str):
    with get_db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            _ensure_cancellation_schema(cur)

            cur.execute(
                """
                SELECT
                    cr.cancellation_id,
                    cr.booking_id,
                    cr.refund_status,
                    cr.refund_amount,
                    cr.cancelled_items,
                    cr.penalty_percent,
                    b.pricing_breakdown,
                    b.currency
                FROM cancellations_refunds cr
                JOIN bookings b ON b.booking_id = cr.booking_id
                WHERE cr.cancellation_id = %s
                FOR UPDATE OF cr, b
                """,
                (cancellation_id,),
            )
            result = cur.fetchone()

            if not result:
                raise HTTPException(status_code=404, detail="Cancellation not found")

            pricing_items = _normalize_pricing_items(result.get("pricing_breakdown"))
            pricing_item_map = {item["item_id"]: item for item in pricing_items}

            cancelled_items = result.get("cancelled_items")
            if not isinstance(cancelled_items, list):
                cancelled_items = []

            refunded_items: list[dict] = []
            missing_item_ids: list[str] = []
            cancelled_scope_amount = Decimal("0.00")

            for cancelled_item in cancelled_items:
                if not isinstance(cancelled_item, dict):
                    continue

                item_id = str(cancelled_item.get("item_id") or "").strip()
                if not item_id:
                    continue

                priced_item = pricing_item_map.get(item_id)
                if not priced_item:
                    missing_item_ids.append(item_id)
                    continue

                item_amount = _money(priced_item.get("amount") or 0)
                cancelled_scope_amount = _money(cancelled_scope_amount + item_amount)
                refunded_items.append(
                    {
                        "item_id": priced_item["item_id"],
                        "name": priced_item["name"],
                        "category": priced_item["category"],
                        "amount": float(item_amount),
                    }
                )

            penalty_percent = _money(result.get("penalty_percent") or 0)
            computed_refund = _money(cancelled_scope_amount * (Decimal("1") - (penalty_percent / Decimal("100"))))
            quoted_refund = _money(result.get("refund_amount") or 0)
            final_refund_amount = quoted_refund if quoted_refund > 0 else computed_refund

            if result["refund_status"] == "refunded":
                return {
                    "message": "Already refunded",
                    "cancellation_id": str(result["cancellation_id"]),
                    "booking_id": str(result["booking_id"]),
                    "currency": result.get("currency") or "INR",
                    "amount_refunded": float(final_refund_amount),
                    "cancelled_scope_amount": float(cancelled_scope_amount),
                    "refunded_items": refunded_items,
                    "missing_item_ids": missing_item_ids,
                }

            cur.execute(
                """
                UPDATE cancellations_refunds
                SET refund_status = 'refunded',
                    refund_amount = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE cancellation_id = %s
                """,
                (final_refund_amount, cancellation_id),
            )

            cur.execute(
                """
                UPDATE bookings
                SET refunded_amount = COALESCE(
                        (
                            SELECT SUM(refund_amount)
                            FROM cancellations_refunds
                            WHERE booking_id = %s
                              AND refund_status = 'refunded'
                        ),
                        0
                    ),
                    cancelled_amount = COALESCE(
                        (
                            SELECT SUM((elem->>'amount')::numeric)
                            FROM jsonb_array_elements(COALESCE(pricing_breakdown, '[]'::jsonb)) AS elem
                            WHERE COALESCE(elem->>'status', 'active') = 'cancelled'
                        ),
                        0
                    ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE booking_id = %s
                """,
                (result["booking_id"], result["booking_id"]),
            )

        conn.commit()

    return {
        "message": "Refund processed successfully",
        "cancellation_id": str(result["cancellation_id"]),
        "booking_id": str(result["booking_id"]),
        "currency": result.get("currency") or "INR",
        "amount_refunded": float(final_refund_amount),
        "cancelled_scope_amount": float(cancelled_scope_amount),
        "refunded_items": refunded_items,
        "missing_item_ids": missing_item_ids,
    }


def sync_booking_status():
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT booking_id
                FROM bookings
                WHERE updated_at < NOW() - INTERVAL '1 day'
                """
            )
            old_bookings = cur.fetchall()

            if not old_bookings:
                return {
                    "message": "No bookings required status sync",
                    "updated_count": 0,
                }

            cur.execute(
                """
                UPDATE bookings
                SET updated_at = CURRENT_TIMESTAMP
                WHERE updated_at < NOW() - INTERVAL '1 day'
                RETURNING booking_id
                """
            )

            updated_rows = cur.fetchall()

        conn.commit()

    return {
        "message": "Booking status sync completed",
        "updated_count": len(updated_rows),
        "updated_booking_ids": [str(row[0]) for row in updated_rows],
    }