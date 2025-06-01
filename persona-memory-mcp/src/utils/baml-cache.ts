import * as crypto from 'node:crypto';
import { PromptCache } from './prompt-cache';

/**
 * Centralized BAML caching utility
 * 
 * Wraps any BAML function call with automatic caching based on:
 * - Function name
 * - Arguments hash
 * - BAML schema version
 */
export class BAMLCache {
  private promptCache: PromptCache;
  private schemaVersion: string | null = null;

  constructor(cacheDir?: string) {
    this.promptCache = new PromptCache(cacheDir);
  }

  /**
   * Get BAML schema version for cache invalidation
   */
  private async getBamlSchemaVersion(): Promise<string> {
    if (this.schemaVersion) {
      return this.schemaVersion;
    }

    try {
      const fs = require('fs');
      const path = require('path');
      
      // Hash all BAML files to create a version
      const bamlDir = path.join(process.cwd(), 'baml_src');
      const files = fs.readdirSync(bamlDir).filter((f: string) => f.endsWith('.baml'));
      
      let combinedContent = '';
      for (const file of files) {
        const content = fs.readFileSync(path.join(bamlDir, file), 'utf-8');
        combinedContent += content;
      }
      
      this.schemaVersion = crypto.createHash('md5').update(combinedContent).digest('hex').substring(0, 8);
      return this.schemaVersion;
    } catch (error) {
      console.warn('Failed to get BAML schema version:', error);
      this.schemaVersion = 'default';
      return this.schemaVersion;
    }
  }

  /**
   * Create a deterministic cache key from function name and arguments
   */
  private createCacheKey(functionName: string, args: any[]): string {
    const argsString = JSON.stringify(args, (key, value) => {
      // Sort object keys for consistent hashing
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce((sorted: any, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
      }
      return value;
    });
    
    const hash = crypto.createHash('md5').update(argsString).digest('hex').substring(0, 8);
    return `${functionName}_${hash}`;
  }

  /**
   * Cached BAML function call
   * 
   * @param functionName Name of the BAML function (for cache key)
   * @param args Arguments passed to the BAML function
   * @param bamlFn The actual BAML function to call if cache misses
   * @returns Promise resolving to the BAML function result
   */
  async call<T>(
    functionName: string,
    args: any[],
    bamlFn: () => Promise<T>
  ): Promise<T> {
    const schemaVersion = await this.getBamlSchemaVersion();
    
    // Create human-readable prompt content for cache storage
    const promptContent = `Function: ${functionName}\nArguments: ${JSON.stringify(args, null, 2)}`;
    
    // Try cache first
    const cached = await this.promptCache.load(functionName, promptContent, schemaVersion);
    if (cached) {
      console.log(`[BAML Cache] HIT: ${functionName}`);
      return JSON.parse(cached.response) as T;
    }

    // Cache miss - call BAML
    console.log(`[BAML Cache] MISS: ${functionName} - calling LLM...`);
    const startTime = Date.now();
    
    try {
      const result = await bamlFn();
      const duration = Date.now() - startTime;
      
      // Store in cache using actual prompt content, not cache key
      await this.promptCache.store(
        functionName,
        promptContent,
        result,
        { duration },
        schemaVersion
      );
      
      console.log(`[BAML Cache] STORED: ${functionName} (${duration}ms)`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`[BAML Cache] ERROR: ${functionName} (${duration}ms) - ${error}`);
      throw error;
    }
  }

  /**
   * Convenience method for single-argument BAML functions
   */
  async callSingle<T>(
    functionName: string,
    arg: any,
    bamlFn: () => Promise<T>
  ): Promise<T> {
    return this.call(functionName, [arg], bamlFn);
  }

  /**
   * Clear cache for specific function or all functions
   */
  async clearCache(functionName?: string): Promise<void> {
    if (functionName) {
      // This would require implementing selective clearing in PromptCache
      console.warn('Selective cache clearing not implemented yet');
    } else {
      // Clear all - this would require implementing in PromptCache
      console.warn('Full cache clearing not implemented yet');
    }
  }
}

// Singleton instance for easy import
export const bamlCache = new BAMLCache();