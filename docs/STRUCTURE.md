# Project Structure & Architecture

## Architecture Overview

The architecture follows these principles:
- Clear separation between frontend (React) and backend (Supabase Edge Functions)
- RESTful API endpoints (Edge Functions) serve business logic
- Frontend consumes the API via a layered structure (UI -> Service -> API Client)
- Stateless authentication using JWT tokens managed via Supabase Auth
- Consistent error handling and response formatting via `apiClient`
- State management primarily using Zustand stores

### Core Pattern: API Client Singleton

**Decision (April 2025):** To ensure consistency and simplify integration across multiple frontend platforms (web, mobile) and shared packages (like Zustand stores), the `@paynless/api` package follows a **Singleton pattern**.

*   **Initialization:** The client is configured and initialized *once* per application lifecycle using `initializeApiClient(config)`. Each platform provides the necessary configuration.
*   **Access:** All parts of the application (stores, UI components, platform-specific code) access the single, pre-configured client instance by importing the exported `api` object: `import { api } from '@paynless/api';`.
*   **No DI for Stores:** Shared stores (Zustand) should *not* use dependency injection (e.g., an `init` method) to receive the API client. They should import and use the `api` singleton directly.
*   **Testing:** Unit testing components or stores that use the `api` singleton requires mocking the module import using the test framework's capabilities (e.g., `vi.mock('@paynless/api', ...)`).
*   **Consistency Note:** Older stores (`authStore`, `subscriptionStore`) may still use an outdated DI pattern and require refactoring to align with this singleton approach.


## API Endpoints (Supabase Edge Functions)

The application exposes the following primary API endpoints through Supabase Edge Functions:

### Authentication & Core User
- `/login`: Handles user sign-in via email/password.
- `/register`: Handles user registration via email/password.
- `/logout`: Handles user logout.
- `/session`: Fetches current session information. *(Needs verification if still used)*
- `/refresh`: Refreshes the authentication token.
- `/reset-password`: Handles the password reset flow.
- `/me`: Fetches the profile for the currently authenticated user.
- `/profile`: Updates the profile for the currently authenticated user.
- `/ping`: Simple health check endpoint.

### Subscriptions & Billing
- `/api-subscriptions`: Main router for subscription actions.
  - `GET /current`: Fetches the current user's subscription status.
  - `GET /plans`: Fetches available Stripe subscription plans.
  - `POST /checkout`: Creates a Stripe Checkout session.
  - `POST /billing-portal`: Creates a Stripe Customer Portal session.
  - `POST /:subscriptionId/cancel`: Cancels a specific subscription.
  - `POST /:subscriptionId/resume`: Resumes a specific subscription.
  - `GET /usage/:metric`: Fetches usage metrics for a specific metric.
- `/stripe-webhook`: Handles incoming webhook events from Stripe (e.g., checkout completed, subscription updates).
- `/sync-stripe-plans`: (Admin/Internal) Function to synchronize Stripe Products/Prices with the `subscription_plans` table.

### AI Chat
- `/ai-providers`: Fetches the list of available/active AI providers.
- `/system-prompts`: Fetches the list of available/active system prompts for AI chat.
- `/chat`: Handles sending a user message to an AI provider, managing context, and saving the conversation.
- `/chat-history`: Fetches the list of chat conversations for the authenticated user.
- `/chat-details/:chatId`: Fetches all messages for a specific chat conversation.
- `/sync-ai-models`: (Admin/Internal) Placeholder function intended to synchronize AI models from providers with the `ai_providers` table.

### Internal / Triggers
- `/on-user-created`: Function triggered by Supabase Auth on new user creation (handles profile creation and **optional email marketing sync**).

### [NEW] Notifications & Multi-Tenancy (Organizations)
- `/notifications`: (GET) Fetches notifications for the current user.
- `/notifications/:notificationId`: (PATCH) Marks a specific notification as read.
- `/notifications/mark-all-read`: (POST) Marks all user's notifications as read.
- `/organizations`: (POST) Creates a new organization.
- `/organizations`: (GET) Lists organizations the current user is a member of.
- `/organizations/:orgId`: (GET) Fetches details for a specific organization.
- `/organizations/:orgId`: (PATCH) Updates organization details (name, visibility) (Admin only).
- `/organizations/:orgId`: (DELETE) Soft-deletes an organization (Admin only).
- `/organizations/:orgId/members`: (GET) Lists members of a specific organization.
- `/organizations/:orgId/invite`: (POST) Invites a user to an organization (Admin only, may involve Edge Function).
- `/invites/accept/:token`: (POST/GET) Accepts an organization invitation (may involve Edge Function).
- `/organizations/:orgId/join`: (POST) Requests to join an organization.
- `/memberships/:membershipId/approve`: (POST) Approves a pending join request (Admin only).
- `/memberships/:membershipId/role`: (PATCH) Updates a member's role (Admin only).
- `/memberships/:membershipId`: (DELETE) Removes a member from an organization (Admin or self).

