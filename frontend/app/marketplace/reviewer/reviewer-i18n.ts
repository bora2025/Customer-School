export type ReviewerMessageKey =
  | 'reviewer.error.evidence.invalidObject'
  | 'reviewer.error.evidence.missingChecks'
  | 'reviewer.error.evidence.missingRequirements'
  | 'reviewer.error.evidence.missingRequirementsNamed'
  | 'reviewer.error.evidence.invalidChecks'
  | 'reviewer.error.evidence.invalidTicketFormat'
  | 'reviewer.error.evidence.invalidArtifactFormat'
  | 'reviewer.error.evidence.invalidArtifactType';

const enUS: Record<ReviewerMessageKey, string> = {
  'reviewer.error.evidence.invalidObject': 'Evidence must be a JSON object with named fields.',
  'reviewer.error.evidence.missingChecks': 'Add at least one check entry under checks[].',
  'reviewer.error.evidence.missingRequirements': 'High-risk decisions require artifacts[] and a non-empty ticket.',
  'reviewer.error.evidence.missingRequirementsNamed': 'Missing evidence requirement(s): {missing}.',
  'reviewer.error.evidence.invalidChecks': 'One or more checks are not in the allowed reviewer checklist vocabulary.',
  'reviewer.error.evidence.invalidTicketFormat': 'Ticket format is invalid. Use format like SEC-1234.',
  'reviewer.error.evidence.invalidArtifactFormat': 'Artifact format is invalid. Use <type>:<reference>, for example sandbox-log:run-2026-09-20.',
  'reviewer.error.evidence.invalidArtifactType': 'Artifact type is not allowed. Use one of: analysis-report, sandbox-log, policy-checklist.',
};

export type ReviewerApiErrorPayload = {
  error?: string;
  code?: string;
  details?: {
    missingRequirements?: string[];
    field?: string;
  };
};

function format(message: string, params?: Record<string, string>) {
  if (!params) return message;
  return Object.entries(params).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), message);
}

export function reviewerMessage(key: ReviewerMessageKey, params?: Record<string, string>) {
  return format(enUS[key], params);
}

export function reviewerEvidenceHint(payload: ReviewerApiErrorPayload): string {
  if (payload.code === 'REVIEW_EVIDENCE_INVALID_OBJECT') {
    return reviewerMessage('reviewer.error.evidence.invalidObject');
  }
  if (payload.code === 'REVIEW_EVIDENCE_MISSING_CHECKS') {
    return reviewerMessage('reviewer.error.evidence.missingChecks');
  }
  if (payload.code === 'REVIEW_EVIDENCE_MISSING_REQUIREMENTS') {
    const missing = Array.isArray(payload.details?.missingRequirements) ? payload.details?.missingRequirements : [];
    if (!missing.length) return reviewerMessage('reviewer.error.evidence.missingRequirements');
    return reviewerMessage('reviewer.error.evidence.missingRequirementsNamed', { missing: missing.join(', ') });
  }
  if (payload.code === 'REVIEW_EVIDENCE_INVALID_CHECKS') {
    return reviewerMessage('reviewer.error.evidence.invalidChecks');
  }
  if (payload.code === 'REVIEW_EVIDENCE_INVALID_TICKET_FORMAT') {
    return reviewerMessage('reviewer.error.evidence.invalidTicketFormat');
  }
  if (payload.code === 'REVIEW_EVIDENCE_INVALID_ARTIFACT_FORMAT') {
    return reviewerMessage('reviewer.error.evidence.invalidArtifactFormat');
  }
  if (payload.code === 'REVIEW_EVIDENCE_INVALID_ARTIFACT_TYPE') {
    return reviewerMessage('reviewer.error.evidence.invalidArtifactType');
  }
  return '';
}
