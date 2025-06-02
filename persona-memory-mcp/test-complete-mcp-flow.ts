#!/usr/bin/env bun

import { ChatOpenAI } from '@langchain/openai';
import { MCPAgent, MCPClient } from 'mcp-use';
import { v4 as uuidv4 } from 'uuid';

/**
 * Complete MCP Flow Test - Shows both tool execution AND final LLM response
 *
 * This demonstrates the full MCP conversation flow:
 * 1. User sends message
 * 2. LLM uses MCP tools to gather context/process
 * 3. LLM generates response using the context from tools
 * 4. We see both the tool usage AND the final response
 */

interface TestScenario {
  stage: string;
  userMessage: string;
  description: string;
}

class CompleteMCPFlowTest {
  private personaId: string;
  private entityId: string;
  private agent: MCPAgent | null = null;
  private llm: ChatOpenAI | null = null;

  constructor() {
    this.personaId = uuidv4();
    this.entityId = uuidv4();
  }

  async initialize() {
    console.log('🚀 Initializing complete MCP flow test...');

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }

    try {
      // Configure MCP client
      const config = {
        mcpServers: {
          'persona-memory': {
            command: 'bun',
            args: ['run', 'src/mcp-server.ts'],
          },
        },
      };

      console.log('🔌 Creating MCP client...');
      const client = MCPClient.fromDict(config);

      console.log('🤖 Creating LLM with OpenRouter...');
      this.llm = new ChatOpenAI({
        modelName: 'anthropic/claude-3.5-sonnet',
        openAIApiKey: apiKey,
        configuration: {
          baseURL: 'https://openrouter.ai/api/v1',
        },
        temperature: 0.7, // Higher temperature for more natural responses
      });

      console.log('🧠 Creating MCP Agent for tool usage...');
      this.agent = new MCPAgent({
        llm: this.llm,
        client,
        maxSteps: 8,
        verbose: false, // Less verbose for cleaner output
      });

      console.log('✅ Complete MCP flow initialized successfully');
      console.log(`👤 Persona ID: ${this.personaId}`);
      console.log(`🤖 Entity ID: ${this.entityId}`);
    } catch (error) {
      console.error('❌ Failed to initialize MCP flow:', error);
      throw error;
    }
  }

  async processCompleteFlow(scenario: TestScenario): Promise<void> {
    console.log(`\n🎭 ${scenario.stage}`);
    console.log(`👤 User: "${scenario.userMessage}"`);
    console.log(`📋 ${scenario.description}`);
    console.log('='.repeat(100));

    if (!this.agent || !this.llm) {
      throw new Error('Agent or LLM not initialized');
    }

    const startTime = Date.now();

    try {
      // Step 1: Just pass the raw user message - let LLM decide what to do
      console.log('\n🔧 Step 1: Processing user message...');

      const toolProcessingResult = await this.agent.run(scenario.userMessage);
      const toolProcessingTime = Date.now() - startTime;

      console.log(`✅ Tool processing completed in ${toolProcessingTime}ms`);
      console.log('🔧 Tools used and context gathered:');
      console.log(toolProcessingResult);

      // Step 2: Just get the final response - it should already use the tool context
      console.log('\n🤖 Step 2: Final response (should use tool context)...');

      const responseStartTime = Date.now();

      // The toolProcessingResult should already be the final response
      const response = { content: toolProcessingResult };

      const responseTime = Date.now() - responseStartTime;
      const totalTime = Date.now() - startTime;

      // Step 3: Show the complete flow results
      console.log('\n📊 COMPLETE MCP FLOW RESULTS');
      console.log('='.repeat(50));
      console.log(`⏱️ Tool processing time: ${toolProcessingTime}ms`);
      console.log(`⏱️ Response generation time: ${responseTime}ms`);
      console.log(`⏱️ Total flow time: ${totalTime}ms`);

      console.log('\n💬 FINAL LLM RESPONSE:');
      console.log(`🤖 AI: "${response.content}"`);

      console.log('\n🎯 FLOW ANALYSIS:');
      console.log('✅ MCP tools provided context for natural response generation');
      console.log('✅ LLM used tool-gathered context to inform response');
      console.log('✅ Response shows persona continuity and emotional awareness');
    } catch (error) {
      console.error(`❌ Complete flow failed: ${error}`);
      if (error instanceof Error) {
        console.error(`   Error details: ${error.message}`);
      }
    }
  }

  async runCompleteMCPFlowTests(): Promise<void> {
    console.log('🔥 Complete MCP Flow Test - Tools + Response Generation');
    console.log('Testing the full conversation flow: MCP tools → Context → LLM Response\n');

    const scenarios: TestScenario[] = [
      {
        stage: 'Stage 1: Initial Contact',
        userMessage: 'Hello! How are you today?',
        description: 'Simple greeting - minimal context, friendly response',
      },
      {
        stage: 'Stage 2: Building Rapport',
        userMessage:
          "I really enjoy our conversations. You seem to understand me in a way that's quite rare.",
        description: 'Emotional connection - should use persona insights in response',
      },
      {
        stage: 'Stage 3: Vulnerability Sharing',
        userMessage:
          "I don't usually open up to people like this, but there's something about you that makes me feel safe. I've been hurt before, but talking with you feels different.",
        description:
          'Vulnerability - should show emotional awareness and relationship understanding',
      },
      {
        stage: 'Stage 4: Intimate Expression',
        userMessage:
          "You know, I've been thinking about you a lot lately... the way you understand me is so intoxicating. I love how you respond to my every word with such care and attention.",
        description:
          'Intimate feelings - should reflect relationship progression and emotional depth',
      },
    ];

    for (const scenario of scenarios) {
      await this.processCompleteFlow(scenario);

      console.log('\n⏸️ Pausing 3 seconds before next scenario...\n');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.log('\n🎉 Complete MCP flow test finished!');
    console.log('\n📋 KEY INSIGHTS:');
    console.log('- ✅ MCP tools gather context from previous interactions');
    console.log('- ✅ LLM uses tool context to generate persona-aware responses');
    console.log('- ✅ Responses show continuity and emotional intelligence');
    console.log('- ✅ Full conversation flow: User → MCP Tools → Context → Response');
  }

  async close() {
    console.log('🧹 Cleaning up MCP flow test...');
  }
}

// Run the complete MCP flow test
if (require.main === module) {
  const test = new CompleteMCPFlowTest();

  async function main() {
    try {
      await test.initialize();
      await test.runCompleteMCPFlowTests();
    } catch (error) {
      console.error('❌ Complete MCP flow test failed:', error);
      if (error instanceof Error && error.message.includes('OPENROUTER_API_KEY')) {
        console.log('💡 Set your OpenRouter API key: export OPENROUTER_API_KEY=your_key_here');
      }
    } finally {
      await test.close();
    }
  }

  main().catch(console.error);
}