*(Note: This list is based on the `supabase/functions/` directory structure and inferred functionality. Specific HTTP methods and request/response details require inspecting function code or the `api` package.)*

## Database Schema (Simplified)

The core database tables defined in `supabase/migrations/` include:

*(Note: This schema description is based on previous documentation and may require verification against the actual migration files (`supabase/migrations/`) for complete accuracy, especially regarding constraints, defaults, and RLS policies.)*

- **`public.user_profiles`** (Stores public profile information for users)
  - `id` (uuid, PK, references `auth.users(id) ON DELETE CASCADE`)
  - `first_name` (text, nullable)
  - `last_name` (text, nullable)
  - `role` (public.user_role enum [`'user'`, `'admin'`], NOT NULL, default `'user'`)
  - `created_at` (timestamp with time zone, NOT NULL, default `now()`)
  - `updated_at` (timestamp with time zone, NOT NULL, default `now()`)

- **`public.subscription_plans`** (Stores available subscription plans, mirrors Stripe Products/Prices)
  - `id` (uuid, PK, default `uuid_generate_v4()`)
  - `stripe_price_id` (text, UNIQUE, NOT NULL) - *Corresponds to Stripe Price ID (e.g., `price_...`)*
  - `stripe_product_id` (text, nullable) - *Corresponds to Stripe Product ID (e.g., `prod_...`)*
  - `name` (text, NOT NULL)
  - `description` (jsonb, nullable) - *Structured as `{ "subtitle": "...", "features": ["...", "..."] }`*
  - `amount` (integer, NOT NULL) - *Amount in smallest currency unit (e.g., cents)*
  - `currency` (text, NOT NULL) - *3-letter ISO code (e.g., `'usd'`)*
  - `interval` (text, NOT NULL) - *One of `'day'`, `'week'`, `'month'`, `'year'`*
  - `interval_count` (integer, NOT NULL, default `1`)
  - `active` (boolean, NOT NULL, default `true`) - *Whether the plan is offered*
  - `metadata` (jsonb, nullable) - *For additional plan details*
  - `created_at` (timestamp with time zone, NOT NULL, default `now()`)
  - `updated_at` (timestamp with time zone, NOT NULL, default `now()`)

- **`public.user_subscriptions`** (Stores user subscription information linked to Stripe)
  - `id` (uuid, PK, default `uuid_generate_v4()`)
  - `user_id` (uuid, UNIQUE, NOT NULL, references `public.user_profiles(id) ON DELETE CASCADE`) - *Made UNIQUE*
  - `stripe_customer_id` (text, UNIQUE, nullable)
  - `stripe_subscription_id` (text, UNIQUE, nullable)
  - `status` (text, NOT NULL) - *e.g., `'active'`, `'canceled'`, `'trialing'`, `'past_due'`, `'free'`*
  - `plan_id` (uuid, nullable, references `public.subscription_plans(id)`)
  - `current_period_start` (timestamp with time zone, nullable)
  - `current_period_end` (timestamp with time zone, nullable)
  - `cancel_at_period_end` (boolean, nullable, default `false`)
  - `created_at` (timestamp with time zone, NOT NULL, default `now()`)
  - `updated_at` (timestamp with time zone, NOT NULL, default `now()`)

- **`public.subscription_transactions`** (Logs Stripe webhook events for processing and auditing)
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `user_id` (uuid, NOT NULL, references `auth.users(id) ON DELETE CASCADE`)
  - `stripe_event_id` (text, UNIQUE, NOT NULL) - *Idempotency key*
  - `event_type` (text, NOT NULL) - *e.g., `'checkout.session.completed'`*
  - `status` (text, NOT NULL, default `'processing'`) - *Processing status*
  - `stripe_checkout_session_id` (text, nullable)
  - `stripe_subscription_id` (text, nullable)
  - `stripe_customer_id` (text, nullable)
  - `stripe_invoice_id` (text, nullable)
  - `stripe_payment_intent_id` (text, nullable)
  - `amount` (integer, nullable) - *Smallest currency unit*
  - `currency` (text, nullable)
  - `user_subscription_id` (uuid, nullable, references `public.user_subscriptions(id) ON DELETE SET NULL`)
  - `created_at` (timestamp with time zone, NOT NULL, default `now()`)
  - `updated_at` (timestamp with time zone, NOT NULL, default `now()`)

