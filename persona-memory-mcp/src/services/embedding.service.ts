/**
 * Embedding Service using HuggingFace Text Embeddings Inference
 * High-quality embeddings for persona memory preservation
 */

import { z } from 'zod';

// Configuration
const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://localhost:8765';
const EMBEDDING_DIMENSION = 768; // all-mpnet-base-v2 dimensions

// Response schemas - TEI returns array of arrays even for single inputs
const EmbeddingResponseSchema = z.array(z.array(z.number()));
const BatchEmbeddingResponseSchema = z.array(z.array(z.number()));

// Type exports for use throughout the codebase
export type Embedding = number[];
export type EmbeddingVector = Embedding; // Alias for clarity

export interface EmbeddingServiceConfig {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export class EmbeddingService {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: EmbeddingServiceConfig = {}) {
    this.baseUrl = config.baseUrl || EMBEDDING_SERVICE_URL;
    this.timeout = config.timeout || 30000; // 30 seconds
    this.maxRetries = config.maxRetries || 3;
  }

  /**
   * Get embedding dimension for vector setup
   */
  static get dimension(): number {
    return EMBEDDING_DIMENSION;
  }

  /**
   * Check if the embedding service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<Embedding> {
    return this.withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: text }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`Embedding service error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const parsed = EmbeddingResponseSchema.parse(data);
      const embedding = parsed[0];
      if (!embedding) {
        throw new Error('No embedding returned from service');
      }
      return embedding; // Return first (and only) embedding from the array
    });
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) {
      return [];
    }

    return this.withRetry(async () => {
      const response = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: texts }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`Embedding service error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return BatchEmbeddingResponseSchema.parse(data);
    });
  }

  /**
   * Convert embedding array to PostgreSQL vector format
   */
  static formatVectorForPg(embedding: Embedding): string {
    return `[${embedding.join(',')}]`;
  }

  /**
   * Validate embedding has correct dimensions for our model
   */
  static validateEmbedding(embedding: Embedding): void {
    const expectedDimensions = 768; // nomic-embed-text-v1
    if (embedding.length !== expectedDimensions) {
      throw new Error(
        `Invalid embedding dimensions: expected ${expectedDimensions}, got ${embedding.length}`,
      );
    }
  }

  /**
   * Retry logic for resilience
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (error instanceof Error && error.message.includes('4')) {
          throw error;
        }

        // Exponential backoff
        if (i < this.maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2 ** i * 1000));
        }
      }
    }

    throw lastError || new Error('Unknown error in embedding service');
  }
}

// Export singleton instance
export const embeddingService = new EmbeddingService();
