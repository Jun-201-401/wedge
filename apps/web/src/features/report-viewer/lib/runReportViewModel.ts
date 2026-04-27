export type FindingSeverity = 'high' | 'medium' | 'low';
export type DecisionNodeTone = 'friction' | 'neutral';

export interface ReportDecisionNode {
  id: string;
  code: string;
  tone: DecisionNodeTone;
  title: string;
  summary: string;
  tags: string[];
}

export interface ReportFinding {
  id: string;
  order: number;
  severity: FindingSeverity;
  issueId: string;
  stage: string;
  title: string;
  summary: string;
  evidenceLabel: string;
  evidenceCount: number;
  confidence: number;
  priorityScore: number;
  evidenceRefs: string[];
  recommendation: string;
  highlight: {
    label: string;
    top: string;
    left: string;
    width: string;
    height: string;
  };
}

export interface ReportRecommendation {
  id: string;
  priority: string;
  title: string;
  detail: string;
  expectedImpact: string;
  effort: string;
}

export interface RunReportViewModel {
  runId: string;
  reportId: string;
  targetUrl: string;
  scenarioLabel: string;
  score: number;
  issueCount: number;
  evidenceCount: number;
  totalSteps: number;
  durationLabel: string;
  completedAt: string;
  decisionNodes: ReportDecisionNode[];
  heroTitle: string;
  heroSubtitle: string;
  heroCallToAction: string;
  findings: ReportFinding[];
  recommendations: ReportRecommendation[];
}