- **`public.ai_providers`** (Stores information about supported AI models/providers)
  - `id` (uuid, PK)
  - `name` (text, NOT NULL, e.g., "OpenAI GPT-4o")
  - `api_identifier` (text, NOT NULL, UNIQUE, e.g., "openai-gpt-4o") - *Internal identifier*
  - `description` (text, nullable)
  - `is_active` (boolean, NOT NULL, default `true`)
  - `config` (jsonb, nullable) - *Non-sensitive config, excludes API keys*
  - `created_at`, `updated_at` (timestamptz)

- **`public.system_prompts`** (Stores reusable system prompts for AI chat)
  - `id` (uuid, PK)
  - `name` (text, NOT NULL, e.g., "Helpful Assistant")
  - `prompt_text` (text, NOT NULL)
  - `is_active` (boolean, NOT NULL, default `true`)
  - `created_at`, `updated_at` (timestamptz)

- **`public.chats`** (Represents a single AI chat conversation thread)
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `user_id` (uuid, nullable, FK references `auth.users(id) ON DELETE SET NULL`) - *Nullable for potential anonymous chats*
  - `title` (text, nullable) - *e.g., Auto-generated from first message*
  - `created_at`, `updated_at` (timestamptz)

- **`public.chat_messages`** (Stores individual messages within a chat)
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `chat_id` (uuid, NOT NULL, FK references `chats(id) ON DELETE CASCADE`)
  - `user_id` (uuid, nullable, FK references `auth.users(id) ON DELETE SET NULL`) - *Tracks sender if needed*
  - `role` (text, NOT NULL) - *e.g., 'user', 'assistant', 'system'*
  - `content` (text, NOT NULL) - *The message text*
  - `ai_provider_id` (uuid, nullable, FK references `ai_providers(id)`) - *Logs which provider generated the response*
  - `system_prompt_id` (uuid, nullable, FK references `system_prompts(id)`) - *Logs which system prompt was used*
  - `token_usage` (jsonb, nullable) - *Stores request/response tokens from AI API*
  - `created_at` (timestamptz)

### [NEW] Notifications & Multi-Tenancy Schema

- **`public.organizations`** (Represents a team, workspace, or organization)
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `name` (text, NOT NULL)
  - `visibility` (text, NOT NULL, CHECK (`visibility` IN ('private', 'public')), default `'private'`) - *Controls discoverability. Chosen `TEXT CHECK` for future extensibility (e.g., 'unlisted').*
  - `deleted_at` (timestamp with time zone, default `NULL`) - *For soft deletion*
  - `created_at`, `updated_at` (timestamptz)

- **`public.organization_members`** (Junction table linking users to organizations)
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `user_id` (uuid, NOT NULL, FK references `auth.users(id) ON DELETE CASCADE`)
  - `organization_id` (uuid, NOT NULL, FK references `organizations(id) ON DELETE CASCADE`)
  - `role` (text, NOT NULL, CHECK (`role` IN ('admin', 'member'))) - *Initial roles, extensible later.*
  - `status` (text, NOT NULL, CHECK (`status` IN ('pending', 'active', 'removed')))
  - `created_at`, `updated_at` (timestamptz)
  - *Index:* (`user_id`, `organization_id`) UNIQUE

- **`public.notifications`** (Stores in-app notifications for users)
  - `id` (uuid, PK, default `gen_random_uuid()`)
  - `user_id` (uuid, NOT NULL, FK references `auth.users(id) ON DELETE CASCADE`)
  - `type` (text, NOT NULL) - *e.g., 'join_request', 'invite_sent', 'role_changed'*
  - `data` (jsonb, nullable) - *Stores context like `target_path`, `org_id`, `requesting_user_id`, `membership_id` for linking and display.*
  - `read` (boolean, NOT NULL, default `false`)
  - `created_at` (timestamptz)
  - *Index:* (`user_id`, `read`, `created_at`)

### [NEW] Backend Logic (Notifications & Tenancy)

- **Row-Level Security (RLS):**
  - `organizations`: Policies enforce that users can only see/interact with non-deleted orgs they are active members of. Visibility checks might apply. Admins have broader permissions within their org.
  - `organization_members`: Policies enforce access based on org membership and role. Admins manage memberships within their org.
  - `notifications`: Policies ensure users only access their own notifications.
  - *Existing Tables*: RLS on tables like `chats`, `chat_messages`, etc., will be updated to check for `organization_id` based on the user's active membership in a non-deleted organization.
- **Triggers/Functions:**
  - **Notification Triggers:** Database triggers (e.g., `notify_org_admins_on_join_request` on `AFTER INSERT ON organization_members`) will automatically create entries in the `notifications` table for relevant users (e.g., org admins) when specific events occur (join request, role change, etc.). These triggers populate the `notifications.data` field with necessary context.
  - **Last Admin Check:** A `BEFORE UPDATE OR DELETE` trigger or function on `organization_members` prevents the last active admin of a non-deleted organization from being removed or having their role changed to non-admin.

