// Prompt 4 types: Lead Finder, Lead Intelligence, Discovery

export interface LeadSearch {
  id: string;
  organization_id: string;
  icp_id: string;
  name: string;
  description?: string;
  status: string;
  company_filters?: Record<string, any>;
  contact_filters?: Record<string, any>;
  max_results?: number;
  companies_discovered: number;
  companies_qualified: number;
  contacts_discovered: number;
  emails_discovered: number;
  leads_scored: number;
  duplicates_removed: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface LeadSearchCreate {
  name: string;
  description?: string;
  icp_id: string;
  company_filters?: Record<string, any>;
  contact_filters?: Record<string, any>;
  max_results?: number;
}

export interface LeadSearchProgress {
  id: string;
  status: string;
  companies_discovered: number;
  companies_qualified: number;
  contacts_discovered: number;
  emails_discovered: number;
  leads_scored: number;
  duplicates_removed: number;
  started_at?: string;
  completed_at?: string;
  elapsed_seconds?: number;
}

export interface Company {
  id: string;
  organization_id: string;
  name: string;
  domain?: string;
  website?: string;
  industry?: string;
  country?: string;
  city?: string;
  employee_count?: number;
  revenue?: number;
  technologies?: string[];
  description?: string;
  icp_match_score?: number;
  source?: string;
  source_url?: string;
  last_verified_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  organization_id: string;
  company_id?: string;
  first_name: string;
  last_name: string;
  job_title?: string;
  seniority?: string;
  department?: string;
  email?: string;
  email_status: string;
  phone?: string;
  linkedin_url?: string;
  country?: string;
  icp_score?: number;
  grade?: string;
  buying_signals?: string[];
  source?: string;
  source_url?: string;
  confidence_score?: number;
  last_verified_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  organization_id: string;
  lead_search_id?: string;
  company_id: string;
  contact_id: string;
  overall_score: number;
  grade: string;
  industry_match?: string;
  geography_match?: string;
  company_size_match?: string;
  job_title_match?: string;
  service_relevance_match?: string;
  buying_signals_match?: string;
  matched_criteria?: string[];
  unmatched_criteria?: string[];
  buying_signals?: string[];
  source_evidence?: Record<string, any>;
  status: string;
  is_duplicate: boolean;
  created_at: string;
  updated_at: string;
  // Denormalized for UI
  company_name?: string;
  company_domain?: string;
  company_industry?: string;
  company_country?: string;
  company_employee_count?: number;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_job_title?: string;
  contact_email?: string;
  contact_email_status?: string;
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

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface DiscoveryProvider {
  name: string;
  label: string;
}

export interface LeadList {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  lead_count: number;
  average_score?: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LeadListCreate {
  name: string;
  description?: string;
}

export interface ICP {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  status: string;
  scoring_weights?: Record<string, number>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
