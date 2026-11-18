// Lead types for the table-first Leads management UI (§3, §35).
export interface Lead {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  jobTitle?: string;
  email: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  location?: string;
  industry?: string;
  companySize?: string;
  personalization?: string;
  customFields?: Record<string, string> | null;
  status: string; // progression: new | approved | contacted | replied | bounced | unsubscribed | suppressed | invalid | completed; interest: interested | meeting_completed | meeting_completed_not_closed | won | lost | not_interested | out_of_office | wrong_person
  emailStatus: string; // unknown | discovered | syntax_valid | domain_valid | mx_valid | verified | invalid | bounced | unsubscribed
  leadScore?: number | null;
  source?: string;
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
  enrolledInCampaign?: boolean;
}

export interface Member {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export interface LeadList {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadListDetail extends LeadList {
  members: Array<{
    id: string;
    leadId: string;
    addedAt: string;
    lead: {
      id: string;
      firstName?: string;
      lastName?: string;
      companyName?: string;
      email: string;
      status: string;
      emailStatus?: string;
      assignedTo: string | null;
    } | null;
  }>;
}

export interface LeadListResponse {
  success: boolean;
  data: Lead[];
  pagination: { page: number; pages: number; total: number; pageSize: number };
}

export interface ImportColumn {
  index: number;
  header: string;
  samples: string[];
  suggested: string;
}

export interface ImportPreview {
  headers: string[];
  rows: unknown[][];
  format: "xlsx" | "csv";
  columns: ImportColumn[];
  mapping: Record<string, string>;
  maxRows: number;
  maxFileBytes: number;
  filename: string;
}

export interface ImportValidationCounts {
  totalRows: number;
  valid: number;
  invalidEmail: number;
  missingEmail: number;
  duplicateInFile: number;
  duplicateExisting: number;
  /** Leads already enrolled in the target campaign (import-into-campaign only). */
  campaignEnrolled?: number;
  suppressed: number;
}

export interface ImportValidationError {
  row: number;
  email: string;
  reason: string;
}

export interface ImportJobStatus {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  filename: string;
  totalRows: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  errorMessage: string | null;
}

export const LEAD_FIELD_OPTIONS: Array<{ value: string; label: string; required?: boolean }> = [
  { value: "firstName", label: "First Name" },
  { value: "lastName", label: "Last Name" },
  { value: "companyName", label: "Company Name" },
  { value: "jobTitle", label: "Job Title" },
  { value: "email", label: "Email", required: true },
  { value: "phone", label: "Phone" },
  { value: "website", label: "Website" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "location", label: "Location" },
  { value: "industry", label: "Industry" },
  { value: "companySize", label: "Company Size" },
  { value: "personalization", label: "Personalization" },
  { value: "skip", label: "Do Not Import" },
];