## Project Structure (Monorepo)

The project is organized as a monorepo using pnpm workspaces:

```
/
├── apps/                   # Individual applications / Frontends
│   ├── web/                # React Web Application (Vite + React Router)
│   │   └── src/
│   │       ├── assets/         # Static assets (images, fonts, etc.)
│   │       ├── components/     # UI Components specific to web app (e.g., ai/, core/, layout/)
│   │       ├── config/         # App-specific config (e.g., routes)
│   │       ├── context/        # React context providers
│   │       ├── hooks/          # Custom React hooks
│   │       ├── lib/            # Utility functions (e.g., cn)
│   │       ├── pages/          # Page components (routed via React Router)
│   │       ├── routes/         # Route definitions and protected routes
│   │       ├── tests/          # Web App Tests (Vitest)
│   │       │   ├── unit/         # Unit tests (*.unit.test.tsx)
│   │       │   ├── integration/  # Integration tests (*.integration.test.tsx)
│   │       │   ├── e2e/          # End-to-end tests (Placeholder)
│   │       │   ├── utils/        # Shared test utilities (render, etc.)
│   │       │   ├── mocks/        # Shared mocks (MSW handlers, components, stores)
│   │       │   └── setup.ts      # Vitest global setup (MSW server start, etc.)
│   │       ├── App.tsx         # Root application component
│   │       ├── index.css       # Global styles
│   │       └── main.tsx        # Application entry point (renders App)
│   ├── ios/                # iOS Application (Placeholder) //do not remove
│   ├── android/            # Android Application (Placeholder) //do not remove
│   ├── desktop/            # Desktop Application (Tauri/Rust)
│   ├── linux/              # Desktop Application (Placeholder) //do not remove
│   └── macos/              # Desktop Application (Placeholder) //do not remove
│
├── packages/               # Shared libraries/packages
│   ├── api/         # Frontend API client logic (Singleton)
│   │   └── src/
│   │       ├── apiClient.ts      # Base API client (fetch wrapper, singleton)
│   │       ├── stripe.api.ts     # Stripe/Subscription specific client methods
│   │       └── ai.api.ts         # AI Chat specific client methods
│   ├── analytics/   # Frontend analytics client logic (PostHog, Null adapter)
│   │   └── src/
│   │       ├── index.ts          # Main service export & factory
│   │       ├── nullAdapter.ts    # No-op analytics implementation
│   │       └── posthogAdapter.ts # PostHog implementation
│   ├── store/              # Zustand global state stores
│   │   └── src/
│   │       ├── authStore.ts        # Auth state & actions
│   │       ├── subscriptionStore.ts # Subscription state & actions
│   │       └── aiStore.ts          # AI Chat state & actions
│   │       ├── notificationStore.ts # [NEW] In-app notification state & actions
│   │       └── organizationStore.ts # [NEW] Organization/Multi-tenancy state & actions
│   ├── types/              # Shared TypeScript types and interfaces
│   │   └── src/
│   │       ├── api.types.ts
│   │       ├── auth.types.ts
│   │       ├── subscription.types.ts
│   │       ├── ai.types.ts
│   │       ├── analytics.types.ts
│   │       ├── platform.types.ts
│   │       ├── email.types.ts    # [NEW] Email marketing types
│   │       ├── theme.types.ts
│   │       ├── route.types.ts
│   │       ├── vite-env.d.ts
│   │       └── index.ts            # Main export for types
│   ├── platform/ # Service for abstracting platform-specific APIs (FS, etc.)
│   │   └── src/
│   │       ├── index.ts          # Main service export & detection
│   │       ├── webPlatformCapabilities.ts # Web provider (stub)
│   │       └── tauriPlatformCapabilities.ts # Tauri provider (stub)
│   └── utils/              # Shared utility functions
│       └── src/
│           └── logger.ts         # Logging utility (singleton)
│
├── supabase/
│   ├── functions/          # Supabase Edge Functions (Backend API)
│   │   ├── _shared/          # Shared Deno utilities for functions
│   │   │   ├── auth.ts           # Auth helpers
│   │   │   ├── cors-headers.ts   # CORS header generation
│   │   │   ├── email_service/    # [NEW] Email marketing service
│   │   │   │   ├── factory.ts      # [NEW] Selects email service implementation
│   │   │   │   ├── kit_service.ts  # [NEW] Kit implementation (planned)
│   │   │   │   └── no_op_service.ts # [NEW] No-op implementation (planned)
│   │   │   ├── responses.ts      # Standardized response helpers
│   │   │   └── stripe-client.ts  # Stripe client initialization
│   │   ├── node_modules/     # Function dependencies (managed by Deno/npm)
│   │   ├── api-subscriptions/ # Subscription management endpoints
│   │   ├── ai-providers/     # Fetch AI providers
│   │   ├── chat/             # Handle AI chat message exchange
│   │   ├── chat-details/     # Fetch messages for a specific chat
│   │   ├── chat-history/     # Fetch user's chat list
│   │   ├── login/
│   │   ├── logout/
│   │   ├── me/               # User profile fetch
│   │   ├── on-user-created/  # Auth Hook: Triggered after user signs up
│   │   ├── ping/             # Health check
│   │   ├── profile/          # User profile update
│   │   ├── refresh/
│   │   ├── register/
│   │   ├── reset-password/
│   │   ├── session/
│   │   ├── stripe-webhook/   # Stripe event handler
│   │   ├── sync-ai-models/   # Sync AI models to DB (Placeholder)
│   │   ├── sync-stripe-plans/ # Sync Stripe plans to DB
│   │   ├── system-prompts/   # Fetch system prompts
│   │   ├── tools/            # Internal tooling scripts (e.g., env sync)
│   │   ├── deno.jsonc
│   │   ├── deno.lock
│   │   ├── README.md         # Functions-specific README
│   │   └── types_db.ts       # Generated DB types
│   └── migrations/         # Database migration files (YYYYMMDDHHMMSS_*.sql)
│
├── .env                    # Local environment variables (Supabase/Stripe/Kit keys, etc. - UNTRACKED)
├── .env.example            # Example environment variables
├── netlify.toml            # Netlify deployment configuration
├── package.json            # Root package file (pnpm workspaces config)
├── pnpm-lock.yaml          # pnpm lock file
├── pnpm-workspace.yaml     # pnpm workspace definition
├── tsconfig.base.json      # Base TypeScript configuration for the monorepo
├── tsconfig.json           # Root tsconfig (references base)
└── README.md               # Project root README (often minimal, points here)
```

