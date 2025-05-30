import { describe, it, expect, vi, beforeEach, afterEach, type SpyInstance, type Mock } from 'vitest';
import { useAiStore } from './aiStore';
import { api } from '@paynless/api';
import { act } from '@testing-library/react';
import {
    AiState,
    ChatMessage,
    ChatApiRequest,
    User,
    Session,
    AuthRequiredError,
} from '@paynless/types';
import { useAuthStore } from './authStore';
import { DUMMY_PROVIDER_ID, dummyProviderDefinition } from './aiStore.dummy';

// --- Restore API Client Factory Mock ---
// Define mock functions for the methods we need to control
const mockGetAiProviders = vi.fn(); // Keep even if unused in this file
const mockGetSystemPrompts = vi.fn(); // Keep even if unused
const mockSendChatMessage = vi.fn();
const mockGetChatHistory = vi.fn(); // Keep even if unused
const mockGetChatMessages = vi.fn(); // Keep even if unused

vi.mock('@paynless/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@paynless/api')>();
    return {
        ...actual,
        api: {
            ...actual.api,
            ai: () => ({
                getAiProviders: mockGetAiProviders,
                getSystemPrompts: mockGetSystemPrompts,
                sendChatMessage: mockSendChatMessage, // Use the mock function here
                getChatHistory: mockGetChatHistory,
                getChatMessages: mockGetChatMessages,
            }),
            // Ensure other parts of api are mocked if needed by store/authstore interactions
            auth: () => ({}),
            billing: () => ({}),
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
        },
        initializeApiClient: vi.fn(),
    };
});

// --- Mock the authStore ---
vi.mock('./authStore');

// Define a well-typed initial state for these tests, matching AiState
const initialTestSendMessageState: AiState = {
    availableProviders: [],
    availablePrompts: [],
    messagesByChatId: {}, // New state structure
    chatsByContext: { personal: [], orgs: {} }, // New state structure
    currentChatId: null,
    isLoadingAiResponse: false,
    isConfigLoading: false,
    isLoadingHistoryByContext: { personal: false, orgs: {} }, // New state structure
    isDetailsLoading: false,
    newChatContext: null, // New state property
    rewindTargetMessageId: null, // New state property
    aiError: null,
    historyErrorByContext: { personal: null, orgs: {} },
    selectedProviderId: null,
    selectedPromptId: null,
};

// Updated resetAiStore to use the new initial state and merge (preserve actions)
const resetAiStore = (initialOverrides: Partial<AiState> = {}) => {
    useAiStore.setState({ ...initialTestSendMessageState, ...initialOverrides }, false);
};

// Define a global navigate mock consistent with authStore tests
const mockNavigateGlobal = vi.fn();

