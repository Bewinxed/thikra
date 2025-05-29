import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

interface PromptCacheEntry {
  timestamp: string;
  functionName: string;
  prompt: string;
  response: string;
  metadata?: {
    model?: string;
    tokens?: { input?: number; output?: number };
    duration?: number;
  };
}

export class PromptCache {
  private cacheDir: string;

  constructor(cacheDir = './prompt-cache') {
    this.cacheDir = cacheDir;
  }

  /**
   * Initialize cache directory if it doesn't exist
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create prompt cache directory:', error);
    }
  }

  /**
   * Generate a deterministic filename based on function name and content hash
   * Include BAML schema version to invalidate cache when prompts change
   */
  private generateFilename(functionName: string, prompt: string, schemaVersion?: string): string {
    // Include schema version in hash to invalidate cache when BAML prompts change
    const contentToHash = schemaVersion ? `${schemaVersion}:${prompt}` : prompt;
    const hash = crypto.createHash('md5').update(contentToHash).digest('hex').substring(0, 8);
    return `${functionName}_${hash}.md`;
  }

  /**
   * Store a prompt/response pair
   */
  async store(
    functionName: string,
    prompt: string,
    response: any,
    metadata?: PromptCacheEntry['metadata'],
    schemaVersion?: string,
  ): Promise<string> {
    await this.init();

    const filename = this.generateFilename(functionName, prompt, schemaVersion);
    const filepath = path.join(this.cacheDir, filename);

    // Check if file already exists - if so, don't overwrite
    try {
      await fs.access(filepath);
      return filepath; // File exists, return existing path
    } catch {
      // File doesn't exist, create it
    }

    const entry: PromptCacheEntry = {
      timestamp: new Date().toISOString(),
      functionName,
      prompt,
      response: typeof response === 'string' ? response : JSON.stringify(response, null, 2),
      metadata,
    };

    const content = this.formatEntry(entry);

    try {
      await fs.writeFile(filepath, content, 'utf-8');
      return filepath;
    } catch (error) {
      console.error('Failed to write prompt cache entry:', error);
      throw error;
    }
  }

  /**
   * Format entry as readable markdown
   */
  private formatEntry(entry: PromptCacheEntry): string {
    let content = `# ${entry.functionName}\n\n`;
    content += `**Timestamp:** ${entry.timestamp}\n\n`;

    if (entry.metadata) {
      content += `## Metadata\n\n`;
      if (entry.metadata.model) content += `- **Model:** ${entry.metadata.model}\n`;
      if (entry.metadata.tokens) {
        content += `- **Tokens:** ${entry.metadata.tokens.input || 0} in / ${entry.metadata.tokens.output || 0} out\n`;
      }
      if (entry.metadata.duration) {
        content += `- **Duration:** ${entry.metadata.duration}ms\n`;
      }
      content += '\n';
    }

    content += `## Prompt\n\n\`\`\`\n${entry.prompt}\n\`\`\`\n\n`;
    content += `## Response\n\n\`\`\`json\n${entry.response}\n\`\`\`\n`;

    return content;
  }

  /**
   * Load a cached prompt/response pair
   */
  async load(functionName: string, prompt: string, schemaVersion?: string): Promise<PromptCacheEntry | null> {
    await this.init();

    const filename = this.generateFilename(functionName, prompt, schemaVersion);
    const filepath = path.join(this.cacheDir, filename);

    try {
      const content = await fs.readFile(filepath, 'utf-8');

      // Parse the markdown file to extract the JSON response
      const responseMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (!responseMatch || !responseMatch[1]) {
        return null;
      }

      const response = JSON.parse(responseMatch[1]);
      console.log(`[PromptCache] Cache hit for ${functionName}`);

      return {
        timestamp: new Date().toISOString(),
        functionName,
        prompt,
        response: responseMatch[1],
      };
    } catch (error) {
      // Cache miss is normal, not an error
      if ((error as any).code !== 'ENOENT') {
        console.error('Failed to load prompt cache entry:', error);
      }
      return null;
    }
  }

  /**
   * List all cached entries
   */
  async list(): Promise<string[]> {
    await this.init();

    try {
      const files = await fs.readdir(this.cacheDir);
      return files.filter((f) => f.endsWith('.md')).sort();
    } catch (error) {
      console.error('Failed to list prompt cache entries:', error);
      return [];
    }
  }

  /**
   * Read a specific cache entry
   */
  async read(filename: string): Promise<string | null> {
    const filepath = path.join(this.cacheDir, filename);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      return content;
    } catch (error) {
      console.error('Failed to read prompt cache entry:', error);
      return null;
    }
  }

  /**
   * Clear old cache entries (optional)
   */
  async clearOlderThan(days: number): Promise<number> {
    const files = await this.list();
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const file of files) {
      const filepath = path.join(this.cacheDir, file);
      try {
        const stats = await fs.stat(filepath);
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filepath);
          removed++;
        }
      } catch (error) {
        console.error(`Failed to remove old cache entry ${file}:`, error);
      }
    }

    return removed;
  }
}

// Singleton instance
export const promptCache = new PromptCache();