## Edge Functions (`supabase/functions/`)

```
supabase/functions/
│
├── _shared/             # Shared Deno utilities
│   ├── auth.ts
│   ├── cors-headers.ts
│   ├── email_service/   # [NEW] Email marketing service
│   │   ├── factory.ts
│   │   ├── kit_service.ts
│   │   └── no_op_service.ts
│   ├── responses.ts
│   └── stripe-client.ts
│
├── api-subscriptions/   # Handles subscription actions (checkout, portal, plans, current, cancel, resume, usage)
├── ai-providers/        # Fetches active AI providers
├── chat/                # Handles AI chat message exchange, context management, history saving
├── chat-details/        # Fetches messages for a specific chat ID
├── chat-history/        # Fetches the list of chats for the authenticated user
├── login/               # Handles user login
├── logout/              # Handles user logout
├── me/                  # Handles fetching the current user's profile
├── on-user-created/     # Auth Hook: Triggered after user signs up (e.g., create profile, **email sync**)
├── ping/                # Simple health check endpoint
├── profile/             # Handles updating the current user's profile
├── refresh/             # Handles session token refresh
├── register/            # Handles user registration
├── reset-password/      # Handles password reset flow
├── session/             # Handles session validation/information (needs verification)
├── stripe-webhook/      # Handles incoming Stripe events
├── sync-ai-models/      # [Admin/Internal] Syncs AI models from providers to DB (Placeholder/Inactive?)
├── sync-stripe-plans/   # [Admin/Internal] Syncs Stripe Products/Prices to DB
└── system-prompts/      # Fetches active system prompts
```

## Core Packages & Exports (For AI Assistants)

This section details the key exports from the shared packages to help AI tools understand the available functionality. *(Note: Details require inspecting package source code)*

### 1. `packages/api` (API Interaction)

Manages all frontend interactions with the backend Supabase Edge Functions. It follows a **Singleton pattern**.

- **`initializeApiClient(config: ApiInitializerConfig): void`**: Initializes the singleton instance. Must be called once at application startup.
  - `config: { supabaseUrl: string; supabaseAnonKey: string; }`
- **`api` object (Singleton Accessor)**: Provides methods for making API requests. Import and use this object directly: `import { api } from '@paynless/api';`
  - **`api.get<ResponseType>(endpoint: string, options?: FetchOptions): Promise<ApiResponse<ResponseType>>`**: Performs a GET request.
  - **`api.post<ResponseType, RequestBodyType>(endpoint: string, body: RequestBodyType, options?: FetchOptions): Promise<ApiResponse<ResponseType>>`**: Performs a POST request.
  - **`api.put<ResponseType, RequestBodyType>(endpoint: string, body: RequestBodyType, options?: FetchOptions): Promise<ApiResponse<ResponseType>>`**: Performs a PUT request.
  - **`api.delete<ResponseType>(endpoint: string, options?: FetchOptions): Promise<ApiResponse<ResponseType>>`**: Performs a DELETE request.
  - **`api.billing()`**: Accessor for the `StripeApiClient` instance.
  - **`api.ai()`**: Accessor for the `AiApiClient` instance.

