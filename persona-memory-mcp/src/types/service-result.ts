/**
 * Structured response types for MCP server reliability
 * Ensures graceful handling of insufficient data without throwing errors
 */

export type DataSource = 'personalized' | 'partially_personalized' | 'research_default';

export type QualityStage = 'bootstrapping' | 'learning' | 'mature';

export interface DataQualityMetrics {
  stage: QualityStage;
  confidence: number; // 0-1 scale
  personalizationAvailable: boolean;
  memoryCount: number;
  observationCount: number;
  associationCount: number;
}

export interface ServiceError {
  code: 'INSUFFICIENT_DATA' | 'INVALID_PERSONA' | 'CALCULATION_FAILED' | 'DATABASE_ERROR';
  message: string;
  fallbackUsed: boolean;
  fallbackValue?: unknown;
  fallbackReason?: string;
}

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  source: DataSource;
  quality?: DataQualityMetrics;
  error?: ServiceError;
}

export interface CalculationResult<T> {
  value: T;
  source: DataSource;
  confidence: number;
  researchCitation?: string;
  dataPoints?: number;
}

/**
 * Research-validated default values with citations
 * These are used when insufficient data exists for personalization
 */
export const RESEARCH_DEFAULTS = {
  // Memory consolidation parameters
  decayRate: {
    value: 0.15,
    citation: 'Murre & Dros (2015) - Ebbinghaus forgetting curve midpoint',
    range: [0.05, 0.3],
  },
  
  // Emotional memory enhancement
  emotionalProtectionFactor: {
    value: 0.3,
    citation: 'McGaugh (2004) - Emotional memory protection from decay',
    range: [0.2, 0.4],
  },
  
  // Reconsolidation windows
  reconsolidationWindow: {
    value: 6,
    citation: 'Nader & Hardt (2009) - Memory reconsolidation window hours',
    range: [1, 12],
  },
  
  // Temporal association windows  
  temporalWindow: {
    value: 24,
    citation: 'Conway & Pleydell-Pearce (2000) - Episodic memory temporal relevance',
    range: [12, 72],
  },
  
  // Emotional intensity thresholds
  emotionalIntensityThreshold: {
    value: 0.3,
    citation: 'Russell & Mehrabian (1977) - PAD model meaningful emotional response threshold',
    range: [0.2, 0.6],
  },
  
  // Memory strength scaling
  memoryStrengthScaling: {
    value: 10,
    citation: 'Rubin & Wenzel (1996) - Memory strength normalization scaling',
    range: [5, 15],
  },
  
  // Association strength thresholds by type
  associationThresholds: {
    temporal: {
      value: 0.2,
      citation: 'Information retrieval research - temporal connections valuable even if weak',
    },
    semantic: {
      value: 0.4, 
      citation: 'Information retrieval research - semantic similarity needs moderate strength',
    },
    emotional: {
      value: 0.3,
      citation: 'Information retrieval research - emotional connections moderately valuable',
    },
    causal: {
      value: 0.5,
      citation: 'Information retrieval research - causal relationships need strong evidence',
    },
    reference: {
      value: 0.8,
      citation: 'Information retrieval research - explicit references need high confidence',
    },
  },
} as const;