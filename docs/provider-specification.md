# Provider Capability Specification

This document defines the provider feature set that Maniya Online should support. It is derived from the real Lampac implementation patterns in its controllers, services, models, templates, HTTP layer, proxy stack, and stream handling logic rather than from README guidance.

## Provider Capability Matrix

| Capability | Description | Mandatory | Every provider supports it | How Lampac implements it | How Maniya Online should implement it |
|---|---|---:|---:|---|---|
| Provider identity and registration | Each provider must expose a stable identifier, display title, and be registerable by the provider manager. | Yes | Yes | Providers are discovered and instantiated through the platform’s provider registry and plugin-style module structure. | Expose a stable provider id and title from the provider class and register it centrally in the provider registry. |
| Search entry point | Providers must support a unified search interface for user-entered queries. | Yes | Yes | Lampac routes search through provider-backed controllers and services that accept a search query and return structured result sets. | Implement a search(query, context) method in every provider and return provider-local search items. |
| Movie search | Providers must be able to return movie candidates for a search query. | Yes | Yes | Lampac’s template objects handle movie results separately from serial results and preserve the item shape for playback selection. | Support movie search in the provider layer and return movie candidates with enough metadata to resolve details and streams later. |
| Serial search | Providers must be able to return serial candidates for a search query. | Yes | Yes | Lampac separates serial content into serial-specific flows, including seasons and episodes. | Support serial search and return candidates that can later resolve seasons and episodes. |
| Search fallback | Providers should be able to recover when the primary search request is too narrow or returns weak results. | Yes | No | Lampac’s broader search flow often uses alternate query normalization and fallback heuristics before giving up. | Allow providers to retry with normalized or alternate search inputs when the first result set is empty or weak. |
| Search by IMDb | Providers should be able to resolve media by IMDb identifier when available. | Yes | No | Lampac includes external identifier support in the search and metadata flow for richer matching. | Support an IMDb-based lookup path when the provider exposes that capability or when the request context includes an IMDb id. |
| Search by Kinopoisk | Providers should be able to resolve media by Kinopoisk identifier when available. | Yes | No | Lampac’s provider integrations can use external IDs for more precise matching. | Support a Kinopoisk-based lookup path when the provider or upstream API supports it. |
| Metadata lookup | Providers must be able to fetch core metadata such as title, poster, year, genres, and runtime. | Yes | Yes | Lampac’s models carry rich metadata separate from the actual stream payload and use templates to render it. | Return normalized metadata from the provider’s movie() or serial() methods and expose it to the app. |
| Seasons | Providers that expose serials must be able to return seasons. | Yes | Yes | Lampac uses season templates and season DTOs to represent serial seasons clearly. | Implement a getSeasons or equivalent method that returns season items with stable identifiers. |
| Episodes | Providers that expose serials must be able to return episodes for a season. | Yes | Yes | Episode templates in Lampac include numbering, titles, stream links, and playback metadata. | Implement an episode listing method that returns episodes with start/end numbering and links. |
| Episode numbering | Episodes should carry numeric season and episode indexes. | Yes | Yes | Lampac stores episode start and end values explicitly in episode DTOs. | Preserve episode and season numbers in the normalized provider result shape. |
| Translations | Providers must be able to expose available translation/voice options for a title. | Yes | Yes | Lampac uses translation or voice objects in its templates to allow the UI to present language choices. | Expose translation or voice options through the provider’s metadata and stream selection layers. |
| Translation priority | Providers should return translations in a predictable priority order. | Yes | No | Lampac’s templates and UI logic assume ordered voice/translation options to improve user experience. | Normalize translations and sort them by language preference, default, or provider ordering. |
| Voice metadata | Providers should preserve voice/language labels in a structured way. | Yes | No | Lampac’s models keep voice labels separate from the stream payload itself. | Preserve voice labels and optionally include language metadata in the normalized result. |
| Quality detection | Providers must be able to identify the quality of a stream when the upstream source provides it. | Yes | Yes | Lampac uses stream quality templates and quality metadata to surface stream choices to the client. | Parse and preserve quality values from upstream responses and expose them through the stream model. |
| Quality normalization | Quality values should be normalized to a shared vocabulary such as SD, HD, Full HD, 4K, UHD. | Yes | Yes | Lampac’s templates normalize quality values into a consistent display shape. | Map provider-specific quality values into a canonical Maniya quality vocabulary. |
| Multiple qualities | Providers should be able to expose more than one quality option for the same stream. | Yes | Yes | Lampac’s stream quality templates allow multiple stream/quality pairs per item. | Return a list of quality variants and/or a quality map rather than a single flat value. |
| Multiple translations | Providers should be able to provide several translation options for the same media item. | Yes | Yes | Lampac’s templates support multiple voices/translations per title. | Return multiple translation/voice options per item and let the app choose or prefer one. |
| Stream extraction | Providers must convert upstream payloads into playable stream URLs. | Yes | Yes | Lampac extracts stream links from provider payloads and passes them through a dedicated stream pipeline. | Parse the upstream stream response and convert it into Maniya’s stream item contract. |
| HLS streams | Providers should support HLS playback URLs when the upstream source exposes them. | Yes | No | Lampac’s proxy and media pipeline explicitly supports HLS manifests and manifest timeout control. | Support HLS URLs and preserve manifest timeout and headers when required. |
| DASH streams | Providers should support DASH playback URLs when the upstream source exposes them. | Yes | No | Lampac handles DASH stream routing through a dedicated proxy layer. | Support DASH URLs and preserve relevant headers and proxy behavior. |
| MP4/direct streams | Providers should support direct MP4 or other direct media URLs when available. | Yes | No | Lampac’s stream templates support direct URLs and direct playback methods. | Support direct media URLs and associated headers if the source requires them. |
| iframe streams | Providers may expose iframe-based sources that need special handling. | Yes | No | Lampac has explicit iframe-related handling in its API and stream pipeline. | Support iframe URLs as a stream type and ensure the downstream player can use them safely. |
| Backup streams | Providers should support alternate or backup streams when the primary one fails. | Yes | No | Lampac’s templates and stream logic allow additional stream candidates and reserve entries. | Include backup/alternate stream candidates in the normalized result whenever available. |
| Reserve streams | Providers should preserve reserve or fallback stream entries if the upstream payload provides them. | Yes | No | Lampac’s proxy and template layers preserve alternate URLs that can be used as fallbacks. | Preserve reserve stream entries and expose them as secondary options in the provider result. |
| Proxy support | Providers must be able to work through a proxy when the host or network requires it. | Yes | No | Lampac has a full proxy manager, proxy link encoder, and proxy-aware HTTP stack. | Route provider HTTP requests through configurable proxy settings and preserve proxy metadata in the stream response. |
| Host configuration | Providers should support configurable hostnames or base URLs. | Yes | No | Lampac providers often use provider-specific host settings and base URL configuration. | Make provider base URLs configurable and allow environment or settings-based overrides. |
| Secret tokens | Providers may require token-based authentication or signed query values. | Yes | No | Lampac’s settings and request pipeline can carry secret values and tokens alongside provider requests. | Support token-based configuration and avoid hard-coding secrets in provider source. |
| Authentication | Providers must support authenticated requests when the upstream API requires them. | Yes | No | Lampac’s HTTP stack can send custom headers, cookies, and other authentication data. | Support auth headers, bearer tokens, and cookie-based auth via provider-specific request configuration. |
| Request context | Providers should receive request context such as country, IP, device, and client hints when relevant. | Yes | No | Lampac’s request pipeline threads request information through its services and HTTP stack. | Accept a context object in provider methods and use it for geo-aware, device-aware, or user-specific behavior. |
| User-Agent requirements | Providers may require specific User-Agent values. | Yes | No | Lampac’s HTTP layer explicitly supports custom user-agent headers and related request metadata. | Preserve and send provider-specific User-Agent headers when required. |
| Headers | Providers may need arbitrary headers for requests and stream delivery. | Yes | No | Lampac includes a full header model and normalization path for provider requests. | Support provider-specific headers in both request and stream response handling. |
| Referer handling | Providers often require a Referer header for media or API requests. | Yes | No | Lampac’s HTTP layer and stream pipeline explicitly use referer values for downstream access. | Support Referer headers in provider requests and stream-related requests. |
| Cookies | Providers may require browser or session cookies. | Yes | No | Lampac’s HTTP stack supports cookie containers and cookie-based session handling. | Support cookie-based auth and session persistence where required by the provider. |
| Rate limiting | Providers should not hammer upstream services and should respect throttling constraints. | Yes | No | Lampac’s architecture includes rate limiting and proxy-aware request management patterns. | Implement retry and backoff logic and avoid uncontrolled request bursts. |
| Retry handling | Providers should retry transient failures gracefully. | Yes | No | Lampac’s HTTP and proxy services include retry-aware flows and failure recovery logic. | Retry transient request failures with bounded backoff and clear error propagation. |
| Error handling | Providers must surface failures in a way that the app can understand and present. | Yes | Yes | Lampac’s services and middleware isolate request failures and present them through structured error handling. | Throw provider-friendly errors or return empty results with meaningful context rather than crashing the request. |
| Subtitles | Providers should be able to expose subtitle tracks when available. | Yes | No | Lampac’s templates carry subtitles in the movie, episode, and video DTOs. | Preserve subtitles in the stream item and expose them in a normalized format. |
| Posters | Providers should expose poster and image URLs for search and metadata results. | Yes | No | Lampac’s metadata flow carries poster information through its models and templates. | Return poster URLs as part of the normalized metadata shape. |
| Years | Providers should expose release year values. | Yes | No | Lampac’s templates and metadata models preserve year metadata. | Return normalized year values for movies and serials. |
| Genres | Providers should expose genre data when the upstream source provides it. | Yes | No | Lampac’s metadata flow supports title classification and presentation. | Return normalized genre values as part of the metadata contract. |
| Runtime | Providers should expose runtime or duration when available. | Yes | No | Lampac’s metadata flow includes runtime-related information for media presentation. | Return runtime as a normalized field where available. |
| Provider-specific metadata | Providers may expose extra fields such as original title, country, cast, or source identifiers. | Yes | No | Lampac’s models are extensible and support additional metadata alongside the core fields. | Keep provider-specific metadata in a structured extension field or normalized metadata bag. |