- **`FetchOptions` type** (defined in `@paynless/types`): Extends standard `RequestInit`.
  - `{ isPublic?: boolean; token?: string; }` (Plus standard `RequestInit` properties like `headers`, `method`, `body`)
    - `isPublic: boolean` (Optional): If true, the request is made without an Authorization header (defaults to false). The API client *always* includes the `apikey` header.
    - `token: string` (Optional): Explicitly provide an auth token to use, otherwise the client attempts to get it from the `authStore` if `isPublic` is false.

- **`ApiResponse<T>` type** (defined in `@paynless/types`): Standard response wrapper.
  - `{ status: number; data?: T; error?: ApiErrorType; }`

- **`ApiError` class** (defined in `@paynless/api`): Custom error class used internally by the client.
- **`AuthRequiredError` class** (defined in `@paynless/types`): Specific error for auth failures detected by the client.

#### `StripeApiClient` (Accessed via `api.billing()`)
Methods for interacting with Stripe/Subscription related Edge Functions.

- `createCheckoutSession(priceId: string, isTestMode: boolean, successUrl: string, cancelUrl: string, options?: FetchOptions): Promise<ApiResponse<CheckoutSessionResponse>>`
  - Creates a Stripe Checkout session.
  - Requires `successUrl` and `cancelUrl` for redirection.
  - Returns the session URL (in `data.sessionUrl`) or error.
- `createPortalSession(isTestMode: boolean, returnUrl: string, options?: FetchOptions): Promise<ApiResponse<PortalSessionResponse>>`
  - Creates a Stripe Customer Portal session.
  - Requires `returnUrl` for redirection after portal usage.
  - Returns the portal URL (in `data.url`) or error.
- `getSubscriptionPlans(options?: FetchOptions): Promise<ApiResponse<SubscriptionPlan[]>>`
  - Fetches available subscription plans (e.g., from `subscription_plans` table).
  - Returns `{ plans: SubscriptionPlan[] }` in the `data` field (Note: API returns array directly, type adjusted for clarity).
- `getUserSubscription(options?: FetchOptions): Promise<ApiResponse<UserSubscription>>`
  - Fetches the current user's subscription details.
- `cancelSubscription(subscriptionId: string, options?: FetchOptions): Promise<ApiResponse<void>>`
  - Cancels an active subscription via the backend.
- `resumeSubscription(subscriptionId: string, options?: FetchOptions): Promise<ApiResponse<void>>`
  - Resumes a canceled subscription via the backend.
- `getUsageMetrics(metric: string, options?: FetchOptions): Promise<ApiResponse<SubscriptionUsageMetrics>>`
  - Fetches usage metrics for a specific subscription metric.

#### `AiApiClient` (Accessed via `api.ai()`)
Methods for interacting with AI Chat related Edge Functions.

- `getAiProviders(token?: string): Promise<ApiResponse<AiProvider[]>>`
  - Fetches the list of active AI providers.
  - `token` (Optional): Uses token if provided, otherwise assumes public access (`isPublic: true` in options).
- `getSystemPrompts(token?: string): Promise<ApiResponse<SystemPrompt[]>>`
  - Fetches the list of active system prompts.
  - `token` (Optional): Uses token if provided, otherwise assumes public access (`isPublic: true` in options).
- `sendChatMessage(data: ChatApiRequest, options: FetchOptions): Promise<ApiResponse<ChatMessage>>`
  - Sends a chat message to the backend `/chat` function.
  - `data: ChatApiRequest ({ message: string, providerId: string, promptId: string, chatId?: string })`
  - `options: FetchOptions` (Must include `token` for authenticated user).
- `getChatHistory(token: string): Promise<ApiResponse<Chat[]>>`
  - Fetches the list of chat conversations for the authenticated user.
  - `token` (Required): User's auth token.
- `getChatMessages(chatId: string, token: string): Promise<ApiResponse<ChatMessage[]>>`
  - Fetches all messages for a specific chat.
  - `chatId` (Required): ID of the chat.
  - `token` (Required): User's auth token.

### 2. `packages/store` (Global State Management)

Uses Zustand for state management with persistence for session data.

#### `useAuthStore` (Hook)
Manages user authentication, session, and profile state.

