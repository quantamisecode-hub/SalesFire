// Prompt 3 types: AI Sales Agent, Research, Business Brain, ICP

export interface AISalesAgent {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  business_name?: string;
  website?: string;
  services?: string[];
  target_geographies?: string[];
  target_job_titles?: string[];
  target_industries?: string[];
  company_size_min?: number;
  company_size_max?: number;
  keywords?: string[];
  preferred_ai_provider: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AISalesAgentCreate {
  name: string;
  description?: string;
  business_name?: string;
  website?: string;
  services?: string[];
  target_geographies?: string[];
  target_job_titles?: string[];
  target_industries?: string[];
  company_size_min?: number;
  company_size_max?: number;
  keywords?: string[];
  preferred_ai_provider?: "ollama" | "groq" | "openrouter" | "gemini";
  is_default?: boolean;
}

export interface ResearchJob {
  id: string;
  organization_id: string;
  ai_sales_agent_id?: string;
  created_by: string;
  job_type: string;
  status: string;
  progress: number;
  payload?: any;
  result_reference?: string;
  error_code?: string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ResearchStartRequest {
  website: string;
}

export interface BusinessBrain {
  id: string;
  organization_id: string;
  ai_sales_agent_id?: string;
  current_version_id?: string;
  company_name?: string;
  domain?: string;
  description?: string;
  headquarters?: string;
  founding_year?: string;
  company_size?: string;
  industry?: string;
  products_services?: string[];
  technologies?: string[];
  industries_served?: string[];
  target_customers?: string[];
  customer_types?: string[];
  geographies?: string[];
  buyer_personas?: string[];
  value_proposition?: string;
  usp?: string[];
  differentiators?: string[];
  pricing?: string;
  packages?: string[];
  business_model?: string;
  case_studies?: string[];
  competitors?: string[];
  alternatives?: string[];
  buying_problems?: string[];
  keywords?: string[];
  trigger_keywords?: string[];
  buying_signals?: string[];
  source_count: number;
  confidence_score?: number;
  last_researched_at?: string;
  research_status: string;
  created_at: string;
  updated_at: string;
}

export interface BusinessBrainFact {
  id: string;
  business_brain_id: string;
  category: string;
  claim: string;
  evidence_text?: string;
  source_url?: string;
  confidence?: number;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessBrainFactCreate {
  category: string;
  claim: string;
  evidence_text?: string;
  source_url?: string;
  confidence?: number;
}

export interface BusinessBrainVersion {
  id: string;
  business_brain_id: string;
  version_number: number;
  research_job_id?: string;
  snapshot: any;
  source_count: number;
  changed_fields?: string[];
  created_at: string;
}

export interface ICP {
  id: string;
  organization_id: string;
  business_profile_id?: string;
  name: string;
  description?: string;
  industries?: string[];
  countries?: string[];
  company_size_min?: number;
  company_size_max?: number;
  revenue_range_min?: number;
  revenue_range_max?: number;
  job_titles?: string[];
  seniority_levels?: string[];
  technologies?: string[];
  keywords?: string[];
  excluded_industries?: string[];
  excluded_countries?: string[];
  excluded_companies?: string[];
  scoring_weights?: Record<string, number>;
  status: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ICPCreate {
  name: string;
  description?: string;
  business_profile_id?: string;
  industries?: string[];
  countries?: string[];
  company_size_min?: number;
  company_size_max?: number;
  revenue_range_min?: number;
  revenue_range_max?: number;
  job_titles?: string[];
  seniority_levels?: string[];
  technologies?: string[];
  keywords?: string[];
  excluded_industries?: string[];
  excluded_countries?: string[];
  excluded_companies?: string[];
  scoring_weights?: Record<string, number>;
  status?: "draft" | "active" | "archived";
  is_default?: boolean;
}

export interface ICPUpdate {
  name?: string;
  description?: string;
  industries?: string[];
  countries?: string[];
  company_size_min?: number;
  company_size_max?: number;
  revenue_range_min?: number;
  revenue_range_max?: number;
  job_titles?: string[];
  seniority_levels?: string[];
  technologies?: string[];
  keywords?: string[];
  excluded_industries?: string[];
  excluded_countries?: string[];
  excluded_companies?: string[];
  scoring_weights?: Record<string, number>;
  status?: "draft" | "active" | "archived";
  is_default?: boolean;
}

export interface ScoreBreakdownItem {
  criterion: string;
  score: number;
  max_score: number;
  matched: boolean;
  match_level: string;
  reason: string;
  confidence: number;
}

export interface ScoreLeadRequest {
  company_size_min?: number;
  company_size_max?: number;
  industry?: string;
  country?: string;
  job_title?: string;
  keywords?: string[];
  buying_signals?: string[];
}

export interface ScoreLeadResponse {
  overall_score: number;
  max_score: number;
  grade: string;
  breakdown: ScoreBreakdownItem[];
  icp_id: string;
  icp_name: string;
}

export interface ICPProposalRequest {
  business_brain_data: any;
}

export interface ICPProposalResponse {
  name: string;
  description?: string;
  industries: string[];
  countries: string[];
  company_size_min?: number;
  company_size_max?: number;
  job_titles: string[];
  seniority_levels: string[];
  keywords: string[];
  scoring_weights: Record<string, number>;
  provider: string;
  is_proposal: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}
