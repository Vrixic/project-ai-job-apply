# Workflow Source

Contains deterministic Temporal workflows, retryable profile-owned activities, and the
identifier-only transactional-outbox dispatcher. The worker composition root also starts and
stops the privacy-safe log-delivery heartbeat without putting timers inside workflow code.