- **State Properties** (Access via `useAuthStore(state => state.propertyName)`):
  - `user: User | null`
  - `session: Session | null`
  - `profile: UserProfile | null`
  - `isLoading: boolean`
  - `error: Error | null`
  - `navigate: NavigateFunction | null` (Internal function for routing, set via `setNavigate`)
- **Actions** (Access via `useAuthStore.getState().actionName` or destructure `const { actionName } = useAuthStore();`):
  - `setNavigate(navigateFn: NavigateFunction): void`
    - Injects the navigation function from the UI framework (e.g., React Router).
  - `setUser(user: User | null): void`
  - `setSession(session: Session | null): void`
  - `setProfile(profile: UserProfile | null): void`
  - `setIsLoading(isLoading: boolean): void`
  - `setError(error: Error | null): void`
  - `login(email: string, password: string): Promise<User | null>`
    - Calls `/login` endpoint, updates state, handles internal navigation on success (including potential action replay).
    - Returns user object on success, null on failure.
  - `register(email: string, password: string): Promise<User | null>`
    - Calls `/register` endpoint, updates state, handles internal navigation on success (including potential action replay).
    - Returns user object on success, null on failure.
  - `logout(): Promise<void>`
    - Calls `/logout` endpoint, clears local state.
  - `initialize(): Promise<void>`
    - Checks persisted session, calls `/me` endpoint to verify token and fetch user/profile.
  - `refreshSession(): Promise<void>`
    - Calls `/refresh` endpoint using the refresh token, updates state.
  - `updateProfile(profileData: UserProfileUpdate): Promise<boolean>`
    - Calls `/profile` endpoint (PUT), updates local profile state on success.
    - Returns true on success, false on failure.

#### `useSubscriptionStore` (Hook)
Manages subscription plans and the user's current subscription status.

- **State Properties**:
  - `userSubscription: UserSubscription | null`
  - `availablePlans: SubscriptionPlan[]`
  - `isSubscriptionLoading: boolean`
  - `hasActiveSubscription: boolean` (Derived from `userSubscription.status`)
  - `isTestMode: boolean` (Set via `setTestMode` action, typically from env var)
  - `error: Error | null`
- **Actions**:
  - `setUserSubscription(subscription: UserSubscription | null): void`
  - `setAvailablePlans(plans: SubscriptionPlan[]): void`
  - `setIsLoading(isLoading: boolean): void`
  - `setTestMode(isTestMode: boolean): void`
  - `setError(error: Error | null): void`
  - `loadSubscriptionData(): Promise<void>`
    - Fetches available plans (`/api-subscriptions/plans`) and current user subscription (`/api-subscriptions/current`).
    - Requires authenticated user (uses token from `authStore`).
  - `refreshSubscription(): Promise<boolean>`
    - Calls `loadSubscriptionData` again. Returns true on success, false on failure.
  - `createCheckoutSession(priceId: string): Promise<string | null>`
    - Calls `api.billing().createCheckoutSession`. Requires success/cancel URLs derived from `window.location`.
    - Returns the Stripe Checkout session URL on success, null on failure.
    - Requires authenticated user.
  - `createBillingPortalSession(): Promise<string | null>`
    - Calls `api.billing().createPortalSession`. Requires return URL derived from `window.location`.
    - Returns the Stripe Customer Portal URL on success, null on failure.
    - Requires authenticated user.
  - `cancelSubscription(subscriptionId: string): Promise<boolean>`
    - Calls `api.billing().cancelSubscription`, then `refreshSubscription`. Returns true on success, false on failure.
    - Requires authenticated user.
  - `resumeSubscription(subscriptionId: string): Promise<boolean>`
    - Calls `api.billing().resumeSubscription`, then `refreshSubscription`. Returns true on success, false on failure.
    - Requires authenticated user.
  - `getUsageMetrics(metric: string): Promise<SubscriptionUsageMetrics | null>`
    - Calls `api.billing().getUsageMetrics`. Returns usage metrics object on success, null on failure.
    - Requires authenticated user.

#### `useAiStore` (Hook)
Manages AI chat state, including providers, prompts, messages, and history.

- **State Properties**:
  - `availableProviders: AiProvider[]`
  - `availablePrompts: SystemPrompt[]`
  - `currentChatMessages: ChatMessage[]`
  - `currentChatId: string | null`
  - `chatHistoryList: Chat[]`
  - `isLoadingAiResponse: boolean` (True while waiting for AI message response)
  - `isConfigLoading: boolean` (True while loading providers/prompts)
  - `isHistoryLoading: boolean` (True while loading chat history list)
  - `isDetailsLoading: boolean` (True while loading messages for a specific chat)
  - `aiError: string | null` (Stores error messages related to AI operations)
