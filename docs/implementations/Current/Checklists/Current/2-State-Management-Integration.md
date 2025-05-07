# AI Chat Enhancements: PARENTHESIS Implementation Plan

## Preamble

This document outlines the detailed, step-by-step implementation plan for the AI Chat Enhancements project, based on the synthesized requirements (SYNTHESIS #1, #2, #3) and user feedback. It follows a Test-Driven Development (TDD) approach (Red -> Green -> Refactor) and adheres to the existing monorepo architecture (`Backend (Supabase Functions) <-> API Client (@paynless/api) <-> State (@paynless/store) <-> Frontend (apps/web)`).

**Goal:** To guide the development team through the implementation process, ensuring all requirements are met, code quality is maintained, and features are delivered reliably.

## Legend

*   [ ] Each work step will be uniquely named for easy reference 
    *   [ ] Worksteps will be nested as shown
        *   [ ] Nesting can be as deep as logically required 
*   [✅] Represents a completed step or nested set
*   [🚧] Represents an incomplete or partially completed step or nested set
*   [⏸️] Represents a paused step where a discovery has been made that requires backtracking 
*   [❓] Represents an uncertainty that must be resolved before continuing 
*   [🚫] Represents a blocked, halted, stopped step or nested set that has some unresolved problem or prior dependency to resolve before continuing

## Component Types and Labels

The implementation plan uses the following labels to categorize work steps:

* **[DB]:** Database Schema Change (Migration)
* **[RLS]:** Row-Level Security Policy
* **[BE]:** Backend Logic (Edge Function / RLS / Helpers)
* **[API]:** API Client Library (`@paynless/api`)
* **[STORE]:** State Management (`@paynless/store`)
* **[UI]:** Frontend Component (`apps/web`)
* **[TEST-UNIT]:** Unit Test Implementation/Update
* **[TEST-INT]:** Integration Test Implementation/Update (API, Store-Component, RLS)
* **[ANALYTICS]:** Analytics Integration (`@paynless/analytics`)
* **[REFACTOR]:** Code Refactoring Step
* **[COMMIT]:** Checkpoint for Git Commit

**Core Principles:**

*   **TDD:** Write failing tests before implementation code (RED), write code to make tests pass (GREEN), then refactor (REFACTOR).
*   **Modularity:** Build reusable components, functions, and modules.
*   **Architecture:** Respect the existing API <-> Store <-> UI flow and the `api` Singleton pattern.
*   **Explicitness:** Leave nothing to assumption. Detail every sub-step.
*   **Testing:** Unit tests (`[TEST-UNIT]`) for isolated logic, Integration tests (`[TEST-INT]`) for interactions (API-Store, Store-UI, Backend Endpoints). E2E tests (`[TEST-E2E]`) are optional/manual for this phase.
*   **Analytics:** Integrate `packages/analytics` for all relevant user interactions (`[ANALYTICS]`).
*   **Commits:** Commit frequently after Green/Refactor stages with clear messages (`[COMMIT]`).
*   **Checkpoints:** Stop, run tests (`npm test`), build (`npm run build`), restart dev server after significant steps/phases.

**Reference Requirements:** Use REQ-XXX codes from SYNTHESIS #2 PRD for traceability.

**Branch:** `feature/ai-chat-org-integration` 

---

## Phase 2: State Management Integration

**Goal:** Update and integrate state management (`@paynless/store`) to handle organization context, token tracking, rewind functionality, and interaction with the API client and organization store.

### STEP-2.1: Update AI Store (`useAiStore`) [STORE] [🚧]

#### STEP-2.1.1: Refactor AI Store State Structure [TEST-UNIT] [COMMIT]
* [✅] Define test cases for the desired state structure. Consider partitioning approaches:
    *   [✅] Gemini suggestion: `chatsByContext: { personal: Chat[], [orgId: string]: Chat[] }`, `messagesByChatId: { [chatId: string]: ChatMessage[] }`, `currentChatId: string | null`, `isLoadingByContext: { personal: boolean, [orgId: string]: boolean }`, `newChatContext: string | null`
    *   [🚫]Claude suggestion: `personalChats: Chat[]`, `organizationChats: { [organizationId: string]: Chat[] }` (Requires tracking `currentOrganizationId` separately or via `useOrganizationStore`).
    *   *Decision:* Choose one or merge. The `chatsByContext` approach might simplify selectors.
* [✅] Define state properties for token tracking (e.g., cumulative usage, estimates if stored).
* [✅] Define state properties for rewind feature (e.g., `rewindTargetMessageId: string | null`).
* [✅] Define state properties for loading/error states (e.g., `isLoadingHistory`, `isLoadingDetails`, `isLoadingAiResponse`, `aiError`).
* [✅] Write unit tests in `packages/store/src/aiStore.unit.test.ts` covering the chosen state structure. Expect failure (RED).
* [✅] Open `packages/store/src/aiStore.ts` and modify the state interface (`AiState`) based on the chosen structure.
* [✅] Update corresponding types in `packages/types/src/ai.types.ts` (`AiState`, `AiStore`).
* [✅] Run unit tests to verify state structure changes. Debug until pass (GREEN).
* [✅] **[REFACTOR]** Review final state structure for clarity and efficiency.
* [✅] Commit changes with message "refactor(STORE): Update useAiStore state structure for org context, tokens, rewind w/ tests"

#### STEP-2.1.2: Update AI Store Selectors [TEST-UNIT] [COMMIT]
* [✅] Define test cases for selectors based on the chosen state structure:
    *   `selectChatHistoryList`: Mock `useOrganizationStore` if needed. Test returning correct chat list based on `currentOrganizationId` (null for personal, orgId for orgs). Test empty lists.
    *   `selectCurrentChatMessages`: Test returns messages for `state.currentChatId` from `state.messagesByChatId`, ensuring only messages where `is_active_in_thread = true` are included (for rewind).
    *   `selectIsHistoryLoading`: Test returns correct loading state based on context.
    *   `selectIsDetailsLoading`: Test returns loading state for current chat details.
    *   `selectIsLoadingAiResponse`: Test returns AI response loading state.
    *   `selectAiError`: Test returns current AI error.
    *   Add selectors for token usage (e.g., `selectCurrentTokenEstimate`, `selectSessionTokenUsage`).
    *   Add selectors related to rewind state (e.g., `selectIsRewinding`, `selectRewindTargetMessageId`).
* [✅] Write/Update these tests in `packages/store/src/aiStore.unit.test.ts`. Expect failure (RED).
* [✅] Update selectors in `packages/store/src/aiStore.ts`:
    *   Implement/Refactor `selectChatHistoryList` using `useOrganizationStore.getState().currentOrganizationId` and the chosen state structure.
    *   Implement/Refactor `selectCurrentChatMessages`, ensuring the `is_active_in_thread` filter.
    *   Implement/Refactor other selectors defined above.
* [✅] Run unit tests to verify selectors behave correctly. Debug until pass (GREEN).
* [⏸️] **[REFACTOR]** ~~Ensure selectors are memoized where appropriate (e.g., using Zustand middleware or `reselect`).~~ // NOTE: Deferred to dedicated memoization step later in plan.
* [ ] Commit changes with message "feat(STORE): Update useAiStore selectors for org context, rewind, tokens w/ tests"

#### STEP-2.1.3: Update `loadChatHistory` Action [TEST-UNIT] [COMMIT] [✅]
* [✅] Define test cases for `loadChatHistory` action:
    *   [✅] Verify it accepts `organizationId: string | null`.
    *   [✅] Verify it sets the correct loading state (e.g., `isLoadingByContext[organizationId ?? 'personal'] = true`).
    *   [✅] Verify it calls `api.ai().getChatHistory(token, organizationId)` (mock API call).
    *   [✅] Verify it updates the correct state partition (e.g., `chatsByContext[organizationId ?? 'personal']`) with the response data.
    *   [✅] Verify it clears the loading state on success/error.
    *   [✅] Verify error handling.
* [✅] Write/Update tests in `packages/store/src/aiStore.unit.test.ts`. Expect failure (RED).
* [✅] Update `loadChatHistory` action in `packages/store/src/aiStore.ts` based on the defined logic.
* [✅] Run unit tests. Debug until pass (GREEN).
* [✅] **[REFACTOR]** Review error handling and state updates.
* [✅] Commit changes with message "feat(STORE): Update loadChatHistory action for organization context w/ tests"

#### STEP-2.1.4: Update `loadChatDetails` Action [TEST-UNIT] [COMMIT] [✅]
* [✅] Define test cases for `loadChatDetails` action:
    *   [✅] Verify it accepts `chatId: string`.
    *   [✅] Verify it sets `isDetailsLoading = true`.
    *   [✅] Verify it calls `api.ai().getChatMessages(chatId, token)` (mock API call).
    *   [✅] Verify it updates `messagesByChatId[chatId]` with the response data (active messages only).
    *   [✅] Verify it sets `currentChatId = chatId`.
    *   [✅] Verify it clears `isDetailsLoading` on success/error.
    *   [✅] Verify error handling.
* [✅] Write/Update tests in `packages/store/src/aiStore.unit.test.ts`. Expect failure (RED).
* [✅] Update `loadChatDetails` action in `packages/store/src/aiStore.ts`.
* [✅] Run unit tests. Debug until pass (GREEN).
* [✅] **[REFACTOR]** Review state updates and error handling.
* [✅] Commit changes with message "feat(STORE): Update loadChatDetails action for org context and rewind w/ tests"

#### STEP-2.1.5: Update `startNewChat` Action [TEST-UNIT] [COMMIT] [✅]
* [✅] Define test cases for `startNewChat` action:
    *   [✅] Verify it accepts `organizationId: string | null`.
    *   [✅] Verify it sets `state.currentChatId = null`.
    *   [✅] Verify it does NOT clear messages from `messagesByChatId` for other chats.
    *   [✅] Verify it sets the context for the new chat (e.g., `state.newChatContext = organizationId` or `null` for personal).
    *   [✅] Verify it resets other relevant chat-specific state (e.g., `rewindTargetMessageId`, `aiError`, `isLoadingAiResponse`).
* [✅] Write/Update tests in `packages/store/src/aiStore.startNewChat.test.ts` (New file created). Expect failure (RED).
* [✅] Update `startNewChat` action in `packages/store/src/aiStore.ts` (Done prior to test fixing in this session).
* [✅] Run unit tests. Debug until pass (GREEN).
* [✅] **[REFACTOR]** Review `startNewChat` action for clarity and ensure no unintended side effects (Action is simple and deemed robust after review).
* [✅] Commit changes with message "feat(STORE): Update startNewChat action for organization context w/ tests"

#### STEP-2.1.6: Update `sendMessage` Action [TEST-UNIT] [COMMIT]
* [ ] Define test cases for `sendMessage` covering:
    *   **New Chat:** No `chatId` provided. Determines `organizationId` from `newChatContext`. Includes `system_prompt_id`. Calls `api.ai().sendChatMessage`. Updates `chatsByContext`, sets `currentChatId`, updates `messagesByChatId`, clears `newChatContext`. Triggers `new_chat_created` analytics.
    *   **Existing Chat:** `chatId` provided. Determines `organizationId` from existing chat data. Calls `api.ai().sendChatMessage`. Updates `messagesByChatId` for the existing `currentChatId`.
    *   **Rewind:** `rewindTargetMessageId` is set. Determines `chatId` and `organizationId`. Calls `api.ai().sendChatMessage` with `rewindFromMessageId`. Updates `messagesByChatId` (clearing old, adding new). Clears rewind state. Triggers `chat_rewind_used` analytics.
    *   **All Scenarios:** Handles optimistic UI updates for user message. Sets/clears `isLoadingAiResponse`. Stores `token_usage` data from response. Handles API errors, sets `aiError`.
* [ ] Write/Update tests in `packages/store/src/aiStore.unit.test.ts`. Mock API calls. Expect failure (RED).
* [ ] Update `sendMessage` action in `packages/store/src/aiStore.ts` to implement the logic for all scenarios.
* [ ] Run unit tests. Debug complex logic until pass (GREEN).
* [ ] **[REFACTOR]** Ensure state updates are clean, especially for rewind. Handle errors gracefully.
* [ ] Commit changes with message "feat(STORE): Update sendMessage action for org context, rewind, tokens w/ tests & analytics"

#### STEP-2.1.7: Add or Update `deleteChat` Action [TEST-UNIT] [COMMIT]
* [ ] Define test cases for `deleteChat` action:
    *   Verify accepts `chatId`, `organizationId`.
    *   Verify calls `api.ai().deleteChat(chatId, organizationId)` (mock API).
    *   Verify removes chat from the correct state partition (e.g., `chatsByContext`).
    *   Verify calls `startNewChat(null)` if `chatId === currentChatId`.
    *   Verify triggers `chat_deleted` analytics event on success.
    *   Verify handles loading/error states.
* [ ] Write/Update tests in `packages/store/src/aiStore.unit.test.ts`. Expect failure (RED).
* [ ] Add or update `deleteChat` action in `packages/store/src/aiStore.ts`.
* [ ] Run unit tests. Debug until pass (GREEN).
* [ ] Commit changes with message "feat(STORE): Add/update deleteChat action for organization context w/ tests & analytics"

#### STEP-2.1.8: Add Token Tracking Logic/Actions [TEST-UNIT] [COMMIT]
* [ ] Define test cases for token tracking logic/actions:
    *   Client-side estimation function/hook interaction (if estimation is done via store action).
    *   Storing `token_usage` data correctly when messages are added/updated.
    *   Cumulative token calculation logic/selector tests.
* [ ] Write/Update tests in `