## Provider Compliance Checklist

Use this checklist when reviewing or implementing a new provider.

### Search and Discovery
- [ ] Provider registers with a stable id and title
- [ ] Search query is accepted and returns provider-local results
- [ ] Movie search is implemented
- [ ] Serial search is implemented
- [ ] Search fallback logic exists
- [ ] IMDb lookup is supported when available
- [ ] Kinopoisk lookup is supported when available

### Metadata and Structure
- [ ] Metadata lookup is implemented
- [ ] Seasons are supported for serials
- [ ] Episodes are supported for serials
- [ ] Episode numbering is preserved
- [ ] Translation/voice options are exposed
- [ ] Translation priority is normalized
- [ ] Voice metadata is preserved
- [ ] Posters, years, genres, and runtime are normalized

### Quality and Streaming
- [ ] Quality values are detected and preserved
- [ ] Quality values are normalized to a shared vocabulary
- [ ] Multiple qualities are supported
- [ ] Multiple translations are supported
- [ ] Stream extraction is implemented
- [ ] HLS streams are supported when available
- [ ] DASH streams are supported when available
- [ ] Direct MP4 or direct media URLs are supported when available
- [ ] iframe-based streams are supported when available
- [ ] Backup/alternate streams are preserved
- [ ] Reserve/fallback streams are preserved

### Request and Transport
- [ ] Proxy support is implemented where needed
- [ ] Host configuration is configurable
- [ ] Secret tokens or credentials are handled safely
- [ ] Authentication headers or sessions are supported where required
- [ ] Request context is available to the provider
- [ ] User-Agent headers are supported
- [ ] Custom headers are supported
- [ ] Referer handling is supported
- [ ] Cookies are supported when required

### Reliability and UX
- [ ] Rate limiting is respected
- [ ] Retry handling is implemented for transient failures
- [ ] Errors are surfaced clearly and safely
- [ ] Subtitles are preserved and normalized
- [ ] Provider-specific metadata is retained in a structured way