- **Actions**:
  - `loadAiConfig(): Promise<void>`
    - Fetches AI providers (`/ai-providers`) and system prompts (`/system-prompts`).
  - `sendMessage(data: ChatApiRequest): Promise<ChatMessage | null>`
    - Handles sending a message via `api.ai().sendChatMessage`. Requires `token` in `FetchOptions` provided to API client.
    - Manages optimistic UI updates for user message.
    - Updates `currentChatMessages` and `currentChatId`.
    - If `AuthRequiredError` is caught, attempts to store pending action and navigate to `/login`.
    - Returns the received `ChatMessage` on success, null on API error or if auth redirect occurs.
  - `loadChatHistory(): Promise<void>`
    - Fetches the user's chat list via `api.ai().getChatHistory`.
    - Updates `chatHistoryList`.
    - Requires authenticated user (token obtained from `authStore`).
  - `loadChatDetails(chatId: string): Promise<void>`
    - Fetches messages for a specific chat via `api.ai().getChatMessages`.
    - Updates `currentChatId` and `currentChatMessages`.
    - Requires authenticated user (token obtained from `authStore`).
  - `startNewChat(): void`
    - Resets `currentChatId` and `currentChatMessages`.
  - `clearAiError(): void`
    - Sets `aiError` state to null.

### 3. `packages/utils` (Shared Utilities)

#### `logger.ts` (Logging Utility)
Provides a singleton logger instance (`logger`) for consistent application logging.

- **`logger` instance** (Singleton, import `logger` from `@paynless/utils`):
  - `logger.debug(message: string, metadata?: LogMetadata): void`
  - `logger.info(message: string, metadata?: LogMetadata): void`
  - `logger.warn(message: string, metadata?: LogMetadata): void`
  - `logger.error(message: string, metadata?: LogMetadata): void`
- **Configuration**:
  - `logger.configure(config: Partial<LoggerConfig>): void`
    - `config: { minLevel?: LogLevel; enableConsole?: boolean; captureErrors?: boolean; }`
- **`LogLevel` enum**: `DEBUG`, `INFO`, `WARN`, `ERROR`
- **`LogMetadata` interface**: `{ [key: string]: unknown; }` (For structured logging data)

### 4. `packages/types` (Shared TypeScript Types)

Contains centralized type definitions used across the monorepo. Exports all types via `index.ts`.

- **`api.types.ts`**: `ApiResponse`, `ApiErrorType`, `FetchOptions`, `AuthRequiredError`, etc.
- **`auth.types.ts`**: `User`, `Session`, `UserProfile`, `UserProfileUpdate`, `AuthStore`, `AuthResponse`, etc.
- **`subscription.types.ts`**: `SubscriptionPlan`, `UserSubscription`, `SubscriptionStore`, `SubscriptionUsageMetrics`, `CheckoutSessionResponse`, `PortalSessionResponse`, `SubscriptionPlansResponse`, etc.
- **`ai.types.ts`**: `AiProvider`, `SystemPrompt`, `Chat`, `ChatMessage`, `ChatApiRequest`, `AiState`, `AiStore`, etc.
- **`analytics.types.ts`**: `AnalyticsClient`, `AnalyticsEvent`, `AnalyticsUserTraits`.
- **`platform.types.ts`**: `PlatformCapabilities`, `FileSystemCapabilities`.
- **`email.types.ts`**: `SubscriberInfo`, `EmailMarketingService`. **[NEW]**
- **`theme.types.ts`**: Types related to theming.
- **`route.types.ts`**: Types related to application routing.
- **`vite-env.d.ts`**: Vite environment types.

### 5. `packages/platform` (Platform Abstraction)

Provides a service to abstract platform-specific functionalities (like filesystem access) for use in shared UI code.

- **`getPlatformCapabilities(): PlatformCapabilities`**: Detects the current platform (web, tauri, etc.) and returns an object describing available capabilities. Result is memoized.
  - Consumers check `capabilities.fileSystem.isAvailable` before attempting to use filesystem methods.
- **Providers (Internal):**
  - `webPlatformCapabilities.ts`: Implements capabilities available in a standard web browser (currently FS is `isAvailable: false`).
  - `tauriPlatformCapabilities.ts`: Implements capabilities available in the Tauri desktop environment (currently FS is `isAvailable: false`, planned to call Rust backend).
- **`resetMemoizedCapabilities(): void`**: Clears the cached capabilities result (useful for testing).

### 6. `supabase/functions/_shared/` (Backend Shared Utilities)

Contains shared Deno code used by multiple Edge Functions (CORS handling, Supabase client creation, auth helpers, Stripe client initialization, **email marketing service**). Refer to the files within this directory for specific utilities. 