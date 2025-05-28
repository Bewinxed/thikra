import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type OpenAI from 'openai';
import { LLMService } from './llm.service';

// Mock OpenAI
const mockOpenAI = {
  chat: {
    completions: {
      create: mock<() => Promise<OpenAI.ChatCompletion>>(),
    },
  },
};

// Mock the OpenAI constructor
mock.module('openai', () => ({
  default: class {
    chat = mockOpenAI.chat;
    constructor(config: {
      baseURL?: string;
      apiKey?: string;
      defaultHeaders?: Record<string, string>;
    }) {
      // Verify the config is set up correctly in our tests
      expect(config.baseURL).toBeDefined();
      expect(config.apiKey).toBeDefined();
      expect(config.defaultHeaders).toBeDefined();
    }
  },
}));

describe('LLMService', () => {
  let service: LLMService;

  beforeEach(() => {
    mockOpenAI.chat.completions.create.mockClear();
    service = new LLMService();
  });

  describe('constructor', () => {
    test('should initialize with correct OpenRouter configuration', () => {
      // The constructor validation happens in the mock above
      expect(service).toBeInstanceOf(LLMService);
    });
  });

  describe('createChatCompletion', () => {
    test('should create chat completion with correct parameters', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Test response',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const params = {
        messages: [
          {
            role: 'user' as const,
            content: 'Test message',
          },
        ],
        temperature: 0.7,
      };

      const result = await service.createChatCompletion(params);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        ...params,
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307',
        stream: false,
      });
      expect(result).toEqual(mockResponse);
    });

    test('should handle stream parameter correctly', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Test response',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const params = {
        messages: [
          {
            role: 'user' as const,
            content: 'Test message',
          },
        ],
        stream: true, // This should be filtered out
      };

      await service.createChatCompletion(params);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        messages: params.messages,
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307',
        stream: false, // Should always be false
      });
    });

    test('should use custom model from environment', async () => {
      const originalModel = process.env.OPENROUTER_MODEL;
      process.env.OPENROUTER_MODEL = 'custom/test-model';

      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'custom/test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Test response',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const params = {
        messages: [
          {
            role: 'user' as const,
            content: 'Test message',
          },
        ],
      };

      await service.createChatCompletion(params);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        ...params,
        model: 'custom/test-model',
        stream: false,
      });

      // Restore original environment
      if (originalModel) {
        process.env.OPENROUTER_MODEL = originalModel;
      } else {
        process.env.OPENROUTER_MODEL = undefined;
      }
    });
  });

  describe('createJSONCompletion', () => {
    test('should create JSON completion and parse response', async () => {
      const mockJsonResponse = {
        emotion: 'joy',
        intensity: 0.8,
        confidence: 0.9,
      };

      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify(mockJsonResponse),
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: 'You are a helpful assistant.',
        },
        {
          role: 'user',
          content: 'Analyze this emotion.',
        },
      ];

      const result = await service.createJSONCompletion(messages, 0.7);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        messages,
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307',
        temperature: 0.7,
        response_format: { type: 'json_object' },
        stream: false,
      });
      expect(result).toEqual(mockJsonResponse);
    });

    test('should handle missing temperature parameter', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '{"result": "success"}',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: 'Test message',
        },
      ];

      const result = await service.createJSONCompletion(messages);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        messages,
        model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307',
        temperature: undefined,
        response_format: { type: 'json_object' },
        stream: false,
      });
      expect(result).toEqual({ result: 'success' });
    });

    test('should handle empty response content', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: 'Test message',
        },
      ];

      const result = await service.createJSONCompletion(messages);

      expect(result).toEqual({});
    });

    test('should handle malformed JSON response', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'not valid json',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: 'Test message',
        },
      ];

      // Should throw an error when JSON parsing fails
      expect(async () => {
        await service.createJSONCompletion(messages);
      }).toThrow();
    });

    test('should handle missing choices in response', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: 'Test message',
        },
      ];

      const result = await service.createJSONCompletion(messages);

      expect(result).toEqual({});
    });

    test('should work with typed generics', async () => {
      interface TestResponse {
        name: string;
        value: number;
      }

      const mockTypedResponse: TestResponse = {
        name: 'test',
        value: 42,
      };

      const mockResponse: OpenAI.ChatCompletion = {
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify(mockTypedResponse),
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse);

      const messages: OpenAI.ChatCompletionMessageParam[] = [
        {
          role: 'user',
          content: 'Generate test data',
        },
      ];

      const result = await service.createJSONCompletion<TestResponse>(messages);

      expect(result).toEqual(mockTypedResponse);
      expect(result.name).toBe('test');
      expect(result.value).toBe(42);
    });
  });
});