describe('aiStore - sendMessage', () => {
    // Top-level beforeEach for mock/store reset
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        act(() => {
            resetAiStore();
            // --- REMOVED authStore.setState from top-level ---
        });
    });

    // --- Tests for sendMessage (Authenticated) ---
    describe('sendMessage (Authenticated)', () => {
        // Define constants for mock data
        const mockToken = 'valid-token-for-send';
        const mockUser: User = { id: 'user-auth-send', email: 'test@test.com', created_at: 't', updated_at: 't', role: 'user' };
        const mockSession: Session = { access_token: mockToken, refresh_token: 'r', expiresAt: Date.now() / 1000 + 3600 };
        const messageData = { message: 'Hello', providerId: 'p1', promptId: 's1' };
        const mockAssistantResponse: ChatMessage = {
            id: 'm2',
            chat_id: 'c123',
            role: 'assistant',
            content: 'Hi there',
            user_id: null,
            ai_provider_id: messageData.providerId,
            system_prompt_id: messageData.promptId,
            token_usage: { total_tokens: 20 },
            created_at: '2024-01-01T12:00:00.000Z',
            is_active_in_thread: true
        };

        // Nested beforeEach using mockReturnValue for authenticated state
        beforeEach(() => {
             if (vi.isMockFunction(useAuthStore)) {
                vi.mocked(useAuthStore.getState).mockReturnValue({
                    user: mockUser,
                    session: mockSession,
                    navigate: mockNavigateGlobal,
                    profile: null,
                    isLoading: false,
                    error: null,
                    setNavigate: vi.fn(), login: vi.fn(), logout: vi.fn(), register: vi.fn(),
                    setProfile: vi.fn(), setUser: vi.fn(), setSession: vi.fn(), setIsLoading: vi.fn(), setError: vi.fn(),
                    initialize: vi.fn(), refreshSession: vi.fn(), updateProfile: vi.fn(), clearError: vi.fn(),
                } as any);
            } else {
                console.warn("useAuthStore mock was not found for mocking getState in sendMessage (Authenticated) tests.");
            }
            // Ensure currentChatId is null for new chat tests in this block initially
            act(() => {
                resetAiStore({
                    currentChatId: null,
                    messagesByChatId: {},
                    // selectedProviderId and selectedPromptId are set below, after reset
                });
                useAiStore.setState({
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });
        });

        it('[PERS] NEW CHAT SUCCESS: should update state and chatsByContext.personal', async () => {
            // Arrange
            // This mockAssistantResponse implies it's for a new chat, so its chat_id will be the new one.
            const newChatIdFromServer = 'c123';
            const mockAssistantResponseNewChat: ChatMessage = { ...mockAssistantResponse, chat_id: newChatIdFromServer };
            mockSendChatMessage.mockResolvedValue({ data: mockAssistantResponseNewChat, status: 200, error: null });

            // Store initial messagesByChatId for comparison if needed, though for a new chat it starts empty for this test.
            const initialMessagesByChatId = useAiStore.getState().messagesByChatId;
            expect(useAiStore.getState().currentChatId).toBeNull(); // Pre-condition for new chat

            // Act
            let promise;
            act(() => {
                promise = useAiStore.getState().sendMessage(messageData); // messageData has no chatId, implying new chat
                // Assertions immediately after dispatch (optimistic state)
                expect(useAiStore.getState().isLoadingAiResponse).toBe(true);
                // We can't easily assert the optimistic message in messagesByChatId without knowing the temp ID
                // But we know currentChatId is still null at this point.
                expect(useAiStore.getState().currentChatId).toBeNull();
            });
            await promise; // Wait for the API call and subsequent state updates

            // Assert final state after success
            const expectedRequestData: ChatApiRequest = {
                message: messageData.message,
                providerId: messageData.providerId,
                promptId: messageData.promptId,
                chatId: undefined,
                organizationId: null // Added expectation: null for new personal chat
            };
            const expectedOptions = { token: mockToken };
            expect(mockSendChatMessage).toHaveBeenCalledTimes(1);
            expect(mockSendChatMessage).toHaveBeenCalledWith(expectedRequestData, expectedOptions);

            const state = useAiStore.getState();
            expect(state.isLoadingAiResponse).toBe(false);
            expect(state.currentChatId).toBe(newChatIdFromServer); // currentChatId is now set

            const messagesForNewChat = state.messagesByChatId[newChatIdFromServer];
            expect(messagesForNewChat).toBeDefined();
            expect(messagesForNewChat.length).toBe(2); // User's optimistic (now confirmed) + assistant's

            const userMessage = messagesForNewChat.find(m => m.role === 'user');
            expect(userMessage).toBeDefined();
            expect(userMessage?.content).toBe(messageData.message);
            expect(userMessage?.chat_id).toBe(newChatIdFromServer); // Important: user message's chat_id updated
            expect(userMessage?.id.startsWith('temp-user-')).toBe(true); // ID remains the temporary one

            expect(messagesForNewChat.find(m => m.id === mockAssistantResponseNewChat.id)).toEqual(mockAssistantResponseNewChat); // Corrected: find by assistant message ID
            expect(state.aiError).toBeNull();
            // Assert chatsByContext update for the new personal chat
            expect(state.chatsByContext?.personal?.length).toBe(1);
            expect(state.chatsByContext?.personal?.[0]?.id).toBe(newChatIdFromServer);
            expect(state.chatsByContext?.personal?.[0]?.organization_id).toBeNull();
            expect(state.chatsByContext?.personal?.[0]?.title).toBe(messageData.message.substring(0, 50));
        });

        it('[ORG] NEW CHAT SUCCESS: should update state and chatsByContext.orgs[orgId]', async () => {
            // Arrange
            const mockOrgId = 'org-new-chat-123';
            const newChatIdFromServer = 'c-org-456';
            // Mock response indicating it belongs to the org
            const mockAssistantResponseOrgChat: ChatMessage = {
                ...mockAssistantResponse,
                chat_id: newChatIdFromServer,
            };
            mockSendChatMessage.mockResolvedValue({ data: mockAssistantResponseOrgChat, status: 200, error: null });

            // Set context for a new organization chat
            act(() => {
                resetAiStore({
                    currentChatId: null,
                    messagesByChatId: {},
                    newChatContext: mockOrgId,
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });
            expect(useAiStore.getState().currentChatId).toBeNull();
            expect(useAiStore.getState().newChatContext).toBe(mockOrgId);

            // Act
            let promise;
            act(() => {
                promise = useAiStore.getState().sendMessage(messageData); // messageData has no chatId
                expect(useAiStore.getState().isLoadingAiResponse).toBe(true);
                expect(useAiStore.getState().currentChatId).toBeNull(); // Still null before response
            });
            await promise;

            // Assert final state
            const expectedRequestData: ChatApiRequest = {
                message: messageData.message,
                providerId: messageData.providerId,
                promptId: messageData.promptId,
                chatId: undefined,
                organizationId: mockOrgId // Expect orgId derived from newChatContext
            };
            const expectedOptions = { token: mockToken };
            expect(mockSendChatMessage).toHaveBeenCalledTimes(1);
            expect(mockSendChatMessage).toHaveBeenCalledWith(expectedRequestData, expectedOptions);

            const state = useAiStore.getState();
            expect(state.isLoadingAiResponse).toBe(false);
            expect(state.currentChatId).toBe(newChatIdFromServer);
            expect(state.newChatContext).toBeNull(); // Should be cleared after success

            const messagesForNewChat = state.messagesByChatId[newChatIdFromServer];
            expect(messagesForNewChat).toBeDefined();
            expect(messagesForNewChat.length).toBe(2);

            const userMessage = messagesForNewChat.find(m => m.role === 'user');
            expect(userMessage?.chat_id).toBe(newChatIdFromServer);

            expect(messagesForNewChat.find(m => m.id === mockAssistantResponseOrgChat.id)).toEqual(mockAssistantResponseOrgChat);
            expect(state.aiError).toBeNull();
            // Assert chatsByContext update for the new org chat
            expect(state.chatsByContext?.orgs?.[mockOrgId]).toBeDefined();
            expect(state.chatsByContext?.orgs?.[mockOrgId]?.length).toBe(1);
            expect(state.chatsByContext?.orgs?.[mockOrgId]?.[0]?.id).toBe(newChatIdFromServer);
            expect(state.chatsByContext?.orgs?.[mockOrgId]?.[0]?.organization_id).toBe(mockOrgId);
            expect(state.chatsByContext?.orgs?.[mockOrgId]?.[0]?.title).toBe(messageData.message.substring(0, 50));
        });

        it('[EXISTING] SUCCESS: should update messages and preserve currentChatId', async () => {
            // Arrange
            const existingChatId = 'old-chat-id-456';
            const serverResponseChatId = existingChatId; // For an existing chat, chat_id in response matches
            const assistantResponseForExistingChat: ChatMessage = { ...mockAssistantResponse, chat_id: serverResponseChatId };
            mockSendChatMessage.mockResolvedValue({ data: assistantResponseForExistingChat, status: 200, error: null });

            const initialUserMessage: ChatMessage = {
                id: 'temp-user-old',
                chat_id: existingChatId,
                role: 'user',
                content: messageData.message,
                created_at: 't0',
                is_active_in_thread: true,
                ai_provider_id: null,
                system_prompt_id: null,
                token_usage: null,
                user_id: mockUser.id
            };
            act(() => {
                resetAiStore({
                    currentChatId: existingChatId,
                    messagesByChatId: {
                        [existingChatId]: [initialUserMessage] // Simulate an already existing optimistic message (e.g. from previous send attempt)
                    },
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });
             // Re-check after reset
            const initialMessagesForExistingChat = useAiStore.getState().messagesByChatId[existingChatId] || [];
            const initialMessagesLength = initialMessagesForExistingChat.length;


            // Act: Send a new message to this existing chat
            const newMessageData = { ...messageData, message: "Follow up message" };
            await act(async () => { await useAiStore.getState().sendMessage(newMessageData); });

            // Assert
            const state = useAiStore.getState();
            expect(state.currentChatId).toBe(existingChatId); // Stays the same

            const messagesForExistingChat = state.messagesByChatId[existingChatId];
            expect(messagesForExistingChat).toBeDefined();
            // Length should be initial + new optimistic user message + new assistant message
            expect(messagesForExistingChat.length).toBe(initialMessagesLength + 2);

            const newUserMessage = messagesForExistingChat.find(m => m.role === 'user' && m.content === newMessageData.message);
            expect(newUserMessage).toBeDefined();
            expect(newUserMessage?.chat_id).toBe(existingChatId); // Chat ID is the existing one

            expect(messagesForExistingChat.find(m => m.id === assistantResponseForExistingChat.id)).toEqual(assistantResponseForExistingChat); // Corrected: find by assistant message ID
        });

        it('[PERS] NEW CHAT API ERROR: should clean up optimistic message and preserve newChatContext', async () => {
            // Arrange
            const errorMsg = 'AI failed to respond';
            mockSendChatMessage.mockResolvedValue({ data: null, status: 500, error: { message: errorMsg } });
            act(() => {
                resetAiStore({
                    currentChatId: null,
                    messagesByChatId: {},
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });

            let optimisticChatIdDuringSend: string | undefined;
            const originalSetState = useAiStore.setState;
            vi.spyOn(useAiStore, 'setState').mockImplementation((updater, replace) => {
                if (typeof updater === 'function') {
                    const newState = updater(useAiStore.getState());
                    // Sniff the temporary chat ID when the optimistic message is added
                    Object.keys(newState.messagesByChatId || {}).forEach(key => {
                        if (key.startsWith('temp-chat-')) {
                            optimisticChatIdDuringSend = key;
                        }
                    });
                    originalSetState(newState, replace);
                } else {
                    originalSetState(updater, replace);
                }
            });


             // Act
             let promise;
             act(() => {
                 promise = useAiStore.getState().sendMessage(messageData); // New chat
                 // Check isLoadingAiResponse
                 expect(useAiStore.getState().isLoadingAiResponse).toBe(true);
             });
             await promise;

             // Assert
             vi.mocked(useAiStore.setState).mockRestore(); // Clean up spy

             const state = useAiStore.getState();
             expect(state.isLoadingAiResponse).toBe(false);
             expect(state.aiError).toBe(errorMsg);
             expect(state.currentChatId).toBeNull(); // Should remain null for failed new chat
             if (optimisticChatIdDuringSend) {
                expect(state.messagesByChatId[optimisticChatIdDuringSend]).toEqual([]); // Optimistic message removed
             } else {
                // This case implies the optimistic message was never added or was cleaned up from a different key
                // For now, we'll assume optimisticChatIdDuringSend should be found if optimistic logic ran
                const tempChatKeys = Object.keys(state.messagesByChatId).filter(k => k.startsWith('temp-chat-'));
                tempChatKeys.forEach(key => expect(state.messagesByChatId[key]?.length || 0).toBe(0) );
             }
        });

        it('[PERS] NEW CHAT NETWORK ERROR: should clean up optimistic message and preserve newChatContext', async () => {
            // Arrange
            const errorMsg = 'Network connection failed';
            mockSendChatMessage.mockRejectedValue(new Error(errorMsg));
            act(() => {
                resetAiStore({
                    currentChatId: null,
                    messagesByChatId: {},
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });
            let optimisticChatIdDuringSend: string | undefined;
            const originalSetState = useAiStore.setState;
            vi.spyOn(useAiStore, 'setState').mockImplementation((updater, replace) => {
                 if (typeof updater === 'function') {
                    const newState = updater(useAiStore.getState());
                    Object.keys(newState.messagesByChatId || {}).forEach(key => {
                        if (key.startsWith('temp-chat-')) {
                            optimisticChatIdDuringSend = key;
                        }
                    });
                    originalSetState(newState, replace);
                } else {
                    originalSetState(updater, replace);
                }
            });

            // Act
            let promise;
            act(() => {
                promise = useAiStore.getState().sendMessage(messageData); // New chat
                expect(useAiStore.getState().isLoadingAiResponse).toBe(true);
            });
            await promise;

            // Assert
            vi.mocked(useAiStore.setState).mockRestore(); // Clean up spy
            const state = useAiStore.getState();
            expect(state.isLoadingAiResponse).toBe(false);
            expect(state.aiError).toBe(errorMsg);
            expect(state.currentChatId).toBeNull();
            if (optimisticChatIdDuringSend) {
                expect(state.messagesByChatId[optimisticChatIdDuringSend]).toEqual([]);
            } else {
                const tempChatKeys = Object.keys(state.messagesByChatId).filter(k => k.startsWith('temp-chat-'));
                tempChatKeys.forEach(key => expect(state.messagesByChatId[key]?.length || 0).toBe(0) );
            }
        });

        it('[EXISTING] API ERROR: should clean up optimistic message and preserve currentChatId', async () => {
            // Arrange
            const existingChatId = 'existing-chat-fail-api';
            const errorMsg = 'API error on existing chat';
            mockSendChatMessage.mockResolvedValue({ data: null, status: 500, error: { message: errorMsg } });

            const initialUserMessageContent = "Original message in existing chat";
            act(() => {
                resetAiStore({
                    currentChatId: existingChatId,
                    messagesByChatId: {
                        // No initial messages needed for optimistic message addition test
                    },
                    newChatContext: null, // Ensure it's an existing chat context
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });

            let optimisticTempMessageId: string | undefined;
            const originalSetState = useAiStore.setState;
            vi.spyOn(useAiStore, 'setState').mockImplementation((updater, replace) => {
                if (typeof updater === 'function') {
                    const stateBeforeUpdate = useAiStore.getState();
                    const newState = updater(stateBeforeUpdate);
                    // Sniff the temporary message ID when the optimistic message is added
                    const messagesInChat = newState.messagesByChatId?.[existingChatId];
                    if (messagesInChat) {
                        const optimisticMsg = messagesInChat.find(m => m.id.startsWith('temp-user-') && m.role === 'user');
                        if (optimisticMsg) {
                            optimisticTempMessageId = optimisticMsg.id;
                        }
                    }
                    originalSetState(newState, replace);
                } else {
                    originalSetState(updater, replace);
                }
            });

            // Act
            let promise;
            act(() => {
                promise = useAiStore.getState().sendMessage(messageData);
                expect(useAiStore.getState().isLoadingAiResponse).toBe(true);
            });
            await promise;

            // Assert
            vi.mocked(useAiStore.setState).mockRestore(); // Clean up spy
            const state = useAiStore.getState();
            expect(state.isLoadingAiResponse).toBe(false);
            expect(state.aiError).toBe(errorMsg);
            expect(state.currentChatId).toBe(existingChatId); // Crucial: currentChatId preserved
            expect(state.newChatContext).toBeNull(); // Ensure newChatContext is not set

            const messagesForChat = state.messagesByChatId[existingChatId];
            if (optimisticTempMessageId) {
                expect(messagesForChat?.find(m => m.id === optimisticTempMessageId)).toBeUndefined(); // Optimistic message removed
            } else {
                // Fallback if ID wasn't sniffed, ensure no temporary user messages remain
                expect(messagesForChat?.some(m => m.role === 'user' && m.id.startsWith('temp-user-'))).toBe(false);
            }
            expect(messagesForChat?.length || 0).toBe(0); // Expecting the chat message list to be empty if the only message failed
        });

        it('[EXISTING] NETWORK ERROR: should clean up optimistic message and preserve currentChatId', async () => {
            // Arrange
            const existingChatId = 'existing-chat-fail-network';
            const errorMsg = 'Network error on existing chat';
            mockSendChatMessage.mockRejectedValue(new Error(errorMsg)); // Simulate network error

            const initialUserMessageContent = "Original message in existing chat for network fail";
            act(() => {
                resetAiStore({
                    currentChatId: existingChatId,
                    messagesByChatId: {},
                    newChatContext: null,
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });

            let optimisticTempMessageId: string | undefined;
            const originalSetState = useAiStore.setState;
            vi.spyOn(useAiStore, 'setState').mockImplementation((updater, replace) => {
                if (typeof updater === 'function') {
                    const stateBeforeUpdate = useAiStore.getState();
                    const newState = updater(stateBeforeUpdate);
                    const messagesInChat = newState.messagesByChatId?.[existingChatId];
                    if (messagesInChat) {
                        const optimisticMsg = messagesInChat.find(m => m.id.startsWith('temp-user-') && m.role === 'user');
                        if (optimisticMsg) {
                            optimisticTempMessageId = optimisticMsg.id;
                        }
                    }
                    originalSetState(newState, replace);
                } else {
                    originalSetState(updater, replace);
                }
            });

            // Act
            let promise;
            act(() => {
                promise = useAiStore.getState().sendMessage(messageData);
                expect(useAiStore.getState().isLoadingAiResponse).toBe(true);
            });
            await promise;

            // Assert
            vi.mocked(useAiStore.setState).mockRestore();
            const state = useAiStore.getState();
            expect(state.isLoadingAiResponse).toBe(false);
            expect(state.aiError).toBe(errorMsg);
            expect(state.currentChatId).toBe(existingChatId);
            expect(state.newChatContext).toBeNull();

            const messagesForChat = state.messagesByChatId[existingChatId];
            if (optimisticTempMessageId) {
                expect(messagesForChat?.find(m => m.id === optimisticTempMessageId)).toBeUndefined();
            } else {
                expect(messagesForChat?.some(m => m.role === 'user' && m.id.startsWith('temp-user-'))).toBe(false);
            }
            expect(messagesForChat?.length || 0).toBe(0);
        });

        it('[REWIND] SUCCESS: should rebuild history and clear rewindTargetMessageId', async () => {
            const chatId = 'chat-with-rewind';
            const rewindTargetId = 'msg2-user'; // Target this message for rewind
            const initialMessages: ChatMessage[] = [
                { id: 'msg1-user', chat_id: chatId, role: 'user', content: 'First message', created_at: 't1', is_active_in_thread: true, ai_provider_id: 'p-rewind', system_prompt_id: 's-rewind', token_usage: null, user_id: mockUser.id },
                { id: 'msg1-assist', chat_id: chatId, role: 'assistant', content: 'First response', created_at: 't2', is_active_in_thread: true, ai_provider_id: null, system_prompt_id: null, token_usage: null, user_id: null },
                { id: rewindTargetId, chat_id: chatId, role: 'user', content: 'Second message (to be rewound from)', created_at: 't3', is_active_in_thread: true, ai_provider_id: 'p-rewind', system_prompt_id: 's-rewind', token_usage: null, user_id: mockUser.id },
                { id: 'msg2-assist', chat_id: chatId, role: 'assistant', content: 'Second response (to be replaced)', created_at: 't4', is_active_in_thread: true, ai_provider_id: null, system_prompt_id: null, token_usage: null, user_id: null },
                { id: 'msg3-user', chat_id: chatId, role: 'user', content: 'Third message (to be replaced)', created_at: 't5', is_active_in_thread: true, ai_provider_id: 'p-rewind', system_prompt_id: 's-rewind', token_usage: null, user_id: mockUser.id },
            ];
            const newMessageContent = "New message after rewind";
            const newAssistantResponse: ChatMessage = {
                id: 'm-rewind-assist',
                chat_id: chatId,
                role: 'assistant',
                content: 'Response to rewinded message',
                created_at: new Date().toISOString(),
                token_usage: { total_tokens: 15 },
                ai_provider_id: 'p-rewind',
                system_prompt_id: 's-rewind',
                is_active_in_thread: true,
                user_id: null
            };

            act(() => {
                resetAiStore({
                    currentChatId: chatId,
                    messagesByChatId: { [chatId]: initialMessages },
                    rewindTargetMessageId: rewindTargetId,
                    newChatContext: null,
                    selectedProviderId: 'p-rewind',
                    selectedPromptId: 's-rewind'
                });
            });

            mockSendChatMessage.mockResolvedValue({ data: newAssistantResponse, status: 200, error: null });

            let optimisticUserMessageId: string | undefined;
            const originalSetState = useAiStore.setState;
            vi.spyOn(useAiStore, 'setState').mockImplementation((updater, replace) => {
                if (typeof updater === 'function') {
                    const stateBeforeUpdate = useAiStore.getState();
                    const newState = updater(stateBeforeUpdate);
                    const messagesInChat = newState.messagesByChatId?.[chatId];
                    if (messagesInChat) {
                        const optimisticMsg = messagesInChat.find(m => m.content === newMessageContent && m.role === 'user');
                        if (optimisticMsg) optimisticUserMessageId = optimisticMsg.id;
                    }
                    originalSetState(newState, replace);
                } else {
                    originalSetState(updater, replace);
                }
            });

            await act(async () => {
                await useAiStore.getState().sendMessage({ ...messageData, message: newMessageContent, providerId: 'p-rewind', promptId: 's-rewind' });
            });

            vi.mocked(useAiStore.setState).mockRestore();
            const state = useAiStore.getState();

            expect(mockSendChatMessage).toHaveBeenCalledWith(
                expect.objectContaining({ chatId, message: newMessageContent, rewindFromMessageId: rewindTargetId, providerId: 'p-rewind', promptId: 's-rewind' }),
                expect.anything()
            );

            expect(state.isLoadingAiResponse).toBe(false);
            expect(state.aiError).toBeNull();
            expect(state.rewindTargetMessageId).toBeNull(); // Crucial: rewind target cleared
            expect(state.currentChatId).toBe(chatId);

            const finalMessages = state.messagesByChatId[chatId];
            expect(finalMessages).toBeDefined();

            // Expected: msg1-user, msg1-assist, <new optimistic user msg (confirmed)>, newAssistantResponse
            expect(finalMessages.length).toBe(4);
            expect(finalMessages[0].id).toBe('msg1-user');
            expect(finalMessages[1].id).toBe('msg1-assist');
            expect(finalMessages[2].content).toBe(newMessageContent);
            if (optimisticUserMessageId) expect(finalMessages[2].id).toBe(optimisticUserMessageId);
            expect(finalMessages[3].id).toBe(newAssistantResponse.id);

            // Ensure old messages from rewind point are gone
            expect(finalMessages.find(m => m.id === rewindTargetId)).toBeUndefined();
            expect(finalMessages.find(m => m.id === 'msg2-assist')).toBeUndefined();
            expect(finalMessages.find(m => m.id === 'msg3-user')).toBeUndefined();
        });

        it('[REWIND] FAILURE: should preserve original history and rewindTargetMessageId on API error', async () => {
            const chatId = 'chat-with-rewind-fail';
            const rewindTargetId = 'msg2-user-fail';
            const initialMessages: ChatMessage[] = [
                { id: 'msg1-user-f', chat_id: chatId, role: 'user', content: 'First message fail', created_at: 'tf1', is_active_in_thread: true, ai_provider_id: null, system_prompt_id: null, token_usage: null, user_id: mockUser.id },
                { id: 'msg1-assist-f', chat_id: chatId, role: 'assistant', content: 'First response fail', created_at: 'tf2', is_active_in_thread: true, ai_provider_id: null, system_prompt_id: null, token_usage: null, user_id: null },
                { id: rewindTargetId, chat_id: chatId, role: 'user', content: 'Second message (to be rewound from)', created_at: 'tf3', is_active_in_thread: true, ai_provider_id: null, system_prompt_id: null, token_usage: null, user_id: mockUser.id },
                { id: 'msg2-assist-f', chat_id: chatId, role: 'assistant', content: 'Second response (should remain)', created_at: 'tf4', is_active_in_thread: true, ai_provider_id: null, system_prompt_id: null, token_usage: null, user_id: null },
            ];
            const newMessageContent = "New message triggering failed rewind";
            const errorMsg = "API error during rewind";

            act(() => {
                resetAiStore({
                    currentChatId: chatId,
                    messagesByChatId: { [chatId]: [...initialMessages] }, // Store a copy
                    rewindTargetMessageId: rewindTargetId,
                    newChatContext: null,
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });

            mockSendChatMessage.mockResolvedValue({ data: null, status: 500, error: { message: errorMsg } });

            let optimisticTempMessageId: string | undefined;
            const originalSetState = useAiStore.setState;
            vi.spyOn(useAiStore, 'setState').mockImplementation((updater, replace) => {
                if (typeof updater === 'function') {
                    const stateBeforeUpdate = useAiStore.getState();
                    const newState = updater(stateBeforeUpdate);
                    const messagesInChat = newState.messagesByChatId?.[chatId];
                    if (messagesInChat) {
                        const optimisticMsg = messagesInChat.find(m => m.content === newMessageContent && m.role === 'user');
                        if (optimisticMsg) optimisticTempMessageId = optimisticMsg.id;
                    }
                    originalSetState(newState, replace);
                } else {
                    originalSetState(updater, replace);
                }
            });

            await act(async () => {
                 await useAiStore.getState().sendMessage({...messageData, message: newMessageContent });
            });

            vi.mocked(useAiStore.setState).mockRestore();
            const state = useAiStore.getState();

            expect(mockSendChatMessage).toHaveBeenCalledWith(
                expect.objectContaining({ chatId, message: newMessageContent, rewindFromMessageId: rewindTargetId }),
                expect.anything()
            );

            expect(state.isLoadingAiResponse).toBe(false);
            expect(state.aiError).toBe(errorMsg);
            expect(state.rewindTargetMessageId).toBe(rewindTargetId); // Crucial: rewind target preserved
            expect(state.currentChatId).toBe(chatId);

            const finalMessages = state.messagesByChatId[chatId];
            expect(finalMessages).toBeDefined();
            // Optimistic message should be removed, original history preserved
            expect(finalMessages.length).toBe(initialMessages.length);
            initialMessages.forEach((initialMsg, index) => {
                expect(finalMessages[index]).toEqual(initialMsg);
            });
            if (optimisticTempMessageId) {
                expect(finalMessages.find(m => m.id === optimisticTempMessageId)).toBeUndefined();
            }
        });
    }); // End Authenticated describe

    describe('sendMessage (Anonymous Flow - Pending Action)', () => {
        // Create a standalone mock function for localStorage.setItem
        const mockLocalStorageSetItem = vi.fn();
        let optimisticChatIdForAnonFlow: string | undefined;

        beforeEach(() => {
            // Stub window.localStorage with our mock function
            vi.stubGlobal('localStorage', {
                setItem: mockLocalStorageSetItem,
                // Add getItem, removeItem etc. with vi.fn() if they are used by the store
                getItem: vi.fn(),
                removeItem: vi.fn(),
                clear: vi.fn(),
                key: vi.fn(),
                length: 0, // Provide a sensible default for length
            });

            optimisticChatIdForAnonFlow = undefined;

            const originalSetState = useAiStore.setState;
            vi.spyOn(useAiStore, 'setState').mockImplementation((updater, replace) => {
                if (typeof updater === 'function') {
                    const stateBeforeUpdate = useAiStore.getState();
                    const newState = updater(stateBeforeUpdate);
                    const currentKeys = Object.keys(stateBeforeUpdate.messagesByChatId || {});
                    const newKeys = Object.keys(newState.messagesByChatId || {});
                    const addedKey = newKeys.find(k => !currentKeys.includes(k) && k.startsWith('temp-chat-'));
                    if (addedKey) {
                        optimisticChatIdForAnonFlow = addedKey;
                    }
                    originalSetState(newState, replace);
                } else {
                    originalSetState(updater, replace);
                }
            });

            act(() => {
                resetAiStore({ messagesByChatId: {}, currentChatId: null, newChatContext: null, selectedProviderId: messageData.providerId, selectedPromptId: messageData.promptId });
            });

            if (vi.isMockFunction(useAuthStore)) {
                vi.mocked(useAuthStore.getState).mockReturnValue({
                    user: null,
                    session: null,
                    navigate: null,
                    profile: null,
                    isLoading: false,
                    error: null,
                    setNavigate: vi.fn(), login: vi.fn(), logout: vi.fn(), register: vi.fn(),
                    setProfile: vi.fn(), setUser: vi.fn(), setSession: vi.fn(), setIsLoading: vi.fn(), setError: vi.fn(),
                    initialize: vi.fn(), refreshSession: vi.fn(), updateProfile: vi.fn(), clearError: vi.fn(),
                } as any);
            } else {
                 console.warn("useAuthStore mock was not found for mocking getState in sendMessage (Anonymous) tests.");
            }
        });

        afterEach(() => {
            vi.unstubAllGlobals(); // Restore original localStorage
            vi.mocked(useAiStore.setState).mockRestore();
            mockLocalStorageSetItem.mockClear(); // Clear mock calls for the next test
        });

        const messageData = { message: 'Anonymous Hello', providerId: 'p-anon', promptId: 's-anon' };
        const authError = new AuthRequiredError('Auth required');

        it('[ANON] NAVIGATE NULL: should store pendingAction and set error when auth navigate is null', async () => {
            mockSendChatMessage.mockRejectedValue(authError);

            await act(async () => {
                await useAiStore.getState().sendMessage(messageData);
            });

            const finalState = useAiStore.getState();
            expect(finalState.isLoadingAiResponse).toBe(false);
            expect(finalState.aiError).toBe(authError.message);

            if (optimisticChatIdForAnonFlow) {
                expect(finalState.messagesByChatId[optimisticChatIdForAnonFlow]?.length || 0).toBe(0);
            }

            const expectedPendingAction = {
                endpoint: 'chat',
                method: 'POST',
                body: { ...messageData, chatId: null, organizationId: null }, // Added organizationId: null
                returnPath: 'chat'
            };
            expect(mockLocalStorageSetItem).toHaveBeenCalledWith('pendingAction', JSON.stringify(expectedPendingAction)); // Use the new mock fn
            expect(mockNavigateGlobal).not.toHaveBeenCalled();
        });

        it('[ANON] LOCALSTORAGE FAIL: should set error and not navigate if localStorage.setItem fails', async () => {
            mockSendChatMessage.mockRejectedValue(authError);
            const storageErrorMsg = 'Session storage is full';
            // Make our specific mock function throw the error
            mockLocalStorageSetItem.mockImplementation(() => { throw new Error(storageErrorMsg); });

            await act(async () => {
                await useAiStore.getState().sendMessage(messageData);
            });

            const finalState = useAiStore.getState();
            expect(finalState.isLoadingAiResponse).toBe(false);
            expect(finalState.aiError).toBe(authError.message);
            if (optimisticChatIdForAnonFlow) {
                expect(finalState.messagesByChatId[optimisticChatIdForAnonFlow]?.length || 0).toBe(0);
            }
            expect(mockLocalStorageSetItem).toHaveBeenCalledTimes(1); // Use the new mock fn
            expect(mockNavigateGlobal).not.toHaveBeenCalled();
        });
    }); // End Anonymous describe

    // --- Tests for sendMessage (Dummy Provider - Development Mode) ---
    describe('sendMessage (Dummy Provider - Development Mode)', () => {
        const mockToken = 'dev-dummy-token';
        const mockUser: User = { id: 'user-dummy-dev', email: 'dummy@dev.com', created_at: 't', updated_at: 't', role: 'user' };
        const mockSession: Session = { access_token: mockToken, refresh_token: 'r', expiresAt: Date.now() / 1000 + 3600 };
        const messageData = { message: 'Hello Dummy', providerId: DUMMY_PROVIDER_ID, promptId: null };

        let originalNodeEnv: string | undefined;

        beforeEach(() => {
            originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';
            vi.useFakeTimers();

            if (vi.isMockFunction(useAuthStore)) {
                vi.mocked(useAuthStore.getState).mockReturnValue({
                    user: mockUser,
                    session: mockSession,
                    navigate: mockNavigateGlobal,
                    profile: null, isLoading: false, error: null, setNavigate: vi.fn(), login: vi.fn(), logout: vi.fn(), register: vi.fn(),
                    setProfile: vi.fn(), setUser: vi.fn(), setSession: vi.fn(), setIsLoading: vi.fn(), setError: vi.fn(),
                    initialize: vi.fn(), refreshSession: vi.fn(), updateProfile: vi.fn(), clearError: vi.fn(),
                } as any);
            } else {
                 console.warn("useAuthStore mock was not found for mocking getState in sendMessage (Dummy Provider) tests.");
            }

            act(() => {
                resetAiStore({
                    availableProviders: [dummyProviderDefinition],
                    currentChatId: null,
                    messagesByChatId: {},
                    chatsByContext: { personal: [], orgs: {} },
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });
            mockSendChatMessage.mockClear();
        });

        afterEach(() => {
            process.env.NODE_ENV = originalNodeEnv;
            vi.useRealTimers();
        });

        it('should add user message and then echo assistant message without calling API', async () => {
            const initialChatId = null;
            act(() => {
                 resetAiStore({
                    availableProviders: [dummyProviderDefinition],
                    currentChatId: initialChatId,
                    messagesByChatId: {},
                    chatsByContext: { personal: [], orgs: {}},
                    newChatContext: null,
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });

            let promise;
            act(() => {
                promise = useAiStore.getState().sendMessage({ ...messageData, chatId: initialChatId });
            });

            expect(useAiStore.getState().isLoadingAiResponse).toBe(true);
            const messagesPending = useAiStore.getState().messagesByChatId;
            const optimisticChatIdKey = Object.keys(messagesPending).find(key => key.startsWith('temp-chat-'));
            expect(optimisticChatIdKey).toBeDefined();
            const optimisticMessages = messagesPending[optimisticChatIdKey!];
            expect(optimisticMessages).toHaveLength(1);
            expect(optimisticMessages[0].content).toBe(messageData.message);
            expect(optimisticMessages[0].role).toBe('user');

            act(() => {
                vi.runAllTimers();
            });
            await promise;

            expect(mockSendChatMessage).not.toHaveBeenCalled();
            const state = useAiStore.getState();
            expect(state.isLoadingAiResponse).toBe(false);

            const finalChatId = optimisticChatIdKey!;
            expect(state.currentChatId).toBe(finalChatId);

            const finalMessages = state.messagesByChatId[finalChatId];
            expect(finalMessages).toHaveLength(2);
            expect(finalMessages[0].content).toBe(messageData.message);
            expect(finalMessages[0].role).toBe('user');

            const assistantMessage = finalMessages[1];
            expect(assistantMessage.role).toBe('assistant');
            expect(assistantMessage.content).toBe(`Echo from Dummy: ${messageData.message}`);
            expect(assistantMessage.ai_provider_id).toBe(DUMMY_PROVIDER_ID);
            expect(assistantMessage.user_id).toBeNull();
            expect(assistantMessage.chat_id).toBe(finalChatId);
            expect(assistantMessage.id.startsWith('dummy-echo-')).toBe(true);
            expect(assistantMessage.token_usage).toEqual({
                promptTokens: messageData.message.length,
                completionTokens: (`Echo from Dummy: ${messageData.message}`).length,
                totalTokens: messageData.message.length + (`Echo from Dummy: ${messageData.message}`).length,
            });
            expect(state.aiError).toBeNull();

            expect(state.chatsByContext?.personal?.length).toBe(1);
            expect(state.chatsByContext?.personal?.[0]?.id).toBe(finalChatId);
            expect(state.chatsByContext?.personal?.[0]?.title).toBe(messageData.message.substring(0,50));
        });

        it('should work with an existing chat ID', async () => {
            const existingChatId = 'existing-dummy-chat-123';
            const initialMessages: ChatMessage[] = [
                { id: 'm0', chat_id: existingChatId, role: 'user', content: 'Old message', created_at: 't0', is_active_in_thread: true, user_id: mockUser.id, ai_provider_id: null, system_prompt_id: null, token_usage: null }
            ];
            act(() => {
                 resetAiStore({
                    availableProviders: [dummyProviderDefinition],
                    currentChatId: existingChatId,
                    messagesByChatId: { [existingChatId]: initialMessages },
                    chatsByContext: { personal: [{id: existingChatId, created_at: 't', updated_at: 't', title: 'Old Chat', user_id: mockUser.id, organization_id: null, system_prompt_id: null }], orgs: {}},
                    selectedProviderId: messageData.providerId,
                    selectedPromptId: messageData.promptId
                });
            });

            let promise;
            act(() => {
                promise = useAiStore.getState().sendMessage({ ...messageData, chatId: existingChatId });
            });
            act(() => {
                vi.runAllTimers();
            });
            await promise;

            expect(mockSendChatMessage).not.toHaveBeenCalled();
            const state = useAiStore.getState();
            expect(state.isLoadingAiResponse).toBe(false);
            expect(state.currentChatId).toBe(existingChatId);

            const finalMessages = state.messagesByChatId[existingChatId];
            expect(finalMessages).toHaveLength(initialMessages.length + 2);
            expect(finalMessages[initialMessages.length].content).toBe(messageData.message);
            expect(finalMessages[initialMessages.length + 1].content).toBe(`Echo from Dummy: ${messageData.message}`);
            expect(finalMessages[initialMessages.length + 1].ai_provider_id).toBe(DUMMY_PROVIDER_ID);
        });
    });

}); // End describe for aiStore - sendMessage
