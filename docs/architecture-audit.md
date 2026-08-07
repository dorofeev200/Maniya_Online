# Architecture audit: Maniya Online repository

## Executive summary

The repository is a working Lampa-plugin shell with a Node.js API server, a browser-side plugin, and a provider abstraction layer. The current implementation is functional for subscription checks, static plugin delivery, and basic video-source discovery, and the automated API tests pass in the local verification run.

The main architectural gap is not the shell itself, but the provider integration layer: the repository contains a fairly rich provider SDK and several provider implementations, yet only a subset is actually registered and used by the runtime path. Filmix is present as a feature-rich implementation but is not wired into the active registry.

## Verified repository state

- The API server starts and serves health, readiness, static plugin assets, subscription checks, source listing, and video-list requests.
- The current automated test suite passes when run directly with Node and an explicit test environment variable.
- The runtime path is driven by the server entrypoint in [server/src/index.js](server/src/index.js) and the data lookup layer in [server/src/store.js](server/src/store.js).

## Runtime architecture

### 1. Frontend plugin

The browser-side plugin lives in [public/maniya-online.js](public/maniya-online.js).

Responsibilities:
- injects the Maniya Online button into the Lampa UI;
- reads token information from URL, runtime globals, and Lampa storage;
- calls the API endpoints for subscription status, source discovery, and video items;
- passes playback data to Lampa’s player.

This is a thin client layer. It does not perform provider logic itself; it simply consumes the server API.

### 2. Server entrypoint

The server entrypoint in [server/src/index.js](server/src/index.js) creates the HTTP server and routes requests to these endpoints:
- /health
- /ready
- /api/lampa/subscription/check
- /api/lampa/sources
- /api/lampa/videos
- /api/lampa/stream

The routing layer is compact and explicit. Subscription checks are enforced before source and video endpoints, and CORS/rate-limit protections are applied before provider-aware routes run.

### 3. Configuration and runtime services

Core runtime modules:
- [server/src/config.js](server/src/config.js): loads environment variables and exposes server configuration.
- [server/src/security.js](server/src/security.js): implements CORS, rate limiting, client IP extraction, and token validation.
- [server/src/http.js](server/src/http.js): handles JSON responses and static file delivery.
- [server/src/logger.js](server/src/logger.js): emits structured JSON logs.
- [server/src/store.js](server/src/store.js): resolves users and video content, including provider-based search fallback.

The server is intentionally simple and mostly acts as a gateway layer rather than a full application server.

## Provider architecture

### 1. Provider abstraction

The provider abstraction is centered on [server/src/providers/base.js](server/src/providers/base.js).

It defines a Provider interface and a StreamItem contract. The design intent is clear:
- providers expose search and stream behavior;
- stream results are normalized into a shared StreamItem shape;
- shared builders and validators normalize quality, voice, seasons, episodes, and streams.

This layer is fairly mature and modular.

### 2. Shared provider SDK

The shared SDK is under [server/src/providers/shared](server/src/providers/shared).

Included capabilities:
- HTTP client with retry and timeout handling: [server/src/providers/shared/http/HttpClient.js](server/src/providers/shared/http/HttpClient.js)
- Rate limiter: [server/src/providers/shared/http/RateLimiter.js](server/src/providers/shared/http/RateLimiter.js)
- Retry policy: [server/src/providers/shared/http/RetryPolicy.js](server/src/providers/shared/http/RetryPolicy.js)
- Stream builders: [server/src/providers/shared/streams](server/src/providers/shared/streams)
- Normalizers for language, voice, and quality: [server/src/providers/shared/normalize](server/src/providers/shared/normalize)

This is the strongest part of the repository architecturally: it is reusable and fairly well separated from provider-specific logic.

### 3. Provider implementations

Implemented providers include:
- [server/src/providers/kodik](server/src/providers/kodik): Kodik adapter and normalizer
- [server/src/providers/rezka](server/src/providers/rezka): Rezka adapter and normalizer
- [server/src/providers/alloha](server/src/providers/alloha): Alloha adapter and normalizer
- [server/src/providers/filmix](server/src/providers/filmix): Filmix client, normalizer, and provider wrapper

The Filmix implementation is especially notable because it is more feature-rich than the others in some areas, including client-side search fallback, quality mapping, season/episode handling, and stream-building logic.

### 4. Registry and runtime wiring

The registry in [server/src/registry.js](server/src/registry.js) is currently the runtime wiring point. The actual file is [server/src/providers/registry.js](server/src/providers/registry.js).

Current active registration:
- Kodik
- Rezka
- Alloha

Important observation:
- Filmix exists in the codebase, but it is not registered in the active provider list.
- The Filmix provider class itself has enabled() returning false, so even if it were registered, it would not be active by default.

This means the current server path is not using Filmix at runtime, even though the implementation exists.

## Data flow

### Request flow

1. The Lampa plugin calls the server using the API base from [public/maniya-online.js](public/maniya-online.js).
2. The server validates the request, subscription, and CORS/rate-limit rules in [server/src/index.js](server/src/index.js) and [server/src/security.js](server/src/security.js).
3. For /api/lampa/sources and /api/lampa/videos, the server consults [server/src/store.js](server/src/store.js).
4. The store layer asks registered providers for search results through [server/src/providers/registry.js](server/src/providers/registry.js).
5. Provider results are merged into the response payload consumed by the plugin.
6. The plugin renders the returned items and hands them to the Lampa player.

### Provider search flow

The current store layer asks each registered provider to search, and it returns the aggregated results. This is a pragmatic architecture for a plugin shell, but it is not a fully unified provider contract yet.

The provider implementations are not uniformly shaped:
- some return raw provider-level records;
- some return normalized objects;
- some return ad-hoc stream data.

That means the system is functionally working, but the abstraction is only partially enforced.

## Strengths

- Clear separation between UI, API, security, and provider layers.
- Reusable provider SDK with common HTTP, retry, rate limiting, and normalization utilities.
- Simple deployment model with Docker and systemd support.
- Automated API tests that verify the main server contract.

## Risks and gaps

### 1. Provider registry mismatch

The repository contains a Filmix implementation that is not active in runtime registration. That is the most obvious gap from an architecture perspective.

### 2. Partial abstraction enforcement

The Provider base class expects a shared StreamItem contract, but the server routes do not consistently enforce it. The manager in [server/src/providers/manager.js](server/src/providers/manager.js) exists but is not used by the main server flow.

### 3. Runtime behavior is still shell-like

The server is good at acting as a gateway and adapter, but it does not yet provide a fully consistent provider orchestration layer for advanced features such as:
- unified search ranking;
- cross-provider fallback policies;
- episode/season browsing;
- richer stream assembly and quality selection.

### 4. Deployment and configuration are still manual

Runtime configuration is environment-driven and documented, but production readiness still depends on careful setup of tokens, storage files, DNS, TLS, and provider credentials.

## Recommended next steps

1. Make the provider registry the single source of truth for active providers and include Filmix intentionally once its runtime behavior is validated.
2. Align all providers with a single contract for search and stream output so the server can process results uniformly.
3. Decide whether the main routes should use the ProviderManager abstraction directly or whether the current store-based approach should be refined.
4. Add provider-level integration tests so provider wiring and normalization are verified independently from the API shell.
5. Keep the existing provider-specification document and the new architecture audit as the baseline for future implementation work.
