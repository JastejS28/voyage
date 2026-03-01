# TBO Travel Extraction API

Production-ready FastAPI service for:
- chat session creation
- file upload registration (R2/S3 presigned or direct)
- multimodal extraction (image/video/pdf/audio)
- structured requirement persistence to `public.chats.structured_requirement`

## Runtime Architecture

- Entry API: `api.py` (`app`)
- Agent: `agent.py`
- Extractor: `analyser.py`
- Database helpers: `db.py`
- Single server start file: `server.py`

## Run Locally

1. Install deps:
	 - `pip install -r requirements.txt`
2. Configure `.env` (minimum keys):
	 - `DATABASE_URL`
	 - `OPENROUTER_API_KEY`
	 - `S3_API`
	 - `CLOUDFARE_ACCESS`
	 - `CLOUDFARE_SECRET_ACCESS`
	 - `BUCKET_NAME`
	 - `PUBLIC_URL`
3. Start server:
	 - `python server.py`

Server defaults:
- host: `0.0.0.0`
- port: `8000` (or `$PORT` if provided)

## Render Deployment

Create a **Web Service** and set:

- Build Command:
	- `pip install -r requirements.txt`
- Start Command:
	- `python server.py`

Set environment variables in Render dashboard:
- `DATABASE_URL`
- `OPENROUTER_API_KEY`
- `S3_API`
- `CLOUDFARE_ACCESS`
- `CLOUDFARE_SECRET_ACCESS`
- `BUCKET_NAME`
- `PUBLIC_URL`

Optional:
- `HOST` (default `0.0.0.0`)
- `PORT` (Render injects this automatically)

## Health and Debug Routes

- `GET /db/health`
- `GET /db/schema`
- `GET /uploads/{chat_id}`
- `GET /debug-credentials` (debug only; do not expose publicly)

## Booking Cancellation / Refund Flow

Run once (adds required money/item columns):
- `POST /cancellation/setup-schema`

Seed fake itemized booking pricing for testing:
- `POST /booking-pricing/seed/{provider_booking_id}`
- body:

```json
{
	"overwrite": true
}
```

Get booking + cancellation details:
- `GET /cancellation/{provider_booking_id}`

Get clean itemized pricing view (active vs cancelled):
- `GET /booking-pricing/{provider_booking_id}`

Cancel selected items from `bookings.pricing_breakdown` (partial = 20% penalty):
- `POST /cancellation/cancel/{provider_booking_id}`
- body:

```json
{
	"cancellation_type": "partial",
	"selected_days": [2, 3]
}
```

Alternative partial payload for itemized rows:

```json
{
	"cancellation_type": "partial",
	"selected_item_ids": ["<item-id-1>", "<item-id-2>"]
}
```

Cancel all remaining active items (full = 30% penalty):
- `POST /cancellation/cancel/{provider_booking_id}`
- body:

```json
{
	"cancellation_type": "full"
}
```

Process refund (uses cancellation row + booking `pricing_breakdown` items):
- `POST /refund/process`
- body:

```json
{
	"cancellation_id": "<cancellation-uuid>"
}
```

Legacy compatibility routes still available:
- `POST /cancel` (expects `provider_booking_id` in body)
- `POST /process-refund/{cancellation_id}`

## Core Flow (Single Request)

Use `POST /chat-flow/{chat_id}` with:

```json
{
	"message": "Plan my 5-day Bali trip",
	"process_pending_uploads": true
}
```

This route:
1. processes pending uploads,
2. verifies extraction success,
3. builds context,
4. runs agent,
5. verifies `structured_requirement` persistence.
