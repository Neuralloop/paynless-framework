import { assertEquals, assertExists, assertRejects, assertInstanceOf, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { spy, stub, type Stub } from "https://deno.land/std@0.224.0/testing/mock.ts";
import { GoogleAdapter, googleAdapter } from './google_adapter.ts';
import type { ChatApiRequest } from '../types.ts';

// --- Test Data ---
const MOCK_API_KEY = 'google-test-api-key';
const MOCK_MODEL_ID = 'google-gemini-1.5-pro-latest';
const MOCK_SYSTEM_PROMPT_GOOGLE = "Be concise and helpful.";
const MOCK_CHAT_REQUEST_GOOGLE: ChatApiRequest = {
  message: 'Explain black holes briefly.',
  providerId: 'provider-uuid-google',
  promptId: 'prompt-uuid-google-system',
  chatId: 'chat-uuid-jkl',
  messages: [
    { role: 'system', content: MOCK_SYSTEM_PROMPT_GOOGLE },
    { role: 'user', content: 'Earlier question' },
    { role: 'assistant', content: 'Earlier answer' },
  ],
};

const MOCK_GOOGLE_SUCCESS_RESPONSE = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: " A region in spacetime where gravity is so strong nothing escapes, not even light. "
          }
        ],
        role: "model"
      },
      finishReason: "STOP",
      index: 0,
      safetyRatings: [
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "NEGLIGIBLE" },
        // ... other ratings
      ]
    }
  ],
  // Google generateContent doesn't typically return usage here
  // usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 25, totalTokenCount: 35 }
};

const MOCK_GOOGLE_MODELS_RESPONSE = {
  models: [
    {
      name: "models/gemini-1.5-pro-latest",
      version: "1.5-pro-latest",
      displayName: "Gemini 1.5 Pro Latest",
      description: "The latest Gemini 1.5 Pro model.",
      inputTokenLimit: 1048576,
      outputTokenLimit: 8192,
      supportedGenerationMethods: [
        "generateContent",
        "countTokens"
      ],
      temperature: 0.9,
      topP: 1,
      topK: 1
    },
    {
      name: "models/gemini-1.0-pro",
      version: "1.0-pro",
      displayName: "Gemini 1.0 Pro",
      description: "The standard Gemini 1.0 Pro model.",
      inputTokenLimit: 30720,
      outputTokenLimit: 2048,
      supportedGenerationMethods: [
        "generateContent",
        "countTokens"
      ],
      // ... other fields
    },
    {
      name: "models/text-bison-001", // Older model, may not have generateContent
      version: "001",
      displayName: "Text Bison",
      description: "Legacy text generation model.",
      supportedGenerationMethods: [
        "generateText" // Doesn't support generateContent
      ],
      // ... other fields
    }
  ]
};

const MOCK_GOOGLE_MAX_TOKENS_RESPONSE = {
  candidates: [
    {
      content: {
        parts: [
          { text: "A region in spacetime where gravity is so strong..." } // Partial response
        ],
        role: "model"
      },
      finishReason: "MAX_TOKENS", // Different reason
      index: 0,
      safetyRatings: [ /* ... */ ]
    }
  ]
};

const MOCK_GOOGLE_OTHER_REASON_RESPONSE = {
  candidates: [
    {
      content: { parts: [{ text: "Something went wrong..." }], role: "model" },
      finishReason: "OTHER", // Different reason
      index: 0,
      safetyRatings: [ /* ... */ ]
    }
  ]
};

