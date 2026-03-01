// ─── Backend API Types ────────────────────────────────────────────────────────

export interface TravelAgent {
  agent_id: string
  stackauth_id: string
  name: string | null
  email: string | null
  role: string
  created_at: string
}

export interface CreateChatPayload {
  phone_number: string
  agent_id: string
}

export interface CreateChatResponse {
  chat_id: string
  user_id?: string
}

export interface ChatFlowPayload {
  text: string
  edited_structured_requirement?: Record<string, unknown>
}

export interface AgentMessage {
  type: string
  content: string
  [key: string]: unknown
}

export interface ChatRecord {
  chat_id: string
  user_id?: string
  user_message?: string
  structured_requirement?: StructuredRequirement
  agent_response?: {
    messages?: AgentMessage[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface ProcessingResult {
  upload_id?: string
  file_url?: string
  file_type?: string
  route?: string
  result?: Record<string, unknown>
  [key: string]: unknown
}

export interface ChatFlowResponse {
  chat_id?: string
  processed_uploads?: number
  processing_results?: ProcessingResult[]
  context_keys?: string[]
  chat?: ChatRecord
  // legacy / direct fields
  structured_requirement?: StructuredRequirement
  metadata?: Record<string, unknown>
  reply?: string
  response?: string
  message?: string
  [key: string]: unknown
}

export interface Message {
  id: string
  chat_id: string
  role: "user" | "assistant"
  content: string
  created_at: string
  /** If present, renders an inline requirements card instead of a text bubble */
  structuredData?: StructuredRequirement
}

export interface ChatSession {
  chat_id: string
  phone_number: string
  customer_name?: string
  created_at: string
  last_message?: string
  destinations?: string[] | null
}

// ─── Structured Requirement (matches actual API response) ───────────────────

export interface TripOverview {
  summary?: string | null
  trip_type?: string | null
  confidence?: string | null
}

export interface RoutePlan {
  origin?: string | null
  destinations?: string[] | null
  multi_city?: boolean | null
  flexible_destinations?: string[] | null
}

export interface Travelers {
  count?: number | null
  adults?: number | null
  children?: number | null
  infants?: number | null
  special_needs?: string[] | null
}

export interface Dates {
  start_date?: string | null
  end_date?: string | null
  duration_nights?: number | null
  date_flexibility?: string | null
  blackout_dates?: string[] | null
}

export interface Budget {
  currency?: string | null
  max_total?: number | null
  budget_per_person?: number | null
  budget_notes?: string | null
}

export interface TransportPreferences {
  flight_class?: string | null
  preferred_airlines?: string[] | null
  avoid_airlines?: string[] | null
  stops_preference?: string | null
  departure_time_pref?: string | null
}

export interface StayPreferences {
  property_types?: string[] | null
  star_rating_min?: number | null
  room_count?: number | null
  bed_type_pref?: string | null
  amenities_required?: string[] | null
  amenities_optional?: string[] | null
  location_preference?: string | null
}

export interface Activities {
  must_do?: string[] | null
  nice_to_have?: string[] | null
  avoid?: string[] | null
  pace?: string | null
}

export interface FoodPreferences {
  dietary_restrictions?: string[] | null
  cuisine_preferences?: string[] | null
}

export interface DocumentsAndConstraints {
  visa_needed?: boolean | null
  passport_validity_notes?: string | null
  hard_constraints?: string[] | null
  soft_constraints?: string[] | null
}

export interface ExtractedFact {
  fact: string
  source_type: string
  confidence: string
}

export interface ImpliedInference {
  inference: string
  reason?: string
  confidence?: string
}

export interface StructuredRequirement {
  trip_overview?: TripOverview | null
  travelers?: Travelers | null
  route_plan?: RoutePlan | null
  dates?: Dates | null
  budget?: Budget | null
  transport_preferences?: TransportPreferences | null
  stay_preferences?: StayPreferences | null
  activities?: Activities | null
  food_preferences?: FoodPreferences | null
  documents_and_constraints?: DocumentsAndConstraints | null
  extracted_facts?: ExtractedFact[] | null
  implied_inferences?: ImpliedInference[] | null
  [key: string]: unknown
}
