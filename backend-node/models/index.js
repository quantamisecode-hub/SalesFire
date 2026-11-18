// Models index - central model registry and associations
const { sequelize } = require('../db');

const User = require('./user');
const Organization = require('./organization');
const OrganizationMembership = require('./organization-membership');
const Campaign = require('./campaign');
const CampaignSequence = require('./campaign-sequence');
const CampaignStep = require('./campaign-step');
const CampaignLead = require('./campaign-lead');
const CampaignSendingAccount = require('./campaign-sending-account');
const CampaignEmailTemplate = require('./campaign-email-template');
const CampaignAIProposal = require('./campaign-ai-proposal');
const SmtpAccount = require('./smtp-account');
const Suppression = require('./suppression');
const EmailEvent = require('./email-event');
const EmailJob = require('./email-job');
const Lead = require('./lead');
const ImportJob = require('./import-job');
const CampaignStepVariant = require('./campaign-step-variant');
const EmailVerification = require('./email-verification');
const WarmupPlan = require('./warmup-plan');
const EmailSignature = require('./email-signature');
const SendingAccountUsage = require('./sending-account-usage');
const AuditLog = require('./audit-log');
const { LeadList, LeadListMember } = require('./lead-list');
const { Conversation, EmailMessage, MailboxSyncState, ConversationDraft, ConversationInsight, Notification } = require('./inbox');

// Run associations (each model defines static associate) - unique models only
const models = {
  User,
  Organization,
  OrganizationMembership,
  Campaign,
  CampaignSequence,
  CampaignStep,
  CampaignLead,
  CampaignSendingAccount,
  CampaignEmailTemplate,
  CampaignAIProposal,
  SmtpAccount,
  Suppression,
  EmailEvent,
  EmailJob,
  Lead,
  ImportJob,
  CampaignStepVariant,
  EmailVerification,
  WarmupPlan,
  EmailSignature,
  SendingAccountUsage,
  AuditLog,
  LeadList,
  LeadListMember,
  Conversation,
  EmailMessage,
  MailboxSyncState,
  ConversationDraft,
  ConversationInsight,
  Notification,
};

Object.values(models).forEach((model) => {
  if (typeof model.associate === 'function') {
    model.associate(models);
  }
});

// Backwards-compatible aliases (same references, no re-association)
models.Users = User;
models.Organizations = Organization;
models.OrganizationMemberships = OrganizationMembership;
models.Campaigns = Campaign;
models.CampaignSequences = CampaignSequence;
models.CampaignSteps = CampaignStep;
models.SmtpAccounts = SmtpAccount;
models.Suppressions = Suppression;
models.EmailEvents = EmailEvent;
models.EmailJobs = EmailJob;
models.Leads = Lead;
models.ImportJobs = ImportJob;
models.CampaignStepVariants = CampaignStepVariant;
models.EmailVerifications = EmailVerification;
models.WarmupPlans = WarmupPlan;
models.EmailSignatures = EmailSignature;
models.SendingAccountUsages = SendingAccountUsage;
models.AuditLogs = AuditLog;
models.LeadLists = LeadList;
models.LeadListMembers = LeadListMember;
models.Conversations = Conversation;
models.EmailMessages = EmailMessage;
models.MailboxSyncStates = MailboxSyncState;
models.ConversationDrafts = ConversationDraft;
models.ConversationInsights = ConversationInsight;
models.Notifications = Notification;

module.exports = models;
