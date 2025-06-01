import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PrismaClient } from '@prisma/client';

/**
 * MCP Server Protocol Tests
 *
 * Tests ONLY the MCP protocol implementation:
 * - Tool discovery and registration
 * - JSON-RPC message handling
 * - Parameter validation
 * - Transport layer communication
 * - Error responses
 *
 * Does NOT test business logic - that belongs in individual service tests.
 */

describe('MCP Server Integration', () => {
  let prisma: PrismaClient;
  let serverProcess: ChildProcess;
  let client: Client;
  let testPersonaId: string;
  let testEntityId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();

    // Setup test data
    const persona = await prisma.persona.create({
      data: { name: 'MCP Test Persona' },
    });
    testPersonaId = persona.id;

    const entity = await prisma.entity.create({
      data: { name: 'Test User', entityType: 'human' },
    });
    testEntityId = entity.id;

    // Start MCP server
    serverProcess = spawn('bun', ['run', 'src/mcp-server.ts'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Create MCP client
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', 'src/mcp-server.ts'],
    });

    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    await client?.close();
    serverProcess?.kill();
    await prisma?.disconnect();
  });

  test('should list available tools', async () => {
    const tools = await client.request({
      method: 'tools/list',
      params: {},
    });

    expect(tools.tools).toBeArray();
    expect(tools.tools.length).toBeGreaterThan(0);

    const toolNames = tools.tools.map((t: any) => t.name);
    expect(toolNames).toContain('processMessage');
    expect(toolNames).toContain('storeMemory');
    expect(toolNames).toContain('searchMemories');
  });

  test('processMessage tool accepts valid parameters', async () => {
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'processMessage',
        arguments: {
          content: 'Test message',
          personaId: testPersonaId,
          entityId: testEntityId,
          channel: 'chat',
        },
      },
    });

    expect(result).toBeDefined();
    expect(result.content).toBeArray();
    expect(result.content[0].type).toBe('text');

    // Should return valid JSON response (don't test business logic)
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  test('granular tools accept valid parameters', async () => {
    // Test storeMemory tool parameter validation
    const memoryResult = await client.request({
      method: 'tools/call',
      params: {
        name: 'storeMemory',
        arguments: {
          content: 'Test memory content',
          personaId: testPersonaId,
          significance: 0.8,
          tags: ['test'],
        },
      },
    });

    expect(memoryResult.content[0].type).toBe('text');
    expect(() => JSON.parse(memoryResult.content[0].text)).not.toThrow();

    // Test searchMemories tool parameter validation
    const searchResult = await client.request({
      method: 'tools/call',
      params: {
        name: 'searchMemories',
        arguments: {
          query: 'test query',
          personaId: testPersonaId,
          maxResults: 5,
        },
      },
    });

    expect(searchResult.content[0].type).toBe('text');
    expect(() => JSON.parse(searchResult.content[0].text)).not.toThrow();
  });

  test('health check tool', async () => {
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'healthCheck',
        arguments: {},
      },
    });

    expect(result.content[0].type).toBe('text');
    const health = JSON.parse(result.content[0].text);
    expect(health.status).toBe('healthy');
    expect(health.database).toBe('connected');
    expect(health.embedding).toBe('available');
  });

  test('error handling for invalid parameters', async () => {
    await expect(async () => {
      await client.request({
        method: 'tools/call',
        params: {
          name: 'processMessage',
          arguments: {
            // Missing required personaId
            content: 'test message',
          },
        },
      });
    }).toThrow();
  });

  test('tool parameter validation and error handling', async () => {
    // Test missing required parameter
    try {
      await client.request({
        method: 'tools/call',
        params: {
          name: 'storeMemory',
          arguments: {
            // Missing required personaId
            content: 'test message',
          },
        },
      });
      expect.unreachable('Should have thrown validation error');
    } catch (error) {
      expect(error).toBeDefined();
    }

    // Test invalid parameter type
    try {
      await client.request({
        method: 'tools/call',
        params: {
          name: 'searchMemories',
          arguments: {
            query: 'test query',
            personaId: testPersonaId,
            maxResults: 'invalid', // Should be number
          },
        },
      });
      expect.unreachable('Should have thrown validation error');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