// Add an interface for the expected token usage structure
interface MockTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// --- Tests ---
Deno.test("GoogleAdapter sendMessage - Success", async () => {
  const mockSuccessfulGenerateContent = {
    // Using the same success response structure as before for generateContent
    candidates: MOCK_GOOGLE_SUCCESS_RESPONSE.candidates,
  };
  const mockGenericTokenCountResponse = { totalTokens: 1 }; // Generic small token count

  const mockFetch = stub(globalThis, "fetch", (input: string | URL | Request, _options?: RequestInit) => {
    const urlString = input.toString();
    if (urlString.includes(":generateContent")) {
      return Promise.resolve(
        new Response(JSON.stringify(mockSuccessfulGenerateContent), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    } else if (urlString.includes(":countTokens")) {
      return Promise.resolve(
        new Response(JSON.stringify(mockGenericTokenCountResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return Promise.reject(new Error(`Unexpected fetch call in mock: ${urlString}`));
  });

  try {
    const adapter = new GoogleAdapter();
    const result = await adapter.sendMessage(MOCK_CHAT_REQUEST_GOOGLE, MOCK_MODEL_ID, MOCK_API_KEY);

    // Assert fetch was called correctly
    assertEquals(mockFetch.calls.length, 3, "Expected 3 fetch calls (generate + 2 countTokens)");
    const fetchArgs = mockFetch.calls[0].args; // This will be the generateContent call
    const expectedUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${MOCK_API_KEY}`;
    assertEquals(fetchArgs[0], expectedUrl);
    assertEquals(fetchArgs[1]?.method, 'POST');
    assertEquals((fetchArgs[1]?.headers as Record<string, string>)['Content-Type'], 'application/json');
    const body = JSON.parse(fetchArgs[1]?.body as string);
    assertEquals(body.contents.length, 3); // History + new message
    // Check system prompt prepended to first user message
    assertEquals(body.contents[0].role, 'user');
    assert(body.contents[0].parts[0].text.includes(MOCK_SYSTEM_PROMPT_GOOGLE), 'System prompt missing from first user message');
    assert(body.contents[0].parts[0].text.includes('Earlier question'), 'Original user content missing from first user message');
    assertEquals(body.contents[1].role, 'model'); // Google uses 'model'
    assertEquals(body.contents[2].role, 'user');
    assertEquals(body.contents[2].parts[0].text, 'Explain black holes briefly.');

    // Assert result structure
    assertExists(result);
    assertEquals(result.role, 'assistant');
    assertEquals(result.content, 'A region in spacetime where gravity is so strong nothing escapes, not even light.'); // Trimmed
    assertEquals(result.ai_provider_id, MOCK_CHAT_REQUEST_GOOGLE.providerId);
    assertEquals(result.system_prompt_id, MOCK_CHAT_REQUEST_GOOGLE.promptId);
    // Token usage should now be present due to the adapter changes
    assertExists(result.token_usage, "Token usage should be present");
    const tokenUsage = result.token_usage as unknown as MockTokenUsage;
    assertEquals(typeof tokenUsage.prompt_tokens, "number");
    assertEquals(typeof tokenUsage.completion_tokens, "number");
    assertEquals(typeof tokenUsage.total_tokens, "number");
    // Specific values (e.g., 1 for prompt, 1 for completion based on mockGenericTokenCountResponse)
    assertEquals(tokenUsage.prompt_tokens, mockGenericTokenCountResponse.totalTokens);
    assertEquals(tokenUsage.completion_tokens, mockGenericTokenCountResponse.totalTokens);
    assertEquals(tokenUsage.total_tokens, mockGenericTokenCountResponse.totalTokens + mockGenericTokenCountResponse.totalTokens);

  } finally {
    mockFetch.restore();
  }
});

Deno.test("GoogleAdapter sendMessage - Success with Token Counting", async () => {
  const mockGenerateContentResponse = {
    candidates: [
      {
        content: { parts: [{ text: "Test AI response." }], role: "model" },
        finishReason: "STOP",
      },
    ],
  };
  const mockPromptTokensResponse = { totalTokens: 15 }; // Example prompt token count
  const mockCompletionTokensResponse = { totalTokens: 5 }; // Example completion token count

  const mockFetch = stub(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const urlString = input.toString();
    if (urlString.includes(":generateContent")) {
      return Promise.resolve(
        new Response(JSON.stringify(mockGenerateContentResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    } else if (urlString.includes(":countTokens")) {
      const requestBody = options?.body ? JSON.parse(options.body.toString()) : {};
      // If the request body for countTokens contains multiple 'contents' entries, assume it's for the prompt.
      // Otherwise, if it's a single entry (our adapter sends the AI response this way), assume it's for completion.
      if (requestBody.contents && Array.isArray(requestBody.contents) && requestBody.contents.length > 1) {
        return Promise.resolve(
          new Response(JSON.stringify(mockPromptTokensResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      } else {
        return Promise.resolve(
          new Response(JSON.stringify(mockCompletionTokensResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
    }
    return Promise.reject(new Error(`Unexpected fetch call: ${urlString}`));
  });

  try {
    const adapter = new GoogleAdapter();
    const result = await adapter.sendMessage(MOCK_CHAT_REQUEST_GOOGLE, MOCK_MODEL_ID, MOCK_API_KEY);

    assertEquals(mockFetch.calls.length, 3, "Expected 3 fetch calls: generateContent, countTokens (prompt), countTokens (completion)");
    
    // Check generateContent call (already well-tested in the original success test, could be simplified here)
    const generateContentCall = mockFetch.calls.find(call => call.args[0].toString().includes(":generateContent"));
    assertExists(generateContentCall, "generateContent call not found");

    // Check countTokens calls
    const countTokensCalls = mockFetch.calls.filter(call => call.args[0].toString().includes(":countTokens"));
    assertEquals(countTokensCalls.length, 2, "Expected 2 countTokens calls");

    // TODO: Add assertions for the bodies of countTokens calls if needed, to ensure the correct content is being tokenized.

    assertExists(result.token_usage, "token_usage should be present");
    const tokenUsage = result.token_usage as unknown as MockTokenUsage; // Cast to unknown first, then to the specific type
    assertEquals(tokenUsage.prompt_tokens, mockPromptTokensResponse.totalTokens, "Prompt tokens mismatch");
    assertEquals(tokenUsage.completion_tokens, mockCompletionTokensResponse.totalTokens, "Completion tokens mismatch");
    assertEquals(tokenUsage.total_tokens, mockPromptTokensResponse.totalTokens + mockCompletionTokensResponse.totalTokens, "Total tokens mismatch");

  } finally {
    mockFetch.restore();
  }
});

Deno.test("GoogleAdapter sendMessage - API Error", async () => {
  const mockFetch = stub(globalThis, "fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { code: 400, message: 'Invalid API key', status: 'INVALID_ARGUMENT' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );

  try {
    const adapter = new GoogleAdapter();
    await assertRejects(
      () => adapter.sendMessage(MOCK_CHAT_REQUEST_GOOGLE, MOCK_MODEL_ID, MOCK_API_KEY),
      Error,
      "Google Gemini API request failed: 400 - Invalid API key"
    );
  } finally {
    mockFetch.restore();
  }
});

Deno.test("GoogleAdapter sendMessage - Blocked by Safety", async () => {
  const blockedResponse = {
    candidates: [], // No candidates if blocked
    promptFeedback: {
      blockReason: "SAFETY",
      safetyRatings: [
         { category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH" }
      ]
    }
  };
  const mockFetch = stub(globalThis, "fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify(blockedResponse), {
        status: 200, // Google might return 200 even if blocked
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );

  try {
    const adapter = new GoogleAdapter();
    await assertRejects(
      () => adapter.sendMessage(MOCK_CHAT_REQUEST_GOOGLE, MOCK_MODEL_ID, MOCK_API_KEY),
      Error,
      "Request blocked by Google Gemini due to: SAFETY"
    );
  } finally {
    mockFetch.restore();
  }
});

Deno.test("GoogleAdapter sendMessage - Finish Reason MAX_TOKENS", async () => {
  const mockFetch = stub(globalThis, "fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify(MOCK_GOOGLE_MAX_TOKENS_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );

  try {
    const adapter = new GoogleAdapter();
    const result = await adapter.sendMessage(MOCK_CHAT_REQUEST_GOOGLE, MOCK_MODEL_ID, MOCK_API_KEY);

    assertExists(result);
    assertEquals(result.role, 'assistant');
    // Check that the partial content includes the specific reason message
    assertEquals(result.content, "[Response stopped due to: MAX_TOKENS]");

  } finally {
    mockFetch.restore();
  }
});

Deno.test("GoogleAdapter sendMessage - Finish Reason OTHER", async () => {
  const mockFetch = stub(globalThis, "fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify(MOCK_GOOGLE_OTHER_REASON_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );

  try {
    const adapter = new GoogleAdapter();
    const result = await adapter.sendMessage(MOCK_CHAT_REQUEST_GOOGLE, MOCK_MODEL_ID, MOCK_API_KEY);

    assertExists(result);
    assertEquals(result.role, 'assistant');
    // Check that the partial content includes the specific reason message
    assertEquals(result.content, "[Response stopped due to: OTHER]");

  } finally {
    mockFetch.restore();
  }
});

Deno.test("GoogleAdapter listModels - Success", async () => {
    const mockFetch = stub(globalThis, "fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify(MOCK_GOOGLE_MODELS_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
        const adapter = new GoogleAdapter();
        const models = await adapter.listModels(MOCK_API_KEY);

        assertEquals(mockFetch.calls.length, 1);
        const fetchArgs = mockFetch.calls[0].args;
        assertEquals(fetchArgs[0], `https://generativelanguage.googleapis.com/v1beta/models?key=${MOCK_API_KEY}`);
        assertEquals(fetchArgs[1]?.method, 'GET');

        assertEquals(models.length, 2); // text-bison filtered out
        assertEquals(models[0].api_identifier, 'google-gemini-1.5-pro-latest');
        assertEquals(models[0].name, 'Gemini 1.5 Pro Latest');
        assertEquals(models[1].api_identifier, 'google-gemini-1.0-pro');
        assertEquals(models[1].name, 'Gemini 1.0 Pro');

    } finally {
        mockFetch.restore();
    }
});

Deno.test("GoogleAdapter listModels - API Error", async () => {
    const mockFetch = stub(globalThis, "fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'API key expired' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    try {
        const adapter = new GoogleAdapter();
        await assertRejects(
            () => adapter.listModels(MOCK_API_KEY),
            Error,
            "Google Gemini API request failed fetching models: 403"
        );
    } finally {
        mockFetch.restore();
    }
});

// Test the exported instance
Deno.test("Exported googleAdapter instance exists", () => {
  assertExists(googleAdapter);
  assertInstanceOf(googleAdapter, GoogleAdapter);
}); 